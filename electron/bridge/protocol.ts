export type BridgeClientMessage =
  | { type: 'auth'; requestId?: string; token?: string }
  | { type: 'bridge.info'; requestId?: string }
  | { type: 'bridge.status.get'; requestId?: string }
  | { type: 'ping'; requestId?: string }
  | { type: 'runtime.capabilities.get'; requestId?: string }
  | { type: 'agents.list'; requestId?: string }
  | {
      type: 'agents.create';
      requestId?: string;
      params?: {
        name?: string;
        inheritWorkspace?: boolean;
      };
    }
  | {
      type: 'agents.import.inspect';
      requestId?: string;
      params?: {
        zipPath?: string;
      };
    }
  | {
      type: 'agent.import.package';
      requestId?: string;
      params?: {
        agentId?: string;
        zipPath?: string;
        sourceAgentDirName?: string;
        sourceWorkspaceDirName?: string;
      };
    }
  | {
      type: 'agents.communication.update';
      requestId?: string;
      params?: {
        enabled?: boolean;
        allowedAgents?: string[];
      };
    }
  | {
      type: 'agent.communication.update';
      requestId?: string;
      params?: {
        agentId?: string;
        spawnTargets?: string[];
      };
    }
  | {
        type: 'agent.update';
        requestId?: string;
        params?: {
          agentId?: string;
          name?: string;
        };
      }
    | {
        type: 'agent.delete';
        requestId?: string;
        params?: {
          agentId?: string;
        };
      }
    | {
        type: 'agent.model.update';
      requestId?: string;
      params?: {
        agentId?: string;
        modelRef?: string | null;
      };
    }
  | {
      type: 'agent.instructions.sync';
      requestId?: string;
      params?: {
        agentId?: string;
      };
    }
  | { type: 'agents.instructions.syncAll'; requestId?: string }
  | { type: 'models.config.get'; requestId?: string }
  | {
      type: 'models.primary.set';
      requestId?: string;
      params?: {
        modelRef?: string;
      };
    }
  | {
      type: 'models.fallback.add';
      requestId?: string;
      params?: {
        modelRef?: string;
      };
    }
  | {
      type: 'models.fallback.remove';
      requestId?: string;
      params?: {
        modelRef?: string;
      };
    }
  | {
      type: 'models.providerModel.add';
      requestId?: string;
      params?: {
        providerKey?: string;
        modelId?: string;
      };
    }
  | {
      type: 'models.providerModel.remove';
      requestId?: string;
      params?: {
        providerKey?: string;
        modelId?: string;
      };
    }
  | {
      type: 'file.stageBuffer';
      requestId?: string;
      params?: {
        base64?: string;
        fileName?: string;
        mimeType?: string;
      };
    }
  | {
      type: 'file.stagePaths';
      requestId?: string;
      params?: {
        filePaths?: string[];
      };
    }
  | {
      type: 'file.read';
      requestId?: string;
      params?: {
        filePath?: string;
        mode?: 'base64' | 'text';
        maxBytes?: number;
      };
    }
  | {
      type: 'hostapi.fetch';
      requestId?: string;
      params?: {
        path?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      };
    }
  | {
      type: 'gateway.http';
      requestId?: string;
      params?: {
        path?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
        timeoutMs?: number;
      };
    }
  | { type: 'gateway.controlUi.get'; requestId?: string }
  | {
      type: 'gateway.rpc';
      requestId?: string;
      params?: {
        method?: string;
        params?: unknown;
        timeoutMs?: number;
      };
    }
  | { type: 'gateway.start'; requestId?: string }
  | { type: 'gateway.stop'; requestId?: string }
  | { type: 'gateway.restart'; requestId?: string }
  | { type: 'gateway.reload'; requestId?: string }
  | { type: 'gateway.health.get'; requestId?: string }
  | {
      type: 'chat.send';
      requestId?: string;
      params?: {
        sessionKey?: string;
        message?: string;
        deliver?: boolean;
        idempotencyKey?: string;
      };
    }
  | {
      type: 'chat.sendWithMedia';
      requestId?: string;
      params?: {
        sessionKey?: string;
        message?: string;
        deliver?: boolean;
        idempotencyKey?: string;
        media?: Array<{
          filePath?: string;
          mimeType?: string;
          fileName?: string;
        }>;
      };
    }
  | {
      type: 'chat.abort';
      requestId?: string;
      params?: {
        sessionKey?: string;
      };
    }
  | {
      type: 'session.transcript.get';
      requestId?: string;
      params?: {
        agentId?: string;
        sessionId?: string;
      };
    }
  | { type: 'session.listLocal'; requestId?: string }
  | { type: 'gateway.status.get'; requestId?: string }
  | {
      type: 'logs.get';
      requestId?: string;
      params?: {
        tailLines?: number;
      };
    }
  | { type: 'logs.files.get'; requestId?: string }
  | { type: 'logs.dir.get'; requestId?: string }
  | {
      type: 'session.subscribe';
      requestId?: string;
      params?: {
        sessionKeys?: string[];
        all?: boolean;
      };
    }
  | {
      type: 'session.delete';
      requestId?: string;
      params?: {
        sessionKey?: string;
      };
    };

