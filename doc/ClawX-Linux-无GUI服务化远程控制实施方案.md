# ClawX Linux 无 GUI 服务化远程控制实施方案

## 1. 文档目标

本文档面向下一阶段的 ClawX 盒子化与远程控制落地，目标是回答 4 个问题：

1. 当前 ClawX 已经具备哪些可复用基础。
2. 为什么现在的 Headless 还不足以支撑 Linux 常驻服务。
3. Linux 无 GUI 版本应如何启动、暴露桥接、承接远程控制。
4. 哪些 GUI 中可配置的核心能力，需要系统性开放给 WebSocket Bridge。

本文档的结论不是“另起一套 Linux 版”，而是：

- 继续复用当前 `RuntimeFacade + Host API + Bridge WebSocket + GatewayManager` 主链路。
- 在此基础上补一个真正的 `service-host` 宿主。
- 把 GUI 可配置的关键能力整理为稳定的远程控制协议。
- 最终让 Linux 设备上的 ClawX 可以像后台服务一样运行，并被 APP/Web/远程控制台接管。
- 明确把 ClawX 与 OpenClaw 视为同一服务单元: ClawX 是管理壳，OpenClaw 是被管理执行内核，两者必须绑定启动、绑定失败。

## 2. 目标与边界

### 2.1 总目标

目标形态如下：

```text
手机 APP / Web 控制台 / 外部桌面端
  -> WebSocket Bridge
  -> ClawX Service Host
  -> RuntimeFacade
  -> GatewayManager
  -> OpenClaw Gateway
  -> OpenClaw
```

达成后应满足：

- Linux 上即使没有可视化桌面，也能启动 ClawX。
- ClawX 可作为常驻服务运行。
- ClawX 服务启动时必须同步拉起 OpenClaw / Gateway 链路，任一关键环节启动失败都判定为 ClawX 服务启动失败。
- 服务启动后可按配置打开桥接端口。
- 外部客户端可通过桥接完成模型、Agent、多 Agent 通讯等核心配置。
- 远程客户端拿到的能力边界，尽量接近当前 GUI。

### 2.2 本阶段必须覆盖

- 桥接服务启动、停止、重启、状态查询。
- 模型配置。
- Agent 新建、删除、导入、编辑。
- 多 Agent 通讯总开关与单 Agent 通讯目标。
- Provider 基础配置。
- 关键 Settings 读写。
- Gateway 控制、聊天、文件、会话、日志。
- Linux 服务化安装与开机自启。
- ClawX 与 OpenClaw 的绑定启动、绑定停止、失败联动与健康判定。

### 2.3 本阶段非目标

- 不在这一阶段做完整云端中转平台。
- 不重写 OpenClaw Gateway 协议。
- 不要求把所有 GUI 交互都 1:1 搬成桥接动作。
- 不强求首阶段就支持所有依赖 WebView 的登录流程。

## 3. 当前基础能力现状

基于当前仓库实现，ClawX 已经不是“只有 GUI 才能工作”的状态，而是已经具备一套可继续扩展的双模式基础。

### 3.1 已有 Headless 启动入口

当前 `electron/main/index.ts` 已支持：

- `CLAWX_HEADLESS=1`
- `--clawx-headless`
- `--headless`

当进入 `headless` 模式时：

- 不创建主窗口。
- 仍会初始化 `RuntimeFacade`。
- 仍会启动 Host API。
- 会按桥接配置决定是否启动 WebSocket Bridge。

这说明：

- “无 GUI 启动” 的入口已经存在。
- 现有桥接并不依赖 React 页面。
- 运行时主链路已经部分从 GUI 中解耦。

### 3.2 已有统一运行时门面

当前 `electron/runtime/runtime-facade.ts` 已统一封装：

- Gateway 启停与健康检查。
- Gateway RPC / HTTP 转发。
- Host API Server 启动。
- 事件总线。
- 文件、会话、日志、聊天等运行时能力。
- Bridge 状态与能力清单。

这层是后续 Linux 服务化的核心复用点。

同时要注意，当前这层的真实语义已经接近：

- ClawX 不直接替代 OpenClaw。
- ClawX 通过 `RuntimeFacade -> GatewayManager -> OpenClaw Gateway -> OpenClaw` 驱动执行。
- 因此后续 Linux 服务化时，不能把 ClawX 服务与 OpenClaw 进程拆成彼此独立、互不影响的两个产品服务。

