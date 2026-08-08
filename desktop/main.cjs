'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
} = require('electron');
const packageMetadata = require('../package.json');
const { createDesktopUpdater } = require('./updater.cjs');
const {
  isAllowedAppUrl,
  isSafeExternalUrl,
  isSteamDistribution,
  selectDesktopServeMode,
} = require('./runtime.cjs');

const PRODUCT_NAME = 'Darkwind';
const DEFAULT_BOUNDS = { width: 1440, height: 900 };
const DEFAULT_DESKTOP_PORT = 47831;
const smokeTest = process.argv.includes('--smoke-test');
const steamDistribution = isSteamDistribution({
  distribution: packageMetadata.darkflowDistribution,
});
const desktopServeMode = selectDesktopServeMode({
  isPackaged: app.isPackaged,
});
const clientRoot = path.join(
  __dirname,
  '..',
  ...(desktopServeMode === 'built' ? ['dist', 'client'] : ['public']),
);
const windowIconPath = path.join(clientRoot, 'assets', 'brand', 'darkflow-icon-512.png');

let appOrigin = '';
let desktopToken = '';
let mainWindow = null;
let stopLocalServer = null;
let updater = null;
let smokeDiagnostics = null;

app.setName(PRODUCT_NAME);
app.setAppUserModelId('ai.darkwind.game');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch((error) => {
    console.error('[desktop] startup failed:', error);
    const detail = error.code === 'EADDRINUSE'
      ? `Local port ${requestedDesktopPort()} is already in use. Close the conflicting application or set DARKFLOW_DESKTOP_PORT to another stable port.`
      : error.message;
    dialog.showErrorBox('Darkwind could not start', detail);
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow && appOrigin) {
      createMainWindow().catch((error) => {
        console.error('[desktop] window creation failed:', error);
      });
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (updater) updater.stop();
    if (stopLocalServer) stopLocalServer().catch((error) => {
      console.error('[desktop] local server shutdown failed:', error);
    });
  });
}

async function startDesktopApp() {
  configureDesktopEnvironment();

  const { startServer, stopServer } = require('../server.js');
  const address = await startServer({
    port: requestedDesktopPort(),
    host: '127.0.0.1',
    mode: desktopServeMode,
  });
  if (!address || typeof address !== 'object') {
    throw new Error('The local Darkflow server did not return a TCP address.');
  }

  appOrigin = `http://127.0.0.1:${address.port}`;
  stopLocalServer = stopServer;

  updater = createDesktopUpdater({
    enabled: app.isPackaged && !steamDistribution,
    platform: process.platform,
    openExternal,
    sendStatus: sendUpdateStatus,
  });

  registerIpcHandlers();
  createApplicationMenu();
  await createMainWindow();
  updater.initialize();
}

function configureDesktopEnvironment() {
  process.env.MCP_ENABLED = '0';
  process.env.DARKFLOW_DESKTOP = '1';
  desktopToken = crypto.randomBytes(32).toString('hex');
  process.env.DARKFLOW_DESKTOP_TOKEN = desktopToken;
  process.env.DARKFLOW_LOG_DIR = path.join(app.getPath('userData'), 'logs');
  if (smokeTest) process.env.MUD_HOST = '';
  else if (!process.env.MUD_HOST) process.env.MUD_HOST = 'darkwind.ai';
  if (!process.env.MUD_PORT) process.env.MUD_PORT = '4242';
  if (!process.env.MUD_WSS) process.env.MUD_WSS = '1';
  if (!process.env.GAME_NAME) process.env.GAME_NAME = PRODUCT_NAME;
}

function requestedDesktopPort() {
  if (process.env.DARKFLOW_DESKTOP_PORT !== undefined) {
    const configured = Number.parseInt(process.env.DARKFLOW_DESKTOP_PORT, 10);
    if (Number.isInteger(configured) && configured >= 0 && configured <= 65535) return configured;
    throw new Error('DARKFLOW_DESKTOP_PORT must be an integer from 0 through 65535.');
  }
  return smokeTest ? 0 : DEFAULT_DESKTOP_PORT;
}

