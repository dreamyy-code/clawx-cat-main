# ClawX Windows 双模式桥接实施方案

## 1. 目标

本方案以当前 `ClawX-main` 为基础，先在 Windows 环境下完成三件事：

1. 将当前 GUI 形态中的核心运行链路拆成清晰的三层结构。
2. 在不破坏现有 GUI 体验的前提下，新增可被外部访问的 WebSocket 桥接能力。
3. 为后续的无 GUI 模式、Debian 盒子模式、Python 自动化测试打好统一基础。

本阶段的核心原则是：

- 先跑通 GUI 方案，再沉淀成无 GUI 方案。
- Windows 先行，Debian 复用同一套核心逻辑。
- 不重写 OpenClaw 协议，优先复用现有 `GatewayManager`、Host API、RPC 调用链路。

## 2. 范围与非目标

### 2.1 本阶段范围

- 梳理并拆分当前 ClawX 的三层结构。
- 保持现有 Electron GUI 能继续工作。
- 在主链路之外增加远程 WebSocket 桥接入口。
- 支持后续使用 Python 脚本模拟远程客户端连接、发消息、接收流式响应。

### 2.2 本阶段非目标

- 不在第一阶段直接做 Debian 盒子的完整交付包。
- 不在第一阶段直接做纯无 GUI 常驻服务产物。
- 不在第一阶段引入完整账号系统、设备绑定平台、多租户控制台。
- 不在第一阶段重写聊天 store、页面 UI、Provider 体系。

## 3. 总体判断

从软件结构看，Windows 和 Debian 的主要差异不在业务链路本身，而在以下外围能力：

- 进程启动方式
- 开机自启方式
- 服务化方式
- 打包产物与依赖
- 系统托盘、窗口、权限差异

因此，本次优先拆出的核心能力应尽量不依赖 Electron GUI，不依赖 Windows 专有窗口能力，而是作为可复用运行时存在。这样后续迁移到 Debian 时，主要调整的是宿主层和打包层，而不是聊天主链路。

需要明确的是：Debian 不会只是“最后编译一下”这么简单，但只要三层边界拆得干净，绝大多数业务逻辑都可以复用。

## 4. 三层拆分目标

建议将当前系统拆成如下三层。

### 4.1 核心运行时层

职责：

- OpenClaw Gateway 启停
- Gateway WebSocket 连接管理
- RPC 请求发送与响应管理
- Gateway 事件订阅与分发
- 会话级发送、停止、状态管理
- 配置同步、日志、健康检查

本层目标是：不依赖 GUI 页面，不直接依赖 React 状态，不直接耦合窗口。

当前可复用的主要代码：

- `electron/gateway/manager.ts`
- `electron/gateway/*`
- `electron/utils/openclaw-*`
- `electron/services/providers/*`
- `electron/api/routes/*` 中与业务有关的 route 逻辑

### 4.2 宿主适配层

职责：

- 把核心运行时挂载到某个具体宿主中
- 提供进程生命周期、配置目录、日志目录、启动参数等宿主能力
- 决定当前运行在 GUI 模式还是无 GUI 模式

本层建议至少支持两种宿主：

- `GUI 宿主`：Electron 主进程
- `Headless 宿主`：Node 进程 / 后台服务 / 盒子守护进程

本层的关键原则是：GUI 与无 GUI 共用核心运行时，只更换宿主壳。

### 4.3 访问接入层

职责：

- 本地 GUI 页面访问
- Electron IPC 调用
- Host API 访问
- 外部 WebSocket 桥接访问
- 后续 Python 测试脚本访问

本层是所有“入口”的统一封装层，本质上不直接承载业务，而是把业务调用转发到核心运行时。

## 5. 当前代码与三层的映射

### 5.1 当前已经具备核心运行时特征的模块

- `electron/gateway/manager.ts`
- `electron/gateway/process-launcher.ts`
- `electron/gateway/config-sync.ts`
- `electron/gateway/ws-client.ts`
- `electron/gateway/supervisor.ts`

这些模块已经承担了：

- OpenClaw Gateway 子进程启动
- Gateway WebSocket 连接
- RPC 调用
- 生命周期和重连

它们天然适合成为后续“核心运行时层”的基础。

### 5.2 当前更偏宿主层的模块

- `electron/main/index.ts`
- `electron/main/ipc-handlers.ts`
- `electron/main/window.ts`
- `electron/main/tray.ts`
- `electron/preload/index.ts`

这些模块目前强依赖 Electron，后续应尽量只负责：

- 创建窗口
- 注册 IPC
- 将请求转交给核心运行时

### 5.3 当前已经具备访问接入层雏形的模块

- `electron/api/server.ts`
- `electron/api/routes/*`
- `src/lib/host-api.ts`
- `src/lib/api-client.ts`

其中：

- Host API 已经是本机 HTTP 接入层
- IPC 已经是本机 Electron 接入层

本次新增的远程 WebSocket 桥接，建议与这两者并列，成为第三类接入层。