### 3.3 已有 WebSocket Bridge

当前 `electron/bridge/server.ts` + `electron/bridge/protocol.ts` 已实现：

- Token 鉴权。
- 桥接审计。
- 文件暂存。
- 聊天与流式事件。
- 会话读取。
- 日志读取。
- Gateway 管控。
- Agent / 模型的一部分专用动作。
- `hostapi.fetch` 兜底代理。

这意味着：

- 远程控制主入口已经存在。
- 不是从零开始设计桥接。
- 需要做的是“补齐能力”和“把启动方式服务化”。

### 3.4 已有 Host API 全量路由基础

当前 `electron/api/server.ts` 已挂载多个路由模块，包括：

- `agents`
- `models`
- `providers`
- `settings`
- `channels`
- `cron`
- `files`
- `sessions`
- `logs`
- `usage`
- `integrations`
- `bridge`

这说明很多 GUI 配置能力，本质已经沉淀成宿主侧 HTTP 接口，只是还没有全部升级成稳定的桥接协议。

## 4. 当前不足与问题判断

虽然当前已有 `headless` 与 `bridge` 基础，但距离“Linux 可安装服务并被远程 APP 长期控制”还有明显差距。

### 4.1 当前 Headless 仍属于 Electron 宿主模式

现状：

- 现在的 headless 仍从 `electron/main/index.ts` 进入。
- 它只是“不创建窗口”，不是一个独立的 service host。
- 生命周期、打包形态、错误恢复、服务安装方式还偏桌面应用思维。

问题：

- Linux 服务器/盒子环境通常希望直接以服务方式启动。
- Electron 作为宿主仍带来额外图形壳负担。
- systemd、日志管理、崩溃重启、无交互部署还没有标准化。

### 4.2 当前桥接“专用协议”覆盖不完整

现状：

- 目前桥接已原生支持：
  - Agent 列表/新建/导入预检/导入到现有 Agent
  - 多 Agent 通讯开关
  - 单 Agent 通讯目标
  - Agent 模型覆盖
  - Agent 指令同步
  - OpenClaw 主模型 / fallback / provider model
- 但仍有很多 GUI 配置能力主要留在 Host API 路由里。

问题：

- 远程 APP 如果大量依赖 `hostapi.fetch`，协议边界会变松。
- APP 端需要自己理解大量 HTTP 路径与返回结构。
- 后续做权限控制、能力声明、审计归类会比较困难。

### 4.3 当前 Host API 只监听本地回环

现状：

- Host API Server 当前只监听 `127.0.0.1`。

这本身是正确的安全默认值，但也意味着：

- Linux 远程控制的外部入口必须以 Bridge 为主。
- 不能把“远程控制方案”建立在直接暴露 Host API 上。

### 4.4 一部分 GUI 功能依赖窗口/内嵌浏览器

例如：

- 某些 OAuth / WebView 登录。
- 部分内嵌网页登录确认。
- 某些二维码/浏览器回调流程。

这些能力不是简单开放一个桥接动作就能在无 GUI 中自然成立。

因此要分两类处理：

- `可服务化`：配置文件、模型、Agent、通道、日志、会话、聊天。
- `需改造后服务化`：依赖 WebView / 浏览器的登录流程。

## 5. 目标架构

建议把 ClawX 收敛成 4 层。

### 5.1 核心运行时层

职责：

- GatewayManager 与 OpenClaw 交互。
- 聊天、文件、会话、日志、配置同步。
- 运行时事件分发。
- 统一维护 ClawX 与 OpenClaw 的绑定生命周期。

这里要明确一个核心原则：

- ClawX 是 OpenClaw 的管理壳，不是与 OpenClaw 平级的独立业务服务。
- 对外暴露的是 `ClawX service`，但对内必须把 `Gateway + OpenClaw` 视为该服务的关键依赖。
- 只要 OpenClaw/Gateway 启动失败、崩溃且无法恢复，ClawX 当前实例就应进入失败态，而不是继续把自己标记为“服务正常”。

建议继续复用：

- `electron/runtime/*`
- `electron/gateway/*`
- `electron/services/*`
- `electron/utils/openclaw-*`

### 5.2 宿主层

建议明确分成两种宿主：

- `electron-gui-host`
  - 现有桌面版。
