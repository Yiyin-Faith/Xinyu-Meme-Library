const { app, BrowserWindow, ipcMain, clipboard, nativeImage, globalShortcut, dialog, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
let mainWindow;
let tray;
let quitting = false;
function showWindow() { if (!mainWindow) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 620, icon: path.join(__dirname, 'icon.png'), title: '心语表情库', backgroundColor: '#e9f0ea', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (event) => { if (!quitting && tray) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow.webContents.getURL()) event.preventDefault(); });
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
if (hasLock) app.whenReady().then(() => {
  ipcMain.handle('copy-image', (_event, bytes, mime) => { if (!Array.isArray(bytes) || bytes.length > 64 * 1024 * 1024 || mime !== 'image/png') throw new Error('无效图片'); const image = nativeImage.createFromBuffer(Buffer.from(bytes)); if (image.isEmpty()) throw new Error('无法读取图片'); clipboard.writeImage(image); return true; });
  ipcMain.handle('save-file', async (_event, bytes, suggestedName) => { const result = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters: [{ name: '心语表情库文件', extensions: [path.extname(suggestedName).replace('.', '') || '*'] }] }); if (result.canceled || !result.filePath) return false; await fs.writeFile(result.filePath, Buffer.from(bytes)); return true; });
  ipcMain.handle('app-info', () => ({ version: app.getVersion(), shortcut: globalShortcut.isRegistered('CommandOrControl+Shift+P') }));
  globalShortcut.register('CommandOrControl+Shift+P', () => { showWindow(); mainWindow?.webContents.send('quick-open'); });
  ipcMain.on('minimize', () => mainWindow?.minimize());
  ipcMain.on('close', () => mainWindow?.close());
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 }));
  tray.setToolTip('心语表情库 · Ctrl + Shift + P');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开心语表情库', click: showWindow }, { type: 'separator' }, { label: '退出', click: () => app.quit() }]));
  tray.on('click', showWindow);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { globalShortcut.unregisterAll(); if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
