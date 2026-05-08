# ClawX UniApp 远程控制设计手册

## 1. 文档目标

本文档面向后续的 UniApp 客户端设计与开发，目标是把当前 ClawX-Cat 已具备的远程能力整理成一份可直接落地的 APP 设计手册。

重点回答以下问题：

- UniApp 版 APP 应该如何连接 ClawX-Cat
- 局域网与远程访问分别怎么做
- 当前 ClawX 已经提供了哪些接口和能力
- APP 端应该如何设计页面、状态和交互
- 联调时应该先测哪些链路
- 现有 Python 脚本分别能验证什么

当前阶段的结论很明确：

- APP 首期优先走“局域网发现 + 局域网直连”
- 远程访问保留为第二入口，走云端 Relay
- APP 端不直接对接 OpenClaw 内部细节，而是对接 ClawX 提供的 Bridge / Relay 协议

## 2. 总体结论

### 2.1 首期接入策略

UniApp 首期建议采用双入口设计：

- 局域网模式
  - APP 与 ClawX 设备在同一 Wi-Fi / 同一局域网
  - 通过 UDP 发现设备
  - 再直接连接本地 Bridge WebSocket
- 远程模式
  - APP 不与设备直连
  - APP 登录云端 Relay
  - 通过云端 Relay 转发请求到设备

### 2.2 当前优先级

当前优先级建议如下：

1. 先把局域网模式做完整
2. 再把云端 Relay 模式接上
3. 最后再做更复杂的设备管理、权限和后台

原因：

- 局域网模式链路更短
- 更容易联调
- 更容易做首版用户体验
- 有利于先验证 APP 与设备之间的消息模型

## 3. 当前系统已经具备的底座

当前 ClawX-Cat 这边已经有以下能力，不需要 UniApp 重新发明：

- 本地 Bridge WebSocket 服务
- 局域网 UDP 发现
- Cloud Relay Client
- Cloud Relay Service 第一版骨架
- Host API 管理接口
- 聊天、文件、会话、日志、模型、Agent 管理等 Bridge 动作
- Python 测试脚本

相关文档可参考：

- [ClawX-Bridge-接入说明.md](ClawX-Bridge-接入说明.md)
- [ClawX-远程桥接操作手册.md](ClawX-远程桥接操作手册.md)
- [ClawX-云端中转架构草案.md](ClawX-云端中转架构草案.md)
- [Cloud Relay README.md](../services/cloud-relay/README.md)

## 4. APP 连接方式设计

### 4.1 局域网模式

这是 UniApp 首版最重要的连接模式。

#### 4.1.1 目标用户场景

- 手机和 ClawX-Cat 设备在同一个 Wi-Fi
- 用户首次添加设备
- 用户只想在家里或办公室本地控制设备
- 用户希望低延迟聊天和控制

#### 4.1.2 连接流程

建议 APP 端按照以下顺序工作：

1. APP 发送 UDP 广播探测包
2. ClawX 返回 discovery announcement
3. APP 展示发现到的设备列表
4. 用户点击某个设备
5. APP 拿到 `ws://<device-ip>:<bridge-port>`
6. APP 提示输入或保存 bridge token
7. APP 连接 Bridge WebSocket
8. APP 发送 `auth`
9. 鉴权成功后进入控制页

#### 4.1.3 局域网发现协议

APP 发送：

```json
{
  "type": "clawx.discovery.probe"
}
```

ClawX 回包至少包含：

- `type`
- `serviceName`
- `addresses`
- `transport`
- `app`
- `version`
- `mode`
- `bridge.host`
- `bridge.port`
- `bridge.allowRemote`
- `bridge.hasToken`

APP 可用这些字段做：

- 设备列表展示
- 展示设备名称
- 展示设备当前运行模式
- 计算候选 WebSocket 地址
- 判断当前设备是否允许远程访问

#### 4.1.4 UniApp 侧实现建议

局域网发现建议在 UniApp 中拆成独立模块：

- `discoveryService`
  - 负责发送 UDP 广播
  - 负责收 discovery 回包
  - 负责设备列表去重
