#!/bin/sh

set -eu

SCRIPT_INPUT="$0"
case "$SCRIPT_INPUT" in
  /*) SCRIPT_PATH="$SCRIPT_INPUT" ;;
  *) SCRIPT_PATH="$(pwd)/$SCRIPT_INPUT" ;;
esac
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)

APP_BIN="${CLAWX_BIN:-/opt/ClawX/clawx}"
SERVICE_USER="${CLAWX_SERVICE_USER:-clawx}"
SERVICE_GROUP="${CLAWX_SERVICE_GROUP:-$SERVICE_USER}"
DATA_DIR="${CLAWX_USER_DATA_DIR:-/var/lib/clawx}"
LOG_DIR="${CLAWX_LOG_DIR:-/var/log/clawx}"
TMP_DIR="${CLAWX_TMP_DIR:-$DATA_DIR/tmp}"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
ENV_FILE="${CLAWX_ENV_FILE:-$STATE_DIR/clawx.env}"
PID_FILE="${CLAWX_PID_FILE:-$DATA_DIR/clawx-headless.pid}"
LOG_FILE="${CLAWX_STDOUT_LOG:-$LOG_DIR/clawx-headless.log}"
RAW_ACTION="${1:-start}"
ACTION="${CLAWX_ACTION_OVERRIDE:-$RAW_ACTION}"

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

resolve_base_path() {
  if [ -n "${PATH:-}" ]; then
    printf '%s\n' "$PATH"
    return 0
  fi
  printf '%s\n' "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
}

quote_sh() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g;1s/^/'/;\$s/\$/'/"
}

load_env_file() {
  if [ -f "$ENV_FILE" ]; then
    [ -r "$ENV_FILE" ] || fail "Environment file exists but is not readable: $ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

resolve_nologin_shell() {
  for CANDIDATE in /usr/sbin/nologin /sbin/nologin /bin/false; do
    if [ -x "$CANDIDATE" ]; then
      printf '%s\n' "$CANDIDATE"
      return 0
    fi
  done
  printf '%s\n' "/bin/sh"
}

ensure_group_exists() {
  if getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    return 0
  fi

  if command -v groupadd >/dev/null 2>&1; then
    groupadd --system "$SERVICE_GROUP"
    return 0
  fi

  fail "Unable to create group '$SERVICE_GROUP': groupadd is not available."
}

ensure_service_user() {
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    return 0
  fi

  [ "$(id -u)" -eq 0 ] || fail "The service user '$SERVICE_USER' does not exist. Please run this script as root once."

  ensure_group_exists
  NOLOGIN_SHELL=$(resolve_nologin_shell)

  if command -v useradd >/dev/null 2>&1; then
    useradd \
      --system \
      --gid "$SERVICE_GROUP" \
      --home-dir "$DATA_DIR" \
      --create-home \
      --shell "$NOLOGIN_SHELL" \
      "$SERVICE_USER"
    return 0
  fi

  fail "Unable to create user '$SERVICE_USER': useradd is not available."
}

ensure_runtime_dirs() {
  if [ "$(id -u)" -eq 0 ]; then
    install -d -m 755 "$STATE_DIR"
    install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$DATA_DIR"
    install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$LOG_DIR"
    install -d -m 755 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$TMP_DIR"
    install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$TMP_DIR/runtime"
    return 0
  fi

  mkdir -p "$DATA_DIR" "$LOG_DIR" "$TMP_DIR" "$TMP_DIR/runtime"
  chmod 700 "$TMP_DIR/runtime" 2>/dev/null || true
}

switch_to_service_user_if_needed() {
  if [ "$RAW_ACTION" = "__run_as_service_user" ]; then
    ACTION="${CLAWX_ACTION_OVERRIDE:-start}"
    return 0
  fi

  if [ "$(id -u)" -ne 0 ] || [ "$(id -un)" = "$SERVICE_USER" ]; then
    return 0
  fi

  if command -v runuser >/dev/null 2>&1; then
    exec runuser -u "$SERVICE_USER" -- env -i \
      PATH="$(resolve_base_path)" \
      HOME="$DATA_DIR" \
      USER="$SERVICE_USER" \
      LOGNAME="$SERVICE_USER" \
      SHELL="/bin/sh" \
      LANG="${LANG:-C.UTF-8}" \
      TZ="${TZ:-UTC}" \
      CLAWX_SERVICE=1 \
      CLAWX_HEADLESS=1 \
      CLAWX_USER_DATA_DIR="$DATA_DIR" \
      CLAWX_LOG_DIR="$LOG_DIR" \
      CLAWX_TMP_DIR="$TMP_DIR" \
      XDG_RUNTIME_DIR="$TMP_DIR/runtime" \
      CLAWX_STATE_DIR="$STATE_DIR" \
      CLAWX_ENV_FILE="$ENV_FILE" \
      CLAWX_PID_FILE="$PID_FILE" \
      CLAWX_STDOUT_LOG="$LOG_FILE" \
      CLAWX_ACTION_OVERRIDE="$ACTION" \
      sh "$SCRIPT_PATH" __run_as_service_user
  fi

  if command -v su >/dev/null 2>&1; then
    CMD="env -i PATH=$(quote_sh "$(resolve_base_path)") HOME=$(quote_sh "$DATA_DIR") USER=$(quote_sh "$SERVICE_USER") LOGNAME=$(quote_sh "$SERVICE_USER") SHELL='/bin/sh' LANG=$(quote_sh "${LANG:-C.UTF-8}") TZ=$(quote_sh "${TZ:-UTC}") \
CLAWX_SERVICE=1 CLAWX_HEADLESS=1 CLAWX_USER_DATA_DIR=$(quote_sh "$DATA_DIR") \
CLAWX_LOG_DIR=$(quote_sh "$LOG_DIR") CLAWX_TMP_DIR=$(quote_sh "$TMP_DIR") \
XDG_RUNTIME_DIR=$(quote_sh "$TMP_DIR/runtime") \
CLAWX_STATE_DIR=$(quote_sh "$STATE_DIR") CLAWX_ENV_FILE=$(quote_sh "$ENV_FILE") \
CLAWX_PID_FILE=$(quote_sh "$PID_FILE") CLAWX_STDOUT_LOG=$(quote_sh "$LOG_FILE") CLAWX_ACTION_OVERRIDE=$(quote_sh "$ACTION") \
exec sh $(quote_sh "$SCRIPT_PATH") __run_as_service_user"
    exec su -s /bin/sh "$SERVICE_USER" -c "$CMD"
  fi

  fail "Cannot switch to '$SERVICE_USER': neither runuser nor su is available."
}

ensure_preconditions() {
  need_cmd sed
  need_cmd getent
  [ -x "$APP_BIN" ] || fail "ClawX executable not found: $APP_BIN"
}

build_start_command() {
  CMD=$(quote_sh "$APP_BIN")
  CMD="$CMD --headless"
  printf '%s\n' "$CMD"
}

write_pid_file() {
  printf '%s\n' "$1" >"$PID_FILE"
}

remove_pid_file() {
  rm -f "$PID_FILE"
}

read_pid_file() {
  if [ -f "$PID_FILE" ]; then
    head -n 1 "$PID_FILE"
  fi
}

is_pid_running() {
  TARGET_PID="$1"
  [ -n "$TARGET_PID" ] || return 1
  kill -0 "$TARGET_PID" >/dev/null 2>&1
}

start_foreground() {
  export HOME="$DATA_DIR"
  export PATH="$(resolve_base_path)"
  export CLAWX_SERVICE=1
  export CLAWX_HEADLESS=1
  export CLAWX_USER_DATA_DIR="$DATA_DIR"
  export CLAWX_LOG_DIR="$LOG_DIR"
  export TMPDIR="$TMP_DIR"
  export XDG_RUNTIME_DIR="$TMP_DIR/runtime"
  unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY XAUTHORITY SESSION_MANAGER
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || true

  info "Starting ClawX headless as user $(id -un)"
  exec "$APP_BIN" --headless
}

start_background() {
  export HOME="$DATA_DIR"
  export PATH="$(resolve_base_path)"
  export CLAWX_SERVICE=1
  export CLAWX_HEADLESS=1
  export CLAWX_USER_DATA_DIR="$DATA_DIR"
  export CLAWX_LOG_DIR="$LOG_DIR"
  export TMPDIR="$TMP_DIR"
  export XDG_RUNTIME_DIR="$TMP_DIR/runtime"
  unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY XAUTHORITY SESSION_MANAGER
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR" 2>/dev/null || true

  EXISTING_PID=$(read_pid_file || true)
  if is_pid_running "$EXISTING_PID"; then
    fail "ClawX headless is already running with PID $EXISTING_PID"
  fi

  START_CMD=$(build_start_command)
  nohup sh -c "$START_CMD" </dev/null >>"$LOG_FILE" 2>&1 &
  NEW_PID=$!
  write_pid_file "$NEW_PID"
  info "ClawX headless started in background. PID=$NEW_PID"
  info "Log file: $LOG_FILE"
}

show_status() {
  EXISTING_PID=$(read_pid_file || true)
  if is_pid_running "$EXISTING_PID"; then
    info "ClawX headless is running. PID=$EXISTING_PID"
    return 0
  fi

  if command -v pgrep >/dev/null 2>&1; then
    MATCHED_PID=$(pgrep -u "$SERVICE_USER" -f "$APP_BIN --headless" | head -n 1 || true)
    if [ -n "$MATCHED_PID" ]; then
      info "ClawX headless is running. PID=$MATCHED_PID"
      return 0
    fi
  fi

  warn "ClawX headless is not running."
  return 1
}

stop_process() {
  EXISTING_PID=$(read_pid_file || true)

  if ! is_pid_running "$EXISTING_PID"; then
    if command -v pkill >/dev/null 2>&1; then
      pkill -u "$SERVICE_USER" -f "$APP_BIN --headless" >/dev/null 2>&1 || true
    fi
    remove_pid_file
    warn "ClawX headless is not running."
    return 0
  fi

  kill "$EXISTING_PID" >/dev/null 2>&1 || true
  sleep 1
  if is_pid_running "$EXISTING_PID"; then
    warn "Process $EXISTING_PID did not exit in time, sending SIGKILL."
    kill -9 "$EXISTING_PID" >/dev/null 2>&1 || true
  fi
  remove_pid_file
  info "ClawX headless stopped."
}

load_env_file
ensure_preconditions
ensure_service_user
ensure_runtime_dirs
switch_to_service_user_if_needed

case "$ACTION" in
  start)
    start_foreground
    ;;
  start-bg)
    start_background
    ;;
  stop)
    stop_process
    ;;
  status)
    show_status
    ;;
  restart)
    stop_process
    start_background
    ;;
  *)
    fail "Unsupported action: $ACTION. Use: start | start-bg | stop | status | restart"
    ;;
esac
