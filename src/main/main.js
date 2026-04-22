const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, Menu, MenuItem, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const windowStateKeeper = require('electron-window-state');
const { autoUpdater } = require('electron-updater');

// --- 1. PERFORMANCE & GPU OPTIMIZATIONS ---
app.disableHardwareAcceleration(); 
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512'); 
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-web-authentication');

// --- 2. CONFIGURATION & STORAGE ---
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'accounts.json');

const SERVICE_MAP = {
  'gmail': { name: 'Gmail', url: 'https://mail.google.com', icon: 'mail' },
  'outlook': { name: 'Outlook/Hotmail', url: 'https://outlook.office.com/mail/', icon: 'alternate_email' },
  'icloud': { name: 'iCloud', url: 'https://www.icloud.com/mail/', icon: 'cloud' },
};

function writeConfig(data) {
  const jsonString = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    const encryptedBuffer = safeStorage.encryptString(jsonString);
    fs.writeFileSync(configPath, encryptedBuffer);
  } else {
    fs.writeFileSync(configPath, jsonString);
  }
}

function readConfig() {
  if (!fs.existsSync(configPath)) return null;
  const buffer = fs.readFileSync(configPath);
  try {
    const decrypted = safeStorage.decryptString(buffer);
    return JSON.parse(decrypted);
  } catch (error) {
    try {
      return JSON.parse(buffer.toString());
    } catch (e) {
      console.error('Failed to read config:', e);
      return null;
    }
  }
}

function getAccounts() {
  const accounts = readConfig();
  if (!accounts || !Array.isArray(accounts)) { // SECURITY FIX: Ensure accounts is always an array
    const initial = [
      { id: 'gmail-default', type: 'gmail', ...SERVICE_MAP['gmail'] },
      { id: 'outlook-default', type: 'outlook', ...SERVICE_MAP['outlook'] }
    ];
    writeConfig(initial);
    return initial;
  }
  return accounts;
}

function saveAccount(serviceType, customName) {
  // SECURITY FIX: Validate that the service type exists in our map to prevent crashes or object injection
  if (!SERVICE_MAP.hasOwnProperty(serviceType)) {
    throw new Error(`Invalid service type: ${serviceType}`);
  }
  // SECURITY FIX: Limit customName length to prevent Storage DoS
  const safeName = typeof customName === 'string' ? customName.substring(0, 50) : SERVICE_MAP[serviceType].name;

  const accounts = getAccounts();
  const newAcc = { 
    id: `${serviceType}-${Date.now()}`, 
    type: serviceType, 
    name: safeName,
    url: SERVICE_MAP[serviceType].url, 
    icon: SERVICE_MAP[serviceType].icon 
  };
  accounts.push(newAcc);
  writeConfig(accounts);
  return newAcc;
}

// --- 3. SECURITY WHITE-LIST ---
function isSafeUrl(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== 'https:') return false;
    const host = parsedUrl.hostname;
    // SECURITY FIX: The domain checks here are solid because .endsWith('.domain.com') ensures it's a subdomain.
    return (
      host === 'google.com' || host.endsWith('.google.com') ||
      host === 'gstatic.com' || host.endsWith('.gstatic.com') ||
      host === 'microsoft.com' || host.endsWith('.microsoft.com') ||
      host === 'office.com' || host.endsWith('.office.com') ||
      host === 'office365.com' || host.endsWith('.office365.com') ||
      host === 'live.com' || host.endsWith('.live.com') ||
      host === 'outlook.com' || host.endsWith('.outlook.com') ||
      host === 'microsoftonline.com' || host.endsWith('.microsoftonline.com') ||
      host === 'windows.net' || host.endsWith('.windows.net') ||
      host === 'msauth.net' || host.endsWith('.msauth.net') ||
      host === 'msauthimages.net' || host.endsWith('.msauthimages.net') ||
      host === 'icloud.com' || host.endsWith('.icloud.com') ||
      host === 'apple.com' || host.endsWith('.apple.com')
    );
  } catch (err) {
    return false; 
  }
}

// SECURITY FIX: Helper to verify IPC messages are only from trusted local files
function isTrustedSender(sender) {
  try {
    return sender.getURL().startsWith('file://');
  } catch (e) {
    return false;
  }
}

// --- 4. SESSION & AUTHENTICATION ---
app.on('session-created', (ses) => {
  if (ses.setWebAuthnHandler) {
    ses.setWebAuthnHandler((details, callback) => {
      if (details.mediation === 'conditional') {
        callback({ action: 'cancel' });
      } else {
        callback({ action: 'run' });
      }
    });
  }

  // SECURITY FIX: Restrict web permissions to prevent rogue pages from accessing cameras, mics, or location without intent.
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['notifications']; // Only allow notifications for email clients
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.warn(`Denied permission request: ${permission}`);
      callback(false);
    }
  });
});

