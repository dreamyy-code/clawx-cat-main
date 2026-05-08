# ClawX 自动更新实施方案

## 1. 目标

本方案用于给 `ClawX-main` 设计一套可落地的自动更新机制，参考 `OpenClawSwitch-master` 当前“下载 `dist.zip` 并覆盖目录”的思路，但在 ClawX 中补齐一致性、回滚和兼容层，避免旧版本用户多次热更新后出现“函数找不到”“页面和主进程不匹配”“预加载桥接失效”等问题。

本次方案的核心目标有 4 个：

1. 将 ClawX 的 GUI、主业务逻辑、页面资源从“随安装包固定”调整为“壳层固定 + 运行时外置”。
2. 允许后续通过下载一个运行时压缩包，更新同目录下的外置资源，而不必每次替换 EXE 与安装框架。
3. 保证主进程、Preload、Renderer、静态资源始终按同一版本整体切换，彻底避免混版本导致的函数缺失。
4. 为后续接入你提供的下载地址预留标准接口，先支持手动/自动下载，后续再接上真实版本服务。

## 2. 现状结论

### 2.1 ClawX 当前机制

当前 ClawX 已有一套基于 `electron-updater` 的更新能力：

- 主实现位于 `electron/main/updater.ts`
- 打包配置位于 `electron-builder.yml`
- 当前 Windows 目标仍然是 `nsis`
- 当前产物 `dist`、`dist-electron` 被打进应用包内部
- 当前主窗口生产态直接加载 `dist/index.html`

这说明 ClawX 目前更接近“整包安装器更新”模式，不是“外置运行时热替换”模式。

### 2.2 Switch 当前机制

Switch 当前的热更新实现位于 `OpenClawSwitch-master/electron/update-logic.cjs`，其核心路径是：

1. 请求版本接口。
2. 下载 zip 包。
3. 解压到临时目录。
4. 直接覆盖安装目录中的 `dist`、`electron`、`public`、`src` 等目录。
5. 写入 `version.json` 与 `resource-version.json`。

这套机制的优点是：

- 包格式简单
- 不依赖安装器
- 更新速度快
- 用户理解成本低

这套机制的主要问题是：

- 直接覆盖当前目录，容易留下混合版本文件
- 更新包里某些目录缺失时，旧文件可能残留
- 主进程、Preload、Renderer 没有“同版本锁”
- 多次热更新后，老的代码和新的页面可能交叉引用
- 一旦导出函数、IPC 通道、全局桥接协议发生变化，就容易出现“函数找不到”

## 3. 关键设计原则

ClawX 不应直接复制 Switch 的“覆盖当前目录”方式，而应保留它“下载 zip 更新资源”的优点，同时把更新过程改造成“版本目录切换”。

### 3.1 壳层固定，运行时外置

最终要把 ClawX 拆成两层：

- 壳层 Shell：安装器、EXE、最小启动器、最小恢复能力
- 运行时 Runtime：主进程业务包、Preload 包、Renderer 页面包、静态资源包

Shell 更新频率应很低。

Runtime 更新频率应很高。

后续日常更新，优先只更新 Runtime。

### 3.2 不在原地覆盖当前版本

这是解决“函数找不到”的第一原则。

新版本不直接覆盖当前 `dist` 或 `electron` 目录，而是：

1. 下载 zip 到临时目录
2. 解压到新版本独立目录
3. 做完整性校验
4. 校验通过后切换“当前版本指针”
5. 下次启动加载新版本

这样可以完全避免“半更新状态”和“目录残留状态”。

### 3.3 版本整体切换，不允许局部切换

ClawX 的以下部分必须视为一个原子版本单元：

- Main Runtime
- Preload Runtime
- Renderer Runtime
- 静态资源
- 协议清单与版本清单

任何更新都必须整体通过校验后一起生效，不允许只替换 `dist` 而不替换 `preload`，也不允许只替换页面资源而不替换主进程桥接。

### 3.4 运行时 ABI 必须显式化

要额外引入一个“运行时兼容号”概念，用来约束外置 Runtime 与壳层 Shell 的兼容关系。

示例：

