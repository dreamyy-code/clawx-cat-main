import asyncio
import json
import os
import uuid

import websockets


BRIDGE_URL = os.getenv("CLAWX_BRIDGE_URL", "ws://127.0.0.1:18989")
BRIDGE_TOKEN = os.getenv("CLAWX_BRIDGE_TOKEN", "")
SESSION_KEY = os.getenv("CLAWX_SESSION_KEY", "agent:main:main")
MESSAGE = os.getenv("CLAWX_MESSAGE", "Hello from Python bridge client")
MEDIA_FILE = os.getenv("CLAWX_MEDIA_FILE", "")
MEDIA_MIME = os.getenv("CLAWX_MEDIA_MIME", "image/png")


async def send_json(ws, payload):
    await ws.send(json.dumps(payload, ensure_ascii=False))


async def main():
    if not BRIDGE_TOKEN:
        raise RuntimeError("CLAWX_BRIDGE_TOKEN is required")

    async with websockets.connect(BRIDGE_URL, max_size=10 * 1024 * 1024) as ws:
        await send_json(ws, {
            "type": "auth",
            "requestId": str(uuid.uuid4()),
            "token": BRIDGE_TOKEN,
        })
        print("AUTH:", await ws.recv())

        await send_json(ws, {
            "type": "bridge.info",
            "requestId": str(uuid.uuid4()),
        })
        print("BRIDGE:", await ws.recv())

        await send_json(ws, {
            "type": "runtime.capabilities.get",
            "requestId": str(uuid.uuid4()),
        })
        print("CAPABILITIES:", await ws.recv())

        if MEDIA_FILE:
            await send_json(ws, {
                "type": "file.stagePaths",
                "requestId": str(uuid.uuid4()),
                "params": {
                    "filePaths": [MEDIA_FILE],
                },
            })
            staged_raw = await ws.recv()
            print("FILES:", staged_raw)
            staged_payload = json.loads(staged_raw)
            files = staged_payload.get("files") or []
            if not files:
                raise RuntimeError("No staged files returned")

            file_entry = files[0]
            await send_json(ws, {
                "type": "chat.sendWithMedia",
                "requestId": str(uuid.uuid4()),
                "params": {
                    "sessionKey": SESSION_KEY,
                    "message": MESSAGE,
                    "media": [{
                        "filePath": file_entry["stagedPath"],
                        "mimeType": MEDIA_MIME,
                        "fileName": file_entry["fileName"],
                    }],
                },
            })
        else:
            await send_json(ws, {
                "type": "chat.send",
                "requestId": str(uuid.uuid4()),
                "params": {
                    "sessionKey": SESSION_KEY,
                    "message": MESSAGE,
                },
            })

        while True:
            raw = await ws.recv()
            print("EVENT:", raw)
            payload = json.loads(raw)
            if payload.get("type") in {"chat.completed", "chat.failed", "chat.aborted"}:
                break


if __name__ == "__main__":
    asyncio.run(main())
