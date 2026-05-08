# ClawX 远程桥接操作手册

## 1. 手册目标

这份手册面向实际使用，重点说明以下内容：

- 如何在 ClawX 中开启远程桥接
- 如何拿到连接所需的信息
- 如何用现有 Python 脚本做联调
- 脚本分别能验证什么能力
- 联调失败时先检查哪些点

如果你只是想尽快开始测试，建议直接看：

- `第 2 节：最短操作路径`
- `第 4 节：Python 脚本怎么跑`
- `第 5 节：脚本能验证什么`

## 2. 最短操作路径

### 2.1 在 GUI 中打开桥接

1. 启动 ClawX。
2. 进入 `设置` 页面。
3. 找到 `网关` 区域中的 `远程桥接` 卡片。
4. 打开 `启用桥接`。
5. 根据需要决定是否打开 `允许远程访问`。
6. 记下或复制：
   - 桥接地址
   - 桥接端口
   - 桥接令牌

如果只是本机联调，建议：

- `允许远程访问` 先关闭
- 直接使用 `127.0.0.1`

### 2.2 最小连接参数

远程客户端至少需要这 3 个参数：

- `WebSocket URL`
  - 例如 `ws://127.0.0.1:18989`
- `Bridge Token`
- `Session Key`
  - 默认可先用 `agent:main:main`

## 3. 软件里能看到什么

当前设置页里的 `远程桥接` 卡片已经可以查看：

- 是否启用桥接
- 是否正在运行
- 当前监听地址与端口
- 当前 token
- 局域网发现状态
- 局域网可达地址
- 云端 Relay 状态
- 当前连接数
- 最近客户端
- 最近桥接审计记录

如果外部客户端已经连上，你应该能在这里看到：

- 客户端地址
- 是否已鉴权
- 最后活跃时间

## 4. Python 脚本怎么跑

当前仓库中已有脚本：

- [sample_bridge_client.py](../scripts/bridge-tests/sample_bridge_client.py)
- [sample_lan_discovery.py](../scripts/bridge-tests/sample_lan_discovery.py)
- [sample_relay_server.py](../scripts/bridge-tests/sample_relay_server.py)
- [sample_relay_user_client.py](../scripts/bridge-tests/sample_relay_user_client.py)
- [mock_cloud_relay.mjs](../scripts/relay-server/mock_cloud_relay.mjs)

### 4.1 安装依赖

```bash
pip install websockets
```

### 4.2 局域网发现测试

如果你想模拟“手机 APP 在同一 Wi-Fi 下找到设备”，直接运行：

```powershell
python scripts/bridge-tests/sample_lan_discovery.py
```

这个脚本会：

- 向局域网广播 `clawx.discovery.probe`
- 等待设备回包
- 打印设备名称、桥接端口和可连接 IP 列表

### 4.3 纯文本聊天测试

Windows PowerShell:

Windows PowerShell:

```powershell
$env:CLAWX_BRIDGE_URL="ws://127.0.0.1:18989"
$env:CLAWX_BRIDGE_TOKEN="你的桥接令牌"
$env:CLAWX_SESSION_KEY="agent:main:main"
$env:CLAWX_MESSAGE="Hello from bridge"
python scripts/bridge-tests/sample_bridge_client.py
```

### 4.4 带附件聊天测试

Windows PowerShell:

```powershell
$env:CLAWX_BRIDGE_URL="ws://127.0.0.1:18989"
$env:CLAWX_BRIDGE_TOKEN="你的桥接令牌"
$env:CLAWX_SESSION_KEY="agent:main:main"
$env:CLAWX_MESSAGE="请分析这张图片"
$env:CLAWX_MEDIA_FILE="C:\path\to\image.png"
$env:CLAWX_MEDIA_MIME="image/png"
python scripts/bridge-tests/sample_bridge_client.py
```

### 4.5 云端 Relay 测试

如果你想模拟“真实用户客户端通过云端访问设备”，建议先启动最小 Relay 服务端：

```powershell
$env:CLAWX_RELAY_HOST="127.0.0.1"
$env:CLAWX_RELAY_PORT="19089"
$env:CLAWX_RELAY_DEVICE_TOKEN="device-token"
$env:CLAWX_RELAY_USER_TOKEN="user-token"
node scripts/relay-server/mock_cloud_relay.mjs
```

然后在 ClawX 设置页中：

1. 打开 `云端 Relay`
2. 填入 `ws://127.0.0.1:19089/ws`
3. 填入 `device-token`
4. 开启 `启用云端 Relay`

设备接上后，再从“用户端”发测试消息：

```powershell
$env:CLAWX_RELAY_URL="ws://127.0.0.1:19089/ws"
$env:CLAWX_RELAY_USER_TOKEN="user-token"
$env:CLAWX_RELAY_MESSAGE="你好，这是用户端走 Relay 发来的测试消息"
python scripts/bridge-tests/sample_relay_user_client.py
```

如果你只是想先验证“设备主动连云”这一步，也可以单独运行：

```powershell
$env:CLAWX_RELAY_HOST="127.0.0.1"
$env:CLAWX_RELAY_PORT="19089"
$env:CLAWX_RELAY_TOKEN="device-token"
python scripts/bridge-tests/sample_relay_server.py
```