export type BridgeServerMessage =
  | { type: 'auth.ok'; requestId?: string; mode: 'gui' | 'headless' }
  | { type: 'bridge.info'; requestId?: string; info: unknown }
  | { type: 'bridge.status'; requestId?: string; status: unknown }
  | { type: 'pong'; requestId?: string; ts: number }
  | { type: 'agents.list'; requestId?: string; snapshot: unknown }
  | { type: 'agents.created'; requestId?: string; snapshot: unknown }
  | { type: 'agents.import.inspected'; requestId?: string; inspection: unknown }
  | { type: 'agent.package.imported'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agents.communication.updated'; requestId?: string; snapshot: unknown }
  | { type: 'agent.communication.updated'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agent.updated'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agent.deleted'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agent.model.updated'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agent.instructions.synced'; requestId?: string; agentId: string; snapshot: unknown }
  | { type: 'agents.instructions.synced'; requestId?: string; snapshot: unknown }
  | { type: 'models.config'; requestId?: string; summary: unknown }
  | { type: 'models.primary.updated'; requestId?: string; modelRef: string; result: unknown }
  | { type: 'models.fallback.updated'; requestId?: string; operation: 'add' | 'remove'; modelRef: string; result: unknown }
  | { type: 'models.providerModel.updated'; requestId?: string; operation: 'add' | 'remove'; providerKey: string; modelId: string; result: unknown }
  | { type: 'gateway.status'; requestId?: string; status: unknown }
  | {
      type: 'gateway.http.result';
      requestId?: string;
      path: string;
      response: {
        status: number;
        ok: boolean;
        json?: unknown;
        text?: string;
      };
    }
  | { type: 'gateway.controlUi'; requestId?: string; info: unknown }
  | { type: 'gateway.health'; requestId?: string; health: unknown }
  | { type: 'gateway.started'; requestId?: string; status: unknown }
  | { type: 'gateway.stopped'; requestId?: string; status: unknown }
  | { type: 'gateway.restarted'; requestId?: string; status: unknown }
  | { type: 'gateway.reloaded'; requestId?: string; status: unknown }
  | { type: 'gateway.rpc.result'; requestId?: string; method: string; result: unknown }
  | { type: 'runtime.capabilities'; requestId?: string; capabilities: unknown }
  | {
      type: 'hostapi.result';
      requestId?: string;
      path: string;
      response: {
        status: number;
        ok: boolean;
        json?: unknown;
        text?: string;
      };
    }
  | {
      type: 'file.staged';
      requestId?: string;
      file: {
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      };
    }
  | {
      type: 'files.staged';
      requestId?: string;
      files: Array<{
        id: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
        stagedPath: string;
        preview: string | null;
      }>;
    }
  | {
      type: 'file.read.result';
      requestId?: string;
      file: {
        filePath: string;
        mode: 'base64' | 'text';
        mimeType?: string;
        fileSize: number;
        base64?: string;
        text?: string;
      };
    }
  | { type: 'chat.accepted'; requestId?: string; sessionKey: string; runId?: string }
  | { type: 'chat.delta'; sessionKey?: string; event: Record<string, unknown> }
  | { type: 'chat.completed'; sessionKey?: string; event: Record<string, unknown> }
  | { type: 'chat.failed'; sessionKey?: string; error: string; event?: Record<string, unknown> }
  | { type: 'chat.aborted'; sessionKey?: string; event?: Record<string, unknown> }
  | { type: 'gateway.notification'; sessionKey?: string; event: Record<string, unknown> }
  | { type: 'gateway.chat-message'; sessionKey?: string; event: Record<string, unknown> }
  | { type: 'session.list'; requestId?: string; sessions: unknown }
  | { type: 'session.transcript'; requestId?: string; transcript: unknown }
  | { type: 'session.subscribed'; requestId?: string; sessionKeys?: string[]; all: boolean }
  | { type: 'session.deleted'; requestId?: string; sessionKey: string; success: boolean; error?: string }
  | { type: 'logs.content'; requestId?: string; logs: unknown }
  | { type: 'logs.files'; requestId?: string; files: unknown }
  | { type: 'logs.dir'; requestId?: string; dir: unknown }
  | { type: 'error'; requestId?: string; code: string; message: string };

export const DEFAULT_BRIDGE_SESSION_KEY = 'agent:main:main';

export function parseBridgeClientMessage(raw: string): BridgeClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as BridgeClientMessage;
  } catch {
    return null;
  }
}

export function normalizeBridgeSessionKey(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return DEFAULT_BRIDGE_SESSION_KEY;
}

export function extractSessionKeyFromGatewayNotification(
  notification: Record<string, unknown>,
): string | undefined {
  const params = notification.params && typeof notification.params === 'object'
    ? notification.params as Record<string, unknown>
    : null;
  const data = params?.data && typeof params.data === 'object'
    ? params.data as Record<string, unknown>
    : null;
  const sessionKey = params?.sessionKey ?? data?.sessionKey;
  return typeof sessionKey === 'string' && sessionKey ? sessionKey : undefined;
}

export function extractSessionKeyFromChatMessage(
  payload: Record<string, unknown>,
): string | undefined {
  const direct = payload.sessionKey;
  if (typeof direct === 'string' && direct) return direct;

  const message = payload.message && typeof payload.message === 'object'
    ? payload.message as Record<string, unknown>
    : null;
  const nested = message?.sessionKey;
  return typeof nested === 'string' && nested ? nested : undefined;
}

export function classifyChatEventType(
  event: Record<string, unknown>,
): 'chat.delta' | 'chat.completed' | 'chat.failed' | 'chat.aborted' {
  const state = typeof event.state === 'string' ? event.state : '';
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const errorMessage = event.errorMessage ?? event.error;

  if (state === 'error' || phase === 'error' || phase === 'failed' || errorMessage) {
    return 'chat.failed';
  }
  if (state === 'aborted' || phase === 'aborted' || phase === 'cancelled' || phase === 'canceled') {
    return 'chat.aborted';
  }
  if (state === 'final' || phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    return 'chat.completed';
  }
  return 'chat.delta';
}
