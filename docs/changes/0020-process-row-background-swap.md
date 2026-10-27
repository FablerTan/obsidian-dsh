---
status: done
created: 2026-10-27
approved: 2026-10-27     # 用户当轮明确指定「交换默认态与 hover 态，默认像第一张图」，视为已批准
scope: styles.css
issue: 过程行（工具调用折叠行）默认底色是实心按钮灰、hover 才是浅色叠加；用户希望反过来，默认就是浅叠加
---

# 0020 过程行默认 / hover 底色互换

## 1. 背景与问题

- **现象**：原生聊天里「运行了代码 · 用时 10 秒」这一行（一轮过程行的折叠头，`.dsh-native-process-head`）默认是一块实心灰底；鼠标悬停时才变成叠在面板上的浅色（半透明）。用户给的两张截图正好对应这两个状态，希望**互换**：默认就是浅色叠加，hover 变实心。
- **复现**：打开任意有工具调用的会话，观察过程行；鼠标移入 / 移出对比。
- **实测根因**（CDP 读取 Obsidian 渲染进程的计算样式与匹配规则）：
  - `styles.css` 原本写的是 `.dsh-native-process-head { background: transparent }` + `:hover { background: var(--background-modifier-hover) }`；
  - 但 Obsidian 的基础按钮规则 `button:not(.clickable-icon)` 特异性是 (0,1,1)，高于单个类选择器 (0,1,0)，它的 `background-color: var(--interactive-normal)`（本机 `#e4e4e4`）把「透明」盖掉了；
  - 于是**实际默认态 = 实心 `--interactive-normal`**（截图的第二张），**hover 态 = `--background-modifier-hover` 的半透明叠加**（第一张，在用户的半透明主题下带出壁纸/面板色调）；
  - 也就是说：截图上看到的两个状态，与 `styles.css` 的原意正好相反。用户要的「交换」= 恢复「默认浅色叠加、hover 实心」的语义，并让默认态真的按配色变量走。