- `shellVersion`: `0.4.0`
- `runtimeVersion`: `2026.04.13-001`
- `runtimeAbi`: `1`
- `minShellVersion`: `0.4.0`
- `maxShellVersion`: `0.4.x`

只要 Shell 与 Runtime 的 ABI 不兼容，就拒绝切换到该 Runtime。

## 4. 目标架构

### 4.1 推荐目录结构

建议将生产态目录调整为以下结构：

```text
ClawX.exe
runtime/
  current.json
  versions/
    2026.04.13-001/
      manifest.json
      main/
        index.cjs
      preload/
        index.cjs
      renderer/
        index.html
        assets/
      resources/
        ...
      maps/
        ...
  staging/
  backup/
data/
  version.json
  update-state.json
  boot-health.json
log/
```

说明：

- `ClawX.exe` 只保留壳层能力
- `runtime/versions/<version>` 存放完整外置运行时
- `runtime/current.json` 只记录当前激活版本
- `staging` 用于解压和校验
- `backup` 用于保留最近一个成功版本
- `data/version.json` 记录当前生效版本与来源

### 4.2 Shell 的职责

Shell 只负责以下事情：

1. 解析安装目录
2. 定位当前 Runtime 版本
3. 校验 `manifest.json`
4. 加载外置 Main Runtime
5. 在启动失败时回滚到上一个可用版本
6. 提供下载、校验、切换、回滚的底层能力

Shell 不再承载大量 GUI 业务逻辑。

### 4.3 Runtime 的职责

Runtime 承载以下全部日常功能：

- 主进程业务逻辑
- Preload 桥接逻辑
- React 页面与页面资源
- 更新界面
- 设置页与业务页
- 普通 IPC 协议实现

也就是说，后续你想更新的“ts、tsx 函数”和“页面”，本质上都会进入 Runtime 产物，而不是固化在 EXE 对应的壳层中。

需要特别说明：

- 生产环境真正执行的是编译后的 JS/HTML/CSS 产物
- 可以附带保留 `src` 目录或 source map 作为调试材料
- 但运行时加载目标应是构建后的 Runtime 包，而不是直接执行原始 TS/TSX

## 5. 启动链路改造

### 5.1 当前链路

当前 ClawX 的生产态入口大致是：

1. Electron 启动
2. 执行 `dist-electron/main/index.js`
3. `BrowserWindow` 直接加载内置 `dist/index.html`

这意味着主进程包和页面包都跟安装包绑定。

### 5.2 目标链路

改造后的启动链路应为：

1. Electron 启动壳层入口
2. 壳层读取 `runtime/current.json`
3. 壳层定位 `runtime/versions/<version>/manifest.json`
4. 壳层校验必需文件是否存在
5. 壳层通过绝对路径加载外置 `main/index.cjs`
6. 外置 Main Runtime 创建窗口
7. 窗口通过绝对路径加载外置 `renderer/index.html`
8. Preload 也通过绝对路径指向外置 `preload/index.cjs`

### 5.3 需要保留在壳层的最小代码

建议壳层只保留一个极薄的 Bootstrap：

- `resolveInstallDir()`
- `resolveCurrentRuntime()`
- `validateRuntimeManifest()`
- `loadRuntimeMainEntrypoint()`
- `fallbackToPreviousRuntime()`
- `safeModeWindow()`

这样即使外置 Runtime 损坏，壳层也能提供恢复入口。

## 6. 更新包格式设计

### 6.1 更新包形式

建议后续采用单一运行时包：

- 文件名示例：`clawx-runtime-2026.04.13-001.zip`

压缩包内部建议包含：

```text
manifest.json
main/
preload/
renderer/
resources/
maps/
```

不建议继续沿用 Switch 现在那种“可能有 `dist`、可能有 `src`、可能有 `electron`”的宽松包结构。

ClawX 应把运行时包格式标准化，避免不同版本包结构漂移。

### 6.2 manifest.json 建议字段

建议每个运行时包都必须带一个清单：

```json
{
  "runtimeVersion": "2026.04.13-001",
  "runtimeAbi": 1,
  "minShellVersion": "0.4.0",
  "maxShellVersion": "0.4.x",
  "mainEntry": "main/index.cjs",
  "preloadEntry": "preload/index.cjs",
  "rendererEntry": "renderer/index.html",
  "requiredFiles": [
    "main/index.cjs",
    "preload/index.cjs",
    "renderer/index.html"
  ],
  "hash": {
    "algorithm": "sha256",
    "package": "..."
  },
  "contract": {
    "ipcSchemaVersion": 1,
    "preloadApiVersion": 1
  }
}
```

