import WebSocket from 'ws';

const host = process.argv[2] || process.env.CLAWX_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.argv[3] || process.env.CLAWX_BRIDGE_PORT || '18989');
const token = process.argv[4] || process.env.CLAWX_BRIDGE_TOKEN || '';
const prompt = process.argv[5] || process.env.CLAWX_CHAT_MESSAGE || '你好，介绍一下你自己';
const sessionKey = process.argv[6] || process.env.CLAWX_SESSION_KEY || 'agent:main:main';
const url = `ws://${host}:${port}`;
const timeoutMs = Number(process.env.CLAWX_BRIDGE_TIMEOUT || '20000');

if (!token) {
  console.error('Missing bridge token. Usage: node scripts/bridge-tests/check_bridge_chat.mjs <host> <port> <token> [message] [sessionKey]');
  process.exit(1);
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function sendJson(ws, payload) {
  console.log('[send]', JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify(payload), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main() {
  console.log(`Connecting to ${url}`);
  const ws = new WebSocket(url);
  const pending = new Map();
  let accepted = false;

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
      if (payload.type === 'error') reject(new Error(payload.message || payload.code || 'Bridge returned error'));
      else resolve(payload);
      return;
    }

    if (payload.type === 'chat.accepted' && payload.sessionKey === sessionKey) {
      accepted = true;
      return;
    }

    if ((payload.type === 'chat.completed' || payload.type === 'chat.failed' || payload.type === 'chat.aborted') && payload.sessionKey === sessionKey) {
      const result = payload.type === 'chat.failed'
        ? Promise.reject(new Error(payload.error || 'chat.failed'))
        : Promise.resolve(payload);
      ws.emit('__chat_result__', result);
    }
  });

  function request(type, params = {}, requestTimeout = timeoutMs) {
    const requestId = makeRequestId(type.replace(/\./g, '-'));
    const message = { type, requestId };
    if (type === 'auth') message.token = params.token || '';
    else message.params = params || {};

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${type} timed out after ${requestTimeout}ms`));
      }, requestTimeout);
      pending.set(requestId, { resolve, reject, timer });
      sendJson(ws, message).catch((error) => {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error);
      });
    });
  }

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
  await request('auth', { token });
  console.log('Auth succeeded');

  const completedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`chat event timed out after ${timeoutMs}ms (accepted=${accepted})`));
    }, timeoutMs);

    ws.once('__chat_result__', (resultPromise) => {
      Promise.resolve(resultPromise).then((payload) => {
        clearTimeout(timer);
        resolve(payload);
      }).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  });

  const acceptedPayload = await request('chat.send', {
    sessionKey,
    message: prompt
  }, timeoutMs);

  console.log('\n=== CHAT ACCEPTED ===');
  console.log(JSON.stringify(acceptedPayload, null, 2));

  const completedPayload = await completedPromise;

  console.log('\n=== CHAT FINISHED ===');
  console.log(JSON.stringify(completedPayload, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error('\n=== FAILED ===');
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
