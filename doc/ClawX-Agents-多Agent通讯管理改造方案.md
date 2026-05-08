# ClawX Agents 页面多 Agent 通讯管理改造方案

## 1. 背景

当前 `ClawX` 的 `Agents` 页面，已经覆盖了以下能力：

- 创建 / 删除 Agent
- 编辑 Agent 名称
- 配置 Agent 模型覆盖
- 只读查看该 Agent 绑定了哪些外部频道

但根据 `12 OpenClaw 多 Agent 协作.md`，真正的多 Agent 协作并不只是“有多个 Agent”这么简单，而是至少包含 3 层能力：

1. Agent 本身的管理
2. Agent 与外部频道 / 机器人账号的路由绑定
3. Agent 与 Agent 之间的通讯、派发、可见性和协作约束

目前 ClawX 已经有第 1 层和第 2 层的部分能力，但第 3 层几乎还是空白。用户虽然可以在 OpenClaw 中手改配置实现多 Agent 协作，但在 ClawX 界面里看不到：

- 是否启用了 A2A 通讯
- 哪些 Agent 被纳入通讯白名单
- 某个 Agent 能把任务派给谁
- 当前多 Agent 协作需要哪些全局前置条件
- 主 Agent 的协作说明是否已经写入 `AGENTS.md`

因此，这次改造的目标不是简单加几个开关，而是把 `Agents` 页面升级为：

> “Agent 基础管理 + 多 Agent 通讯管理 + 协作说明生成”的统一入口。

## 2. 对 OpenClaw 文档的关键提炼

从 `12 OpenClaw 多 Agent 协作.md` 可以抽出几个必须被 ClawX 承接的事实。

### 2.1 子 Agent 与多 Agent 是两种体系

- 子 Agent 更像临时外包，适合一次性并行任务。
- 多 Agent 是长期存在的独立 Agent，拥有各自的工作区、身份、记忆和会话。

因此，ClawX 的 `Agents` 页面不能只做“Agent 列表”，还需要体现它们之间是否已经形成一个“协作网络”。

### 2.2 多 Agent 协作至少涉及 4 个关键配置面

1. `agents.list`
   - 定义有哪些 Agent。
2. `bindings`
   - 定义外部频道 / 机器人消息路由给哪个 Agent。
3. `tools.agentToAgent.enabled`
   - 是否开启 A2A 通讯。
4. `tools.agentToAgent.allow`
   - 哪些 Agent 允许进入 A2A 通讯网络。
5. `tools.sessions.visibility`
   - Agent 是否能看到其他 Agent 的会话。
6. `agents.list[x].subagents.allowAgents`
   - 某个 Agent 是否允许把任务 `spawn` 给其他 Agent。

### 2.3 仅改配置还不够，还需要指令层引导

文档里专门提到需要修改主 Agent 的 `AGENTS.md`，告诉它：

- 哪些 Agent 可用
- 每个 Agent 擅长什么
- 快速问题用 `sessions_send`
- 耗时任务用 `sessions_spawn`

这说明“通讯管理”不能只做配置写入，还要为协作提示词提供一个受控生成入口。

### 2.4 一部分设置是全局能力，一部分设置是 Agent 维度能力

全局能力：

- A2A 是否启用
- 通讯白名单
- 会话可见性

Agent 维度能力：

- 某个 Agent 的职责描述
- 某个 Agent 能把任务派给谁
- 某个 Agent 在协作说明中的展示名称和专长

这意味着 UI 上不能把所有内容都塞进当前单个 Agent 的弹窗里，否则结构会很乱。

## 3. 现状问题

结合当前实现，`Agents` 页面主要有以下问题：

### 3.1 页面模型偏“单体 Agent 设置”

当前页面结构本质是：

- 列表展示 Agent 卡片
- 点设置后弹出一个 Agent 详情弹窗

这个模型适合编辑单个 Agent 的基础字段，但不适合处理“Agent 与 Agent 的关系型配置”。

### 3.2 缺少通讯网络的全局视角

用户看不到：

- 多 Agent 协作是否真的已启用
- 现在有哪些 Agent 在协作网络里
- 哪些 Agent 只是存在，但并未加入通讯网络
- 哪个 Agent 可以找谁协作

### 3.3 路由与通讯关系没有分层表达

当前 `Agents` 页面只读显示“频道归属”，但没有把两类关系分开：

