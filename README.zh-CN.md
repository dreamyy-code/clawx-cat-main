﻿<p align="center">
  <img src="src/assets/logo.png" width="128" height="128" alt="ClawX-Cat Logo" />
</p>

<h1 align="center">ClawX-Cat</h1>

<p align="center">
  <strong>面向 OpenClaw 工作流的桌面客户端</strong>
</p>

<p align="center">
  <a href="#项目说明">项目说明</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#三条启动路径">三条启动路径</a> •
  <a href="#首次启动后检查">首次启动后检查</a> •
  <a href="#默认端口与目录">默认端口与目录</a> •
  <a href="#windows">Windows</a> •
  <a href="#linux">Linux</a> •
  <a href="#文档导航">文档导航</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja-JP.md">日本語</a>
</p>

---

## 项目说明

`ClawX-Cat` 是一个围绕 OpenClaw 使用场景整理出来的桌面客户端项目，目标不是重复 CLI，而是把常见的接入、配置、对话、渠道和日常运维工作收拢到一个可视化界面里。

它基于 `ClawX` 工程继续定制实现，但现在按 `ClawX-Cat` 作为独立作品维护。上游参考地址如下，仅用于说明技术来源，不作为本项目功能介绍的主体：

- 上游工程：<https://github.com/ValueCell-ai/ClawX>

如果你准备开源或二次开发，可以把它理解成一套现成的 Electron + React 桌面壳，以及围绕 OpenClaw 的主进程路由、网关管理、设置界面和打包流程。

## 这个项目适合做什么

- 给 OpenClaw 做一个可以直接交付给普通用户的桌面界面
- 在 Windows 或 Linux 上快速部署一个可配置的 AI 工作台
- 基于现有代码继续扩展渠道、模型供应商、技能或企业内流程
- 作为二次开发基础，继续做品牌定制、私有功能或行业化改造

## 核心能力

- 可视化管理模型供应商、API Key、代理和运行参数
- 提供聊天、频道、技能、定时任务等常用桌面入口
- 通过主进程统一接入 Host API，避免渲染层直连本地服务
- 支持 Electron 打包与多平台构建流程
- 保留 OpenClaw 运行时接入能力，便于继续对接上游生态

## ClawX-Cat 相对 ClawX 的增强点

相对直接沿用上游桌面端，`ClawX-Cat` 更强调“可部署、可扩展、可继续产品化”。下面这些点，是当前仓库里已经能落地、或者已经为后续扩展准备好基础的差异能力。

- **Linux 场景做得更重，也更实用**：这里不仅考虑桌面启动，还认真补了 Linux 服务器和 headless 运行方式。实际打包链会把 `clawx-update.sh`、`start_clawx_headless.sh`、`set_clawx_bridge_token.sh`、`clawx-uninstall.sh` 一起放进产物里，覆盖安装后更新、轻量启动、Bridge Token 设置、卸载清理等高频动作。
- **轻量启动降低了“先把环境跑起来”的门槛**：很多场景并不需要完整桌面交互，而是希望先把服务、桥接、远控能力拉起来。ClawX-Cat 在 Linux 侧显然是朝这个方向做了准备，让“先启动、再远程接入、再移动端控制”的路径更顺。
- **版本号与 OpenClaw 版本切换不再依赖手工改文件**：仓库里已经提供 `set-version.cjs`、`set-version.bat`、`update-openclaw.bat` 和 `scripts/update-openclaw.ps1`。这意味着你可以把“改应用版本号”“切换 OpenClaw 版本”“做不同版本构建”纳入脚本化流程。
- **Linux 打包链路已经是“按版本 / 按架构 / 按 track”组织的**：`scripts/build-linux-package.ps1` 不是简单调用一次 electron-builder，而是把架构、产物格式、更新 track、OpenClaw track、产物目录和附带脚本都纳入了构建过程。
- **Windows 也不是单一固定包，而是支持变体构建**：`scripts/build-win-variants.cjs` 已经把不同 build profile、不同 OpenClaw track、不同输出目录组织起来了。
- **桥接能力从单一 WS 扩展成 WS + HTTP 双通道**：当前命令入口走 `POST /api/bridge-http/command`，事件走 `GET /api/bridge-http/events`。这让 APP、弱网环境、SSE 订阅、反向代理、云端转发和更受限的客户端都更容易接入。
- **APP 端不只是口头规划，已经有明确的设计沉淀**：仓库里已经有 UniApp / 远程控制相关设计文档，目标就是承载 ClawX-Cat APP / UniApp 客户端。
- **这也让“多人协同养虾”这类场景更容易成立**：当桌面端、Linux 轻量启动、双桥接和 APP 接入同时存在时，项目天然更适合扩展到多人协作、远程值守、多终端查看同一设备、多人共同操作同一套智能体工作流等场景。
- **多 Agent 不再只是底层概念，而是逐步往产品能力走**：代码里已经能看到独立 Agent 页面、`agent:` 会话 key、聊天输入里的 `@agent` 路由、多 Agent 会话切换、执行图谱等实现。
- **页面结构和操作路径做了更多“减步骤”整理**：除了聊天、渠道、技能这些基础页，项目已经补了文件管理页、SkillHub 入口、推荐配置向导，并朝“少填、少跳转、少记忆配置项”的方向继续整理。

