# ClawX Bridge 增加 HTTP 接口方案

## 1. 目标

本次不是替换现有 Bridge，而是新增一套 HTTP 形态的 Bridge。

最终目标是：

- 保留现有 `WS Bridge`，不影响已有客户端
- 新增一套 `HTTP Bridge`
- `HTTP Bridge` 与 `WS Bridge` 保持能力等价
- 对外文档同时说明 `WS` 和 `HTTP` 两种接入方式

一句话定义：

- 现在的方向不是“把 Bridge 改成 HTTP”
- 而是“在现有 Bridge 旁边，再加一个功能镜像版 HTTP Bridge”

## 2. 为什么这样做

这样做比直接替换更稳，原因很明确：

- 现有 `WS Bridge` 已经能跑，直接替换风险高
- 老客户端可以继续使用 `WS`
- 新客户端，尤其是移动端、弱网环境、经过代理的环境，可以优先走 `HTTP`
- 如果后续 `HTTP Bridge` 还要继续演化，也不会影响原有桥接能力

所以这次的核心原则是：

- `WS` 不动
- `HTTP` 新增
- 两套协议并存
- 内部尽量复用同一套执行逻辑

## 3. 现状核查

### 3.1 现有 WS Bridge

当前外部桥接主实现仍然是：

- `electron/bridge/server.ts`
- `electron/bridge/protocol.ts`

它的特点是：

- 连接方式是 WebSocket
- 首帧 `auth`
- 后续通过 `{ type, requestId, params }` 调用能力
- 事件通过 WS 持续推送

### 3.2 现有 Host API 与 SSE

代码里已经存在一套本地 HTTP 能力：

- `electron/api/server.ts`
- `electron/api/routes/*`
- `electron/api/event-bus.ts`

当前已具备：

- HTTP Server
- Bearer token 鉴权
- JSON 请求处理
- SSE 事件推送
- 大量已有业务路由

但它目前的定位更偏向：

- 本机渲染层调用
- 本地管理接口
- 并不是一套完整的远程 Bridge 镜像协议

### 3.3 当前 Bridge 暴露的能力范围

从 `electron/bridge/protocol.ts` 看，当前 Bridge 开放动作包括：

- 鉴权与状态
  - `auth`
  - `bridge.info`
  - `bridge.status.get`
  - `ping`
  - `runtime.capabilities.get`
- Agent
  - `agents.list`
  - `agents.create`
  - `agents.import.inspect`
  - `agent.import.package`
  - `agents.communication.update`
  - `agent.communication.update`
  - `agent.update`
  - `agent.delete`
  - `agent.model.update`
  - `agent.instructions.sync`
  - `agents.instructions.syncAll`
- 模型
  - `models.config.get`
  - `models.primary.set`
  - `models.fallback.add`
  - `models.fallback.remove`
  - `models.providerModel.add`
  - `models.providerModel.remove`
- 文件
  - `file.stageBuffer`
  - `file.stagePaths`
  - `file.read`
- Gateway
  - `gateway.http`
  - `gateway.controlUi.get`
  - `gateway.rpc`
  - `gateway.start`
  - `gateway.stop`
  - `gateway.restart`
  - `gateway.reload`
  - `gateway.health.get`
  - `gateway.status.get`
- 聊天
  - `chat.send`
  - `chat.sendWithMedia`
  - `chat.abort`
- 会话
  - `session.transcript.get`
  - `session.listLocal`
  - `session.subscribe`
  - `session.delete`
- 日志
  - `logs.get`
  - `logs.files.get`
  - `logs.dir.get`

服务端事件包括：

