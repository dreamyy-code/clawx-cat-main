# ClawX Bridge 接入说明

## 1. 目标

本文档说明当前 ClawX 中已实现的远程桥接能力，以及外部客户端如何通过 WebSocket 或 HTTP 与软件建立连接。

桥接的定位是：

- 让外部 APP、脚本、网页客户端远程控制当前 ClawX
- 复用现有 OpenClaw Gateway、Host API、会话、文件和日志链路
- 同时兼容 GUI 模式与 Headless 模式

## 2. 启动方式

### 2.1 GUI 模式

- 正常启动 ClawX
- 进入设置页面中的“远程桥接”
- 启用桥接并查看端口、token、连接状态

### 2.2 Headless 模式

- 使用 `--clawx-headless` 或 `CLAWX_HEADLESS=1`
- Headless 模式默认会优先按桥接配置启动远程服务

## 3. 连接信息

桥接连接的核心信息：

- `host`
- `port`
- `token`

可通过以下方式获取：

- 软件设置页“远程桥接”卡片
- Host API:
  - `GET /api/bridge/status`
  - `GET /api/bridge/config`
  - `GET /api/bridge/token`
- Host API HTTP Bridge:
  - `GET /api/bridge/http/token`
- WebSocket:
  - `bridge.info`

## 4. 鉴权流程

### 4.1 WebSocket Bridge

客户端连接 WebSocket 后，需要先发送：

```json
{
  "type": "auth",
  "requestId": "req-1",
  "token": "your-bridge-token"
}
```

认证成功后会收到：

```json
{
  "type": "auth.ok",
  "requestId": "req-1",
  "mode": "gui"
}
```

### 4.2 HTTP Bridge

HTTP Bridge 使用 Bearer Token 鉴权，不走首帧 `auth`。

命令入口：

- `POST /api/bridge-http/command`

事件入口：

- `GET /api/bridge-http/events`

鉴权方式：

- Header:
  - `Authorization: Bearer <http-bridge-token>`
- SSE 兼容：
  - `?token=<http-bridge-token>`

如果需要保留订阅上下文，可使用：

- Header:
  - `X-ClawX-Bridge-Client-Id: <client-id>`
- 或 query:
  - `?clientId=<client-id>`

## 5. 传输方式

当前支持两种桥接接入方式：

### 5.1 WebSocket Bridge

- WebSocket 地址形如 `ws://host:port`
- 适合已有脚本和现有客户端兼容
- 事件与命令都走同一条连接

### 5.2 HTTP Bridge

- 命令走 `POST /api/bridge-http/command`
- 事件走 `GET /api/bridge-http/events`
- 聊天和网关事件通过 SSE 持续推送
- 更适合移动端、弱网环境和代理场景

## 6. 常用能力

当前桥接已支持以下主要动作：

- 运行时与桥接
  - `bridge.info`
  - `bridge.status.get`
  - `runtime.capabilities.get`
- Agent 管理
  - `agents.list`
  - `agents.create`
  - `agents.import.inspect`
  - `agent.import.package`
  - `agents.communication.update`
  - `agent.communication.update`
  - `agent.model.update`
  - `agent.instructions.sync`
  - `agents.instructions.syncAll`
- 模型配置
  - `models.config.get`
  - `models.primary.set`
  - `models.fallback.add`
  - `models.fallback.remove`
  - `models.providerModel.add`
  - `models.providerModel.remove`
- Gateway
  - `gateway.status.get`
  - `gateway.health.get`
  - `gateway.start`
  - `gateway.stop`
  - `gateway.restart`
  - `gateway.reload`
  - `gateway.rpc`
  - `gateway.http`
  - `gateway.controlUi.get`
- 软件层
  - `hostapi.fetch`
- 聊天
  - `chat.send`
  - `chat.sendWithMedia`
  - `chat.abort`
- 文件
  - `file.stageBuffer`
  - `file.stagePaths`
  - `file.read`
- 会话
  - `session.listLocal`
  - `session.subscribe`
  - `session.transcript.get`
  - `session.delete`
- 日志
  - `logs.get`
  - `logs.files.get`
  - `logs.dir.get`

## 7. 典型流程

### 7.1 纯文本聊天（WebSocket）

1. WebSocket 建立连接
2. 发送 `auth`
3. 发送 `chat.send`
4. 持续接收：
   - `chat.delta`
   - `chat.completed`
   - `chat.failed`
   - `chat.aborted`

### 7.2 纯文本聊天（HTTP + SSE）

1. 记录 `httpBridgeToken`
2. `POST /api/bridge-http/command`
3. body:

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

4. `GET /api/bridge-http/events?token=...&clientId=...`
5. 持续接收：
   - `chat.delta`
   - `chat.completed`
   - `chat.failed`
   - `chat.aborted`

### 7.3 带附件聊天

1. 发送 `file.stageBuffer` 或 `file.stagePaths`
2. 拿到 `stagedPath`
3. 发送 `chat.sendWithMedia`
4. 持续接收流式事件

### 7.4 获取本地会话

1. 发送 `session.listLocal`
2. 用返回的 `agentId` + `sessionId`
3. 再调用 `session.transcript.get`

### 7.5 远程管理 Agent 与模型

