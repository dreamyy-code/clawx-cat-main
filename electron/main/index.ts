/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, Notification, session, shell } from 'electron';
import { join } from 'path';
import { hostname } from 'os';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray, getTrayLabels } from './tray';
import { createMenu } from './menu';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { initTelemetry } from '../utils/telemetry';

import { ClawHubService } from '../gateway/clawhub';
import { isQuitting, setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import {
  clearPendingSecondInstanceFocus,
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from './main-window-focus';
import {
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from './quit-lifecycle';
import { createSignalQuitHandler } from './signal-quit';
import { acquireProcessInstanceFileLock } from './process-instance-lock';
import { getWindowState, trackWindowState } from './window';
import { HostEventBus } from '../api/event-bus';
import { RuntimeFacade } from '../runtime/runtime-facade';
import { BridgeServer } from '../bridge/server';
import { HttpBridgeServer } from '../bridge/http-server';
import { BridgeEventRelay } from '../bridge/event-relay';
import { LanDiscoveryService } from '../bridge/lan-discovery';
import { CloudRelayClient } from '../relay/client';
import { getAllSettings, getSetting, setSetting, type AppSettings } from '../utils/store';
import type {
  BridgeDiscoveryStatus,
  BridgeManagerApi,
  BridgeRelayStatus,
  BridgeRuntimeStatus,
} from '../api/context';

const WINDOWS_APP_USER_MODEL_ID = 'app.clawx.desktop';
const isE2EMode = process.env.CLAWX_E2E === '1';
const requestedUserDataDir = process.env.CLAWX_USER_DATA_DIR?.trim();
type LaunchMode = 'gui' | 'headless';

function resolveLaunchMode(): LaunchMode {
  if (process.env.CLAWX_HEADLESS === '1') {
    return 'headless';
  }
  if (process.argv.includes('--clawx-headless') || process.argv.includes('--headless')) {
    return 'headless';
  }
  return 'gui';
}

const launchMode = resolveLaunchMode();
const isHeadlessMode = launchMode === 'headless';
const bridgeEnabledFromCli = process.argv.includes('--bridge');

type ResolvedBridgeConfig = {
  enabled: boolean;
  port: number;
  host: string;
  token: string;
  httpEnabled: boolean;
  httpPort: number;
  httpToken: string;
  allowRemote: boolean;
  discoveryEnabled: boolean;
  discoveryPort: number;
  discoveryName: string;
  relayEnabled: boolean;
  relayUrl: string;
  relayToken: string;
};

if (isE2EMode && requestedUserDataDir) {
  app.setPath('userData', requestedUserDataDir);
}

// Disable GPU hardware acceleration globally for maximum stability across
// all GPU configurations (no GPU, integrated, discrete).
//
// Rationale (following VS Code's philosophy):
// - Page/file loading is async data fetching — zero GPU dependency.
// - The original per-platform GPU branching was added to avoid CPU rendering
//   competing with sync I/O on Windows, but all file I/O is now async
//   (fs/promises), so that concern no longer applies.
// - Software rendering is deterministic across all hardware; GPU compositing
//   behaviour varies between vendors (Intel, AMD, NVIDIA, Apple Silicon) and
//   driver versions, making it the #1 source of rendering bugs in Electron.
//
// Users who want GPU acceleration can pass `--enable-gpu` on the CLI or
// set `"disable-hardware-acceleration": false` in the app config (future).
app.disableHardwareAcceleration();

// On Linux, set CHROME_DESKTOP so Chromium can find the correct .desktop file.
// On Wayland this maps the running window to clawx.desktop (→ icon + app grouping);
// on X11 it supplements the StartupWMClass matching.
// Must be called before app.whenReady() / before any window is created.
if (process.platform === 'linux') {
  app.setDesktopName('clawx.desktop');
}

// Prevent multiple instances of the app from running simultaneously.
// Without this, two instances each spawn their own gateway process on the
// same port, then each treats the other's gateway as "orphaned" and kills
// it — creating an infinite kill/restart loop on Windows.
// The losing process must exit immediately so it never reaches Gateway startup.
const gotElectronLock = isE2EMode ? true : app.requestSingleInstanceLock();
if (!gotElectronLock) {
  console.info('[ClawX] Another instance already holds the single-instance lock; exiting duplicate process');
  app.exit(0);
}
let releaseProcessInstanceFileLock: () => void = () => {};
let gotFileLock = true;
if (gotElectronLock && !isE2EMode) {
  try {
    const fileLock = acquireProcessInstanceFileLock({
      userDataDir: app.getPath('userData'),
      lockName: 'clawx',
      force: true, // Electron lock already guarantees exclusivity; force-clean orphan/recycled-PID locks
    });
    gotFileLock = fileLock.acquired;
    releaseProcessInstanceFileLock = fileLock.release;
    if (!fileLock.acquired) {
      const ownerDescriptor = fileLock.ownerPid
        ? `${fileLock.ownerFormat ?? 'legacy'} pid=${fileLock.ownerPid}`
        : fileLock.ownerFormat === 'unknown'
          ? 'unknown lock format/content'
          : 'unknown owner';
      console.info(
        `[ClawX] Another instance already holds process lock (${fileLock.lockPath}, ${ownerDescriptor}); exiting duplicate process`,
      );
      app.exit(0);
    }
  } catch (error) {
    console.warn('[ClawX] Failed to acquire process instance file lock; continuing with Electron single-instance lock only', error);
  }
}
const gotTheLock = gotElectronLock && gotFileLock;

// Global references
let mainWindow: BrowserWindow | null = null;
let runtimeFacade!: RuntimeFacade;
let gatewayManager!: GatewayManager;
let clawHubService!: ClawHubService;
let hostEventBus!: HostEventBus;
let bridgeServer: BridgeServer | null = null;
let httpBridgeServer: HttpBridgeServer | null = null;
let bridgeEventRelay!: BridgeEventRelay;
let lanDiscoveryService: LanDiscoveryService | null = null;
let cloudRelayClient: CloudRelayClient | null = null;
let lastResolvedBridgeConfig: ResolvedBridgeConfig | null = null;
const mainWindowFocusState = createMainWindowFocusState();
const quitLifecycleState = createQuitLifecycleState();

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
async function createWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;
  const shouldSkipSetupForE2E = process.env.CLAWX_E2E_SKIP_SETUP === '1';
  const windowState = await getWindowState().catch((error) => {
    logger.warn('Failed to restore saved window state; using defaults', error);
    return {
      width: 1280,
      height: 800,
      isMaximized: false,
    };
  });

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 960,
    minHeight: 600,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : useCustomTitleBar ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac || !useCustomTitleBar,
    show: false,
  });
  trackWindowState(win);

  if (windowState.isMaximized) {
    win.maximize();
  }

  // Handle external links — only allow safe protocols to prevent arbitrary
  // command execution via shell.openExternal() (e.g. file://, ms-msdt:, etc.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      } else {
        logger.warn(`Blocked openExternal for disallowed protocol: ${parsed.protocol}`);
      }
    } catch {
      logger.warn(`Blocked openExternal for malformed URL: ${url}`);
    }
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    if (shouldSkipSetupForE2E) {
      rendererUrl.searchParams.set('e2eSkipSetup', '1');
    }
    win.loadURL(rendererUrl.toString());
    if (!isE2EMode) {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'), {
      query: shouldSkipSetupForE2E
        ? { e2eSkipSetup: '1' }
        : undefined,
    });
  }

  return win;
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearPendingSecondInstanceFocus(mainWindowFocusState);
  focusWindow(mainWindow);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = await createWindow();
  let rendererRecoveryAttempted = false;
  let showFallbackTimer: NodeJS.Timeout | null = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      logger.warn('Main window did not emit ready-to-show in time; forcing window visible');
      win.show();
    }
  }, 4000);

  const clearShowFallbackTimer = (): void => {
    if (!showFallbackTimer) {
      return;
    }
    clearTimeout(showFallbackTimer);
    showFallbackTimer = null;
  };

  win.once('ready-to-show', () => {
    clearShowFallbackTimer();
    if (mainWindow !== win) {
      return;
    }

    const action = consumeMainWindowReady(mainWindowFocusState);
    if (action === 'focus') {
      focusWindow(win);
      return;
    }

    win.show();
  });

  win.webContents.on('did-finish-load', () => {
    clearShowFallbackTimer();
    if (mainWindow !== win || win.isDestroyed() || win.isVisible()) {
      return;
    }
    logger.info('Main window finished loading before ready-to-show; forcing window visible');
    win.show();
  });

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      clearShowFallbackTimer();
      logger.error(
        `Main window failed to load (code=${errorCode}, mainFrame=${isMainFrame}, url=${validatedURL || 'unknown'}): ${errorDescription}`,
      );
      if (isMainFrame && !win.isDestroyed()) {
        win.show();
      }
    },
  );

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(
      `Main window render process gone (reason=${details.reason}, exitCode=${details.exitCode})`,
    );
    if (mainWindow !== win || isQuitting()) {
      return;
    }

    if (!rendererRecoveryAttempted && !win.isDestroyed()) {
      rendererRecoveryAttempted = true;
      logger.warn('Attempting to recover the main window after renderer process exit');
      win.show();
      win.webContents.reloadIgnoringCache();
      return;
    }

    void ensureMainWindowAvailable('renderer process recovery');
  });

  win.on('unresponsive', () => {
    logger.warn('Main window became unresponsive');
  });

  win.on('close', (event) => {
    if (isQuitting() || isE2EMode) {
      return;
    }

    event.preventDefault();

    void (async () => {
      const closeToTrayOnClose = await getSetting('closeToTrayOnClose').catch(() => true);
      if (!closeToTrayOnClose) {
        setQuitting();
        win.close();
        return;
      }

      win.hide();

      const showCloseToTrayTip = await getSetting('showCloseToTrayTip').catch(() => true);
      const hasSeenTip = await getSetting('hasSeenCloseToTrayTip').catch(() => true);
      if (!showCloseToTrayTip || hasSeenTip) {
        return;
      }

      const language = await getSetting('language').catch(() => 'en');
      const labels = getTrayLabels(typeof language === 'string' ? language : 'en');
      if (Notification.isSupported()) {
        new Notification({
          title: labels.hiddenTitle,
          body: labels.hiddenBody,
          silent: true,
        }).show();
      }
      await setSetting('hasSeenCloseToTrayTip', true).catch(() => {});
    })();
  });

  win.on('closed', () => {
    clearShowFallbackTimer();
    if (mainWindow === win) {
      mainWindow = null;
    }
    if (launchMode === 'gui' && !isQuitting()) {
      void ensureMainWindowAvailable('unexpected main window close');
    }
  });

  mainWindow = win;
  return win;
}

