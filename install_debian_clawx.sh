#!/bin/bash

set -euo pipefail

trap 'echo "[Error] Install failed at line $LINENO." >&2' ERR

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_INSTALL_ROOT="/usr/local/lib/nodejs"
NODE_PARENT_DIR="/usr/local/lib"
PREFERRED_NODE_VERSION="${CLAWX_NODE_VERSION:-24.14.1}"
TAR_BIN="/bin/tar"
DPKG_DEB_BIN="/usr/bin/dpkg-deb"
STATE_DIR="${CLAWX_STATE_DIR:-/etc/clawx}"
STATE_FILE="$STATE_DIR/install-state.json"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

fail() {
  echo "[Error] $1" >&2
  exit 1
}

sanitize_system_path() {
  # Prefer /bin first and avoid broken wrappers/symlinks under /usr/local/bin.
  export PATH="/bin:/usr/bin:/sbin:/usr/sbin:${PATH:-}"
  hash -r 2>/dev/null || true
}

warn() {
  echo "[Warn] $1" >&2
}

info() {
  echo "[Info] $1"
}

run_as_root() {
  if [[ -n "$SUDO" ]]; then
    $SUDO "$@"
  else
    "$@"
  fi
}

require_command() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || fail "Required command not found: $name"
}

require_working_command() {
  local name="$1"
  local test_arg="${2:---version}"
  command -v "$name" >/dev/null 2>&1 || fail "Required command not found: $name"
  "$name" "$test_arg" >/dev/null 2>&1 || fail "Command exists but is not executable correctly: $name"
}

run_with_clean_env() {
  env -i PATH="/bin:/usr/bin:/sbin:/usr/sbin" HOME="${HOME:-/root}" LANG="${LANG:-C}" "$@"
}

ensure_root_capability() {
  if [[ -z "$SUDO" ]]; then
    return 0
  fi

  command -v sudo >/dev/null 2>&1 || fail "sudo is required when not running as root."
  sudo -n true >/dev/null 2>&1 || info "sudo may ask for your password during installation."
}

ensure_supported_host() {
  [[ -f /etc/os-release ]] || fail "This installer only supports Debian-like systems with /etc/os-release."
  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-}" in
    debian|raspbian|linuxmint|ubuntu)
      ;;
    *)
      warn "Current distribution is '${ID:-unknown}'. The installer is tuned for Debian 12 style systems."
      ;;
  esac
}

repair_broken_shadow_command() {
  local cmd="$1"
  local shadow_path="/usr/local/bin/$cmd"
  local resolved_shadow

  [[ -e "$shadow_path" || -L "$shadow_path" ]] || return 0

  if [[ -L "$shadow_path" ]]; then
    resolved_shadow="$(readlink -f -- "$shadow_path" 2>/dev/null || true)"
    if [[ -z "$resolved_shadow" ]]; then
      warn "Removing broken shadow symlink: $shadow_path"
      run_as_root rm -f "$shadow_path"
      return 0
    fi
  fi
}

install_git_and_base_tools() {
  echo "[Step] Installing base tools..."
  run_as_root apt-get update
  run_as_root apt-get install -y ca-certificates curl git xz-utils
}

resolve_node_arch() {
  case "$ARCH" in
    amd64) echo "x64" ;;
    arm64) echo "arm64" ;;
    *) fail "Unsupported Debian architecture for Node.js: $ARCH" ;;
  esac
}

refresh_shell_path() {
  export PATH="/usr/local/lib/nodejs/current/bin:/usr/local/bin:/usr/bin:$PATH"
  hash -r 2>/dev/null || true
}

safe_realpath() {
  local path="$1"
  readlink -f -- "$path" 2>/dev/null || true
}

cleanup_invalid_node_links() {
  local current_link="$NODE_INSTALL_ROOT/current"
  local resolved_current

  if [[ -L "$current_link" ]]; then
    resolved_current="$(safe_realpath "$current_link")"
    if [[ -z "$resolved_current" || "$resolved_current" == "$current_link" ]]; then
      warn "Removing invalid Node.js symlink: $current_link"
      run_as_root rm -f "$current_link"
    fi
  elif [[ -e "$current_link" && ! -d "$current_link" ]]; then
    warn "Removing unexpected Node.js current entry: $current_link"
    run_as_root rm -f "$current_link"
  fi
}

