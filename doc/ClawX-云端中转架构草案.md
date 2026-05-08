# ClawX 云端中转架构草案

## 1. 文档目标

本文档用于规划下一阶段的“云端中转”方案。

当前阶段已经完成：

- ClawX 本地 GUI / Headless 双模式
- 本地 WebSocket Bridge
- 局域网 UDP 发现入口
- 设备侧云端 Relay 客户端
- Gateway RPC、Host API、文件、会话、日志等远程能力

下一阶段的目标不是重写现有桥接，而是在现有桥接之上增加一层“云端中转服务”，实现：

- 用户在同一局域网中可直接发现设备
- 用户不在局域网内也能访问设备
- 用户基于账号体系管理自己的设备
- APP / 小程序 / Web 客户端统一通过云端接入
- 设备端 ClawX 持续在线，接收云端转发的请求

## 2. 核心结论

建议采用如下方向：

- 先补“局域网发现 + 局域网直连”这条近场链路
- 保留当前本地 Bridge 作为“设备侧执行入口”
- 新增一个“设备到云”的长连接客户端
- 新增一个“云端中转服务”
- 所有用户端客户端只连接云端，不直接连接设备本地 Bridge

也就是说，未来结构应从：

```text
客户端 -> 本地 Bridge -> ClawX -> OpenClaw
```

升级为：

```text
APP -> UDP 广播发现 -> 本地 Bridge -> ClawX -> OpenClaw
```

以及：

```text
客户端 -> 云端中转 -> 设备侧 Bridge/Agent -> ClawX -> OpenClaw
```

因此最终是双入口并存：

- 同一局域网：优先走“发现 + 直连”
- 跨公网：走“云端 Relay 中转”

## 3. 为什么要加云端中转

当前本地桥接方案适合：

- 本机调试
- 局域网访问
- 功能验证

但如果要支持真正的随时随地访问，就会遇到以下问题：

- 家庭网络通常没有公网 IP
- 设备可能在 NAT 后面
- 用户不会手动做端口映射
- 直接暴露本地服务的安全边界太弱
- 多个客户端接入时缺少统一账号体系和设备绑定

因此，云端中转的主要作用是：

- 解决网络可达性问题
- 提供账号和设备关系管理
- 统一鉴权与审计
- 统一消息路由和在线状态

## 3.1 用户端怎么找到设备

从用户端角度，APP 至少要支持两种“找到设备”的方式。

### 方式 A：同一局域网内自动发现

这是用户第一次接入最顺手的方式。

设备侧 ClawX 在桥接已启动、且允许远程访问时，同时开启一个 UDP 发现服务：

- 监听固定 discovery port
- 响应 APP 发出的广播探测包
- 周期性广播自己的设备信息

APP 只要在局域网里发送：

```json
{
  "type": "clawx.discovery.probe"
}
```

设备端就会回包，内容至少包含：

- `serviceName`
- `app/version`
- `mode`
- `bridge.host`
- `bridge.port`
- `bridge.allowRemote`
- `bridge.hasToken`

这样 APP 可以直接展示：

- 找到哪些 ClawX 设备
- 哪台设备当前可连
- 连接后应走哪个 WebSocket 地址

### 方式 B：云端账号下查看已绑定设备

当用户不在局域网时，APP 不再做 UDP 广播，而是：

- 用户登录云端账号
- 云端返回该账号绑定的设备列表
- APP 选择设备后走云端 Relay

也就是说：

- 近场发现依赖局域网 UDP
- 远程发现依赖云端设备目录

## 4. 总体架构

建议分为五层。

### 4.1 发现层

职责：

- 局域网设备发现
- 输出本地直连入口
- 给 APP 首次配对提供目标列表

当前建议：

- 同局域网使用 UDP 广播发现
- 不优先依赖 mDNS/Bonjour，先保证 Android/iOS/桌面端都容易做
- 后续如需系统级“零配置体验”，再叠加 mDNS

### 4.2 客户端层

客户端包括：

- APP
- 小程序
- Web 控制台
- 桌面远程控制端

职责：

- 用户登录
- 选择设备
- 发起聊天/文件/会话/日志请求
- 接收流式返回

### 4.3 云端中转层

职责：

- 用户认证
- 设备注册与绑定
- 设备在线状态管理
- 双向消息转发
- 请求与响应关联
- 审计和限流

### 4.4 设备侧接入层

职责：

- 由设备上的 ClawX 主动连接云端
- 定期上报心跳与设备能力
- 接收云端下发的请求
- 把请求转为本地 Bridge / Runtime 调用
- 把响应和流式事件再发回云端

