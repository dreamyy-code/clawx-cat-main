# ClawX Linux 更新与自动更新方案

## 1. 目标

本文给出两部分内容：

1. 当前 ClawX 的更新机制到底是怎样的（特别是“点击更新后是否只是下载包让用户手动装”）。
2. Linux 端（GUI 与无 GUI/headless）应该怎么做稳定更新，尤其是云服务器常驻服务场景。

---

## 2. 当前 ClawX 更新机制（现状）

## 2.1 主链路

当前更新主链路在主进程 `electron/main/updater.ts`，走的是 `electron-updater`：

- `checkForUpdates()`
- `downloadUpdate()`
- `quitAndInstall()`

默认行为：

- `autoDownload = false`
- `autoInstallOnAppQuit = true`

也就是说，默认是“先检查，再由用户触发下载，再触发安装重启”。

## 2.2 更新源

更新源地址来自 `build-profile.json`，主进程读取 `APP_UPDATE_BASE_URL`：

- 默认值：`https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main`

同时 `electron-builder.yml` 里也配置了：

- `publish.generic`（主）
- `publish.github`（备）

## 2.3 点击“更新”后的真实动作

从现有代码看，GUI 里点击更新不是“只下载然后完全手动安装”，而是：

1. 点“检查更新” -> 调 `update:check`
2. 点“下载更新” -> 调 `update:download`
3. 点“安装更新” -> 调 `update:install`（内部 `quitAndInstall`）

因此在桌面 GUI 场景，它是“应用内触发下载 + 应用内触发安装重启”的流程，不是纯手工双击安装包。

---

## 3. Linux 多版本与渠道拆分

Linux 不能只按“有 GUI / 无 GUI”拆，还必须按“包类型 + 架构”拆成不同更新轨道（track）。

建议至少 3 条轨道：

1. `linux-debian-amd64`：Debian/Ubuntu x86_64，包为 `.deb`
2. `linux-debian-arm64`：Debian/Ubuntu ARM64，包为 `.deb`
3. `linux-generic-amd64`：通用 Linux x86_64，包为 `.tar.gz`（适合无 GUI 服务器）

### 3.1 为什么必须分轨道

1. 三种包格式不同（`.deb` vs `.tar.gz`），安装方式不同。
2. 架构不同（`amd64` vs `arm64`），不能混装。
3. 更新元数据文件不同（如 Linux 端 `latest-linux.yml` 与 `latest-linux-arm64.yml`）。
4. 云端发布路径不同，才能避免客户端拿错包。

### 3.2 推荐发布路径

建议 COS/CDN 目录固定为：

```text
https://<your-cdn>/clawx/
  linux-debian-amd64/
    latest-linux.yml
    ClawX-<ver>-linux-amd64.deb
  linux-debian-arm64/
    latest-linux-arm64.yml
    ClawX-<ver>-linux-arm64.deb
  linux-generic-amd64/
    latest.json
    ClawX-linux-x64.tar.gz
```

说明：

- Debian 两条轨道保留 `electron-updater` 风格的 yml 元数据。
- Generic 轨道建议用你自己的 `latest.json`（包含 `version/url/sha256`），由服务端脚本消费。
- 绝对不要让 `arm64` 与 `amd64` 共用同一个目录。

---

## 4. Linux 场景拆分（按运行模式）

在分轨道基础上，再按运行模式拆分：

1. GUI 桌面机（有人值守）
2. Headless 无 GUI 服务器（systemd 常驻 + 远程桥接）

## 3.1 GUI Linux（桌面）

可继续使用现有应用内更新链路（检查 -> 下载 -> 安装重启）。

但建议产品文案明确提示：

- 更新会触发应用退出并切换版本
- 关键任务执行中不建议立刻安装

## 3.2 Headless Linux（云服务器）

不建议依赖 GUI 更新按钮，推荐“服务化脚本更新”：

- 由脚本拉取新 `.deb`
- 校验哈希
- 停服务
- 安装
- 重启服务
- 健康检查

这是无 GUI 服务器最稳的方式。

---

## 5. 推荐的无 GUI 更新方案（可落地）