- 外部路由关系：频道账号 -> Agent
- 内部协作关系：Agent -> Agent

用户很容易误以为绑定了频道就等于配置好了多 Agent 协作，实际上不是。

### 3.4 没有“配置已就绪 / 未就绪”的状态判断

多 Agent 能否工作，依赖很多前置条件。比如：

- A2A 开关是否打开
- `tools.sessions.visibility` 是否为 `all`
- `tools.agentToAgent.allow` 是否包含目标 Agent
- 主 Agent 是否允许 `spawn` 到其他 Agent
- 协作说明是否已同步到 `AGENTS.md`

当前界面完全没有“健康度 / 缺失项”的反馈。

### 3.5 当前弹窗承载不了未来复杂度

如果继续沿用现在的设置弹窗，再往里塞：

- A2A 开关
- Agent 白名单
- 派发目标
- 通讯说明
- AGENTS.md 预览

就会迅速变成一个过长、过深、难以横向理解关系的弹窗。

## 4. 设计目标

本次改造建议满足以下目标：

1. 让 `Agents` 页面成为多 Agent 协作的主入口，而不是单纯的 Agent 列表页。
2. 把“外部路由”和“内部通讯”清晰分层，避免用户混淆。
3. 所有真正影响 OpenClaw 运行的设置，都要能映射回真实配置项。
4. 无法直接映射到 OpenClaw 原生配置的内容，统一作为 ClawX 辅助元数据管理。
5. 页面风格继续遵循当前 ClawX 的 Switch 卡片风，不破坏整体视觉基调。
6. 第一阶段优先做可落地、可维护、可解释的 UI，不建议一开始上复杂节点图编辑器。

## 5. 总体改造建议

我建议把 `Agents` 页面从“列表 + 弹窗”重构为“总览 + 主从详情 + 通讯拓扑”的结构。

### 5.1 页面从单层列表升级为双视图

建议给 `Agents` 页面新增两个顶级视图：

1. `Agent 总览`
2. `通讯拓扑`

其中：

- `Agent 总览` 用来管理单个 Agent 的资料、模型、路由和协作设置。
- `通讯拓扑` 用来从全局视角查看谁能和谁通讯、谁能派发谁。

### 5.2 不建议继续以弹窗作为主编辑容器

建议改为：

- 左侧 Agent 列表
- 右侧固定详情面板

原因：

- 多 Agent 配置是高频来回切换的，弹窗反复打开关闭很割裂。
- 关系型设置需要同时参考其他 Agent，固定详情区更适合对照编辑。
- 未来如果要加 `AGENTS.md` 预览、通讯矩阵、配置诊断，也更容易扩展。

## 6. 页面信息架构

## 6.1 顶部页头区

保留现有标题和“刷新 / 添加 Agent”按钮，同时新增一排总览卡片。

建议新增 4 张摘要卡：

1. `Agent 数量`
   - 总 Agent 数
   - 已加入通讯网络的 Agent 数

2. `通讯状态`
   - A2A 已启用 / 未启用
   - 会话可见性状态

3. `派发关系`
   - 当前总共有多少条 `spawn` 派发关系
   - 是否存在没有可用协作目标的 Agent

4. `协作说明`
   - `AGENTS.md` 是否已同步
   - 是否存在未应用的改动

这一区域的作用是让用户一进页面先看到“多 Agent 协作有没有真正配置完整”。

## 6.2 顶部二级切换

在摘要卡下方增加一个轻量切换栏：

- `Agent 总览`
- `通讯拓扑`

视觉建议：

- 继续使用圆角胶囊按钮
- 白底 + 弱边框
- 激活项用主色填充或更明显的描边

## 6.3 Agent 总览视图

建议改成左右双栏。

### 左栏：Agent 列表

保留当前卡片风格，但每张卡片新增更强的状态标签：

- `默认`
- `已加入通讯`
- `可派发 2 个目标`
- `外部路由已绑定`
- `协作说明待同步`

每张卡片只展示摘要，不再承担完整编辑入口。

### 右栏：Agent 详情

右侧详情不再是一个大杂烩，而是改成 4 个 Tab：

1. `基础`
2. `外部路由`
3. `通讯管理`
4. `协作说明`

这样用户可以明确区分：

- 这个 Agent 自身是什么
- 它服务哪些外部入口
- 它能和哪些 Agent 协作
- ClawX 将怎样把这套配置落成提示词

