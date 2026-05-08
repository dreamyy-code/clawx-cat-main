import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger';
import { parseJsonBody, requireJsonContentType, sendJson } from '../api/route-utils';
import type { RuntimeFacade } from '../runtime/runtime-facade';
import type { BridgeAuditEntry } from '../api/context';
import { executeBridgeClientMessage } from './dispatcher';
import { parseBridgeClientMessage, type BridgeServerMessage } from './protocol';
import type { BridgeEventRelay } from './event-relay';

type HttpBridgeServerOptions = {
  runtimeFacade: RuntimeFacade;
  relay: BridgeEventRelay;
  mode: 'gui' | 'headless';
  port: number;
  host: string;
  token: string;
};

type HttpBridgeClientState = {
  id: string;
  sessionKeys: Set<string> | null;
  remoteAddress: string;
  userAgent?: string;
  connectedAt: number;
  lastSeenAt: number;
  sseClients: Set<ServerResponse>;
};

export class HttpBridgeServer {
  private static readonly MAX_AUDIT_ENTRIES = 300;

  private readonly server: Server;
  private readonly clients = new Map<string, HttpBridgeClientState>();
  private readonly auditLog: BridgeAuditEntry[] = [];
  private readonly runtimeFacade: RuntimeFacade;
  private readonly relay: BridgeEventRelay;
  private readonly mode: 'gui' | 'headless';
  private readonly token: string;
  private readonly host: string;
  private readonly port: number;

