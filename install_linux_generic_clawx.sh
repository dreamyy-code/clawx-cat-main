#!/bin/sh

set -eu

SCRIPT_INPUT="$0"
case "$SCRIPT_INPUT" in
  /*) SCRIPT_PATH="$SCRIPT_INPUT" ;;
  *) SCRIPT_PATH="$(pwd)/$SCRIPT_INPUT" ;;
esac
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)

NODE_INSTALL_ROOT="/usr/local/lib/nodejs"
NODE_PARENT_DIR="/usr/local/lib"
PREFERRED_NODE_VERSION="${CLAWX_NODE_VERSION:-24.14.1}"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
STATE_FILE="$STATE_DIR/install-state.json"
INSTALL_DIR="${CLAWX_INSTALL_DIR:-/opt/ClawX}"
DESKTOP_FILE="/usr/share/applications/clawx.desktop"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

fail() {
  echo "[Error] $1" >&2
  exit 1
}

warn() {
  echo "[Warn] $1" >&2
}

info() {
  echo "[Info] $1"
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

sanitize_system_path() {
  PATH="/bin:/usr/bin:/sbin:/usr/sbin:/usr/local/bin:${PATH:-}"
  export PATH
  hash -r 2>/dev/null || true
}

ensure_root_capability() {
  if [ -z "$SUDO" ]; then
    return 0
  fi

  command -v sudo >/dev/null 2>&1 || fail "sudo is required when not running as root."
  sudo -n true >/dev/null 2>&1 || info "sudo may ask for your password during installation."
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
    return 0
  fi

  PKG_MANAGER="unknown"
}

install_apt_packages() {
  run_as_root apt-get install -y "$@"
}

install_rpm_packages() {
  RPM_INSTALL_CMD="$1"
  shift

  while [ "$#" -gt 0 ]; do
    if ! run_as_root "$RPM_INSTALL_CMD" install -y "$1"; then
      warn "Failed to install package '$1'. Please install it manually if ClawX cannot start."
    fi
    shift
  done
}

install_git_and_base_tools() {
  echo "[Step] Installing base tools..."
  case "$PKG_MANAGER" in
    apt)
      run_as_root apt-get update
      install_apt_packages ca-certificates curl git xz-utils
      ;;
    dnf)
      run_as_root dnf makecache
      install_rpm_packages dnf ca-certificates curl git xz tar findutils util-linux
      ;;
    yum)
      run_as_root yum makecache
      install_rpm_packages yum ca-certificates curl git xz tar findutils util-linux
      ;;
    *)
      warn "No supported package manager was detected. Skipping automatic base tool installation."
      ;;
  esac
}

install_linux_runtime_deps() {
  echo "[Step] Installing Linux runtime dependencies..."
  case "$PKG_MANAGER" in
    apt)
      install_apt_packages \
        libasound2 \
        libgtk-3-0 \
        libnotify4 \
        libnss3 \
        libxss1 \
        libxtst6 \
        xdg-utils \
        libatspi2.0-0 \
        libuuid1 \
        libgbm1 \
        libcups2 \
        libdrm2 \
        libxdamage1 \
        libxrandr2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxfixes3 \
        libxshmfence1
      ;;
    dnf)
      install_rpm_packages dnf \
        alsa-lib \
        gtk3 \
        libnotify \
        nss \
        libXScrnSaver \
        libXtst \
        xdg-utils \
        at-spi2-core \
        libuuid \
        mesa-libgbm \
        cups-libs \
        libdrm \
        libXdamage \
        libXrandr \
        libxkbcommon \
        libXcomposite \
        libXfixes \
        libxshmfence
      ;;
    yum)
      install_rpm_packages yum \
        alsa-lib \
        gtk3 \
        libnotify \
        nss \
        libXScrnSaver \
        libXtst \
        xdg-utils \
        at-spi2-core \
        libuuid \
        mesa-libgbm \
        cups-libs \
        libdrm \
        libXdamage \
        libXrandr \
        libxkbcommon \
        libXcomposite \
        libXfixes \
        libxshmfence
      ;;
    *)
      warn "No supported package manager was detected. Skipping automatic runtime dependency installation."
      ;;
  esac
}

resolve_host_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      HOST_ARCH="amd64"
      NODE_ARCH="x64"
      PACKAGE_GLOB="ClawX-linux-x64.tar.gz"
      ;;
    aarch64|arm64)
      HOST_ARCH="arm64"
      NODE_ARCH="arm64"
      PACKAGE_GLOB="ClawX-linux-arm64.tar.gz"
      ;;
    *)
      fail "Unsupported Linux architecture: $(uname -m)"
      ;;
  esac
}

safe_realpath() {
  if command -v readlink >/dev/null 2>&1; then
    readlink -f -- "$1" 2>/dev/null || printf '%s\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

node_process_arch() {
  case "$1" in
    x64) printf '%s\n' "x64" ;;
    arm64) printf '%s\n' "arm64" ;;
    *) fail "Unsupported Node.js architecture mapping: $1" ;;
  esac
}

is_usable_node_dir() {
  CANDIDATE_DIR="$1"
  EXPECTED_ARCH="$2"

  if [ ! -x "$CANDIDATE_DIR/bin/node" ]; then
    return 1
  fi

  ACTUAL_ARCH=$("$CANDIDATE_DIR/bin/node" -p "process.arch" 2>/dev/null || true)
  [ "$ACTUAL_ARCH" = "$EXPECTED_ARCH" ] || return 1

  ACTUAL_VERSION=$("$CANDIDATE_DIR/bin/node" -p "process.versions.node" 2>/dev/null || true)
  [ -n "$ACTUAL_VERSION" ] || return 1

  return 0
}

resolve_existing_node_dir() {
  EXPECTED_ARCH=$(node_process_arch "$NODE_ARCH")

  for CANDIDATE in \
    "$NODE_INSTALL_ROOT/current" \
    "/usr/local/lib/node-v${PREFERRED_NODE_VERSION}-linux-${NODE_ARCH}" \
    /usr/local/lib/node-v24.*-linux-"${NODE_ARCH}" \
    /usr/local/lib/nodejs/node-v24.*-linux-"${NODE_ARCH}"
  do
    if [ "$CANDIDATE" = "$NODE_INSTALL_ROOT/current" ]; then
      RESOLVED=$(safe_realpath "$CANDIDATE")
      [ -n "$RESOLVED" ] || continue
      CANDIDATE="$RESOLVED"
    fi

    if is_usable_node_dir "$CANDIDATE" "$EXPECTED_ARCH"; then
      printf '%s\n' "$CANDIDATE"
      return 0
    fi
  done

  return 1
}

refresh_shell_path() {
  PATH="/usr/local/lib/nodejs/current/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
  export PATH
  hash -r 2>/dev/null || true
}

link_node_binaries() {
  INSTALL_NODE_DIR=$(safe_realpath "$1")
  [ -x "$INSTALL_NODE_DIR/bin/node" ] || fail "Node.js binary not found in install directory: $INSTALL_NODE_DIR"

  run_as_root mkdir -p "$NODE_INSTALL_ROOT"
  run_as_root ln -sfn "$INSTALL_NODE_DIR" "$NODE_INSTALL_ROOT/current"
  run_as_root ln -sfn "$INSTALL_NODE_DIR/bin/node" /usr/local/bin/node
  run_as_root ln -sfn "$INSTALL_NODE_DIR/bin/npm" /usr/local/bin/npm
  run_as_root ln -sfn "$INSTALL_NODE_DIR/bin/npx" /usr/local/bin/npx

  TMP_PROFILE=$(mktemp)
  cat >"$TMP_PROFILE" <<'EOF'
export PATH=/usr/local/lib/nodejs/current/bin:$PATH
EOF
  run_as_root install -d -m 755 /etc/profile.d
  run_as_root cp "$TMP_PROFILE" /etc/profile.d/clawx-node.sh
  run_as_root chmod 644 /etc/profile.d/clawx-node.sh
  rm -f "$TMP_PROFILE"

  refresh_shell_path
}

verify_node_commands() {
  node -v >/dev/null 2>&1 || fail "node command is still not available after installation."
  npm -v >/dev/null 2>&1 || fail "npm command is still not available after installation."
}

download_node_archive() {
  TARGET_PATH="$1"
  EXACT_URL="https://nodejs.org/dist/v${PREFERRED_NODE_VERSION}/node-v${PREFERRED_NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  LATEST_BASE="https://nodejs.org/dist/latest-v24.x"

  echo "[Info] No local Node.js tarball found. Downloading Node.js from the official site..."

  if curl -fsI "$EXACT_URL" >/dev/null 2>&1; then
    curl -fL "$EXACT_URL" -o "$TARGET_PATH"
    return 0
  fi

  LATEST_FILE=$(
    curl -fsSL "$LATEST_BASE/SHASUMS256.txt" | awk "/node-v.*-linux-${NODE_ARCH}\\.tar\\.xz$/ { print \$2; exit }"
  )
  [ -n "$LATEST_FILE" ] || fail "Unable to resolve a Node.js v24 tarball for architecture ${NODE_ARCH}"
  curl -fL "$LATEST_BASE/$LATEST_FILE" -o "$TARGET_PATH"
}

select_local_node_archive() {
  for CANDIDATE in \
    "$ARTIFACT_DIR/node-v${PREFERRED_NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    "$ARTIFACT_DIR"/node-v24.*-linux-"${NODE_ARCH}".tar.xz
  do
    if [ -f "$CANDIDATE" ]; then
      printf '%s\n' "$CANDIDATE"
      return 0
    fi
  done

  return 1
}

install_node_from_tarball() {
  EXISTING_NODE_DIR=$(resolve_existing_node_dir 2>/dev/null || true)
  if [ -n "$EXISTING_NODE_DIR" ]; then
    echo "[Step] Reusing existing Node.js at $EXISTING_NODE_DIR ..."
    link_node_binaries "$EXISTING_NODE_DIR"
    verify_node_commands
    return 0
  fi

  NODE_ARCHIVE=$(select_local_node_archive 2>/dev/null || true)
  if [ -z "$NODE_ARCHIVE" ]; then
    NODE_ARCHIVE="$ARTIFACT_DIR/node-v${PREFERRED_NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    download_node_archive "$NODE_ARCHIVE"
  fi

  NODE_ARCHIVE=$(safe_realpath "$NODE_ARCHIVE")
  NODE_ARCHIVE_NAME=$(basename "$NODE_ARCHIVE")
  NODE_EXTRACT_DIR=${NODE_ARCHIVE_NAME%.tar.xz}

  echo "[Step] Installing Node.js from $NODE_ARCHIVE_NAME ..."
  run_as_root mkdir -p "$NODE_PARENT_DIR" "$NODE_INSTALL_ROOT"
  run_as_root rm -rf "$NODE_PARENT_DIR/$NODE_EXTRACT_DIR"
  run_as_root tar -xJf "$NODE_ARCHIVE" -C "$NODE_PARENT_DIR"

  EXTRACTED_NODE_PATH="$NODE_PARENT_DIR/$NODE_EXTRACT_DIR"
  [ -x "$EXTRACTED_NODE_PATH/bin/node" ] || fail "Extracted Node.js directory is invalid: $EXTRACTED_NODE_PATH"

  link_node_binaries "$EXTRACTED_NODE_PATH"
  verify_node_commands
}

detect_package_arch() {
  PACKAGE_NAME=$(basename "$PACKAGE_PATH")
  case "$PACKAGE_NAME" in
    *-linux-x64.tar.gz) printf '%s\n' "amd64" ;;
    *-linux-arm64.tar.gz) printf '%s\n' "arm64" ;;
    *)
      fail "Unable to determine package architecture from filename: $PACKAGE_NAME"
      ;;
  esac
}

read_json_string_field() {
  JSON_FILE="$1"
  FIELD_NAME="$2"

  if [ ! -f "$JSON_FILE" ]; then
    return 1
  fi

  sed -n "s/.*\"$FIELD_NAME\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$JSON_FILE" | head -n 1
}

resolve_metadata_file() {
  for CANDIDATE in \
    "$PWD/latest.json" \
    "$SCRIPT_DIR/latest.json" \
    "$ARTIFACT_DIR/latest.json"
  do
    if [ -f "$CANDIDATE" ]; then
      printf '%s\n' "$CANDIDATE"
      return 0
    fi
  done

  return 1
}

detect_package_version() {
  if [ -n "${PACKAGE_VERSION_HINT:-}" ]; then
    printf '%s\n' "$PACKAGE_VERSION_HINT"
    return 0
  fi

  METADATA_FILE=$(resolve_metadata_file 2>/dev/null || true)
  VERSION_FROM_METADATA=$(read_json_string_field "$METADATA_FILE" version || true)
  if [ -n "$VERSION_FROM_METADATA" ]; then
    printf '%s\n' "$VERSION_FROM_METADATA"
    return 0
  fi

  fail "Unable to determine package version. Pass it as the second argument or place latest.json in the current directory / script directory."
}

write_install_state() {
  TRACK_NAME="$1"
  VERSION_VALUE="$2"
  PACKAGE_FILE="$3"
  UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  TMP_STATE=$(mktemp)
  cat >"$TMP_STATE" <<EOF
{
  "track": "$TRACK_NAME",
  "version": "$VERSION_VALUE",
  "packagePath": "$PACKAGE_FILE",
  "updatedAt": "$UPDATED_AT"
}
EOF

  run_as_root install -d -m 755 "$STATE_DIR"
  run_as_root cp "$TMP_STATE" "$STATE_FILE"
  run_as_root chmod 644 "$STATE_FILE"
  rm -f "$TMP_STATE"
}

fix_app_permissions() {
  echo "[Step] Fixing executable permissions..."

  run_as_root chmod 755 "$INSTALL_DIR" || true

  if [ -f "$INSTALL_DIR/clawx" ]; then
    run_as_root chmod 755 "$INSTALL_DIR/clawx" || true
    run_as_root ln -sfn "$INSTALL_DIR/clawx" /usr/local/bin/clawx || true
  fi

  if [ -d "$INSTALL_DIR/resources/bin" ]; then
    run_as_root find "$INSTALL_DIR/resources/bin" -type f -exec chmod 755 {} \; || true
  fi

  if [ -d "$INSTALL_DIR/resources/cli" ]; then
    run_as_root find "$INSTALL_DIR/resources/cli" -type f -exec chmod 755 {} \; || true
  fi

  if [ -f "$INSTALL_DIR/resources/cli/openclaw" ]; then
    run_as_root ln -sfn "$INSTALL_DIR/resources/cli/openclaw" /usr/local/bin/openclaw || true
  fi

  if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
    if ! unshare --user true >/dev/null 2>&1; then
      run_as_root chmod 4755 "$INSTALL_DIR/chrome-sandbox" || true
    else
      run_as_root chmod 0755 "$INSTALL_DIR/chrome-sandbox" || true
    fi
  fi
}

write_desktop_entry() {
  if [ ! -x "$INSTALL_DIR/clawx" ]; then
    return 0
  fi

  TMP_DESKTOP=$(mktemp)
  cat >"$TMP_DESKTOP" <<EOF
[Desktop Entry]
Name=ClawX
Comment=ClawX Desktop Client
Exec=$INSTALL_DIR/clawx
Terminal=false
Type=Application
Categories=Utility;Development;
EOF

  run_as_root cp "$TMP_DESKTOP" "$DESKTOP_FILE"
  run_as_root chmod 644 "$DESKTOP_FILE"
  rm -f "$TMP_DESKTOP"
}

refresh_desktop_caches() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    run_as_root update-desktop-database -q /usr/share/applications || true
  fi

  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    run_as_root gtk-update-icon-cache -q /usr/share/icons/hicolor || true
  fi
}

install_clawx_tarball() {
  echo "[Step] Installing ClawX tar.gz package..."
  run_as_root rm -rf "$INSTALL_DIR"
  run_as_root mkdir -p "$INSTALL_DIR"
  run_as_root tar -xzf "$PACKAGE_PATH" -C "$INSTALL_DIR" --strip-components=1
  run_as_root chmod -R a+rX "$INSTALL_DIR" || true
}

run_openclaw_setup() {
  echo "[Step] Initializing OpenClaw..."
  if command -v openclaw >/dev/null 2>&1; then
    if ! openclaw setup; then
      warn "'openclaw setup' did not complete successfully. You can rerun it manually later."
    fi
  else
    warn "openclaw command not found after installation. Skip automatic setup."
  fi
}

run_post_install_checks() {
  echo "[Step] Running post-install checks..."

  command -v node >/dev/null 2>&1 || fail "node command is missing after installation."
  command -v npm >/dev/null 2>&1 || fail "npm command is missing after installation."
  command -v git >/dev/null 2>&1 || fail "git command is missing after installation."
  command -v openclaw >/dev/null 2>&1 || fail "openclaw command is missing after installation."
  command -v clawx >/dev/null 2>&1 || warn "clawx command is not in PATH. GUI launch may require a new shell session."

  [ -d "$INSTALL_DIR" ] || fail "$INSTALL_DIR was not created."
  [ -x "$INSTALL_DIR/clawx" ] || warn "GUI binary $INSTALL_DIR/clawx is not executable."

  node -v
  npm -v
  git --version
  openclaw --version
}

preflight_checks() {
  ensure_root_capability
  sanitize_system_path
  detect_package_manager

  need_cmd tar
  need_cmd curl
  need_cmd awk
  need_cmd sed
  need_cmd find
  need_cmd uname
  need_cmd mktemp
  need_cmd head
}

preflight_checks
resolve_host_arch

PACKAGE_PATH="${1:-}"
PACKAGE_VERSION_HINT="${2:-${CLAWX_PACKAGE_VERSION:-}}"

if [ -z "$PACKAGE_PATH" ]; then
  PACKAGE_PATH=$(ls -1t "$SCRIPT_DIR"/$PACKAGE_GLOB 2>/dev/null | head -n 1 || true)
fi

[ -n "$PACKAGE_PATH" ] || fail "No package matching $PACKAGE_GLOB was found in $SCRIPT_DIR"
[ -f "$PACKAGE_PATH" ] || fail "Package file not found: $PACKAGE_PATH"

PACKAGE_PATH=$(safe_realpath "$PACKAGE_PATH")
ARTIFACT_DIR=$(dirname "$PACKAGE_PATH")
PACKAGE_ARCH=$(detect_package_arch)

[ "$PACKAGE_ARCH" = "$HOST_ARCH" ] || fail "Package architecture mismatch: host is $HOST_ARCH, but package is $PACKAGE_ARCH"

PACKAGE_VERSION=$(detect_package_version)
PACKAGE_TRACK="linux-generic-$PACKAGE_ARCH"

echo "========================================"
echo "ClawX Generic Linux Installer"
echo "========================================"
echo "Architecture : $HOST_ARCH"
echo "Package      : $PACKAGE_PATH"
echo "Version      : $PACKAGE_VERSION"
echo

install_git_and_base_tools
install_node_from_tarball
install_linux_runtime_deps
install_clawx_tarball
fix_app_permissions
write_desktop_entry
refresh_desktop_caches
run_openclaw_setup
run_post_install_checks

echo "[Step] Writing install state..."
write_install_state "$PACKAGE_TRACK" "$PACKAGE_VERSION" "$PACKAGE_PATH"

echo
echo "[Done] ClawX installation completed."
echo
echo "Quick checks:"
echo "  node -v"
echo "  npm -v"
echo "  git --version"
echo "  openclaw --version"
echo "  openclaw setup"
echo "  openclaw --help"
echo "  clawx"
echo "  cat $STATE_FILE"
echo
echo "Note: On a headless server, prefer 'openclaw gateway' instead of launching the GUI."