### 4.6 脚本执行后你会看到什么

脚本会依次打印：

- `AUTH`
  - 说明桥接鉴权是否成功
- `BRIDGE`
  - 说明桥接服务本身是否正常返回信息
- `CAPABILITIES`
  - 说明远程能力清单是否正常返回
- `FILES`
  - 仅在带附件模式下出现，说明文件是否已成功暂存到宿主机
- `EVENT`
  - 聊天过程中的流式事件
- `DISCOVERED`
  - 仅在局域网发现脚本下出现，表示找到了可连接设备
- `RECV`
  - 仅在 Relay 服务端脚本下出现，表示设备已连上 Relay 并开始收发消息

## 5. 这份脚本能测什么

当前这份 Python 脚本虽然小，但已经能覆盖一条最关键的主链路。

### 5.1 能验证的内容

#### A. 桥接服务是否真的启动

如果脚本能连上 WebSocket，说明：

- 桥接服务已经启动
- 端口可访问
- 网络路径可达

#### B. 桥接 token 是否正确

如果 `auth` 失败，说明：

- token 不对
- 或者你连接到的不是当前这台正在运行的实例

#### C. 桥接协议是否正常工作

脚本会调用：

- `bridge.info`
- `runtime.capabilities.get`

这可以验证：

- 协议消息收发是否正常
- 返回 JSON 是否正常
- 桥接服务内部没有在早期阶段直接报错

#### D. 聊天主链路是否打通

脚本会发送：

- `chat.send`
  或
- `chat.sendWithMedia`

这可以验证：

- 桥接服务可以把请求转发到运行时
- 运行时可以调用 Gateway
- Gateway 可以把消息送进 OpenClaw
- OpenClaw 的流式结果能回到桥接

#### E. 文件链路是否打通

如果你设置了 `CLAWX_MEDIA_FILE`，脚本会先调：

- `file.stagePaths`

再调：

- `chat.sendWithMedia`

这可以验证：

- 桥接文件接口是否正常
- 宿主机是否能访问目标文件
- 文件是否已成功暂存
- 带附件消息是否能真正发出去

#### F. 局域网发现链路是否打通

如果 `sample_lan_discovery.py` 能收到回包，说明：

- 设备已经开启 `允许远程访问`
- 局域网 UDP 广播可达
- APP 未来可以先用“发现设备”而不是手输 IP

#### G. 设备主动连云链路是否打通

如果 `sample_relay_server.py` 能看到 `device.register`、`device.heartbeat`、`relay.event`，说明：

- 设备侧 Relay Client 已成功启动
- 设备可以主动连到云端 WebSocket
- 云端可以把动作回送到本地 Bridge 执行

### 5.2 这份脚本暂时不能覆盖的内容

这份示例脚本目前没有直接覆盖：

- `hostapi.fetch`
- `gateway.http`
- `session.listLocal`
- `session.transcript.get`
- `logs.get`
- token 重置
- 桥接启停

如果后面需要，我可以继续给你补第二份脚本，专门做：

- 会话读取测试
- 日志读取测试
- Host API 远程调用测试

## 6. 推荐测试顺序

建议按下面顺序测试，不容易混乱：

1. 先在 GUI 设置页确认桥接已开启
2. 先看 `远程桥接` 卡片里是否已有运行状态
3. 跑 Python 文本聊天脚本
4. 回到 GUI 看是否出现新的客户端连接和审计记录
5. 再跑带附件测试
6. 最后再开始做 APP 端接入

## 7. 常见问题排查

### 7.1 脚本一开始就连不上

优先检查：

- 桥接是否已开启
- 端口是否正确
- `127.0.0.1` / 局域网 IP 是否填对
- Headless / GUI 当前运行的是不是目标实例

### 7.2 `AUTH_REQUIRED` 或 `UNAUTHORIZED`

优先检查：

- `CLAWX_BRIDGE_TOKEN` 是否正确
- 是否刚刚在设置页里重置过 token
- 当前脚本是不是还在用旧 token

### 7.3 能连上，但消息发不出去

优先检查：

- Gateway 是否正在运行
- OpenClaw 是否已正确配置模型
- 当前 `sessionKey` 是否可用
- 桥接审计里是否出现 `request.failed`

### 7.4 带附件发送失败

优先检查：

- `CLAWX_MEDIA_FILE` 路径是否真实存在
- `CLAWX_MEDIA_MIME` 是否正确
- 当前运行实例是否有权限访问这个文件

## 8. Host API 可直接管理桥接

除了设置页，桥接本身也可以通过 Host API 管理：

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
- `GET /api/bridge/audit`
- `DELETE /api/bridge/audit`

这意味着后面如果你做 APP 或独立控制台，也可以直接调用这些接口来管理桥接，而不一定非要点 GUI。

## 9. 当前阶段建议

现阶段最推荐的使用方式是：

- Windows 上先用 GUI 打开桥接
- 用现有 Python 脚本完成首轮联调
- 验证通过后，再开始做 APP 接入

这样效率最高，也最容易定位问题。

