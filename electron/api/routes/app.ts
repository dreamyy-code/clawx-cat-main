import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { appUpdater } from '../../main/updater';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../../utils/openclaw-doctor';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { getAllSettings, setSetting, type AppSettings } from '../../utils/store';

type DeviceDetailSettingsPatch = Partial<Pick<AppSettings,
  'launchAtStartup'
  | 'gatewayAutoStart'
  | 'gatewayStartupProfile'
  | 'gatewayStartupExtraArgs'
  | 'gatewayPort'
  | 'bridgeHttpEnabled'
  | 'bridgeHttpToken'
  | 'bridgeAllowRemote'
  | 'bridgeDiscoveryEnabled'
  | 'bridgeDiscoveryName'
  | 'bridgeRelayEnabled'
  | 'bridgeRelayUrl'
  | 'bridgeRelayToken'
  | 'updateChannel'
  | 'autoCheckUpdate'
  | 'autoDownloadUpdate'
>>;

function safeRecord<T>(value: T | null | undefined, fallback: T): T {
  return value == null ? fallback : value;
}

function sanitizeDeviceDetailPatch(input: Record<string, unknown>): DeviceDetailSettingsPatch {
  const patch: DeviceDetailSettingsPatch = {};
  if (typeof input.launchAtStartup === 'boolean') patch.launchAtStartup = input.launchAtStartup;
  if (typeof input.gatewayAutoStart === 'boolean') patch.gatewayAutoStart = input.gatewayAutoStart;
  if (input.gatewayStartupProfile === 'auto' || input.gatewayStartupProfile === 'full' || input.gatewayStartupProfile === 'server-lite') {
    patch.gatewayStartupProfile = input.gatewayStartupProfile;
  }
  if (typeof input.gatewayStartupExtraArgs === 'string') patch.gatewayStartupExtraArgs = input.gatewayStartupExtraArgs;
  if (typeof input.gatewayPort === 'number' && Number.isFinite(input.gatewayPort) && input.gatewayPort > 0) {
    patch.gatewayPort = Math.trunc(input.gatewayPort);
  }
  if (typeof input.bridgeHttpEnabled === 'boolean') patch.bridgeHttpEnabled = input.bridgeHttpEnabled;
  if (typeof input.bridgeHttpToken === 'string') patch.bridgeHttpToken = input.bridgeHttpToken.trim();
  if (typeof input.bridgeAllowRemote === 'boolean') patch.bridgeAllowRemote = input.bridgeAllowRemote;
  if (typeof input.bridgeDiscoveryEnabled === 'boolean') patch.bridgeDiscoveryEnabled = input.bridgeDiscoveryEnabled;
  if (typeof input.bridgeDiscoveryName === 'string') patch.bridgeDiscoveryName = input.bridgeDiscoveryName;
  if (typeof input.bridgeRelayEnabled === 'boolean') patch.bridgeRelayEnabled = input.bridgeRelayEnabled;
  if (typeof input.bridgeRelayUrl === 'string') patch.bridgeRelayUrl = input.bridgeRelayUrl;
  if (typeof input.bridgeRelayToken === 'string') patch.bridgeRelayToken = input.bridgeRelayToken;
  if (input.updateChannel === 'stable' || input.updateChannel === 'beta' || input.updateChannel === 'dev') {
    patch.updateChannel = input.updateChannel;
  }
  if (typeof input.autoCheckUpdate === 'boolean') patch.autoCheckUpdate = input.autoCheckUpdate;
  if (typeof input.autoDownloadUpdate === 'boolean') patch.autoDownloadUpdate = input.autoDownloadUpdate;
  return patch;
}

