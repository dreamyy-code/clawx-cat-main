# ClawX-Cat Bridge 命令类型清单

## 1. 文档说明

本文档专门列出 `ClawX-Cat` 当前桥接协议中所有主要的 `type` 请求体类型，以及它们的：

- 请求消息格式
- `params` 字段
- 典型返回类型
- 使用说明

这份清单主要覆盖：

- `HTTP Bridge`
- `WebSocket Bridge`

其中：

- 大多数业务命令在 `HTTP Bridge` 和 `WebSocket Bridge` 中共用同一套 `type`
- `auth` 只适用于 `WebSocket Bridge`
- `session.subscribe` 在 `HTTP Bridge` 中虽然可用，但依赖有状态客户端上下文和 SSE 订阅

## 2. 通用请求格式

绝大多数桥接命令都遵循下面的请求结构：

```json
{
  "type": "gateway.status.get",
  "requestId": "req-1",
  "params": {}
}
```

字段说明：

- `type`：命令类型，必填
- `requestId`：请求 ID，建议传，便于客户端对齐响应
- `params`：命令参数，不同 `type` 的参数结构不同

## 3. 通用返回格式

成功时，服务端通常返回一个与命令对应的响应类型：

```json
{
  "type": "gateway.status",
  "requestId": "req-1",
  "status": {}
}
```

失败时通常返回：

```json
{
  "type": "error",
  "requestId": "req-1",
  "code": "SOME_ERROR",
  "message": "error message"
}
```

## 4. 命令清单总览

### 4.1 运行时与桥接

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `auth` | `token` | `auth.ok` | 仅 `WebSocket Bridge` 使用 |
| `bridge.info` | 无 | `bridge.info` | 获取桥接信息 |
| `bridge.status.get` | 无 | `bridge.status` | 获取桥接状态 |
| `ping` | 无 | `pong` | 连通性检查 |
| `runtime.capabilities.get` | 无 | `runtime.capabilities` | 获取支持能力列表 |

### 4.2 Agent 管理

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `agents.list` | 无 | `agents.list` | 获取 Agent 快照 |
| `agents.create` | `name`, `inheritWorkspace` | `agents.created` | 新建 Agent |
| `agents.import.inspect` | `zipPath` | `agents.import.inspected` | 检查待导入 Agent 包 |
| `agent.import.package` | `agentId`, `zipPath`, `sourceAgentDirName`, `sourceWorkspaceDirName` | `agent.package.imported` | 导入 Agent 包 |
| `agents.communication.update` | `enabled`, `allowedAgents` | `agents.communication.updated` | 更新全局多 Agent 通讯配置 |
| `agent.communication.update` | `agentId`, `spawnTargets` | `agent.communication.updated` | 更新单个 Agent 的通讯配置 |
| `agent.update` | `agentId`, `name` | `agent.updated` | 修改 Agent 基本信息 |
| `agent.delete` | `agentId` | `agent.deleted` | 删除 Agent |
| `agent.model.update` | `agentId`, `modelRef` | `agent.model.updated` | 修改 Agent 模型绑定 |
| `agent.instructions.sync` | `agentId` | `agent.instructions.synced` | 同步单个 Agent 指令 |
| `agents.instructions.syncAll` | 无 | `agents.instructions.synced` | 同步全部 Agent 指令 |

### 4.3 模型配置

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `models.config.get` | 无 | `models.config` | 获取当前模型配置摘要 |
| `models.primary.set` | `modelRef` | `models.primary.updated` | 设置主模型 |
| `models.fallback.add` | `modelRef` | `models.fallback.updated` | 添加 fallback 模型 |
| `models.fallback.remove` | `modelRef` | `models.fallback.updated` | 移除 fallback 模型 |
| `models.providerModel.add` | `providerKey`, `modelId` | `models.providerModel.updated` | 向 provider 增加模型 |
| `models.providerModel.remove` | `providerKey`, `modelId` | `models.providerModel.updated` | 从 provider 移除模型 |

### 4.4 文件能力

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `file.stageBuffer` | `base64`, `fileName`, `mimeType` | `file.staged` | 通过 base64 暂存文件 |
| `file.stagePaths` | `filePaths` | `files.staged` | 批量暂存本地文件路径 |
| `file.read` | `filePath`, `mode`, `maxBytes` | `file.read.result` | 读取文件内容 |

### 4.5 Gateway 控制

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `gateway.http` | `path`, `method`, `headers`, `body`, `timeoutMs` | `gateway.http.result` | 透传 Gateway HTTP |
| `gateway.controlUi.get` | 无 | `gateway.controlUi` | 获取控制页信息 |
| `gateway.rpc` | `method`, `params`, `timeoutMs` | `gateway.rpc.result` | 调用 Gateway RPC |
| `gateway.start` | 无 | `gateway.started` | 启动 Gateway |
| `gateway.stop` | 无 | `gateway.stopped` | 停止 Gateway |
| `gateway.restart` | 无 | `gateway.restarted` | 重启 Gateway |
| `gateway.reload` | 无 | `gateway.reloaded` | 重新加载 Gateway |
| `gateway.health.get` | 无 | `gateway.health` | 获取 Gateway 健康状态 |
| `gateway.status.get` | 无 | `gateway.status` | 获取 Gateway 运行状态 |

