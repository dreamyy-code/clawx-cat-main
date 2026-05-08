import asyncio
import json
import os
import uuid

import websockets


RELAY_URL = os.getenv("CLAWX_RELAY_URL", "ws://127.0.0.1:19089/ws")
RELAY_USER_TOKEN = os.getenv("CLAWX_RELAY_USER_TOKEN", "")
DEVICE_ID = os.getenv("CLAWX_RELAY_DEVICE_ID", "")
SESSION_KEY = os.getenv("CLAWX_RELAY_SESSION_KEY", "agent:main:main")
MESSAGE = os.getenv("CLAWX_RELAY_MESSAGE", "你好，这是用户侧通过 Relay 发来的消息")


async def send_json(ws, payload):
    await ws.send(json.dumps(payload, ensure_ascii=False))


async def main():
    async with websockets.connect(RELAY_URL, max_size=10 * 1024 * 1024) as ws:
        auth_request_id = str(uuid.uuid4())
        await send_json(ws, {
            "type": "user.auth",
            "requestId": auth_request_id,
            "token": RELAY_USER_TOKEN,
            "userId": "relay-test-user",
        })

        while True:
            raw = await ws.recv()
            print("RECV:", raw)
            payload = json.loads(raw)
            if payload.get("type") == "user.auth.ok":
                break

        await send_json(ws, {
            "type": "user.devices.get",
            "requestId": str(uuid.uuid4()),
        })

        target_device_id = DEVICE_ID
        while not target_device_id:
            raw = await ws.recv()
            print("RECV:", raw)
            payload = json.loads(raw)
            if payload.get("type") != "user.devices":
                continue
            devices = payload.get("devices") or []
            if not devices:
                raise RuntimeError("No online devices found on relay")
            target_device_id = devices[0]["deviceId"]
            print("Using device:", target_device_id)

        await send_json(ws, {
            "type": "user.device.bind",
            "requestId": str(uuid.uuid4()),
            "deviceId": target_device_id,
        })

        await send_json(ws, {
            "type": "user.call",
            "requestId": str(uuid.uuid4()),
            "deviceId": target_device_id,
            "payload": {
                "type": "chat.send",
                "requestId": str(uuid.uuid4()),
                "params": {
                    "sessionKey": SESSION_KEY,
                    "message": MESSAGE,
                },
            },
        })

        while True:
            raw = await ws.recv()
            print("EVENT:", raw)
            payload = json.loads(raw)
            if payload.get("type") == "relay.event":
                inner = payload.get("message") or {}
                if inner.get("type") in {"chat.completed", "chat.failed", "chat.aborted"}:
                    break
            if payload.get("type") == "relay.result":
                inner = payload.get("message") or {}
                if inner.get("type") == "chat.failed":
                    break


if __name__ == "__main__":
    asyncio.run(main())