### 4.5 本地执行层

职责：

- ClawX Runtime
- Local Bridge
- OpenClaw Gateway
- OpenClaw 执行

## 5. 推荐数据流

### 5.1 局域网发现 + 直连

```text
APP
-> UDP 广播 clawx.discovery.probe
-> 设备返回 clawx.discovery.announcement
-> APP 拿到 ws://<device-ip>:<bridge-port>
-> APP 连接本地 Bridge
-> APP 发送 auth + 各类 bridge action
```

这个模式最适合：

- 设备与手机在同一 Wi-Fi
- 首次配对
- 局域网内低延迟控制

### 5.2 文本聊天

```text
APP/小程序
-> 云端 WebSocket
-> 云端路由到目标设备
-> 设备侧云接入客户端
-> 本地 RuntimeFacade / Bridge
-> Gateway RPC: chat.send
-> OpenClaw 执行
-> 流式事件返回设备侧
-> 云端
-> APP/小程序
```

### 5.3 带附件聊天

建议分两种策略：

#### 策略 A：客户端先把文件上传到云端

- 客户端把文件传到云端对象存储或文件服务
- 云端把文件下载地址或文件对象转给设备端
- 设备端再做本地暂存并发起 `chat.sendWithMedia`

优点：

- 更适合移动端
- 不要求设备和客户端直接传文件

缺点：

- 云端要承担文件中转压力

#### 策略 B：客户端通过云端把文件流直接转给设备

- 客户端上传给云端
- 云端以流或分片方式转发给设备端
- 设备端本地暂存

优点：

- 不强依赖对象存储

缺点：

- 中转服务压力更大

当前阶段更推荐策略 A。

## 6. 设备端推荐实现

未来设备端建议新增一个“云接入客户端”，而不是让云端直接连本地 Bridge。

建议新增职责模块：

- `CloudRelayClient`
- `DeviceRegistration`
- `DeviceHeartbeat`
- `CloudMessageDispatcher`

当前代码已经开始按这个方向落地：

- 本地 Bridge 仍是统一执行入口
- 新增 LAN Discovery Service，供 APP 在局域网找到设备
- 新增 Cloud Relay Client，主动向云端 WebSocket 建立连接
- Relay Client 收到 `relay.call` 后，转发给本地 Bridge，并把结果/事件回送云端
- 新增最小云端 Relay 服务端样例与用户侧联调客户端，便于先把“用户 -> 云端 -> 设备 -> ClawX”跑通

### 6.1 设备端连接方式

设备端由 ClawX 主动向云端建立 WebSocket 长连接：

```text
设备端 ClawX -> 云端 Relay WebSocket
```

这样有几个好处：

- NAT 后设备仍可访问云端
- 不要求设备有公网 IP
- 不要求用户手动做端口映射
- 云端可以持续掌握在线状态

### 6.2 设备端需要上报的信息

建议设备上线时上报：

- `deviceId`
- `machineId`
- `userId` 或绑定凭证
- `appVersion`
- `platform`
- `bridge/runtime capabilities`
- `gateway status`
- `agent/session summary`

## 6.3 当前设备侧 Relay 消息模型

为了尽快复用现有桥接能力，设备侧 Relay 当前建议不重新定义执行动作，而是转发现有 bridge payload。

建议最小消息模型：

- 设备上线：
  - `device.register`
- 心跳：
  - `device.heartbeat`
- 云端下发动作：
  - `relay.call`
- 设备回传首个响应：
  - `relay.result`
- 设备回传流式事件：
  - `relay.event`

其中 `relay.call.payload` 直接复用现有 bridge action，例如：

- `chat.send`
- `chat.sendWithMedia`
- `gateway.rpc`
- `hostapi.fetch`
- `session.listLocal`

这样好处是：

- 局域网直连与云端中转复用同一动作模型
- APP 不需要分别适配两套命令体系
- 设备侧只需维护一个真正的执行入口

## 6.4 当前仓库里的最小联调闭环

当前仓库里已经提供 3 个样例脚本，可直接验证整条链路：

- 设备侧发现：
  - [sample_lan_discovery.py](../scripts/bridge-tests/sample_lan_discovery.py)
- 云端最小 Relay 服务端：
  - [mock_cloud_relay.mjs](../scripts/relay-server/mock_cloud_relay.mjs)
- 用户侧 Relay 客户端：
  - [sample_relay_user_client.py](../scripts/bridge-tests/sample_relay_user_client.py)

最小跑通顺序：