## 快速开始

### 运行环境

- 操作系统：Windows 10/11 x64，Linux x64/arm64
- Node.js：22+，推荐 24 LTS
- Git：用于克隆仓库
- pnpm：使用 `package.json` 锁定版本，建议通过 Corepack 启用
- 内存：最低 4GB，推荐 8GB
- 磁盘空间：建议至少预留 4GB

### 获取源码

将下面的仓库地址替换成你准备公开的实际地址：

```bash
git clone <你的仓库地址>
cd <你的仓库目录名>
```

### 初始化依赖

```bash
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm --version
pnpm run init
```

说明：

- `pnpm run init` 会执行依赖安装，并下载项目所需的 `uv` 二进制
- 如果你已经提前装好依赖，也可以分开执行 `pnpm install` 和 `pnpm run uv:download`
- `pnpm dev` 会通过 `vite-plugin-electron` 同时拉起渲染层与 Electron 开发宿主，而不只是单独启动一个前端页面

## 三条启动路径

### 1. 源码开发启动

适合本地开发、界面联调、快速熟悉项目结构：

```bash
pnpm dev
```

你会得到一个开发中的桌面应用窗口，首次上手建议继续看这两份文档：

- [ClawX-Cat-从源码到跑通第一条消息.md](doc/ClawX-Cat-从源码到跑通第一条消息.md)
- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)

### 2. Linux Debian 安装包启动

适合要把产物交给测试或部署到 Debian / Ubuntu 机器上的场景：

1. 先用 `build_linux_amd.bat` 或 `build_linux_arm.bat` 产出 `.deb`
2. 把产物拷到目标 Linux 机器
3. 在产物目录运行安装脚本

```bash
chmod +x install_debian_clawx.sh
./install_debian_clawx.sh ./ClawX-<version>-linux-amd64.deb
```

安装脚本会补 Node.js、系统依赖、OpenClaw 初始化，并把安装状态写入 `/etc/clawx/install-state.json`。

### 3. Linux Headless 常驻启动

适合远程主机、盒子、弱图形环境、APP / Bridge 远控场景：

```bash
chmod +x start_clawx_headless.sh
./start_clawx_headless.sh start-bg
./start_clawx_headless.sh status
```

如果你要长期运行、查看日志、修改环境文件，请直接看：

- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)

## 首次启动后检查

无论你走源码启动还是安装包启动，第一次建议按下面顺序做检查：

1. 能看到主窗口，或在 headless 下确认进程已经启动
2. 打开设置，确认 Gateway 处于可用状态
3. 至少配置一个可用模型或 provider
4. 在聊天页发送一条测试消息，确认基础对话可用
5. 如果要远程接入，再启用 Bridge，并记录端口与 Token

如果你想最短路径跑通一次桥接联调，建议直接看：

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](doc/ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](doc/ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX-Cat-Bridge-命令类型清单.md](doc/ClawX-Cat-Bridge-命令类型清单.md)

## 默认端口与目录

下面这些默认值建议在 README 中直接告诉用户，避免第一次排障时还要翻代码：

| 项目 | 默认值 | 说明 |
|------|--------|------|
| Host API | `127.0.0.1:13210` | 仅本机回环监听，不作为外部远控入口 |
| OpenClaw Gateway | `18789` | 本地 Gateway 默认端口 |
| WebSocket Bridge | `18989` | 默认关闭，启用后可供脚本 / APP 连接 |
| Bridge Discovery | `18990` | 局域网发现端口，默认开启 |
| HTTP Bridge | `18991` | 默认关闭，启用后通过 HTTP + SSE 接入 |
| Linux 安装状态 | `/etc/clawx/install-state.json` | 记录安装轨道、版本和包来源 |
| Headless 环境文件 | `/etc/clawx/clawx.env` | Headless 启动时会读取 |
| Headless 日志 | `/var/log/clawx/clawx-headless.log` | 后台模式默认日志文件 |

