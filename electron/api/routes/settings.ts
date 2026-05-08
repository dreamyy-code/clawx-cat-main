import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { refreshTrayMenu } from '../../main/tray';
import { syncLaunchAtStartupSettingFromStore } from '../../main/launch-at-startup';
import { appUpdater } from '../../main/updater';
import { syncProxyConfigToOpenClaw } from '../../utils/openclaw-proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

function patchTouchesBridge(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'bridgeEnabled' ||
    key === 'bridgeToken' ||
    key === 'bridgePort' ||
    key === 'bridgeHttpEnabled' ||
    key === 'bridgeHttpToken' ||
    key === 'bridgeHttpPort' ||
    key === 'bridgeAllowRemote' ||
    key === 'bridgeDiscoveryEnabled' ||
    key === 'bridgeDiscoveryPort' ||
    key === 'bridgeDiscoveryName' ||
    key === 'bridgeRelayEnabled' ||
    key === 'bridgeRelayUrl' ||
    key === 'bridgeRelayToken'
  ));
}

function patchTouchesUpdater(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'updateChannel' ||
    key === 'autoDownloadUpdate'
  ));
}

function applyUpdaterSettingsPatch(patch: Partial<AppSettings>): void {
  if (typeof patch.updateChannel === 'string') {
    appUpdater.setChannel(patch.updateChannel);
  }
  if (typeof patch.autoDownloadUpdate === 'boolean') {
    appUpdater.setAutoDownload(patch.autoDownloadUpdate);
  }
}

function patchTouchesLanguage(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'language');
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      if (patchTouchesLaunchAtStartup(patch)) {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (patchTouchesBridge(patch)) {
        await ctx.bridgeManager.updateConfig(patch);
      }
      if (patchTouchesUpdater(patch)) {
        applyUpdaterSettingsPatch(patch);
      }
      if (patchTouchesLanguage(patch)) {
        await refreshTrayMenu();
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (
        key === 'proxyEnabled' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      if (key === 'launchAtStartup') {
        await syncLaunchAtStartupSettingFromStore();
      }
      if (
        key === 'bridgeEnabled'
        || key === 'bridgeToken'
        || key === 'bridgePort'
        || key === 'bridgeAllowRemote'
        || key === 'bridgeDiscoveryEnabled'
        || key === 'bridgeDiscoveryPort'
        || key === 'bridgeDiscoveryName'
        || key === 'bridgeRelayEnabled'
        || key === 'bridgeRelayUrl'
        || key === 'bridgeRelayToken'
      ) {
        await ctx.bridgeManager.updateConfig({ [key]: body.value });
      }
      if (key === 'updateChannel' || key === 'autoDownloadUpdate') {
        applyUpdaterSettingsPatch({ [key]: body.value } as Partial<AppSettings>);
      }
      if (key === 'language') {
        await refreshTrayMenu();
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      await handleProxySettingsChange(ctx);
      await syncLaunchAtStartupSettingFromStore();
      await ctx.bridgeManager.updateConfig({
        bridgeEnabled: false,
        bridgeToken: await getSetting('bridgeToken'),
        bridgePort: 18989,
        bridgeAllowRemote: false,
        bridgeDiscoveryEnabled: true,
        bridgeDiscoveryPort: 18990,
        bridgeDiscoveryName: 'ClawX-Cat',
        bridgeRelayEnabled: false,
        bridgeRelayUrl: '',
        bridgeRelayToken: '',
      });
      applyUpdaterSettingsPatch({
        updateChannel: 'stable',
        autoDownloadUpdate: false,
      });
      await refreshTrayMenu();
      sendJson(res, 200, { success: true, settings: await getAllSettings() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