其中最关键的是：

- 入口文件定义
- 兼容范围
- 必需文件列表
- 整包哈希
- 协议版本

## 7. 下载与版本接口设计

### 7.1 下载地址

你后续会提供一个下载地址，本方案先按“可配置地址”设计。

建议增加一个更新源配置，例如：

- `runtimeUpdateBaseUrl`
- `runtimeManifestUrl`
- `runtimeChannel`

先允许默认值为空。

当地址为空时：

- UI 可以显示“未配置更新源”
- 不执行自动下载
- 允许后续在设置页或内置配置中补齐

### 7.2 版本清单接口

建议不要只返回一个 zip 地址，而是返回一个版本清单，例如：

```json
{
  "code": 200,
  "data": {
    "runtimeVersion": "2026.04.13-001",
    "runtimeAbi": 1,
    "downloadUrl": "",
    "sha256": "",
    "releaseNotes": "",
    "mandatory": false,
    "publishedAt": ""
  }
}
```

这样做的原因是：

- 便于先比较版本，再决定是否下载
- 便于做哈希校验
- 便于做强制更新
- 便于后续扩展灰度发布

## 8. 更新流程设计

### 8.1 标准流程

建议 ClawX 的 Runtime 更新流程固定为：

1. 查询远端版本清单
2. 比较 `runtimeVersion`
3. 下载 zip 到临时目录
4. 校验 zip 哈希
5. 解压到 `runtime/staging/<version>`
6. 校验 `manifest.json`
7. 校验必需文件存在
8. 校验 Shell 兼容范围
9. 做启动前自检
10. 写入待切换状态
11. 提示重启或自动重启
12. 下次启动切换到新版本
13. 新版本启动成功后标记健康
14. 清理旧版本缓存

### 8.2 启动前自检

这是解决“函数找不到”的第二个关键点。

建议在切换版本前加一个自检步骤，至少校验：

- `main/index.cjs` 可被 Node 正常加载
- `preload/index.cjs` 可被 Node 正常加载
- `renderer/index.html` 存在
- `manifest` 中声明的协议版本有效
- 关键桥接 API 名称存在
- 关键 IPC 通道清单未缺失

如果任一项失败，直接判定该 Runtime 包不可激活。

### 8.3 生效策略

第一阶段建议采用“下载后重启生效”，不要追求不停机热切换。

理由：

- 主进程入口变化时，必须重启才能完全生效
- Preload 变化时，重建窗口更安全
- Renderer 与 Main、Preload 必须一起切换
- 先保证一致性，再考虑体验优化

也就是说，这里的“热更新”应定义为：

- 不重装应用
- 不替换 EXE
- 只替换外置 Runtime
- 通过重启完成整版本切换

## 9. 彻底解决“函数找不到”的方案

这是 ClawX 与 Switch 方案的最大区别，必须单独作为强约束落地。

### 9.1 不做目录覆盖，改做版本目录切换

不能把新版本直接覆盖到当前版本目录。

必须始终保留：

- 当前运行版本
- 上一个稳定版本
- 新下载待切换版本

### 9.2 不做增量目录复用

不要复用旧版目录中的残留文件。

每个 Runtime 版本目录都必须是完整快照。

新版本缺什么，就直接判失败，不允许“继续借用上个版本同名文件”。

### 9.3 Main / Preload / Renderer 绑定同一 manifest

三者必须共用同一个版本清单，切换时一起切换。

不能出现：

- 主进程是新版
- 页面还是旧版
- preload 桥接是另一个版本

### 9.4 协议版本必须可校验

建议增加两个显式版本：

- `ipcSchemaVersion`
- `preloadApiVersion`

一旦 Runtime 中这两个版本与 Shell 预期不匹配，直接阻止激活。

### 9.5 启动健康检查与自动回滚

建议新增 `boot-health.json`，记录：