1. 先在 ClawX 设置页开启桥接与云端 Relay
2. 启动 `mock_cloud_relay.mjs` 或 `services/cloud-relay/server.mjs`
3. 等设备主动连接到 Relay
4. 再运行 `sample_relay_user_client.py`
5. 用户客户端向设备发送 `chat.send`
6. 设备把流式事件通过 Relay 回传给用户客户端

## 7. 云端服务推荐模块

### 7.1 用户服务

职责：

- 注册
- 登录
- access token / refresh token
- 会话管理

### 7.2 设备服务

职责：

- 设备注册
- 设备绑定用户
- 查看设备列表
- 记录最后在线时间
- 记录设备能力

### 7.3 Relay 服务

职责：

- 维护用户端连接
- 维护设备端连接
- 做消息转发
- 做 requestId 映射
- 做流式事件分发

### 7.4 审计服务

职责：

- 记录谁连了哪个设备
- 记录调用了什么动作
- 记录失败和异常

## 8. 协议建议

建议协议分两层。

### 8.1 云端协议

云端协议负责：

- 用户认证
- 设备认证
- 设备路由
- 请求分发
- 响应回传

建议消息类型：

- `user.auth`
- `device.auth`
- `device.register`
- `device.heartbeat`
- `device.capabilities`
- `device.list`
- `relay.call`
- `relay.result`
- `relay.event`

### 8.2 设备侧本地协议

设备侧继续复用当前 Bridge/Runtime 已有能力：

- `chat.send`
- `chat.sendWithMedia`
- `gateway.rpc`
- `gateway.http`
- `hostapi.fetch`
- `session.listLocal`
- `session.transcript.get`
- `logs.get`

也就是说：

- 云端协议负责“把请求送到正确设备”
- 本地 Bridge 协议负责“设备收到后具体怎么执行”

## 9. 能力分级建议

未来接云后，建议不要把所有现有能力默认完全开放。

至少分成两类：

### 9.1 普通能力

- `chat.send`
- `chat.sendWithMedia`
- `chat.abort`
- `session.listLocal`
- `session.transcript.get`
- `gateway.status.get`

这些适合默认开放给普通用户客户端。

### 9.2 高风险能力

- `file.read`
- `hostapi.fetch`
- `gateway.http`
- `gateway.rpc`
- 日志读取
- 设备配置修改

这些建议：

- 需要额外授权
- 或只在开发者模式开启
- 或只允许桌面管理端调用

## 10. 鉴权建议

建议至少有三层鉴权。

### 10.1 用户鉴权

- 用户登录云端
- 云端颁发用户 token

### 10.2 设备鉴权

- 设备首次绑定时发放设备凭证
- 设备端长期使用设备 token 与云端保持连接

### 10.3 动作鉴权

- 云端根据用户、设备、动作类型决定是否允许请求转发

## 11. 审计建议

建议云端与设备端都保留审计。

### 11.1 云端审计

记录：

- 用户 ID
- 设备 ID
- 动作类型
- 请求时间
- 是否成功

### 11.2 设备端审计

保留当前本地 Bridge 的审计能力，用于：

- 排查云端转发成功但设备端执行失败的问题
- 排查设备侧文件/日志/会话访问问题

## 12. 下一阶段建议实施顺序

建议按以下顺序推进。

### 第一步：局域网闭环

- APP 发送 UDP 广播探测
- 设备返回 discovery announcement
- APP 通过本地 Bridge 完成登录与聊天

### 第二步：协议冻结

- 确定云端消息模型
- 确定设备端认证模型
- 确定 requestId / stream / event 约定

### 第三步：设备端接云

- 在 ClawX 中新增云端 Relay Client
- 支持主动连接云端
- 支持心跳与重连

### 第四步：最小云端中转

- 先不做复杂控制台
- 先做用户连接、设备连接、消息中转

### 第五步：最小客户端

- 先用 Web 或 Python 验证云端链路
- 再做 APP / 小程序

## 13. 目前不建议现在就做的内容

当前阶段暂不建议立即做：

- 大规模权限系统
- 复杂 SaaS 后台
- 多租户计费
- 大量设备群控

因为现在更重要的是先跑通：

- 云端可连接
- 设备可注册
- 消息可转发
- 文件可转发
- 审计可追踪

## 14. 一句话总结

下一阶段最合理的路线是：

- 先让 APP 在局域网“找到设备并直连”
- 保留当前本地 Bridge
- 让设备端 ClawX 主动连云端
- 用户客户端只连云端
- 云端负责用户、设备、路由、鉴权、审计

这样可以在不推翻现有本地桥接架构的前提下，顺滑升级成真正“随时随地可访问”的远程控制体系。

