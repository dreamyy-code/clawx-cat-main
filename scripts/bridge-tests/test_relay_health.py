import json
import os
import sys
import urllib.request


BASE_URL = os.getenv("CLAWX_RELAY_HTTP_BASE", "http://127.0.0.1:19089")
ADMIN_TOKEN = os.getenv("CLAWX_RELAY_ADMIN_TOKEN", "")


def fetch_json(path: str):
    request = urllib.request.Request(f"{BASE_URL}{path}")
    if ADMIN_TOKEN:
        request.add_header("Authorization", f"Bearer {ADMIN_TOKEN}")
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def main():
    checks = [
        ("/health", "健康检查"),
        ("/api/admin/users", "用户列表"),
        ("/api/admin/devices", "设备列表"),
        ("/api/admin/bindings", "绑定列表"),
    ]

    for path, label in checks:
        status, payload = fetch_json(path)
        print(f"[OK] {label}: HTTP {status}")
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    print("Relay health test passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Relay health test failed: {error}", file=sys.stderr)
        raise
