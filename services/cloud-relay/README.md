# Cloud Relay Service

这是当前仓库中用于承载“用户 -> 云端 -> 设备 -> ClawX”链路的正式服务骨架第一版。

## 1. 当前能力

- HTTP 管理接口
- WebSocket Relay 转发
- 设备 token 校验
- 用户 token 校验
- 用户与设备绑定关系
- 本地 JSON 持久化

## 2. 目录说明

- [server.mjs](./server.mjs)
  - 服务主入口
- [store.mjs](./store.mjs)
  - JSON 持久化封装
- [store.example.json](./store.example.json)
  - 示例数据

## 3. 启动

先准备环境变量：

```powershell
$env:CLAWX_RELAY_HOST="127.0.0.1"
$env:CLAWX_RELAY_PORT="19089"
$env:CLAWX_RELAY_ADMIN_TOKEN="relay-admin-token"
$env:CLAWX_RELAY_STORE_PATH="services/cloud-relay/data/store.json"
```

启动服务：

```powershell
node services/cloud-relay/server.mjs
```

或者：

```powershell
pnpm run relay:service
```

## 4. 初始化数据

最简单的方式是先复制示例文件：

```powershell
Copy-Item services/cloud-relay/store.example.json services/cloud-relay/data/store.json
```

然后修改其中的：

- `users[].token`
- `deviceTokens[].token`
- `bindings`

也可以直接通过 HTTP 管理接口创建。

## 5. HTTP 管理接口

所有管理接口都建议带：

```text
Authorization: Bearer <CLAWX_RELAY_ADMIN_TOKEN>
```

### 5.1 健康检查

- `GET /health`

### 5.2 查看设备

- `GET /api/admin/devices`

### 5.3 查看用户

- `GET /api/admin/users`

### 5.4 查看绑定

- `GET /api/admin/bindings`

### 5.5 创建或更新用户

- `POST /api/admin/users`

请求体示例：

```json
{
  "userId": "demo-user",
  "name": "Demo User",
  "token": "relay-user-demo-token"
}
```

### 5.6 创建设备 token

- `POST /api/admin/device-tokens`

请求体示例：

```json
{
  "deviceId": "demo-device",
  "deviceName": "Demo Device",
  "token": "relay-device-demo-token"
}
```

### 5.7 绑定用户与设备

- `POST /api/admin/bindings`

请求体示例：

```json
{
  "userId": "demo-user",
  "deviceId": "demo-device"
}
```

## 6. WebSocket 入口

- `ws://127.0.0.1:19089/ws`

### 6.1 设备侧消息

- `device.register`
- `device.heartbeat`
- `relay.result`
- `relay.event`

### 6.2 用户侧消息

- `user.auth`
- `user.devices.get`
- `user.device.bind`
- `user.call`

## 7. 最小联调顺序

1. 启动 Cloud Relay Service
2. 初始化一个用户 token 和设备 token
3. 在 ClawX 设置页里填写设备侧 Relay 地址与设备 token
4. 启动 ClawX，让设备上线
5. 使用 [sample_relay_user_client.py](../../scripts/bridge-tests/sample_relay_user_client.py) 作为用户侧客户端发起调用

## 7.1 Python 测试脚本

仓库里还提供了 3 个专门用于验证服务端的 Python 脚本：

- [test_relay_health.py](../../scripts/bridge-tests/test_relay_health.py)
  - 检查 `/health` 和管理接口是否正常响应
- [test_relay_admin_api.py](../../scripts/bridge-tests/test_relay_admin_api.py)
  - 创建用户、设备 token、绑定关系，并再次读取校验
- [test_relay_roundtrip.py](../../scripts/bridge-tests/test_relay_roundtrip.py)
  - 用 Python 同时模拟设备端和用户端，验证 `user.call -> relay.call -> relay.result/event` 的完整回路

示例：

```powershell
$env:CLAWX_RELAY_HTTP_BASE="http://127.0.0.1:19089"
$env:CLAWX_RELAY_URL="ws://127.0.0.1:19089/ws"
$env:CLAWX_RELAY_ADMIN_TOKEN="relay-admin-token"
python scripts/bridge-tests/test_relay_health.py
python scripts/bridge-tests/test_relay_admin_api.py
python scripts/bridge-tests/test_relay_roundtrip.py
```

## 8. 当前定位

这还是“正式骨架第一版”，目标是：

- 先把产品主链路稳定跑通
- 给 APP 和后端提供明确协议边界

暂时还没有补：

- 数据库
- 刷新 token
- 多会话权限模型
- 离线消息队列
- 审计持久化
- 管理后台 UI

