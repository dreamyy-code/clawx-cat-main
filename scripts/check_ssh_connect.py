#!/usr/bin/env python3
"""
Quick SSH connectivity checker.

Usage:
  python scripts/check_ssh_connect.py --host 192.168.1.5 --user root --password 1234

Optional:
  --port 22
  --timeout 5
"""

from __future__ import annotations

import argparse
import socket
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check SSH reachability and login.")
    parser.add_argument("--host", required=True, help="Target host or IP")
    parser.add_argument("--user", required=True, help="SSH username")
    parser.add_argument("--password", required=True, help="SSH password")
    parser.add_argument("--port", type=int, default=22, help="SSH port, default 22")
    parser.add_argument("--timeout", type=int, default=5, help="Socket/login timeout seconds")
    return parser.parse_args()


def check_tcp(host: str, port: int, timeout: int) -> None:
    print(f"[1/2] Checking TCP connectivity to {host}:{port} ...")
    with socket.create_connection((host, port), timeout=timeout):
        pass
    print("[OK] TCP port is reachable.")


def check_ssh(host: str, port: int, user: str, password: str, timeout: int) -> None:
    print("[2/2] Checking SSH authentication ...")
    try:
        import paramiko  # type: ignore
    except ImportError:
        print("[Error] Missing dependency: paramiko")
        print("Install it with: pip install paramiko")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=host,
            port=port,
            username=user,
            password=password,
            timeout=timeout,
            banner_timeout=timeout,
            auth_timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )
        stdin, stdout, stderr = client.exec_command("whoami && hostname && uname -a")
        output = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()
        print("[OK] SSH login succeeded.")
        if output:
            print("--- remote output ---")
            print(output)
        if err:
            print("--- remote stderr ---")
            print(err)
    finally:
        client.close()


def main() -> int:
    args = parse_args()

    try:
        check_tcp(args.host, args.port, args.timeout)
    except OSError as exc:
        print(f"[Error] TCP connect failed: {exc}")
        return 1

    try:
        check_ssh(args.host, args.port, args.user, args.password, args.timeout)
    except Exception as exc:
        print(f"[Error] SSH login failed: {exc}")
        return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
