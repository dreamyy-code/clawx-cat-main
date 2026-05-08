# ClawX-Cat WebSocket Bridge 接口文档

## 1. 文档目的

本文档专门说明 `ClawX-Cat` 当前的 `WebSocket Bridge` 协议与消息，包括：

- WebSocket 连接方式
- 首帧鉴权
- 命令消息格式
- 服务端返回消息
- 流式事件消息
- 常见联调流程

如果你需要的是 `HTTP + SSE` 方式，请查看同目录下的 `ClawX-Cat-HTTP-Bridge-接口文档.md`。

## 2. 适用场景

`WebSocket Bridge` 更适合以下情况：

- 已有脚本或客户端本来就基于 WS 长连接
- 需要单通道完成命令 + 事件收发
- 需要更稳定地维护会话订阅状态
- 需要较强实时性的桥接通信

## 3. 连接信息

外部客户端接入 WebSocket Bridge 时，核心信息包括：

- `host`
- `port`
- `bridgeToken`

这些信息可以通过以下方式获得：

- 软件设置页中的“远程桥接”
- `GET /api/bridge/status`
- `GET /api/bridge/config`
- `GET /api/bridge/token`
- 已认证连接后调用 `bridge.info`

典型地址形如：

```text
ws://<host>:<bridgePort>
```

## 4. 建连与鉴权

### 4.1 建立连接

客户端先建立 WebSocket 连接：

```text
ws://127.0.0.1:18989
```

### 4.2 首帧鉴权

连接建立后，第一步需要发送 `auth`：

```json
{
  "type": "auth",
  "requestId": "req-auth-1",
  "token": "your-bridge-token"
}
```

### 4.3 鉴权成功返回

鉴权通过后，服务端通常会依次返回：

```json
{
  "type": "auth.ok",
  "requestId": "req-auth-1",
  "mode": "gui"
}
```

以及一条初始状态：

```json
{
  "type": "gateway.status",
  "status": {}
}
```

### 4.4 未鉴权直接调用的后果

如果客户端在 `auth` 之前直接发送其他命令，服务端会返回：

```json
{
  "type": "error",
  "code": "AUTH_REQUIRED",
  "message": "Send auth first"
}
```

如果 `token` 无效，服务端会返回 `UNAUTHORIZED` 并主动关闭连接。

## 5. 客户端命令消息

`WebSocket Bridge` 的客户端消息统一是 JSON，核心字段如下：

- `type`
- `requestId`
- `params`

最基础的例子：

```json
{
  "type": "gateway.status.get",
  "requestId": "req-1"
}
```

## 6. 已支持的客户端命令

如果你想直接查看“全部 `type` 列表、各自 `params` 字段、典型返回类型”，建议同时阅读：

- [ClawX-Cat Bridge 命令类型清单](ClawX-Cat-Bridge-命令类型清单.md)

### 6.1 鉴权与运行时

- `auth`
- `bridge.info`
- `bridge.status.get`
- `ping`
- `runtime.capabilities.get`

### 6.2 Agent 管理

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

### 6.3 模型配置

- `models.config.get`
- `models.primary.set`
- `models.fallback.add`
- `models.fallback.remove`
- `models.providerModel.add`
- `models.providerModel.remove`

### 6.4 文件能力

- `file.stageBuffer`
- `file.stagePaths`
- `file.read`

### 6.5 Gateway 操作

- `gateway.http`
- `gateway.controlUi.get`
- `gateway.rpc`
- `gateway.start`
- `gateway.stop`
- `gateway.restart`
- `gateway.reload`
- `gateway.health.get`
- `gateway.status.get`