async function createMainWindow() {
  const savedState = readWindowState();
  const bounds = visibleBounds(savedState && savedState.bounds)
    ? savedState.bounds
    : DEFAULT_BOUNDS;

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: '#0d1117',
    icon: windowIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });

  if (savedState && savedState.maximized) mainWindow.maximize();

  const localSession = mainWindow.webContents.session;
  const permissionAllowed = (webContents, permission) => (
    mainWindow && !mainWindow.isDestroyed()
    && webContents === mainWindow.webContents
    && permission === 'fullscreen'
  );
  localSession.setPermissionCheckHandler(permissionAllowed);
  localSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permissionAllowed(webContents, permission));
  });
  await localSession.cookies.set({
    url: appOrigin,
    name: 'darkflow-desktop-token',
    value: desktopToken,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
  if (smokeTest) smokeDiagnostics = monitorSmokeFailures(localSession);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, details) => {
    const targetUrl = typeof details === 'string' ? details : details && details.url;
    if (isAllowedAppUrl(targetUrl, appOrigin)) return;
    event.preventDefault();
    openExternal(targetUrl);
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  if (smokeTest) mainWindow.webContents.once('did-finish-load', runSmokeTest);
  mainWindow.on('close', saveWindowState);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`${appOrigin}/`);
}

