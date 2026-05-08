#!/bin/sh

set -eu

SERVICE_NAME="${SERVICE_NAME:-clawx-headless}"
INSTALL_DIR="${CLAWX_INSTALL_DIR:-/opt/ClawX}"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
STATE_FILE="$STATE_DIR/install-state.json"
RELEASE_DIR="${CLAWX_RELEASE_DIR:-/opt/clawx/releases}"
DESKTOP_FILE="/usr/share/applications/clawx.desktop"
APPARMOR_PROFILE="/etc/apparmor.d/clawx"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

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

run_as_root() {
  if [ -n "$SUDO" ]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

read_state_field() {
  FIELD_NAME="$1"

  if [ ! -f "$STATE_FILE" ]; then
    return 1
  fi

  sed -n "s/.*\"$FIELD_NAME\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$STATE_FILE" | head -n 1
}

detect_install_mode() {
  if command -v dpkg-query >/dev/null 2>&1; then
    if dpkg-query -W -f='${Status}' clawx 2>/dev/null | grep -q 'install ok installed'; then
      printf '%s\n' "deb"
      return 0
    fi
  fi

  TRACK_VALUE="$(read_state_field track 2>/dev/null || true)"
  case "$TRACK_VALUE" in
    linux-debian-*)
      printf '%s\n' "deb"
      return 0
      ;;
    linux-generic-*)
      printf '%s\n' "targz"
      return 0
      ;;
  esac

  if [ -d "$INSTALL_DIR" ]; then
    printf '%s\n' "targz"
    return 0
  fi

  printf '%s\n' "unknown"
}

stop_service() {
  if command -v systemctl >/dev/null 2>&1; then
    info "Stopping service: $SERVICE_NAME"
    run_as_root systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    run_as_root systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    run_as_root systemctl daemon-reload >/dev/null 2>&1 || true
  fi
}

remove_desktop_integrations() {
  run_as_root rm -f /usr/local/bin/clawx /usr/local/bin/openclaw
  run_as_root rm -f "$DESKTOP_FILE"

  if command -v update-desktop-database >/dev/null 2>&1; then
    run_as_root update-desktop-database -q /usr/share/applications || true
  fi

  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    run_as_root gtk-update-icon-cache -q /usr/share/icons/hicolor || true
  fi

  if [ -f "$APPARMOR_PROFILE" ]; then
    run_as_root rm -f "$APPARMOR_PROFILE"
  fi
}

remove_generic_installation() {
  info "Removing generic Linux installation..."
  run_as_root rm -rf "$INSTALL_DIR"
}

remove_debian_package() {
  info "Removing Debian package..."
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
    run_as_root apt-get remove -y clawx || run_as_root dpkg -r clawx || true
    run_as_root apt-get purge -y clawx || true
    return 0
  fi

  if command -v dpkg >/dev/null 2>&1; then
    run_as_root dpkg -r clawx || true
    return 0
  fi

  warn "dpkg/apt-get not found, skipping Debian package removal."
}

cleanup_state() {
  info "Cleaning ClawX state links and install records..."
  run_as_root rm -f "$STATE_FILE"
  run_as_root rm -f "$RELEASE_DIR/current.pkg"
}

main() {
  need_cmd sed

  MODE="$(detect_install_mode)"

  if [ "$MODE" = "unknown" ]; then
    fail "Unable to determine how ClawX was installed. No package install and no $INSTALL_DIR found."
  fi

  stop_service

  if [ "$MODE" = "deb" ]; then
    remove_debian_package
  else
    remove_generic_installation
  fi

  remove_desktop_integrations
  cleanup_state

  echo
  info "ClawX has been uninstalled."
  echo "Mode: $MODE"
  echo "Removed install dir: $INSTALL_DIR"
}

main "$@"