- `service-host`
  - Linux 无 GUI 常驻服务。

要求：

- 两者共用 `RuntimeFacade` 及业务逻辑。
- 差异只保留在进程生命周期、窗口、系统集成、服务管理。

### 5.3 接入层

接入层统一为：

- GUI IPC
- 本地 Host API
- 外部 WebSocket Bridge

原则：

- GUI 本地页面继续优先走现有主链路。
- Linux 远程控制优先走 Bridge。
- Host API 主要作为宿主本地管理与桥接内部复用通道。

### 5.4 运维层

新增 Linux 服务化配套：

- systemd service
- 环境变量文件
- 日志目录与轮转
- 运行目录 / PID / 配置目录
- 健康检查与自动重启

## 6. Linux 服务模式设计

### 6.1 推荐产物形态

建议新增一个真正面向 Linux 的服务入口，例如：

- `scripts/clawx-service.mjs`
  或
- `dist-service/index.js`

它的职责是：

- 初始化 `RuntimeFacade`
- 初始化必要的 store / userData / logger
- 启动并校验 OpenClaw / Gateway 主链路
- 只有在 OpenClaw / Gateway 启动成功后才开放 Host API 与 Bridge 对外服务
- 在 OpenClaw / Gateway 失效时联动更新 Bridge 可用性与整体服务状态
- 监听系统信号并优雅退出

这个入口不创建窗口，不依赖 Electron `BrowserWindow`。

推荐启动顺序：

1. 初始化本地目录、日志、配置。
2. 初始化 `RuntimeFacade`。
3. 拉起 OpenClaw / Gateway，并等待进入可用状态。
4. 若第 3 步失败，则直接退出当前 ClawX 服务进程。
5. 仅在 OpenClaw / Gateway 成功后，再启动 Host API 与 Bridge。

这样做的原因是：

- 从用户视角，ClawX 和 OpenClaw 是同一套服务，不应出现“ClawX 服务起来了，但 OpenClaw 没起来”的假成功状态。
- 远程 APP 一旦连上 Bridge，就默认宿主已具备可执行能力，因此 Bridge 不应早于核心执行链路对外开放。

### 6.2 推荐启动模式

建议支持 3 种模式：

1. GUI 模式
   - 现有 Electron 桌面启动方式。
2. Headless 调试模式
   - 继续保留当前 `--clawx-headless`。
   - 用于开发、联调、兼容过渡。
3. Service 模式
   - 面向 Linux 盒子与 Debian 安装后的常驻运行。
   - 作为最终远程控制正式入口。

### 6.3 推荐 CLI / 环境变量

建议把服务入口统一为：

```bash
clawx-service start
clawx-service stop
clawx-service status
```

并支持环境变量：

- `CLAWX_SERVICE=1`
- `CLAWX_HEADLESS=1`
- `CLAWX_USER_DATA_DIR=/var/lib/clawx`
- `CLAWX_LOG_DIR=/var/log/clawx`
- `CLAWX_BRIDGE=1`
- `CLAWX_BRIDGE_HOST=0.0.0.0`
- `CLAWX_BRIDGE_PORT=18989`
- `CLAWX_BRIDGE_TOKEN=...`
- `CLAWX_HOST_API_PORT=13210`
- `CLAWX_GATEWAY_AUTOSTART=1`

### 6.4 systemd 建议

建议提供标准 service 文件，例如：

```ini
[Unit]
Description=ClawX Service
After=network.target

[Service]
Type=simple
User=clawx
Group=clawx
EnvironmentFile=/etc/clawx/clawx.env
ExecStart=/opt/clawx/bin/clawx-service start
Restart=always
RestartSec=3
WorkingDirectory=/var/lib/clawx

[Install]
WantedBy=multi-user.target
```

首阶段无需把 systemd 做得很复杂，但必须满足：

- 开机自启
- 崩溃自动拉起
- 日志可追踪
- 配置可通过环境文件覆盖
- OpenClaw / Gateway 启动失败时，systemd 能把整个 `clawx.service` 视为失败并按策略重试

这里的建议是不单独再注册一个对等的 `openclaw.service` 给用户手工分别管理，而是：

- 由 `clawx.service` 统一拉起并监管 OpenClaw 依赖链路。
- OpenClaw 作为 ClawX 服务内部依赖，由 ClawX 负责探活、重启与失败上抛。
- 用户对外只操作一个服务入口：`clawx.service`。

