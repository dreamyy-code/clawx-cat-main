import asyncio
import json
import os
import uuid

import websockets


RELAY_HOST = os.getenv("CLAWX_RELAY_HOST", "127.0.0.1")
RELAY_PORT = int(os.getenv("CLAWX_RELAY_PORT", "19089"))
RELAY_EXPECTED_TOKEN = os.getenv("CLAWX_RELAY_TOKEN", "")
SESSION_KEY = os.getenv("CLAWX_RELAY_SESSION_KEY", "agent:main:main")
TEST_MESSAGE = os.getenv("CLAWX_RELAY_TEST_MESSAGE", "你好，这是来自 Relay 的测试消息")
SEND_TEST_MESSAGE = os.getenv("CLAWX_RELAY_SEND_TEST", "1") == "1"


async def send_json(ws, payload):
    await ws.send(json.dumps(payload, ensure_ascii=False))


async def handle_device(ws):
    print("Device connected")
    registered = False
    pending_relay_request_id = None

    async for raw in ws:
        print("RECV:", raw)
        payload = json.loads(raw)
        message_type = payload.get("type")

        if message_type == "device.register":
            if RELAY_EXPECTED_TOKEN and payload.get("token") != RELAY_EXPECTED_TOKEN:
                await send_json(ws, {
                    "type": "error",
                    "message": "Invalid relay token",
                })
                await ws.close()
                return

            registered = True
            await send_json(ws, {
                "type": "device.registered",
                "requestId": payload.get("requestId"),
            })

            if SEND_TEST_MESSAGE:
                pending_relay_request_id = str(uuid.uuid4())
                await send_json(ws, {
                    "type": "relay.call",
                    "requestId": pending_relay_request_id,
                    "payload": {
                        "type": "chat.send",
                        "requestId": str(uuid.uuid4()),
                        "params": {
                            "sessionKey": SESSION_KEY,
                            "message": TEST_MESSAGE,
                        },
                    },
                })
            continue

        if message_type == "device.heartbeat":
            await send_json(ws, {
                "type": "relay.ping",
                "requestId": payload.get("requestId"),
            })
            continue

        if message_type == "relay.result":
            if payload.get("requestId") == pending_relay_request_id:
                print("Relay call acknowledged")
            continue

        if message_type == "relay.event":
            inner = payload.get("message") or {}
            if inner.get("type") in {"chat.completed", "chat.failed", "chat.aborted"}:
                print("Relay chat finished")
            continue

    if registered:
        print("Device disconnected")


async def main():
    print(f"Relay listening on ws://{RELAY_HOST}:{RELAY_PORT}")
    async with websockets.serve(handle_device, RELAY_HOST, RELAY_PORT, max_size=10 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
