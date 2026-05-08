import type { IncomingMessage, ServerResponse } from 'http';
import { sendJson } from '../route-utils';
import {
  addOpenClawFallbackModel,
  addOpenClawProviderModel,
  getOpenClawModelSelection,
  getOpenClawProvidersConfig,
  listOpenClawAuthProfileProviders,
  removeOpenClawFallbackModel,
  removeOpenClawProviderModel,
  readOpenClawJsonForUi,
  setOpenClawPrimaryModel,
} from '../../utils/openclaw-auth';

export async function handleModelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === '/api/models/config-summary' && req.method === 'GET') {
    try {
      const rawConfig = await readOpenClawJsonForUi();
      const { providers, defaultModel, sourceKeys } = await getOpenClawProvidersConfig();
      const authProfileProviders = await listOpenClawAuthProfileProviders();
      const selection = await getOpenClawModelSelection();

      sendJson(res, 200, {
        providers,
        sourceKeys,
        defaultModel,
        selection,
        authProfileProviders,
        rawConfig,
      });
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/models/set-primary' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as { modelRef?: string };
      if (!payload.modelRef) {
        sendJson(res, 400, { error: 'Missing modelRef' });
      } else {
        await setOpenClawPrimaryModel(payload.modelRef);
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/models/add-fallback' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as { modelRef?: string };
      if (!payload.modelRef) {
        sendJson(res, 400, { error: 'Missing modelRef' });
      } else {
        await addOpenClawFallbackModel(payload.modelRef);
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/models/remove-fallback' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as { modelRef?: string };
      if (!payload.modelRef) {
        sendJson(res, 400, { error: 'Missing modelRef' });
      } else {
        await removeOpenClawFallbackModel(payload.modelRef);
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/models/add-provider-model' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as { providerKey?: string; modelId?: string };
      if (!payload.providerKey || !payload.modelId) {
        sendJson(res, 400, { error: 'Missing providerKey/modelId' });
      } else {
        await addOpenClawProviderModel(payload.providerKey, payload.modelId);
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/models/remove-provider-model' && req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body) as { providerKey?: string; modelId?: string };
      if (!payload.providerKey || !payload.modelId) {
        sendJson(res, 400, { error: 'Missing providerKey/modelId' });
      } else {
        await removeOpenClawProviderModel(payload.providerKey, payload.modelId);
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  return false;
}