expected_node_process_arch() {
  case "$1" in
    x64) echo "x64" ;;
    arm64) echo "arm64" ;;
    *) fail "Unsupported Node.js process arch mapping: $1" ;;
  esac
}

is_usable_node_dir() {
  local candidate="$1"
  local expected_arch="$2"
  local node_bin="$candidate/bin/node"
  local actual_arch actual_version

  [[ -d "$candidate" && -x "$node_bin" ]] || return 1

  actual_arch="$("$node_bin" -p "process.arch" 2>/dev/null || true)"
  [[ "$actual_arch" == "$expected_arch" ]] || return 1

  actual_version="$("$node_bin" -p "process.versions.node" 2>/dev/null || true)"
  [[ -n "$actual_version" ]] || return 1

  return 0
}

resolve_existing_node_dir() {
  local node_arch="$1"
  local expected_process_arch
  local candidate candidate_path

  expected_process_arch="$(expected_node_process_arch "$node_arch")"
  cleanup_invalid_node_links

  for candidate in \
    "/usr/local/lib/nodejs/current" \
    "/usr/local/lib/node-v${PREFERRED_NODE_VERSION}-linux-${node_arch}" \
    /usr/local/lib/node-v24.*-linux-"${node_arch}" \
    /usr/local/lib/nodejs/node-v24.*-linux-"${node_arch}"
  do
    candidate_path="$candidate"
    if [[ "$candidate" == "$NODE_INSTALL_ROOT/current" ]]; then
      candidate_path="$(safe_realpath "$candidate")"
      [[ -n "$candidate_path" ]] || continue
    fi

    if is_usable_node_dir "$candidate_path" "$expected_process_arch"; then
      printf '%s\n' "$candidate_path"
      return 0
    fi
  done

  return 1
}

warn_about_mismatched_local_tarballs() {
  local artifact_dir="$1"
  local node_arch="$2"
  local unexpected_arch
  local found_any=0

  case "$node_arch" in
    x64) unexpected_arch="arm64" ;;
    arm64) unexpected_arch="x64" ;;
    *) return 0 ;;
  esac

  shopt -s nullglob
  for candidate in "$artifact_dir"/node-v*-linux-"${unexpected_arch}".tar.xz; do
    found_any=1
    warn "Ignoring local Node.js archive with mismatched architecture: $(basename "$candidate")"
  done
  shopt -u nullglob

  return "$found_any"
}

link_node_binaries() {
  local install_dir="$1"
  local canonical_install_dir

  canonical_install_dir="$(safe_realpath "$install_dir")"
  [[ -n "$canonical_install_dir" ]] || fail "Unable to resolve Node.js install directory: $install_dir"
  [[ -x "$canonical_install_dir/bin/node" ]] || fail "Node.js binary not found in install directory: $canonical_install_dir"

  if [[ "$canonical_install_dir" == "$NODE_INSTALL_ROOT/current" ]]; then
    fail "Refusing to link /usr/local/lib/nodejs/current to itself."
  fi

  cleanup_invalid_node_links
  run_as_root mkdir -p "$NODE_INSTALL_ROOT"
  run_as_root ln -sfn "$canonical_install_dir" "$NODE_INSTALL_ROOT/current"
  run_as_root ln -sfn "$canonical_install_dir/bin/node" /usr/local/bin/node
  run_as_root ln -sfn "$canonical_install_dir/bin/npm" /usr/local/bin/npm
  run_as_root ln -sfn "$canonical_install_dir/bin/npx" /usr/local/bin/npx

  run_as_root tee /etc/profile.d/clawx-node.sh >/dev/null <<'EOF'
export PATH=/usr/local/lib/nodejs/current/bin:$PATH
EOF

  refresh_shell_path
}

