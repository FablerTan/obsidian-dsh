---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户反馈的 BUG，按规则 12 例外（用户当轮明确指定要修的具体项）直接修复并补记录
scope: styles.css, src/view/native/ui
issue: goal 目标条在 Obsidian 里持续闪烁 / 残影：半透明模糊底 + 每轮运行提示位移导致窗口反复重合成
---

# 0053 goal 目标条在 Obsidian 里持续闪烁（去掉 backdrop-filter，改实色卡片）

> 对应路线图 [R-36](../roadmap.md#需求待办)。用户原话：「使用 goal 后 Obsidian 窗口一直闪烁」，附截图里目标条出现两份：上方「进行中的目标」半透明残影 + 下方「已暂停的目标」实条。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 例外（用户当轮明确指定要修的具体项）直接执行并补提案记录。
> 本提案替换 [0052](0052-goal-bar.md) 目标条的**视觉实现**（半透明模糊底 → 主题实色卡片），0052 的数据面与行为不变。

## 1. 背景与问题

### 现象

用户反馈：**使用 goal 后 Obsidian 窗口一直闪烁**。截图里同一条目标条出现两份——上方是「进行中的目标」的半透明残影，下方是「已暂停的目标」的实条，两帧叠在同一个画面里。

特征：

- 只在**有 goal**（goal 自动续跑、每轮都会跑）时出现，普通聊天 / 命令不会；
- 是**持续**闪烁，不是切换会话或点动作时闪一下；
- 截图能同时抓到「旧帧残影 + 新帧实条」——说明是**合成 / 呈现（presentation）级**的问题，不是 DOM 里挂了两条。

### 排查结论

目标条在 [0052](0052-goal-bar.md) 里按 dsh 官方 GoalBar 的做法实现：

| 官方做法 | 我们当时的对应写法 |
|---|---|
| 半透明菜单底 + 模糊 | `::before` 伪元素：`color-mix(in srgb, var(--background-primary) 94%, transparent)` + `backdrop-filter: blur(20px) saturate(140%)` |
| 为负 z-index 伪元素建层叠上下文 | 条上 `isolation: isolate`，伪元素 `z-index: -1` |

在 Obsidian（Electron 窗口）里，这套组合有两个放大因素：

1. `backdrop-filter` 要求窗口对「背后内容」重新采样，并让目标条成为**独立合成层**；负 z-index 伪元素又依赖 `isolation` 固定层叠顺序。目标条位于**输入框上方、运行提示旁边**，goal 自动续跑时运行提示（0047 / 0048）每轮开关，目标条被上下顶动、重绘区域随每轮变化。
2. 位移 + 重新采样叠加后，Electron 窗口反复做整窗重合成，旧帧以残影形式留在窗口里——看起来就是持续闪烁，截图里就是「残影 + 实条」两份。

### 影响范围

只影响原生聊天面板在**有 goal** 时的观感。目标数据与动作本身正确：暂停 / 恢复 / 编辑 / 清除、阶段标签、按会话隔离都正常（0052 已 CDP 实测）。不改后台数据、不影响消息流与其它功能。

## 2. 目标与非目标

### 目标

- 移除目标条在 Obsidian 里持续重新合成的来源：不再用 `backdrop-filter`，也不再用 `isolation` + 负 z-index 伪元素做半透明底；卡片底改成**主题实色** + 1px 描边 + 阴影，视觉上仍是一张 36px 单行悬浮卡片。
- 固定条高（编辑态例外），减少布局抖动。
- 目标数据没变时不重渲染：快照每轮刷新时对目标做深度比较，相同就复用旧对象（`sameGoal`），避免目标条跟着整棵树重新挂载 / 重绘。
- 在 `styles.css` 的目标条注释里写明「为什么不能用 backdrop-filter（R-36）」，防止后来者照官方样式改回去。

### 非目标

- 不改 dsh 官方 `ui-goal` 的 GoalBar，也不改 0052 的条位置 / 结构 / 动作 / 编辑 / 降级行为。
- 不改运行提示（0047 / 0048）的位置与默认（备选路径 C 不采用）。
- 不为这个问题加全局 GPU / Obsidian 启动参数开关，也不动桥协议与版本号。
- 不把「所有可能的合成问题」一次性排查完：运行提示扫光（0049）等其它合成分层若仍有问题，另立需求。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）去掉模糊底 + 稳态化** | [styles.css](../../styles.css) 目标条：删掉 `isolation` / `::before` 半透明底 / `backdrop-filter`，改 `background: var(--background-primary)` + `1px solid var(--background-modifier-border)` + `var(--shadow-s)` + `var(--radius-m)`，固定 `height: 36px`（编辑态仍可长高）；[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) 增加 `sameGoal()` 深度比较，数据没变不 `setState` | CSS 目标条块 + root 一个纯函数与一处 `setGoal`，约 30 行 | 低；代价是失去半透明模糊底（与官方 36px 条有细微视觉差异，但主题实色卡片反而更贴 Obsidian 的输入卡片）；回滚只需还原两处 | **推荐**：直接移除唯一会触发整窗重新采样的合成源，同时减少不必要的重渲染；不改变任何行为语义 |
| B 保留 blur，强制独立合成层 | 仍用 `backdrop-filter`，但给条加 `will-change: transform` / `transform: translateZ(0)` / `contain: paint`，把模糊限制在条自己的层里 | 仅 CSS 1–2 行 | 中等偏高；不同 Chromium / Electron 版本行为不一，可能把「整窗闪烁」变成「条自身闪烁」或引入新的 compositing 问题；**没有解决**「每轮位移 → 旧帧残留」的根因 | 不推荐：赌渲染器行为，且现象不可用截图稳定验证 |
| C 不动样式，改布局避免位移 | 把运行提示改成 flow 档、或给目标条 / 运行提示预留固定高度，避免每轮顶动目标条（可配合 0048 的位置设置） | 0047 / 0048 的默认与 composer 布局 | 较大；改变既有默认与用户设置语义，且半透明 + blur 的合成开销仍在，只是减少位移频率 | 不推荐：改的是别的特性的默认行为，收益不确定 |

> 结论：**A**。用户当轮明确反馈了这个 BUG，按规则 12 例外直接修复。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [styles.css](../../styles.css) | 目标条 `.dsh-native-goal-strip`：删除 `isolation: isolate` 与 `::before` 半透明模糊底（`background: color-mix(…, transparent)` + `backdrop-filter: blur(20px) saturate(140%)`）；改为 `background: var(--background-primary)` + `border: 1px solid var(--background-modifier-border)` + `box-shadow: var(--shadow-s)` + `border-radius: var(--radius-m)`；固定 `height: 36px`（编辑态 `is-editing` 仍 `height: auto` + `min-height: 36px`）；块首注释补 R-36 的原因说明 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 新增 `sameGoal(left, right)`：比较 `id` / `revision` / `objective` / `phase` / `activation` / `blockedReason.code` / `blockedReason.message`（两边都 null 才算相同）；`refreshGoal` 里 `setGoal((previous) => (sameGoal(previous, next) ? previous : next))`，目标没变时复用旧对象、跳过重渲染 |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-36 登记与 0053 索引 |
| [docs/development.md](../development.md) | 改动地图 0052 行补实色卡片 / `sameGoal`；回归清单加一条「使用 goal 时目标条不闪烁、无残影」 |
| [docs/changes/0052-goal-bar.md](0052-goal-bar.md) | 实施记录追加 0053 追补说明（原视觉实现被替换） |

不改桥、不改 dsh 源码、不改 0052 的行为，不 bump 版本号。

## 5. 行为变化

- 目标条外观：半透明 + 20px 模糊底 → **主题实色卡片**（`--background-primary` 底 + 1px `--background-modifier-border` 描边 + `--shadow-s` 阴影 + `--radius-m` 圆角），仍 36px 单行、仍在输入框上方、仍跟随浅色 / 深色主题。
- 有 goal 自动续跑时，不再出现「上一帧残影 + 新一帧实条」的双条与整窗持续闪烁（需用户在真实使用中确认）。
- 目标数据没变的快照刷新不再重挂 / 重绘目标条；暂停 / 恢复 / 编辑 / 清除等真实变化照常立即反映。
- 其余不变：阶段标签（进行中的目标 / 已暂停的目标 / 受阻的目标）、动作显隐、内联编辑（Enter 保存 / Shift+Enter 换行 / Esc 取消 / IME 安全）、complete / 无目标 / 旧桥降级、按会话隔离——均与 0052 一致；编辑态仍随多行正文长高（6 行封顶）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 实色卡片在个别主题下与输入框底色接近，悬浮层次比模糊底弱 | 视觉略平 | 描边 / 阴影本就走主题变量；需要更明显可换 `--background-secondary` 或加重阴影，仍不引入 blur |
| `sameGoal` 漏比较字段 → 目标真变了却不刷新 | UI 停在旧目标 | 已比较 id / revision / objective / phase / activation / blockedReason 全字段；万一漏，切走会话再回来即恢复；DSH 侧 revision 变化一定会被比较到 |
| 仍有其它合成源（如 0049 运行提示扫光）导致闪烁 | 用户仍看到闪烁 | 先确认是否只在有 goal 时出现；若与 goal 无关，另立需求逐个排查合成分层（本提案不扩大到全局） |
| 回滚 | — | 还原 `styles.css` 目标条块 + 去掉 `sameGoal` 包裹，即回到 0052 的半透明外观（闪烁会回来） |

整体回滚：revert 上述两个文件 → `npm run build` → 重载插件；无数据迁移、不涉及桥与服务。

## 7. 验证

自动化：

```bash
npm run build   # tsc -noEmit -skipLibCheck + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致 + 桥清单与语法
```

CDP 实测（真实 Obsidian 桌面，隐藏 core 3088，桥 v8）：

- 目标条创建 / 暂停 / 恢复 / 编辑 / 清除均正常（0052 的行为回归）；
- 目标条为**实色卡片**外观（无模糊底、无半透明残影），36px 单行、描边 + 阴影；
- 对目标条区域连续截 8 帧：像素完全一致（无位移、无颜色漂移）。

说明：**presentation 级闪烁无法用截图复现**——截图抓的是已经提交的帧，抓不到合成器里的旧帧残留。因此本提案的判定依据是「移除唯一会触发整窗重新采样的合成层（backdrop-filter + isolation 伪元素底）+ 稳态化（固定高度、数据没变不重渲染）」，**最终需用户在日常使用（有 goal 自动续跑）中确认不再闪烁**。

**验收标准**：

- 有 goal 且自动续跑时，Obsidian 窗口不再持续闪烁、无「残影 + 实条」双份；
- 目标条是主题实色卡片，动作 / 标签 / 编辑 / 降级与此前一致；
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致。

## 8. 需要你拍板

- [x] **修复路径**：**A**（去模糊底改实色卡片 + `sameGoal`）（2026-10-28，用户当轮明确反馈的 BUG）
- [x] **放弃官方半透明 blur 外观**，换 Obsidian 窗口稳定（2026-10-28）
- [ ] 请在日常使用中确认闪烁消失；如实色卡片层次不满意，可再调 `--background-secondary` / 阴影，但不建议恢复 `backdrop-filter`

## 9. 实施记录

**落地（2026-10-28，路径 A）**：

- 目标条视觉：删掉官方 GoalBar 的「`isolation` + 负 z-index 伪元素 + `backdrop-filter` 半透明底」，改成主题实色卡片（`--background-primary` + 1px `--background-modifier-border` + `--shadow-s` + `--radius-m`），固定 36px 高（编辑态仍可长高）；`styles.css` 注释写明 R-36 的原因。
- 渲染稳态：`native-chat-root.tsx` 新增 `sameGoal()` 深度比较，`refreshGoal` 里目标数据没变时复用旧对象、不 `setState`，减少每帧无谓重渲染。
- 0052 的目标条**视觉实现被本提案替换**；数据面（桥 v8 `goal` / `goalAction`）、组件结构、动作与降级行为不变。

| 文件 | 实际改动 |
|---|---|
| [styles.css](../../styles.css) | 目标条改实色卡片（去 `isolation` / `::before` 模糊底 / `backdrop-filter`），固定 36px、描边 + 阴影 + 圆角，补 R-36 注释 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `sameGoal()` 深度比较 + `refreshGoal` 的 `setGoal` 复用旧对象 |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-36 / 0053 登记 |
| [docs/development.md](../development.md) | 改动地图 0052 行补 0053；回归清单加「使用 goal 时目标条不闪烁、无残影」 |
| [docs/changes/0052-goal-bar.md](0052-goal-bar.md) | 实施记录追加 0053 追补说明 |

**验证结果（2026-10-28）**：

- `npm run build`（tsc + esbuild）与 `npm run check` 通过。
- 真实 Obsidian 里 CDP 实测：目标条创建 / 暂停 / 恢复 / 编辑 / 清除均正常；外观为实色卡片（无 blur）；连续 8 帧截图目标条区域像素完全一致。
- 未能在截图里复现 presentation 级闪烁（合成器旧帧不进入截图），因此**待用户在真实使用中确认**「使用 goal 时窗口不再闪烁」。

**2026-10-28 追补（0054）**：目标条改到运行提示（深度求索中）**下方**（composer 渲染顺序 `RunStatus` → `goalBar`），解决「每轮运行提示把目标条顶动」，见 [0054](0054-goal-bar-below-run-status.md)。

**与提案的偏差**：无。