let mainWindow;
let views = {};

function updateViewBounds() {
  if (!mainWindow) return;
  const b = mainWindow.getContentBounds();
  Object.values(views).forEach(v => {
    v.setBounds({ x: 100, y: 0, width: b.width - 100, height: b.height });
  });
}

function createWindow() {
  let state = windowStateKeeper({ defaultWidth: 1200, defaultHeight: 800 });
  mainWindow = new BrowserWindow({
    x: state.x, y: state.y, width: state.width, height: state.height,
    minWidth: 800,
    minHeight: 600,
    frame: false, backgroundColor: '#1c1c1e',
    icon: path.join(__dirname, '../assets/logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false // SECURITY FIX: Explicitly ensuring Node integration is false
    }
  });

  state.manage(mainWindow);
  mainWindow.on('resize', updateViewBounds);

  const accounts = getAccounts();
  accounts.forEach(acc => createMailView(acc));

  mainWindow.loadFile(path.join(__dirname, '../renderer/pages/index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init-accounts', accounts);
  });

  // --- MEMORY SAVER ---
  mainWindow.on('minimize', () => {
    Object.values(views).forEach(v => {
      if (v.webContents) {
        v.webContents.setBackgroundThrottling(true);
        v.webContents.setAudioMuted(true);
      }
    });
  });

  mainWindow.on('restore', () => {
    Object.values(views).forEach(v => {
      if (v.webContents) {
        v.webContents.setBackgroundThrottling(false);
        v.webContents.setAudioMuted(false);
      }
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createMailView(acc) {
  const v = new WebContentsView({
    webPreferences: { 
      preload: path.join(__dirname, '../preload/mail-preload.js'),
      sandbox: true, 
      enableWebAuthn: true,
      contextIsolation: true,
      nodeIntegration: false, // SECURITY FIX: Explicitly false
      partition: `persist:${acc.id}` 
    }
  });
  mainWindow.contentView.addChildView(v);
  v.webContents.loadURL(acc.url);
  v.setVisible(false);
  views[acc.id] = v;
  
  const checkLogout = (url) => {
    try {
      const parsed = new URL(url);
      const lowerUrl = url.toLowerCase();
      const isLoggingOut = lowerUrl.includes('logout') || lowerUrl.includes('signout');
      const isICloudHome = (parsed.hostname === 'www.icloud.com' && (parsed.pathname === '/' || parsed.pathname === '/setup/'));
      const isOtherLanding = 
        (parsed.hostname === 'www.google.com' && parsed.pathname === '/') ||
        (parsed.hostname === 'www.microsoft.com' && parsed.pathname === '/') ||
        (parsed.hostname === 'www.office.com' && parsed.pathname === '/');

      if (isLoggingOut || isICloudHome || isOtherLanding) {
        if (url === acc.url) return;
        setTimeout(() => {
          if (!v.webContents.isDestroyed()) {
            v.webContents.loadURL(acc.url);
          }
        }, 600);
      }
    } catch (e) {}
  };

  v.webContents.on('will-navigate', (event, url) => {
    if (!isSafeUrl(url)) {
      event.preventDefault();
      // SECURITY FIX: Enforce safe protocols before opening external sites
      try {
        const parsedURL = new URL(url);
        if (['http:', 'https:', 'mailto:'].includes(parsedURL.protocol)) {
          shell.openExternal(url);
        }
      } catch (e) {
        console.error('Invalid URL during navigation');
      }
    } else {
      checkLogout(url);
    }
  });

  // SECURITY FIX: New Window restriction. Prevents mail providers from freely spawning uncontrollable popups.
  v.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedURL = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsedURL.protocol)) {
        shell.openExternal(url);
      }
    } catch (e) {
      console.error('Invalid popup URL');
    }
    return { action: 'deny' }; 
  });

  v.webContents.on('did-navigate', (event, url) => checkLogout(url));
  v.webContents.on('did-frame-navigate', (event, url) => checkLogout(url));
  v.webContents.on('update-target-url', (e, url) => {
    mainWindow.webContents.send('hover-link', url);
  });

  updateViewBounds();
}

// --- 5. IPC HANDLERS ---
ipcMain.on('update-account-name', (event, { id, newName }) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Ensure request is from local file
  if (typeof id !== 'string' || typeof newName !== 'string') return;
  const safeName = newName.substring(0, 50);

  const accounts = getAccounts();
  const index = accounts.findIndex(acc => acc.id === id);
  if (index !== -1) {
    accounts[index].name = safeName;
    writeConfig(accounts);
    mainWindow.webContents.send('account-updated', { id, newName: safeName });
  }
});