verify_node_commands() {
  local install_dir="$1"
  local node_bin="$2"
  local npm_bin="$3"
  local npm_cli="$install_dir/lib/node_modules/npm/bin/npm-cli.js"

  "$node_bin" -v

  if [[ -f "$npm_cli" ]]; then
    "$node_bin" "$npm_cli" -v
  else
    "$npm_bin" -v
  fi

  command -v node >/dev/null 2>&1 || fail "node command is still not available in PATH after installation."
  command -v npm >/dev/null 2>&1 || fail "npm command is still not available in PATH after installation."
}

download_node_archive() {
  local node_arch="$1"
  local target_path="$2"
  local exact_url="https://nodejs.org/dist/v${PREFERRED_NODE_VERSION}/node-v${PREFERRED_NODE_VERSION}-linux-${node_arch}.tar.xz"
  local latest_base latest_file latest_url

  echo "[Info] No local Node.js tarball found. Downloading Node.js from the official site..."

  if curl -fsI "$exact_url" >/dev/null 2>&1; then
    curl -fL "$exact_url" -o "$target_path"
    return 0
  fi

  latest_base="https://nodejs.org/dist/latest-v24.x"
  latest_file="$(curl -fsSL "$latest_base/SHASUMS256.txt" | awk "/node-v.*-linux-${node_arch}\\.tar\\.xz$/ { print \$2; exit }")"
  [[ -n "$latest_file" ]] || fail "Unable to resolve a Node.js v24 tarball for architecture ${node_arch}"

  latest_url="$latest_base/$latest_file"
  curl -fL "$latest_url" -o "$target_path"
}

