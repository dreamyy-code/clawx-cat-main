import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { BridgeClientMessage, BridgeServerMessage } from '../bridge/protocol';
import type { BridgeRelayStatus, BridgeRuntimeStatus } from '../api/context';
import { logger } from '../utils/logger';

type RelayEnvelope =
  | { type: 'relay.call'; requestId?: string; payload?: BridgeClientMessage }
  | { type: 'relay.ping'; requestId?: string }
  | { type: 'device.registered'; requestId?: string }
  | { type: 'device.auth.ok'; requestId?: string }
  | { type: 'auth.ok'; requestId?: string }
  | { type: 'error'; requestId?: string; message?: string };

type PendingRelayRequest = {
  relayRequestId: string;
  action: string;
};

type CloudRelayClientOptions = {
  enabled: boolean;
  relayUrl: string;
  relayToken: string;
  deviceId: string;
  deviceName: string;
  getBridgeStatus: () => BridgeRuntimeStatus;
  getBridgeToken: () => string;
  getCapabilities: () => unknown;
  onStatusChange?: (status: BridgeRelayStatus) => void;
  heartbeatIntervalMs?: number;
};

function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/ws';
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

function parseRelayEnvelope(raw: string): RelayEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as RelayEnvelope;
  } catch {
    return null;
  }
}

export class CloudRelayClient {
  private readonly options: CloudRelayClientOptions;
  private relaySocket: WebSocket | null = null;
  private bridgeSocket: WebSocket | null = null;
  private bridgeReadyPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, PendingRelayRequest>();
  private desiredRunning = false;
  private status: BridgeRelayStatus;

  constructor(options: CloudRelayClientOptions) {
    this.options = options;
    this.status = {
      enabled: options.enabled,
      running: false,
      connected: false,
      url: normalizeRelayUrl(options.relayUrl),
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      reconnectAttempts: 0,
    };
  }

  getStatus(): BridgeRelayStatus {
    return { ...this.status };
  }

  start(): void {
    if (!this.options.enabled || this.desiredRunning) {
      return;
    }
    this.desiredRunning = true;
    this.status = {
      ...this.status,
      enabled: true,
      running: true,
      url: normalizeRelayUrl(this.options.relayUrl),
      lastError: undefined,
    };
    this.emitStatus();
    void this.connectRelay();
  }

