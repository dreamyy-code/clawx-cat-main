import type { RuntimeFacade } from '../runtime/runtime-facade';
import {
  classifyChatEventType,
  extractSessionKeyFromChatMessage,
  extractSessionKeyFromGatewayNotification,
  type BridgeServerMessage,
} from './protocol';

type BridgeRelaySubscriber = {
  emit: (payload: BridgeServerMessage) => void;
  getSessionKeys: () => Set<string> | null;
  isAuthenticated?: () => boolean;
};

export class BridgeEventRelay {
  private readonly subscribers = new Map<string, BridgeRelaySubscriber>();
  private readonly runtimeFacade: RuntimeFacade;

  constructor(runtimeFacade: RuntimeFacade) {
    this.runtimeFacade = runtimeFacade;
    this.attachGatewayBridges();
  }

  subscribe(id: string, subscriber: BridgeRelaySubscriber): () => void {
    this.subscribers.set(id, subscriber);
    return () => {
      this.subscribers.delete(id);
    };
  }

  private attachGatewayBridges(): void {
    this.runtimeFacade.gatewayManager.on('status', (status) => {
      this.broadcast({ type: 'gateway.status', status });
    });

    this.runtimeFacade.gatewayManager.on('notification', (notification) => {
      const rawEvent = notification as Record<string, unknown>;
      const sessionKey = extractSessionKeyFromGatewayNotification(rawEvent);

      this.broadcast({
        type: 'gateway.notification',
        sessionKey,
        event: rawEvent,
      }, sessionKey);

      const params = rawEvent.params && typeof rawEvent.params === 'object'
        ? rawEvent.params as Record<string, unknown>
        : null;
      const data = params?.data && typeof params.data === 'object'
        ? params.data as Record<string, unknown>
        : {};

      const normalizedEvent: Record<string, unknown> = {
        ...data,
        runId: params?.runId ?? data.runId,
        sessionKey: params?.sessionKey ?? data.sessionKey,
        stream: params?.stream ?? data.stream,
        seq: params?.seq ?? data.seq,
        state: params?.state ?? data.state,
        phase: params?.phase ?? data.phase,
        message: params?.message ?? data.message,
        errorMessage: params?.errorMessage ?? data.errorMessage,
      };

      if (normalizedEvent.state || normalizedEvent.phase || normalizedEvent.errorMessage) {
        const type = classifyChatEventType(normalizedEvent);
        if (type === 'chat.failed') {
          this.broadcast({
            type,
            sessionKey,
            error: String(normalizedEvent.errorMessage || normalizedEvent.error || 'Gateway event failed'),
            event: normalizedEvent,
          }, sessionKey);
        } else {
          this.broadcast({
            type,
            sessionKey,
            event: normalizedEvent,
          }, sessionKey);
        }
      }
    });

    this.runtimeFacade.gatewayManager.on('chat:message', (data) => {
      const rawEvent = data as Record<string, unknown>;
      const sessionKey = extractSessionKeyFromChatMessage(rawEvent);

      this.broadcast({
        type: 'gateway.chat-message',
        sessionKey,
        event: rawEvent,
      }, sessionKey);

      const payload = ('message' in rawEvent && typeof rawEvent.message === 'object')
        ? rawEvent.message as Record<string, unknown>
        : rawEvent;
      const normalized = {
        ...payload,
        state: payload.state ?? 'final',
        runId: rawEvent.runId ?? payload.runId,
        sessionKey: sessionKey ?? payload.sessionKey,
      };
      const type = classifyChatEventType(normalized);
      this.broadcast({
        type,
        sessionKey,
        ...(type === 'chat.failed'
          ? { error: String(normalized.errorMessage || normalized.error || 'Gateway chat message failed') }
          : {}),
        event: normalized,
      } as BridgeServerMessage, sessionKey);
    });

    this.runtimeFacade.gatewayManager.on('error', (error) => {
      this.broadcast({
        type: 'chat.failed',
        error: error.message,
      });
    });
  }

  private shouldReceive(subscriber: BridgeRelaySubscriber, sessionKey?: string): boolean {
    if (subscriber.isAuthenticated && !subscriber.isAuthenticated()) {
      return false;
    }
    const sessionKeys = subscriber.getSessionKeys();
    if (sessionKeys === null) return true;
    if (!sessionKey) return true;
    return sessionKeys.has(sessionKey);
  }

  private broadcast(payload: BridgeServerMessage, sessionKey?: string): void {
    for (const subscriber of this.subscribers.values()) {
      if (!this.shouldReceive(subscriber, sessionKey)) continue;
      subscriber.emit(payload);
    }
  }
}