- 本次尝试启动的 `runtimeVersion`
- 启动开始时间
- 是否成功完成首屏加载
- 是否成功完成 preload 握手
- 是否发生致命异常

切换到新版本后：

1. 壳层先将其标记为 `pending`
2. 新版本启动后，必须在限定时间内回报 `healthy`
3. 若超时未健康，或主进程崩溃，则自动回滚到上一个稳定版本

这一步是兜底保障，能把错误版本挡在用户真正进入界面之前。

## 10. 壳层与 Runtime 的职责边界

### 10.1 壳层保留内容

以下内容建议固定在壳层中，不随高频更新漂移：

- Runtime 定位与切换器
- 更新下载器
- 哈希校验器
- 版本回滚器
- 安全模式窗口
- 最小日志能力

### 10.2 Runtime 保留内容

以下内容全部外置：

- 页面
- 页面组件
- 普通业务 store
- 主业务 IPC
- 设置页逻辑
- 更新中心 UI
- 主进程大部分业务代码

### 10.3 为什么不能把所有东西都放进 EXE

如果继续沿用当前整包模式：

- 每次更新都需要碰安装器
- 页面改动必须随整包发布
- 主业务逻辑无法高频修复
- 更新失败时恢复成本高

而 Shell/Runtime 分层后：

- EXE 只承担稳定底座
- 日常更新只替换 Runtime
- 页面与函数都能一起升级
- 回滚粒度清晰

## 11. 对现有 ClawX 的具体改造建议

### 11.1 第一阶段：引入 Runtime Bootstrap

目标：

- 不先做完整更新
- 先让 ClawX 具备从外置目录加载 Runtime 的能力

需要改造的重点：

1. 将当前 `electron/main/index.ts` 缩薄为壳层入口。
2. 新增一个 `runtime bootstrap` 模块，负责解析外置 Runtime。
3. 将当前主进程主要业务打包为外置 `main` 运行时入口。
4. 将当前 `preload` 产物改为可从外置路径加载。
5. 将当前窗口 `loadFile(join(__dirname, '../../dist/index.html'))` 改为按 Runtime manifest 指向的外置 `renderer/index.html`。

### 11.2 第二阶段：改造打包链路

目标：

- 打包时生成“Shell + 初始 Runtime”

建议打包产物分两部分：

1. 安装包内自带一个初始 Runtime 版本目录
2. 安装时写入 `runtime/current.json`

这样新安装用户与后续更新用户走同一套运行时目录结构。

### 11.3 第三阶段：引入自定义 Runtime Updater

目标：

- 不直接依赖 `electron-updater` 做日常页面更新

建议：

- 将 `electron-updater` 继续保留给“壳层升级”或以后特殊场景
- 日常更新改为自定义 `Runtime Updater`

原因：

- `electron-updater` 更适合整包替换
- 本方案更适合外置目录包切换
- 两层更新职责要分开

### 11.4 第四阶段：回滚与健康检测

目标：

- 确保错误包不会把用户应用打死

必须补齐：

- 启动健康上报
- 超时自动回滚
- 崩溃自动回滚
- 最近稳定版本保留

## 12. 建议新增的文件与模块

以下是推荐新增的模块，不是最终文件名强约束，但职责建议保持清晰。

### 12.1 壳层侧

- `electron/main/runtime-bootstrap.ts`
- `electron/main/runtime-resolver.ts`
- `electron/main/runtime-manifest.ts`
- `electron/main/runtime-health.ts`
- `electron/main/runtime-updater.ts`
- `electron/main/runtime-rollback.ts`

### 12.2 构建侧

- `scripts/build-runtime-bundle.mjs`
- `scripts/package-runtime-zip.mjs`
- `scripts/install-initial-runtime.mjs`

### 12.3 数据侧

- `data/version.json`
- `data/update-state.json`
- `data/boot-health.json`

## 13. 更新状态机建议

建议将更新状态统一收口为：

- `idle`
- `checking`
- `available`
- `downloading`
- `verifying`
- `extracting`
- `validating`
- `ready-to-switch`
- `switching`
- `pending-restart`
- `healthy`
- `rolled-back`
- `error`

这样后续 UI、日志和诊断页都能复用一套状态模型。

## 14. 日志与诊断要求

为了方便排查线上更新问题，建议最少落以下日志：