## 6. 目标架构

建议收敛为如下结构：

```text
GUI 页面 / Python 脚本 / 外部 APP
        -> 接入层
        -> 运行时服务层
        -> GatewayManager
        -> OpenClaw Gateway
        -> OpenClaw 执行
```

细化后的 Windows 第一阶段结构如下：

```text
React GUI
  -> IPC / Host API
  -> Runtime Facade
  -> Gateway Runtime
  -> OpenClaw Gateway

Remote WebSocket Client
  -> Bridge WebSocket Server
  -> Runtime Facade
  -> Gateway Runtime
  -> OpenClaw Gateway
```

其中关键点是：

- GUI 和远程客户端都不直接碰 OpenClaw 协议细节。
- 两者都通过同一个运行时门面层访问。
- 这样后续无 GUI 模式只需要换宿主，不需要换业务主链路。

## 7. 第一阶段实施目标

第一阶段不追求直接产出 headless 版本，而是先完成“GUI + 远程桥接共存”的 Windows 版本。

阶段结果应满足：

1. 现有 ClawX GUI 保持可用。
2. GUI 仍可本地聊天、查看事件、调试配置。
3. Windows 进程内新增一个可控的 WebSocket 桥接服务。
4. Python 脚本可通过 WebSocket 模拟客户端发消息并收到流式响应。
5. GUI 与桥接服务调用的是同一套核心运行时能力。

## 8. 分步实施

### 8.1 第一步：抽出运行时门面层

目标：

- 在 Electron 主进程和具体接入层之间加一层统一服务门面。

建议新增目录：

- `electron/runtime/`

建议新增模块：

- `electron/runtime/runtime-facade.ts`
- `electron/runtime/chat-runtime.ts`
- `electron/runtime/gateway-runtime.ts`
- `electron/runtime/session-runtime.ts`

建议职责：

- `runtime-facade.ts`
  - 作为统一入口，封装“启动 Gateway、发送消息、停止消息、查询状态、订阅事件”
- `gateway-runtime.ts`
  - 包装现有 `GatewayManager`
- `chat-runtime.ts`
  - 收敛 `chat.send`、`chat.abort`、附件消息、运行态事件
- `session-runtime.ts`
  - 管理会话 key、会话上下文和后续远程客户端需要的会话映射

第一步完成后要求：

- `ipc-handlers.ts` 不再直接组织复杂业务逻辑。
- 业务 handler 只负责参数校验和调用 `runtime-facade`。
- 后续 WebSocket 桥接同样只调用 `runtime-facade`。

### 8.2 第二步：梳理事件总线

目标：

- 让 GUI 和远程客户端都能订阅同一套运行时事件。

当前已有基础：

- `electron/main/index.ts` 中已经把 Gateway 事件桥接到 `hostEventBus`

建议新增统一事件模型：

- `runtime.status`
- `runtime.error`
- `chat.started`
- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`
- `gateway.status`

建议新增模块：

- `electron/runtime/runtime-events.ts`

要求：

- 先在运行时层标准化事件格式
- GUI 通过 IPC/Host API 继续消费
- WebSocket 桥接直接消费同一事件总线并转发出去

### 8.3 第三步：增加 WebSocket 桥接服务

目标：

- 在 Windows GUI 进程内额外启动一个可控的桥接 WebSocket 服务，用于外部访问。

建议新增目录：

- `electron/bridge/`

建议新增模块：

- `electron/bridge/server.ts`
- `electron/bridge/protocol.ts`
- `electron/bridge/session-store.ts`
- `electron/bridge/auth.ts`

建议职责：

- `server.ts`
  - 启动 WebSocket Server
  - 管理客户端连接
  - 处理鉴权
  - 处理订阅和消息转发
- `protocol.ts`
  - 定义 WebSocket 消息结构
- `session-store.ts`
  - 维护外部连接与会话、运行实例之间的映射
- `auth.ts`
  - 提供最小鉴权能力，例如本地 token、bridge key 或一次性密钥

建议的第一版协议不要太复杂，先支持以下动作：

- `auth`
- `ping`
- `chat.send`
- `chat.abort`
- `gateway.status.get`
- `session.subscribe`

建议的第一版服务端事件：

- `auth.ok`
- `gateway.status`
- `chat.accepted`
- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`
- `error`

### 8.4 第四步：让 GUI 与桥接服务共用同一条聊天主链路

目标：

- GUI 不保留一套特殊聊天逻辑，桥接服务也不重写一套特殊聊天逻辑。

要求：

- GUI 发送消息继续通过既有前端 store 触发
- 主进程最终统一调用 `runtime-facade.sendMessage(...)`
- WebSocket 桥接收到远程消息后，同样调用 `runtime-facade.sendMessage(...)`

本阶段不要求完全重写前端 store，但要求主进程侧的业务入口统一。

### 8.5 第五步：补充最小配置项

建议增加如下设置项：