### 4.6 Host API 透传

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `hostapi.fetch` | `path`, `method`, `headers`, `body` | `hostapi.result` | 透传 Host API 请求 |

### 4.7 聊天能力

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `chat.send` | `sessionKey`, `message`, `deliver`, `idempotencyKey` | `chat.accepted` | 发送纯文本聊天 |
| `chat.sendWithMedia` | `sessionKey`, `message`, `deliver`, `idempotencyKey`, `media[]` | `chat.accepted` | 发送带附件聊天 |
| `chat.abort` | `sessionKey` | `chat.aborted` 或业务状态事件 | 中止会话生成 |

### 4.8 会话能力

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `session.transcript.get` | `agentId`, `sessionId` | `session.transcript` | 获取 transcript |
| `session.listLocal` | 无 | `session.list` | 获取本地会话清单 |
| `session.subscribe` | `sessionKeys`, `all` | `session.subscribed` | 订阅指定会话或全部会话 |
| `session.delete` | `sessionKey` | `session.deleted` | 删除本地会话 |

### 4.9 日志能力

| `type` | `params` | 典型返回 `type` | 说明 |
|------|------|------|------|
| `logs.get` | `tailLines` | `logs.content` | 读取日志内容 |
| `logs.files.get` | 无 | `logs.files` | 获取日志文件列表 |
| `logs.dir.get` | 无 | `logs.dir` | 获取日志目录 |

## 5. 逐类请求示例

### 5.1 `auth`

仅适用于 WebSocket：

```json
{
  "type": "auth",
  "requestId": "req-auth-1",
  "token": "your-bridge-token"
}
```

### 5.2 `agents.create`

```json
{
  "type": "agents.create",
  "requestId": "req-create-agent",
  "params": {
    "name": "shrimp-helper",
    "inheritWorkspace": true
  }
}
```

### 5.3 `agent.communication.update`

```json
{
  "type": "agent.communication.update",
  "requestId": "req-agent-comm",
  "params": {
    "agentId": "main",
    "spawnTargets": ["assistant", "planner"]
  }
}
```

### 5.4 `models.primary.set`

```json
{
  "type": "models.primary.set",
  "requestId": "req-model-primary",
  "params": {
    "modelRef": "openai/gpt-4.1"
  }
}
```

### 5.5 `file.stageBuffer`

```json
{
  "type": "file.stageBuffer",
  "requestId": "req-file-buffer",
  "params": {
    "base64": "<base64-content>",
    "fileName": "demo.txt",
    "mimeType": "text/plain"
  }
}
```

### 5.6 `gateway.rpc`

```json
{
  "type": "gateway.rpc",
  "requestId": "req-gateway-rpc",
  "params": {
    "method": "status/get",
    "params": {},
    "timeoutMs": 10000
  }
}
```

### 5.7 `chat.send`

```json
{
  "type": "chat.send",
  "requestId": "req-chat",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "你好",
    "deliver": true
  }
}
```

### 5.8 `chat.sendWithMedia`

```json
{
  "type": "chat.sendWithMedia",
  "requestId": "req-chat-media",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "请分析这个附件",
    "media": [
      {
        "filePath": "C:/temp/demo.png",
        "mimeType": "image/png",
        "fileName": "demo.png"
      }
    ]
  }
}
```

### 5.9 `session.subscribe`

```json
{
  "type": "session.subscribe",
  "requestId": "req-subscribe",
  "params": {
    "sessionKeys": ["agent:main:main"]
  }
}
```

或：

```json
{
  "type": "session.subscribe",
  "requestId": "req-subscribe-all",
  "params": {
    "all": true
  }
}
```

## 6. 事件型返回补充说明

有些命令除了同步响应之外，还会触发后续事件。

### 6.1 聊天事件

当调用 `chat.send` 或 `chat.sendWithMedia` 后，客户端通常还会继续收到：

- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

### 6.2 网关事件

桥接连接过程中，也可能持续收到：

- `gateway.status`
- `gateway.notification`
- `gateway.chat-message`

## 7. 使用建议

- `requestId` 建议所有请求都传
- APP / 移动端优先使用 `HTTP Bridge`
- 强状态、强实时、强订阅控制的客户端优先使用 `WebSocket Bridge`
- 若要处理聊天类命令，不要只看同步响应，还要消费后续流式事件

## 8. 相关文档

- [ClawX-Cat HTTP Bridge 接口文档](ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat WebSocket Bridge 接口文档](ClawX-Cat-WebSocket-Bridge-接口文档.md)