## 7. 桥接能力补齐原则

Linux 无 GUI 方案的关键不是“把设置页搬过来”，而是把“页面背后的可配置能力”沉淀成稳定桥接协议。

建议桥接能力分三档：

### 7.1 A 档：必须原生提供专用动作

这些能力是远程 APP 的主路径，应该有明确的 WebSocket action，而不是长期依赖 `hostapi.fetch`：

- 桥接状态与配置
- Agent 管理
- 多 Agent 通讯
- 模型配置
- Provider 配置
- 核心 Settings
- Channel 配置与绑定
- Gateway 控制
- 聊天 / 文件 / 会话 / 日志
- OpenClaw 依赖状态与运行时健康

### 7.2 B 档：允许短期走 `hostapi.fetch`

这些能力可以先通过 Host API 代理过渡，但要尽量收敛：

- usage
- cron
- skills
- app 级信息
- integrations 的部分只读信息

### 7.3 C 档：异步任务化能力

对于登录、扫码、浏览器授权等交互型流程，不建议做成简单请求-响应，应抽成：

- `task.start`
- `task.event`
- `task.poll`
- `task.cancel`

这样才能兼容无 GUI、APP、网页、桌面远端三类客户端。

## 8. 当前能力覆盖判断

### 8.1 已有原生桥接动作

当前已具备较好基础：

- `agents.list`
- `agents.create`
- `agents.import.inspect`
- `agent.import.package`
- `agents.communication.update`
- `agent.communication.update`
- `agent.model.update`
- `agent.instructions.sync`
- `agents.instructions.syncAll`
- `models.config.get`
- `models.primary.set`
- `models.fallback.add`
- `models.fallback.remove`
- `models.providerModel.add`
- `models.providerModel.remove`
- `gateway.*`
- `chat.*`
- `file.*`
- `session.*`
- `logs.*`

这些已经覆盖了远程控制的第一核心圈。

### 8.2 目前主要依赖 Host API 代理的能力

当前从宿主角度看，以下能力已经有 Host API 路由，但没有形成同等级桥接命名空间：

- `providers.*`
- `settings.*`
- `channels.*`
- `cron.*`
- `skills.*`
- `usage.*`
- `app.*`
- `integrations.*`

这部分就是 Linux 服务化后“远程控制完整性”的主要缺口。

## 9. 推荐新增桥接协议清单

下面是建议新增的原生桥接命名空间。

### 9.1 Bridge 自身管理

- `bridge.status.get`
- `bridge.config.get`
- `bridge.config.set`
- `bridge.token.rotate`
- `bridge.audit.get`
- `bridge.audit.clear`

说明：

- 现在桥接自身管理主要通过 Host API。
- 如果未来 APP 主要依赖 WebSocket，桥接自身配置最好也能从 WebSocket 完成闭环。

### 9.2 Settings

- `settings.get`
- `settings.patch`
- `settings.reset`
- `settings.key.get`
- `settings.key.set`

首阶段建议允许的设置范围：

- bridge 相关
- proxy 相关
- launch / startup 相关
- 其他不会引发宿主 UI 依赖的通用配置

### 9.3 Providers

- `providers.list`
- `providers.get`
- `providers.create`
- `providers.update`
- `providers.delete`
- `providers.default.get`
- `providers.default.set`
- `providers.validate`
- `providers.apiKey.getState`
- `providers.apiKey.set`
- `providers.apiKey.clear`

说明：

- Provider 是“模型页”和“安装向导”的基础。
- 远程端如果不能配置 provider，就无法真正完成 Linux 无 GUI 初始化。

### 9.4 Channels

- `channels.configured.list`
- `channels.accounts.list`
- `channels.targets.list`
- `channels.defaultAccount.set`
- `channels.binding.set`
- `channels.binding.clear`
- `channels.config.get`
- `channels.config.set`
- `channels.enabled.set`
- `channels.credentials.validate`
- `channels.config.validate`

说明：

- 这是“远程可替代 GUI 管理通道” 的关键。
- 不建议长期让远程 APP 直接拼 Host API 路径。

### 9.5 App / Runtime 信息

- `app.info.get`
- `runtime.status.get`
- `runtime.health.get`
- `runtime.paths.get`
- `runtime.mode.get`
- `runtime.dependencies.get`

说明：