  stop(): void {
    this.desiredRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.relaySocket) {
      this.relaySocket.removeAllListeners();
      this.relaySocket.close();
      this.relaySocket = null;
    }
    this.closeBridgeSocket();
    this.pendingRequests.clear();
    this.status = {
      ...this.status,
      running: false,
      connected: false,
    };
    this.emitStatus();
  }

  private async connectRelay(): Promise<void> {
    if (!this.desiredRunning || this.relaySocket) {
      return;
    }

    const socket = new WebSocket(normalizeRelayUrl(this.options.relayUrl));
    this.relaySocket = socket;

    socket.on('open', () => {
      this.status = {
        ...this.status,
        connected: true,
        connectedAt: Date.now(),
        lastError: undefined,
      };
      this.emitStatus();
      this.sendRelayMessage({
        type: 'device.register',
        requestId: randomUUID(),
        token: this.options.relayToken,
        deviceId: this.options.deviceId,
        deviceName: this.options.deviceName,
        capabilities: this.options.getCapabilities(),
        bridgeStatus: this.options.getBridgeStatus(),
      });
      this.startHeartbeatLoop();
    });

    socket.on('message', (data) => {
      void this.handleRelayMessage(data.toString()).catch((error) => {
        logger.warn(`Cloud relay message handling failed: ${String(error)}`);
        this.sendRelayMessage({
          type: 'error',
          message: String(error),
        });
      });
    });

    socket.on('close', () => {
      if (this.relaySocket === socket) {
        this.relaySocket = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      this.status = {
        ...this.status,
        connected: false,
      };
      this.emitStatus();
      this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      this.status = {
        ...this.status,
        lastError: String(error),
      };
      this.emitStatus();
      logger.warn(`Cloud relay socket error: ${String(error)}`);
    });
  }

  private async handleRelayMessage(raw: string): Promise<void> {
    const envelope = parseRelayEnvelope(raw);
    if (!envelope) {
      return;
    }

    if (envelope.type === 'relay.ping') {
      this.sendRelayMessage({
        type: 'relay.pong',
        requestId: envelope.requestId,
        ts: Date.now(),
      });
      return;
    }

    if (
      envelope.type === 'device.registered'
      || envelope.type === 'device.auth.ok'
      || envelope.type === 'auth.ok'
    ) {
      this.status = {
        ...this.status,
        connected: true,
        connectedAt: this.status.connectedAt || Date.now(),
        lastError: undefined,
      };
      this.emitStatus();
      return;
    }

    if (envelope.type === 'error') {
      this.status = {
        ...this.status,
        lastError: envelope.message || 'Relay server error',
      };
      this.emitStatus();
      return;
    }

    if (envelope.type !== 'relay.call' || !envelope.payload) {
      return;
    }

    await this.ensureBridgeConnected();

    const localRequestId = envelope.payload.requestId?.trim() || randomUUID();
    const payload: BridgeClientMessage = {
      ...envelope.payload,
      requestId: localRequestId,
    };
    this.pendingRequests.set(localRequestId, {
      relayRequestId: envelope.requestId || localRequestId,
      action: payload.type,
    });
    this.bridgeSocket?.send(JSON.stringify(payload));
  }

  private async ensureBridgeConnected(): Promise<void> {
    const bridgeStatus = this.options.getBridgeStatus();
    if (!bridgeStatus.running) {
      throw new Error('Local bridge is not running');
    }
    if (this.bridgeSocket && this.bridgeSocket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.bridgeReadyPromise) {
      return await this.bridgeReadyPromise;
    }

    this.bridgeReadyPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${bridgeStatus.port}`);
      let authenticated = false;
      const authRequestId = `relay-auth-${randomUUID()}`;

      const cleanup = () => {
        socket.removeAllListeners();
        if (this.bridgeSocket === socket && !authenticated) {
          this.bridgeSocket = null;
        }
        this.bridgeReadyPromise = null;
      };

      socket.on('open', () => {
        this.bridgeSocket = socket;
        socket.send(JSON.stringify({
          type: 'auth',
          requestId: authRequestId,
          token: this.options.getBridgeToken(),
        }));
      });

      socket.on('message', (data) => {
        void this.handleBridgeMessage(data.toString());
        try {
          const parsed = JSON.parse(data.toString()) as BridgeServerMessage & { requestId?: string };
          if (parsed.type === 'auth.ok' && parsed.requestId === authRequestId) {
            authenticated = true;
            resolve();
          } else if (parsed.type === 'error' && parsed.requestId === authRequestId) {
            reject(new Error(parsed.message));
          }
        } catch {
          // Ignore malformed payloads here; they are handled by handleBridgeMessage.
        }
      });

      socket.on('close', () => {
        cleanup();
      });

      socket.on('error', (error) => {
        cleanup();
        reject(error);
      });
    });

    return await this.bridgeReadyPromise;
  }

  private async handleBridgeMessage(raw: string): Promise<void> {
    const relaySocket = this.relaySocket;
    if (!relaySocket || relaySocket.readyState !== WebSocket.OPEN) {
      return;
    }

    let parsed: (BridgeServerMessage & { requestId?: string; sessionKey?: string }) | null = null;
    try {
      parsed = JSON.parse(raw) as BridgeServerMessage & { requestId?: string; sessionKey?: string };
    } catch {
      return;
    }
    if (!parsed) {
      return;
    }

    if (parsed.requestId && this.pendingRequests.has(parsed.requestId)) {
      const pending = this.pendingRequests.get(parsed.requestId)!;
      this.pendingRequests.delete(parsed.requestId);
      this.sendRelayMessage({
        type: 'relay.result',
        requestId: pending.relayRequestId,
        action: pending.action,
        message: parsed,
      });
      return;
    }

    this.sendRelayMessage({
      type: 'relay.event',
      action: parsed.type,
      sessionKey: parsed.sessionKey,
      message: parsed,
    });
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      this.status = {
        ...this.status,
        lastHeartbeatAt: Date.now(),
      };
      this.emitStatus();
      this.sendRelayMessage({
        type: 'device.heartbeat',
        requestId: randomUUID(),
        ts: Date.now(),
        bridgeStatus: this.options.getBridgeStatus(),
      });
    }, this.options.heartbeatIntervalMs ?? 20_000);
    this.heartbeatTimer.unref();
  }

  private scheduleReconnect(): void {
    if (!this.desiredRunning || this.reconnectTimer) {
      return;
    }
    const reconnectAttempts = (this.status.reconnectAttempts || 0) + 1;
    const delayMs = Math.min(30_000, reconnectAttempts * 3_000);
    this.status = {
      ...this.status,
      reconnectAttempts,
      running: true,
    };
    this.emitStatus();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectRelay();
    }, delayMs);
    this.reconnectTimer.unref();
  }

  private sendRelayMessage(payload: Record<string, unknown>): void {
    if (!this.relaySocket || this.relaySocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.relaySocket.send(JSON.stringify(payload));
  }

  private closeBridgeSocket(): void {
    if (this.bridgeSocket) {
      this.bridgeSocket.removeAllListeners();
      this.bridgeSocket.close();
      this.bridgeSocket = null;
    }
    this.bridgeReadyPromise = null;
  }

  private emitStatus(): void {
    this.options.onStatusChange?.(this.getStatus());
  }
}
