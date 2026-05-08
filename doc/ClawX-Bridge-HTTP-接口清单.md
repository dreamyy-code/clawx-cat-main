# ClawX HTTP Bridge 接口清单

## 1. 概览

当前 ClawX 已同时支持两套远程桥接入口：

- `WS Bridge`
- `HTTP Bridge`

其中 `HTTP Bridge` 的目标是完整镜像现有 `WS Bridge` 的命令能力。

默认入口如下：

- 命令入口：`POST /api/bridge-http/command`
- 事件入口：`GET /api/bridge-http/events`
- 信息入口：`GET /api/bridge-http/info`
- 状态入口：`GET /api/bridge-http/status`

## 2. 鉴权

所有 `HTTP Bridge` 请求都需要 `bridgeHttpToken`。

### Header 鉴权

```http
Authorization: Bearer <bridgeHttpToken>
```

### SSE 兼容 query 鉴权

```http
GET /api/bridge-http/events?token=<bridgeHttpToken>
```

### 可选 clientId

如果希望将命令调用和 SSE 订阅绑定到同一个逻辑客户端，可传：

- Header：`X-ClawX-Bridge-Client-Id`
- 或 query：`clientId`

## 3. 管理接口

这些接口走现有 Host API，不是 `command` 总线，但用于管理 `HTTP Bridge` 本身。

### 3.1 状态与配置

- `GET /api/bridge/status`
- `GET /api/bridge/config`
- `PUT /api/bridge/config`

### 3.2 Token

- `GET /api/bridge/http/token`
- `POST /api/bridge/http/token/regenerate`

### 3.3 返回配置字段

`GET /api/bridge/config` 当前包含：

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

### 3.4 返回状态字段

`GET /api/bridge/status` 当前包含：

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

其中 `http` 下包含：

- `enabled`
- `running`
- `host`
- `port`
- `hasToken`
- `clientCount`
- `recentClients`

## 4. 命令接口

### 4.1 通用请求体

```json
{
  "type": "gateway.status.get",
  "requestId": "req-1",
  "params": {}
}
```

### 4.2 通用返回体

成功时返回与 `WS Bridge` 单次响应一致，例如：

```json
{
  "type": "gateway.status",
  "requestId": "req-1",
  "status": {}
}
```

失败时：

```json
{
  "type": "error",
  "requestId": "req-1",
  "code": "INVALID_METHOD",
  "message": "gateway.rpc requires method"
}
```

## 5. 支持的命令

以下命令已经接入 `HTTP Bridge`。

### 5.1 鉴权与运行时

- `bridge.info`
- `bridge.status.get`
- `ping`
- `runtime.capabilities.get`

### 5.2 Agent

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

### 5.3 模型

- `models.config.get`
- `models.primary.set`
- `models.fallback.add`
- `models.fallback.remove`
- `models.providerModel.add`
- `models.providerModel.remove`

### 5.4 文件

- `file.stageBuffer`
- `file.stagePaths`
- `file.read`

### 5.5 Gateway

- `gateway.http`
- `gateway.controlUi.get`
- `gateway.rpc`
- `gateway.start`
- `gateway.stop`
- `gateway.restart`
- `gateway.reload`
- `gateway.health.get`
- `gateway.status.get`

### 5.6 聊天

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`

### 5.7 会话

- `session.transcript.get`
- `session.listLocal`
- `session.subscribe`
- `session.delete`

### 5.8 日志

- `logs.get`
- `logs.files.get`
- `logs.dir.get`

### 5.9 软件层透传

- `hostapi.fetch`

## 6. SSE 事件清单

`GET /api/bridge-http/events` 当前会推送以下桥接事件。

### 6.1 聊天事件

- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

### 6.2 Gateway 事件

- `gateway.status`
- `gateway.notification`
- `gateway.chat-message`

### 6.3 初始事件

建立 SSE 后会立即发送：

- `gateway.status`

## 7. 常用请求示例

### 7.1 查询网关状态

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

### 7.2 发送聊天

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

### 7.3 订阅指定会话

如果使用命令式订阅：

```json
{
  "type": "session.subscribe",
  "requestId": "req-subscribe",
  "params": {
    "sessionKeys": ["agent:main:main"]
  }
}
```

如果使用 SSE query 过滤：

```http
GET /api/bridge-http/events?token=<token>&clientId=test-client&sessionKey=agent:main:main
```

## 8. Python 联调脚本

仓库已新增：

- `scripts/bridge-tests/sample_http_bridge_client.py`

它会演示：

- 查询 `bridge.info`
- 查询 `runtime.capabilities.get`
- 建立 SSE
- 调用 `chat.send`
- 持续接收聊天流式事件
