---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确指定要改的具体项（R-35）；按规则 12 例外直接执行并补记录
scope: src/view/native, src/shared, packages/dsh-obsidian-bridge, styles.css
issue: goal 命令加一个悬浮显示在输入框上方的窗口，样式参考 dsh 官方（目标条：goal 投影 + 暂停 / 恢复 / 编辑 / 清除，桥 v8）
---

# 0052 输入框上方的 dsh 同款目标条（goal bar，桥 v8）

> 对应路线图 [R-35](../roadmap.md#需求待办)。用户原话：「为 goal 命令添加一个悬浮显示的窗口，放在输入框上方，具体样式参考 dsh 官方。」
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 例外（用户当轮已明确指定要改的具体项）直接执行，并补提案记录：走路径 A。

## 1. 背景与问题

### 现状

0050 已经把 dsh 命令透传进原生面板的 `/` 菜单，`/goal` 能在面板里执行（带参 = 设置目标，不带参 = 读当前目标）。但执行结果只留在时间线的 command 节点文本里，**目标本身在面板里不可见、不可操作**：

- 当前会话有没有目标、目标正文是什么、处于哪个阶段（进行中 / 已暂停 / 受阻），原生面板完全不显示；
- 用户想暂停、恢复、改目标正文或清除目标，只能手敲 `/goal …` 命令并记住 dsh 的参数语义。

dsh 官方 Web GUI 有一个独立悬浮卡片 `GoalBar`（`packages/client/ui-goal/src/client/GoalBar.tsx`，slot `conversation.input.dock`），正好放在输入框上方：

| 官方事实 | 证据 |
|---|---|
| 结构：目标图标（官方 artwork）+ 阶段标签 + 单行省略的目标正文 + 右侧图标动作；36px 高、浮起卡片（半透明底 + blur + elevation 阴影） | `GoalBar.module.css`：`.bar` `height: 36px` / `box-shadow: var(--dsw-elevation-panel)` / `.bar::before` 半透明底 + `backdrop-filter`；`.iconBtn` 28px 圆形 |
| 阶段标签取自官方 zh 字典：`进行中的目标` / `已暂停的目标` / `受阻的目标`；**active 但进程内未 armed 也显示「已暂停的目标」** | `locales.ts` 的 `phase.active` / `phase.active.disarmed` / `phase.paused` / `phase.blocked`；`GoalBar.tsx` 的 `activeLabel()` |
| 动作：暂停（仅 active + armed）、恢复（paused，或 active + disarmed）、编辑（同一条内换成 InlineEditor）、清除；`pending` 时按钮禁用，失败在条内 `role="alert"` 显示 | `GoalBar.tsx` 的 `showResume` / `runAction` / `actionError` |
| 编辑态：自动聚焦的 textarea 随内容长高（最多 6 行后框内滚动），**Enter 保存、Shift+Enter 换行、组合输入不保存、Escape 取消** | `ui-primitives/src/InlineEditor.tsx` |
| 加载中（undefined）/ 无目标（null）/ `phase = complete` → 整条不渲染；目标创建在 `/goal` 命令里，不在条上 | `GoalBar.tsx` 文件头注释与 `if (… goal.phase === 'complete' …) return null` |

原生面板目前没有这个数据面：桥 v7（[0041](0041-subagent-support.md)）只有会话 / 流式 / 上下文 / 命令技能 / 团队 / 子智能体，`ping().methods` 里没有 `goal` / `goalAction`；[core-bridge.ts](../../src/view/native/core-bridge.ts) 也没有 goal 能力位与 DTO。

### 问题

1. dsh 的 goal 在原生面板里是「看不见的状态」：只有敲命令才知道有没有、是什么。
2. 暂停 / 恢复 / 编辑 / 清除这些日常操作没有入口，得记命令参数。
3. 用户明确要求「放在输入框上方、样式参考 dsh 官方」——即与官方 GoalBar 对齐，而不是折进时间线或通知行。

### 影响范围

只影响原生聊天面板的输入框上方区域与桥的数据面（新增两个只读 / 写目标的方法）。不影响消息流、时间线、`/` 菜单、技能、团队、子智能体、服务生命周期、设置页；不改 dsh 源码。

## 2. 目标与非目标

### 目标

- 原生聊天面板在**当前会话有目标**时，于输入框上方显示一条 dsh 官方 GoalBar 等价的目标条：
  - 左起：目标图标（官方 artwork）、阶段标签、单行省略的目标正文；
  - 右侧：28px 圆形图标动作（暂停 / 恢复 / 编辑 / 清除），`pending` 时禁用；
  - 视觉对齐官方：36px 单行条、半透明卡片底 + 20px blur + 主题阴影、圆角与描边走 Obsidian 主题变量。
- 阶段标签与官方 zh 文案一致：`进行中的目标` / `已暂停的目标` / `受阻的目标`；active 但进程内 activation 已是 `disarmed` 时也按「已暂停的目标」显示（官方口径；activation 未知时仍显示「进行中的目标」）。
- 受阻目标把 `blockedReason.message` 作为整条的 `title`（悬停可见），不额外占一行。
- 编辑：点「编辑」→ 条内换成自动聚焦的 textarea，随内容长高（6 行封顶后框内滚动）；**Enter 保存、Shift+Enter 换行、Escape 取消、IME 组合输入不误保存**。
- 操作失败在条内以 `role="alert"` 显示（不弹 Notice、不阻塞消息流）；操作成功后跟随投影刷新。
- 桥 v8 提供数据面：`goal()` 读会话 `goal` 投影（含按需读的进程内 activation），`goalAction(action, value?)` 走 `remote.goals` 的 `edit / pause / resume / clear`（CAS ref = 投影里的 `{ id, revision }`，业务失败以 `{ ok:false, error }` 返回、不抛错）。
- `subscribe()` 同时订阅 `goal` 投影与 `goal/activation-changed`，外部改目标（`/goal` 命令、其它窗口）时条自动跟随。
- 降级：桥 v7 / 没有 goal 插件 / 目标 complete / 会话无目标 → 不渲染目标条，其它功能照常。

### 非目标

- 不做目标创建 UI（新建目标仍在 `/goal <objective>` 命令里，与官方一致）；不做独立的目标编辑弹窗 / 历史列表。
- 不改 dsh 源码，不改官方 `ui-goal` 插件，不新增 dsh 命令。
- 不把目标条做进时间线、运行提示或通知行（官方是输入框上方独立卡片）。
- 不改 `/` 菜单、技能、团队、子智能体、设置页；不 bump 插件版本号。
- 不做目标「轮数进度」（`maxGoalRounds` / `roundsStarted`）的 UI —— 官方条上也没有；DTO 里带上只为将来需要。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）桥 v8 数据面 + 原生 React GoalBar** | 桥升 `VERSION 7 → 8`，新增 `goal()`（读 `goal` 投影 + `remote.goals.get` 拿 activation）与 `goalAction()`（`remote.goals.edit / pause / resume / clear`，CAS ref）；[core-bridge.ts](../../src/view/native/core-bridge.ts) 加能力位 / `supportsGoal()` / `goal()` / `goalAction()`；[native-types.ts](../../src/shared/native-types.ts) 加 `NativeGoal*` DTO；新增 [goal-bar.tsx](../../src/view/native/ui/goal-bar.tsx)（照官方 GoalBar / InlineEditor 的口径重写，图标用官方 artwork）+ `composer.tsx` 的 `goalBar` 槽 + `native-chat-root.tsx` 的状态与动作 + `styles.css` 新 `.dsh-native-goal-*` 块 | 桥 1 文件 + README、原生 4 文件、CSS，约 450 行 | 中等；与官方完整对齐（文案 / 阶段 / 编辑 / 动作 / 降级），回滚只删文件不动其它；代价是桥版本 +1，需要**重启 DSH 服务**才生效 | **推荐**：体验对齐官方、改动集中、可独立冒烟与回滚；符合项目「桥只做语义投影、显示在原生侧」的既有取舍 |
| B 只读条（不碰 `remote.goals`，无动作） | 桥只透出 `goal` 投影（id / revision / objective / phase / blockedReason），`VERSION 7 → 8`；原生条只显示图标 + 阶段 + 正文，暂停 / 恢复 / 编辑 / 清除继续靠手敲 `/goal` | 桥 1 文件（半个 v8）+ 原生 3 文件 + CSS | 比 A 少一层 RPC 与 activation 读取；但条上没有动作、拿不到 activation（active 永远显示「进行中的目标」，重启后其实已 disarmed），与官方不一致 | 不推荐：用户要的是「样式参考 dsh 官方」，只读条缺了右半边的动作与状态语义 |
| C 复用官方 `ui-goal` GoalBar（离屏 core 渲染 + 镜像） | 在隐藏的 core webview 里渲染官方 GoalBar，把 DOM / 截图镜像到原生面板 | 桥 + 镜像通道 + 原生渲染 | 零重写；但隐藏 core 自 0008 起是**纯数据源**（不承载可见 UI、也不接受驱动），交互控件无法从原生面板驱动，镜像只能看不能点 | 否掉：与 0008 的架构取舍冲突，镜像交互不可行 |
| D 复用运行提示 / 通知行打印目标状态 | 在现有 `run-status.tsx` 或 `composer-notice` 里加一行目标文本 | 原生 1 文件 | 最小；但不是独立悬浮窗口、不能放输入框上方（与运行提示抢位），也没有动作 | 否掉：不满足「悬浮窗口 + 参考官方」 |

> 结论：**A**。用户当轮已明确指定要改的具体项（「为 goal 命令添加一个悬浮显示的窗口，放在输入框上方，样式参考 dsh 官方」），按规则 12 例外视为已批准，直接执行。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [packages/dsh-obsidian-bridge/lib/client.js](../../packages/dsh-obsidian-bridge/lib/client.js) | `VERSION 7 → 8`、补丁头注释写 v8；新增 `goalPhase` / `goalActivation` / `goalCount` / `currentGoal` / `cachedActivation` / `refreshActivation` / `goal()` / `goalAction()`；`subscribe()` 投影键表补 `goal`，并订阅 `remote.$on('goal/activation-changed')`（只跟随当前会话，随订阅释放）；`remotes.goals` 用 `try/catch` 挂上（缺 goal 插件时为 null）；`ping().methods` 加 `goal` / `goalAction`；bridge 对象导出两个方法 |
| [packages/dsh-obsidian-bridge/README.md](../../packages/dsh-obsidian-bridge/README.md) | 升到 v8：方法清单、`goal()` / `goalAction()` 用法、`goal` 投影 + activation 事件、降级说明（v7 无目标条；缺 goal 插件时 `goalAction` 返回 `goal-unavailable`） |
| [src/shared/native-types.ts](../../src/shared/native-types.ts) | `NativeGoalPhase` / `NativeGoalBlockedReason` / `NativeGoal`（id / revision / objective / phase / blockedReason? / maxGoalRounds / roundsStarted / activation?）/ `NativeGoalError` / `NativeGoalActionResult` |
| [src/view/native/core-bridge.ts](../../src/view/native/core-bridge.ts) | `goalCapability`（`ping.methods` 同时含 `goal` 与 `goalAction`）、`supportsGoal()`、`goal()`、`goalAction(action, value?)`（无 value 时不传第二参） |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `goal` / `goalPending` / `goalError` 状态 + `goalRequestRef` 请求序号；`refreshGoal(id)`（旧桥 / 抛错 → 隐藏目标条，不阻塞消息流）；快照刷新与会话切换时刷新；`goalAction(action, value?)`（成功后 `refreshSnapshot()` 跟随投影，失败写 `goalError`）；`goalBar` 传给 `Composer` |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 新增 `goalBar: ReactNode` prop，0052 时渲染在运行提示**之上**（`.dsh-native-composer` 的第一个子节点）；**0054 起改为在运行提示之下**（顺序 `RunStatus` → `goalBar` → 输入卡） |
| [src/view/native/ui/goal-bar.tsx](../../src/view/native/ui/goal-bar.tsx)（新增） | `GoalBar`：官方 artwork 图标（目标 / 暂停 / 播放 / 编辑 / 垃圾桶 / 对勾 / 关闭）、`goalLabel()`（active + disarmed → 已暂停的目标）、单行省略正文、blockedReason 作 `title`、动作按阶段显隐、`pending` 禁用、`role="alert"` 错误、内联 textarea（ResizeObserver 长高、6 行封顶、Enter / Shift+Enter / Esc / IME 口径同官方 InlineEditor）、`goal.id` 变化丢弃本地编辑态、`phase === 'complete'` 返回 `null` |
| [styles.css](../../styles.css) | 新增 `.dsh-native-goal-*` 块（文件尾部）：36px 单行卡片、`::before` 半透明底（`color-mix 94%`）+ `backdrop-filter: blur(20px) saturate(140%)` + `--shadow-s` / `--background-modifier-border`、28px 圆形动作（压掉 Obsidian 按钮基础样式）、编辑态 `align-items: flex-end` + textarea 6 行封顶、错误行 `--text-error`；颜色与尺寸全部走主题变量 |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-35 登记与 0052 索引 |
| [docs/development.md](../development.md) / [README.md](../../README.md) | 改动地图、回归清单、桥版本引用（v7 → v8） |

不改 `/` 菜单与命令范围、不改 dsh 源码、不改插件版本号。

## 5. 行为变化

- 当前会话有目标（且 `phase !== 'complete'`）时，输入框上方出现目标条，0052 时位置在运行提示之上（**0054 起改为在运行提示（0047）之下**，紧贴输入卡）；无目标 / complete / 旧桥时不占位。
- 标签：`active + armed` → **进行中的目标**；`active + disarmed` 或 `phase = paused` → **已暂停的目标**；`blocked` → **受阻的目标**（整条 `title` = `blockedReason.message`）。
- 目标正文单行显示、超出省略号；条宽跟随输入框卡片。
- 右侧动作：
  - **暂停**只在 `active + armed` 出现；
  - **恢复**在 `paused`、或 `active + disarmed` 出现（服务重启后 active 目标会变 disarmed，正是官方行为）；
  - **编辑**把条内正文换成 textarea：Enter 保存、Shift+Enter 换行、Escape 取消、IME 组合期 Enter 不保存；空白内容不可保存；
  - **清除**清空当前目标，条随即消失。
- 动作执行中所有按钮禁用（防重复 CAS）；失败在条内以 `role="alert"` 显示桥返回的错误文案（例如 `goal-unavailable`）。
- 目标在别处变化（`/goal` 命令、其它窗口、自动完成）时，条自动跟随投影刷新；切换会话时按新会话重建，不留上一个会话的目标。
- `/` 菜单里的 `/goal` 行为不变（仍然是创建 / 读取目标的入口）；本改动只是让状态可见可操作。
- 桥为 v7（未重启服务）/ profile 没装 dsh goal 插件：不显示目标条（`supportsGoal()` 为 false / `goal()` 为 null），其它功能不受影响；此时 `goalAction` 会返回 `{ ok:false, error:{ code:'goal-unavailable' } }`。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| profile 没有 dsh 的 goal 插件（`remote.goals` 缺失） | `goal()` 仍返回投影 / null，`goalAction()` 返回 `goal-unavailable`；条上动作点了会显示错误 | 条本身隐藏或无动作可点，不崩；错误在条内提示；换回带 goal 插件的 profile 即恢复 |
| 桥 v8 需要**重启 DSH 服务**才生效 | 换代码后不重启，`ping().methods` 仍不含 goal → 面板没有目标条（没有任何报错） | 设置页「重启服务」或重载插件；桥已通过符号链接装在 profile `node_modules` 里，无需重新 link |
| 服务重启后 active 目标变 `disarmed` | 条显示「已暂停的目标」而不是「进行中的目标」 | 官方行为，点「恢复」即可 armed；不恢复也不影响目标持久状态 |
| activation 读失败（`remote.goals.get` 抛错 / 超时） | 只显示 durable phase，不显示暂停 / 恢复按钮 | 桥侧静默降级、下次目标变化再读；不影响与目标相关的其它功能 |
| CAS 冲突（目标在别处被改，`revision` 已过期） | 动作返回业务错误码 | 条内显示错误；下一次投影刷新跟随新 revision，重试即可 |
| 旧插件 + 新桥 | 老插件不调用新方法 | 无影响（桥只多两个方法） |
| 编辑态与目标身份错配 | 残留草稿按 Enter 写到新目标上 | 组件在 `goal.id` 变化时丢弃编辑态与草稿（官方同口径） |

整体回滚：revert 上述文件 → `npm run build` → 「重启 DSH 服务」。桥可单独回退到 v7（删 v8 段 + VERSION 改回 7），插件侧能力探测会自动隐藏目标条，不存在数据迁移。

## 7. 验证

自动化：

```bash
npm run build        # tsc -noEmit -skipLibCheck + esbuild
npm run check        # 版本 / 依赖 / 类型 / main.js 与源码一致 + 桥清单与语法
node --check packages/dsh-obsidian-bridge/lib/client.js
```

手动回归（Obsidian 内，CDP 或人工；需先重启服务让桥 v8 生效）：

1. 在原生输入框敲 `/goal <objective>` + Enter → 输入框上方出现目标条：目标图标 + 「进行中的目标」+ 单行目标正文，右侧 3 个图标动作（暂停 / 编辑 / 清除）。
2. 点「暂停」→ 条变成「已暂停的目标」，暂停按钮换成「恢复」；点「恢复」→ 回到「进行中的目标」。
3. 点「编辑」→ 正文变成 textarea：输入多行会随内容长高（6 行后框内滚动）；Shift+Enter 换行；Escape 取消且正文不变；Enter 保存后条上正文更新（含中文 IME 组合输入不误保存）。
4. 点「清除」→ 条消失；刷新 / 重开面板后仍不出现。
5. 重载原生面板 / 切换会话再切回 → 目标条按当前会话恢复（持久投影）；不同会话之间不串。
6. 让目标走完（`phase = complete`）→ 条消失；`blocked` 时悬停条能看到 `blockedReason` 文案、标签为「受阻的目标」。
7. 旧桥（v7，或 `ping().methods` 不含 `goal`）：面板完全看不到目标条，消息 / 流式 / 命令 / 团队 / 子智能体照常；设置页「桥接状态」显示实际版本。
8. profile 缺 goal 插件：目标条不出现；若强行触发动作，错误文案在条内 `role="alert"` 显示，不弹 Notice、不阻塞发送。

**验收标准**：

- 当前会话有目标时，输入框上方出现与 dsh 官方结构一致的目标条（阶段标签文案、单行省略正文、右侧图标动作、36px 半透明浮起卡片）；
- 暂停 / 恢复 / 编辑 / 清除四个动作都真的改到 dsh 侧目标（重开面板后状态一致），失败在条内可见；
- complete / 无目标 / 旧桥 / 缺 goal 插件都不渲染目标条，且不影响其它功能；
- `npm run build` / `npm run check` 通过，桥 `node --check` 通过，`main.js` 与源码一致。

## 8. 需要你拍板

- [x] **实现路径**：**A**（桥 v8 数据面 + 原生 React GoalBar，对齐官方 `ui-goal`）（2026-10-28，用户当轮明确指定该具体项）
- [x] **目标条位置**：输入框上方、运行提示（0047）之上（2026-10-28；**0054 起改为运行提示之下**，紧贴输入卡）
- [x] **目标正文配色**：用 `--text-muted`。官方用 `--dsw-alias-label-primary-dimmed`，Obsidian 没有一一对应的「primary-dimmed」token，取最接近的次要文字色（2026-10-28）
- [x] **目标创建入口**：仍在 dsh 的 `/goal` 命令，不做独立的「新建目标」UI（与官方一致）（2026-10-28）
- [ ] 请确认以上取舍可接受；若希望后续补「新建目标」对话框 / 独立编辑弹窗，另立需求（不在本提案范围内）

## 9. 实施记录

**落地（2026-10-28，路径 A）**：

- 桥升 v8：`goal()` 读 `goal` 投影并按需经 `remote.goals.get()` 补进程内 `activation`（同一 `{ id, revision }` 并发去重、事件 `goal/activation-changed` 跟随当前会话），`goalAction()` 走 `remote.goals.edit / pause / resume / clear` 的 CAS ref，失败一律 `{ ok:false, error }` 不抛错；`subscribe()` 投影键表补 `goal`；`ping().methods` 加两个方法。
- 原生侧新增 `GoalBar`（官方 artwork 图标、官方 zh 阶段文案、内联编辑同 InlineEditor 口径），挂在 `Composer` 的 `goalBar` 槽、位于运行提示之上（**0054 起改为运行提示之下**）；`native-chat-root` 持状态与动作，旧桥 / 无目标 / complete 都不渲染。
- `styles.css` 新增 `.dsh-native-goal-*` 块：36px 条、半透明底 + 20px blur + 主题阴影、28px 圆形动作、6 行编辑框封顶。

| 文件 | 实际改动 |
|---|---|
| [packages/dsh-obsidian-bridge/lib/client.js](../../packages/dsh-obsidian-bridge/lib/client.js) | `VERSION = 8`；`goal()` / `goalAction()` / activation 缓存与事件订阅 / `goal` 投影订阅 / `remotes.goals` 挂载 / `ping.methods` |
| [packages/dsh-obsidian-bridge/README.md](../../packages/dsh-obsidian-bridge/README.md) | v8 方法清单与目标条说明、降级与缺插件说明 |
| [src/shared/native-types.ts](../../src/shared/native-types.ts) | `NativeGoalPhase` / `NativeGoalBlockedReason` / `NativeGoal` / `NativeGoalError` / `NativeGoalActionResult` |
| [src/view/native/core-bridge.ts](../../src/view/native/core-bridge.ts) | `goalCapability` / `supportsGoal()` / `goal()` / `goalAction()` |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 目标状态、`refreshGoal`、`goalAction`、`goalBar` 接线 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | `goalBar` 槽（0052 时在运行提示之上；**0054 起在运行提示之下**） |
| [src/view/native/ui/goal-bar.tsx](../../src/view/native/ui/goal-bar.tsx)（新增） | `GoalBar` 组件与官方图标、编辑态、动作、错误行 |
| [styles.css](../../styles.css) | `.dsh-native-goal-*`（条 / 图标 / 标签 / 正文 / 错误 / 动作 / 编辑态 / 编辑框） |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-35 / 0052 登记 |
| [docs/development.md](../development.md) / [README.md](../../README.md) | 改动地图、回归清单、桥版本引用 |

**与提案的偏差**：无（按路径 A 与第 8 节已列取舍执行）。

**验证结果（2026-10-28）**：

- 自动化：`npm run build` 通过（tsc -noEmit -skipLibCheck + esbuild，`main.js` 重新生成 323.5kb）；`npm run check` 通过（版本三处一致 / 无运行时依赖 / tsc / 桥清单与语法 / `main.js` 与源码一致）；`node --check packages/dsh-obsidian-bridge/lib/client.js` 通过。
- 隐藏 core（端口 3088）：`ping()` 返回 `version: 8`，`methods` 含 `goal` / `goalAction`。
- **CDP 实测**（真实 Obsidian 桌面，原生面板）：
  - 在原生输入框用 `/goal` 设置测试目标 → 悬浮目标条出现在输入框上方（36px 高、与输入卡片同宽、悬浮底 + 圆角 + 阴影），标签「进行中的目标」、目标正文单行省略，右侧动作＝暂停 / 编辑 / 清除；渲染位置在「深度求索中」运行提示**之上**（0054 起改为运行提示之下）。
  - 暂停 → 标签「已暂停的目标」、动作变 恢复 / 编辑 / 清除，桥侧 `phase=paused` 且 revision +1；恢复 → 回到「进行中的目标」+ 暂停按钮。
  - 编辑 → 条内出现自适应 textarea（焦点在框内），改文案后 Enter 保存 → 目标正文更新、桥侧 `objective` 同步（revision 4）；失败路径为条内 `role="alert"` 错误。
  - 重启 DSH 服务 + 重载插件后重开同一会话 → 标签「已暂停的目标」、动作 恢复 / 编辑 / 清除（`activation=disarmed`，与官方口径一致）；点恢复回到进行中。
  - 切到另一个会话能看到该会话自己的目标（目标条按会话隔离、不串）；清除 → 目标条立即消失、桥 `goal()` 返回 `null`，输入框正常。
- 未强制验证：`phase=complete`（组件里直接 `return null`）与 `blocked` 标签，属同一处静态分支。

**已知遗留**：`/goal` 命令的回显在时间线里仍走通用 `UnknownNode`（虚线框显示 `command-input` / `turn-trigger`），属于既有的时间线渲染缺口，不在 0052 范围（另立需求再处理）。

**2026-10-28 追补（0053）**：目标条改为**主题实色卡片**，移除 `backdrop-filter` / `isolation` 伪元素底（Obsidian 窗口闪烁问题），原因与验证见 [0053](0053-goal-bar-flicker.md)。

**2026-10-28 追补（0054）**：目标条改到**运行提示下方**（composer 渲染顺序 `RunStatus` → `goalBar` → 输入卡），避免被每轮运行提示顶动，见 [0054](0054-goal-bar-below-run-status.md)。
