#!/bin/bash

set -euo pipefail

STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
STATE_FILE="$STATE_DIR/install-state.json"
ARG1="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"
TRACK=""
BASE_URL=""
CURRENT_VERSION=""

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

if [[ -n "$ARG1" && "$ARG1" =~ ^https?:// ]]; then
  BASE_URL="$ARG1"
  TRACK="${ARG2:-}"
  CURRENT_VERSION="${ARG3:-}"
else
  TRACK="$ARG1"
  BASE_URL="$ARG2"
  CURRENT_VERSION="$ARG3"
fi

if [[ -z "$TRACK" && -f "$STATE_FILE" ]]; then
  TRACK="$(read_state_field track || true)"
fi

if [[ -z "$CURRENT_VERSION" && -f "$STATE_FILE" ]]; then
  CURRENT_VERSION="$(read_state_field version || true)"
fi

if [[ -z "$BASE_URL" ]]; then
  cat >&2 <<'EOF'
Usage:
  clawx-check-update.sh <base_url>
  clawx-check-update.sh <base_url> [track]
  clawx-check-update.sh <track> <base_url> [current_version]

Examples:
  clawx-check-update.sh https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main
  clawx-check-update.sh linux-debian-amd64 https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main
EOF
  exit 1
fi

if [[ -z "$TRACK" ]]; then
  fail "Track is missing. Run the installer first so $STATE_FILE is created, or pass the track explicitly."
fi

need_cmd curl
need_cmd python3

case "$TRACK" in
  linux-debian-amd64)
    METADATA_URL="${BASE_URL%/}/${TRACK}/latest-linux.yml"
    MODE="yaml"
    ;;
  linux-debian-arm64)
    METADATA_URL="${BASE_URL%/}/${TRACK}/latest-linux-arm64.yml"
    MODE="yaml"
    ;;
  linux-generic-amd64)
    METADATA_URL="${BASE_URL%/}/${TRACK}/latest.json"
    MODE="json"
    ;;
  *)
    fail "Unsupported track: $TRACK"
    ;;
esac

RAW="$(curl -fsSL "$METADATA_URL")"

if [[ "$MODE" == "yaml" ]]; then
  VERSION="$(printf '%s\n' "$RAW" | awk -F': ' '/^version:/ {print $2; exit}')"
  PATH_VALUE="$(printf '%s\n' "$RAW" | awk -F': ' '/^path:/ {print $2; exit}')"
  SHA512_VALUE="$(printf '%s\n' "$RAW" | awk -F': ' '/^sha512:/ {print $2; exit}')"
  python3 - <<PY
import json
print(json.dumps({
  "track": ${TRACK@Q},
  "metadataUrl": ${METADATA_URL@Q},
  "version": ${VERSION@Q},
  "packagePath": ${PATH_VALUE@Q},
  "sha512": ${SHA512_VALUE@Q},
  "currentVersion": ${CURRENT_VERSION@Q},
  "stateFile": ${STATE_FILE@Q},
  "hasUpdate": bool(${VERSION@Q}) and (${CURRENT_VERSION@Q} == "" or ${VERSION@Q} != ${CURRENT_VERSION@Q}),
}))
PY
else
  python3 - <<PY
import json
data = json.loads(${RAW@Q})
version = str(data.get("version", "")).strip()
print(json.dumps({
  "track": ${TRACK@Q},
  "metadataUrl": ${METADATA_URL@Q},
  "version": version,
  "packageUrl": data.get("url", ""),
  "sha256": data.get("sha256", ""),
  "currentVersion": ${CURRENT_VERSION@Q},
  "stateFile": ${STATE_FILE@Q},
  "hasUpdate": bool(version) and (${CURRENT_VERSION@Q} == "" or version != ${CURRENT_VERSION@Q}),
}))
PY
fi
