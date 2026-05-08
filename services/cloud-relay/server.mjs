import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { RelayStore } from './store.mjs';

const RELAY_HOST = process.env.CLAWX_RELAY_HOST || '127.0.0.1';
const RELAY_PORT = Number(process.env.CLAWX_RELAY_PORT || 19089);
const ADMIN_TOKEN = process.env.CLAWX_RELAY_ADMIN_TOKEN || '';
const STORE_PATH = resolve(
  process.env.CLAWX_RELAY_STORE_PATH || 'services/cloud-relay/data/store.json',
);

/** @typedef {{ socket: import('ws').WebSocket, deviceId: string, deviceName?: string, capabilities?: unknown, bridgeStatus?: unknown, connectedAt: number, lastSeenAt: number }} DeviceConnection */
/** @typedef {{ socket: import('ws').WebSocket, userId: string, name?: string, selectedDeviceId?: string, connectedAt: number }} UserConnection */

const store = new RelayStore(STORE_PATH);
/** @type {Map<string, DeviceConnection>} */
const devices = new Map();
/** @type {Map<import('ws').WebSocket, UserConnection>} */
const users = new Map();
/** @type {Map<string, { userSocket: import('ws').WebSocket, userId: string, deviceId: string, action: string, createdAt: number }>} */
const pendingRequests = new Map();

function isTerminalRelayEvent(payload) {
  const message = payload?.message;
  const type = message && typeof message === 'object' ? message.type : undefined;
  return type === 'chat.completed' || type === 'chat.failed' || type === 'chat.aborted';
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildDeviceList(userId = '') {
  const allowedBindings = userId
    ? new Set(store.listBindingsForUser(userId).map((item) => item.deviceId))
    : null;
  return Array.from(devices.values())
    .filter((device) => !allowedBindings || allowedBindings.has(device.deviceId))
    .map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      connectedAt: device.connectedAt,
      lastSeenAt: device.lastSeenAt,
      capabilities: device.capabilities,
      bridgeStatus: device.bridgeStatus,
    }));
}

function broadcastDeviceList() {
  for (const user of users.values()) {
    sendJson(user.socket, {
      type: 'user.devices',
      devices: buildDeviceList(user.userId),
    });
  }
}

function requireAdmin(req, url) {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = bearer || url.searchParams.get('token') || '';
  return ADMIN_TOKEN ? token === ADMIN_TOKEN : true;
}

function findOnlineDevice(deviceId) {
  return deviceId ? devices.get(deviceId) || null : null;
}