## 6.4 通讯拓扑视图

这里不建议第一阶段直接做复杂的自由拖拽连线图，优先做一个“可读、可编辑、可验证”的关系矩阵。

建议结构：

- 顶部放全局通讯设置卡
- 下方放通讯矩阵 / 关系列表

推荐用“按源 Agent 分组”的卡片列表，而不是一上来做二维表格，因为二维表在 Agent 数量稍多时会非常拥挤。

示意结构：

```text
Main Agent
  可 A2A 通讯: main / coding / review
  可派发任务: coding / review

Coding Agent
  可 A2A 通讯: main / review
  可派发任务: 无

Review Agent
  可 A2A 通讯: main
  可派发任务: 无
```

如果后续 Agent 数量明显增加，再考虑升级为矩阵模式。

## 7. 每个模块应该承载什么

## 7.1 基础 Tab

这里保留并扩展当前已有能力：

- Agent 名称
- Agent ID
- 模型配置
- 工作区路径
- Agent 目录路径
- 是否默认 Agent

新增建议：

- `职责标题`
  - 例如：编码虾、审核虾、运维虾
  - 这不是 OpenClaw 原生配置，属于 ClawX 辅助元数据
- `专长描述`
  - 用于后续生成协作说明
- `推荐任务类型`
  - 例如：写代码 / 审代码 / 查问题 / 运维
  - 同样属于 ClawX 辅助元数据

原因：

文档里的协作说明需要“名字 + 擅长什么”，而这些信息当前并不在 `openclaw.json` 中。

## 7.2 外部路由 Tab

这里明确告诉用户：

> 这是“外部消息如何进入某个 Agent”，不是“Agent 与 Agent 如何协作”。

内容建议包括：

- 当前绑定的频道账号列表
- 默认账号标记
- 路由来源说明
- 跳转到 `Channels` 页面继续编辑的按钮

建议保持“只读 + 跳转”的策略，不在第一阶段把频道配置完整搬进 `Agents` 页，避免边界再次混乱。

## 7.3 通讯管理 Tab

这是本次改造的核心。

建议拆成 3 个卡片区。

### A. 参与通讯网络

字段：

- `加入多 Agent 通讯网络`
  - 作用：是否把该 Agent 纳入 `tools.agentToAgent.allow`
- `允许其他 Agent 看到其会话`
  - UI 上显示为状态说明，不建议真正做可选开关

这里需要特别注意：

当前 ClawX 已经在运行时整理逻辑中强制 `tools.sessions.visibility = "all"`，所以这个字段更适合作为：

- 只读状态
- 或“受系统托管”的锁定项

不建议提供一个用户可自由切换到 `self` / `private` 的开关，否则会与现有 ClawX 运行假设冲突。

### B. A2A 联系范围

字段：

- `可联系 Agent`
  - 多选
  - 语义：当前 Agent 可以通过 A2A 与哪些 Agent 进行同步联系

但这里要诚实处理一个实现事实：

- `tools.agentToAgent.allow` 是全局白名单，不是严格的“按源 Agent -> 目标 Agent”细粒度图。

所以第一阶段建议这样设计：

- UI 上保留“当前 Agent 计划联系哪些目标”的编辑体验
- 底层真实写入分两层：
  - 全局层：参与通讯网络的 Agent 统一收敛到 `tools.agentToAgent.allow`
  - Agent 层：当前 Agent 的目标列表主要用于生成协作说明和拓扑展示

也就是说：

- `是否加入网络` 是真实强约束
- `计划联系哪些 Agent` 在第一阶段更偏“协作编排元数据”

这样比伪装成底层已经具备逐边权限控制要更诚实。

### C. 任务派发范围

字段：

- `可派发任务到`
  - 多选
  - 对应 `agents.list[x].subagents.allowAgents`

这块是最适合做强映射的，因为它在 OpenClaw 配置里有明确落点。

建议交互：

- 如果未加入通讯网络，则默认不可配置派发目标
- 自动过滤掉自己
- 如果选中的目标未加入通讯网络，给出提示

## 7.4 协作说明 Tab

这个 Tab 负责把“配置”转成“可被 Agent 理解的说明”。

建议分成 3 块：

1. `系统托管说明`
   - 展示 ClawX 将写入 `AGENTS.md` 的受控片段预览