- `deviceStore`
  - 缓存最近发现的设备
  - 标记在线时间
  - 保存用户已绑定设备
- `bridgeClient`
  - 负责 WebSocket 连接、鉴权、请求发送和事件分发

#### 4.1.5 局域网模式重点注意

- 手机端 UDP 能力在不同平台权限不同，需先验证 UniApp 插件能力
- 如果发现层做不了纯 UniApp，需要用原生插件封装 UDP
- 即便后续改用 mDNS，Bridge WebSocket 的主协议仍然不变
- 首版一定要保留“手动输入 IP + 端口 + token”的兜底入口

### 4.2 远程模式

这是 UniApp 第二阶段要接上的能力。

#### 4.2.1 目标用户场景

- 用户不和设备在同一局域网
- 用户希望 4G / 5G 下控制家里的设备
- 用户需要统一账号下查看多个设备

#### 4.2.2 连接流程

建议 APP 端按照以下顺序工作：

1. 用户登录云端账号
2. APP 获取用户已绑定设备列表
3. 用户选择一个在线设备
4. APP 连接云端 Relay WebSocket
5. APP 发送 `user.auth`
6. APP 发送 `user.devices.get`
7. APP 发送 `user.device.bind`
8. APP 发送 `user.call`
9. 云端 Relay 转发到设备
10. 设备执行后通过 `relay.result` 和 `relay.event` 回给 APP

#### 4.2.3 远程模式的定位

远程模式不替代局域网模式，而是做成第二入口：

- 局域网下优先直连
- 不在局域网时才走 Relay

这样可以降低：

- 云端压力
- 中转延迟
- 成本
- 排障复杂度

## 5. ClawX 对 APP 暴露的能力总表

下面是当前 APP 端真正应该关注的接口能力。

### 5.1 连接与状态

- `auth`
- `bridge.info`
- `bridge.status.get`
- `runtime.capabilities.get`
- `ping`

用途：

- 建立连接
- 完成鉴权
- 获取当前 Bridge 状态
- 获取远程动作清单
- 保持心跳