async function parseRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function handleHttpRequest(req, res) {
  const url = new URL(req.url || '/', `http://${RELAY_HOST}:${RELAY_PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      relayHost: RELAY_HOST,
      relayPort: RELAY_PORT,
      onlineDevices: devices.size,
      onlineUsers: users.size,
      pendingRequests: pendingRequests.size,
      storePath: STORE_PATH,
    });
    return;
  }

  if (!requireAdmin(req, url)) {
    json(res, 401, { success: false, error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/devices') {
    json(res, 200, {
      devices: buildDeviceList(),
      storedTokens: store.listDeviceTokens(),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    json(res, 200, {
      users: store.listUsers(),
      onlineUsers: Array.from(users.values()).map((item) => ({
        userId: item.userId,
        name: item.name,
        selectedDeviceId: item.selectedDeviceId,
        connectedAt: item.connectedAt,
      })),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/bindings') {
    json(res, 200, {
      bindings: store.listBindings(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/users') {
    const body = await parseRequestBody(req);
    if (typeof body.userId !== 'string' || !body.userId.trim()) {
      json(res, 400, { success: false, error: 'userId is required' });
      return;
    }
    const user = await store.upsertUser({
      userId: body.userId.trim(),
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      token: typeof body.token === 'string' ? body.token.trim() : undefined,
    });
    json(res, 200, { success: true, user });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/device-tokens') {
    const body = await parseRequestBody(req);
    if (typeof body.deviceId !== 'string' || !body.deviceId.trim()) {
      json(res, 400, { success: false, error: 'deviceId is required' });
      return;
    }
    const entry = await store.upsertDeviceToken({
      deviceId: body.deviceId.trim(),
      deviceName: typeof body.deviceName === 'string' ? body.deviceName.trim() : undefined,
      token: typeof body.token === 'string' ? body.token.trim() : undefined,
    });
    json(res, 200, { success: true, deviceToken: entry });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/bindings') {
    const body = await parseRequestBody(req);
    if (typeof body.userId !== 'string' || !body.userId.trim() || typeof body.deviceId !== 'string' || !body.deviceId.trim()) {
      json(res, 400, { success: false, error: 'userId and deviceId are required' });
      return;
    }
    const bindings = await store.bindUserToDevice({
      userId: body.userId.trim(),
      deviceId: body.deviceId.trim(),
    });
    json(res, 200, { success: true, bindings });
    return;
  }

  json(res, 404, { success: false, error: `No route for ${req.method} ${url.pathname}` });
}

async function main() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await store.load();

  const server = createServer((req, res) => {
    void handleHttpRequest(req, res).catch((error) => {
      json(res, 500, {
        success: false,
        error: String(error),
      });
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${RELAY_HOST}:${RELAY_PORT}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket, request) => {
    const remoteAddress = request.socket.remoteAddress || 'unknown';
    console.log(`Relay connection from ${remoteAddress}`);

    socket.on('message', (buffer) => {
      const payload = safeParse(buffer.toString());
      if (!payload || typeof payload.type !== 'string') {
        sendJson(socket, {
          type: 'error',
          message: 'Invalid JSON payload',
        });
        return;
      }

      if (payload.type === 'device.register') {
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const entry = store.getDeviceTokenEntry(token);
        if (!entry) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: 'Invalid device token',
          });
          socket.close();
          return;
        }

        const deviceId = entry.deviceId;
        devices.set(deviceId, {
          socket,
          deviceId,
          deviceName: typeof payload.deviceName === 'string' && payload.deviceName.trim()
            ? payload.deviceName.trim()
            : entry.deviceName || deviceId,
          capabilities: payload.capabilities,
          bridgeStatus: payload.bridgeStatus,
          connectedAt: Date.now(),
          lastSeenAt: Date.now(),
        });

        socket.__relayRole = 'device';
        socket.__relayDeviceId = deviceId;

        sendJson(socket, {
          type: 'device.registered',
          requestId: payload.requestId,
          deviceId,
        });
        broadcastDeviceList();
        return;
      }

      if (payload.type === 'device.heartbeat') {
        const deviceId = socket.__relayDeviceId;
        const entry = findOnlineDevice(deviceId);
        if (!entry) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: 'Device not registered',
          });
          return;
        }
        entry.lastSeenAt = Date.now();
        entry.bridgeStatus = payload.bridgeStatus ?? entry.bridgeStatus;
        sendJson(socket, {
          type: 'relay.ping',
          requestId: payload.requestId,
        });
        broadcastDeviceList();
        return;
      }

      if (payload.type === 'relay.result' || payload.type === 'relay.event') {
        const pending = typeof payload.requestId === 'string'
          ? pendingRequests.get(payload.requestId) || null
          : null;
        if (pending && pending.userSocket.readyState === 1) {
          sendJson(pending.userSocket, payload);
        }
        if (payload.type === 'relay.event' && pending && isTerminalRelayEvent(payload)) {
          pendingRequests.delete(payload.requestId);
        }
        return;
      }

      if (payload.type === 'user.auth') {
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        const user = store.getUserByToken(token);
        if (!user) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: 'Invalid user token',
          });
          socket.close();
          return;
        }

        users.set(socket, {
          socket,
          userId: user.userId,
          name: user.name,
          connectedAt: Date.now(),
        });
        socket.__relayRole = 'user';
        socket.__relayUserId = user.userId;

        sendJson(socket, {
          type: 'user.auth.ok',
          requestId: payload.requestId,
          userId: user.userId,
          name: user.name,
        });
        sendJson(socket, {
          type: 'user.devices',
          devices: buildDeviceList(user.userId),
        });
        return;
      }

      const user = users.get(socket);
      if (!user) {
        sendJson(socket, {
          type: 'error',
          requestId: payload.requestId,
          message: 'Authenticate as user first',
        });
        return;
      }

      if (payload.type === 'user.devices.get') {
        sendJson(socket, {
          type: 'user.devices',
          devices: buildDeviceList(user.userId),
        });
        return;
      }

      if (payload.type === 'user.device.bind') {
        const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
        const allowed = store.listBindingsForUser(user.userId).some((item) => item.deviceId === deviceId);
        if (!allowed) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: `Device not bound to user: ${deviceId}`,
          });
          return;
        }
        user.selectedDeviceId = deviceId;
        sendJson(socket, {
          type: 'user.device.bound',
          requestId: payload.requestId,
          deviceId,
        });
        return;
      }

      if (payload.type === 'user.call') {
        const deviceId = typeof payload.deviceId === 'string' && payload.deviceId.trim()
          ? payload.deviceId.trim()
          : (user.selectedDeviceId || '');
        const allowed = store.listBindingsForUser(user.userId).some((item) => item.deviceId === deviceId);
        if (!allowed) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: `Device not bound to user: ${deviceId || 'none'}`,
          });
          return;
        }

        const device = findOnlineDevice(deviceId);
        if (!device) {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: `Target device offline: ${deviceId}`,
          });
          return;
        }

        if (!payload.payload || typeof payload.payload !== 'object' || typeof payload.payload.type !== 'string') {
          sendJson(socket, {
            type: 'error',
            requestId: payload.requestId,
            message: 'user.call requires payload.type',
          });
          return;
        }

        const relayRequestId = payload.requestId || randomUUID();
        pendingRequests.set(relayRequestId, {
          userSocket: socket,
          userId: user.userId,
          deviceId,
          action: payload.payload.type,
          createdAt: Date.now(),
        });
        sendJson(device.socket, {
          type: 'relay.call',
          requestId: relayRequestId,
          payload: payload.payload,
        });
        return;
      }

      if (payload.type === 'ping') {
        sendJson(socket, {
          type: 'pong',
          requestId: payload.requestId,
          ts: Date.now(),
        });
        return;
      }

      sendJson(socket, {
        type: 'error',
        requestId: payload.requestId,
        message: `Unknown message type: ${payload.type}`,
      });
    });

    socket.on('close', () => {
      const user = users.get(socket);
      if (user) {
        users.delete(socket);
        return;
      }
      const deviceId = socket.__relayDeviceId;
      if (deviceId && devices.has(deviceId)) {
        devices.delete(deviceId);
        broadcastDeviceList();
      }
    });
  });

  server.listen(RELAY_PORT, RELAY_HOST, () => {
    console.log(`Cloud relay service listening on http://${RELAY_HOST}:${RELAY_PORT}`);
    console.log(`WebSocket endpoint: ws://${RELAY_HOST}:${RELAY_PORT}/ws`);
    console.log(`Store path: ${STORE_PATH}`);
  });
}

main().catch((error) => {
  console.error('Cloud relay service failed:', error);
  process.exit(1);
});