2. `同步状态`
   - 已同步
   - 未同步
   - 与当前页面配置不一致

3. `操作按钮`
   - `同步到 AGENTS.md`
   - `复制说明`
   - `查看主 Agent 说明`

### 为什么这个 Tab 必须存在

因为多 Agent 协作不仅要配 `openclaw.json`，还要教 Agent “何时找谁帮忙”。如果没有这一层，用户可能会误以为打开 A2A 就万事大吉，但主 Agent 实际仍不会主动找其他 Agent 干活。

## 8. 建议的全局通讯设置

在“通讯拓扑”视图顶部，建议新增一个全局通讯设置卡。

### 8.1 全局字段

1. `启用多 Agent 通讯`
   - 映射：`tools.agentToAgent.enabled`

2. `纳入通讯网络的 Agent`
   - 映射：`tools.agentToAgent.allow`
   - 建议默认强制包含 `main`

3. `会话可见性`
   - 映射：`tools.sessions.visibility`
   - 建议展示为锁定值 `all`
   - 旁边标注“ClawX 托管”

4. `协作说明同步策略`
   - 选项：手动同步 / 保存时自动同步
   - 这不是 OpenClaw 原生字段，属于 ClawX 本地偏好

### 8.2 为什么要把全局设置放在通讯拓扑，而不是 Settings

因为从用户心智上看：

- `Settings` 更像全局系统设置
- `Agents` 更像“我如何组织这支 Agent 团队”

多 Agent 通讯本质上是 Agent 团队编排能力，放在 `Agents` 页更符合任务心智，也方便与 Agent 列表和关系图联动。

## 9. 配置映射建议

建议把页面上的设置严格分成两类。

### 9.1 直接映射到 OpenClaw 的配置

| 页面字段 | 配置落点 | 说明 |
| --- | --- | --- |
| 启用多 Agent 通讯 | `tools.agentToAgent.enabled` | 全局开关 |
| 纳入通讯网络的 Agent | `tools.agentToAgent.allow` | 全局白名单 |
| 会话可见性 | `tools.sessions.visibility` | 建议锁定为 `all` |
| 可派发任务到 | `agents.list[x].subagents.allowAgents` | 每个 Agent 的派发目标 |
| Agent 名称 | `agents.list[x].name` | 已有能力 |
| Agent 模型覆盖 | `agents.list[x].model` | 已有能力 |

### 9.2 建议作为 ClawX 辅助元数据管理的字段

| 页面字段 | 建议存储位置 | 原因 |
| --- | --- | --- |
| 职责标题 | ClawX 本地元数据 | OpenClaw 无原生字段 |
| 专长描述 | ClawX 本地元数据 | 用于生成协作说明 |
| 推荐任务类型 | ClawX 本地元数据 | 偏提示词层能力 |
| 当前 Agent 计划联系哪些 Agent | ClawX 本地元数据 | OpenClaw 当前无逐边 A2A 权限模型 |
| 协作说明同步策略 | ClawX 本地元数据 | UI 偏好，不应污染 OpenClaw 配置 |
| 协作说明上次同步时间 | ClawX 本地元数据 | 状态跟踪 |

### 9.3 本地元数据的存储建议

不建议把这些展示型、引导型字段硬塞进 `openclaw.json`。

更建议增加 ClawX 自己的存储层，例如：

- `electron-store`
- 或一个独立的 ClawX 元数据 JSON

例如可以抽象成：

```json
{
  "agents": {
    "main": {
      "roleTitle": "主控虾",
      "specialties": ["任务编排", "结果汇总"],
      "preferredTargets": ["coding", "review"],
      "instructionSync": {
        "managed": true,
        "lastSyncedAt": 0
      }
    },
    "coding": {
      "roleTitle": "编码虾",
      "specialties": ["写代码", "调试", "技术问题"],
      "preferredTargets": []
    }
  },
  "communication": {
    "autoSyncInstructions": true
  }
}
```

## 10. AGENTS.md 的落地建议

这是本方案里非常关键的一环。

### 10.1 不要直接覆盖整份 `AGENTS.md`

用户很可能已经手写了自己的提示词内容，所以不能粗暴重写整份文件。

建议使用“托管区块”的方式写入，例如：