async function ensureMainWindowAvailable(reason: string): Promise<BrowserWindow | null> {
  if (launchMode !== 'gui') {
    return null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      logger.warn(`Showing hidden main window after ${reason}`);
      mainWindow.show();
    }
    focusWindow(mainWindow);
    return mainWindow;
  }

  if (!app.isReady()) {
    logger.warn(`Cannot create main window after ${reason} because app is not ready yet`);
    return null;
  }

  try {
    logger.warn(`Creating fallback main window after ${reason}`);
    const window = await createMainWindow();
    runtimeFacade.setMainWindow(window);
    return window;
  } catch (error) {
    logger.error(`Failed to create fallback main window after ${reason}:`, error);
    return null;
  }
}

async function runBestEffortStartupStep(
  label: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    logger.warn(`${label} failed during startup; continuing`, error);
  }
}

async function resolveBridgeConfigFromSettings(settings?: AppSettings): Promise<ResolvedBridgeConfig> {
  const resolvedSettings = settings || await getAllSettings();
  const envBridge = process.env.CLAWX_BRIDGE?.trim();
  const forceBridgeOnLinux = process.platform === 'linux';
  const relayEnabled = resolvedSettings.bridgeRelayEnabled && Boolean(resolvedSettings.bridgeRelayUrl.trim());
  const enabled = envBridge === '0'
    ? forceBridgeOnLinux
    : (forceBridgeOnLinux || envBridge === '1' || bridgeEnabledFromCli || isHeadlessMode || resolvedSettings.bridgeEnabled || relayEnabled);
  // LAN discovery must expose a reachable bridge host; otherwise the app can
  // discover the device but still fail to connect from the same network.
  const allowRemote = forceBridgeOnLinux
    || isHeadlessMode
    || resolvedSettings.bridgeAllowRemote
    || resolvedSettings.bridgeDiscoveryEnabled;
  const host = process.env.CLAWX_BRIDGE_HOST?.trim()
    || (allowRemote ? '0.0.0.0' : '127.0.0.1');
  const port = Number.isFinite(Number(process.env.CLAWX_BRIDGE_PORT))
    && Number(process.env.CLAWX_BRIDGE_PORT) > 0
    ? Number(process.env.CLAWX_BRIDGE_PORT)
    : resolvedSettings.bridgePort;
  const token = process.env.CLAWX_BRIDGE_TOKEN?.trim()
    || resolvedSettings.bridgeToken
    || String(await getSetting('gatewayToken'));
  const envHttpBridge = process.env.CLAWX_BRIDGE_HTTP?.trim();
  const httpEnabled = envHttpBridge === '1' || resolvedSettings.bridgeHttpEnabled;
  const httpPort = Number.isFinite(Number(process.env.CLAWX_BRIDGE_HTTP_PORT))
    && Number(process.env.CLAWX_BRIDGE_HTTP_PORT) > 0
    ? Number(process.env.CLAWX_BRIDGE_HTTP_PORT)
    : resolvedSettings.bridgeHttpPort;
  const httpToken = process.env.CLAWX_BRIDGE_HTTP_TOKEN?.trim()
    || resolvedSettings.bridgeHttpToken
    || token;

  return {
    enabled,
    port,
    host,
    token,
    httpEnabled,
    httpPort,
    httpToken,
    allowRemote,
    discoveryEnabled: forceBridgeOnLinux ? true : resolvedSettings.bridgeDiscoveryEnabled,
    discoveryPort: resolvedSettings.bridgeDiscoveryPort,
    discoveryName: resolvedSettings.bridgeDiscoveryName.trim() || 'ClawX-Cat',
    relayEnabled,
    relayUrl: resolvedSettings.bridgeRelayUrl.trim(),
    relayToken: resolvedSettings.bridgeRelayToken.trim(),
  };
}