## 5.1 目录与约定

- 服务名：`clawx-headless.service`
- 安装包目录：`/opt/clawx/releases`
- 当前包软链：`/opt/clawx/releases/current.pkg`
- 安装状态文件：`/etc/clawx/install-state.json`
- 配置保留：`~/.openclaw`、`~/.config/ClawX`

状态文件统一记录：

- 当前 `track`
- 当前安装 `version`
- 最近一次安装来源包路径或 URL

这样后续检查更新和执行更新都不再要求手工输入当前版本号。

## 5.2 一次性更新脚本（建议）

文件：`/usr/local/bin/clawx-update.sh`

```bash
#!/bin/bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-clawx-headless}"
TRACK="${1:-}"           # linux-debian-amd64 | linux-debian-arm64 | linux-generic-amd64
DOWNLOAD_URL="${2:-}"
SHA256_EXPECTED="${3:-}"
RELEASE_DIR="/opt/clawx/releases"
TMP_PKG="$RELEASE_DIR/clawx-update.tmp.pkg"

if [[ -z "$TRACK" || -z "$DOWNLOAD_URL" ]]; then
  echo "[Error] missing args"
  echo "Usage: clawx-update.sh <track> <pkg_url> [sha256]"
  exit 1
fi

case "$TRACK" in
  linux-debian-amd64) FINAL_PKG="$RELEASE_DIR/ClawX-linux-amd64.deb" ; PKG_TYPE="deb" ;;
  linux-debian-arm64) FINAL_PKG="$RELEASE_DIR/ClawX-linux-arm64.deb" ; PKG_TYPE="deb" ;;
  linux-generic-amd64) FINAL_PKG="$RELEASE_DIR/ClawX-linux-x64.tar.gz" ; PKG_TYPE="targz" ;;
  *) echo "[Error] unsupported track: $TRACK"; exit 1 ;;
esac

mkdir -p "$RELEASE_DIR"

echo "[Step] Downloading package for $TRACK ..."
curl -fL "$DOWNLOAD_URL" -o "$TMP_PKG"

if [[ -n "$SHA256_EXPECTED" ]]; then
  echo "[Step] Verifying sha256..."
  SHA256_ACTUAL="$(sha256sum "$TMP_PKG" | awk '{print $1}')"
  if [[ "$SHA256_ACTUAL" != "$SHA256_EXPECTED" ]]; then
    echo "[Error] sha256 mismatch"
    echo "expected: $SHA256_EXPECTED"
    echo "actual  : $SHA256_ACTUAL"
    exit 1
  fi
fi

mv -f "$TMP_PKG" "$FINAL_PKG"
ln -sfn "$FINAL_PKG" "$RELEASE_DIR/current.pkg"

echo "[Step] Stopping service..."
systemctl stop "$SERVICE_NAME" || true

if [[ "$PKG_TYPE" == "deb" ]]; then
  echo "[Step] Installing deb package..."
  apt -y install "$FINAL_PKG" || {
    dpkg -i "$FINAL_PKG" || true
    apt-get install -f -y
    dpkg --configure -a
  }
else
  echo "[Step] Installing generic tar.gz package..."
  INSTALL_DIR="/opt/ClawX"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$FINAL_PKG" -C /opt
  # 按你实际解压目录名调整。如果 tar 包顶层不是 ClawX，请改这里。
  if [[ -d /opt/ClawX ]]; then
    chmod -R a+rX /opt/ClawX || true
  fi
fi

echo "[Step] Starting service..."
systemctl daemon-reload
systemctl start "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME"

echo "[Step] Health check..."
ss -lntp | grep 18989 || true

echo "[Done] Update completed."
```

赋权：

```bash
chmod +x /usr/local/bin/clawx-update.sh
```

调用示例：

```bash
/usr/local/bin/clawx-update.sh \
  linux-debian-amd64 \
  "https://your-cos-or-cdn/path/ClawX-1.0.2-linux-amd64.deb" \
  "填写发布时的sha256"
```

如果已经通过安装脚本装过一次，也可以直接：