补充说明：

- 默认情况下 `bridgeEnabled=false`、`bridgeHttpEnabled=false`、`bridgeAllowRemote=false`
- Headless 模式和 Linux 强制远控场景下，Bridge 会更积极地启动，并自动监听可远程访问地址
- Host API 默认只监听 `127.0.0.1`，外部设备不要直接依赖 Host API，而应优先通过 Bridge 接入

## Bridge 与 Relay 的关系

很多新用户会把这两个概念混在一起，建议直接说明：

- `Bridge` 是设备本机上的远控入口，适合同局域网直连、桌面端脚本、APP 本地控制
- `Cloud Relay` 是可选的第二阶段中转服务，只在你需要跨公网或统一账号接入时再部署
- 如果你只是先把项目跑起来，本地开发和局域网联调都不需要先搭 Relay

相关入口：

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [Cloud Relay Service README.md](services/cloud-relay/README.md)

## Windows

### 环境准备

建议使用下面这一组环境：

- `Git for Windows`
- `Node.js 24 LTS`
- `PowerShell 7` 或 Windows PowerShell 5.1+
- 已启用 `corepack` 的 `pnpm`

### 从零开始命令

```powershell
git clone <你的仓库地址>
cd <你的仓库目录名>
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm run init
pnpm dev
```

### Windows 打包

推荐直接在仓库根目录运行打包脚本，而不是手动调用 `pnpm package:*`：

```powershell
.\build.bat
```

说明：

- `build.bat` 是 Windows 发包入口脚本
- 可选地支持传入版本号，例如：`.\build.bat 1.2.3`
- 该脚本会先执行 `node set-version.cjs <version>`，再调用 `pnpm run package:win:variants`
- 最终会输出双 track 的 Windows 安装包，并放入 `release` 目录

### Windows 备注

- 如果只是做前端或交互联调，`pnpm dev` 就足够
- 如果只是验证能否构建，先跑 `pnpm run build:vite`
- Windows 打包会准备额外二进制与安装包，耗时通常明显高于普通开发启动
- 首次依赖安装时，如网络环境受限，需要确保 npm 和依赖二进制下载可访问
- 打包脚本本身依赖 `node` 和 `pnpm` 可用，因此仍需要先完成 `pnpm run init`

## Linux

### 环境准备

建议至少准备以下环境：

- `git`
- `Node.js 24 LTS`
- `corepack`
- 基本桌面依赖库
- 如果是无头环境，建议额外准备 `xvfb`

对于 Debian / Ubuntu 系发行版，常见桌面依赖可参考：

```bash
sudo apt update
sudo apt install -y git curl build-essential libgtk-3-0 libnotify4 libxss1 libxtst6 libnss3 libasound2 xvfb
```

### 从零开始命令

```bash
git clone <你的仓库地址>
cd <你的仓库目录名>
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm run init
pnpm dev
```

### Linux 打包

Linux 包同样推荐直接运行仓库根目录的 bat 包装脚本，而不是把 README 主入口写成 `pnpm package:linux`。

1. `build_linux_amd.bat`
   - 构建 `AMD64 Debian` 双 track 包
   - 输出包含 stable / latest 两套 OpenClaw 变体

2. `build_linux_arm.bat`
   - 构建 `ARM64 Debian` 双 track 包
   - 适合 ARM Linux 设备或 ARM 服务器发布

3. `build_linux_generic_amd.bat`
   - 构建 `AMD64 generic/headless Linux` 包
   - 输出 `tar.gz` 便携产物，适合 generic / headless Linux 部署

对应示例：

```powershell
.\build_linux_amd.bat
.\build_linux_arm.bat
.\build_linux_generic_amd.bat
```

如果需要在打包前顺手更新版本号，也可以带版本参数运行：

```powershell
.\build_linux_amd.bat 1.2.3
.\build_linux_arm.bat 1.2.3
.\build_linux_generic_amd.bat 1.2.3
```

这些 bat 最终都会转调 `scripts/build-linux-package.ps1`，并自动把更新、轻量启动、设置 Token、卸载等 Linux 运维脚本一起带进产物目录。

### Linux 备注

- 有桌面环境时可直接运行 `pnpm dev`
- 无头环境建议优先执行 `lint`、`typecheck`、`test`、`build:vite`
- Electron E2E 在无头环境中可这样运行：

```bash
xvfb-run -a pnpm run test:e2e
```

- 如果要运行 AppImage，目标系统可能需要 `libfuse2` 或 `libfuse2t64`
- 如果要把 Linux 机器作为远控设备，优先用 headless 脚本和 Bridge，而不是直接暴露 Host API

