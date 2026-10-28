---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确要求「只加上面板重试按钮」，按规则 12 视为已选定路径 A
scope: src/view/native/ui, styles.css
issue: 模型偶发只返回思考、没有正文或工具调用时，本轮被当作正常完成静默结束；原生面板没有任何提示，看起来像「会话中断」
---

# 0046 静默结束兜底：本轮模型只返回思考时给提示 + 一键「继续」

> 对应路线图 [R-29](../roadmap.md#需求待办)。2026-10-28 用户反馈「Obsidian 插件库检索 skill」会话在 10:06:45 之后没有下文，
> 面板停在一段思考后面，看起来像会话中断；随后手动发「继续」才把活干完。

## 1. 背景与问题

会话 `session-f9c5b87c`（vault DigitalGarden）的 turn 1 在 **10:06:45** 结束，但它最后一条模型消息（step 54，日志 seq 515）**只有一个 reasoning 块**：

- `replayState.response.stopReason = "stop"`，`outputTokens = 45`，reasoning 文本在正则中间被截断（`Fix pattern: \`Current version([0-9][0-9A-Za-z.\-]*?)`）；
- 紧接着 `step/end` → `turn/end {kind: completed}` —— **这一轮被当作“正常完成”结束**，没有正文、没有工具调用，也没有任何报错；
- 用户手动发「继续」后，turn 2 正常完成 skill（10:13:27），turn 3 也正常（10:16:13）。

近两天 105 个会话 / 234 轮里，**7 轮**以「只有 reasoning」收尾：6 轮是 `aborted`（手动停），只有本次被记成 `completed`。

**这次不是“重试 5 次后耗尽”**：会话日志里没有 `llm/retry` / `llm/retry-started` / `assistant/attempt` 事件，83 步对应 83 条 `assistant/message`（每步一条）——那次响应被当成**首次即成功**，`llm-retry` 从未启动。5 次只是 command-code 线路的默认预算（`normal/5`，可重试码含 `EMPTY_RESPONSE`）。作为对照：近 3 天 26 个会话 / 158 条 `llm/retry` 事件里，同一线路偶尔返回“完全空响应”并靠重试恢复（例如 10-26 14:20:05 的 `assistant/attempt` → `llm/retry` → 下一次 `assistant/message` 正常），说明重试机制本身是工作的；本次的 reasoning-only 变体没被归类为失败，才没有发生重试。

DSH 侧原因（只作为背景，本提案**不改 dsh 源码**）：`packages/llm/llm-pi-ai/src/stream.ts` 的 `mapStopReason()` 只在 **零内容块**时把 `stop` 判成可重试的 `EMPTY_RESPONSE`；只有 reasoning 的响应按正常完成处理，因此没有触发 `dsh-llm-retry`，轮次静默结束。

对用户的实际影响：面板停在没有正文的位置，分不清是“模型退化”还是“真的中断”，只能自己猜着发「继续」。

## 2. 目标与非目标

- 目标：面板能识别「这一轮结束了，但最后一条 assistant 消息既没有正文、也没有工具调用」，给出明确提示与一键「继续」。
- 非目标：不修改 dsh 源码；不改桥协议（路径 A 纯前端，路径 B 才动桥）；不改变正常轮次的展示；不自动替用户发消息（除非选路径 C）。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 原生端纯前端检测：新增 `src/view/native/ui/turn-end-hint.tsx`（纯函数 `detectSilentTurnEnd(snapshot)` + 提示条组件），在 `native-chat-root.tsx` 的输入栏上方渲染；点「继续」复用现有发送路径 | 新文件 + `native-chat-root.tsx` + `styles.css`；不动桥、不动 `shared/native-types` | 低；检测只读快照，旧桥（v2+）也能用；误判最多多一行提示 | **推荐** |
| B | 桥 v8 增加投影：`snapshot` 里带 `lastTurn: { status, hadVisibleContent }`，原生端只读字段 | `packages/dsh-obsidian-bridge/lib/client.js`（版本 8 + 能力探测）+ `src/shared/native-types.ts` + 原生 UI | 中；改桥要重新 link + 重启服务，旧桥要回退分支 | 否（A 已够） |
| C | A + 自动续跑：检测到后自动发一次「继续」（设置项开关、每轮最多 1 次、失败即停） | A + `settings/schema.ts` + 设置页 | 中高；自动发消息会消耗 token、可能循环，必须可关；语义上不该替用户做决定 | 暂不推荐（可作后续增强） |
| D | 不改代码：遇到时手动「继续」；改 profile 的 provider / reasoningEffort 规避；把问题报给 DSH 上游 | 0 | 最低；但用户每次都要自己发现“是不是中断了”，体验问题仍在 | 仅作短期规避 |

**推荐 A**：只在本仓库原生 UI 加一层“看得见”的兜底，不动 dsh、不动桥协议，改动面最小、可回退。

### A 的检测口径（评审重点）

对最新一轮（`snapshot.nodes` 里最大的 `turn`），同时满足以下条件才提示：

1. `snapshot.session.running === false`（本轮已结束）；
2. 该轮存在 `turn-tail` 节点且 `data.closing` 是对象（中止 / 中断的轮次 DSH 不写 closing，直接跳过）；
3. 该轮最后一个 `assistant-step` 节点的 `blocksOf(node).blocks` 里，既没有 `kind === 'text'` 且文本非空的块，也没有 `kind === 'tool-call'` 块；
4. `snapshot.pending` 为空（没有待回答 / 待授权交互）；
5. 用户没有对这一轮点过「继续」（组件内记住已隐藏的 turn）。

现成快照可验证（2026-10-28 从桥 v7 实读）：`session-f9c5b87c` 的 turn 1 末步只有 `reasoning`（148 字）→ 命中；turn 2 / 3 末步是 `reasoning + text` → 不命中。

## 4. 改动清单（按路径 A）

| 文件 | 改动 |
|---|---|
| `src/view/native/ui/turn-end-hint.tsx`（新增） | `detectSilentTurnEnd(snapshot): { turn: number } 或 null` 纯函数 + `SilentTurnEndHint` 组件（一行说明 + 「继续」按钮） |
| `src/view/native/ui/native-chat-root.tsx` | 用 `useMemo` 计算检测结果；命中且不在发送中时渲染提示；点击调用现有发送路径（与输入栏提交同一入口）发「继续」，并记录该 turn 已处理 |
| `styles.css` | `.dsh-native-turn-end-hint` / 按钮样式（主题变量、弱化底色） |
| `docs/changes/0046-silent-turn-end-hint.md` | 本提案；完成后补实施记录 |

不涉及：`packages/dsh-obsidian-bridge/`、`src/shared/native-types.ts`、`src/service/`、`src/settings/`。

## 5. 行为变化

- 正常轮次：无变化。
- 命中静默结束：时间线底部出现一行「本轮模型只返回了思考，没有正文或工具调用」+「继续」按钮；点一下发送「继续」，提示消失。
- 不会自动发消息、不改任何 dsh 侧状态、不改桥版本。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 误判（模型正常结束但没有正文，例如只调用了问询工具） | 多一行提示 | 检测里 `tool-call` 已覆盖；按钮无害；删掉渲染即可 |
| 旧桥 / 字段缺失 | 提示不出现（保守失败） | 保守失败，不影响正常使用 |
| 用户在别处继续了会话 | 提示可能短暂残留 | 下一次快照刷新（running 变 true / turn 变化）即消失 |

## 7. 验证

自动化：

- `npm run build`（含 `tsc -noEmit`）与 `npm run check`；
- 纯函数冒烟：用 `session-f9c5b87c` 的 turn 1 / turn 2 / turn 3 快照喂 `detectSilentTurnEnd`，期望 turn 1 命中、turn 2/3 不命中（可用 `zstd -dc` 解会话日志重建，或在 Obsidian CDP 里直接取 bridge snapshot）。

手动（重载插件后）：

1. 打开该会话，时间线底部出现提示条；输入栏仍可用；
2. 点「继续」→ 消息发出、提示消失、正常流式回复；
3. 打开任意正常完成的轮次（如「测试提问功能」）→ 提示条不出现；
4. 手动中止一轮（Stop）→ 提示条不出现。

验收标准：上述 1–4 全部符合，且 `npm run build` / `npm run check` 通过。

## 8. 需要你拍板

- [ ] 选哪条实现路径（默认推荐 A；要不要连 C 的自动续跑一起做？）
- [ ] 提示文案：`本轮模型只返回了思考，没有正文或工具调用` + `继续`，是否照用？
- [ ] 是否加设置项开关（默认开启）？

## 9. 实施记录

**实施（2026-10-28，路径 A）**

- 新增 [turn-end.ts](../../src/view/native/ui/turn-end.ts)：纯函数 `detectSilentTurnEnd(snapshot)`（判定口径见第 3 节）；无 obsidian / React 依赖，便于冒烟。
- 新增 [turn-end-hint.tsx](../../src/view/native/ui/turn-end-hint.tsx)：提示条 + 「重试」按钮（title：重试本轮：发送「继续」，让模型接着完成）。
- [native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx)：接入检测结果与 `dismissedSilentTurn`；点「重试」走 `bridge.send('继续')`（与输入栏发送同一桥方法）并隐藏提示；切换会话时重置；发送失败时把提示放回并进错误条。
- [styles.css](../../styles.css)：`.dsh-native-turn-end-hint` 提示条样式（主题变量、与输入卡片左右边界对齐）。
- 版本 0.6.3 → 0.6.4（manifest / package / versions 三处 + roadmap 顶部）。
- 与提案的偏差：判定函数按“纯逻辑可冒烟”拆成独立 `turn-end.ts`（提案原写在一个文件里）；按钮文案按用户要求用「重试」，实际发送的消息是「继续」。

**验证**

- `npm run build`（tsc + esbuild）通过；`npm run check` 全部通过（版本三处一致 / 无运行时依赖 / main.js 与源码一致）。
- 纯函数冒烟（esbuild 打包 + node，12 项）：reasoning-only completed → 命中；reasoning+text、tool-call、running、无 closing（aborted）、pending、error closing、空 nodes、旧轮 reasoning-only 但最新轮正常 → 不命中；空文本 → 命中；最新轮 reasoning-only → 命中。真实快照（`session-f9c5b87c`，最新轮 turn 3 正常）→ 不命中。全部 PASS。
- CDP 端到端（重载插件后）：用桥打桩把快照临时换成“最新轮只有 reasoning + settled closing”，面板出现提示条与「重试」按钮（截图见临时验证）；点击后按钮发出 `继续`、提示消失；恢复桥打桩后时间线回到真实会话，输入栏正常。正常会话不出现提示（hint 数量 0）。

**状态**

- `docs/changes/README.md` 0046 → ✅ 已完成；roadmap R-29 → ✅ 已完成。