select_local_node_archive() {
  local artifact_dir="$1"
  local node_arch="$2"
  local candidate

  for candidate in \
    "$artifact_dir/node-v${PREFERRED_NODE_VERSION}-linux-${node_arch}.tar.xz" \
    "$artifact_dir"/node-v24.14.*-linux-"${node_arch}".tar.xz \
    "$artifact_dir"/node-v24.16.*-linux-"${node_arch}".tar.xz \
    "$artifact_dir"/node-v24.*-linux-"${node_arch}".tar.xz
  do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

install_node_from_tarball() {
  local artifact_dir="$1"
  local node_arch archive_path archive_name extracted_dir extracted_path existing_dir

  node_arch="$(resolve_node_arch)"
  warn_about_mismatched_local_tarballs "$artifact_dir" "$node_arch" || true

  if existing_dir="$(resolve_existing_node_dir "$node_arch" 2>/dev/null)"; then
    echo "[Step] Reusing existing Node.js at $existing_dir ..."
    link_node_binaries "$existing_dir"
    verify_node_commands "$existing_dir" "$existing_dir/bin/node" "$existing_dir/bin/npm"
    return 0
  fi

  archive_path="$(select_local_node_archive "$artifact_dir" "$node_arch" 2>/dev/null || true)"

  if [[ -z "$archive_path" ]]; then
    archive_path="$artifact_dir/node-v${PREFERRED_NODE_VERSION}-linux-${node_arch}.tar.xz"
    download_node_archive "$node_arch" "$archive_path"
  fi

  archive_path="$(readlink -f "$archive_path")"
  archive_name="$(basename "$archive_path")"
  extracted_dir="${archive_name%.tar.xz}"

  echo "[Step] Installing Node.js from $archive_name ..."
  run_as_root mkdir -p "$NODE_PARENT_DIR" "$NODE_INSTALL_ROOT"
  run_as_root rm -rf "$NODE_PARENT_DIR/$extracted_dir"
  [[ -x "$TAR_BIN" ]] || fail "Required tar binary is missing or not executable: $TAR_BIN"
  run_as_root "$TAR_BIN" -xJf "$archive_path" -C "$NODE_PARENT_DIR"

  extracted_path="$NODE_PARENT_DIR/$extracted_dir"
  [[ -x "$extracted_path/bin/node" ]] || fail "Extracted Node.js directory is invalid: $extracted_path"

  link_node_binaries "$extracted_path"
  verify_node_commands "$extracted_path" "$extracted_path/bin/node" "$extracted_path/bin/npm"
}

run_post_install_checks() {
  echo "[Step] Running post-install checks..."

  command -v node >/dev/null 2>&1 || fail "node command is missing after installation."
  command -v npm >/dev/null 2>&1 || fail "npm command is missing after installation."
  command -v git >/dev/null 2>&1 || fail "git command is missing after installation."
  command -v openclaw >/dev/null 2>&1 || fail "openclaw command is missing after installation."
  command -v clawx >/dev/null 2>&1 || warn "clawx command is not in PATH. GUI launch may require a new shell session."

  node -v
  npm -v
  git --version
  openclaw --version

  [[ -d /opt/ClawX ]] || fail "/opt/ClawX was not created."
  [[ -x /opt/ClawX/clawx ]] || warn "GUI binary /opt/ClawX/clawx is not executable."
}

preflight_checks() {
  ensure_root_capability
  ensure_supported_host
  sanitize_system_path
  repair_broken_shadow_command tar
  repair_broken_shadow_command bash

  require_command apt-get
  require_command apt
  require_command dpkg
  require_working_command "$DPKG_DEB_BIN"
  require_command readlink
  require_working_command "$TAR_BIN"
  [[ -x /bin/bash ]] || fail "/bin/bash is missing or not executable."
  /bin/bash -lc 'true' >/dev/null 2>&1 || fail "/bin/bash cannot execute commands correctly."
  require_command awk
  require_command ls
}

detect_package_arch() {
  local package_path="$1"
  local package_name package_arch

  package_name="${package_path##*/}"
  case "$package_name" in
    *-linux-amd64.deb) warn "Falling back to architecture from filename: amd64"; printf '%s\n' "amd64"; return 0 ;;
    *-linux-arm64.deb) warn "Falling back to architecture from filename: arm64"; printf '%s\n' "arm64"; return 0 ;;
  esac

  package_arch="$(run_with_clean_env "$DPKG_DEB_BIN" -f "$package_path" Architecture 2>/dev/null || true)"
  if [[ -n "$package_arch" ]]; then
    printf '%s\n' "$package_arch"
    return 0
  fi

  # Some malformed packages may fail field extraction but still expose metadata.
  if run_with_clean_env "$DPKG_DEB_BIN" --info "$package_path" >/dev/null 2>&1; then
    package_arch="$(run_with_clean_env "$DPKG_DEB_BIN" -f "$package_path" Architecture 2>/dev/null || true)"
    [[ -n "$package_arch" ]] && printf '%s\n' "$package_arch" && return 0
  fi

  fail "Unable to read package architecture from: $package_path
Possible causes:
  1) package is incomplete/corrupted
  2) package is not a valid .deb file
Quick checks:
  ls -lh \"$package_path\"
  file \"$package_path\"
  dpkg-deb --info \"$package_path\""
}

detect_package_version() {
  local package_path="$1"
  local package_name package_version

  package_name="${package_path##*/}"
  if [[ "$package_name" =~ ^ClawX-([0-9A-Za-z.+_-]+)-linux-(amd64|arm64)\.deb$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  package_version="$(run_with_clean_env "$DPKG_DEB_BIN" -f "$package_path" Version 2>/dev/null || true)"
  if [[ -n "$package_version" ]]; then
    printf '%s\n' "$package_version"
    return 0
  fi

  fail "Unable to read package version from: $package_path"
}

write_install_state() {
  local track="$1"
  local version="$2"
  local package_path="$3"
  local updated_at

  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  run_as_root install -d -m 755 "$STATE_DIR"
  run_as_root tee "$STATE_FILE" >/dev/null <<EOF
{
  "track": "$track",
  "version": "$version",
  "packagePath": "$package_path",
  "updatedAt": "$updated_at"
}
EOF
}

preflight_checks

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
  amd64)
    PACKAGE_GLOB="ClawX-*-linux-amd64.deb"
    ;;
  arm64)
    PACKAGE_GLOB="ClawX-*-linux-arm64.deb"
    ;;
  *)
    fail "Unsupported Debian architecture: $ARCH"
    ;;