- `auth.ok`
- `bridge.info`
- `bridge.status`
- `pong`
- `agents.*`
- `models.*`
- `gateway.*`
- `hostapi.result`
- `file.*`
- `chat.accepted`
- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`
- `gateway.notification`
- `gateway.chat-message`
- `session.*`
- `logs.*`
- `error`

## 4. 方案结论

结论很明确：

- 可行
- 而且应按“镜像现有 Bridge 协议能力”的方式做
- 第一阶段不追求把接口完全 REST 资源化
- 第一阶段先把现有 `WS Bridge` 功能完整复刻到 `HTTP + SSE`

也就是说，第一阶段的目标不是“重设计接口”，而是：

- 先做一个 `HTTP Bridge Adapter`
- 保证功能和现有 Bridge 一致
- 文档、鉴权、事件订阅方式清晰
- 客户端可以无脑把原本的 WS 接入迁到 HTTP

## 5. 推荐总体架构

推荐使用“双桥接入口，同一执行内核”。

### 5.1 对外入口

保留两套入口：

- `WS Bridge`
- `HTTP Bridge`

### 5.2 内部执行

两套入口都调用同一套内部能力：

- `RuntimeFacade`
- `GatewayManager`
- `Host API 相关路由/工具`
- 文件与设置服务

### 5.3 事件出口

- `WS Bridge` 继续通过 WebSocket 推送事件
- `HTTP Bridge` 通过 `SSE` 推送事件

即：

- `WS` 负责现有客户端
- `HTTP + SSE` 负责新客户端

## 6. 第一阶段设计原则

### 6.1 不删协议

不删除现有 `protocol.ts` 的任何动作，不改变现有 `WS Bridge` 行为。

### 6.2 不强行资源化

第一阶段不强求把所有动作都改成非常漂亮的 REST 风格。

因为你的目标很明确：

- 先“复现 Bridge 的全部功能”
- 不追求先把接口哲学做得多优雅

所以第一阶段最适合的方式是：

- 保留原有动作语义
- 改变 transport
- 把 `WebSocket message` 映射成 `HTTP request`

### 6.3 不改内部执行链

不建议先动这些内部链路：

- Gateway 内部 WS
- RuntimeFacade 业务入口
- Electron IPC

第一阶段只新增外层 `HTTP Bridge`。

## 7. 推荐实现模型

第一阶段建议采用“命令接口 + 事件接口”的组合。

### 7.1 命令接口

建议新增统一命令入口：

```http
POST /api/bridge-http/command
```

请求体沿用当前 Bridge 协议：

```json
{
  "type": "chat.send",
  "requestId": "req-1",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "你好"
  }
}
```

返回体也尽量镜像 WS 单次响应：

```json
{
  "type": "chat.accepted",
  "requestId": "req-1",
  "sessionKey": "agent:main:main",
  "runId": "run_xxx"
}
```

这样做的好处是：

- 落地快
- 与现有 `protocol.ts` 一一对应
- 客户端迁移成本最低
- 文档可以直接按 Bridge 动作梳理

### 7.2 事件接口

建议新增：

```http
GET /api/bridge-http/events
```

通过 SSE 推送事件，事件类型尽量镜像当前 Bridge 的服务端事件：

- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`
- `gateway.notification`
- `gateway.chat-message`
- `gateway.status`
- 其他原有可广播事件

SSE 示例：

```text
event: chat.delta
data: {"sessionKey":"agent:main:main","event":{"delta":"你好"}}
```

### 7.3 订阅过滤

现有 `WS Bridge` 有：

- `session.subscribe`

HTTP 方案建议有两种可选实现。

#### 方案 A：保留命令式订阅

客户端先调用：

```http
POST /api/bridge-http/command
{
  "type": "session.subscribe",
  "requestId": "req-2",
  "params": {
    "sessionKeys": ["agent:main:main"]
  }
}
```

然后再建立：

```http
GET /api/bridge-http/events?clientId=xxx
```

服务端用 `clientId` 保存过滤状态。

#### 方案 B：查询参数订阅

直接在 SSE 上声明：

```http
GET /api/bridge-http/events?sessionKey=agent:main:main
```

第一阶段更推荐方案 B，因为更简单、更接近 HTTP 习惯。

如果想和 WS 完全等价，再补方案 A。

## 8. 鉴权设计

`HTTP Bridge` 不走首帧 `auth`，改为 HTTP Bearer Token。

建议规则：

- 所有命令接口都要求：
  - `Authorization: Bearer <bridgeToken>`
- SSE 支持两种方式：
  - `Authorization: Bearer <bridgeToken>`
  - `?token=<bridgeToken>` 兼容浏览器 EventSource

建议直接复用现有 Bridge token，而不是 Host API 的随机 session token。

也就是说，要明确分离：

- `Host API token`
- `Bridge token`
- `HTTP Bridge token`

其中：

- `HTTP Bridge token` 第一阶段可以直接等于 `Bridge token`
- 后续如果要细分权限，再单独拆

## 9. 关键实现建议

### 9.1 新增独立路由文件

建议新增一个专门文件，例如：

- `electron/api/routes/bridge-http.ts`

职责：

- 处理 `HTTP Bridge` 鉴权
- 解析命令请求
- 复用现有 Bridge 动作分发逻辑
- 输出 JSON 响应
- 提供 SSE 事件出口

### 9.2 新增共享分发层

当前 `bridge/server.ts` 的核心问题是：

- 动作处理逻辑和 WebSocket transport 耦合较深

要让 `HTTP Bridge` 与 `WS Bridge` 真正功能一致，建议抽一个共享层，例如：

- `electron/bridge/dispatcher.ts`

职责：

- 输入统一的 `BridgeClientMessage`
- 输出统一的单次响应结果
- 把事件广播委托给不同 transport

这样结构会变成：

1. `WS Bridge` 收到消息
2. `WS Bridge` 调 `dispatcher`
3. `HTTP Bridge` 收到命令
4. `HTTP Bridge` 也调 `dispatcher`

这样才能保证两边功能长期一致。

### 9.3 事件复用建议

当前桥接事件主要在：

- `bridge/server.ts` 里监听 Gateway 事件并广播

建议抽出一个共享事件适配器，例如：

- `electron/bridge/event-adapter.ts`

职责：

- 把 Gateway 事件归一化为现有 Bridge 事件格式
- 分别投递给：
  - WebSocket 客户端
  - SSE 客户端

## 10. HTTP Bridge 的接口建议

