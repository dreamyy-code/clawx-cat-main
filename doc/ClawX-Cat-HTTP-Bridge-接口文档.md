# ClawX-Cat HTTP Bridge 接口文档

## 1. 文档目的

本文档专门说明 `ClawX-Cat` 当前的 `HTTP Bridge` 接口，包括：

- HTTP Bridge 的接入方式
- 鉴权规则
- 管理接口
- 命令接口
- SSE 事件接口
- 常见联调示例

如果你需要的是 `WebSocket Bridge`，请查看同目录下的 `ClawX-Cat-WebSocket-Bridge-接口文档.md`。

## 2. 适用场景

`HTTP Bridge` 主要面向以下场景：

- APP / UniApp 客户端接入
- 弱网或代理环境
- 更适合 `HTTP + SSE` 的远程控制链路
- 不方便长期维护 WebSocket 长连接的集成侧

它的设计目标，是尽量镜像现有 `WebSocket Bridge` 的命令能力，但把命令与事件拆成：

- 同步命令调用
- SSE 持续事件订阅

## 3. 默认入口

默认 HTTP Bridge 入口如下：

- 命令入口：`POST /api/bridge-http/command`
- 事件入口：`GET /api/bridge-http/events`
- 信息入口：`GET /api/bridge-http/info`
- 状态入口：`GET /api/bridge-http/status`

如果桥接允许远程访问，外部客户端通常会按下面形式接入：

```text
http://<host>:<httpBridgePort>/api/bridge-http/command
http://<host>:<httpBridgePort>/api/bridge-http/events
```

## 4. 鉴权规则

所有 `HTTP Bridge` 请求都需要 `bridgeHttpToken`。

### 4.1 Header 鉴权

推荐使用：

```http
Authorization: Bearer <bridgeHttpToken>
```

### 4.2 SSE query 鉴权

为了兼容部分 SSE 客户端，也支持：

```http
GET /api/bridge-http/events?token=<bridgeHttpToken>
```

### 4.3 绑定逻辑客户端

如果你希望“命令调用”和“SSE 订阅”属于同一个客户端上下文，可以传 `clientId`：

- Header：`X-ClawX-Bridge-Client-Id`
- Query：`clientId`

服务端会在响应头中回传：

```http
X-ClawX-Bridge-Client-Id: <clientId>
```

## 5. 管理接口

这一组接口不属于 `/api/bridge-http/command` 总线本身，而是 `Host API` 中用于管理桥接配置和状态的接口。

### 5.1 状态与配置

- `GET /api/bridge/status`
- `GET /api/bridge/config`
- `PUT /api/bridge/config`

### 5.2 启停控制

- `POST /api/bridge/start`
- `POST /api/bridge/stop`
- `POST /api/bridge/restart`

### 5.3 Token 管理

- `GET /api/bridge/token`
- `POST /api/bridge/token/regenerate`
- `GET /api/bridge/http/token`
- `POST /api/bridge/http/token/regenerate`

### 5.4 审计与运行状态

- `GET /api/bridge/discovery/status`
- `GET /api/bridge/relay/status`
- `GET /api/bridge/audit`
- `DELETE /api/bridge/audit`

### 5.5 `GET /api/bridge/config` 关键字段

当前配置返回中，和 HTTP Bridge 直接相关的字段包括：

- `enabled`
- `port`
- `token`
- `allowRemote`
- `httpEnabled`
- `httpPort`
- `httpToken`
- `discoveryEnabled`
- `discoveryPort`
- `discoveryName`
- `relayEnabled`
- `relayUrl`
- `relayToken`
- `effectiveHost`
- `effectivePort`
- `effectiveEnabled`

### 5.6 `GET /api/bridge/status` 关键字段

当前状态返回中，和 HTTP Bridge 直接相关的字段包括：

- `enabled`
- `running`
- `mode`
- `host`
- `port`
- `allowRemote`
- `hasToken`
- `clientCount`
- `recentClients`
- `discovery`
- `relay`
- `http`

其中 `http` 下通常还会包含：

- `enabled`
- `running`
- `host`
- `port`
- `hasToken`
- `clientCount`
- `recentClients`

## 6. 命令接口

如果你想直接查看“所有 `type` 是什么、请求体怎么写、每个 `params` 有哪些字段、典型返回是什么”，建议优先阅读：

- [ClawX-Cat Bridge 命令类型清单](ClawX-Cat-Bridge-命令类型清单.md)

### 6.1 请求方式

`HTTP Bridge` 命令统一使用：

```http
POST /api/bridge-http/command
Content-Type: application/json
Authorization: Bearer <bridgeHttpToken>
```

请求体必须是合法 JSON，且 `Content-Type` 必须为 `application/json`。