function buildDiscoveryStatus(config: ResolvedBridgeConfig): BridgeDiscoveryStatus {
  return lanDiscoveryService?.getStatus() || {
    enabled: config.discoveryEnabled,
    running: false,
    port: config.discoveryPort,
    serviceName: config.discoveryName,
    addresses: [],
  };
}

function buildRelayStatus(config: ResolvedBridgeConfig): BridgeRelayStatus {
  return cloudRelayClient?.getStatus() || {
    enabled: config.relayEnabled,
    running: false,
    connected: false,
    url: config.relayUrl || undefined,
    deviceId: undefined,
    deviceName: config.discoveryName || hostname(),
    reconnectAttempts: 0,
  };
}

function publishBridgeStatus(config: ResolvedBridgeConfig): BridgeRuntimeStatus {
  lastResolvedBridgeConfig = config;
  const status = {
    ...buildBridgeStatus(config),
  };
  runtimeFacade.setBridgeStatus(status);
  hostEventBus.emit('bridge:status', status);
  hostEventBus.emit('bridge:discovery', status.discovery || null);
  hostEventBus.emit('bridge:relay', status.relay || null);
  hostEventBus.emit('bridge:http.status', status.http || null);
  return status;
}

function buildBridgeStatus(config: ResolvedBridgeConfig): BridgeRuntimeStatus {
  const recentClients = bridgeServer?.getClientSnapshot() || [];
  const recentHttpClients = httpBridgeServer?.getClientSnapshot() || [];
  return {
    enabled: config.enabled,
    running: Boolean(bridgeServer),
    mode: launchMode,
    host: config.host,
    port: config.port,
    allowRemote: config.allowRemote,
    hasToken: Boolean(config.token),
    clientCount: recentClients.length,
    recentClients,
    discovery: buildDiscoveryStatus(config),
    relay: buildRelayStatus(config),
    http: {
      enabled: config.httpEnabled,
      running: Boolean(httpBridgeServer),
      host: config.host,
      port: config.httpPort,
      hasToken: Boolean(config.httpToken),
      clientCount: recentHttpClients.length,
      recentClients: recentHttpClients,
    },
  };
}

