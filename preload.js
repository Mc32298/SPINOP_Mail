const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mailAPI', {
  loadMail: (id) => ipcRenderer.send('load-mail', id),
  openAddWindow: (isTutorial) => ipcRenderer.send('open-add-window', isTutorial),
  openDeleteWindow: (data) => ipcRenderer.send('open-delete-window', data),
  addService: (service) => ipcRenderer.send('add-service', service),
  deleteAccount: (id) => ipcRenderer.send('delete-account', id),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  updateAccountName: (data) => ipcRenderer.send('update-account-name', data),
  onAccountUpdated: (cb) => ipcRenderer.on('account-updated', (e, data) => cb(data)),
  
  closeApp: () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  maximizeApp: () => ipcRenderer.send('maximize-app'),
  
  onInitAccounts: (cb) => ipcRenderer.on('init-accounts', (e, accs) => cb(accs)),
  onNewAccount: (cb) => ipcRenderer.on('new-account-added', (e, acc) => cb(acc)),
  onAccountDeleted: (cb) => ipcRenderer.on('account-deleted', (e, id) => cb(id)),
  onHoverLink: (callback) => ipcRenderer.on('hover-link', (_event, url) => callback(url))
})