async function runSmokeTest() {
  try {
    const localSession = mainWindow.webContents.session;

    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const fetchResult = async (url, responseType = null) => {
        const response = await fetch(url);
        return {
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          body: responseType === 'json' ? await response.json() : null,
        };
      };
      const desktopApi = window.darkflowDesktop;
      const desktopApiKeys = Object.keys(desktopApi).sort();
      const info = await window.darkflowDesktop.getInfo();
      const configResponse = await fetchResult('/config.json', 'json');
      const versionResponse = await fetchResult('/api/version', 'json');
      return {
        title: document.title,
        desktopApi: Boolean(desktopApi),
        desktopApiFrozen: Object.isFrozen(desktopApi),
        desktopApiKeys,
        desktopApiFunctions: desktopApiKeys.every((key) => typeof desktopApi[key] === 'function'),
        desktopCookieVisible: document.cookie.includes('darkflow-desktop-token='),
        howler: typeof window.Howl === 'function' && Boolean(window.Howler),
        info,
        config: configResponse,
        version: versionResponse,
        howlerRoute: await fetchResult('/vendor/howler.core.min.js'),
        icon: await fetchResult('/assets/brand/darkflow-icon-512.png'),
        phase0: await fetchResult('/phase0/'),
      };
    })()`);

    const phase0Source = await fetchDesktopRoute('/phase0/main.ts');
    const viteClient = await fetchDesktopRoute('/@vite/client');
    const cookies = await localSession.cookies.get({
      url: appOrigin,
      name: 'darkflow-desktop-token',
    });
    const expectedDistribution = steamDistribution
      ? 'steam'
      : (app.isPackaged ? 'direct' : 'development');
    const expectedUpdateState = app.isPackaged && !steamDistribution ? 'idle' : 'disabled';
    const expectedDesktopApiKeys = [
      'checkForUpdates',
      'getInfo',
      'installUpdate',
      'onUpdateStatus',
    ];
    const icon = nativeImage.createFromPath(windowIconPath);

    Object.assign(result, {
      serveMode: desktopServeMode,
      cookieCount: cookies.length,
      cookieHttpOnly: cookies.length === 1 && cookies[0].httpOnly,
      nativeIcon: !icon.isEmpty(),
      phase0Source,
      viteClient,
      ...smokeDiagnostics,
    });

    if (desktopServeMode !== 'built'
        || !result.desktopApi
        || !result.desktopApiFrozen
        || !result.desktopApiFunctions
        || JSON.stringify(result.desktopApiKeys) !== JSON.stringify(expectedDesktopApiKeys)
        || result.desktopCookieVisible
        || result.cookieCount !== 1
        || !result.cookieHttpOnly
        || !result.howler
        || !result.nativeIcon
        || result.info.productName !== PRODUCT_NAME
        || result.info.version !== packageMetadata.version
        || result.info.platform !== process.platform
        || result.info.distribution !== expectedDistribution
        || result.info.updateStatus.state !== expectedUpdateState
        || result.config.status !== 200
        || result.config.body.host !== ''
        || result.config.body.port !== 4242
        || result.config.body.wss !== true
        || result.config.body.gameName !== PRODUCT_NAME
        || result.version.status !== 200
        || result.version.body.version !== packageMetadata.version
        || result.howlerRoute.status !== 200
        || !/javascript/.test(result.howlerRoute.contentType)
        || result.icon.status !== 200
        || !/image\/png/.test(result.icon.contentType)
        || result.phase0.status !== 200
        || result.phase0Source.status !== 404
        || result.viteClient.status !== 404
        || smokeDiagnostics.consoleFailures.length
        || smokeDiagnostics.pageFailures.length
        || smokeDiagnostics.requestFailures.length
        || smokeDiagnostics.websocketRequests.length) {
      throw new Error(`Unexpected smoke-test state: ${JSON.stringify(result)}`);
    }
    console.log('[desktop-smoke]', JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    console.error('[desktop-smoke] failed:', error);
    app.exit(1);
  }
}

async function fetchDesktopRoute(route) {
  const response = await fetch(new URL(route, appOrigin), {
    headers: { Cookie: `darkflow-desktop-token=${desktopToken}` },
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
  };
}

function monitorSmokeFailures(localSession) {
  const diagnostics = {
    consoleFailures: [],
    pageFailures: [],
    requestFailures: [],
    websocketRequests: [],
  };

  mainWindow.webContents.on('console-message', (event) => {
    const level = event.level;
    const text = event.message;
    if (level === 'error' || level === 3) diagnostics.consoleFailures.push(String(text));
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    diagnostics.pageFailures.push({ errorCode, errorDescription, url: validatedUrl });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.pageFailures.push({ reason: details.reason, exitCode: details.exitCode });
  });
  localSession.webRequest.onErrorOccurred((details) => {
    if (new URL(details.url).origin === appOrigin) {
      diagnostics.requestFailures.push({ error: details.error, method: details.method, url: details.url });
    }
  });
  localSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === 'webSocket') diagnostics.websocketRequests.push(details.url);
    callback({});
  });

  return diagnostics;
}

function createApplicationMenu() {
  let updateItem;
  if (steamDistribution) {
    updateItem = { label: 'Updates Managed by Steam', enabled: false };
  } else if (!app.isPackaged) {
    updateItem = { label: 'Updates Available in Packaged Builds', enabled: false };
  } else {
    updateItem = {
      label: 'Check for Updates...',
      click: () => updater && updater.check({ manual: true }),
    };
  }

  const template = [];
  if (process.platform === 'darwin') {
    template.push({
      label: PRODUCT_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: 'File',
      submenu: [
        updateItem,
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Darkflow Website',
          click: () => openExternal('https://play.darkwind.ai/'),
        },
      ],
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  ipcMain.handle('desktop:get-info', (event) => {
    assertTrustedSender(event);
    return {
      productName: PRODUCT_NAME,
      version: app.getVersion(),
      platform: process.platform,
      distribution: steamDistribution ? 'steam' : (app.isPackaged ? 'direct' : 'development'),
      updateStatus: updater.getStatus(),
    };
  });
  ipcMain.handle('desktop:check-for-updates', (event) => {
    assertTrustedSender(event);
    return updater.check({ manual: true });
  });
  ipcMain.handle('desktop:install-update', (event) => {
    assertTrustedSender(event);
    return updater.install();
  });
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
  if (!mainWindow || event.sender !== mainWindow.webContents || !isAllowedAppUrl(senderUrl, appOrigin)) {
    throw new Error('Rejected desktop IPC from an untrusted renderer.');
  }
}

function sendUpdateStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:update-status', status);
}

function openExternal(url) {
  if (!isSafeExternalUrl(url)) return Promise.resolve(false);
  return shell.openExternal(url).then(() => true).catch((error) => {
    console.error('[desktop] failed to open external URL:', error);
    return false;
  });
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
  } catch (error) {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = {
    bounds: mainWindow.getNormalBounds(),
    maximized: mainWindow.isMaximized(),
  };
  try {
    fs.writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch (error) {
    console.error('[desktop] failed to save window state:', error);
  }
}

function visibleBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
      || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return false;
  }

  return screen.getAllDisplays().some(({ workArea }) => (
    bounds.x < workArea.x + workArea.width
    && bounds.x + bounds.width > workArea.x
    && bounds.y < workArea.y + workArea.height
    && bounds.y + bounds.height > workArea.y
  ));
}