### 5.2 聊天能力

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`

配套事件：

- `chat.accepted`
- `chat.delta`
- `chat.completed`
- `chat.failed`
- `chat.aborted`

用途：

- 纯文本聊天
- 图片/文件附件聊天
- 停止回复
- 显示流式输出

### 5.3 文件能力

- `file.stageBuffer`
- `file.stagePaths`
- `file.read`

用途：

- APP 上传内存文件或二进制
- 使用本地已有文件
- 读取文件内容

APP 首期建议：

- 首先只使用 `file.stageBuffer`
- 尽量不要首版就开放 `file.read`

### 5.4 会话能力

- `session.listLocal`
- `session.subscribe`
- `session.transcript.get`
- `session.delete`

用途：

- 拉取历史会话列表
- 进入指定会话
- 查看 transcript
- 删除会话

### 5.5 Gateway 能力

- `gateway.status.get`
- `gateway.health.get`
- `gateway.start`
- `gateway.stop`
- `gateway.restart`
- `gateway.reload`
- `gateway.rpc`
- `gateway.http`
- `gateway.controlUi.get`

用途：

- 展示 OpenClaw 状态
- 提醒用户 Gateway 是否可用
- 开发者模式下进行诊断或控制

APP 首期建议：

- 默认只展示 `gateway.status.get` 和 `gateway.health.get`
- 不要首版直接开放 `gateway.rpc`

### 5.6 Agent 与模型能力

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

用途：

- 拉取 Agent 列表
- 创建和导入 Agent
- 配置 Agent 通讯
- 配置主模型 / 后备模型 / provider model

APP 首期建议：

- 先做只读查看
- 修改类功能先放到“高级设置”页或桌面端

### 5.7 日志与软件层能力

- `hostapi.fetch`
- `logs.get`
- `logs.files.get`
- `logs.dir.get`

用途：

- 调用宿主层接口
- 查看日志
- 做远程诊断

APP 首期建议：

- 不默认开放给普通用户
- 放到开发者模式

## 6. Host API 对 APP 的价值

除了 WebSocket Bridge，ClawX 当前还提供了 Host API 管理接口。

与 APP 相关的主要接口：

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

UniApp 端使用建议：

- 局域网模式主控制链路优先走 WebSocket
- Host API 主要用于设备管理、状态面板和诊断
- 如果后续做桌面管理端或 Web 控制台，Host API 会更有价值

## 7. UniApp 端建议页面结构

建议 UniApp 首版至少拆成以下页面。

### 7.1 启动页

职责：

- 选择连接模式
- 展示“局域网连接”与“远程连接”

建议按钮：

- 扫描局域网设备
- 手动连接设备
- 登录云端账号

### 7.2 局域网设备发现页

职责：

- 发送 UDP 探测
- 展示发现到的设备列表
- 支持刷新

每张设备卡建议展示：

- 设备名称
- IP 地址
- Bridge 端口
- 当前模式
- 是否需要 token
- Gateway 状态

### 7.3 设备连接页

职责：

- 输入或选择：
  - IP
  - 端口
  - token
- 执行 `auth`
- 保存最近连接设备

### 7.4 聊天主页面

职责：

- 发送消息
- 接收流式输出
- 切换会话
- 显示当前设备状态

建议顶部固定展示：

- 设备名
- 连接模式
- Bridge 状态
- OpenClaw 状态

### 7.5 会话页面

职责：

- 调用 `session.listLocal`
- 展示历史会话
- 进入 transcript

### 7.6 设备页

职责：

- 展示设备状态
- 展示 Gateway 状态
- 展示最近连接信息
- 展示局域网 / Relay 连接信息

### 7.7 高级设置页

职责：

- 管理 token
- 读取桥接信息
- 开启开发者模式
- 访问日志与诊断能力

## 8. UniApp 端模块拆分建议

### 8.1 网络层

- `udpDiscovery.ts`
- `bridgeSocket.ts`
- `relaySocket.ts`
- `httpClient.ts`

### 8.2 状态层

- `deviceStore`
- `sessionStore`
- `chatStore`
- `connectionStore`
- `settingsStore`

### 8.3 协议层

- `bridgeProtocol.ts`
- `relayProtocol.ts`
- `messageMapper.ts`

### 8.4 UI 层

- 设备卡片
- 会话列表
- 聊天气泡
- 附件面板
- 状态标签
- 日志面板

## 9. APP 端消息模型建议

建议 APP 内部统一用一层抽象，而不是把所有 Bridge 原始消息直接散落在页面里。

可以统一抽象成：

- 请求
  - `id`
  - `type`
  - `payload`
- 响应
  - `id`
  - `ok`
  - `data`
  - `error`
- 事件
  - `type`
  - `sessionKey`
  - `data`

这样做的好处：

- 局域网直连与云端 Relay 可以共用同一套页面逻辑
- 只在底层切换 transport
- 页面层不需要感知“当前是本地 Bridge 还是云端 Relay”

## 10. 局域网模式的重点设计细节

### 10.1 设备去重

同一台设备可能从多个 IP 或重复广播里出现，建议用以下组合做去重：

- `serviceName`
- `bridge.port`
- `addresses`

### 10.2 最近设备缓存

建议缓存：

- 最近连接设备
- 最近成功 token
- 上次连接模式
- 上次会话 key

### 10.3 手动输入兜底

即使局域网发现失败，也要允许用户手动输入：

- IP
- 端口
- token

### 10.4 状态提示

建议在 APP 内显眼展示：

- Bridge 是否已连接
- OpenClaw 是否运行中
- 当前是否鉴权成功

## 11. 远程模式的重点设计细节

### 11.1 设备列表来源

远程模式下设备列表不来自 UDP，而来自云端用户设备目录。

### 11.2 用户与设备绑定

APP 必须明确区分：

- 用户 token
- 设备 token

当前建议：

- APP 只持有用户 token
- 设备 token 只配置在 ClawX 侧

### 11.3 Relay 与页面解耦

APP 页面层不要直接依赖 `user.call`、`relay.result` 的细节。

应该由 `relaySocket` 统一包装成和 Bridge 类似的请求/响应接口。

## 12. APP 首版建议开放的功能

建议首版开放：

- 局域网发现设备
- 手动连接设备
- 文本聊天
- 会话列表
- 查看设备状态
- 查看 OpenClaw 状态
- 附件发送

建议首版暂不开放：

- 文件任意读取
- 完整 Host API 透传
- 完整 Gateway RPC
- 日志全量读取
- 大规模 Agent 配置修改

## 13. APP 联调与测试建议

### 13.1 当前可用测试脚本

局域网 / Bridge：

- [sample_lan_discovery.py](../scripts/bridge-tests/sample_lan_discovery.py)
- [sample_bridge_client.py](../scripts/bridge-tests/sample_bridge_client.py)

Relay / 服务端：

- [test_relay_health.py](../scripts/bridge-tests/test_relay_health.py)
- [test_relay_admin_api.py](../scripts/bridge-tests/test_relay_admin_api.py)
- [test_relay_roundtrip.py](../scripts/bridge-tests/test_relay_roundtrip.py)
- [sample_relay_user_client.py](../scripts/bridge-tests/sample_relay_user_client.py)

Relay 服务端：

- [mock_cloud_relay.mjs](../scripts/relay-server/mock_cloud_relay.mjs)
- [server.mjs](../services/cloud-relay/server.mjs)

### 13.2 推荐测试顺序

建议严格按以下顺序联调：

1. 先测局域网发现
2. 再测本地 Bridge 聊天
3. 再测会话与状态接口
4. 再测 Relay 服务端健康检查
5. 再测 Relay 管理接口
6. 最后测 Relay 端到端回路

### 13.3 各脚本分别验证什么

`sample_lan_discovery.py`

- 验证局域网发现是否正常
- 验证 UDP 广播是否可达
- 验证设备回包信息是否完整

`sample_bridge_client.py`

- 验证 Bridge WebSocket 是否可连
- 验证 `auth`
- 验证 `bridge.info`
- 验证 `runtime.capabilities.get`
- 验证 `chat.send` / `chat.sendWithMedia`

`test_relay_health.py`

- 验证 Relay HTTP 服务是否启动
- 验证 `/health`
- 验证管理接口是否可达

`test_relay_admin_api.py`

- 验证创建用户
- 验证创建设备 token
- 验证绑定关系
- 验证读取回显

`test_relay_roundtrip.py`

- 验证 `user.auth`
- 验证 `user.devices`
- 验证 `user.device.bind`
- 验证 `user.call -> relay.call -> relay.result -> relay.event`

## 14. UniApp 开发建议路线

### 第一阶段：局域网 MVP

- 完成设备发现页
- 完成手动连接页
- 完成聊天页
- 完成状态栏
- 跑通局域网聊天

### 第二阶段：本地设备管理

- 会话列表
- transcript
- 设备页
- Gateway 状态
- 历史设备缓存

### 第三阶段：Relay 接入

- 登录页
- 云端设备列表
- Relay socket 封装
- 远程聊天

### 第四阶段：高级功能

- 附件聊天
- Agent 管理
- 模型配置查看
- 开发者模式

## 15. 当前不建议 UniApp 首版直接做的内容

- 一开始就做所有 Bridge 动作
- 一开始就做全量 Gateway RPC
- 一开始就把日志、文件、Host API 全开放
- 一开始就做复杂多设备 SaaS 后台

更合理的方式是：

- 先做“能连上、能聊天、能看状态”
- 再逐步补高级能力

## 16. 一句话总结

UniApp 版 ClawX-Cat 的最佳设计路线是：

- 同局域网时，APP 先用 UDP 找到设备，再直连 Bridge WebSocket
- 不在局域网时，APP 连接云端 Relay，由 Relay 转发到设备
- APP 页面层统一面向一套“远程控制动作模型”，只在底层切换局域网 transport 与云端 transport

这样最稳、最快，也最符合当前 ClawX 已经具备的远程桥接能力。


