---
status: done             # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27      # 用户当轮明确指定「优化子智能体展开显示、上下拉长、不要左右滚动」，按 AGENTS.md 规则 12 例外视为已批准
scope: src/view/native/ui, styles.css
issue: 子智能体目录浮层太矮且能左右滚动：行内长模型名不换行，MenuShell 又把高度锁在首帧内容高度
---

# 0042 子智能体目录浮层：纵向随内容变高、去掉横向滚动

> 对应路线图 [R-25](../roadmap.md#需求待办)。用户 2026-10-27 反馈截图：浮层高度被压在 ~110px、行内容被裁切，底部出现横向滚动条。

## 1. 背景与问题

0041 的子智能体目录用 `MenuShell` 做锚定浮层，暴露三个显示问题（CDP 实测）：

| 问题 | 根因 |
|---|---|
| 浮层太矮、内容被裁切，出现纵向滚动 | `MenuShell` 把 `max-height` 写成**首帧内容高度**（`min(naturalHeight, room)`），列表内容 / 行高变化后不会再长高 |
| 出现横向滚动条 | 行是 `<button>`，继承 Obsidian 按钮的 `white-space: nowrap`；`模型：deepseek/…` 这类长 token 不换行，`scrollWidth` 撑到 423 > `clientWidth` 343 |
| 行高只有 30px（内容溢出到行外） | Obsidian 按钮基础样式给了固定 `height`，`button` 没有按内容长高 |

## 2. 目标与非目标

- 目标：浮层**纵向随内容变高**（上限约 72% 视口），行内长文本换行，**不再出现横向滚动条**；目录变长时跟着长高、超出时只纵向滚动。
- 非目标：不做可拖拽 resize；不改目录信息与数据面；不动团队 / 会话 / 模型浮层的行为（`MenuShell` 默认行为不变）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（本次落地）** | `MenuShell` 加可选 `grow`：`max-height` 取「可用空间 ∩ 72% 视口」而不是首帧内容高度；仅 `SubagentPanel` 传 `grow`。CSS：浮层 `overflow-x: hidden`、宽度 380；行 `height: auto` / `white-space: normal` / `min-width: 0`，行头允许换行，meta 允许 `overflow-wrap: anywhere` + `word-break: break-word` | `menu-shell.tsx`、`subagent-panel.tsx`、`styles.css` | 低；`grow` 默认 false，其它浮层行为完全不变 | **推荐** |
| B | 只改 CSS：把 `max-height` 调大并用 `overflow-y:auto` 兜底 | `styles.css` | `MenuShell` 的内联 `max-height` 优先级更高，CSS 的 `max-height` 会被覆盖 → 高度仍被锁死，治标不治本 | 否 |
| C | 把浮层改成可拖拽 resize / 固定大面板 | 新增拖拽状态与持久化 | 超出本次「显示优化」范围，交互复杂度高 | 否 |

**推荐 A**：高度问题来自 `MenuShell` 的首帧锁定，必须在骨架层加一个显式的 `grow` 开关；横向滚动是 CSS 换行问题，一并修。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [menu-shell.tsx](../../src/view/native/ui/menu-shell.tsx) | `useMenuStyle(anchor, grow)`；`grow = min(room, 72% hostHeight)`；`MenuShell` 新增 `grow?` 属性（默认 false） |
| [subagent-panel.tsx](../../src/view/native/ui/subagent-panel.tsx) | `MenuShell` 传 `grow` |
| [styles.css](../../styles.css) | 浮层宽度 `380px` / `max-height: min(72vh, 640px)` / `overflow-x: hidden`；行 `height: auto`、`white-space: normal`、`min-width: 0`；行头 `flex-wrap: wrap`；meta `min-width: 0` / `white-space: normal` / `overflow-wrap: anywhere` / `word-break: break-word` |
| [manifest.json](../../manifest.json) / [package.json](../../package.json) / [versions.json](../../versions.json) | 插件 `0.6.0 → 0.6.1` |

## 5. 行为变化

- 子智能体浮层高度按内容伸展（上限约 72% 视口），行内长模型名 / token 自动换行；**不再出现横向滚动条**；
  目录行多时只纵向滚动。
- 其它浮层（团队 / 会话 / 模型 / 权限 / 上下文 / 更多）行为不变（`grow` 默认关闭）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| `MenuShell` 改动影响其它浮层 | 高度 / 定位异常 | `grow` 默认 false，其它调用点不传；只回滚 `menu-shell.tsx` 的 `grow` 分支即可 |
| `grow` 浮层在窄窗口下超出可用空间 | 被裁剪 | 上限取 `min(room, 72% hostHeight)`，仍不超出锚点下方空间 |
| 行内容过长（超长 label） | 行变高 | label 仍单行省略（title 有完整文本）；meta 换行 |

## 7. 验证

- `npm run build` / `npm run check` 通过。
- CDP 实测（插件重载后打开有子代理的会话）：
  浮层 `scrollWidth === clientWidth`（无横向滚动）、`scrollHeight === clientHeight`（内容完整、无纵向截断）；
  行高由 30px 变为按内容（~86px）；浮层层高 ~137px，且 `max-height` 为可用空间（612px）；
  截图确认长模型名换行、无滚动条。

## 8. 需要你拍板

- [x] 按「纵向拉长 + 去掉横向滚动」直接修（用户当轮明确指定，视为批准）。
- [x] 是否改其它浮层：**否**，只给子智能体目录开 `grow`。

## 9. 实施记录

- **2026-10-27**：按路径 A 落地；`MenuShell` 新增 `grow`（默认 false），子智能体浮层启用；CSS 行高 / 换行 / 宽度修复；插件版本 `0.6.1`。
- **验证**：`npm run build` / `npm run check` 通过；CDP 实测浮层 `380×137`、`scrollWidth=clientWidth=378`、
  `scrollHeight=clientHeight=135`，行高 86px（换行后），截图确认无横向滚动条、长模型名换行。
- **偏差**：无。
