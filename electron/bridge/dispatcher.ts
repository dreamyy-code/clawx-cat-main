import type { RuntimeFacade } from '../runtime/runtime-facade';
import {
  normalizeBridgeSessionKey,
  type BridgeClientMessage,
  type BridgeServerMessage,
} from './protocol';

type BridgeSessionSubscription = {
  getSessionKeys: () => Set<string> | null;
  setSessionKeys: (value: Set<string> | null) => void;
};

export type BridgeDispatchOptions = {
  runtimeFacade: RuntimeFacade;
  mode: 'gui' | 'headless';
  host: string;
  port: number;
  token: string;
  transport: 'ws' | 'http';
  sessionSubscription?: BridgeSessionSubscription;
};

const BLOCKED_HOSTAPI_PATH_PREFIXES = [
  '/api/bridge/token',
  '/api/bridge/http/token',
];

async function fetchHostApiJson(
  runtimeFacade: RuntimeFacade,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const response = await runtimeFacade.hostApiFetch({
    path,
    method,
    body,
  });
  if (!response.ok) {
    throw new Error(describeHostApiFailure(path, response));
  }
  return response.json;
}

function describeHostApiFailure(
  path: string,
  response: Awaited<ReturnType<RuntimeFacade['hostApiFetch']>>,
): string {
  const payload = response.json && typeof response.json === 'object'
    ? response.json as Record<string, unknown>
    : null;
  const error = typeof payload?.error === 'string' ? payload.error : null;
  if (error) {
    return error;
  }
  if (typeof response.text === 'string' && response.text.trim()) {
    return `${path} failed: ${response.text.trim()}`;
  }
  return `${path} failed with status ${response.status}`;
}