esac

if [[ $# -ge 1 ]]; then
  PACKAGE_PATH="$1"
else
  PACKAGE_PATH="$(ls -1t "$SCRIPT_DIR"/$PACKAGE_GLOB 2>/dev/null | head -n 1 || true)"
fi

[[ -n "${PACKAGE_PATH:-}" ]] || fail "No package matching $PACKAGE_GLOB was found in $SCRIPT_DIR"
[[ -f "$PACKAGE_PATH" ]] || fail "Package file not found: $PACKAGE_PATH"

PACKAGE_PATH="$(readlink -f "$PACKAGE_PATH")"
ARTIFACT_DIR="$(dirname "$PACKAGE_PATH")"

PACKAGE_ARCH="$(detect_package_arch "$PACKAGE_PATH")"
[[ "$PACKAGE_ARCH" == "$ARCH" ]] || fail "Package architecture mismatch: host is $ARCH, but package is $PACKAGE_ARCH"
PACKAGE_VERSION="$(detect_package_version "$PACKAGE_PATH")"
PACKAGE_TRACK="linux-debian-$PACKAGE_ARCH"

echo "========================================"
echo "ClawX Debian Installer"
echo "========================================"
echo "Architecture : $ARCH"
echo "Package      : $PACKAGE_PATH"
echo

install_git_and_base_tools
install_node_from_tarball "$ARTIFACT_DIR"

DEBIAN_DEPS=(
  libasound2
  libgtk-3-0
  libnotify4
  libnss3
  libxss1
  libxtst6
  xdg-utils
  libatspi2.0-0
  libuuid1
  libgbm1
  libcups2
  libdrm2
  libxdamage1
  libxrandr2
  libxkbcommon0
  libxcomposite1
  libxfixes3
  libxshmfence1
)

echo "[Step] Installing Debian dependencies..."
run_as_root apt-get install -y "${DEBIAN_DEPS[@]}"

echo "[Step] Installing ClawX package..."
run_as_root chmod a+r "$PACKAGE_PATH" || true
if ! run_as_root apt -y install "$PACKAGE_PATH"; then
  run_as_root dpkg -i "$PACKAGE_PATH" || true
  run_as_root apt-get install -f -y
  run_as_root dpkg --configure -a
fi

echo "[Step] Fixing executable permissions..."
if [[ -d /opt/ClawX ]]; then
  run_as_root chmod 755 /opt/ClawX || true
fi

if [[ -f /opt/ClawX/clawx ]]; then
  run_as_root chmod 755 /opt/ClawX/clawx || true
  run_as_root ln -sf /opt/ClawX/clawx /usr/local/bin/clawx || true
fi

if [[ -d /opt/ClawX/resources/bin ]]; then
  run_as_root find /opt/ClawX/resources/bin -type f -exec chmod 755 {} + || true
fi

if [[ -d /opt/ClawX/resources/cli ]]; then
  run_as_root find /opt/ClawX/resources/cli -type f -exec chmod 755 {} + || true
fi

if [[ -f /opt/ClawX/resources/cli/openclaw ]]; then
  run_as_root ln -sf /opt/ClawX/resources/cli/openclaw /usr/local/bin/openclaw || true
fi

if [[ -f /opt/ClawX/chrome-sandbox ]]; then
  if ! { [[ -L /proc/self/ns/user ]] && unshare --user true >/dev/null 2>&1; }; then
    run_as_root chmod 4755 /opt/ClawX/chrome-sandbox || true
  else
    run_as_root chmod 0755 /opt/ClawX/chrome-sandbox || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  run_as_root update-desktop-database -q /usr/share/applications || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  run_as_root gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

echo "[Step] Initializing OpenClaw..."
if command -v openclaw >/dev/null 2>&1; then
  if ! openclaw setup; then
    echo "[Warn] 'openclaw setup' did not complete successfully. You can rerun it manually later."
  fi
else
  echo "[Warn] openclaw command not found after installation. Skip automatic setup."
fi

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