## 常见问题

### `pnpm dev` 启动后只看到前端，没有 Electron 吗？

不是。当前开发配置已经通过 `vite-plugin-electron` 在开发时拉起 Electron 主进程和 preload。只要本机图形环境正常，`pnpm dev` 就是完整桌面应用开发入口。

### 为什么外部设备不能直接访问 Host API？

因为 Host API 默认监听 `127.0.0.1:13210`，它是给本机宿主和渲染层用的，不是公网或局域网暴露接口。外部接入应优先使用 WebSocket Bridge 或 HTTP Bridge。

### Linux 没有桌面环境还能跑吗？

可以。优先使用 `start_clawx_headless.sh`，并结合 `ClawX-Cat-Linux-Headless-快速手册.md` 配置环境文件、日志目录和 Bridge。

### 打包或启动时提示端口占用怎么办？

先检查是否有旧实例、旧 Gateway 或系统保留端口。Windows 下若 Host API 绑定失败，常见原因之一是 Hyper-V 占用了端口范围，可以改 `CLAWX_PORT_CLAWX_HOST_API` 覆盖默认端口。

### 是否必须先部署 Cloud Relay？

不是。大多数本地开发、局域网发现、APP 同网段联调都可以先只用 Bridge。只有跨公网、统一账号、设备中转这类场景才需要单独部署 Relay。

## 文档导航

### 上手与部署

- [ClawX-Cat-从源码到跑通第一条消息.md](doc/ClawX-Cat-从源码到跑通第一条消息.md)
- [ClawX-Cat-Linux-Headless-快速手册.md](doc/ClawX-Cat-Linux-Headless-快速手册.md)
- [Cloud Relay Service README.md](services/cloud-relay/README.md)

### 桥接接口

- [ClawX-Bridge-接入说明.md](doc/ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](doc/ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](doc/ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX-Cat-Bridge-命令类型清单.md](doc/ClawX-Cat-Bridge-命令类型清单.md)

### 设计与扩展

- [ClawX-UniApp-远程控制设计手册.md](doc/ClawX-UniApp-远程控制设计手册.md)
- [ClawX-Linux-无GUI服务化远程控制实施方案.md](doc/ClawX-Linux-无GUI服务化远程控制实施方案.md)
- [ClawX-Linux-更新与自动更新方案.md](doc/ClawX-Linux-更新与自动更新方案.md)

## 常用命令

| 场景 | 命令 |
|------|------|
| 初始化项目 | `pnpm run init` |
| 开发启动 | `pnpm dev` |
| ESLint 检查 | `pnpm run lint` |
| TypeScript 检查 | `pnpm run typecheck` |
| 单元测试 | `pnpm test` |
| E2E 测试 | `pnpm run test:e2e` |
| 构建前端 | `pnpm run build:vite` |
| Windows 双 track 打包 | `.\build.bat` |
| Windows 双 track 打包并改版本 | `.\build.bat 1.2.3` |
| Linux AMD64 Debian 打包 | `.\build_linux_amd.bat` |
| Linux ARM64 Debian 打包 | `.\build_linux_arm.bat` |
| Linux AMD64 Generic 打包 | `.\build_linux_generic_amd.bat` |
| 更新 OpenClaw 版本 | `.\update-openclaw.bat 2026.4.14` |
| 单独设置应用版本 | `.\set-version.bat 1.2.3` |
| 启动 Cloud Relay | `pnpm run relay:service` |

## 项目结构

```text
ClawX-Cat/
├── electron/                # Electron 主进程、Host API 路由、网关与系统集成
├── src/                     # React 渲染进程页面与组件
├── tests/                   # 单元测试与 Electron E2E
├── resources/               # 图标、截图等静态资源
├── scripts/                 # 构建、下载、打包辅助脚本
├── build/                   # 随包资源与 OpenClaw 相关构建产物
├── doc/                     # 操作手册、桥接文档、设计方案
└── README*.md               # 多语言项目说明
```

## 开发时建议注意

- 渲染层尽量统一通过 `host-api` / `api-client` 调用后端能力
- 不要在页面组件里直接新增裸 `ipcRenderer.invoke(...)` 调用
- 需要对外打包时，优先检查 `package.json` 脚本和 `.github/workflows` 是否与当前发布流程一致
- 如果改动影响功能说明，记得同步更新三份 README，避免多语言文档漂移

## 许可证

本项目沿用仓库中的 [MIT License](LICENSE)。如你继续二次分发，请同时检查你新增依赖与资源文件的许可证要求。
