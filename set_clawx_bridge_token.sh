#!/bin/sh

set -eu

SCRIPT_INPUT="$0"
case "$SCRIPT_INPUT" in
  /*) SCRIPT_PATH="$SCRIPT_INPUT" ;;
  *) SCRIPT_PATH="$(pwd)/$SCRIPT_INPUT" ;;
esac
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)

BRIDGE_TOKEN=""
HTTP_TOKEN=""
BRIDGE_HOST="${CLAWX_BRIDGE_HOST_VALUE:-0.0.0.0}"
BRIDGE_PORT="${CLAWX_BRIDGE_PORT_VALUE:-18989}"
HTTP_PORT="${CLAWX_BRIDGE_HTTP_PORT_VALUE:-18991}"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
ENV_FILE="${CLAWX_ENV_FILE:-$STATE_DIR/clawx.env}"
USER_DATA_DIR="${CLAWX_USER_DATA_DIR:-/var/lib/clawx}"
SETTINGS_FILE="${USER_DATA_DIR}/settings.json"
START_SCRIPT=""

info() {
  echo "[Info] $1"
}

warn() {
  echo "[Warn] $1" >&2
}

fail() {
  echo "[Error] $1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --bridge-token)
        [ "$#" -ge 2 ] || fail "Missing value for --bridge-token"
        BRIDGE_TOKEN="$2"
        shift 2
        ;;
      --http-token)
        [ "$#" -ge 2 ] || fail "Missing value for --http-token"
        HTTP_TOKEN="$2"
        shift 2
        ;;
      --bridge-port)
        [ "$#" -ge 2 ] || fail "Missing value for --bridge-port"
        BRIDGE_PORT="$2"
        shift 2
        ;;
      --http-port)
        [ "$#" -ge 2 ] || fail "Missing value for --http-port"
        HTTP_PORT="$2"
        shift 2
        ;;
      --help|-h)
        cat <<'EOF'
Usage:
  sh set_clawx_bridge_token.sh [bridgeToken] [httpToken]
  sh set_clawx_bridge_token.sh --bridge-token <token> [--http-token <token>]
  sh set_clawx_bridge_token.sh --http-token <token>

Options:
  --bridge-token <token>  Set WebSocket bridge token
  --http-token <token>    Set HTTP bridge token
  --bridge-port <port>    Override bridge port (default 18989)
  --http-port <port>      Override HTTP bridge port (default 18991)
EOF
        exit 0
        ;;
      --*)
        fail "Unsupported argument: $1"
        ;;
      *)
        if [ -z "$BRIDGE_TOKEN" ]; then
          BRIDGE_TOKEN="$1"
        elif [ -z "$HTTP_TOKEN" ]; then
          HTTP_TOKEN="$1"
        else
          fail "Too many positional arguments."
        fi
        shift
        ;;
    esac
  done
}

read_env_value() {
  ENV_KEY="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 1
  fi

  sed -n "s/^${ENV_KEY}=//p" "$ENV_FILE" | head -n 1
}

resolve_start_script() {
  if [ -n "${CLAWX_START_SCRIPT:-}" ]; then
    START_SCRIPT="$CLAWX_START_SCRIPT"
    return 0
  fi

  for CANDIDATE in \
    "$SCRIPT_DIR/start_clawx_headless.sh" \
    "/home/start_clawx_headless.sh" \
    "/usr/local/bin/start_clawx_headless.sh"
  do
    if [ -f "$CANDIDATE" ]; then
      START_SCRIPT="$CANDIDATE"
      return 0
    fi
  done

  fail "Unable to locate start_clawx_headless.sh. Set CLAWX_START_SCRIPT explicitly."
}

generate_token() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print("clawx-bridge-" + secrets.token_hex(16))
PY
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    printf 'clawx-bridge-%s\n' "$(openssl rand -hex 16)"
    return 0
  fi

  fail "Cannot generate token automatically. Please pass a token as the first argument."
}

ensure_tokens() {
  if [ -z "$BRIDGE_TOKEN" ] && [ -z "$HTTP_TOKEN" ]; then
    BRIDGE_TOKEN="$(generate_token)"
  fi
}

ensure_root() {
  [ "$(id -u)" -eq 0 ] || fail "Please run this script as root."
}

write_env_file() {
  mkdir -p "$STATE_DIR"
  TMP_FILE=$(mktemp)
  EXISTING_BRIDGE_ENABLED="$(read_env_value 'CLAWX_BRIDGE' || true)"
  EXISTING_BRIDGE_HOST="$(read_env_value 'CLAWX_BRIDGE_HOST' || true)"
  EXISTING_BRIDGE_PORT="$(read_env_value 'CLAWX_BRIDGE_PORT' || true)"
  EXISTING_BRIDGE_TOKEN="$(read_env_value 'CLAWX_BRIDGE_TOKEN' || true)"
  EXISTING_HTTP_ENABLED="$(read_env_value 'CLAWX_BRIDGE_HTTP' || true)"
  EXISTING_HTTP_PORT="$(read_env_value 'CLAWX_BRIDGE_HTTP_PORT' || true)"
  EXISTING_HTTP_TOKEN="$(read_env_value 'CLAWX_BRIDGE_HTTP_TOKEN' || true)"

  if [ -f "$ENV_FILE" ]; then
    grep -v '^CLAWX_BRIDGE=' "$ENV_FILE" \
      | grep -v '^CLAWX_BRIDGE_HOST=' \
      | grep -v '^CLAWX_BRIDGE_PORT=' \
      | grep -v '^CLAWX_BRIDGE_TOKEN=' \
      | grep -v '^CLAWX_BRIDGE_HTTP=' \
      | grep -v '^CLAWX_BRIDGE_HTTP_PORT=' \
      | grep -v '^CLAWX_BRIDGE_HTTP_TOKEN=' \
      >"$TMP_FILE" || true
  fi

  {
    cat "$TMP_FILE"
    if [ -n "$BRIDGE_TOKEN" ] || [ -n "$EXISTING_BRIDGE_TOKEN" ] || [ -n "$EXISTING_BRIDGE_ENABLED" ]; then
      printf 'CLAWX_BRIDGE=%s\n' "${EXISTING_BRIDGE_ENABLED:-1}"
      printf 'CLAWX_BRIDGE_HOST=%s\n' "${EXISTING_BRIDGE_HOST:-$BRIDGE_HOST}"
      if [ -n "$BRIDGE_TOKEN" ]; then
        printf 'CLAWX_BRIDGE_PORT=%s\n' "$BRIDGE_PORT"
        printf 'CLAWX_BRIDGE_TOKEN=%s\n' "$BRIDGE_TOKEN"
      else
        [ -n "$EXISTING_BRIDGE_PORT" ] && printf 'CLAWX_BRIDGE_PORT=%s\n' "$EXISTING_BRIDGE_PORT"
        [ -n "$EXISTING_BRIDGE_TOKEN" ] && printf 'CLAWX_BRIDGE_TOKEN=%s\n' "$EXISTING_BRIDGE_TOKEN"
      fi
    fi

    if [ -n "$HTTP_TOKEN" ] || [ -n "$EXISTING_HTTP_TOKEN" ] || [ -n "$EXISTING_HTTP_ENABLED" ]; then
      printf 'CLAWX_BRIDGE_HTTP=%s\n' "${EXISTING_HTTP_ENABLED:-1}"
      if [ -n "$HTTP_TOKEN" ]; then
        printf 'CLAWX_BRIDGE_HTTP_PORT=%s\n' "$HTTP_PORT"
        printf 'CLAWX_BRIDGE_HTTP_TOKEN=%s\n' "$HTTP_TOKEN"
      else
        [ -n "$EXISTING_HTTP_PORT" ] && printf 'CLAWX_BRIDGE_HTTP_PORT=%s\n' "$EXISTING_HTTP_PORT"
        [ -n "$EXISTING_HTTP_TOKEN" ] && printf 'CLAWX_BRIDGE_HTTP_TOKEN=%s\n' "$EXISTING_HTTP_TOKEN"
      fi
    fi
  } >"${TMP_FILE}.next"

  cp "${TMP_FILE}.next" "$ENV_FILE"
  if id -u clawx >/dev/null 2>&1 && getent group clawx >/dev/null 2>&1; then
    chown root:clawx "$ENV_FILE" 2>/dev/null || true
    chmod 640 "$ENV_FILE"
  else
    chmod 644 "$ENV_FILE"
  fi
  rm -f "$TMP_FILE" "${TMP_FILE}.next"
}

write_settings_file() {
  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 is not available; skipped syncing $SETTINGS_FILE"
    return 0
  fi

  mkdir -p "$USER_DATA_DIR"
  if [ ! -f "$SETTINGS_FILE" ]; then
    printf '{}\n' >"$SETTINGS_FILE"
  fi

  python3 - "$SETTINGS_FILE" "$BRIDGE_TOKEN" "$BRIDGE_HOST" "$BRIDGE_PORT" "$HTTP_TOKEN" "$HTTP_PORT" <<'PY'
import json
import pathlib
import sys

settings_path = pathlib.Path(sys.argv[1])
bridge_token = sys.argv[2]
host = sys.argv[3]
bridge_port = int(sys.argv[4])
http_token = sys.argv[5]
http_port = int(sys.argv[6])

try:
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}

if bridge_token:
    data["bridgeEnabled"] = True
    data["bridgeAllowRemote"] = True
    data["bridgePort"] = bridge_port
    data["bridgeToken"] = bridge_token

if http_token:
    data["bridgeHttpEnabled"] = True
    data["bridgeHttpPort"] = http_port
    data["bridgeHttpToken"] = http_token

settings_path.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY
}

fix_permissions() {
  if id -u clawx >/dev/null 2>&1; then
    chown clawx:clawx "$SETTINGS_FILE" 2>/dev/null || true
    chmod 600 "$SETTINGS_FILE" 2>/dev/null || true
  fi
}

restart_service() {
  [ -f "$START_SCRIPT" ] || fail "Start script not found: $START_SCRIPT"

  sh "$START_SCRIPT" stop || true
  sh "$START_SCRIPT" start-bg
}

print_result() {
  echo
  info "Bridge token settings have been updated."
  if [ -n "$BRIDGE_TOKEN" ]; then
    echo "WS Token  : $BRIDGE_TOKEN"
    echo "WS Host   : $BRIDGE_HOST"
    echo "WS Port   : $BRIDGE_PORT"
  fi
  if [ -n "$HTTP_TOKEN" ]; then
    echo "HTTP Token: $HTTP_TOKEN"
    echo "HTTP Port : $HTTP_PORT"
  fi
  echo "Env   : $ENV_FILE"
  echo
  echo "Quick checks:"
  echo "  grep '^CLAWX_BRIDGE_TOKEN=' $ENV_FILE"
  echo "  grep '^CLAWX_BRIDGE_HTTP_TOKEN=' $ENV_FILE"
  echo "  grep '^CLAWX_BRIDGE_HTTP_PORT=' $ENV_FILE"
  echo "  grep '\"bridgeToken\"' $SETTINGS_FILE"
  echo "  grep '\"bridgeHttpToken\"' $SETTINGS_FILE"
  echo "  tail -n 50 /var/log/clawx/clawx-headless.log"
}

parse_args "$@"
ensure_root
need_cmd grep
need_cmd cp
need_cmd chmod
need_cmd mktemp
resolve_start_script
ensure_tokens
write_env_file
write_settings_file
fix_permissions
restart_service
print_result