- 当前 Shell 版本
- 当前 Runtime 版本
- 下载 URL
- 下载文件哈希
- 解压目录
- manifest 校验结果
- 必需文件缺失列表
- 启动健康检查结果
- 回滚触发原因

同时建议保留一个更新诊断页，至少能看到：

- 当前生效 Runtime 版本
- 最近一次更新结果
- 最近一次回滚原因
- 当前更新源地址

## 15. 风险与应对

### 15.1 风险：生产态不能直接执行 TS/TSX

应对：

- 运行时更新的目标是构建产物
- TS/TSX 作为源代码参与构建，不直接作为生产入口
- 如确有需要，可附带 `src` 与 source map 便于调试

### 15.2 风险：外置主进程代码路径复杂

应对：

- 壳层仅负责解析路径和 `require/import`
- 所有资源路径都改为基于 Runtime 根目录解析
- 不再假定 `__dirname` 指向固定内置结构

### 15.3 风险：历史包结构混乱

应对：

- ClawX 从第一版 Runtime 包开始就强制 `manifest` 标准化
- 不兼容旧格式 zip 时直接拒绝
- 不为了兼容不规范包而放松校验

### 15.4 风险：切换失败导致无法启动

应对：

- 壳层保留安全模式与自动回滚
- 切换前保留上一个稳定版本
- 未健康前不清理旧版本

## 16. 分阶段实施建议

建议按以下顺序推进。

### 阶段 A：文档与结构设计

产出：

- 本文档
- Runtime 目录结构定稿
- Manifest 字段定稿

### 阶段 B：先改成外置加载

产出：

- Shell 能加载外置 Runtime
- 首次安装包携带初始 Runtime
- GUI、主逻辑、Preload 全部从外置目录读取

这是最关键的一步，因为只有这一步完成后，后续下载 zip 才有意义。

### 阶段 C：接入 Runtime 更新器

产出：

- 查询版本
- 下载 zip
- 解压校验
- 写入待切换状态
- 重启生效

### 阶段 D：补齐健康检查与回滚

产出：

- 启动健康上报
- 自动回滚
- 失败诊断

### 阶段 E：补 UI 和配置入口

产出：

- 设置页中的更新中心
- 更新源地址配置
- 手动检查更新
- 下载进度
- 重启提示

## 17. 我建议的首版落地范围

为了降低一次性改造风险，我建议首版只做下面这些：

1. 先完成“外置 Runtime 加载”
2. 先支持“下载 Runtime zip + 重启生效”
3. 先只做 Windows
4. 先只保留最近 2 个稳定 Runtime
5. 先只支持完整包，不做增量包

首版不要做的内容：

- 不做不停机热切换
- 不做差分更新
- 不做多通道灰度
- 不做过度兼容旧格式包

## 18. 最终结论

ClawX 要参考 Switch 的不是“直接覆盖目录”这个动作本身，而是“把更新对象从安装器切换为资源包/运行时包”这个方向。

真正适合 ClawX 的实现应当是：

- 保留一个稳定的壳层 EXE
- 把 GUI、业务主逻辑、Preload、页面资源全部迁到同目录外置 Runtime
- 更新时下载完整 Runtime zip
- 通过版本目录切换替代原地覆盖
- 通过 manifest、ABI、健康检查、回滚机制彻底解决函数缺失问题

如果按这个方案推进，后续你提供下载地址后，ClawX 就可以做到：

- 不重做安装器
- 不频繁改 EXE
- 页面和函数一起升级
- 多次更新后仍然保持版本一致
- 出错时能自动回退到上一个稳定版本

## 19. 实施前确认项

在正式开始编码前，建议你先确认以下 6 项：

1. Windows 是否作为第一优先平台，其他平台后补。
2. 首版是否接受“下载后重启生效”，而不是无感热替换。
3. Runtime zip 是否采用本文定义的标准结构，而不是继续兼容 Switch 旧包格式。
4. 是否保留 `electron-updater` 仅用于壳层升级，日常更新改为自定义 Runtime Updater。
5. 下载地址与版本清单接口是否由你后续提供。
6. 首版是否只保留最近 2 个稳定 Runtime。

以上 6 项确认后，就可以进入实际改造阶段。
