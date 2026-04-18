const { app, BrowserWindow, WebContentsView, session, shell, ipcMain, Menu, MenuItem } = require('electron');
// 1. GPU FIX (Keep this at the top)
app.disableHardwareAcceleration(); 

const path = require('path');
const fs = require('fs');
const windowStateKeeper = require('electron-window-state');

// --- 2. CONFIGURATION & STORAGE ---
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'accounts.json');

const SERVICE_MAP = {
  'gmail': { name: 'Gmail', url: 'https://mail.google.com', icon: 'mail' },
  'outlook': { name: 'Outlook/Hotmail', url: 'https://outlook.office.com/mail/', icon: 'alternate_email' },
  'icloud': { name: 'iCloud', url: 'https://www.icloud.com/mail/', icon: 'cloud' },
};

function getAccounts() {
  if (!fs.existsSync(configPath)) {
    const initial = [
      { id: 'gmail-default', type: 'gmail', ...SERVICE_MAP['gmail'] },
      { id: 'outlook-default', type: 'outlook', ...SERVICE_MAP['outlook'] }
    ];
    fs.writeFileSync(configPath, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(fs.readFileSync(configPath));
}

function saveAccount(serviceType, customName) {
  const accounts = getAccounts();
  const newAcc = { 
    id: `${serviceType}-${Date.now()}`, 
    type: serviceType, 
    name: customName, // Use the name from the user
    url: SERVICE_MAP[serviceType].url, 
    icon: SERVICE_MAP[serviceType].icon 
  };
  accounts.push(newAcc);
  fs.writeFileSync(configPath, JSON.stringify(accounts));
  return newAcc;
}

// --- 3. SECURITY WHITE-LIST ---
function isSafeUrl(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    if (parsedUrl.protocol !== 'https:') return false;
    const host = parsedUrl.hostname;

    return (
      // Google / Gmail Domains
      host === 'google.com' || host.endsWith('.google.com') ||
      host === 'gstatic.com' || host.endsWith('.gstatic.com') ||
      
      // Microsoft / Outlook / Hotmail Domains
      host === 'microsoft.com' || host.endsWith('.microsoft.com') ||
      host === 'office.com' || host.endsWith('.office.com') ||
      host === 'office365.com' || host.endsWith('.office365.com') ||
      host === 'live.com' || host.endsWith('.live.com') ||
      host === 'outlook.com' || host.endsWith('.outlook.com') ||
      host === 'microsoftonline.com' || host.endsWith('.microsoftonline.com') ||
      host === 'windows.net' || host.endsWith('.windows.net') ||
      host === 'msauth.net' || host.endsWith('.msauth.net') ||
      host === 'msauthimages.net' || host.endsWith('.msauthimages.net') ||
      
      // iCloud Domains
      host === 'icloud.com' || host.endsWith('.icloud.com') ||
      host === 'apple.com' || host.endsWith('.apple.com')
    );
  } catch (err) {
    return false; 
  }
}

// --- 4. GLOBAL PASSKEY / 1PASSWORD FIX ---
app.commandLine.appendSwitch('enable-web-authentication');
app.on('session-created', (ses) => {
  if (ses.setWebAuthnHandler) {
    ses.setWebAuthnHandler((details, callback) => {
      // 'conditional' is the "Autofill" request that triggers on page load.
      // We cancel it so you don't get an annoying popup the second the page opens.
      if (details.mediation === 'conditional') {
        callback({ action: 'cancel' });
      } else {
        // 'required' or 'optional' are usually triggered when YOU click a button.
        // We let these run so you can still log in manually.
        callback({ action: 'run' });
      }
    });
  }
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
    frame: false, backgroundColor: '#1c1c1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true }
  });
  state.manage(mainWindow);
  mainWindow.on('resize', updateViewBounds);

  const accounts = getAccounts();
  accounts.forEach(acc => createMailView(acc));

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init-accounts', accounts);
  });
}