function stopLanDiscoveryService(): void {
  lanDiscoveryService?.close();
  lanDiscoveryService = null;
}

function stopCloudRelayClient(): void {
  cloudRelayClient?.stop();
  cloudRelayClient = null;
}

function startLanDiscoveryService(config: ResolvedBridgeConfig): void {
  stopLanDiscoveryService();
  if (!config.enabled || !config.discoveryEnabled) {
    return;
  }

  lanDiscoveryService = new LanDiscoveryService({
    enabled: config.discoveryEnabled,
    port: config.discoveryPort,
    serviceName: config.discoveryName,
    getAnnouncement: () => ({
      app: 'clawx',
      version: app.getVersion(),
      mode: launchMode,
      bridge: {
        host: config.host,
        port: config.port,
        allowRemote: config.allowRemote,
        hasToken: Boolean(config.token),
      },
    }),
    onStatusChange: () => {
      if (lastResolvedBridgeConfig) {
        publishBridgeStatus(lastResolvedBridgeConfig);
      }
    },
  });
  lanDiscoveryService.start();
}

function startCloudRelayClient(config: ResolvedBridgeConfig): void {
  stopCloudRelayClient();
  if (!config.relayEnabled || !config.relayUrl) {
    return;
  }

  const deviceId = `clawx-${hostname().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'device'}`;
  cloudRelayClient = new CloudRelayClient({
    enabled: true,
    relayUrl: config.relayUrl,
    relayToken: config.relayToken,
    deviceId,
    deviceName: config.discoveryName || hostname(),
    getBridgeStatus: () => runtimeFacade.getBridgeStatus(),
    getBridgeToken: () => config.token,
    getCapabilities: () => runtimeFacade.getCapabilities(),
    onStatusChange: () => {
      if (lastResolvedBridgeConfig) {
        publishBridgeStatus(lastResolvedBridgeConfig);
      }
    },
  });
  cloudRelayClient.start();
}

