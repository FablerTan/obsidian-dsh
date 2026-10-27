---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: src/settings, styles.css, docs
issue: 设置页 9 项平铺在一页、越加越长；参考截图改成顶部 tab 按模块拆分（服务 / dsh 版本 / 聊天 / 集成）
---

# 0027 设置面板按模块拆分成顶部 tab

> 对应路线图 [R-10](../roadmap.md#需求待办)。本提案只做调研与路径对比，**选路前不改代码**。

## 1. 背景与问题

### 现状

设置页只有 [src/settings/tab.ts](../../src/settings/tab.ts) 一个文件（219 行），`display()` 一次性平铺全部内容：

```text
h2  DSH in Obsidian（一句说明）
  ├ 端口
  ├ Profile
  ├ dsh 版本（下拉 + 重新检测）
  ├ 自动启动服务
  ├ 流式刷新
  ├ 重启服务
  ├ h3 运行环境
  │   ├ 当前 dsh
  │   └ 发现其他版本的 dsh
  └ h3 Obsidian 集成
      ├ 项目目录
      ├ 桥接状态（+ 重新检测）
      └ 安装提示（dsh-obsidian-bridge）
```

### 用户诉求

用户给出参考截图（某插件的「增强编辑」设置页）：**顶部一排 tab（编辑增强 / 自动格式化 / 内置规则 / 自定义规则 / 其他设置）**，
内容区只显示当前模块的设置项；要求本插件照此把设置面板「按模块拆分开，不要平铺在一个页面」。

### 具体问题

1. **扫读成本高**：找一个项要通读整页；「端口」和「桥接状态」这种不相关的内容挤在同一列。
2. **打开设置页被异步探测阻塞**：`display()` 先 `await detectDshInstalls()`（locator 要探测多份 dsh 的版本）再渲染任何一行，
   探测慢时整页空白；而版本信息只有「dsh 版本 / 运行环境」两块需要。
3. **继续变长**：后续还会有新设置项（聊天侧 @ / 命令 / 圆环偏好、导出等），平铺只会越来越长。

### 约束（已查官方文档）

- `PluginSettingTab` 在 Obsidian 1.4.0 没有原生 tab API；声明式设置 API（`getSettingDefinitions()` / `page` 子页）
  要求 **Obsidian 1.13.0+**，本仓库 `minAppVersion` 是 1.4.0，且 [AGENTS.md](../../AGENTS.md) 规则 6 明确不引入 1.7.2+ 才有的 API。
- 参考文档：[Settings](https://docs.obsidian.md/Plugins/User+interface/Settings)、
  [PluginSettingTab](https://docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab)、
  [Migrate to declarative settings](https://docs.obsidian.md/Plugins/Guides/Migrate+to+declarative+settings)。

## 2. 目标与非目标

- 目标：
  - 设置页顶部一排 tab，按模块切换；默认打开「服务」；
  - 切 tab **只重绘内容区**，tab 条不重建、不闪烁；
  - 异步探测只在对应 tab 打开时执行（打开设置页不再被版本探测阻塞）；
  - 所有设置项的行为、文案、默认值、`data.json` 格式**完全不变**；
  - tab 条与内容样式跟随 Obsidian 主题（用主题变量，深色/浅色一致）。
- 非目标：
  - 不新增 / 删除 / 重命名任何设置项，不改 `DshPluginSettings` 字段；
  - 不引入运行时依赖，不用 Obsidian 1.13+ 的声明式设置 API（路径 D 单独讨论）；
  - 不做设置搜索、导入导出、模块间跳转；
  - 不动聊天面板 / 服务托管侧任何代码。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | `tab.ts` 只留 `DshSettingTab` + tab 条 + 调度；新增 `src/settings/sections/{service,runtime,chat,integration}.ts`，各导出 `renderXxx(el, ctx)`（`ctx = { host, app, isStale() }`）；tab 状态放实例字段 `activeTab`；切换时只 `contentEl.empty()` 后重绘内容；`styles.css` 加 `.dsh-settings-tabs` / `.dsh-settings-tab` 等（主题变量） | tab.ts 219 → 约 100 行；4 个新文件各 30~60 行；CSS 约 50 行 | 需手写 tab 条 CSS（低风险，样式类都带 `dsh-` 前缀）；异步 section 要保留 `renderSeq` 防旧结果覆盖；视觉与参考图最接近 | 推荐：改动局限在 settings 域，保留 1.4.0 兼容，顺手解决打开设置页的异步阻塞 |
| **B** | 复用 Obsidian 核心设置页的内部结构类：`containerEl.createDiv('vertical-tab-header')` + `vertical-tab-nav-item` + `vertical-tab-content-container`，左侧导航、右侧内容 | 仅 tab.ts（约 +40 行），可同时拆 section | 依赖**非公开 CSS 类名**，Obsidian 改版或主题可能破相；与参考图的顶部 tab 不一致；设置 modal 本身左侧已是导航，嵌套同款样式容易混 | 不推荐，除非明确想要「完全原生」的竖向导航外观 |
| **C** | 拆成多个 `PluginSettingTab`：`addSettingTab` 注册 4 个（DSH 服务 / DSH 版本 / DSH 聊天 / DSH 集成），每个类只渲染自己那块，host 由构造注入；`main.ts` 注册 4 次 | tab.ts 拆成 5 个文件；main.ts 改注册 | 零自定义 CSS、代码最直白；但设置侧栏会多出 4 条本插件条目（视觉噪音），没有参考图的 tab 条，跨模块要回侧栏再点 | 最省事，但和参考图不符 |
| **D** | 迁移到 Obsidian 1.13+ 声明式设置：`getSettingDefinitions()` 用 `type: 'group'` 分组、`type: 'page'` 子页（点入侧滑 + 返回）；异步部分（版本下拉 / 桥接状态 / 重启）改 `SettingPage` + `display()`；`minAppVersion` 从 1.4.0 提到 1.13.0（三处版本一致） | 重写整个设置页 + manifest / versions / package 版本策略 | 获得原生分组、子页、**全局设置搜索**，零自定义 CSS；但放弃 Obsidian < 1.13 用户（本机 1.14.5 不受影响），且与 AGENTS 规则 6 冲突（要同时改规则）；子页是「点入 + 返回」，不是参考图的顶部 tab 条 | 长期最「原生」，但代价是兼容底线；只在愿意抬 `minAppVersion` 时选 |

**推荐 A**：与参考图形态一致（顶部 tab）、改动面可控（settings 域 + 一段 CSS），并保留现有兼容底线；
版本探测按需触发后，设置页打开速度也会变快。B/C/D 作为备选，取舍见上表。

## 4. 模块划分（路径 A/B/C 通用）

| tab | 内容 | 说明 |
|---|---|---|
| **服务** | 端口 / Profile / 自动启动服务 / 重启服务 | 默认打开 |
| **dsh 版本** | dsh 版本下拉 + 重新检测 / 当前 dsh / 发现其他版本的 dsh | 异步探测**只在本 tab 打开时**执行 |
| **聊天** | 流式刷新（逐字 / 每帧 / 平衡 / 省电） | 后续 @ 文件 / 命令 / 圆环等偏好都归这里 |
| **集成** | 项目目录 / 桥接状态 + 重新检测 / 安装提示 | 异步检测桥 |

> 备选 3 tab 版：把「dsh 版本」并入「服务」（见 §9 拍板项）。4 tab 的理由是「异步探测单独一页」，
> 打开设置页与改端口/重启都不再等探测。

## 5. 改动清单（按路径 A 预估）

| 文件 | 改动 |
|---|---|
| `src/settings/tab.ts` | 保留 `DshSettingTab` / `SettingsHost`；新增 tab 条、`activeTab` 与 `renderSection()` 调度；`display()` 只建骨架 |
| `src/settings/sections/service.ts` | 端口 / Profile / 自动启动 / 重启（从 tab.ts 原样搬运） |
| `src/settings/sections/runtime.ts` | dsh 版本下拉 + 重新检测 + 运行环境（异步） |
| `src/settings/sections/chat.ts` | 流式刷新 |
| `src/settings/sections/integration.ts` | 项目目录 / 桥接状态 / 安装提示；`describeBridgeStatus` 搬入 |
| `styles.css` | `.dsh-settings-tabs` / `.dsh-settings-tab` / `.dsh-settings-tab.is-active`（主题变量，不用硬编码颜色） |
| `docs/development.md` | 改动地图「新增设置项」一行改为 `settings/sections/<模块>.ts` |
| `docs/changes/0027-*` | 状态与实施记录 |
| `main.js` | `npm run build` 重新生成（不手改） |

## 6. 行为变化

- 设置页顶部出现 4 个 tab，默认「服务」；点击切换只重绘内容区，tab 条与滚动位置不跳。
- 打开设置页不再等待 dsh 版本探测；切到「dsh 版本」tab 时首次显示短暂「正在检测版本…」。
- 版本下拉、重启按钮、桥接状态检测的文案与行为不变；设置值、默认值、`data.json` 结构不变。
- tab 记忆：默认**不记住**（重开设置页回到「服务」）。若要记住需在 `schema.ts` 增字段并落盘（见 §9）。

## 7. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| tab 条样式与主题不协调 | 观感 | 样式全在 `.dsh-settings-*` 命名空间内，删掉即回到单页；只用主题变量 |
| 异步竞态（快速切 tab / 连点重新检测） | 旧结果覆盖新页面 | 保留 `renderSeq`，切 tab 也递增；section 渲染前 `isStale()` 检查 |
| 拆分时改文案 / 顺序 | 用户可见回归 | 纯搬运，逐项对比原文案；`git diff` 审阅 + `npm run check` |
| 窄窗口下 tab 挤成两行 | 布局 | tab 条 `flex-wrap: wrap`；本插件仅桌面端，无移动端分支 |

## 8. 验证

自动化：

```bash
npm run build
npm run check
```

手动（Obsidian 内）：

1. 打开设置页 → 顶部 4 个 tab 可点，默认「服务」，内容区只显示 4 项；
2. 逐 tab 检查项与文案，与原单页完全一致；切换不闪、不重复请求；
3. 改端口 / Profile / 自动启动 / 流式刷新 → 写入 `data.json`，行为与改动前一致；
4. 「dsh 版本」tab：重新检测可用，选中后「重启服务」生效，运行环境展示正确；
5. 「集成」tab：桥接状态能检测、可重新检测，安装提示完整；
6. 深色 / 浅色主题各看一遍，tab 条与内容无硬编码颜色；
7. 控制台无新增报错。

验收标准：

- 4 个 tab 都能切换，且每页只出现本模块设置项 ✅/❌
- 打开设置页不再因版本探测白屏（首屏立即出现 tab 条）✅/❌
- 所有设置项的读写结果与改动前一致（`data.json` diff 为空）✅/❌
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致 ✅/❌

## 9. 需要你拍板

- [x] **路径**：**A**（顶部 tab 条 + 分模块 section 文件）（2026-10-27）
- [x] **模块划分**：**4 个 tab**（服务 / dsh 版本 / 聊天 / 集成）（2026-10-27）
- [x] **外观**：**原生设置行**（只加 tab 条，不包圆角卡片）（2026-10-27）
- [x] **是否记住上次 tab**：**不记住**，每次打开设置页回到「服务」（2026-10-27）

## 10. 实施记录（2026-10-27）

用户选定：**路径 A**（顶部 tab 条 + 分 section 文件）/ **4 个 tab** / **原生设置行**（不包圆角卡片）/ **不记住上次 tab**。

### 实际改动

- `src/settings/tab.ts`：重写为「tab 条 + 内容区调度」。`display()` 只建 h2 / 说明 / tab 条 / 内容区；
  `selectSection()` 切 tab 只 `contentEl.empty()` 后重绘；每次渲染递增 `renderSeq`，`isStale()` 丢弃过期异步结果；
  `display()` 把 `activeSection` 重置为 `service`（不记忆）。
- `src/settings/context.ts`（新）：`SettingsHost` 接口从 tab.ts 迁出（`main.ts` 改从这里 import）+
  `SettingsRenderContext`（`host` / `app` / `isStale()` / `refresh()`），避免 sections ↔ tab 循环依赖。
- `src/settings/sections/{service,runtime,chat,integration}.ts`（新）：设置项按模块纯搬运；
  `describeBridgeStatus` 随桥接状态搬进 `integration.ts`。
- `styles.css`：新增 `.dsh-settings-tabs` / `.dsh-settings-tab` / `.is-active` / `:focus-visible`，
  只用主题变量（`--background-modifier-border` / `--background-modifier-hover` / `--text-accent` / `--interactive-accent` / `--radius-s` / `--font-ui-small` / `--font-medium` / `--line-height-tight`）。
- `docs/development.md`：文件职责表、改动地图（版本冲突 / 版本切换 / 流式刷新 / 新增设置项 / 新增模块 tab 一行）、手动回归 #39。
- `docs/architecture.md`：全景图、关注点表、`src/` 目录树补 `settings/context.ts` + `sections/`。
- `AGENTS.md`：`src/settings/` 目录行与源文件数（49 个 / 约 6900 行）。

### 与提案的偏差（均不改变设置项语义）

1. **跨 tab 文案微调**：「dsh 版本」「发现其他版本」的说明从「改完点『重启服务』生效」改成
   「改完在『服务』里点『重启服务』生效」（重启按钮已不在同页，否则指向不明）。
2. **版本 tab 加加载占位**：首次进入先显示「正在检测 dsh 版本…」，探测完替换（提案未写；避免内容区空白）。
3. **tab 条 CSS 选择器加段**：从 `.dsh-settings-tab` 改为 `.dsh-settings-tabs .dsh-settings-tab`——
   截图验证发现 Obsidian 的 `button:not(.clickable-icon)` 基础样式（`--interactive-normal` 底色）盖过了单类选择器，
   未加段时非活动 tab 显示为灰色方块。

### 验证（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 本仓库 0.4.1，CDP 实测）

- `npm run build` / `npm run check` 通过；`main.js` 与源码一致。
- 设置页出现 4 个 tab（服务 / dsh 版本 / 聊天 / 集成），默认「服务」；关闭再打开仍回到「服务」。
- 各 tab 内容与原单页逐项一致：服务 4 项、dsh 版本 3 项（下拉 + 当前 dsh + 其他版本）、聊天 1 项、集成 2 项 + 安装提示。
- 打开设置页立即出现 tab 条，不再等待版本探测；「dsh 版本」首帧显示「正在检测 dsh 版本…」，随后出现 3 行与下拉
  （检测到 0.2.1-rc.3 与 0.1.1-rc.2）。
- 竞态：点「dsh 版本」后 30ms 内切到「聊天」，2.5s 后内容区只有聊天项、无「运行环境」残留。
- 「重新检测」（版本 / 桥接状态）均可用；「重启服务」→ 运行环境显示 `confirmed`，状态栏回到 `DSH: 运行中`；
  重启后桥状态重新检测为「已连接（v5）」。
- 浅色 / 深色主题各看一次：活动 tab 为主色文字 + 主色下划线，非活动为 `--text-muted`，无硬编码颜色。
- 控制台无新增异常（仅既有 dsh 侧日志）。