1. 发送 `agents.list` 获取当前 Agent 快照
2. 发送 `agents.create` 或 `agents.import.inspect`
3. 如需导入成品包，再调用 `agent.import.package`
4. 通过 `agents.communication.update` / `agent.communication.update` 修改多 Agent 通讯
5. 通过 `agent.model.update` 或 `models.primary.set` 等动作更新模型配置

## 8. Host API 管理桥接

当前可通过 Host API 管理桥接自身：

- `GET /api/bridge/status`
- `GET /api/bridge/config`
- `GET /api/bridge/discovery/status`
- `GET /api/bridge/relay/status`
- `PUT /api/bridge/config`
- `POST /api/bridge/start`
- `POST /api/bridge/stop`
- `POST /api/bridge/restart`
- `GET /api/bridge/token`
- `POST /api/bridge/token/regenerate`
- `GET /api/bridge/http/token`
- `POST /api/bridge/http/token/regenerate`
- `GET /api/bridge/audit`
- `DELETE /api/bridge/audit`

`GET /api/bridge/config` 当前也会返回 HTTP Bridge 相关字段：

- `httpEnabled`
- `httpPort`
- `httpToken`

`GET /api/bridge/status` 当前会返回 HTTP Bridge 运行状态：

- `http.enabled`
- `http.running`
- `http.host`
- `http.port`
- `http.clientCount`
- `http.recentClients`

## 9. HTTP Bridge 命令模型

HTTP Bridge 第一阶段为了和现有 Bridge 功能保持一致，命令体直接沿用原有桥接协议：

```json
{
  "type": "gateway.status.get",
  "requestId": "req-2",
  "params": {}
}
```

返回体也尽量保持与 WS 单次返回一致，例如：

```json
{
  "type": "gateway.status",
  "requestId": "req-2",
  "status": {}
}
```

已支持的命令范围与当前 `WS Bridge` 保持对齐：

- `bridge.*`
- `runtime.capabilities.get`
- `agents.*`
- `agent.*`
- `models.*`
- `gateway.*`
- `hostapi.fetch`
- `file.*`
- `chat.*`
- `session.*`
- `logs.*`

## 10. Python 示例

仓库中已提供最小联调脚本：

- [sample_bridge_client.py](../scripts/bridge-tests/sample_bridge_client.py)
- [sample_lan_discovery.py](../scripts/bridge-tests/sample_lan_discovery.py)
- [sample_relay_server.py](../scripts/bridge-tests/sample_relay_server.py)
- [sample_relay_user_client.py](../scripts/bridge-tests/sample_relay_user_client.py)
- [mock_cloud_relay.mjs](../scripts/relay-server/mock_cloud_relay.mjs)

运行前准备：

```bash
pip install websockets
```

### 10.1 局域网发现测试

在设备和手机或测试机处于同一局域网时，可先运行：

```bash
python scripts/bridge-tests/sample_lan_discovery.py
```

脚本会发送 `clawx.discovery.probe` 广播，并打印设备返回的：

- 设备展示名称
- 可连接的局域网 IP 地址
- 桥接端口
- 当前运行模式

### 10.2 本地 Bridge 直连测试

设置环境变量：

```bash
set CLAWX_BRIDGE_URL=ws://127.0.0.1:18989
set CLAWX_BRIDGE_TOKEN=your-token
set CLAWX_SESSION_KEY=agent:main:main
```

然后执行：

```bash
python scripts/bridge-tests/sample_bridge_client.py
```

### 10.3 HTTP Bridge 最小示例

```bash
curl -X POST "http://127.0.0.1:18991/api/bridge-http/command" ^
  -H "Authorization: Bearer your-http-token" ^
  -H "Content-Type: application/json" ^
  -d "{\"type\":\"gateway.status.get\",\"requestId\":\"req-1\"}"
```

SSE 示例：

```bash
curl "http://127.0.0.1:18991/api/bridge-http/events?token=your-http-token&clientId=test-client"
```

### 10.4 云端 Relay 联调

如果要验证“用户客户端通过云端操控设备”的完整路径，建议先启动最小 Relay：

```bash
node scripts/relay-server/mock_cloud_relay.mjs
```

可选环境变量：

```bash
set CLAWX_RELAY_HOST=127.0.0.1
set CLAWX_RELAY_PORT=19089
set CLAWX_RELAY_DEVICE_TOKEN=your-device-token
set CLAWX_RELAY_USER_TOKEN=your-user-token
```

设备端配置：

- `云端 Relay -> Relay 地址`
  - `ws://127.0.0.1:19089/ws`
- `云端 Relay -> Relay 令牌`
  - `your-device-token`

然后再运行用户侧客户端：

```bash
set CLAWX_RELAY_URL=ws://127.0.0.1:19089/ws
set CLAWX_RELAY_USER_TOKEN=your-user-token
set CLAWX_RELAY_MESSAGE=你好，这是用户侧通过 Relay 发来的消息
python scripts/bridge-tests/sample_relay_user_client.py
```

如果你只是想单独验证“设备端主动连云”而不跑用户客户端，仍可使用：

```bash
python scripts/bridge-tests/sample_relay_server.py
```

## 9. 当前建议

作为下一阶段接入策略，建议：

- APP / Python 客户端优先走 WebSocket 桥接
- GUI 内部继续使用现有 ClawX 主链路
- 桥接 token 不要硬编码进客户端发布包
- 正式产品化前继续补权限和审计策略
