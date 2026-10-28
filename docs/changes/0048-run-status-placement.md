---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确要求「加设置：默认当前位置，可改为一直输出最下方（左对齐）」，按规则 12 例外直接执行
scope: src/settings, src/view/native/ui, styles.css
issue: 0047 的运行提示固定显示在输入框上方；希望能在设置里改位置，默认保持现状，可选「输出最下方」
---

# 0048 运行提示位置设置：输入框上方 / 输出最下方

> 对应路线图 [R-31](../roadmap.md#需求待办)。接 [0047](0047-dsh-run-status.md)。

## 1. 背景与问题

0047 把「鲸鱼尾 + 深度求索中，用时 N秒 ···」固定渲染在输入卡片上方（composer 顶部）。
dsh 官方 UI 里这一行其实是**消息流最后一行**（随对话滚动），两种位置各有偏好：

- 输入框上方：输入区常驻信息，滚得再远也看得到；
- 输出最下方：与 dsh 原生一致，跟着正文走，不占输入区空间。

用户要求加设置项：默认当前（输入框上方），可改为「一直在输出的最下方（左对齐）」。

## 2. 目标与非目标

- 目标：设置页「聊天」tab 增加「运行提示位置」下拉，两项；默认「输入框上方」；选「输出最下方」时
  提示作为时间线最后一行（随内容滚动、与正文左对齐）；运行中的面板切换后即时生效。
- 非目标：不改桥协议、不改 0047 的外观与文案；不做「悬浮钉在输出区底部」的第三种样式
  （如需要可后续在 flow 变体上加 `position: sticky`）；不加逐会话独立位置。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（采用）** | 设置项 `runStatusPlacement`（composer / flow）+ 面板双向读取：composer 时仍由 `Composer` 渲染；flow 时根组件把 `<RunStatus variant="flow">` 作为 `Timeline` 的 `runningStatus` 挂在列表末尾 | `settings/schema.ts`、`settings/sections/chat.ts`、`panel-host.ts`、`main.ts`、`native-chat-view.tsx`、`native-chat-root.tsx`、`composer.tsx`、`timeline.tsx`、`run-status.tsx`、`styles.css` | 低；纯前端，位置切换即时生效；flow 下滚上去就看不到（符合「在输出最下方」的语义） | **采用** |
| B | 在 A 基础上把 flow 变体做成 `position: sticky; bottom: 0`，滚动时始终钉在输出区底部 | A + 若干 CSS | 低；但会盖住内容、需要底色，观感与 dsh 不同 | 否（用户未要求「钉住」；可后续加） |
| C | 通过 dsh 侧配置 / 桥透传位置 | 桥 + 设置 | 中；为纯展示偏好改协议不划算 | 否 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `settings/schema.ts` | `RunStatusPlacement` 类型 + `DshPluginSettings.runStatusPlacement`（默认 `composer`）+ `runStatusPlacementOf` 归一化（`mergeSettings` 里回落默认） |
| `settings/sections/chat.ts` | 「运行提示位置」下拉（输入框上方（默认） / 输出最下方（随对话滚动）），保存后写设置 |
| `view/panel-host.ts` / `main.ts` | `DshPanelHost.getRunStatusPlacement()`，读数时归一化 |
| `view/native/native-chat-view.tsx` | 把 getter 传进 `NativeChatRoot` |
| `view/native/ui/native-chat-root.tsx` | 每次渲染读取位置：composer → 传 `showRunStatus`；flow → 给 `Timeline` 传 `runningStatus` |
| `view/native/ui/composer.tsx` | `showRunStatus` 控制是否渲染（默认 true 行为不变） |
| `view/native/ui/timeline.tsx` | 新增可选 `runningStatus`，渲染在节点列表末尾（参与时间线 gap 与自动吸底） |
| `view/native/ui/run-status.tsx` | `variant: 'composer' \| 'flow'`，flow 时加 `is-flow` class |
| `styles.css` | `.dsh-native-run-status.is-flow`：去掉 composer 的内缩 / 外距，左侧与正文列对齐（时间线 12px + 2px） |
| 文档 / 版本 | 本提案、R-31、changes 索引、development 改动地图；版本 0.6.5 → 0.6.6 |

## 5. 行为变化

- 默认（输入框上方）：与 0047 完全一致。
- 输出最下方：运行提示成为时间线最后一行，随内容滚动，左侧与 assistant 正文同列；
  一轮结束 / Stop 后消失，和正常内容一样参与吸底。
- 运行中在设置里切换位置：下一次根组件渲染（流式每帧都在渲染）即生效；空闲时下次运行生效。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| flow 下用户滚上去看不到提示 | 符合「在输出最下方」语义；需要常驻可改用默认位置 | 设置切回「输入框上方」 |
| 旧 `data.json` 没有该字段 / 手改非法值 | 回落默认（`mergeSettings` + getter 双重归一化） | 无需处理 |
| flow 挂载在滚动列表末尾，可能影响吸底判定 | 时间线已有 gap 与 `atBottom` 逻辑；实测确认 | 去掉 `runningStatus` 即回到旧布局 |

## 7. 验证

自动化：`npm run build` / `npm run check`；`runStatusPlacementOf` 归一化冒烟（`flow` → flow，其它 → composer）。

手动（Obsidian CDP）：

1. 设置页「聊天」tab 出现「运行提示位置」下拉，默认「输入框上方（默认）」；
2. 默认位置：发消息 → 提示在输入卡片上方（与 0047 相同）；
3. 切到「输出最下方」→ 运行中的提示移到时间线最后一行、左边缘与 assistant 正文对齐；
4. 切回「输入框上方」→ 提示移回输入卡片上方；
5. Stop 后两种位置都消失。

## 8. 需要你拍板

- [x] 位置项与默认值：用户当轮已明确（默认当前位置 + 可选输出最下方），按规则 12 例外直接执行。
- [ ] 可选后续：是否需要「钉在输出区底部（滚动也不消失）」的第三种样式。

## 9. 实施记录

**实施（2026-10-28，路径 A）**

- `settings/schema.ts`：`RunStatusPlacement = 'composer' | 'flow'`、`runStatusPlacementOf()`、默认 `composer`，
  `mergeSettings` 里归一化旧数据。
- `settings/sections/chat.ts`：聊天 tab 顶部新增「运行提示位置」下拉，保存即写设置。
- `panel-host.ts` / `main.ts`：`getRunStatusPlacement()`；`native-chat-view.tsx` 传给根组件。
- `native-chat-root.tsx`：每次渲染读位置——composer 把 `showRunStatus` 传给 `Composer`，flow 把
  `<RunStatus variant="flow" />` 传给 `Timeline.runningStatus`（列表末尾）。
- `timeline.tsx`：末尾渲染 `runningStatus`；`run-status.tsx`：`variant` 与 `is-flow`；
  `styles.css`：`.is-flow` 对齐正文列（时间线 12px padding + 2px）。
- 版本 0.6.5 → 0.6.6（manifest / package / versions 三处）。

**验证**

- `npm run build`（tsc + esbuild）通过；`npm run check` 全部通过（版本 0.6.6 三处一致 / 无运行时依赖 /
  main.js 与源码一致）。
- 归一化冒烟（esbuild 打包 schema.ts + node）：默认 `composer`；`'flow'→flow`；`'composer'→composer`；
  `'bogus'` / `undefined` / `null` / `1` → `composer`；旧 data.json（只有 port）合并后为 `composer`；
  `{runStatusPlacement:'flow'}` 合并后为 `flow`。
- 设置页（Obsidian 设置弹窗「聊天」tab）：出现「运行提示位置」下拉，选项为
  「输入框上方（默认）」「输出最下方（随对话滚动）」，说明文案符合预期；从下拉切到 flow 后主窗口
  `plugin.settings.runStatusPlacement === 'flow'`（已保存）。
- CDP 实测（Obsidian 主窗口，重载插件 → 新建会话 → 发会走工具的测试消息）：
  - composer：提示在输入卡片上方（容器左缘 1216px = 卡片左缘，文字与卡片内文字同列 1227px）；
  - flow：提示移到时间线最后一行（左缘 1227px = assistant 正文左缘），composer 内不再渲染；
  - 运行中切换：composer → flow 后约 1s 内完成迁移，flow → composer 同样；计时连续
    （切换前后采样为 `用时 2秒` → `用时 3秒`，未归零）；
  - Stop 后两种位置都立即消失。