function patchTouchesLaunchAtStartup(patch: DeviceDetailSettingsPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function patchTouchesBridge(patch: DeviceDetailSettingsPatch): boolean {
  return Object.keys(patch).some((key) => (
    key === 'bridgeHttpEnabled'
    || key === 'bridgeHttpToken'
    || key === 'bridgeAllowRemote'
    || key === 'bridgeDiscoveryEnabled'
    || key === 'bridgeDiscoveryName'
    || key === 'bridgeRelayEnabled'
    || key === 'bridgeRelayUrl'
    || key === 'bridgeRelayToken'
  ));
}

function patchTouchesUpdater(patch: DeviceDetailSettingsPatch): boolean {
  return Object.keys(patch).some((key) => key === 'updateChannel' || key === 'autoDownloadUpdate');
}

async function buildDeviceDetailState(ctx: HostApiContext) {
  const [
    settingsResult,
    bridgeConfigResult,
    bridgeStatusResult,
    gatewayHealthResult,
  ] = await Promise.allSettled([
    getAllSettings(),
    ctx.bridgeManager.getConfig(),
    ctx.bridgeManager.getStatus(),
    ctx.gatewayManager.checkHealth(),
  ]);
  const settings = settingsResult.status === 'fulfilled' ? { ...settingsResult.value } : {};
  const bridgeConfig = bridgeConfigResult.status === 'fulfilled' ? { ...bridgeConfigResult.value } : {};

  delete settings.bridgeHttpToken;
  delete settings.bridgeToken;
  delete bridgeConfig.httpToken;
  delete bridgeConfig.token;

  return {
    settings,
    bridgeConfig,
    bridgeStatus: bridgeStatusResult.status === 'fulfilled' ? bridgeStatusResult.value : {},
    gatewayStatus: safeRecord(ctx.gatewayManager.getStatus(), {}),
    gatewayHealth: gatewayHealthResult.status === 'fulfilled' ? gatewayHealthResult.value : {},
    updateVersion: {
      version: appUpdater.getCurrentVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    },
    updateStatus: appUpdater.getStatus(),
  };
}

async function applyDeviceDetailPatch(ctx: HostApiContext, patch: DeviceDetailSettingsPatch): Promise<void> {
  const entries = Object.entries(patch) as Array<[keyof DeviceDetailSettingsPatch, DeviceDetailSettingsPatch[keyof DeviceDetailSettingsPatch]]>;
  for (const [key, value] of entries) {
    await setSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
  }
  if (patchTouchesLaunchAtStartup(patch)) {
    await syncLaunchAtStartupSettingFromStore();
  }
  if (patchTouchesBridge(patch)) {
    await ctx.bridgeManager.updateConfig(patch);
  }
  if (patchTouchesUpdater(patch)) {
    if (typeof patch.updateChannel === 'string') {
      appUpdater.setChannel(patch.updateChannel);
    }
    if (typeof patch.autoDownloadUpdate === 'boolean') {
      appUpdater.setAutoDownload(patch.autoDownloadUpdate);
    }
  }
}

export async function handleAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    // CORS headers are already set by the server middleware.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    ctx.eventBus.addSseClient(res);
    // Send a current-state snapshot immediately so renderer subscribers do not
    // miss lifecycle transitions that happened before the SSE connection opened.
    res.write(`event: gateway:status\ndata: ${JSON.stringify(ctx.gatewayManager.getStatus())}\n\n`);
    return true;
  }

  if (url.pathname === '/api/app/openclaw-doctor' && req.method === 'POST') {
    const body = await parseJsonBody<{ mode?: 'diagnose' | 'fix' }>(req);
    const mode = body.mode === 'fix' ? 'fix' : 'diagnose';
    sendJson(res, 200, mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor());
    return true;
  }

  if (url.pathname === '/api/app/update/version' && req.method === 'GET') {
    sendJson(res, 200, {
      version: appUpdater.getCurrentVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    });
    return true;
  }

  if (url.pathname === '/api/app/update/status' && req.method === 'GET') {
    sendJson(res, 200, appUpdater.getStatus());
    return true;
  }

  if (url.pathname === '/api/app/update/check' && req.method === 'POST') {
    try {
      await appUpdater.checkForUpdates();
      sendJson(res, 200, { success: true, status: appUpdater.getStatus() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error), status: appUpdater.getStatus() });
    }
    return true;
  }

  if (url.pathname === '/api/app/update/download' && req.method === 'POST') {
    try {
      await appUpdater.downloadUpdate();
      sendJson(res, 200, { success: true, status: appUpdater.getStatus() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error), status: appUpdater.getStatus() });
    }
    return true;
  }

  if (url.pathname === '/api/app/update/install' && req.method === 'POST') {
    try {
      appUpdater.quitAndInstall();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/app/device-detail/state' && req.method === 'GET') {
    sendJson(res, 200, await buildDeviceDetailState(ctx));
    return true;
  }

  if (url.pathname === '/api/app/device-detail/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ settingsPatch?: Record<string, unknown> }>(req);
      const settingsPatch = sanitizeDeviceDetailPatch(body && typeof body.settingsPatch === 'object' ? body.settingsPatch : {});
      await applyDeviceDetailPatch(ctx, settingsPatch);
      sendJson(res, 200, {
        success: true,
        state: await buildDeviceDetailState(ctx),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // OPTIONS is handled by the server middleware; no route-level handler needed.

  return false;
}
