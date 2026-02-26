const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");

let mainWindow = null;
let quitting = false;
let redirectController = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("focusguard:open-redirect", async () => {
    return redirectController.openRedirect();
  });

  ipcMain.handle("focusguard:close-redirect", async () => {
    return redirectController.closeRedirect();
  });

  ipcMain.handle("focusguard:get-redirect-state", async () => {
    return redirectController.getRedirectState();
  });
}

async function shutdownRedirectWindow() {
  if (!redirectController) {
    return;
  }
  try {
    await redirectController.closeRedirect();
  } catch {
    // ignore close failures during app shutdown
  }
}

async function buildRedirectController() {
  const modulePath = pathToFileURL(path.join(__dirname, "..", "src", "redirectControl.js")).href;
  const { createRedirectController } = await import(modulePath);
  return createRedirectController({
    appDataPath: app.getPath("userData"),
    openExternal: (url) => shell.openExternal(url),
  });
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
}

app.whenReady().then(async () => {
  redirectController = await buildRedirectController();
  registerIpc();

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === "media" || permission === "camera" || permission === "microphone") {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "camera" || permission === "microphone";
  });

  createWindow();

  app.on("activate", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", async (event) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  await shutdownRedirectWindow();
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
