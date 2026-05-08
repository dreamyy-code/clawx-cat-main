# ClawX "Switch 风格" UI 改造实施计划

## 1. 目标与视觉规范
根据提供的设计参考，本次改造旨在将 ClawX 的管理界面全面替换为类似 Switch 的现代化卡片风格。

### 核心视觉特征：
- **页面背景**: 采用浅灰/暖白底色（如 `bg-gray-50` 或 `bg-zinc-50` / 暗色模式下对应调整），不再使用纯白。
- **卡片设计**: 纯白背景（`bg-white` / 暗色模式下 `bg-zinc-900`），大圆角（`rounded-2xl` 或 `rounded-3xl`），极弱的边框（`border-transparent` 或 `border-black/5`）和柔和的阴影（`shadow-sm`）。
- **侧边栏**: 移除生硬的分割线，背景色与主页面底色融合或略深。导航项采用胶囊状或大圆角矩形（`rounded-xl` 或 `rounded-full`），悬停和激活态背景更柔和。
- **排版与间距**: 增加卡片内外的留白（padding/margin），内容居中或有最大宽度限制，避免全屏拉伸。

## 2. 改造范围与具体页面

### 2.1 全局布局与侧边栏 (`src/components/layout/Sidebar.tsx` & `src/App.tsx`)
- **主容器**: 设定全局背景色为卡片风格底色。
- **Sidebar**:
  - 移除右侧边框（`border-r`）。
  - 修改导航项（Nav items）的悬停/激活样式，使用 `rounded-xl`，激活态使用 `bg-white shadow-sm` 或浅色背景凸显。
  - 调整字体大小和图标间距，使其更轻量。

### 2.2 模型页 (`src/pages/Models/index.tsx`)
- 将整个页面的内容区域包裹在一个或多个大圆角白底卡片中。
- 移除原有的硬边框，改用背景色区分层次。
- 模型选择器和列表项使用 `rounded-xl`，悬停时出现浅色背景反馈。

### 2.3 Agents 页 (`src/pages/Agents/index.tsx`)
- 将顶部的“新建”按钮和搜索框区域独立或融入主背景。
- Agent 列表改为卡片网格（Grid）或列表布局，每个 Agent 是一张独立的 `rounded-2xl` 白底卡片。
- 卡片内部布局优化，突出头像、名称和描述。

### 2.4 频道页 (`src/pages/Channels/index.tsx`)
- 类似 Agents 页，已连接的频道显示为独立卡片。
- 未连接频道的“网格”改为更现代的卡片按钮，悬停时带有轻微上浮或阴影变化。

### 2.5 技能页 (`src/pages/Skills/index.tsx`)
- 技能列表放置在一个统一的白色大卡片中，或者每个技能独立成卡。
- 列表项（List items）移除底边框，改为悬停时整行背景变色（`hover:bg-gray-50`），并增加圆角。

### 2.6 定时任务页 (`src/pages/Cron/index.tsx`)
- 任务列表项采用独立卡片设计，包含任务状态、触发词和时间规则。
- 统一卡片的内外边距。

### 2.7 弹窗与对话框 (Modals/Dialogs)
涉及文件如 `ChannelConfigModal.tsx`, `SwitchAddProviderDialog.tsx`, 及各页面内的编辑弹窗。
- **容器 (DialogContent)**: 统一使用 `rounded-3xl`，去除多余的边框，增加阴影。
- **表单与按钮**: 输入框使用 `rounded-xl` 浅色背景，主操作按钮使用 `rounded-full` 或 `rounded-xl`。

## 3. 实施步骤
1. **全局样式基础设置**: 调整全局 CSS 变量或 Tailwind 类，设定底色和卡片基础类。
2. **侧边栏改造**: 优先完成导航菜单的视觉升级，确立整体基调。
3. **分页面改造**: 依次处理 Models, Agents, Channels, Skills, Cron 页面，将内容包裹进新样式的卡片中。
4. **弹窗改造**: 遍历所有相关弹窗，统一圆角和阴影规范。
5. **细节打磨**: 检查暗色模式（Dark Mode）下的适配，确保文字对比度和卡片可见性。