function createMailView(acc) {
  const v = new WebContentsView({
    webPreferences: { 
      preload: path.join(__dirname, 'mail-preload.js'), 
      sandbox: false, 
      enableWebAuthn: true,
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
      
      // 1. Detect Logout/Signout keywords
      const isLoggingOut = lowerUrl.includes('logout') || lowerUrl.includes('signout');
      
      // 2. Detect the iCloud Dashboard (the main "Home" screen)
      // If we are at the root (/) of iCloud, we want to be at (/mail/)
      const isICloudHome = (parsed.hostname === 'www.icloud.com' && (parsed.pathname === '/' || parsed.pathname === '/setup/'));

      // 3. General landing pages for other services
      const isOtherLanding = 
        (parsed.hostname === 'www.google.com' && parsed.pathname === '/') ||
        (parsed.hostname === 'www.microsoft.com' && parsed.pathname === '/') ||
        (parsed.hostname === 'www.office.com' && parsed.pathname === '/');

      if (isLoggingOut || isICloudHome || isOtherLanding) {
        // If we are already on the correct account URL, don't loop
        if (url === acc.url) return;

        // Small delay to let the session finish clearing before we redirect
        setTimeout(() => {
          if (!v.webContents.isDestroyed()) {
            v.webContents.loadURL(acc.url);
          }
        }, 600);
      }
    } catch (e) {
      // Ignore URL parsing errors for non-standard strings
    }
  };

  // 'will-navigate' catches links you click
  v.webContents.on('will-navigate', (event, url) => {
    if (!isSafeUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    } else {
      checkLogout(url);
    }
  });

  // 'did-navigate' catches redirects (very important for iCloud logout)
  v.webContents.on('did-navigate', (event, url) => checkLogout(url));
  
  // 'did-frame-navigate' catches internal iCloud app switches
  v.webContents.on('did-frame-navigate', (event, url) => checkLogout(url));

  v.webContents.on('update-target-url', (e, url) => {
    mainWindow.webContents.send('hover-link', url);
  });

  updateViewBounds();
}

// --- 5. IPC HANDLERS ---
ipcMain.on('update-account-name', (event, { id, newName }) => {
  const accounts = getAccounts();
  const index = accounts.findIndex(acc => acc.id === id);
  if (index !== -1) {
    accounts[index].name = newName;
    fs.writeFileSync(configPath, JSON.stringify(accounts));
    mainWindow.webContents.send('account-updated', { id, newName });
  }
});

ipcMain.on('show-context-menu', (event, { id, name }) => {
  const template = [
    {
      label: 'Rename Inbox',
      click: () => {
        const renameWin = new BrowserWindow({
          width: 350, height: 250, parent: mainWindow, modal: true,
          frame: false, transparent: true, backgroundColor: '#00000000',
          webPreferences: { preload: path.join(__dirname, 'preload.js') }
        });
        renameWin.loadURL(`file://${path.join(__dirname, 'rename.html')}?id=${id}&name=${encodeURIComponent(name)}`);
      }
    },
    { type: 'separator' },
    {
      label: 'Delete Inbox',
      click: () => {
        // Your existing delete logic
        const deleteWin = new BrowserWindow({
          width: 400, height: 350, parent: mainWindow, modal: true,
          frame: false, resizable: false, transparent: true,
          backgroundColor: '#00000000',
          webPreferences: { preload: path.join(__dirname, 'preload.js') }
        });
        deleteWin.loadURL(`file://${path.join(__dirname, 'delete.html')}?id=${id}&name=${encodeURIComponent(name)}`);
      }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.on('load-mail', (e, id) => {
  Object.keys(views).forEach(vId => views[vId].setVisible(vId === id));
});

ipcMain.on('open-add-window', (event, isTutorial = false) => {
  const addWin = new BrowserWindow({
    width: 350, height: 500, parent: mainWindow, modal: true, 
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') } 
  });
  
  // We use loadURL instead of loadFile to send the ?tutorial=true flag
  const addPath = path.join(__dirname, 'add.html');
  addWin.loadURL(`file://${addPath}?tutorial=${isTutorial}`);
});

ipcMain.on('open-delete-window', (event, { id, name }) => {
  const deleteWin = new BrowserWindow({
    width: 400, height: 350, parent: mainWindow, modal: true,
    frame: false, resizable: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  deleteWin.loadURL(`file://${path.join(__dirname, 'delete.html')}?id=${id}&name=${encodeURIComponent(name)}`);
});

ipcMain.on('delete-account', (event, id) => {
  const accounts = getAccounts();
  const updatedAccounts = accounts.filter(acc => acc.id !== id);
  fs.writeFileSync(configPath, JSON.stringify(updatedAccounts));
  if (views[id]) {
    mainWindow.contentView.removeChildView(views[id]);
    views[id].webContents.destroy();
    delete views[id];
  }
  mainWindow.webContents.send('account-deleted', id);
});

ipcMain.on('add-service', (e, data) => {
  const { type, name } = data; // Receive the object from add.html
  const acc = saveAccount(type, name);
  createMailView(acc);
  mainWindow.webContents.send('new-account-added', acc);
});

ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-app', () => mainWindow.minimize());
ipcMain.on('maximize-app', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());

app.whenReady().then(createWindow);