import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '../utils/logger';
import type { RuntimeFacade } from '../runtime/runtime-facade';
import type { BridgeAuditEntry } from '../api/context';
import {
  parseBridgeClientMessage,
  type BridgeServerMessage,
} from './protocol';
import { executeBridgeClientMessage } from './dispatcher';
import type { BridgeEventRelay } from './event-relay';

type BridgeServerOptions = {
  runtimeFacade: RuntimeFacade;
  relay: BridgeEventRelay;
  mode: 'gui' | 'headless';
  port: number;
  host: string;
  token: string;
};

type BridgeClientState = {
  id: string;
  authenticated: boolean;
  sessionKeys: Set<string> | null;
  remoteAddress: string;
  userAgent?: string;
  connectedAt: number;
  lastSeenAt: number;
  unsubscribeFromRelay?: () => void;
};

export class BridgeServer {
  private static readonly MAX_AUDIT_ENTRIES = 300;
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, BridgeClientState>();
  private readonly auditLog: BridgeAuditEntry[] = [];
  private readonly runtimeFacade: RuntimeFacade;
  private readonly relay: BridgeEventRelay;
  private readonly mode: 'gui' | 'headless';
  private readonly token: string;
  private readonly host: string;
  private readonly port: number;

  constructor(options: BridgeServerOptions) {
    this.runtimeFacade = options.runtimeFacade;
    this.relay = options.relay;
    this.mode = options.mode;
    this.token = options.token;
    this.host = options.host;
    this.port = options.port;

    this.wss = new WebSocketServer({
      host: options.host,
      port: options.port,
    });

    this.wss.on('listening', () => {
      logger.info(`Bridge WebSocket listening on ws://${options.host}:${options.port} (mode=${this.mode})`);
    });

    this.wss.on('connection', (socket, request) => {
      const remoteAddress = request.socket.remoteAddress || 'unknown';
      const userAgent = request.headers['user-agent'];
      logger.info(`Bridge client connected from ${remoteAddress}`);
      const clientState = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        authenticated: false,
        sessionKeys: null,
        remoteAddress,
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      this.clients.set(socket, clientState);
      clientState.unsubscribeFromRelay = this.relay.subscribe(clientState.id, {
        emit: (payload) => this.send(socket, payload),
        getSessionKeys: () => this.clients.get(socket)?.sessionKeys ?? null,
        isAuthenticated: () => this.isAuthenticated(socket),
      });
      this.pushAudit({
        level: 'info',
        event: 'client.connected',
        clientId: clientState.id,
        remoteAddress: clientState.remoteAddress,
        details: clientState.userAgent,
      });

      socket.on('message', (data) => {
        void this.handleMessage(socket, data.toString()).catch((error) => {
          logger.warn('Bridge message handling failed:', error);
          const state = this.clients.get(socket);
          this.pushAudit({
            level: 'error',
            event: 'request.failed',
            clientId: state?.id,
            remoteAddress: state?.remoteAddress,
            details: String(error),
          });
          this.send(socket, {
            type: 'error',
            code: 'INTERNAL_ERROR',
            message: String(error),
          });
        });
      });

      socket.on('close', () => {
        const state = this.clients.get(socket);
        state?.unsubscribeFromRelay?.();
        this.pushAudit({
          level: 'info',
          event: 'client.disconnected',
          clientId: state?.id,
          remoteAddress: state?.remoteAddress,
        });
        this.clients.delete(socket);
      });
    });
  }

  close(): void {
    for (const socket of this.clients.keys()) {
      try {
        socket.close();
      } catch {
        // Ignore individual socket close failures.
      }
    }
    this.clients.clear();
    this.wss.close();
  }

