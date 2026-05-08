import json
import os
import socket
import time


DISCOVERY_PORT = int(os.getenv("CLAWX_DISCOVERY_PORT", "18990"))
DISCOVERY_TIMEOUT = float(os.getenv("CLAWX_DISCOVERY_TIMEOUT", "3"))
DISCOVERY_MESSAGE = {
    "type": "clawx.discovery.probe",
}


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(0.5)

    payload = json.dumps(DISCOVERY_MESSAGE, ensure_ascii=False).encode("utf-8")
    sock.sendto(payload, ("255.255.255.255", DISCOVERY_PORT))
    print(f"Sent discovery probe to udp://255.255.255.255:{DISCOVERY_PORT}")

    found = 0
    deadline = time.time() + DISCOVERY_TIMEOUT
    while time.time() < deadline:
        try:
            data, addr = sock.recvfrom(64 * 1024)
        except socket.timeout:
            continue

        try:
            parsed = json.loads(data.decode("utf-8"))
        except Exception:
            print(f"RAW RESPONSE from {addr[0]}:{addr[1]} -> {data!r}")
            found += 1
            continue

        print(f"DISCOVERED from {addr[0]}:{addr[1]}")
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
        found += 1

    sock.close()
    print(f"Discovery finished, found {found} device(s)")


if __name__ == "__main__":
    main()