export async function executeBridgeClientMessage(
  message: BridgeClientMessage,
  options: BridgeDispatchOptions,
): Promise<BridgeServerMessage> {
  const { runtimeFacade } = options;
  switch (message.type) {
    case 'bridge.info':
      return {
        type: 'bridge.info',
        requestId: message.requestId,
        info: {
          mode: options.mode,
          host: options.host,
          port: options.port,
          bridgeUrl: `${options.transport}://${options.host}:${options.port}`,
          hasToken: Boolean(options.token),
          status: runtimeFacade.getBridgeStatus(),
          capabilities: runtimeFacade.getCapabilities(),
        },
      };
    case 'bridge.status.get':
      return {
        type: 'bridge.status',
        requestId: message.requestId,
        status: runtimeFacade.getBridgeStatus(),
      };
    case 'ping':
      return {
        type: 'pong',
        requestId: message.requestId,
        ts: Date.now(),
      };
    case 'gateway.http': {
      const path = message.params?.path?.trim();
      if (!path || !path.startsWith('/')) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_GATEWAY_PATH',
          message: 'gateway.http requires path starting with /',
        };
      }
      const response = await runtimeFacade.gatewayHttpFetch({
        path,
        method: message.params?.method,
        headers: message.params?.headers,
        body: message.params?.body,
        timeoutMs: message.params?.timeoutMs,
      });
      return {
        type: 'gateway.http.result',
        requestId: message.requestId,
        path,
        response,
      };
    }
    case 'gateway.controlUi.get': {
      const info = await runtimeFacade.getControlUiInfo();
      return {
        type: 'gateway.controlUi',
        requestId: message.requestId,
        info,
      };
    }
    case 'file.stageBuffer': {
      const base64 = message.params?.base64?.trim();
      const fileName = message.params?.fileName?.trim();
      const mimeType = message.params?.mimeType?.trim() || 'application/octet-stream';
      if (!base64 || !fileName) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_FILE_BUFFER',
          message: 'file.stageBuffer requires base64 and fileName',
        };
      }
      const file = await runtimeFacade.stageFileBuffer({
        base64,
        fileName,
        mimeType,
      });
      return {
        type: 'file.staged',
        requestId: message.requestId,
        file,
      };
    }
    case 'file.stagePaths': {
      const filePaths = Array.isArray(message.params?.filePaths)
        ? message.params.filePaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      if (filePaths.length === 0) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_FILE_PATHS',
          message: 'file.stagePaths requires at least one file path',
        };
      }
      const files = await runtimeFacade.stageFilePaths(filePaths);
      return {
        type: 'files.staged',
        requestId: message.requestId,
        files,
      };
    }
    case 'file.read': {
      const filePath = message.params?.filePath?.trim();
      if (!filePath) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_FILE_PATH',
          message: 'file.read requires filePath',
        };
      }
      const file = await runtimeFacade.readFile({
        filePath,
        mode: message.params?.mode,
        maxBytes: message.params?.maxBytes,
      });
      return {
        type: 'file.read.result',
        requestId: message.requestId,
        file,
      };
    }
    case 'hostapi.fetch': {
      const path = message.params?.path?.trim();
      if (!path || !path.startsWith('/')) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_HOSTAPI_PATH',
          message: 'hostapi.fetch requires path starting with /',
        };
      }
      if (BLOCKED_HOSTAPI_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'BLOCKED_HOSTAPI_PATH',
          message: `Blocked host API path: ${path}`,
        };
      }
      const response = await runtimeFacade.hostApiFetch({
        path,
        method: message.params?.method,
        headers: message.params?.headers,
        body: message.params?.body,
      });
      return {
        type: 'hostapi.result',
        requestId: message.requestId,
        path,
        response,
      };
    }
    case 'runtime.capabilities.get':
      return {
        type: 'runtime.capabilities',
        requestId: message.requestId,
        capabilities: runtimeFacade.getCapabilities(),
      };
    case 'agents.list': {
      const snapshot = await fetchHostApiJson(runtimeFacade, '/api/agents');
      return {
        type: 'agents.list',
        requestId: message.requestId,
        snapshot,
      };
    }
    case 'agents.create': {
      const name = message.params?.name?.trim();
      if (!name) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_NAME',
          message: 'agents.create requires name',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, '/api/agents', 'POST', {
        name,
        inheritWorkspace: message.params?.inheritWorkspace === true,
      });
      return {
        type: 'agents.created',
        requestId: message.requestId,
        snapshot,
      };
    }
    case 'agents.import.inspect': {
      const zipPath = message.params?.zipPath?.trim();
      if (!zipPath) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_ZIP_PATH',
          message: 'agents.import.inspect requires zipPath',
        };
      }
      const inspection = await fetchHostApiJson(runtimeFacade, '/api/agents/import/inspect', 'POST', { zipPath });
      return {
        type: 'agents.import.inspected',
        requestId: message.requestId,
        inspection,
      };
    }
    case 'agent.import.package': {
      const agentId = message.params?.agentId?.trim();
      const zipPath = message.params?.zipPath?.trim();
      if (!agentId || !zipPath) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_IMPORT',
          message: 'agent.import.package requires agentId and zipPath',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}/import-package`, 'POST', {
        zipPath,
        sourceAgentDirName: message.params?.sourceAgentDirName,
        sourceWorkspaceDirName: message.params?.sourceWorkspaceDirName,
      });
      return {
        type: 'agent.package.imported',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agents.communication.update': {
      const snapshot = await fetchHostApiJson(runtimeFacade, '/api/agents/communication', 'PUT', {
        enabled: message.params?.enabled === true,
        allowedAgents: Array.isArray(message.params?.allowedAgents) ? message.params.allowedAgents : [],
      });
      return {
        type: 'agents.communication.updated',
        requestId: message.requestId,
        snapshot,
      };
    }
    case 'agent.communication.update': {
      const agentId = message.params?.agentId?.trim();
      if (!agentId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_ID',
          message: 'agent.communication.update requires agentId',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}/communication`, 'PUT', {
        spawnTargets: Array.isArray(message.params?.spawnTargets) ? message.params.spawnTargets : [],
      });
      return {
        type: 'agent.communication.updated',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agent.update': {
      const agentId = message.params?.agentId?.trim();
      if (!agentId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_ID',
          message: 'agent.update requires agentId',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}`, 'PUT', {
        name: message.params?.name?.trim() || undefined,
      });
      return {
        type: 'agent.updated',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agent.delete': {
      const agentId = message.params?.agentId?.trim();
      if (!agentId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_ID',
          message: 'agent.delete requires agentId',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}`, 'DELETE');
      return {
        type: 'agent.deleted',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agent.model.update': {
      const agentId = message.params?.agentId?.trim();
      if (!agentId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_ID',
          message: 'agent.model.update requires agentId',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}/model`, 'PUT', {
        modelRef: message.params?.modelRef ?? null,
      });
      return {
        type: 'agent.model.updated',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agent.instructions.sync': {
      const agentId = message.params?.agentId?.trim();
      if (!agentId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_AGENT_ID',
          message: 'agent.instructions.sync requires agentId',
        };
      }
      const snapshot = await fetchHostApiJson(runtimeFacade, `/api/agents/${encodeURIComponent(agentId)}/instructions`, 'POST');
      return {
        type: 'agent.instructions.synced',
        requestId: message.requestId,
        agentId,
        snapshot,
      };
    }
    case 'agents.instructions.syncAll': {
      const snapshot = await fetchHostApiJson(runtimeFacade, '/api/agents/instructions/sync-all', 'POST');
      return {
        type: 'agents.instructions.synced',
        requestId: message.requestId,
        snapshot,
      };
    }
    case 'models.config.get': {
      const summary = await fetchHostApiJson(runtimeFacade, '/api/models/config-summary');
      return {
        type: 'models.config',
        requestId: message.requestId,
        summary,
      };
    }
    case 'models.primary.set': {
      const modelRef = message.params?.modelRef?.trim();
      if (!modelRef) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_MODEL_REF',
          message: 'models.primary.set requires modelRef',
        };
      }
      const result = await fetchHostApiJson(runtimeFacade, '/api/models/set-primary', 'POST', { modelRef });
      return {
        type: 'models.primary.updated',
        requestId: message.requestId,
        modelRef,
        result,
      };
    }
    case 'models.fallback.add':
    case 'models.fallback.remove': {
      const modelRef = message.params?.modelRef?.trim();
      if (!modelRef) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_MODEL_REF',
          message: `${message.type} requires modelRef`,
        };
      }
      const operation = message.type === 'models.fallback.add' ? 'add' : 'remove';
      const result = await fetchHostApiJson(
        runtimeFacade,
        `/api/models/${operation === 'add' ? 'add-fallback' : 'remove-fallback'}`,
        'POST',
        { modelRef },
      );
      return {
        type: 'models.fallback.updated',
        requestId: message.requestId,
        operation,
        modelRef,
        result,
      };
    }
    case 'models.providerModel.add':
    case 'models.providerModel.remove': {
      const providerKey = message.params?.providerKey?.trim();
      const modelId = message.params?.modelId?.trim();
      if (!providerKey || !modelId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_PROVIDER_MODEL',
          message: `${message.type} requires providerKey and modelId`,
        };
      }
      const operation = message.type === 'models.providerModel.add' ? 'add' : 'remove';
      const result = await fetchHostApiJson(
        runtimeFacade,
        `/api/models/${operation === 'add' ? 'add-provider-model' : 'remove-provider-model'}`,
        'POST',
        { providerKey, modelId },
      );
      return {
        type: 'models.providerModel.updated',
        requestId: message.requestId,
        operation,
        providerKey,
        modelId,
        result,
      };
    }
    case 'gateway.rpc': {
      const method = message.params?.method?.trim();
      if (!method) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_METHOD',
          message: 'gateway.rpc requires method',
        };
      }
      const result = await runtimeFacade.rpc({
        method,
        params: message.params?.params,
        timeoutMs: message.params?.timeoutMs,
      });
      return {
        type: 'gateway.rpc.result',
        requestId: message.requestId,
        method,
        result,
      };
    }
    case 'gateway.start':
      await runtimeFacade.startGateway();
      return {
        type: 'gateway.started',
        requestId: message.requestId,
        status: runtimeFacade.getGatewayStatus(),
      };
    case 'gateway.stop':
      await runtimeFacade.stopGateway();
      return {
        type: 'gateway.stopped',
        requestId: message.requestId,
        status: runtimeFacade.getGatewayStatus(),
      };
    case 'gateway.restart':
      await runtimeFacade.restartGateway();
      return {
        type: 'gateway.restarted',
        requestId: message.requestId,
        status: runtimeFacade.getGatewayStatus(),
      };
    case 'gateway.reload':
      await runtimeFacade.reloadGateway();
      return {
        type: 'gateway.reloaded',
        requestId: message.requestId,
        status: runtimeFacade.getGatewayStatus(),
      };
    case 'gateway.health.get': {
      const health = await runtimeFacade.checkGatewayHealth();
      return {
        type: 'gateway.health',
        requestId: message.requestId,
        health,
      };
    }
    case 'gateway.status.get':
      return {
        type: 'gateway.status',
        requestId: message.requestId,
        status: runtimeFacade.getGatewayStatus(),
      };
    case 'session.subscribe': {
      if (!options.sessionSubscription) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'UNSUPPORTED_ACTION',
          message: 'session.subscribe requires a stateful transport',
        };
      }
      const sessionKeys = Array.isArray(message.params?.sessionKeys)
        ? message.params.sessionKeys.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      options.sessionSubscription.setSessionKeys(message.params?.all ? null : new Set(sessionKeys));
      const current = options.sessionSubscription.getSessionKeys();
      return {
        type: 'session.subscribed',
        requestId: message.requestId,
        sessionKeys: current ? Array.from(current) : undefined,
        all: current === null,
      };
    }
    case 'session.listLocal': {
      const result = await runtimeFacade.listLocalSessions();
      return {
        type: 'session.list',
        requestId: message.requestId,
        sessions: result.sessions,
      };
    }
    case 'session.transcript.get': {
      const agentId = message.params?.agentId?.trim();
      const sessionId = message.params?.sessionId?.trim();
      if (!agentId || !sessionId) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_TRANSCRIPT_REQUEST',
          message: 'session.transcript.get requires agentId and sessionId',
        };
      }
      const transcript = await runtimeFacade.getSessionTranscript(agentId, sessionId);
      return {
        type: 'session.transcript',
        requestId: message.requestId,
        transcript,
      };
    }
    case 'session.delete': {
      const sessionKey = normalizeBridgeSessionKey(message.params?.sessionKey);
      const result = await runtimeFacade.deleteSession(sessionKey);
      return {
        type: 'session.deleted',
        requestId: message.requestId,
        sessionKey,
        success: result.success,
        error: result.error,
      };
    }
    case 'logs.get': {
      const tailLines = typeof message.params?.tailLines === 'number' ? message.params.tailLines : undefined;
      const logs = await runtimeFacade.getLogs(tailLines);
      return {
        type: 'logs.content',
        requestId: message.requestId,
        logs,
      };
    }
    case 'logs.files.get': {
      const files = await runtimeFacade.getLogFiles();
      return {
        type: 'logs.files',
        requestId: message.requestId,
        files,
      };
    }
    case 'logs.dir.get': {
      const dir = await runtimeFacade.getLogDir();
      return {
        type: 'logs.dir',
        requestId: message.requestId,
        dir,
      };
    }
    case 'chat.send': {
      const text = message.params?.message?.trim();
      if (!text) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_MESSAGE',
          message: 'message is required',
        };
      }

      const sessionKey = normalizeBridgeSessionKey(message.params?.sessionKey);
      const result = await runtimeFacade.sendChatMessage({
        sessionKey,
        message: text,
        deliver: message.params?.deliver,
        idempotencyKey: message.params?.idempotencyKey,
      });
      return {
        type: 'chat.accepted',
        requestId: message.requestId,
        sessionKey,
        runId: result.runId,
      };
    }
    case 'chat.sendWithMedia': {
      const text = message.params?.message?.trim() || '';
      const sessionKey = normalizeBridgeSessionKey(message.params?.sessionKey);
      const media = Array.isArray(message.params?.media)
        ? message.params.media
          .filter((item): item is { filePath: string; mimeType: string; fileName: string } =>
            !!item
            && typeof item.filePath === 'string'
            && item.filePath.trim().length > 0
            && typeof item.mimeType === 'string'
            && item.mimeType.trim().length > 0
            && typeof item.fileName === 'string'
            && item.fileName.trim().length > 0)
          .map((item) => ({
            filePath: item.filePath.trim(),
            mimeType: item.mimeType.trim(),
            fileName: item.fileName.trim(),
          }))
        : [];

      if (!text && media.length === 0) {
        return {
          type: 'error',
          requestId: message.requestId,
          code: 'INVALID_MESSAGE',
          message: 'chat.sendWithMedia requires message or media',
        };
      }

      const result = await runtimeFacade.sendChatMessageWithMedia({
        sessionKey,
        message: text,
        deliver: message.params?.deliver,
        idempotencyKey: message.params?.idempotencyKey,
        media,
      });
      return {
        type: 'chat.accepted',
        requestId: message.requestId,
        sessionKey,
        runId: result.runId,
      };
    }
    case 'chat.abort': {
      const sessionKey = normalizeBridgeSessionKey(message.params?.sessionKey);
      await runtimeFacade.abortChat(sessionKey);
      return {
        type: 'chat.aborted',
        sessionKey,
      };
    }
    case 'auth':
      return {
        type: 'auth.ok',
        requestId: message.requestId,
        mode: options.mode,
      };
    default:
      return {
        type: 'error',
        requestId: (message as { requestId?: string }).requestId,
        code: 'UNSUPPORTED_ACTION',
        message: `Unsupported bridge action: ${(message as { type?: string }).type || 'unknown'}`,
      };
  }
}
