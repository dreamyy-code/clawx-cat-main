# ClawX-Cat Linux Headless 快速手册

这份文档面向 Linux 无桌面环境、远程主机、盒子、弱图形环境部署场景，目标是帮你快速把 `ClawX-Cat` 以后台方式跑起来，并为 Bridge / APP 接入准备好运行环境。

## 1. 什么时候用这份手册

适合以下场景：

- 你没有桌面环境，不方便直接运行 GUI
- 你希望 ClawX-Cat 在 Linux 上常驻运行
- 你需要给 APP、脚本或远程客户端提供 Bridge 入口

## 2. 推荐的两种进入方式

### 方式 A：先安装 Debian 包

如果你已经有 `.deb` 产物，建议优先走安装脚本：

```bash
chmod +x install_debian_clawx.sh
./install_debian_clawx.sh ./ClawX-<version>-linux-amd64.deb
```

安装完成后，状态会写入：

- `/etc/clawx/install-state.json`

### 方式 B：直接使用 Headless 启动脚本

如果你已经有可执行文件和运行目录，可以直接使用：

```bash
chmod +x start_clawx_headless.sh
./start_clawx_headless.sh start-bg
./start_clawx_headless.sh status
```

## 3. Headless 脚本支持的动作

- `start`：前台启动
- `start-bg`：后台启动
- `stop`：停止
- `status`：查看状态
- `restart`：重启

示例：

```bash
./start_clawx_headless.sh start-bg
./start_clawx_headless.sh status
./start_clawx_headless.sh restart
./start_clawx_headless.sh stop
```

## 4. 重要目录和文件

默认情况下：

- 可执行文件：`/opt/ClawX/clawx`
- 环境文件：`/etc/clawx/clawx.env`
- 安装状态：`/etc/clawx/install-state.json`
- 数据目录：`/var/lib/clawx`
- 日志目录：`/var/log/clawx`
- 日志文件：`/var/log/clawx/clawx-headless.log`
- PID 文件：`/var/lib/clawx/clawx-headless.pid`

## 5. 常用环境变量

如果你需要调整默认行为，可以在 `/etc/clawx/clawx.env` 中设置：

- `CLAWX_BIN`
- `CLAWX_SERVICE_USER`
- `CLAWX_SERVICE_GROUP`
- `CLAWX_USER_DATA_DIR`
- `CLAWX_LOG_DIR`
- `CLAWX_TMP_DIR`
- `CLAWX_STATE_DIR`
- `CLAWX_ENV_FILE`
- `CLAWX_PID_FILE`
- `CLAWX_STDOUT_LOG`

如果你要显式控制桥接相关配置，也可以额外关注：

- `CLAWX_BRIDGE_HOST`
- `CLAWX_BRIDGE_PORT`
- `CLAWX_BRIDGE_TOKEN`
- `CLAWX_BRIDGE_HTTP`
- `CLAWX_BRIDGE_HTTP_PORT`
- `CLAWX_BRIDGE_HTTP_TOKEN`

## 6. 默认端口

默认值如下：

- Gateway：`18789`
- WebSocket Bridge：`18989`
- Discovery：`18990`
- HTTP Bridge：`18991`

补充说明：

- 默认情况下 WebSocket Bridge 和 HTTP Bridge 都不是强制开启
- 在 headless / Linux 远控场景下，Bridge 会更积极地启动并监听可远程访问地址
- Host API 默认只监听 `127.0.0.1:13210`，不要直接拿它做外部入口

## 7. 最小验证链路

建议按这个顺序验证：

1. `./start_clawx_headless.sh start-bg`
2. `./start_clawx_headless.sh status`
3. `tail -f /var/log/clawx/clawx-headless.log`
4. 确认 Gateway 正常启动
5. 启用并记录 Bridge 端口和 Token
6. 按 Bridge 文档做最小联调

相关文档：

- [ClawX-Bridge-接入说明.md](ClawX-Bridge-接入说明.md)
- [ClawX-Cat-HTTP-Bridge-接口文档.md](ClawX-Cat-HTTP-Bridge-接口文档.md)
- [ClawX-Cat-WebSocket-Bridge-接口文档.md](ClawX-Cat-WebSocket-Bridge-接口文档.md)

## 8. 常见问题

### `status` 显示未运行

优先检查：

- 可执行文件路径是否正确
- 服务用户是否存在
- `runuser` 或 `su` 是否可用
- 日志文件中是否有启动失败信息

### 日志里有图形相关报错

正常的 Headless 场景不应依赖桌面会话。请确认你使用的是 `start_clawx_headless.sh`，并且没有强依赖 GUI 的登录流程。

### 外部设备能发现我，但连不上

优先检查：

- 端口是否已放行
- Token 是否正确
- Bridge 是否真的已启用
- 当前监听地址是否对局域网可达

### 我是否必须部署 Cloud Relay

不必须。Headless + Bridge 就已经足够覆盖大多数局域网远控和 APP 直连场景。只有跨公网或统一账号中转时，才需要单独部署 Relay。

## 9. 下一步

- 想从源码本地跑通：看 [ClawX-Cat-从源码到跑通第一条消息.md](ClawX-Cat-从源码到跑通第一条消息.md)
- 想做跨公网中转：看 [Cloud Relay Service README.md](../services/cloud-relay/README.md)
- 想深入 Linux 服务化设计：看 [ClawX-Linux-无GUI服务化远程控制实施方案.md](ClawX-Linux-无GUI服务化远程控制实施方案.md)