  constructor(options: HttpBridgeServerOptions) {
    this.runtimeFacade = options.runtimeFacade;
    this.relay = options.relay;
    this.mode = options.mode;
    this.token = options.token;
    this.host = options.host;
    this.port = options.port;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((error) => {
        logger.warn('HTTP bridge request failed:', error);
        this.pushAudit({
          level: 'error',
          event: 'request.failed',
          details: String(error),
        });
        if (!res.headersSent) {
          sendJson(res, 500, {
            type: 'error',
            code: 'INTERNAL_ERROR',
            message: String(error),
          });
        } else {
          res.end();
        }
      });
    });

    this.server.on('error', (error) => {
      logger.error('HTTP Bridge server error:', error);
    });

    this.server.listen(options.port, options.host, () => {
      logger.info(`HTTP Bridge listening on http://${options.host}:${options.port}`);
    });
  }

  close(): void {
    for (const state of this.clients.values()) {
      for (const res of state.sseClients) {
        try {
          res.end();
        } catch {
          // Ignore individual client close failures.
        }
      }
      state.sseClients.clear();
    }
    this.clients.clear();
    this.server.close();
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
      .filter((state) => state.sseClients.size > 0)
      .map((state) => ({
        id: state.id,
        remoteAddress: state.remoteAddress,
        userAgent: state.userAgent,
        authenticated: true,
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const remoteAddress = req.socket.remoteAddress || 'unknown';
    const userAgent = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'];
    const bridgeToken = this.getBearerToken(req, requestUrl);
    if (!bridgeToken || bridgeToken !== this.token) {
      this.pushAudit({
        level: 'warning',
        event: 'auth.failed',
        remoteAddress,
        details: req.method,
      });
      sendJson(res, 401, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: 'Invalid bridge token',
      });
      return;
    }

    if (requestUrl.pathname === '/api/bridge-http/command' && req.method === 'POST') {
      if (!requireJsonContentType(req)) {
        sendJson(res, 415, {
          type: 'error',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type must be application/json',
        });
        return;
      }

      const rawMessage = await parseJsonBody<Record<string, unknown>>(req);
      const message = parseBridgeClientMessage(JSON.stringify(rawMessage));
      if (!message) {
        this.pushAudit({
          level: 'warning',
          event: 'request.invalid_json',
          remoteAddress,
        });
        sendJson(res, 400, {
          type: 'error',
          code: 'INVALID_JSON',
          message: 'Invalid bridge payload',
        });
        return;
      }

      const state = this.getOrCreateClientState(req, requestUrl, remoteAddress, userAgent);
      this.auditRequest(state, message.type, message.requestId);
      const payload = await executeBridgeClientMessage(message, {
        runtimeFacade: this.runtimeFacade,
        mode: this.mode,
        host: this.host,
        port: this.port,
        token: this.token,
        transport: 'http',
        sessionSubscription: {
          getSessionKeys: () => state.sessionKeys,
          setSessionKeys: (value) => {
            state.sessionKeys = value;
            state.lastSeenAt = Date.now();
          },
        },
      });
      res.setHeader('X-ClawX-Bridge-Client-Id', state.id);
      sendJson(res, 200, payload);
      return;
    }

    if (requestUrl.pathname === '/api/bridge-http/events' && req.method === 'GET') {
      const state = this.getOrCreateClientState(req, requestUrl, remoteAddress, userAgent);
      const sessionKeyQuery = requestUrl.searchParams.getAll('sessionKey').map((value) => value.trim()).filter(Boolean);
      if (sessionKeyQuery.length > 0) {
        state.sessionKeys = new Set(sessionKeyQuery);
      }

      req.socket.setTimeout(0);
      req.socket.setKeepAlive(true, 15_000);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-ClawX-Bridge-Client-Id': state.id,
      });
      res.flushHeaders?.();
      res.write('retry: 1000\n');
      res.write(': connected\n\n');
      state.sseClients.add(res);
      state.lastSeenAt = Date.now();
      this.pushAudit({
        level: 'info',
        event: 'client.connected',
        clientId: state.id,
        remoteAddress: state.remoteAddress,
        details: state.userAgent,
      });

      const unsubscribe = this.relay.subscribe(`http:${state.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, {
        emit: (payload) => this.emitSse(res, payload),
        getSessionKeys: () => state.sessionKeys,
      });
      const heartbeatTimer = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          return;
        }
        try {
          res.write(`: keepalive ${Date.now()}\n\n`);
        } catch {
          try {
            res.end();
          } catch {
            // Ignore heartbeat shutdown failures.
          }
        }
      }, 10_000);
      this.emitSse(res, {
        type: 'gateway.status',
        status: this.runtimeFacade.getGatewayStatus(),
      });

      res.on('close', () => {
        clearInterval(heartbeatTimer);
        unsubscribe();
        state.sseClients.delete(res);
        state.lastSeenAt = Date.now();
        this.pushAudit({
          level: 'info',
          event: 'client.disconnected',
          clientId: state.id,
          remoteAddress: state.remoteAddress,
        });
        if (state.sseClients.size === 0) {
          this.clients.delete(state.id);
        }
      });
      return;
    }

    if (requestUrl.pathname === '/api/bridge-http/info' && req.method === 'GET') {
      sendJson(res, 200, {
        mode: this.mode,
        host: this.host,
        port: this.port,
        bridgeUrl: `http://${this.host}:${this.port}`,
        eventsUrl: `http://${this.host}:${this.port}/api/bridge-http/events`,
        hasToken: Boolean(this.token),
        status: this.runtimeFacade.getBridgeStatus(),
        capabilities: this.runtimeFacade.getCapabilities(),
      });
      return;
    }

    if (requestUrl.pathname === '/api/bridge-http/status' && req.method === 'GET') {
      sendJson(res, 200, this.runtimeFacade.getBridgeStatus());
      return;
    }

    sendJson(res, 404, {
      type: 'error',
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${requestUrl.pathname}`,
    });
  }

  private getOrCreateClientState(
    req: IncomingMessage,
    requestUrl: URL,
    remoteAddress: string,
    userAgent?: string,
  ): HttpBridgeClientState {
    const suppliedClientId = req.headers['x-clawx-bridge-client-id'];
    const headerClientId = Array.isArray(suppliedClientId) ? suppliedClientId[0] : suppliedClientId;
    const clientId = headerClientId?.trim()
      || requestUrl.searchParams.get('clientId')?.trim()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = this.clients.get(clientId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return existing;
    }
    const state: HttpBridgeClientState = {
      id: clientId,
      sessionKeys: null,
      remoteAddress,
      userAgent,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
      sseClients: new Set(),
    };
    this.clients.set(clientId, state);
    return state;
  }

  private emitSse(res: ServerResponse, payload: BridgeServerMessage): void {
    try {
      const data = JSON.stringify(payload);
      res.write(`event: ${payload.type}\n`);
      res.write(`data: ${data}\n\n`);
    } catch {
      try {
        res.end();
      } catch {
        // Ignore SSE shutdown failures.
      }
    }
  }

  private auditRequest(state: HttpBridgeClientState, action: string, requestId?: string, details?: string): void {
    this.pushAudit({
      level: 'info',
      event: 'request.received',
      clientId: state.id,
      remoteAddress: state.remoteAddress,
      requestId,
      action,
      details,
    });
  }

  private getBearerToken(req: IncomingMessage, requestUrl: URL): string {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return requestUrl.searchParams.get('token')?.trim() || '';
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ClawX-Bridge-Client-Id');
  }

  private pushAudit(entry: Omit<BridgeAuditEntry, 'id' | 'ts'>): void {
    this.auditLog.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...entry,
    });
    if (this.auditLog.length > HttpBridgeServer.MAX_AUDIT_ENTRIES) {
      this.auditLog.length = HttpBridgeServer.MAX_AUDIT_ENTRIES;
    }
  }
}
