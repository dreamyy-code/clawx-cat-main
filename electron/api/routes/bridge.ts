import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { getSetting, setSetting } from '../../utils/store';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

type BridgeSettingsPatch = {
  bridgeEnabled?: boolean;
  bridgePort?: number;
  bridgeToken?: string;
  bridgeHttpEnabled?: boolean;
  bridgeHttpPort?: number;
  bridgeHttpToken?: string;
  bridgeAllowRemote?: boolean;
  bridgeDiscoveryEnabled?: boolean;
  bridgeDiscoveryPort?: number;
  bridgeDiscoveryName?: string;
  bridgeRelayEnabled?: boolean;
  bridgeRelayUrl?: string;
  bridgeRelayToken?: string;
};

function sanitizeBridgePatch(input: BridgeSettingsPatch): BridgeSettingsPatch {
  const patch: BridgeSettingsPatch = {};
  if (typeof input.bridgeEnabled === 'boolean') {
    patch.bridgeEnabled = input.bridgeEnabled;
  }
  if (typeof input.bridgeAllowRemote === 'boolean') {
    patch.bridgeAllowRemote = input.bridgeAllowRemote;
  }
  if (typeof input.bridgeToken === 'string') {
    patch.bridgeToken = input.bridgeToken.trim();
  }
  if (typeof input.bridgeHttpEnabled === 'boolean') {
    patch.bridgeHttpEnabled = input.bridgeHttpEnabled;
  }
  if (typeof input.bridgeHttpToken === 'string') {
    patch.bridgeHttpToken = input.bridgeHttpToken.trim();
  }
  if (typeof input.bridgePort === 'number' && Number.isFinite(input.bridgePort) && input.bridgePort > 0) {
    patch.bridgePort = Math.trunc(input.bridgePort);
  }
  if (typeof input.bridgeHttpPort === 'number' && Number.isFinite(input.bridgeHttpPort) && input.bridgeHttpPort > 0) {
    patch.bridgeHttpPort = Math.trunc(input.bridgeHttpPort);
  }
  if (typeof input.bridgeDiscoveryEnabled === 'boolean') {
    patch.bridgeDiscoveryEnabled = input.bridgeDiscoveryEnabled;
  }
  if (typeof input.bridgeDiscoveryPort === 'number' && Number.isFinite(input.bridgeDiscoveryPort) && input.bridgeDiscoveryPort > 0) {
    patch.bridgeDiscoveryPort = Math.trunc(input.bridgeDiscoveryPort);
  }
  if (typeof input.bridgeDiscoveryName === 'string') {
    patch.bridgeDiscoveryName = input.bridgeDiscoveryName;
  }
  if (typeof input.bridgeRelayEnabled === 'boolean') {
    patch.bridgeRelayEnabled = input.bridgeRelayEnabled;
  }
  if (typeof input.bridgeRelayUrl === 'string') {
    patch.bridgeRelayUrl = input.bridgeRelayUrl;
  }
  if (typeof input.bridgeRelayToken === 'string') {
    patch.bridgeRelayToken = input.bridgeRelayToken;
  }
  return patch;
}

export async function handleBridgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/bridge/status' && req.method === 'GET') {
    sendJson(res, 200, await ctx.bridgeManager.getStatus());
    return true;
  }

  if (url.pathname === '/api/bridge/config' && req.method === 'GET') {
    sendJson(res, 200, await ctx.bridgeManager.getConfig());
    return true;
  }

  if (url.pathname === '/api/bridge/discovery/status' && req.method === 'GET') {
    const status = await ctx.bridgeManager.getStatus();
    sendJson(res, 200, status.discovery || null);
    return true;
  }

  if (url.pathname === '/api/bridge/relay/status' && req.method === 'GET') {
    const status = await ctx.bridgeManager.getStatus();
    sendJson(res, 200, status.relay || null);
    return true;
  }

  if (url.pathname === '/api/bridge/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<BridgeSettingsPatch>(req);
      const patch = sanitizeBridgePatch(body);
      sendJson(res, 200, await ctx.bridgeManager.updateConfig(patch));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/start' && req.method === 'POST') {
    try {
      sendJson(res, 200, await ctx.bridgeManager.start());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/stop' && req.method === 'POST') {
    try {
      sendJson(res, 200, await ctx.bridgeManager.stop());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/restart' && req.method === 'POST') {
    try {
      sendJson(res, 200, await ctx.bridgeManager.restart());
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/token' && req.method === 'GET') {
    sendJson(res, 200, { token: await getSetting('bridgeToken') });
    return true;
  }

  if (url.pathname === '/api/bridge/http/token' && req.method === 'GET') {
    sendJson(res, 200, { token: await getSetting('bridgeHttpToken') });
    return true;
  }

  if (url.pathname === '/api/bridge/token/regenerate' && req.method === 'POST') {
    try {
      const nextToken = `clawx-bridge-${randomBytes(16).toString('hex')}`;
      await setSetting('bridgeToken', nextToken);
      const result = await ctx.bridgeManager.regenerateToken();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/http/token/regenerate' && req.method === 'POST') {
    try {
      const nextToken = `clawx-http-bridge-${randomBytes(16).toString('hex')}`;
      await setSetting('bridgeHttpToken', nextToken);
      const result = await ctx.bridgeManager.updateConfig({ bridgeHttpToken: nextToken });
      sendJson(res, 200, { token: nextToken, status: result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/bridge/audit' && req.method === 'GET') {
    sendJson(res, 200, { entries: await ctx.bridgeManager.getAuditLog() });
    return true;
  }

  if (url.pathname === '/api/bridge/audit' && req.method === 'DELETE') {
    sendJson(res, 200, await ctx.bridgeManager.clearAuditLog());
    return true;
  }

  return false;
}
