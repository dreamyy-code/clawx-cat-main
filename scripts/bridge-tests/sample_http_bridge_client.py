import json
import os
import threading
import time
import uuid
import urllib.parse
import urllib.request


HTTP_BRIDGE_URL = os.getenv("CLAWX_HTTP_BRIDGE_URL", "http://127.0.0.1:18991")
HTTP_BRIDGE_TOKEN = os.getenv("CLAWX_HTTP_BRIDGE_TOKEN", "")
SESSION_KEY = os.getenv("CLAWX_SESSION_KEY", "agent:main:main")
MESSAGE = os.getenv("CLAWX_MESSAGE", "Hello from Python HTTP bridge client")
CLIENT_ID = os.getenv("CLAWX_HTTP_CLIENT_ID", f"python-{uuid.uuid4().hex[:8]}")
EVENT_TIMEOUT_SECONDS = int(os.getenv("CLAWX_HTTP_EVENT_TIMEOUT", "45"))
SKIP_CHAT = os.getenv("CLAWX_SKIP_CHAT", "0") == "1"


def post_command(payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{HTTP_BRIDGE_URL}/api/bridge-http/command",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {HTTP_BRIDGE_TOKEN}",
            "Content-Type": "application/json",
            "X-ClawX-Bridge-Client-Id": CLIENT_ID,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def read_sse(stop_event, events):
    params = urllib.parse.urlencode({
        "token": HTTP_BRIDGE_TOKEN,
        "clientId": CLIENT_ID,
        "sessionKey": SESSION_KEY,
    })
    request = urllib.request.Request(
        f"{HTTP_BRIDGE_URL}/api/bridge-http/events?{params}",
        method="GET",
        headers={
            "Accept": "text/event-stream",
        },
    )
    with urllib.request.urlopen(request, timeout=EVENT_TIMEOUT_SECONDS) as response:
        current_event = None
        current_data = []
        while not stop_event.is_set():
            raw_line = response.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8").rstrip("\r\n")
            if not line:
                if current_event or current_data:
                    payload_text = "\n".join(current_data).strip()
                    payload = json.loads(payload_text) if payload_text else None
                    item = {
                        "event": current_event,
                        "data": payload,
                    }
                    events.append(item)
                    print("SSE:", json.dumps(item, ensure_ascii=False))
                    event_type = payload.get("type") if isinstance(payload, dict) else current_event
                    if event_type in {"chat.completed", "chat.failed", "chat.aborted"}:
                        stop_event.set()
                        break
                current_event = None
                current_data = []
                continue
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                continue
            if line.startswith("data:"):
                current_data.append(line.split(":", 1)[1].strip())


def main():
    if not HTTP_BRIDGE_TOKEN:
        raise RuntimeError("CLAWX_HTTP_BRIDGE_TOKEN is required")

    print("HTTP_BRIDGE_URL:", HTTP_BRIDGE_URL)
    print("CLIENT_ID:", CLIENT_ID)

    bridge_info = post_command({
        "type": "bridge.info",
        "requestId": str(uuid.uuid4()),
    })
    print("BRIDGE_INFO:", json.dumps(bridge_info, ensure_ascii=False))

    capabilities = post_command({
        "type": "runtime.capabilities.get",
        "requestId": str(uuid.uuid4()),
    })
    print("CAPABILITIES:", json.dumps(capabilities, ensure_ascii=False))

    gateway_status = post_command({
        "type": "gateway.status.get",
        "requestId": str(uuid.uuid4()),
    })
    print("GATEWAY_STATUS:", json.dumps(gateway_status, ensure_ascii=False))

    deadline = time.time() + EVENT_TIMEOUT_SECONDS
    while time.time() < deadline:
        state = ((gateway_status or {}).get("status") or {}).get("state")
        if state in {"running", "connected"}:
            break
        time.sleep(1.0)
        gateway_status = post_command({
            "type": "gateway.status.get",
            "requestId": str(uuid.uuid4()),
        })
        print("GATEWAY_STATUS_RECHECK:", json.dumps(gateway_status, ensure_ascii=False))

    if SKIP_CHAT:
        return

    stop_event = threading.Event()
    events = []
    thread = threading.Thread(target=read_sse, args=(stop_event, events), daemon=True)
    thread.start()
    time.sleep(1.0)

    accepted = post_command({
        "type": "chat.send",
        "requestId": str(uuid.uuid4()),
        "params": {
            "sessionKey": SESSION_KEY,
            "message": MESSAGE,
        },
    })
    print("CHAT_ACCEPTED:", json.dumps(accepted, ensure_ascii=False))

    deadline = time.time() + EVENT_TIMEOUT_SECONDS
    while time.time() < deadline and not stop_event.is_set():
        time.sleep(0.2)

    stop_event.set()
    thread.join(timeout=2)
    print("EVENT_COUNT:", len(events))


if __name__ == "__main__":
    main()