### 6.6 聊天能力

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`

### 6.7 会话能力

- `session.transcript.get`
- `session.listLocal`
- `session.subscribe`
- `session.delete`

### 6.8 日志能力

- `logs.get`
- `logs.files.get`
- `logs.dir.get`

### 6.9 软件层透传

- `hostapi.fetch`

## 7. 服务端返回消息

`WebSocket Bridge` 的服务端消息主要分为“命令响应”和“事件推送”两大类。

### 7.1 认证与基础状态

- `auth.ok`
- `bridge.info`
- `bridge.status`
- `pong`
- `runtime.capabilities`

### 7.2 Agent 相关返回

- `agents.list`
- `agents.created`
- `agents.import.inspected`
- `agent.package.imported`
- `agents.communication.updated`
- `agent.communication.updated`
- `agent.updated`
- `agent.deleted`
- `agent.model.updated`
- `agent.instructions.synced`
- `agents.instructions.synced`

### 7.3 模型相关返回

- `models.config`
- `models.primary.updated`
- `models.fallback.updated`
- `models.providerModel.updated`

### 7.4 Gateway 相关返回

- `gateway.status`
- `gateway.http.result`
- `gateway.controlUi`
- `gateway.health`
- `gateway.started`
- `gateway.stopped`
- `gateway.restarted`
- `gateway.reloaded`
- `gateway.rpc.result`

### 7.5 文件相关返回

- `file.staged`
- `files.staged`
- `file.read.result`

### 7.6 聊天相关返回 / 事件

- `chat.accepted`
- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

### 7.7 会话相关返回

- `session.list`
- `session.transcript`
- `session.subscribed`
- `session.deleted`

### 7.8 日志相关返回

- `logs.content`
- `logs.files`
- `logs.dir`

### 7.9 错误返回

- `error`

## 8. 流式事件与订阅模型

和 HTTP Bridge 把流式事件拆到 SSE 不同，`WebSocket Bridge` 的命令响应与流式事件都走同一条连接。

### 8.1 聊天流式事件

聊天过程中，客户端会持续收到：

- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

### 8.2 网关推送事件

客户端还可能收到：

- `gateway.notification`
- `gateway.chat-message`
- 初始 `gateway.status`

### 8.3 会话订阅

如果要显式订阅指定会话，可以发送：

```json
{
  "type": "session.subscribe",
  "requestId": "req-sub-1",
  "params": {
    "sessionKeys": ["agent:main:main"]
  }
}
```

或订阅全部：

```json
{
  "type": "session.subscribe",
  "requestId": "req-sub-all",
  "params": {
    "all": true
  }
}
```

服务端会返回：

```json
{
  "type": "session.subscribed",
  "requestId": "req-sub-1",
  "sessionKeys": ["agent:main:main"],
  "all": false
}
```

## 9. 常见请求示例

### 9.1 查询桥接信息

```json
{
  "type": "bridge.info",
  "requestId": "req-info"
}
```

### 9.2 查询桥接状态

```json
{
  "type": "bridge.status.get",
  "requestId": "req-status"
}
```

### 9.3 查询能力清单

```json
{
  "type": "runtime.capabilities.get",
  "requestId": "req-cap"
}
```

### 9.4 发送聊天

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

### 9.5 带附件聊天

先上传或暂存文件：

```json
{
  "type": "file.stagePaths",
  "requestId": "req-file",
  "params": {
    "filePaths": ["C:/temp/demo.png"]
  }
}
```

然后发送：

```json
{
  "type": "chat.sendWithMedia",
  "requestId": "req-chat-media",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "请分析这个文件",
    "media": [
      {
        "filePath": "C:/temp/demo.png",
        "fileName": "demo.png",
        "mimeType": "image/png"
      }
    ]
  }
}
```

### 9.6 获取本地会话

先列出：

```json
{
  "type": "session.listLocal",
  "requestId": "req-sessions"
}
```

再读取 transcript：

```json
{
  "type": "session.transcript.get",
  "requestId": "req-transcript",
  "params": {
    "agentId": "main",
    "sessionId": "your-session-id"
  }
}
```

## 10. 推荐联调顺序

建议客户端按下面顺序联调：

1. 连接 WebSocket
2. 发送 `auth`
3. 发送 `bridge.info`
4. 发送 `runtime.capabilities.get`
5. 发送 `gateway.status.get`
6. 测试 `chat.send`
7. 如需更细粒度控制，再补 `session.subscribe`、Agent 管理、模型配置等命令

## 11. 与 HTTP Bridge 的区别

### 11.1 WebSocket Bridge

- 一条长连接完成命令与事件
- 首帧 `auth` 鉴权
- 更适合状态型订阅和实时双向控制

### 11.2 HTTP Bridge

- 命令与事件拆分为 `HTTP + SSE`
- 使用 Bearer Token
- 更适合 APP、代理、弱网和传统 HTTP 集成

## 12. 相关文档

- [ClawX-Cat Bridge 命令类型清单](ClawX-Cat-Bridge-命令类型清单.md)
- [ClawX-Cat HTTP Bridge 接口文档](ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX Bridge 接入说明](ClawX-Bridge-接入说明.md)
- [ClawX Bridge HTTP 接口清单](ClawX-Bridge-HTTP-接口清单.md)
