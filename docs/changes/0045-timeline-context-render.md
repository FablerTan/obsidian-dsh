---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮报「提问工具在消息流中的渲染有问题」并给出截图，属于 BUG 修复；按规则 12 例外视为已批准
scope: src/view/native/ui, styles.css
issue: 时间线的上下文类卡片被「上下文占用圆环」的类名规则压成 24×24；question-reply 节点退化成整段 JSON
---

# 0045 时间线渲染修复：类名冲突压扁卡片 + 提问答案记录专用渲染

> 对应路线图 [R-28](../roadmap.md#需求待办)。用户 2026-10-28 反馈截图：消息流里出现一块被压成一条竖线的 JSON，
> 旁边是三个只有图标的 `question-reply` 方块，数字被挤成竖排；正文与「运行了代码，向你提问了」都正常，只有这类卡片变形。

## 1. 背景与问题

两个独立缺陷叠加，才长出截图里的样子：

| 现象 | 根因 |
|---|---|
| 卡片宽度只有 24px，JSON 变成一列单字（`{` / `"` / `t` / `i` / `m` / `e` …） | **类名冲突**：输入栏的「上下文占用圆环」（`context-meter.tsx`）用 `.dsh-native-context`，而时间线的上下文 / 压缩 / 未知节点卡片（`timeline-nodes.tsx` 的 `ContextCard` / `CompactionCard` / `UnknownNode`）也用同一个类名。CSS 里 `.dsh-native-app .dsh-native-context` 把圆环定成 `inline-flex; width: 24px; height: 24px; padding: 0`，优先级高于卡片自身的 `.dsh-native-context`，于是**卡片全被压成 24×24**，里面的 `<pre>` 只够放一个字符宽，`overflow-wrap: anywhere` 让 JSON 逐字竖排 |
| 提问结束后历史里多出 `question-reply` 节点，显示成「{ JSON }」 | 节点 kind `question-reply` 没有专用渲染，落到 `UnknownNode` 的 `<details><pre>{JSON.stringify(node.data)}</pre></details>` |

`question-reply` 的 `data` 形状（从实际快照读出）：

```json
{
  "time": 1793117015907,
  "callId": "call_…:ptc:1",
  "outcome": "answered",
  "questions": [{ "id": "test-multi", "question": "多选测试：可以勾选任意多个选项。", "header": "测试 · 多选" }],
  "answers": [{ "id": "test-multi", "selected": ["多选一", "多选二", "多选三"] }],
  "text": "{…}"
}
```

自定义输入时 `answers[].selected` 为空、`custom` 带文本；跳过的题 `selected: []` 且无 `custom`。

## 2. 目标与非目标

- 目标：时间线的卡片恢复整行宽度；`question-reply` 有专用渲染——一行摘要（已回答 / 已取消 · N 题 · 答案预览），展开看每题「问题 → 答案」，不再平铺 JSON。
- 非目标：不改 dsh 侧快照结构、不改桥协议；不动 `context-meter` 圆环本身；不给 `question-reply` 加操作按钮（只读记录）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（本次落地）** | 类名去冲突：时间线卡片改用 `.dsh-native-context-card`（`timeline-nodes.tsx` 三处 + `styles.css` 三条选择器）；同时给 `question-reply` 加专用卡片 `QuestionReplyCard`（`<details>` 摘要 + 每题问答列表） | `timeline-nodes.tsx`、`styles.css` | 低；纯视图层，旧桥数据不变 | **推荐** |
| B | 只改 CSS：把圆环规则收窄成 `.dsh-native-context-meter`（改 `context-meter.tsx` 类名 + 全部 `--context-*` 子元素规则） | `context-meter.tsx`、`styles.css` 约 20 条规则 | 中；圆环有 `is-empty` / `-track` / `-fill` / `-panel` 等一串派生选择器，改动面更大，且历史提案（0022）的截图验收口径要重跑 | 否 |
| C | 保持 `UnknownNode` 展示，只把宽度修好 | `styles.css` | JSON 仍占满屏、历史里每答一次就多一大块 | 否（只解决一半） |

**推荐 A**：冲突的根因是「时间线卡片借用了圆环的类名」，改一方就够；顺手把 `question-reply` 从「未知节点」升级成正式记录卡。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [timeline-nodes.tsx](../../src/view/native/ui/timeline-nodes.tsx) | `ContextCard` / `CompactionCard` / `UnknownNode` 的类名 `dsh-native-context` → `dsh-native-context-card`；新增 `QuestionReplyCard`（摘要：`已回答`/`已取消`/`已结束` + `N 题` + 答案预览；展开：每题 `header · question` → 答案，空答案为「跳过」）；`NodeView` 增加 `case 'question-reply'` |
| [styles.css](../../styles.css) | 卡片选择器改名（`summary` / `pre` / 基础卡）；新增 `.dsh-native-answer` 系列（摘要省略号、问答列表、空答案弱色） |
| [manifest.json](../../manifest.json) / [package.json](../../package.json) / [versions.json](../../versions.json) | 插件 `0.6.2 → 0.6.3` |

## 5. 行为变化

- 上下文注入 / 上下文已压缩 / 未知节点卡片恢复整行宽度，`<pre>` 正常换行、卡内滚动（此前被压成 24×24 的一条竖线）。
- 每轮提问结束后，历史里显示一行「已回答 · N 题 · 答案摘要」，点开看每题的问题与选择；自定义输入与跳过分别显示为文本 / 「跳过」。
- 输入栏的上下文占用圆环（0022）行为与样式不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 改名后遗漏旧选择器 | 卡片失样式（变成纯文本流） | 两条选择器同批改，`grep dsh-native-context` 可核对残留 |
| `question-reply` 的 `data` 形状与预期不同（旧会话 / 其它 outcome） | 显示为空行 | 解析全部走 `asRecord` + 类型判断，缺失字段退化为「已结束 · 0 题」；`UnknownNode` 仍兜底未知 kind |
| 摘要行过长挤压 | 单行省略号 + `title` 不设，展开可看全文 | 列表面板可读性由 `.dsh-native-answer-preview` 的 ellipsis 控制 |

## 7. 验证

- `npm run build` / `npm run check` 通过。
- CDP 实测（重载插件后打开「测试提问功能」会话，其中已有 3 条 `question-reply`）：

| 检查项 | 结果 |
|---|---|
| 卡片宽度 | 修复前 24px（`pre` 16–43px、字号 12px、逐字竖排）；修复后 378px 整行，`summary` 360px |
| 摘要文案 | 「已回答 1 题 · 选项 A（推荐）」「已回答 1 题 · 多选一、多选二、多选三」「已回答 1 题 · 11」 |
| 展开内容 | 列表项「测试 · 多选 · 多选测试：可以勾选任意多个选项。 → 多选一、多选二、多选三」 |
| 未知节点兜底 | `UnknownNode` 类名已改 `.dsh-native-context-card`，不再被圆环规则命中 |
| 圆环回归 | 输入栏上下文圆环仍 24×24、可点击（类名未动） |

## 8. 需要你拍板

- [x] 直接按 A 修（用户当轮报 bug 并给截图，视为批准）。
- [x] 是否把 `question-reply` 做成 `<details>`（默认收起）：是；历史记录不主动占屏，展开可看每题问答。
- [x] 是否同时改圆环类名（路径 B）：否，改时间线卡片一侧即可，圆环历史验收口径不动。

## 9. 实施记录

- **2026-10-28**：按路径 A 落地。`timeline-nodes.tsx` 三处卡片类名改为 `dsh-native-context-card`，新增 `QuestionReplyCard` 与 `case 'question-reply'`；
  `styles.css` 改名对应三条选择器并新增 `.dsh-native-answer` 样式；插件版本 `0.6.3`。
- **验证**：`npm run build` / `npm run check` 通过；CDP 打开历史会话实测 3 条 answer 卡均为 378px 整行、摘要与展开内容正确（见第 7 节）。
- **偏差**：无。