```markdown
<!-- CLAWX:BEGIN MULTI_AGENT -->
## 多 Agent 协作

你不是一个人在战斗！你可以找其他 Agent 帮忙。

### 可用的 Agent

| Agent ID | 名字 | 擅长什么 |
| --- | --- | --- |
| `coding` | 编码虾 | 写代码、调试、技术问题 |
| `review` | 审核虾 | 代码审查、方案评审、质量把关 |

### 怎么找它们

快速问答（几秒能回） -> 用 `sessions_send`

耗时任务（超过 30 秒） -> 用 `sessions_spawn`

### 注意事项

- 简单问题用 `sessions_send`
- 复杂任务用 `sessions_spawn`
- 收到结果后要总结给主人
- 不要同时找多个 Agent 做同一件事
<!-- CLAWX:END MULTI_AGENT -->
```

ClawX 只更新这个托管区块，其他用户手写内容保持不动。

### 10.2 哪些 Agent 需要同步协作说明

第一阶段建议：

- 必做：主 Agent
- 可选：加入通讯网络且承担路由枢纽角色的 Agent

不要第一阶段就对所有 Agent 都强制写入，避免引入过强的自动修改行为。

### 10.3 协作说明的生成来源

生成内容应来自：

- 当前加入通讯网络的 Agent
- 每个 Agent 的职责标题
- 每个 Agent 的专长描述
- 当前 Agent 的派发目标

这样用户在页面上改一处，配置和协作说明都能收敛。

## 11. 页面视觉与交互建议

## 11.1 整体风格

继续沿用当前 ClawX 已经确定的 Switch 卡片风：

- 纯白页面背景
- 大圆角卡片
- 弱边框
- 轻阴影
- 胶囊按钮

不建议为“通讯拓扑”单独引入深色画布、流程图编辑器风格或荧光连线风格，那会和当前 ClawX 页面体系割裂。

## 11.2 Agent 卡片新增视觉元素

每张 Agent 卡片建议增加：

- 角色标签
- 通讯状态 badge
- 派发目标数 badge
- 外部路由 badge

例如：

```text
[Main Agent] [默认] [已加入通讯] [可派发 2]
claude-opus-4.6（继承）
频道: Feishu · 主账号
角色: 主控虾
```

这样即使不点进去，也能快速看出这只 Agent 在团队里的位置。

## 11.3 通讯关系的视觉表达

第一阶段建议用以下轻量方式表达关系：

- 目标 Agent 使用胶囊 Chip 展示
- “可派发任务到”与“可联系 Agent”分两行展示
- 对未加入通讯网络的目标，用灰态或警告文案提示

不建议第一阶段做：

- 可拖拽连线图
- 力导向图
- 复杂节点编辑器

原因是这类交互开发成本高，但真实配置落点依然是结构化 JSON，不值得过早复杂化。

## 12. 前后端实现建议

## 12.1 Renderer 层

建议调整 / 新增以下模块：

- `src/pages/Agents/index.tsx`
  - 从列表 + 弹窗改为总览页 + 详情区
- `src/stores/agents.ts`
  - 扩展通讯相关状态和保存方法
- `src/types/agent.ts`
  - 增加通讯快照类型
- `src/i18n/locales/*/agents.json`
  - 增加通讯管理文案

建议新增组件：

- `src/pages/Agents/AgentsOverview.tsx`
- `src/pages/Agents/AgentDetailPanel.tsx`
- `src/pages/Agents/AgentCommunicationTab.tsx`
- `src/pages/Agents/CommunicationTopologyView.tsx`
- `src/pages/Agents/InstructionPreviewCard.tsx`

## 12.2 Host API / Main 层

建议扩展：

- `electron/api/routes/agents.ts`
- `electron/utils/agent-config.ts`

并新增一个更明确的通讯配置工具模块，例如：

- `electron/utils/agent-communication.ts`

职责：

- 读写 `tools.agentToAgent.enabled`
- 读写 `tools.agentToAgent.allow`
- 读写 `agents.list[x].subagents.allowAgents`
- 生成通讯快照
- 校验协作配置是否完整
- 维护 `AGENTS.md` 托管区块

## 12.3 API 形状建议

建议不要把所有请求都拆成很多零散接口，而是优先提供一个聚合快照接口。

例如：

### GET `/api/agents`

在当前 Agent 列表快照基础上扩展：