第一阶段建议只增加少量固定入口，但覆盖全部能力。

### 10.1 基础入口

- `POST /api/bridge-http/command`
- `GET /api/bridge-http/events`
- `GET /api/bridge-http/info`
- `GET /api/bridge-http/status`

### 10.2 管理入口

可复用已有：

- `GET /api/bridge/status`
- `GET /api/bridge/config`
- `GET /api/bridge/token`
- `POST /api/bridge/token/regenerate`

但文档上要明确区分：

- 这些是“Bridge 管理接口”
- `POST /api/bridge-http/command` 是“HTTP Bridge 业务接口”

## 11. 功能镜像策略

本次要的是“完整复现 Bridge 功能”，所以建议按下面策略做。

### 11.1 第一优先级：完全镜像 `protocol.ts`

也就是：

- `type` 不变
- `params` 结构尽量不变
- `requestId` 保留
- 返回 `type` 尽量不变

这样文档里能直接写成：

- WS 调 `chat.send`
- HTTP 也是调 `chat.send`
- 只是 transport 不同

### 11.2 第二优先级：已有 Host API 能复用的直接复用

例如已有这些路由可以承接部分能力：

- Agent 路由
- Models 路由
- Logs 路由
- Sessions 路由
- Files 路由
- Gateway 路由

但对外不要让客户端感知这些内部差异。

客户端只需要知道：

- 它在调用 `HTTP Bridge`
- 而不是在拼接各种内部 Host API 路径

### 11.3 第三优先级：再逐步补 REST 化

等第一阶段完全跑通以后，再考虑把：

- `POST /api/bridge-http/command`

逐步扩展为更细颗粒的资源化接口。

但那是第二阶段，不是当前目标。

## 12. 建议文档组织方式

文档建议不要只写“HTTP 设计理念”，而要面向客户端接入写清楚。

推荐文档结构：

### 12.1 总览

- 当前支持两种接入方式
  - `WebSocket Bridge`
  - `HTTP Bridge`

### 12.2 鉴权

- WS 如何鉴权
- HTTP 如何鉴权
- token 从哪里获取

### 12.3 能力清单

按动作列清楚：

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`
- `session.listLocal`
- `session.transcript.get`
- 其他全部动作

每一项都写：

- WS 示例
- HTTP 示例
- 返回示例
- 事件示例

### 12.4 事件说明

- 哪些事件是命令即时返回
- 哪些事件是后续异步推送
- SSE 如何重连

### 12.5 客户端选型建议

- 移动端优先 HTTP
- 需要强实时双向的工具端可继续 WS

## 13. 风险与注意事项

### 13.1 最大风险不是功能，而是一致性

如果 `WS Bridge` 和 `HTTP Bridge` 分别维护两套动作逻辑，后面很快会漂移。

所以一定要做：

- 共享 dispatcher
- 共享事件适配器

### 13.2 `session.subscribe` 是一个特殊点

它在 WS 下天然成立，因为连接本身就是状态容器。

到 HTTP 下要靠：

- SSE 查询参数
- 或服务端维护 `clientId -> subscription`

这部分要单独设计，不然“功能等价”会打折。

### 13.3 `hostapi.fetch` 和 `gateway.http` 要谨慎

虽然现有 Bridge 已支持：

- `hostapi.fetch`
- `gateway.http`

但它们本质上是透传型能力。

如果直接在 HTTP Bridge 中完整暴露，要注意：

- 鉴权
- 路径白名单
- 参数校验
- 审计日志

第一阶段可以先保持与现有 Bridge 一致，但文档里应明确其用途和风险。

## 14. 分阶段实施建议

### 第一期：可用版

目标：

- 保留 WS
- 增加 HTTP 命令入口
- 增加 SSE 事件入口
- 完整支持 `protocol.ts` 里的现有动作
- 文档明确双栈接入方式

交付结果：

- 新客户端已经可以不接 WS
- 老客户端零影响

### 第二期：稳定版

目标：

- 抽共享 dispatcher
- 抽共享 event adapter
- 增加订阅过滤
- 增加事件 ID
- 增加审计和限流

### 第三期：增强版

目标：

- 逐步补更细的 REST 接口
- 弱化 `command` 总线的长期地位
- 对高风险动作做权限拆分

## 15. 最终建议

最终建议是：

- `WS Bridge` 保留
- 新增一个 `HTTP Bridge`
- 第一阶段不要执着 REST 化
- 第一阶段直接镜像现有 Bridge 协议能力
- 用 `POST /api/bridge-http/command + GET /api/bridge-http/events` 先把全功能跑通
- 后续再在不影响兼容性的前提下慢慢 REST 化

这样做最符合你现在的诉求：

- 不是推翻
- 是增量增加
- 而且能尽快做到“和 Bridge 一样，保留所有功能”

## 16. 一句话版本

这次最合理的方案不是“拿 HTTP 重写 Bridge”，而是“在现有 WS Bridge 旁边，加一个共享内核的 HTTP Bridge 镜像层”。  
先求功能完整一致，再求接口风格优化。