- 需求登记：[roadmap R-3](../roadmap.md#需求待办)。

## 2. 目标与非目标

- 目标：
  1. 过程行默认显示为浅色叠加（`--background-modifier-hover`，随主题 / 半透明背景走）；
  2. hover 显示为实心按钮底色（`--interactive-normal`）；
  3. 折叠层里的思考行（`.dsh-native-think-head`）与单个工具行（`.dsh-native-tool-head`）同步成同一套底色，避免父子层级两种观感（用户在同一轮确认「一起换」）；
  4. 只改视觉，不动 DOM / 交互 / 数据。
- 非目标：
  - 不改行高、内边距、图标、字号、文案；
  - 不引入主题适配分支或写死颜色。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，已采用）** | 用 `.dsh-native-app .dsh-native-process-head`（0,2,0）声明默认底色、`.dsh-native-app .dsh-native-process-head:hover`（0,3,0）声明 hover 底色；同时把两种底色互换 | [styles.css](../../styles.css) 约 12 行 | 只是选择器加一层前缀；优先级稳定压过 Obsidian 的 `button:not(.clickable-icon)`，与加载顺序无关；若将来 Obsidian 改基础按钮选择器，仍有余量 | **推荐**：改动最小，语义最直白，且顺手修掉「透明被按钮底色吃掉」的根因 |
| B | 用 `button.dsh-native-process-head`（0,1,1）与 Obsidian 规则打平，靠样式表顺序（插件 CSS 在 app.css 之后）取胜 | `styles.css` 约 12 行 | 同样短，但依赖加载顺序；主题 / 其他插件插入样式后可能失效，排查成本高 | 不推荐：脆弱 |
| C | 在过程行组件上写内联 `style={{ background: ... }}`，用 React 控制 | [timeline-process.tsx](../../src/view/native/ui/timeline-process.tsx) | 要处理 hover 状态（`onMouseEnter/Leave`）或 CSS-in-JS；行为仍是视觉，却把样式搬进 TSX，与「样式都在 styles.css」的约定冲突 | 不推荐：违反规则 7 与分层 |
| D | 把 `<button>` 换成 `<div role="button">`，绕开 Obsidian 按钮基础样式 | `timeline-process.tsx` + 键盘可达性补齐 | 要自己补 `tabIndex` / Enter / Space 处理，影响可访问性，风险最大 | 不推荐：代价与收益不成比例 |

> 用户当轮已明确指定要改的具体项（并直接给出两个状态的截图），按 AGENTS 规则 12 的例外条款视为已批准，直接采用推荐的 A；此处保留路径对比以便回溯。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [styles.css](../../styles.css) | 删除 `.dsh-native-process-head` / `.dsh-native-think-head` / `.dsh-native-tool-head` 里已无效的 `background: transparent`；三处都改为 `.dsh-native-app` 前缀的 `var(--background-modifier-hover)`（默认）+ `var(--interactive-normal)`（hover），并加注释说明优先级原因与互换关系（process 的 hover 额外保留 `color: var(--text-normal)`） |
| 文档 | [roadmap](../roadmap.md) R-3、本提案、[changes README](README.md) 索引 |
| 其他 | 不改 TS / 不改构建产物 / 不改版本号 |

## 5. 行为变化

- 过程行**默认**从实心 `--interactive-normal` 变为 `--background-modifier-hover` 的浅色叠加（半透明主题下会透出面板 / 壁纸色调，即用户第一张截图的样子）；
- 过程行 **hover** 从浅色叠加变为实心 `--interactive-normal`（用户第二张截图的样子）；
- 折叠层里的思考行 / 单个工具行同步为「默认浅色叠加、hover 实心」，与过程行一致；
- 文字颜色、图标、行高、展开行为、点击区域均不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 浅色叠加在纯白 / 纯黑主题下与实心底色数值接近，两个状态看起来几乎一样 | 悬停反馈变弱（当前这台机器的纯白主题就是这种情况） | 把默认规则改回 `var(--interactive-normal)` 即可 |
| 依赖 `.dsh-native-app` 作为祖先 | 若以后把过程行移出该容器，底色回落成 Obsidian 按钮默认色 | 选择器里保留注释；结构变动时回归一次 |
| 半透明主题下默认底色透出壁纸，可能降低文字对比度 | 可读性下降 | 回退默认规则为 `transparent`（保持 hover 实心） |

回滚：只改 `styles.css`，`git checkout styles.css` 即可；无版本号 / 产物 / 数据迁移。

## 7. 验证

- [x] `npm run check` 通过（CSS 不参与构建，`main.js` 与源码仍一致）；
- [x] 把新规则注入运行中的渲染进程后，CDP 读取 `.dsh-native-process-head` 计算样式：默认 `oklch(0 0 none / 0.067)`（= `--background-modifier-hover`），强制 `:hover` 后 `rgb(228, 228, 228)`（= `--interactive-normal`）；
- [x] 截图对比：默认、强制 hover 两张截图与改动前「默认 / hover」正好互换（本机纯白主题下两色数值接近，差异随主题而定）；
- [ ] 用户窗口（半透明 + 带壁纸）下的实际观感待真机确认——这正是截图 1 / 2 的主题环境；
- [x] 展开 / 收起、点击区域、文字与图标无变化（纯背景声明改动）；
- [x] 三类行（process / think / tool）计算样式一致：默认 `oklch(0 0 none / 0.067)`，强制 `:hover` 后 `rgb(228, 228, 228)`（在临时探针元素上验证，未干扰真实消息）。

## 8. 需要你拍板

- [x] 交换默认态与 hover 态（用户已明确指定，默认 = 第一张图）。
- [x] （可选）折叠层内的「思考」行 / 单个工具行是否也一起换？用户确认**一起换**（2026-10-27）。

## 9. 实施记录

- **2026-10-27 实施（路径 A）**，只改 [styles.css](../../styles.css)：
  - 根因确认：Obsidian 的 `button:not(.clickable-icon)`（0,1,1）盖掉了原来的 `background: transparent`，所以此前「默认实心、hover 叠加」并非 CSS 本意；
  - 删除 `.dsh-native-process-head` 中无效的 `background: transparent`，把底色声明改为 `.dsh-native-app` 前缀的 `var(--background-modifier-hover)`（默认）与 `var(--interactive-normal)`（hover）；
  - 未改 `.dsh-native-tool-head` / `.dsh-native-think-head`。
- **验证**：实测计算样式默认 = `oklch(0 0 none / 0.067)`、强制 hover = `rgb(228, 228, 228)`；把面板底色临时设成用户截图里的 `#e9f4f5` 再取样：默认态 = `rgb(217, 228, 229)`（用户第一张截图为 `rgb(218, 228, 229)`）、hover 态 = `rgb(228, 228, 228)`（用户第二张截图同值），两个状态确实互换且颜色对得上；`npm run check` 通过。
- **2026-10-27 追补（用户确认「一起换」）**：把同一套规则套到 `.dsh-native-think-head`（思考行）与 `.dsh-native-tool-head`（单个工具行），三处底色一致；`.dsh-native-tool.is-sub` 的缩进 / 左边框不变。验证：临时探针元素上三类行默认均为 `oklch(0 0 none / 0.067)`、强制 hover 均为 `rgb(228, 228, 228)`；探针已移除，未改动真实消息。
- **与提案的偏差**：无。已运行的 Obsidian 需要重载插件才会读到新的 `styles.css`（本次为直接替换运行中的插件样式表，效果等同于重载）。
