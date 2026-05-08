# ClawX-Cat 从源码到跑通第一条消息

这份文档给第一次接触 `ClawX-Cat` 的用户使用，目标不是解释所有功能，而是帮你在最短时间内把项目跑起来，并成功发出第一条消息。

## 1. 适用场景

适合以下几类情况：

- 你刚 clone 仓库，想先确认项目能否正常启动
- 你要做界面开发或联调，但还没熟悉工程结构
- 你需要一个“从零到成功”的最短验证链路

## 2. 准备环境

至少准备：

- `Git`
- `Node.js 24 LTS`
- `corepack`
- 可联网下载依赖的 npm 环境

## 3. 拉取并初始化

```bash
git clone <你的仓库地址>
cd <你的仓库目录名>
corepack enable
corepack prepare pnpm@10.31.0 --activate
pnpm run init
```

如果 `pnpm run init` 因网络问题失败，可以拆开执行：

```bash
pnpm install
pnpm run uv:download
```

## 4. 启动开发版桌面应用

```bash
pnpm dev
```

补充说明：

- 当前开发配置会同时启动 Vite 和 Electron 开发宿主
- 正常情况下，你应该能看到桌面窗口，而不只是浏览器页面
- 如果你在 Linux 无桌面环境上操作，请直接改看 `ClawX-Cat-Linux-Headless-快速手册.md`

## 5. 第一次进入后做什么

建议按下面顺序操作：

1. 确认窗口正常显示
2. 打开设置页，查看 Gateway 状态是否正常
3. 确认至少有一个可用模型 / provider
4. 进入聊天页，发送一条测试消息
5. 看到正常回复后，再继续尝试 Bridge 或 APP 接入

## 6. 如果要验证远控能力

最小路径建议如下：

1. 在设置页启用 `WebSocket Bridge` 或 `HTTP Bridge`
2. 记录端口和 Token
3. 按需要阅读以下文档进行联调：

- [ClawX-Bridge-接入说明.md](ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](ClawX-Cat-WebSocket-Bridge-接口文档.md)
- [ClawX-Cat-Bridge-命令类型清单.md](ClawX-Cat-Bridge-命令类型清单.md)

## 7. 常见卡点

### 依赖装不下来

优先检查：

- npm registry 是否可访问
- 二进制下载是否被网络限制
- Node.js / pnpm 版本是否符合 README 要求

### `pnpm dev` 没有拉起完整桌面应用

优先检查：

- 是否有图形环境
- Electron 是否被安全软件拦截
- 终端输出里是否有端口占用或构建失败

### 可以打开页面，但发不出消息

优先检查：

- Gateway 是否已启动
- 模型配置是否完整
- provider 的 API Key 是否有效

### 外部设备连不上

优先检查：

- 你连接的是 Bridge 还是 Host API
- Host API 默认只监听本机回环地址，不应作为外部入口
- Bridge 是否已启用、端口是否放行、Token 是否正确

## 8. 接下来怎么走

跑通第一条消息后，你可以按目标继续：

- 想做打包：回到 `README` 看 Windows / Linux 打包章节
- 想做 Linux 常驻服务：看 [ClawX-Cat-Linux-Headless-快速手册.md](ClawX-Cat-Linux-Headless-快速手册.md)
- 想做 APP / 脚本接入：看 Bridge 系列文档
- 想做跨公网中转：看 [Cloud Relay Service README.md](../services/cloud-relay/README.md)