- 远程客户端首次连接时，需要知道当前是不是 GUI 模式、service 模式、配置目录在哪里、Gateway 是否在线、Bridge 是否可用。
- 还需要明确知道 OpenClaw 相关依赖是否已真正就绪，避免把“壳在线、内核未启动”误判为服务正常。

### 9.6 异步登录任务

对依赖人工交互的流程建议新增任务模型：

- `integration.task.start`
- `integration.task.status`
- `integration.task.cancel`
- `integration.task.subscribe`

首批适用对象：

- IterativeCat / XYIT 登录
- 需要浏览器回调的 OAuth
- 二维码登录类通道

返回信息建议统一为：

- `taskId`
- `taskType`
- `status`
- `step`
- `display`
- `qrUrl`
- `verificationUrl`
- `userCode`
- `error`

## 10. 桥接协议设计原则

### 10.1 能力声明必须可枚举

`runtime.capabilities.get` 不能只返回一个大概列表，后续应扩展为：

- 当前模式
- 是否 service-host
- 支持的 action 列表
- 支持的登录任务类型
- 是否允许远程配置
- 协议版本
- OpenClaw 依赖是否为 hard requirement

建议至少返回：

```json
{
  "protocolVersion": "1",
  "mode": "service",
  "modeFeatures": ["service-host", "bridge-websocket", "host-api"],
  "remoteActions": ["agents.list", "providers.list", "settings.patch"],
  "dependencies": {
    "openclaw": { "required": true, "state": "running" }
  }
}
```

### 10.2 专用动作优先于 `hostapi.fetch`

保留 `hostapi.fetch` 作为兜底，但原则上：

- 主路径能力要有专用动作。
- 专用动作应有更清晰的参数校验。
- 审计记录要能看出具体业务操作。
- 涉及 OpenClaw 执行链路的动作，要返回明确依赖状态错误，例如 `OPENCLAW_UNAVAILABLE`，不能只给笼统失败。

### 10.3 ClawX 与 OpenClaw 必须绑定语义

桥接协议层需要遵守以下语义：

- 如果某个动作本质依赖 OpenClaw / Gateway 执行，则 ClawX 不能把自己当成独立执行者。
- Bridge 收到相关指令时，应先确认 OpenClaw 依赖链路可用。
- 若依赖不可用，应明确返回依赖失败，而不是假装请求已受理。
- 对 `chat.*`、`gateway.*`、部分 `agent.*`、模型同步类动作，都应默认带有 OpenClaw 依赖前提。

### 10.4 长任务必须事件化

对于扫码、OAuth、导入大型资源、插件安装等动作：

- 不要只做同步返回。
- 要支持事件订阅和状态查询。
- 客户端断线后可恢复查看状态。

### 10.5 参数格式要去 UI 化

协议层不要带页面概念，应直接表达业务意图，例如：

- 不传“第几步表单”
- 只传“provider 配置”“agent 通讯配置”“模型选择结果”

## 11. 推荐实施阶段

### 11.1 第一阶段：服务化宿主抽离

目标：

- 让 ClawX 在 Linux 上可以不依赖窗口稳定运行。
- 让 ClawX 与 OpenClaw 以一个整体服务单元稳定运行。

实施项：

- 抽出 `service-host` 启动入口。
- 把 `electron/main/index.ts` 中与窗口无关的初始化逻辑下沉。
- 把窗口、托盘、菜单逻辑留在 GUI 宿主。
- 让 `RuntimeFacade` 可在无 `BrowserWindow` 环境稳定工作。
- 把 OpenClaw / Gateway 启动成功纳入 ClawX 服务启动完成条件。
- 明确依赖失败时的退出码、日志与重试策略。

验收：

- Linux 命令行可直接启动服务。
- OpenClaw / Gateway 拉起成功后，Host API 与 Bridge 才对外可用。
- 若 OpenClaw / Gateway 拉起失败，则 ClawX 服务整体启动失败。

### 11.2 第二阶段：桥接协议补齐

目标：

- 让远程客户端能完成大部分 GUI 核心配置。

实施项：

- 新增 `providers.*`
- 新增 `settings.*`
- 新增 `channels.*`
- 新增 `app.* / runtime.*`
- 梳理 `bridge.*` 自身管理动作

验收：

- 外部客户端不借助 GUI，也能完成首次模型与 Agent 配置。