```json
{
  "agents": [],
  "defaultAgentId": "main",
  "defaultModelRef": "openrouter/anthropic/claude-opus-4.6",
  "communication": {
    "enabled": true,
    "visibility": "all",
    "allowedAgents": ["main", "coding", "review"],
    "instructionSyncStatus": "outdated"
  }
}
```

### PUT `/api/agents/communication`

用于保存全局通讯配置：

```json
{
  "enabled": true,
  "allowedAgents": ["main", "coding", "review"]
}
```

### PUT `/api/agents/:id/communication`

用于保存某个 Agent 的通讯配置：

```json
{
  "spawnTargets": ["coding", "review"],
  "preferredTargets": ["coding", "review"],
  "roleTitle": "主控虾",
  "specialties": ["任务拆分", "结果汇总"]
}
```

### POST `/api/agents/:id/instructions/sync`

用于同步托管的协作说明到 `AGENTS.md`。

## 13. 状态诊断与防呆建议

多 Agent 通讯很容易“表面上配了，实际上跑不通”，所以页面里最好内置配置诊断。

建议至少检测以下规则：

1. A2A 未启用，但有 Agent 配置了派发目标
2. `main` 不在通讯白名单中
3. 某 Agent 配置了派发目标，但目标 Agent 未加入通讯网络
4. 协作说明尚未同步
5. `tools.sessions.visibility` 不是 `all`

并用统一的状态区展示：

- `已就绪`
- `部分缺失`
- `配置冲突`

这样比单纯依赖报错 toast 更容易让用户理解问题出在哪。

## 14. 为什么不建议把所有能力都塞进 Channels 页面

虽然 `bindings` 和外部机器人账号很重要，但它们解决的是：

> “消息从哪里进来，交给哪个 Agent”

而多 Agent 通讯管理解决的是：

> “Agent 收到任务后，能否把任务交给其他 Agent”

这是两层完全不同的问题。

因此建议坚持边界：

- `Channels` 页负责外部入口配置
- `Agents` 页负责 Agent 团队结构与协作编排

`Agents` 页只显示频道摘要并提供跳转，不重复承担完整频道配置。

## 15. 推荐实施顺序

建议按 4 个阶段推进。

### 阶段一：数据层补齐

- 扩展 agent snapshot
- 增加通讯配置读写
- 增加协作诊断能力

### 阶段二：页面结构升级

- `Agents` 页从弹窗改为主从详情
- 增加摘要卡和顶级视图切换
- 增加 `通讯管理` Tab

### 阶段三：协作说明托管

- 生成 `AGENTS.md` 托管区块
- 增加预览、同步、差异状态

### 阶段四：体验完善

- 增加通讯拓扑视图
- 增加配置冲突提示
- 增加更细的状态 badge 和引导文案

## 16. 测试建议

如果后续按本文档实现，建议至少补以下测试：

- `tests/unit/agents-page.test.tsx`
  - 新增通讯设置渲染和保存测试
- `tests/unit/agents-routes.test.ts`
  - 新增通讯配置接口测试
- `tests/unit/agent-config.test.ts`
  - 新增 `tools.agentToAgent` 与 `subagents.allowAgents` 的配置读写测试
- Electron E2E
  - 覆盖 `Agents` 页面切换、编辑、保存、同步说明

## 17. 最终建议结论

我的建议总结如下：

1. `Agents` 页面应该升级成多 Agent 编排中心，而不是继续停留在“单 Agent 设置页”。
2. 页面结构应从“列表 + 弹窗”改成“总览 + 详情 + 通讯拓扑”。
3. 真实配置项必须映射到：
   - `tools.agentToAgent.enabled`
   - `tools.agentToAgent.allow`
   - `tools.sessions.visibility`
   - `agents.list[x].subagents.allowAgents`
4. 职责名称、专长、推荐联系目标等应作为 ClawX 辅助元数据维护，不要污染 `openclaw.json`。
5. `AGENTS.md` 必须纳入设计，因为多 Agent 协作不仅是配置问题，也是提示词编排问题。
6. 第一阶段不建议直接做复杂图编辑器，先用结构化卡片和关系列表把功能做实、做稳。

## 18. 推荐落地文件

本文档建议保存为：

- `doc/ClawX-Agents-多Agent通讯管理改造方案.md`

后续如果你要继续推进实现，我建议就按这份方案拆成：

1. 数据结构和 Host API
2. `Agents` 页面重构
3. `AGENTS.md` 托管同步
4. 测试与文档收尾