async function stopBridgeServer(): Promise<BridgeRuntimeStatus> {
  const config = await resolveBridgeConfigFromSettings();
  stopCloudRelayClient();
  stopLanDiscoveryService();
  bridgeServer?.close();
  bridgeServer = null;
  httpBridgeServer?.close();
  httpBridgeServer = null;
  return publishBridgeStatus({ ...config, enabled: config.enabled });
}

async function startBridgeServer(force = false): Promise<BridgeRuntimeStatus> {
  const config = await resolveBridgeConfigFromSettings();
  if (!config.enabled && !config.httpEnabled) {
    stopCloudRelayClient();
    stopLanDiscoveryService();
    bridgeServer?.close();
    bridgeServer = null;
    httpBridgeServer?.close();
    httpBridgeServer = null;
    return publishBridgeStatus(config);
  }

  if (config.enabled) {
    if (!bridgeServer || force) {
      bridgeServer?.close();
      bridgeServer = new BridgeServer({
        runtimeFacade,
        relay: bridgeEventRelay,
        mode: launchMode,
        host: config.host,
        port: config.port,
        token: config.token,
      });
      logger.info(`Bridge token ready (length=${config.token.length})`);
    }
    startLanDiscoveryService(config);
    startCloudRelayClient(config);
  } else {
    stopCloudRelayClient();
    stopLanDiscoveryService();
    bridgeServer?.close();
    bridgeServer = null;
  }

  if (config.httpEnabled) {
    if (!httpBridgeServer || force) {
      httpBridgeServer?.close();
      httpBridgeServer = new HttpBridgeServer({
        runtimeFacade,
        relay: bridgeEventRelay,
        mode: launchMode,
        host: config.host,
        port: config.httpPort,
        token: config.httpToken,
      });
      logger.info(`HTTP Bridge token ready (length=${config.httpToken.length})`);
    }
  } else {
    httpBridgeServer?.close();
    httpBridgeServer = null;
  }

  return publishBridgeStatus(config);
}

