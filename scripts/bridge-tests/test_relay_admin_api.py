import json
import os
import sys
import urllib.request


BASE_URL = os.getenv("CLAWX_RELAY_HTTP_BASE", "http://127.0.0.1:19089")
ADMIN_TOKEN = os.getenv("CLAWX_RELAY_ADMIN_TOKEN", "")
TEST_USER_ID = os.getenv("CLAWX_RELAY_TEST_USER_ID", "relay-test-user")
TEST_USER_NAME = os.getenv("CLAWX_RELAY_TEST_USER_NAME", "Relay Test User")
TEST_USER_TOKEN = os.getenv("CLAWX_RELAY_TEST_USER_TOKEN", "relay-user-test-token")
TEST_DEVICE_ID = os.getenv("CLAWX_RELAY_TEST_DEVICE_ID", "relay-test-device")
TEST_DEVICE_NAME = os.getenv("CLAWX_RELAY_TEST_DEVICE_NAME", "Relay Test Device")
TEST_DEVICE_TOKEN = os.getenv("CLAWX_RELAY_TEST_DEVICE_TOKEN", "relay-device-test-token")


def request_json(path: str, method: str = "GET", body=None):
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
    )
    request.add_header("Content-Type", "application/json; charset=utf-8")
    if ADMIN_TOKEN:
        request.add_header("Authorization", f"Bearer {ADMIN_TOKEN}")
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def main():
    steps = [
        (
            "/api/admin/users",
            {
                "userId": TEST_USER_ID,
                "name": TEST_USER_NAME,
                "token": TEST_USER_TOKEN,
            },
            "创建用户",
        ),
        (
            "/api/admin/device-tokens",
            {
                "deviceId": TEST_DEVICE_ID,
                "deviceName": TEST_DEVICE_NAME,
                "token": TEST_DEVICE_TOKEN,
            },
            "创建设备令牌",
        ),
        (
            "/api/admin/bindings",
            {
                "userId": TEST_USER_ID,
                "deviceId": TEST_DEVICE_ID,
            },
            "绑定用户设备",
        ),
    ]

    for path, payload, label in steps:
        status, result = request_json(path, method="POST", body=payload)
        print(f"[OK] {label}: HTTP {status}")
        print(json.dumps(result, ensure_ascii=False, indent=2))

    status, users_payload = request_json("/api/admin/users")
    print(f"[OK] 验证用户列表: HTTP {status}")
    print(json.dumps(users_payload, ensure_ascii=False, indent=2))

    status, devices_payload = request_json("/api/admin/devices")
    print(f"[OK] 验证设备列表: HTTP {status}")
    print(json.dumps(devices_payload, ensure_ascii=False, indent=2))

    status, bindings_payload = request_json("/api/admin/bindings")
    print(f"[OK] 验证绑定列表: HTTP {status}")
    print(json.dumps(bindings_payload, ensure_ascii=False, indent=2))

    print("Relay admin API test passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Relay admin API test failed: {error}", file=sys.stderr)
        raise
