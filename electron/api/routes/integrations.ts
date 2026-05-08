import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  clearIterativeCatLoginState,
  fetchIterativeCatModels,
  generateIterativeCatKey,
  getIterativeCatStatus,
  openIterativeCatLoginWindow,
  readIterativeCatDataFiles,
  registerIterativeCatLoginWebview,
  syncIterativeCatProfile,
  type IterativeCatServiceProvider,
} from '../../main/iterativecat';
import { configureIterativeCatProvidersToOpenClaw } from '../../utils/openclaw-auth';
import { getProviderService } from '../../services/providers/provider-service';
import {
  syncDefaultProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';

const DEFAULT_ITERATIVECAT_MODEL = 'gemini-3-flash-preview';

function getIterativeCatRuntimeBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1`;
}

export async function handleIntegrationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();

  if (url.pathname === '/api/integrations/iterativecat/status' && req.method === 'GET') {
    const provider = url.searchParams.get('provider') || 'iterativecat';
    const baseUrl = url.searchParams.get('baseUrl') || undefined;
    const account = (await providerService.listAccounts()).find((item) => (
      item.id === provider || item.vendorId === provider
    )) ?? null;
    sendJson(res, 200, {
      ...getIterativeCatStatus({ provider, baseUrl }),
      providerAccount: account,
      recommended: true,
    });
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/data' && req.method === 'GET') {
    sendJson(res, 200, readIterativeCatDataFiles());
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: IterativeCatServiceProvider; baseUrl?: string }>(req);
      const result = await openIterativeCatLoginWindow({
        provider: body.provider,
        baseUrl: body.baseUrl,
        eventBus: ctx.eventBus,
      });
      if (result.success && !result.profileReady) {
        await syncIterativeCatProfile(body);
      }
      sendJson(res, 200, {
        success: result.success,
        profileReady: getIterativeCatStatus(body).profileReady,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/webview-ready' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: IterativeCatServiceProvider; baseUrl?: string; webContentsId: number }>(req);
      const result = await registerIterativeCatLoginWebview({
        provider: body.provider,
        baseUrl: body.baseUrl,
        webContentsId: body.webContentsId,
        eventBus: ctx.eventBus,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/check-login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: IterativeCatServiceProvider; baseUrl?: string; since?: number }>(req);
      let status = getIterativeCatStatus(body);
      if (!status.loggedIn) {
        await syncIterativeCatProfile(body);
        status = getIterativeCatStatus(body);
      }
      sendJson(res, 200, {
        success: true,
        ...status,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/clear-login' && req.method === 'POST') {
    try {
      const result = await clearIterativeCatLoginState();
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/generate-key' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: IterativeCatServiceProvider; baseUrl?: string }>(req);
      const apiKey = await generateIterativeCatKey(body);
      sendJson(res, 200, { success: true, apiKey });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/models' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ provider?: IterativeCatServiceProvider; baseUrl?: string; apiKey: string }>(req);
      const models = await fetchIterativeCatModels(body);
      sendJson(res, 200, { success: true, models });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/integrations/iterativecat/configure-recommended' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        provider?: IterativeCatServiceProvider;
        baseUrl?: string;
        modelId?: string;
        label?: string;
        apiKey?: string;
      }>(req);
      const status = getIterativeCatStatus(body);
      if (!body.apiKey && !status.loggedIn) {
        await syncIterativeCatProfile(body);
      }
      const apiKey = body.apiKey?.trim() || await generateIterativeCatKey(body);
      const resolvedStatus = getIterativeCatStatus(body);
      const resolvedBaseUrl = getIterativeCatRuntimeBaseUrl(resolvedStatus.serviceBaseUrl);
      const modelId = String(body.modelId || DEFAULT_ITERATIVECAT_MODEL).trim();
      await configureIterativeCatProvidersToOpenClaw({
        baseUrl: resolvedStatus.serviceBaseUrl,
        apiKey,
        primaryModelId: modelId,
      });
      await providerService.setDefaultAccount('api-iterativecat-gpt');
      await syncDefaultProviderToRuntime('api-iterativecat-gpt', ctx.gatewayManager);

      sendJson(res, 200, {
        success: true,
        accountId: 'api-iterativecat-gpt',
        providerKeys: ['api-iterativecat-gpt', 'api-iterativecat-claude', 'api-iterativecat-google'],
        modelId,
        baseUrl: resolvedBaseUrl,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
