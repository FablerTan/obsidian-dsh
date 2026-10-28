---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮发截图 + 「输入框上方左对齐加上 dsh 同款运行提示」，按规则 12 例外视为已选定路径 A
scope: src/view/native/ui, styles.css
issue: 原生面板跑一轮时，输入框上方没有任何「正在跑」的提示；dsh 官方 UI 在这个位置有一行「深度求索中，用时 N 秒 ···」
---

# 0047 输入框上方的 dsh 同款运行提示

> 对应路线图 [R-30](../roadmap.md#需求待办)。2026-10-28 用户给出 dsh 官方 UI 的截图（鲸鱼尾 +
> 「深度求索中，用时 1 秒 ···」，左对齐在输入框上方），要求原生面板照做。

## 1. 背景与问题

原生面板的「运行中」目前只有三处弱信号：时间线里的过程行脉冲、发送按钮变成 Stop、标题栏绿点。
输入框上方是空的，跑长任务时看不出「这一轮到底在跑、跑了多久」，也没有 dsh 那种一眼可辨的品牌提示。

dsh 官方实现（从桌面端 app.asar 里的 `@deepseek-ai/dsh-client-ui-chat` 抽出，供对齐口径）：

- 组件 `RunningStatus`：`<div data-chat-running>` 里放三样东西——屏幕阅读器专用的
  「深度求索中」（`role="status" aria-live="polite"`，只播报一次）、一条分隔线、以及
  「鲸鱼尾 + 文字」；
- 文案：`chat.deepDivingFor` = `深度求索中，用时 {duration} ···`（`duration` 见下），
  没有本轮开始时间时退回 `chat.deepDiving` = `深度求索中`；
- 时长：`formatRunDuration` 每秒刷新（`LIVE_RUN_CLOCK_INTERVAL_MS = 1e3`），
  口径 `Math.max(1e3, now - startTime)`；单位文案 `{seconds}秒` / `{minutes}分{seconds}秒`，
  秒恒定出现、分 / 小时只在进位时出现、无前导零；
- 视觉：字号 = 正文字号 − 2px（dsh 14px → 12px），行高 22px，`gap: 6px`，14×14 鲸鱼尾，
  文字颜色 `--dsw-alias-label-deep-diving`（浅色 = deepseek-500 70% + blue-950 30% =
  `rgb(52, 94, 186)`；深色 = deepseek-450 55% + neutral-bluish-400 45% = `rgb(125, 154, 222)`），
  并带 `TextShimmer` 的渐变微光；
- 鲸鱼尾动效：APNG 蒙版（21.6KB 二进制）驱动尾巴摆动，不支持蒙版 / 减少动效时退回静态 SVG
  （16×16 `REST_PATH` 描边）。

## 2. 目标与非目标

- 目标：输入框上方左对齐一行与 dsh 同款的运行提示（鲸鱼尾 + 逐秒「深度求索中，用时 N秒 ···」），
  只在会话 `running` 时出现，跑完立即消失；浅 / 深主题各自的 dsh 配色；不干扰输入框、菜单与提问卡。
- 非目标：不改桥协议、不改 dsh 源码、不做「本轮开始时间」的跨面板精确计时（桥 v7 快照没有该字段）；
  不引入 dsh 的 APNG 二进制资源（改用同形状 SVG + CSS 摆动）；不加设置项开关。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（采用）** | 纯前端：新增 `view/native/ui/run-status.tsx`（`formatRunDuration` + `RunStatus` 组件），`composer.tsx` 在 `pending` 之前渲染 `<RunStatus running={running} />`；`styles.css` 加 `.dsh-native-run-*` | 新组件 + composer 一行 + 样式 + 文档 | 低；计时起点是「面板看到 running 变 true」，中途打开面板会从 0 开始 | **采用**（用户已指定位置与外观，A 改动面最小、可回退） |
| B | 桥 v8 在 snapshot 里投影本轮 `startedAt`，native 端据此算真实耗时 | `packages/dsh-obsidian-bridge/lib/client.js` + `shared/native-types.ts` + UI | 中；改桥要重新 link / 重启服务，旧桥要回退分支；为一行提示改协议不划算 | 否（可作后续增强） |
| C | 渲染进时间线末尾（dsh 原生位置），随正文滚动 | `timeline.tsx` + `timeline-model.ts` | 中；滚动 / 合帧 / 空态分支都要改，滚上去就看不到 | 否（用户明确要「输入框上方」） |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/ui/run-status.tsx`（新增） | `formatRunDuration`（与 dsh 同口径，可单独冒烟）+ `RunStatus`：running 变 true 记起点、每秒刷新、`data-dsh-running`、隐藏的 `role="status"` 只播报「深度求索中」 |
| `src/view/native/ui/composer.tsx` | 引入 `RunStatus`，在 composer 顶部（`pending` 卡之前）渲染 |
| `styles.css` | `.dsh-native-run-status`（12px / 22px / 左对齐 27px / 浅深主题色）、`.dsh-native-run-content`、`.dsh-native-run-whale`（摆动）、`.dsh-native-run-text`（shimmer）、`.dsh-native-visually-hidden`、两个 keyframes；`prefers-reduced-motion` 与 `@supports` 兜底 |
| 文档 | 本提案、路线图 `R-30`、changes 索引、development 改动地图；版本 0.6.4 → 0.6.5 |

## 5. 行为变化

- 会话运行中：输入框上方出现一行「鲸鱼尾 + 深度求索中，用时 N秒 ···」，每秒走字，左侧与正文列对齐。
- 一轮结束 / 手动 Stop / 切换会话：提示立即消失。
- 只读子会话（`readOnly`）同样显示（跟随该会话的 running 状态），不改变只读提示与 Stop 按钮。
- 不做其他改动：输入框、菜单、提问卡、时间线均不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 计时起点不跨面板（中途打开从 0 开始） | 显示的用时偏小 | 已知限制；需要更准就走路径 B |
| shimmer 依赖 `background-clip: text` | 极旧客户端文字不可见 | `@supports` 守卫，不支持时按纯色显示；`prefers-reduced-motion` 关闭 |
| 每轮多一个 1s 定时器 | 可忽略 | 仅在 running 时挂载 |
| 深色主题配色是 dsh 的 mix 计算值 | 与 dsh 实机可能有 1~2 级色差 | 改 `--dsh-native-run-*` 两个变量即可 |

## 7. 验证

自动化：

- `npm run build`、`npm run check`；
- `formatRunDuration` 纯函数冒烟：999ms → `1秒`、1s → `1秒`、59.9s → `59秒`、60s → `1分0秒`、
  65s → `1分5秒`、3600s → `1小时0分0秒`、3661s → `1小时1分1秒`。

手动（重载插件后）：

1. 空闲时输入框上方没有该行；
2. 发一条消息 → 行出现、鲸鱼在摆、用时逐秒递增、格式为「深度求索中，用时 N秒 ···」；
3. Stop 之后行立即消失；
4. 浅色主题颜色 ≈ `rgb(52, 94, 186)`，深色主题 ≈ `rgb(125, 154, 222)`。

验收标准：1–4 全部符合，且 build / check 通过。

## 8. 需要你拍板

- [x] 实现路径：用户当轮已明确指定「输入框上方左对齐 + 截图样式」，按规则 12 例外直接按 A 执行。
- [ ] 后续可选：是否要 dsh 的 APNG 鲸鱼尾（21.6KB 二进制）与桥 v8 的精确计时起点。

## 9. 实施记录

**实施（2026-10-28，路径 A）**

- 新增 `view/native/ui/run-status.tsx`：`formatRunDuration` 按 dsh 的 `formatRunDuration` 口径
  （≥1s、秒恒定、分/时进位、无前导零）；`RunStatus` 在 running 变 true 时记起点、每 1s 刷新，
  DOM 结构与 dsh 对齐（隐藏的 `role="status"` + 内容行，`data-dsh-running` 便于 CDP 断言）。
- `composer.tsx`：在 `pending` 卡之前渲染 `<RunStatus running={running} />`（即输入卡片正上方、左对齐）。
- `styles.css`：新增 `.dsh-native-run-*` 与 `.dsh-native-visually-hidden`；颜色直接写 dsh 的
  mix 计算值（浅 `rgb(52,94,186)` / 深 `rgb(125,154,222)`，shimmer 用反比 mix），
  字号 12px、行高 22px、左侧 11px 内缩（与正文列 27px 对齐）；鲸鱼尾用 dsh 的 `REST_PATH` 描边，
  尾巴摆动用 CSS（未嵌入 dsh 的 APNG 蒙版）。
- 版本 0.6.4 → 0.6.5（manifest / package / versions 三处）。

> 0049 起文字微光改用 dsh 的 105° 蒙版扫光（[0049](0049-run-status-shimmer-sweep.md)）；本节与正文里 background-clip: text 的实现描述是当时做法，以 0049 为准。

**与提案的偏差**

- 鲸鱼尾动效：dsh 用 APNG 蒙版（21.6KB base64），这里用同形状 SVG + CSS 轻微摆动；
  如要 1:1 动效可后续把 APNG 作为资源引入。
- 计时起点：跟随组件看到的 `running` 变化，未走桥 v8（提案已列为后续可选）。

**验证**

- `npm run build`（tsc + esbuild）通过；`npm run check` 全部通过（版本 0.6.5 三处一致 / 无运行时依赖 /
  main.js 与源码一致）。
- `formatRunDuration` 纯函数冒烟（esbuild 打包 + node，10 项）：
  `0→1秒`、`999→1秒`、`1000→1秒`、`1500→1秒`、`59900→59秒`、`60000→1分0秒`、
  `65000→1分5秒`、`3599000→59分59秒`、`3600000→1小时0分0秒`、`3661000→1小时1分1秒`。
- Obsidian CDP 实测（重载插件 → 新建会话 → 发一条会走工具的消息）：
  - 空闲 / 空态：`.dsh-native-run-status` 不存在；
  - 运行中：行出现，文案连续采样为 `深度求索中，用时 9秒 ···` → `…10秒…` → … → `…20秒…`（每秒 +1）；
  - 计算样式：`color: rgb(52, 94, 186)`、`font-size: 12px`、`line-height: 22px`、`padding-left: 11px`、
    行高 22px，左边界与输入卡片文字同一条线（卡片左缘 1216px + 11px）；
  - 点 Stop 后 1.5s 内行消失、Stop 按钮回到发送按钮。