### 6.2 通用请求体

```json
{
  "type": "gateway.status.get",
  "requestId": "req-1",
  "params": {}
}
```

### 6.3 通用返回体

成功返回示例：

```json
{
  "type": "gateway.status",
  "requestId": "req-1",
  "status": {}
}
```

失败返回示例：

```json
{
  "type": "error",
  "requestId": "req-1",
  "code": "INVALID_METHOD",
  "message": "gateway.rpc requires method"
}
```

### 6.4 常见错误

- `UNAUTHORIZED`
- `UNSUPPORTED_MEDIA_TYPE`
- `INVALID_JSON`
- `UNSUPPORTED_ACTION`
- 各业务命令自己的校验错误

## 7. 已支持的命令类型

当前 `HTTP Bridge` 已接入的命令与桥接协议保持对齐，主要包括以下分类。

### 7.1 鉴权与运行时

- `bridge.info`
- `bridge.status.get`
- `ping`
- `runtime.capabilities.get`

### 7.2 Agent 管理

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

### 7.3 模型配置

- `models.config.get`
- `models.primary.set`
- `models.fallback.add`
- `models.fallback.remove`
- `models.providerModel.add`
- `models.providerModel.remove`

### 7.4 文件能力

- `file.stageBuffer`
- `file.stagePaths`
- `file.read`

### 7.5 Gateway 操作

- `gateway.http`
- `gateway.controlUi.get`
- `gateway.rpc`
- `gateway.start`
- `gateway.stop`
- `gateway.restart`
- `gateway.reload`
- `gateway.health.get`
- `gateway.status.get`

### 7.6 聊天能力

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`

### 7.7 会话能力

- `session.transcript.get`
- `session.listLocal`
- `session.subscribe`
- `session.delete`

说明：

- `session.subscribe` 在 HTTP Bridge 中依赖有状态传输上下文
- 如果没有建立 SSE 或没有保留客户端状态，这类订阅型能力就没有实际意义

### 7.8 日志能力

- `logs.get`
- `logs.files.get`
- `logs.dir.get`

### 7.9 软件层透传

- `hostapi.fetch`

## 8. SSE 事件接口

### 8.1 接口形式

```http
GET /api/bridge-http/events
Authorization: Bearer <bridgeHttpToken>
```

或：

```http
GET /api/bridge-http/events?token=<bridgeHttpToken>&clientId=test-client
```

### 8.2 连接行为

建立 SSE 后，服务端会：

- 返回 `text/event-stream`
- 每 10 秒发送一次 keepalive 注释帧
- 立即推送一次 `gateway.status`
- 之后持续转发聊天与网关相关事件

### 8.3 可选会话过滤

如果只希望订阅指定会话，可附带：

```http
GET /api/bridge-http/events?token=<token>&sessionKey=agent:main:main
```

也可传多个 `sessionKey`。

### 8.4 当前会推送的主要事件

#### 聊天事件

- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

#### Gateway 事件

- `gateway.status`
- `gateway.notification`
- `gateway.chat-message`

## 9. 常见请求示例

### 9.1 查询桥接信息

```http
GET /api/bridge-http/info
Authorization: Bearer <token>
```

### 9.2 查询网关状态

```http
POST /api/bridge-http/command
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "type": "gateway.status.get",
  "requestId": "req-status"
}
```

### 9.3 发送聊天

```json
{
  "type": "chat.send",
  "requestId": "req-chat",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "你好"
  }
}
```

### 9.4 带附件聊天

先调用：

- `file.stageBuffer`
- 或 `file.stagePaths`

再调用：

- `chat.sendWithMedia`

### 9.5 订阅指定会话

命令式订阅：

```json
{
  "type": "session.subscribe",
  "requestId": "req-subscribe",
  "params": {
    "sessionKeys": ["agent:main:main"]
  }
}
```

SSE query 过滤：

```http
GET /api/bridge-http/events?token=<token>&clientId=test-client&sessionKey=agent:main:main
```

## 10. 联调建议

- APP 侧优先把 `command` 与 `events` 作为一对接口处理
- 保存服务端返回的 `X-ClawX-Bridge-Client-Id`，后续命令沿用
- 聊天场景同时处理同步响应和 SSE 增量事件
- 如果需要更强实时性或完全双向状态控制，可改用 `WebSocket Bridge`

## 11. 相关文档

- [ClawX-Cat Bridge 命令类型清单](ClawX-Cat-Bridge-命令类型清单.md)
- [ClawX-Cat WebSocket Bridge 接口文档](ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX Bridge 接入说明](ClawX-Bridge-接入说明.md)
- [ClawX Bridge HTTP 接口清单](ClawX-Bridge-HTTP-接口清单.md)
