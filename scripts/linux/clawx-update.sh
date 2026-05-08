#!/bin/bash

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-clawx-headless}"
RELEASE_DIR="${CLAWX_RELEASE_DIR:-/opt/clawx/releases}"
INSTALL_DIR="${CLAWX_INSTALL_DIR:-/opt/ClawX}"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
STATE_FILE="$STATE_DIR/install-state.json"
ARG1="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"
ARG4="${4:-}"
TRACK=""
PACKAGE_URL=""
SHA256_EXPECTED=""
TARGET_VERSION=""
TMP_PKG="$RELEASE_DIR/clawx-update.tmp.pkg"

fail() {
  echo "[Error] $1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

read_state_field() {
  local field="$1"

  [[ -f "$STATE_FILE" ]] || return 1
  sed -nE "s/^[[:space:]]*\"$field\":[[:space:]]*\"([^\"]*)\"[[:space:]]*,?[[:space:]]*$/\\1/p" "$STATE_FILE" | head -n 1
}

write_install_state() {
  local track="$1"
  local version="$2"
  local package_url="$3"
  local updated_at

  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  install -d -m 755 "$STATE_DIR"
  cat >"$STATE_FILE" <<EOF
{
  "track": "$track",
  "version": "$version",
  "packageUrl": "$package_url",
  "updatedAt": "$updated_at"
}
EOF
}

detect_deb_version() {
  local package_path="$1"
  local version

  version="$(dpkg-deb -f "$package_path" Version 2>/dev/null || true)"
  if [[ -n "$version" ]]; then
    printf '%s\n' "$version"
    return 0
  fi

  version="$(dpkg-query -W -f='${Version}' clawx 2>/dev/null || true)"
  if [[ -n "$version" ]]; then
    printf '%s\n' "$version"
    return 0
  fi

  return 1
}

resolve_target_version() {
  local package_type="$1"
  local package_url="$2"
  local version=""
  local metadata_url=""

  if [[ -n "$TARGET_VERSION" ]]; then
    printf '%s\n' "$TARGET_VERSION"
    return 0
  fi

  if [[ "$package_type" == "deb" ]]; then
    version="$(detect_deb_version "$FINAL_PKG" 2>/dev/null || true)"
    [[ -n "$version" ]] && printf '%s\n' "$version" && return 0
  fi

  metadata_url="${package_url%/*}/latest.json"
  if [[ "$package_type" == "deb" ]]; then
    case "$TRACK" in
      linux-debian-amd64) metadata_url="${package_url%/*}/latest-linux.yml" ;;
      linux-debian-arm64) metadata_url="${package_url%/*}/latest-linux-arm64.yml" ;;
    esac
  fi

  if [[ "$package_type" == "deb" ]]; then
    version="$(curl -fsSL "$metadata_url" | awk -F': ' '/^version:/ {print $2; exit}' || true)"
  else
    version="$(curl -fsSL "$metadata_url" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("version","")).strip())' 2>/dev/null || true)"
  fi
  [[ -n "$version" ]] && printf '%s\n' "$version" && return 0

  version="$(read_state_field version 2>/dev/null || true)"
  [[ -n "$version" ]] && printf '%s\n' "$version" && return 0

  fail "Unable to determine installed version after update. You can rerun with an explicit version as the last argument."
}

if [[ -n "$ARG1" && "$ARG1" =~ ^https?:// ]]; then
  PACKAGE_URL="$ARG1"
  SHA256_EXPECTED="$ARG2"
  TARGET_VERSION="$ARG3"
else
  TRACK="$ARG1"
  PACKAGE_URL="$ARG2"
  SHA256_EXPECTED="$ARG3"
  TARGET_VERSION="$ARG4"
fi

if [[ -z "$TRACK" && -f "$STATE_FILE" ]]; then
  TRACK="$(read_state_field track || true)"
fi

if [[ -z "$TRACK" || -z "$PACKAGE_URL" ]]; then
  cat >&2 <<'EOF'
Usage:
  clawx-update.sh <package_url> [sha256] [version]
  clawx-update.sh <track> <package_url> [sha256]
  clawx-update.sh <track> <package_url> [sha256] [version]

Tracks:
  linux-debian-amd64
  linux-debian-arm64
  linux-generic-amd64
EOF
  exit 1
fi

case "$TRACK" in
  linux-debian-amd64)
    PACKAGE_TYPE="deb"
    FINAL_PKG="$RELEASE_DIR/ClawX-linux-amd64.deb"
    ;;
  linux-debian-arm64)
    PACKAGE_TYPE="deb"
    FINAL_PKG="$RELEASE_DIR/ClawX-linux-arm64.deb"
    ;;
  linux-generic-amd64)
    PACKAGE_TYPE="targz"
    FINAL_PKG="$RELEASE_DIR/ClawX-linux-x64.tar.gz"
    ;;
  *)
    fail "Unsupported track: $TRACK"
    ;;
esac

need_cmd curl
need_cmd sha256sum
need_cmd systemctl
need_cmd python3

mkdir -p "$RELEASE_DIR"

echo "[Step] Downloading package for $TRACK ..."
curl -fL "$PACKAGE_URL" -o "$TMP_PKG"

if [[ -n "$SHA256_EXPECTED" ]]; then
  echo "[Step] Verifying sha256 ..."
  SHA256_ACTUAL="$(sha256sum "$TMP_PKG" | awk '{print $1}')"
  if [[ "$SHA256_ACTUAL" != "$SHA256_EXPECTED" ]]; then
    rm -f "$TMP_PKG"
    fail "SHA256 mismatch. expected=$SHA256_EXPECTED actual=$SHA256_ACTUAL"
  fi
fi

mv -f "$TMP_PKG" "$FINAL_PKG"
ln -sfn "$FINAL_PKG" "$RELEASE_DIR/current.pkg"

echo "[Step] Stopping service: $SERVICE_NAME"
systemctl stop "$SERVICE_NAME" || true

if [[ "$PACKAGE_TYPE" == "deb" ]]; then
  need_cmd apt
  need_cmd apt-get
  need_cmd dpkg
  echo "[Step] Installing Debian package ..."
  if ! apt -y install "$FINAL_PKG"; then
    dpkg -i "$FINAL_PKG" || true
    apt-get install -f -y
    dpkg --configure -a
  fi
else
  need_cmd tar
  echo "[Step] Installing generic tar.gz package ..."
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$FINAL_PKG" -C "$INSTALL_DIR" --strip-components=1
  chmod -R a+rX "$INSTALL_DIR" || true
fi

TARGET_VERSION="$(resolve_target_version "$PACKAGE_TYPE" "$PACKAGE_URL")"
echo "[Step] Writing install state..."
write_install_state "$TRACK" "$TARGET_VERSION" "$PACKAGE_URL"

echo "[Step] Starting service: $SERVICE_NAME"
systemctl daemon-reload
systemctl start "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME"

echo "[Done] Update completed."
