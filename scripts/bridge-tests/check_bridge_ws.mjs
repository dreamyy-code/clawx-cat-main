import WebSocket from 'ws';

const host = process.argv[2] || process.env.CLAWX_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.argv[3] || process.env.CLAWX_BRIDGE_PORT || '18989');
const token = process.argv[4] || process.env.CLAWX_BRIDGE_TOKEN || '';
const url = `ws://${host}:${port}`;
const timeoutMs = Number(process.env.CLAWX_BRIDGE_TIMEOUT || '8000');

if (!token) {
  console.error('Missing bridge token. Usage: node scripts/bridge-tests/check_bridge_ws.mjs <host> <port> <token>');
  process.exit(1);
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function attachJsonParser(ws, pending) {
  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch (error) {
      console.log('[raw]', raw.toString());
      return;
    }

    console.log('[recv]', JSON.stringify(payload, null, 2));

    if (payload.requestId && pending.has(payload.requestId)) {
      const { resolve, reject, timer } = pending.get(payload.requestId);
      clearTimeout(timer);
      pending.delete(payload.requestId);
      if (payload.type === 'error') {
        reject(new Error(payload.message || payload.code || 'Bridge returned error'));
        return;
      }
      resolve(payload);
    }
  });
}

function request(ws, pending, type, params = {}, requestTimeout = timeoutMs) {
  const requestId = makeRequestId(type.replace(/\./g, '-'));
  const message = { type, requestId };
  if (type === 'auth') {
    message.token = params.token || '';
  } else {
    message.params = params || {};
  }
  console.log('[send]', JSON.stringify(message));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${type} timed out after ${requestTimeout}ms`));
    }, requestTimeout);

    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify(message), (error) => {
      if (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error);
      }
    });
  });
}

async function main() {
  console.log(`Connecting to ${url}`);
  const ws = new WebSocket(url);
  const pending = new Map();

  attachJsonParser(ws, pending);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out after ${timeoutMs}ms`)), timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  console.log('WebSocket opened');

  const authResult = await request(ws, pending, 'auth', { token });
  if (authResult.type !== 'auth.ok') {
    throw new Error(`Unexpected auth response: ${authResult.type}`);
  }

  console.log('Auth succeeded');

  const pingResult = await request(ws, pending, 'ping');
  const bridgeInfo = await request(ws, pending, 'bridge.info');
  let capabilitiesResult = null;
  try {
    capabilitiesResult = await request(ws, pending, 'runtime.capabilities.get');
  } catch (error) {
    console.warn(`[warn] runtime.capabilities.get failed: ${error.message}`);
  }
  const gatewayStatus = await request(ws, pending, 'gateway.status.get');

  console.log('\n=== SUMMARY ===');
  console.log('ping:', pingResult.type);
  console.log('bridge.info:', bridgeInfo.type);
  console.log('runtime.capabilities.get:', capabilitiesResult ? capabilitiesResult.type : 'failed');
  console.log('gateway.status.get:', gatewayStatus.type);
  console.log('bridge host info:', JSON.stringify(bridgeInfo.info || {}, null, 2));

  ws.close();
}

main().catch((error) => {
  console.error('\n=== FAILED ===');
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