async function restartBridgeServer(): Promise<BridgeRuntimeStatus> {
  await stopBridgeServer();
  return await startBridgeServer(true);
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== ClawX Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, pid=${process.pid}, ppid=${process.ppid}`
  );

  if (!isE2EMode) {
    // Warm up network optimization (non-blocking)
    void warmupNetworkOptimization();

    // Initialize Telemetry early
    await runBestEffortStartupStep('Telemetry initialization', async () => {
      await initTelemetry();
    });

    // Apply persisted proxy settings before creating windows or network requests.
    await runBestEffortStartupStep('Electron proxy initialization', async () => {
      await applyProxySettings();
    });
    await runBestEffortStartupStep('Launch-at-startup synchronization', async () => {
      await syncLaunchAtStartupSettingFromStore();
    });
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  const bridgeManagerApi: BridgeManagerApi = {
    getStatus: async () => {
      const config = await resolveBridgeConfigFromSettings();
      const status = { ...buildBridgeStatus(config), running: Boolean(bridgeServer) };
      runtimeFacade.setBridgeStatus(status);
      return status;
    },
    getConfig: async () => {
      const settings = await getAllSettings();
      const config = await resolveBridgeConfigFromSettings(settings);
      return {
        enabled: settings.bridgeEnabled,
        port: settings.bridgePort,
        allowRemote: settings.bridgeAllowRemote,
        token: settings.bridgeToken,
        httpEnabled: settings.bridgeHttpEnabled,
        httpPort: settings.bridgeHttpPort,
        httpToken: settings.bridgeHttpToken,
        discoveryEnabled: settings.bridgeDiscoveryEnabled,
        discoveryPort: settings.bridgeDiscoveryPort,
        discoveryName: settings.bridgeDiscoveryName,
        relayEnabled: settings.bridgeRelayEnabled,
        relayUrl: settings.bridgeRelayUrl,
        relayToken: settings.bridgeRelayToken,
        effectiveHost: config.host,
        effectivePort: config.port,
        effectiveEnabled: config.enabled,
        discovery: buildDiscoveryStatus(config),
        relay: buildRelayStatus(config),
      };
    },
    start: async () => {
      await setSetting('bridgeEnabled', true);
      return await startBridgeServer(true);
    },
    stop: async () => {
      await setSetting('bridgeEnabled', false);
      return await stopBridgeServer();
    },
    restart: async () => {
      return await restartBridgeServer();
    },
    updateConfig: async (patch) => {
      if (typeof patch.bridgeEnabled === 'boolean') {
        await setSetting('bridgeEnabled', patch.bridgeEnabled);
      }
      if (typeof patch.bridgeAllowRemote === 'boolean') {
        await setSetting('bridgeAllowRemote', patch.bridgeAllowRemote);
      }
      if (typeof patch.bridgeToken === 'string') {
        await setSetting('bridgeToken', patch.bridgeToken.trim());
      }
      if (typeof patch.bridgeHttpEnabled === 'boolean') {
        await setSetting('bridgeHttpEnabled', patch.bridgeHttpEnabled);
      }
      if (typeof patch.bridgeHttpToken === 'string') {
        await setSetting('bridgeHttpToken', patch.bridgeHttpToken.trim());
      }
      if (typeof patch.bridgePort === 'number' && Number.isFinite(patch.bridgePort) && patch.bridgePort > 0) {
        await setSetting('bridgePort', Math.trunc(patch.bridgePort));
      }
      if (typeof patch.bridgeHttpPort === 'number' && Number.isFinite(patch.bridgeHttpPort) && patch.bridgeHttpPort > 0) {
        await setSetting('bridgeHttpPort', Math.trunc(patch.bridgeHttpPort));
      }
      if (typeof patch.bridgeDiscoveryEnabled === 'boolean') {
        await setSetting('bridgeDiscoveryEnabled', patch.bridgeDiscoveryEnabled);
      }
      if (typeof patch.bridgeDiscoveryPort === 'number' && Number.isFinite(patch.bridgeDiscoveryPort) && patch.bridgeDiscoveryPort > 0) {
        await setSetting('bridgeDiscoveryPort', Math.trunc(patch.bridgeDiscoveryPort));
      }
      if (typeof patch.bridgeDiscoveryName === 'string') {
        await setSetting('bridgeDiscoveryName', patch.bridgeDiscoveryName);
      }
      if (typeof patch.bridgeRelayEnabled === 'boolean') {
        await setSetting('bridgeRelayEnabled', patch.bridgeRelayEnabled);
      }
      if (typeof patch.bridgeRelayUrl === 'string') {
        await setSetting('bridgeRelayUrl', patch.bridgeRelayUrl);
      }
      if (typeof patch.bridgeRelayToken === 'string') {
        await setSetting('bridgeRelayToken', patch.bridgeRelayToken);
      }
      return await restartBridgeServer();
    },
    regenerateToken: async () => {
      const token = String(await getSetting('bridgeToken'));
      const status = await restartBridgeServer();
      return { token, status };
    },
    getAuditLog: async () => {
      return [
        ...(bridgeServer?.getAuditLog() || []),
        ...(httpBridgeServer?.getAuditLog() || []),
      ].sort((a, b) => b.ts - a.ts);
    },
    clearAuditLog: async () => {
      bridgeServer?.clearAuditLog();
      httpBridgeServer?.clearAuditLog();
      return { success: true as const };
    },
  };
  runtimeFacade.setBridgeManager(bridgeManagerApi);

  if (launchMode === 'gui') {
    createMenu();

    const window = await createMainWindow();
    runtimeFacade.setMainWindow(window);

    if (!isE2EMode) {
      await runBestEffortStartupStep('System tray initialization', async () => {
        createTray(window);
      });
    }

    // Override security headers ONLY for the OpenClaw Gateway Control UI.
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://127.0.0.1:18789/*', 'http://localhost:18789/*'] },
      (details, callback) => {
        const headers = { ...details.responseHeaders };
        delete headers['X-Frame-Options'];
        delete headers['x-frame-options'];
        if (headers['Content-Security-Policy']) {
          headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
            (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
          );
        }
        if (headers['content-security-policy']) {
          headers['content-security-policy'] = headers['content-security-policy'].map(
            (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
          );
        }
        callback({ responseHeaders: headers });
      },
    );

    registerIpcHandlers(gatewayManager, clawHubService, window);
    registerUpdateHandlers(appUpdater, window);
  } else {
    runtimeFacade.setMainWindow(null);
    logger.info('Starting ClawX in headless mode (GUI shell disabled)');
  }

  await runBestEffortStartupStep('Host API server startup', async () => {
    runtimeFacade.startHostApiServer();
  });

  await runBestEffortStartupStep('Bridge server startup', async () => {
    const initialBridgeConfig = await resolveBridgeConfigFromSettings();
    publishBridgeStatus(initialBridgeConfig);
    if (initialBridgeConfig.enabled) {
      try {
        await startBridgeServer(true);
      } catch (error) {
        logger.warn('Bridge server initial start failed, retrying once:', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await startBridgeServer(true);
      }
    } else {
      logger.info('Bridge server disabled for this launch');
    }
  });

  // Note: Auto-check for updates is driven by the renderer (update store init)
  // so it respects the user's "Auto-check for updates" setting.
  await runBestEffortStartupStep('Background startup tasks', async () => {
    await runtimeFacade.runBackgroundStartupTasks({
      onGatewayAutoStartError: (message) => {
        mainWindow?.webContents.send('gateway:error', message);
      },
      onCliInstalled: (installedPath) => {
        mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
      },
    });
  });
}

if (gotTheLock) {
  const requestQuitOnSignal = createSignalQuitHandler({
    logInfo: (message) => logger.info(message),
    requestQuit: () => app.quit(),
  });

  process.on('exit', () => {
    releaseProcessInstanceFileLock();
  });

  process.once('SIGINT', () => requestQuitOnSignal('SIGINT'));
  process.once('SIGTERM', () => requestQuitOnSignal('SIGTERM'));

  app.on('will-quit', () => {
    releaseProcessInstanceFileLock();
  });

  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

  runtimeFacade = new RuntimeFacade({ isE2EMode });
  gatewayManager = runtimeFacade.gatewayManager;
  clawHubService = runtimeFacade.clawHubService;
  hostEventBus = runtimeFacade.hostEventBus;
  bridgeEventRelay = new BridgeEventRelay(runtimeFacade);

  // When a second instance is launched, focus the existing window instead.
  app.on('second-instance', () => {
    logger.info('Second ClawX instance detected; redirecting to the existing window');

    if (isHeadlessMode) {
      logger.info('Existing ClawX instance is running in headless mode; ignoring second-instance focus request');
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      logger.warn('Second-instance request arrived without a live main window; recreating it');
      void ensureMainWindowAvailable('second-instance recovery');
      return;
    }

    const focusRequest = requestSecondInstanceFocus(
      mainWindowFocusState,
      Boolean(mainWindow && !mainWindow.isDestroyed()),
    );

    if (focusRequest === 'focus-now') {
      focusMainWindow();
      return;
    }

    logger.debug('Main window is not ready yet; deferring second-instance focus until ready-to-show');
  });

  // Application lifecycle
  app.whenReady().then(() => {
    void initialize().catch((error) => {
      logger.error('Application initialization failed:', error);
      if (launchMode === 'gui' && BrowserWindow.getAllWindows().length === 0) {
        void ensureMainWindowAvailable('startup failure recovery').then((window) => {
          if (window) {
            logger.warn('Recovered from startup failure by creating the main window without optional startup side effects');
          }
        });
      }
    });

    if (launchMode === 'gui') {
      // Register activate handler AFTER app is ready to prevent
      // "Cannot create BrowserWindow before app is ready" on macOS.
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void ensureMainWindowAvailable('app activation');
        } else {
          focusMainWindow();
        }
      });
    }
  });

  app.on('window-all-closed', () => {
    if (launchMode === 'gui' && (process.platform !== 'darwin' || isE2EMode)) {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    setQuitting();
    const action = requestQuitLifecycleAction(quitLifecycleState);

    if (action === 'allow-quit') {
      return;
    }

    event.preventDefault();

    if (action === 'cleanup-in-progress') {
      logger.debug('Quit requested while cleanup already in progress; waiting for shutdown task to finish');
      return;
    }

    runtimeFacade.closeEventBus();
    runtimeFacade.closeHostApiServer();
    stopCloudRelayClient();
    stopLanDiscoveryService();
    bridgeServer?.close();
    bridgeServer = null;
    httpBridgeServer?.close();
    httpBridgeServer = null;

    const stopPromise = gatewayManager.stop().catch((err) => {
      logger.warn('gatewayManager.stop() error during quit:', err);
    });
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 5000);
    });

    void Promise.race([stopPromise.then(() => 'stopped' as const), timeoutPromise]).then((result) => {
      if (result === 'timeout') {
        logger.warn('Gateway shutdown timed out during app quit; proceeding with forced quit');
        void gatewayManager.forceTerminateOwnedProcessForQuit().then((terminated) => {
          if (terminated) {
            logger.warn('Forced gateway process termination completed after quit timeout');
          }
        }).catch((err) => {
          logger.warn('Forced gateway termination failed after quit timeout:', err);
        });
      }
      markQuitCleanupCompleted(quitLifecycleState);
      app.quit();
    });
  });

  // Best-effort Gateway cleanup on unexpected crashes.
  // These handlers attempt to terminate the Gateway child process within a
  // short timeout before force-exiting, preventing orphaned processes.
  const emergencyGatewayCleanup = (reason: string, error: unknown): void => {
    logger.error(`${reason}:`, error);
    try {
      stopCloudRelayClient();
      stopLanDiscoveryService();
      bridgeServer?.close();
      httpBridgeServer?.close();
      void gatewayManager?.stop().catch(() => { /* ignore */ });
    } catch {
      // ignore — stop() may not be callable if state is corrupted
    }

    if (launchMode === 'gui') {
      logger.warn(`Keeping GUI process alive after main-process error (${reason})`);
      void ensureMainWindowAvailable(reason);
      return;
    }

    // Give Gateway stop a brief window, then force-exit in headless mode.
    setTimeout(() => {
      process.exit(1);
    }, 3000).unref();
  };

  process.on('uncaughtException', (error) => {
    emergencyGatewayCleanup('Uncaught exception in main process', error);
  });

  process.on('unhandledRejection', (reason) => {
    emergencyGatewayCleanup('Unhandled promise rejection in main process', reason);
  });
}

// Export for testing
export { mainWindow, gatewayManager, runtimeFacade, bridgeServer, httpBridgeServer };
