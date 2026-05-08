import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const RELAY_HOST = process.env.CLAWX_RELAY_HOST || '127.0.0.1';
const RELAY_PORT = Number(process.env.CLAWX_RELAY_PORT || 19089);
const DEVICE_TOKEN = process.env.CLAWX_RELAY_DEVICE_TOKEN || process.env.CLAWX_RELAY_TOKEN || '';
const USER_TOKEN = process.env.CLAWX_RELAY_USER_TOKEN || '';

/** @typedef {{ socket: import('ws').WebSocket, deviceId: string, deviceName?: string, capabilities?: unknown, bridgeStatus?: unknown, connectedAt: number, lastSeenAt: number }} DeviceConnection */
/** @typedef {{ socket: import('ws').WebSocket, userId: string, selectedDeviceId?: string, connectedAt: number }} UserConnection */

/** @type {Map<string, DeviceConnection>} */
const devices = new Map();
/** @type {Map<import('ws').WebSocket, UserConnection>} */
const users = new Map();
/** @type {Map<string, { userSocket: import('ws').WebSocket, deviceId: string, action: string }>} */
const pendingRequests = new Map();

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

function broadcastDeviceList() {
  const list = Array.from(devices.values()).map((device) => ({
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    connectedAt: device.connectedAt,
    lastSeenAt: device.lastSeenAt,
    capabilities: device.capabilities,
    bridgeStatus: device.bridgeStatus,
  }));

  for (const user of users.values()) {
    sendJson(user.socket, {
      type: 'user.devices',
      devices: list,
    });
  }
}

function getDevice(deviceId) {
  return deviceId ? devices.get(deviceId) || null : null;
}

const wss = new WebSocketServer({
  host: RELAY_HOST,
  port: RELAY_PORT,
});

wss.on('listening', () => {
  console.log(`Mock cloud relay listening on ws://${RELAY_HOST}:${RELAY_PORT}`);
});

wss.on('connection', (socket, request) => {
  const remoteAddress = request.socket.remoteAddress || 'unknown';
  console.log(`Connection from ${remoteAddress}`);

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
      if (DEVICE_TOKEN && payload.token !== DEVICE_TOKEN) {
        sendJson(socket, {
          type: 'error',
          requestId: payload.requestId,
          message: 'Invalid device token',
        });
        socket.close();
        return;
      }

      const deviceId = typeof payload.deviceId === 'string' && payload.deviceId.trim()
        ? payload.deviceId.trim()
        : `device-${randomUUID()}`;

      devices.set(deviceId, {
        socket,
        deviceId,
        deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : deviceId,
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
      console.log(`Device registered: ${deviceId}`);
      broadcastDeviceList();
      return;
    }

    if (payload.type === 'device.heartbeat') {
      const deviceId = socket.__relayDeviceId;
      const entry = getDevice(deviceId);
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

      if (payload.type === 'relay.result' && pending) {
        pendingRequests.delete(payload.requestId);
      }

      if (pending && pending.userSocket.readyState === 1) {
        sendJson(pending.userSocket, payload);
      }
      return;
    }

    if (payload.type === 'user.auth') {
      if (USER_TOKEN && payload.token !== USER_TOKEN) {
        sendJson(socket, {
          type: 'error',
          requestId: payload.requestId,
          message: 'Invalid user token',
        });
        socket.close();
        return;
      }

      const userId = typeof payload.userId === 'string' && payload.userId.trim()
        ? payload.userId.trim()
        : `user-${randomUUID().slice(0, 8)}`;

      users.set(socket, {
        socket,
        userId,
        connectedAt: Date.now(),
      });
      socket.__relayRole = 'user';

      sendJson(socket, {
        type: 'user.auth.ok',
        requestId: payload.requestId,
        userId,
      });
      broadcastDeviceList();
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
      broadcastDeviceList();
      return;
    }

    if (payload.type === 'user.device.bind') {
      const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
      if (!getDevice(deviceId)) {
        sendJson(socket, {
          type: 'error',
          requestId: payload.requestId,
          message: `Device not found: ${deviceId}`,
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
      const device = getDevice(deviceId);
      if (!device) {
        sendJson(socket, {
          type: 'error',
          requestId: payload.requestId,
          message: `Target device unavailable: ${deviceId || 'none'}`,
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
        deviceId,
        action: payload.payload.type,
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
      console.log(`User disconnected: ${user.userId}`);
      return;
    }

    const deviceId = socket.__relayDeviceId;
    if (deviceId && devices.has(deviceId)) {
      devices.delete(deviceId);
      console.log(`Device disconnected: ${deviceId}`);
      broadcastDeviceList();
    }
  });
});