```bash
/usr/local/bin/clawx-update.sh \
  "https://your-cos-or-cdn/path/ClawX-1.0.2-linux-amd64.deb" \
  "填写发布时的sha256"
```

## 5.3 定时自动更新（可选）

可以用 `systemd timer` 或 `cron` 定时调用上面脚本。

建议先做“检查并通知”，再做“自动安装”：

1. 定时检测新版本并发通知（企业微信/Telegram）
2. 人工确认后执行更新脚本
3. 稳定后再放开全自动

---

## 6. GUI 与 Headless 的渠道建议

## 6.1 GUI Linux（桌面）

建议继续走 `electron-updater`，但必须做轨道隔离：

1. `debian-amd64` 客户端只指向 `linux-debian-amd64` 更新目录。
2. `debian-arm64` 客户端只指向 `linux-debian-arm64` 更新目录。
3. 不要让 GUI Linux 指向 `generic-amd64` 的 tar.gz 轨道。

## 6.2 Headless Linux（服务）

建议统一走脚本更新，不依赖 GUI：

1. 读取本机 track（建议统一从 `/etc/clawx/install-state.json` 读取）。
2. 只下载该 track 对应的包。
3. sha256 校验通过后再安装。
4. 安装后做 `systemd` 健康检查。

---

## 7. Headless 更新的关键原则

1. 永远脚本化更新，不依赖 GUI 操作。
2. 更新前后都要看 `systemctl status` 与 `journalctl`。
3. 包必须做哈希校验，避免下载到损坏包。
4. 保留上一个稳定包，必要时支持快速回退。
5. 更新和服务启动要串行，避免并发升级导致状态混乱。

---

## 8. 回答两个核心问题

## 8.1 `install_debian_clawx.sh` 在 amd64 上能直接用吗

能。前提是：

- 包是 `*-linux-amd64.deb`
- Node 离线包（如果使用）是 `node-v24.14.1-linux-x64.tar.xz`

## 8.2 当前 ClawX 点击更新后是“下载 COS 包 + 手动安装”吗

不是纯手动。

当前 GUI 流程是：

- 检查更新
- 下载更新
- 安装更新（`quitAndInstall`）

用户通常只需要在 UI 里确认，不需要自己去终端执行 `dpkg -i`。

但在无 GUI Linux 场景，仍建议采用本文的脚本化服务更新流程，这样最稳。

---

## 9. 建议的下一步实施

1. 先把 Linux 三条轨道目录在 COS/CDN 固化（`debian-amd64` / `debian-arm64` / `generic-amd64`）。
2. GUI Linux 继续走应用内更新，但每种架构绑定自己的目录。
3. Headless Linux 落地 `clawx-update.sh`，按 track 更新。
4. 发布流程强制生成 `sha256 + 元数据清单`。
5. 后续补“回滚脚本”和“更新后自检上报”。

这样可以同时覆盖：

- 桌面用户：应用内更新体验
- 服务器用户：无人值守、可审计、可回滚的服务更新体验

---

## 10. 当前已实现的脚本约定

## 10.1 安装脚本

`install_debian_clawx.sh` 安装成功后会写入：

```json
{
  "track": "linux-debian-amd64",
  "version": "1.0.3",
  "packagePath": "/path/to/ClawX-1.0.3-linux-amd64.deb",
  "updatedAt": "2026-04-24T12:34:56Z"
}
```

## 10.2 检查更新脚本

现在优先推荐：

```bash
./clawx-check-update.sh \
  https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main
```

脚本会自动从 `/etc/clawx/install-state.json` 读取：

- 当前 `track`
- 当前 `version`

如果状态文件不存在，再退回显式传参模式。

## 10.3 执行更新脚本

现在支持两种常用方式：

```bash
./clawx-update.sh \
  https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/linux-debian-amd64/ClawX-1.0.3-linux-amd64.deb \
  <sha256>
```

或显式指定：

```bash
./clawx-update.sh \
  linux-debian-amd64 \
  https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/linux-debian-amd64/ClawX-1.0.3-linux-amd64.deb \
  <sha256>
```

更新成功后脚本会自动回写 `/etc/clawx/install-state.json`。