ipcMain.on('show-context-menu', (event, { id, name }) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (typeof id !== 'string' || typeof name !== 'string') return;
  const template = [
    {
      label: 'Rename Inbox',
      click: () => {
        const renameWin = new BrowserWindow({
          width: 450, height: 360, parent: mainWindow, modal: true,
          frame: false, transparent: true, backgroundColor: '#00000000',
          webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
          }
        });
        renameWin.loadFile(path.join(__dirname, '../renderer/pages/rename.html'), {
          query: { id: id, name: name }
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Delete Inbox',
      click: () => {
        const deleteWin = new BrowserWindow({
          width: 450, height: 360, parent: mainWindow, modal: true,
          frame: false, resizable: false, transparent: true,
          backgroundColor: '#00000000',
          webPreferences: { 
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
          }
        });
        deleteWin.loadFile(path.join(__dirname, '../renderer/pages/delete.html'), {
          query: { id: id, name: name }
        });
      }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('open-external', (event, urlString) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (typeof urlString !== 'string') return;
  try {
    const parsedUrl = new URL(urlString);
    if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
      shell.openExternal(urlString);
    } else {
      console.warn(`Blocked attempt to open unsafe protocol: ${parsedUrl.protocol}`);
    }
  } catch (e) {
    console.error('Invalid URL passed to open-external');
  }
});

ipcMain.on('load-mail', (event, id) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (typeof id !== 'string') return;
  Object.keys(views).forEach(vId => views[vId].setVisible(vId === id));
});

ipcMain.on('open-add-window', (event, isTutorial = false) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  const addWin = new BrowserWindow({
    width: 450, height: 500, parent: mainWindow, modal: true, 
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { 
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  addWin.loadFile(path.join(__dirname, '../renderer/pages/add.html'), {
    query: { tutorial: String(isTutorial) }
  });
});

ipcMain.on('open-delete-window', (event, { id, name }) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (typeof id !== 'string' || typeof name !== 'string') return;
  const deleteWin = new BrowserWindow({
    width: 450, height: 360, parent: mainWindow, modal: true,
    frame: false, resizable: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { 
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true, 
      nodeIntegration: false
    }
  });
  deleteWin.loadFile(path.join(__dirname, '../renderer/pages/delete.html'), {
    query: { id: id, name: name }
  });
});

ipcMain.on('delete-account', (event, id) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (typeof id !== 'string') return;
  const accounts = getAccounts();
  const updatedAccounts = accounts.filter(acc => acc.id !== id);
  writeConfig(updatedAccounts);
  if (views[id]) {
    mainWindow.contentView.removeChildView(views[id]);
    views[id].webContents.destroy();
    delete views[id];
  }
  mainWindow.webContents.send('account-deleted', id);
});

ipcMain.on('add-service', (event, data) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (!data || typeof data !== 'object') return;
  const { type, name } = data;
  try {
    const acc = saveAccount(type, name);
    createMailView(acc);
    mainWindow.webContents.send('new-account', acc);
  } catch (error) {
    console.error('Failed to add service:', error.message);
  }
});

ipcMain.on('update-response', (event, action) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (action === 'download') {
    autoUpdater.downloadUpdate().catch(err => {
      console.error('Update download failed:', err.message);
    });
  } else if (action === 'restart') {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.on('close-app', (event) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  app.quit();
});
ipcMain.on('minimize-app', (event) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  mainWindow?.minimize();
});
ipcMain.on('maximize-app', (event) => {
  if (!isTrustedSender(event.sender)) return; // SECURITY FIX: Validate sender
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

// --- 6. APP LIFECYCLE & GLOBAL SECURITY RESTRICTIONS ---
app.whenReady().then(() => {
  createWindow();
  
  // Check for updates but do not download automatically
  autoUpdater.autoDownload = false;
  autoUpdater.checkForUpdates();

  // TEMP TEST: Show the update window 2 seconds after launching
  setTimeout(() => showUpdateWindow('available', '2.0.0 (Test)'), 2000);
});

let updateWin = null;
function showUpdateWindow(state, version = '') {
  if (updateWin) return;
  updateWin = new BrowserWindow({
    width: 450, height: 360, parent: mainWindow, modal: true,
    frame: false, resizable: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { 
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  updateWin.loadFile(path.join(__dirname, '../renderer/pages/update.html'), {
    query: { state, version }
  });
  updateWin.on('closed', () => { updateWin = null; });
}

autoUpdater.on('update-available', (info) => {
  showUpdateWindow('available', info.version);
});

autoUpdater.on('update-downloaded', () => {
  showUpdateWindow('downloaded');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// SECURITY FIX: Global event listeners to catch and prevent unauthorized webviews/windows
app.on('web-contents-created', (event, contents) => {
  // Prevent <webview> tag creation globally
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Global window open fallback to deny all popups that somehow bypass the specific handlers
  contents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });
});