### 11.3 第三阶段：登录类流程异步化

目标：

- 解决“无 GUI 不能做登录/扫码”的问题。

实施项：

- 把依赖浏览器/二维码/用户操作的流程改为任务协议。
- 输出二维码、用户码、回调地址、阶段状态。
- 支持轮询与订阅。

验收：

- APP 端可独立完成关键登录流程。

### 11.4 第四阶段：Linux 安装与运维闭环

目标：

- 让 Linux 包装成真正可交付的服务产品。

实施项：

- Debian 安装脚本
- systemd 服务注册
- 默认目录规范
- 环境配置文件
- 升级与日志保留策略

验收：

- 安装包安装后可 `systemctl start clawx`
- 重启机器后自动拉起
- Bridge 可按配置远程接入

## 12. 目录与配置建议

建议 Linux 标准目录如下：

- 程序目录：`/opt/clawx`
- 配置目录：`/etc/clawx`
- 数据目录：`/var/lib/clawx`
- 日志目录：`/var/log/clawx`
- 临时目录：`/var/lib/clawx/tmp`

其中：

- OpenClaw workspace / agent / session 数据应落在数据目录。
- 桥接 token 与服务配置应支持从配置目录读取。
- 运行时临时文件、上传暂存文件应集中管理。

## 13. 安全建议

Linux 远程控制打开后，安全边界必须比当前局域网调试更严格。

首阶段建议至少做到：

- Bridge 默认关闭远程访问，安装时明确开启。
- 强制 token 鉴权。
- token 支持轮换。
- 审计保留最近操作记录。
- 明确区分只读动作与写动作。
- 为后续权限分级预留字段，例如：
  - `scope`
  - `permissions`
  - `clientId`

中期建议：

- 支持双 token 或客户端凭证。
- 支持 IP 白名单。
- 支持写操作确认或高危动作二次校验。

## 14. 测试与验收建议

### 14.1 服务启动验收

- 无 GUI 环境可正常启动。
- OpenClaw / Gateway 会作为 ClawX 服务启动前提被同步拉起。
- Host API 正常监听本地。
- Bridge 只在 OpenClaw / Gateway 就绪后按配置监听。
- OpenClaw / Gateway 启动失败时，ClawX 进程退出并上报失败。

### 14.2 远程配置验收

远程客户端至少应验证：

- 新建 Agent
- 导入 Agent
- 修改多 Agent 通讯
- 设置 Agent 模型覆盖
- 设置主模型 / fallback / provider model
- 创建或修改 provider
- 修改关键 settings
- 配置 channel 绑定

### 14.3 远程业务验收

- 文本聊天
- 带附件聊天
- 会话列表与 transcript 获取
- 日志读取
- Gateway 重启与健康检查

### 14.4 稳定性验收

- service 异常退出后可自动拉起
- token 轮换后旧连接被拒绝
- 大量并发请求下桥接不崩溃
- 客户端断开后审计与资源清理正常
- OpenClaw / Gateway 异常退出后，ClawX 能按策略重拉；若无法恢复，则整体进入失败态

## 15. 实施优先级建议

按价值和依赖关系，建议优先级如下：

1. `service-host` 抽离
2. `providers.*`
3. `settings.*`
4. `channels.*`
5. `bridge.*` 自身管理动作
6. 登录类异步任务协议
7. Debian/systemd 安装闭环

原因：

- 没有 `service-host`，Linux 无 GUI 仍不算真正成立。
- 没有 provider/settings，远程首次初始化无法闭环。
- 没有 channels，很多“软件上能配”的东西远程仍残缺。
- 登录类任务更复杂，适合放在核心配置闭环之后。

## 16. 最终建议

本项目后续最合理的路线不是再做一套“Linux 专属页面逻辑”，而是继续沿着现有方向收敛：

- GUI 继续作为本地体验层。
- Bridge 继续作为远程控制主入口。
- RuntimeFacade 继续作为唯一业务门面。
- Linux 新增 `service-host` 作为无 GUI 宿主。
- ClawX 与 OpenClaw 对外始终作为一个绑定服务单元交付与运维。

一句话总结：

先把 ClawX 从“桌面应用 + 附带桥接”升级为“绑定 OpenClaw 的运行时服务 + GUI 壳 + Bridge 接入层”，再在这个基础上承接 APP 远程控制，成本最低，也最稳。