  getClientSnapshot(): Array<{
    id: string;
    remoteAddress: string;
    userAgent?: string;
    authenticated: boolean;
    connectedAt: number;
    lastSeenAt: number;
  }> {
    return Array.from(this.clients.values())
      .map((state) => ({
        id: state.id,
        remoteAddress: state.remoteAddress,
        userAgent: state.userAgent,
        authenticated: state.authenticated,
        connectedAt: state.connectedAt,
        lastSeenAt: state.lastSeenAt,
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  getAuditLog(): BridgeAuditEntry[] {
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    const currentState = this.clients.get(socket);
    if (currentState) {
      currentState.lastSeenAt = Date.now();
    }

    const message = parseBridgeClientMessage(raw);
    if (!message) {
      this.pushAudit({
        level: 'warning',
        event: 'request.invalid_json',
        clientId: currentState?.id,
        remoteAddress: currentState?.remoteAddress,
      });
      this.send(socket, {
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Invalid bridge payload',
      });
      return;
    }

    if (message.type === 'auth') {
      if (!message.token || message.token !== this.token) {
        this.pushAudit({
          level: 'warning',
          event: 'auth.failed',
          clientId: currentState?.id,
          remoteAddress: currentState?.remoteAddress,
          requestId: message.requestId,
        });
        this.send(socket, {
          type: 'error',
          requestId: message.requestId,
          code: 'UNAUTHORIZED',
          message: 'Invalid bridge token',
        });
        socket.close();
        return;
      }

      const state = this.clients.get(socket);
      if (state) {
        state.authenticated = true;
        state.sessionKeys = null;
        state.lastSeenAt = Date.now();
      }
      this.pushAudit({
        level: 'info',
        event: 'auth.succeeded',
        clientId: state?.id,
        remoteAddress: state?.remoteAddress,
        requestId: message.requestId,
      });
      this.send(socket, {
        type: 'auth.ok',
        requestId: message.requestId,
        mode: this.mode,
      });
      this.send(socket, {
        type: 'gateway.status',
        status: this.runtimeFacade.getGatewayStatus(),
      });
      return;
    }

    if (!this.isAuthenticated(socket)) {
      this.pushAudit({
        level: 'warning',
        event: 'auth.required',
        clientId: currentState?.id,
        remoteAddress: currentState?.remoteAddress,
        requestId: message.requestId,
        action: message.type,
      });
      this.send(socket, {
        type: 'error',
        requestId: message.requestId,
        code: 'AUTH_REQUIRED',
        message: 'Send auth first',
      });
      return;
    }

    this.auditRequest(socket, message.type, message.requestId, message.type === 'gateway.rpc' ? message.params?.method : undefined);
    const state = this.clients.get(socket);
    const payload = await executeBridgeClientMessage(message, {
      runtimeFacade: this.runtimeFacade,
      mode: this.mode,
      host: this.host,
      port: this.port,
      token: this.token,
      transport: 'ws',
      sessionSubscription: {
        getSessionKeys: () => state?.sessionKeys ?? null,
        setSessionKeys: (value) => {
          if (state) {
            state.sessionKeys = value;
            state.lastSeenAt = Date.now();
          }
        },
      },
    });
    this.send(socket, payload);
  }

  private isAuthenticated(socket: WebSocket): boolean {
    return this.clients.get(socket)?.authenticated === true;
  }

  private send(socket: WebSocket, payload: BridgeServerMessage): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }
  private auditRequest(socket: WebSocket, action: string, requestId?: string, details?: string): void {
    const state = this.clients.get(socket);
    this.pushAudit({
      level: 'info',
      event: 'request.received',
      clientId: state?.id,
      remoteAddress: state?.remoteAddress,
      requestId,
      action,
      details,
    });
  }

  private pushAudit(entry: Omit<BridgeAuditEntry, 'id' | 'ts'>): void {
    this.auditLog.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...entry,
    });
    if (this.auditLog.length > BridgeServer.MAX_AUDIT_ENTRIES) {
      this.auditLog.length = BridgeServer.MAX_AUDIT_ENTRIES;
    }
  }
}