- `bridgeEnabled`
- `bridgePort`
- `bridgeToken`
- `bridgeBindHost`
- `bridgeAllowRemote`

建议先复用现有设置读写体系：

- `electron/utils/store.ts`
- `electron/api/routes/settings.ts`

建议第一版默认行为：

- 默认关闭桥接
- 默认监听 `127.0.0.1`
- 默认使用随机 token
- 用户手动开启后，才能被本机外部测试脚本访问

## 9. Python 测试脚本方案

在桥接服务落地后，使用 Python 脚本模拟远程客户端是合适的验证手段。

### 9.1 测试目标

- 验证 WebSocket 鉴权
- 验证 `chat.send`
- 验证流式响应转发
- 验证 `chat.abort`
- 验证错误回包格式
- 验证断线重连后的再次连接

### 9.2 建议脚本目录

- `scripts/bridge-tests/`

建议新增：

- `scripts/bridge-tests/test_connect.py`
- `scripts/bridge-tests/test_chat_send.py`
- `scripts/bridge-tests/test_chat_abort.py`
- `scripts/bridge-tests/test_reconnect.py`

### 9.3 建议 Python 技术栈

- Python 3.11+
- `websockets`
- `asyncio`

### 9.4 第一版测试流程

1. Python 连接桥接 WebSocket。
2. 发送 `auth` 消息。
3. 发送 `chat.send`。
4. 持续接收 `chat.delta`。
5. 收到 `chat.completed` 后结束。
6. 可选发送 `chat.abort` 验证停止能力。

## 10. Windows 先行的落地方式

本阶段只在 Windows 中先行实现，原因如下：

- 当前开发与调试环境就在 Windows
- 当前 GUI 形态最完整
- Electron 主进程、IPC、打包链路都已成熟
- 先在 Windows 打通，有利于后续迁移到 Debian

Windows 第一阶段建议维持当前主形态：

- 继续由 Electron GUI 启动
- 在主进程内加载运行时门面
- 可选启动桥接服务

这样做的好处是：

- 便于观察日志
- 便于本地调试
- 出问题时可直接借助 GUI 排查
- 不需要一开始就解决服务化、后台进程守护、系统启动等问题

## 11. Debian 的复用边界

未来迁移到 Debian 时，理论上可复用以下部分：

- 运行时门面层
- GatewayManager 与 Gateway 相关模块
- WebSocket 桥接协议
- Python 测试脚本
- 大部分配置和事件模型

需要单独处理的通常只有：

- GUI 是否保留
- systemd 服务化
- 开机自启
- 日志目录和权限
- 打包产物
- ARM 设备资源约束

因此，Debian 的核心收益来自“架构复用”，而不是“零成本编译”。

## 12. 风险与控制

### 12.1 风险一：桥接功能直接写进 IPC 逻辑，导致耦合继续扩大

控制策略：

- 先抽 `runtime-facade`
- 所有入口统一走门面层

### 12.2 风险二：GUI 和 WebSocket 各自维护一套事件格式

控制策略：

- 先统一运行时事件模型
- 接入层只做协议转换

### 12.3 风险三：过早做无 GUI，导致调试困难

控制策略：

- 第一阶段坚持 GUI 先行
- Headless 作为第二阶段产物

### 12.4 风险四：WebSocket 一上来就做复杂远程控制平台

控制策略：

- 第一版仅做本机或受控网络验证
- 使用最小协议和 token 鉴权
- 不提前引入复杂账号系统

## 13. 验收标准

第一阶段完成后，应满足以下验收条件：

1. GUI 模式下，现有聊天功能保持可用。
2. 主进程中存在统一的运行时门面，IPC 不再直接承载复杂业务编排。
3. WebSocket 桥接服务可手动开启与关闭。
4. Python 脚本可连接桥接服务，成功发送消息并接收流式响应。
5. GUI 与 Python 客户端最终走到同一个 `chat.send` 运行时入口。
6. 文档中明确无 GUI 模式下一步如何接入，不需推翻已做结构。

## 14. 推荐实施顺序

建议按以下顺序推进：

1. 新增 `runtime-facade`，收口 Gateway 与聊天能力。
2. 将 `ipc-handlers.ts` 中聊天与 Gateway 调用改为经由门面层。
3. 统一运行时事件格式。
4. 新增桥接 WebSocket 服务与最小协议。
5. 编写 Python 测试脚本，完成连接、发送、流式接收验证。
6. 在 GUI 模式下联调桥接服务。
7. 评估第二阶段 headless 启动入口和 Debian 服务化方案。

## 15. 第二阶段预告

当第一阶段稳定后，第二阶段再做以下内容：

- 新增无 GUI 启动入口
- 将 Electron 宿主与 Headless 宿主并行支持
- 适配 Windows 后台模式与 Debian 服务模式
- 进一步加入设备注册、远程控制、盒子常驻能力

到那时，系统将不再是“先有 GUI，后硬拆”，而是“同一套运行时，按不同宿主启动”。
