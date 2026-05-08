import asyncio
import json
import os
import sys
import uuid

import websockets


RELAY_URL = os.getenv("CLAWX_RELAY_URL", "ws://127.0.0.1:19089/ws")
USER_TOKEN = os.getenv("CLAWX_RELAY_TEST_USER_TOKEN", "relay-user-test-token")
USER_ID = os.getenv("CLAWX_RELAY_TEST_USER_ID", "relay-test-user")
DEVICE_TOKEN = os.getenv("CLAWX_RELAY_TEST_DEVICE_TOKEN", "relay-device-test-token")
DEVICE_ID = os.getenv("CLAWX_RELAY_TEST_DEVICE_ID", "relay-test-device")


async def send_json(ws, payload):
    await ws.send(json.dumps(payload, ensure_ascii=False))


async def recv_json(ws, label):
    raw = await asyncio.wait_for(ws.recv(), timeout=15)
    print(f"{label}: {raw}")
    return json.loads(raw)


async def device_worker():
    async with websockets.connect(RELAY_URL, max_size=10 * 1024 * 1024) as ws:
        await send_json(ws, {
            "type": "device.register",
            "requestId": str(uuid.uuid4()),
            "token": DEVICE_TOKEN,
            "deviceId": DEVICE_ID,
            "deviceName": "Relay Test Device",
            "capabilities": {
                "test": True,
            },
            "bridgeStatus": {
                "running": True,
            },
        })

        registered = await recv_json(ws, "DEVICE")
        if registered.get("type") != "device.registered":
            raise RuntimeError(f"Unexpected device register response: {registered}")

        relay_call = await recv_json(ws, "DEVICE")
        if relay_call.get("type") != "relay.call":
            raise RuntimeError(f"Unexpected relay call: {relay_call}")

        await send_json(ws, {
            "type": "relay.result",
            "requestId": relay_call.get("requestId"),
            "message": {
                "type": "chat.accepted",
                "runId": "relay-test-run",
            },
        })
        await send_json(ws, {
            "type": "relay.event",
            "requestId": relay_call.get("requestId"),
            "message": {
                "type": "chat.completed",
                "sessionKey": "agent:main:main",
                "content": "relay roundtrip ok",
            },
        })


async def user_worker():
    async with websockets.connect(RELAY_URL, max_size=10 * 1024 * 1024) as ws:
        await send_json(ws, {
            "type": "user.auth",
            "requestId": str(uuid.uuid4()),
            "token": USER_TOKEN,
            "userId": USER_ID,
        })

        auth_ok = await recv_json(ws, "USER")
        if auth_ok.get("type") != "user.auth.ok":
            raise RuntimeError(f"Unexpected user auth response: {auth_ok}")

        devices_payload = await recv_json(ws, "USER")
        if devices_payload.get("type") != "user.devices":
            raise RuntimeError(f"Unexpected device list payload: {devices_payload}")
        devices = devices_payload.get("devices") or []
        target = next((item for item in devices if item.get("deviceId") == DEVICE_ID), None)
        if not target:
            raise RuntimeError(f"Device {DEVICE_ID} not visible to user")

        await send_json(ws, {
            "type": "user.device.bind",
            "requestId": str(uuid.uuid4()),
            "deviceId": DEVICE_ID,
        })
        bind_result = await recv_json(ws, "USER")
        if bind_result.get("type") != "user.device.bound":
            raise RuntimeError(f"Unexpected bind result: {bind_result}")

        request_id = str(uuid.uuid4())
        await send_json(ws, {
            "type": "user.call",
            "requestId": request_id,
            "deviceId": DEVICE_ID,
            "payload": {
                "type": "chat.send",
                "requestId": str(uuid.uuid4()),
                "params": {
                    "sessionKey": "agent:main:main",
                    "message": "relay roundtrip smoke test",
                },
            },
        })

        result_payload = await recv_json(ws, "USER")
        if result_payload.get("type") != "relay.result":
            raise RuntimeError(f"Unexpected relay result payload: {result_payload}")

        event_payload = await recv_json(ws, "USER")
        if event_payload.get("type") != "relay.event":
            raise RuntimeError(f"Unexpected relay event payload: {event_payload}")
        inner = event_payload.get("message") or {}
        if inner.get("type") != "chat.completed":
            raise RuntimeError(f"Unexpected relay event message: {event_payload}")


async def main():
    device_task = asyncio.create_task(device_worker())
    await asyncio.sleep(0.5)
    await user_worker()
    await device_task
    print("Relay roundtrip test passed")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Relay roundtrip test failed: {error}", file=sys.stderr)
        raise
