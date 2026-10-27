---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: packages/dsh-obsidian-bridge, src/shared, src/view/native, docs
issue: 原生面板的 Assistant 输出不是流式；改为桥直接消费会话事件流（B3：nextEvent 携带 live tail）
---

# 0017 原生面板流式输出（桥事件流）

> 用户选定 **B3**：桥订阅 `SessionBinding.eventSource` 累积 live，`nextEvent` 同时返回结构游标与 live 游标；
> 旧桥缺 `liveStream` 时软降级并提示一次。已实施并验证。
> 实测环境：Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 本仓库 0.4.1 + 本机 vault（3088 端口）。

## 1. 背景与问题

### 现象

原生面板里发一条较长回复：用户消息立即出现，运行点亮，但 Assistant 正文 / 思考在回合结束前**基本不出现**，
偶尔中途闪一次半截文本，看起来就是“非流式”。

### 根因（已实测）

1. 数据源是**离屏**的官方 core webview（`styles.css` 的 `.dsh-native-core-host`：`left:-10000px; opacity:0`）。
2. Chromium 把不可见 / 被遮挡的 webview 判为 occluded，**rAF 被节流**：guest 页实测 **2~3 帧/秒**
   （Obsidian 主渲染进程 60 帧/秒；guest 的 `setInterval` 仍是 100Hz，说明不是主线程卡住）。
3. dsh 官方 UI 对 `assistant/live-chunk` 的发布策略是 **animation-frame**，且要**等 3 个 rAF** 才 flush
   （`packages/client/ui-conversation/src/client/conversation/assembly.ts:142-159`；
   `packages/client/ui-chat/src/client/conversation-nodes/assistant.ts:321-326`）。
   rAF 只有 2~3 帧/秒时，3 帧 = 1~1.5 秒；短回合一次都等不到。
4. 桥的 `snapshot()` 只导出 `chat.order` 里**已物化**的节点
   （`packages/dsh-obsidian-bridge/lib/client.js:360-386`）。
   流式文本在 flush 前只存在于 `chat.legacy.partial` / 会话事件流里，桥没导出，所以原生 UI 看不到。

### 实测数据

**离屏（当前状态）**，3.6 秒的回复：运行中 0 次正文更新，回合结束一次性出现 339 字。

**把 core 放到屏幕内**（临时候选方案 A），同一账号：正文按约 300ms 一批增长：
0 → 4 → 92 → 167 → 230 → 352 → 436 → 511 → 547 字。

**rAF 对照**：离屏 2~3 帧/秒；屏幕内 `opacity:0.001 + z-index:5` 62 帧/秒。
`webpreferences="backgroundThrottling=no"` 对离屏 rAF 无效（0 帧），已排除。

> 方案 A（把 core 挪到屏幕内）能让现有链路恢复流式，但用户已选择 B：
> 不依赖官方 UI 的渲染节奏，core 继续离屏，避免 60fps 合成开销。

## 2. 目标与非目标

- 目标：
  - 运行中正文 / 思考按 provider 的 chunk 节奏出现，不等回合结束；
  - 不依赖 rAF、不依赖窗口焦点，core 保持离屏；
  - 最终消息、工具卡、审批、停止等行为不变；
  - 桥版本可平滑降级：旧桥 / 未重启时退化为当前“整段出现”，不报错、不丢消息。
- 非目标：
  - 不做逐字打字机动画；
  - 不恢复可见的官方 Web GUI；
  - 不在这一版里改 provider 的 chunk 粒度、不做虚拟滚动。

## 3. 方案 B：桥直接消费会话事件流

### 3.0 三种传输共享的部分

桥在 `subscribe()` 里已经拿到 `ref.binding`（`SessionBinding`），它带有 `eventSource`
（`SessionEventSource`，每次事件窗口变更**同步**通知，见
`packages/api/session-controller/src/client/contract/events.ts:116-145`）。

桥新增一个 **live 累加器**，与官方 UI 的 rAF 投影完全无关：

```js
// nativeApi(ctx) 内
let live = null;          // { turn, step, attemptId, blocks: [...] }
let liveRevision = 0;

function livePacket() {
  return live === null ? null : {
    turn: live.turn,
    step: live.step,
    attemptId: live.attemptId ?? null,
    blocks: sanitize(live.blocks) // 与 AssistantChatData.blocks 同形
  };
}

function bumpLive() { liveRevision += 1; /* 唤醒 live 等待者 */ }
```

事件处理（对 `append` 增量应用，`replace` 时全量重放，`settle-assistant` 时清空）：

| 事件 / chunk | 动作 |
|---|---|
| transient `assistant/live-chunk` | 按 `block-start / text-delta / reasoning-delta / tool-call-delta / block-end` 累积 blocks |
| `step/start` | 新建 `live = {turn, step, attemptId:null, blocks:[]}` |
| `assistant/message`（含 interrupted） | 清空 live（正式节点接管） |
| `assistant/attempt` | 清空 live |
| `llm/retry` | 清空 blocks（保持当前 turn/step） |
| `turn/end` / `settle-assistant` | 清空 live |
| `prepend` | 不影响 live |
| `replace` | 清空后按新窗口重放（处理订阅时正处在回合中） |

blocks 形状直接复用官方 `AssistantChatData.blocks`：

```ts
type NativeChatLiveBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string };

interface NativeChatLive {
  turn: number;
  step: number;
  attemptId: string | null;
  blocks: NativeChatLiveBlock[];
}
```

原生端把 live 变成一条**合成 assistant-step 节点**，直接喂给现有 `buildTimeline`：

```ts
// key 固定为 live:<turn>:<step>，data.blocks 与正式节点同形
{ kind: 'assistant-step', turn, step, visibility: 'visible',
  key: 'live:' + turn + ':' + step,
  data: { status: 'running', turn, step, time: Date.now(), blocks: live.blocks } }
```

这样思考进 process group、正文走 `AssistantText`、工具块走 `ToolRow`，不需要新渲染组件。
唯一的新规则：**同一 turn/step 已有 settled 的 assistant-step 节点时不再追加 live 节点**（去重）。

> 注意：`timeline.tsx:36-42` 的自动吸底现在只依赖 `snapshot.revision`；
> 接 live 后要把 live 的版本号（`liveCursor` 或本地 tick）加进依赖，否则新文本会涨在可视区下面。

### 3.1 B1：live 塞进 `snapshot()`

**桥**

```js
function snapshot() {
  return { ..., live: livePacket() };
}
function bumpLive() { bump(); } // 合并进结构 revision
```

**原生**

- `NativeChatSnapshot` 增加 `live: NativeChatLive | null`；
- 现有 `poll()` → `nextEvent` → `refreshSnapshot()` 不动，snapshot 里自然带上 live；
- `Timeline` 接收 `snapshot.live`，走上面的合成节点。

**调用链**

```text
chunk → bridge bump() → nextEvent 返回 changed → refreshSnapshot()（全量）
      → setSnapshot(带 live) → Timeline 重算 → 正文增长
```

**优点**：改动最少；一份快照里结构 + live 原子一致；不需要新 cursor / 新方法；最容易验证。

**缺点**：每个 chunk 都拉一次**全量快照**。当前 14 节点约 **51KB**，历史越长越大；
快速模型（20 chunk/s）时是 MB/s 级 IPC + 整棵时间线重渲染。配合 3.5 的去噪后才勉强可用，
但本质仍是“用大快照传小增量”。

**适合**：只想最快看到效果、会话普遍不长的场景。

### 3.2 B2：独立的 `live()` 轻量长轮询

**桥**

```js
function live(cursor, timeoutMs) {
  if (cursor !== liveRevision) {
    return Promise.resolve({ cursor: liveRevision, changed: true, live: livePacket() });
  }
  // 独立的 liveWaiters：只由 bumpLive 唤醒
  return new Promise(resolve => { /* 超时返回 changed:false */ });
}
```

`nextEvent` 保持原样，只负责结构；`bumpLive` 只唤醒 live 等待者。

**原生**

- 新增 `liveCursorRef` 与 `live` state；
- 在现有 `poll()` 之外再加一个 `pollLive()` 循环：
  ```ts
  const event = await bridge.live(liveCursorRef.current, 20000);
  if (event.changed) { liveCursorRef.current = event.cursor; setLive(event.live); }
  ```
- 切会话 / 关闭时用同一个 token 取消两个循环。

**调用链**

```text
chunk → bumpLive → live() 返回 {changed, live}（几十~几 KB）
结构变化 → nextEvent → refreshSnapshot（全量，频率低）
```

**优点**：结构快照频率降下来；live 负载小；`nextEvent` 契约不变，旧桥兼容性最好（新增方法可探测）。

**缺点**：两条长轮询并存（空闲时 2 个 pending executeJavaScript）；
两套 waiter / 两套取消逻辑；live 与结构更新到达顺序需要去重（settle 时 live 清空、快照出现正式节点）。
代码量比 B3 多，收益与 B3 相同。

**适合**：不想动 `nextEvent` 契约、但能接受两套循环的场景。

### 3.3 B3（推荐）：`nextEvent` 顺带返回 live

**桥**

```js
function nextEvent(cursor, timeoutMs, liveCursor) {
  const structureChanged = cursor !== revision;
  const liveChanged = liveCursor !== liveRevision;
  if (structureChanged || liveChanged) return Promise.resolve(packet());
  // 共用 waiters：bump() 和 bumpLive() 都会 fire
  return new Promise(resolve => { /* 超时返回 packet() */ });
}

function packet() {
  return {
    cursor: revision,
    changed: /* 结构是否变 */,
    liveCursor: liveRevision,
    live: livePacket()
  };
}
```

- `bump()` 只给结构 revision 自增；`bumpLive()` 只给 liveRevision 自增；
- 二者都唤醒同一组 waiter；
- 返回的是 **live 全量 tail**（不是 delta）：天然幂等，丢一次响应也不会缺字；
  文本受 `sanitize` 的 20000 字符上限约束（与现有节点一致）。

**原生**

```ts
const event = await bridge.nextEvent(cursorRef.current, 20000, liveCursorRef.current);
if (event.changed) {
  cursorRef.current = event.cursor;
  await refreshSnapshot();          // 结构变化才拉全量
}
if (event.liveCursor !== undefined && event.liveCursor !== liveCursorRef.current) {
  liveCursorRef.current = event.liveCursor;
  setLive(event.live ?? null);      // 文本/思考/工具块增量
  setLiveTick(v => v + 1);          // 自动吸底用
}
```

**调用链**

```text
chunk → bumpLive → nextEvent 返回 {changed:false, liveCursor+1, live}
                 → setLive（几十~几 KB）
结构/收尾 → bump → nextEvent 返回 {changed:true, ...} → refreshSnapshot（全量）
```

**优点**：一个循环、一组 waiter、两个 cursor；结构快照只在真正需要时拉；
live 全量 tail 幂等，不需要处理 delta 丢包 / 乱序；取消逻辑与现有 `token` 机制一致。

**缺点**：要改 `nextEvent` 的调用签名与返回 DTO（旧桥会忽略第三个参数，可兼容）；
原生端要维护两个 cursor 与 live 去重；桥版本号要升到 3。

**适合**：本项目的长期形态。

### 3.4 对比

| | B1 | B2 | B3 |
|---|---|---|---|
| 传输 | 全量 snapshot 带 live | 新增 `live()` | `nextEvent` 带 live |
| 每个 chunk 的负载 | 全量快照（51KB 起，随历史增长） | live tail（KB 级） | live tail（KB 级） |
| 结构快照频率 | 每个 chunk 一次 | 仅结构变化 | 仅结构变化 |
| 长轮询数量 | 1 | 2 | 1 |
| 取消 / 重连 | 最简单 | 两套循环 | 一套循环 + 两个 cursor |
| 旧桥兼容 | 字段可选，天然兼容 | 方法缺失可探测、降级 | 第三参数被忽略、字段缺失可降级 |
| 代码量（估） | +60~90 行 | +140~180 行 | +100~140 行 |
| 结论 | 先跑通可用 | 可行但重复 | **推荐** |

### 3.5 必须配套：`bump()` 去噪

这是 B1/B2/B3 都绕不开的一点，实测确认：

- `session.ts:707-733` 的 `publishAssistantEntry` 每收到一个 transient chunk 都会
  `this.notifier.markDirty()`（microtask），因此 `binding.session.subscribe` 会**按 chunk** 触发；
- 桥目前把 `session.subscribe(bump)` 直接接到结构 revision 上，
  实测流式期间 revision 每秒涨几十次，但节点内容并没有变；
- 如果不处理，B3/B2 也会在每个 chunk 触发一次全量 `refreshSnapshot()`，优化归零。

处理：只比较原生 UI 真正用到的字段，变化了才 bump：

```js
let statusKey = statusDigest(binding.session.getSnapshot());
session.subscribe(() => {
  const next = statusDigest(binding.session.getSnapshot());
  if (next === statusKey) return;
  statusKey = next;
  bump();
});

function statusDigest(s) {
  return [
    s.running === true,
    s.hasMore === true,
    s.lastAgentError ?? '',
    s.promptError?.message ?? ''
  ].join('\u0000');
}
```

`chat.subscribe(bump)` 保留：离屏时 chat 只在 rAF flush（2~3 次/秒），结构变化可接受；
收尾的 `settle-assistant` 是 **immediate** 发布，不受节流影响（
`packages/client/ui-conversation/src/client/conversation/assembler.ts:286-319`）。

### 3.6 版本与降级

- 桥 `VERSION` 2 → **3**，`ping.methods` 增加 `'liveStream'`；
- `nextEvent(cursor, timeoutMs, liveCursor)`：旧桥忽略第三个参数，只返回
  `{cursor, changed}`；新原生端发现没有 `liveCursor` 就关闭 live 分支（行为退回当前状态）；
- 新桥 + 旧原生端：多出来的字段被忽略，`changed` 语义不变；
- 原生 `waitReady` 对 `liveStream` 做**软检测**：缺失时提示一次
  “dsh-obsidian-bridge 需更新并重启服务才能流式”，不阻塞面板其余功能。

## 4. 改动清单（B3）

| 文件 | 改动 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | `VERSION`→3；live 累加器；订阅 `binding.eventSource`；session 订阅按 digest 去噪；`nextEvent` 增加 `liveCursor` / `live`；ping 增加 `liveStream`；cleanup 退订 |
| `src/shared/native-types.ts` | `NativeChatLive`、`NativeChatLiveBlock`；`NativeEvent` 增加 `liveCursor?` / `live?` |
| `src/view/native/core-bridge.ts` | `nextEvent(cursor, timeoutMs, liveCursor)`；`probe` 暴露 `liveStream` 能力 |
| `src/view/native/ui/native-chat-root.tsx` | `live` / `liveTick` state；poll 处理 live；切会话 / 卸载时重置；能力缺失提示一次 |
| `src/view/native/ui/timeline.tsx` | 接收 `live` / `liveTick`；自动吸底依赖 liveTick |
| `src/view/native/ui/timeline-model.ts` | `buildTimeline` 接受 live，生成合成节点并去重 |
| `styles.css` | 可选：流式光标 / 未完标记（仅当需要） |
| `docs/architecture.md` | 数据流增加“事件流 → live → 合成节点”；桥版本 v3 |
| `docs/development.md` | 改动地图；桥更新 + 重启步骤 |
| `docs/troubleshooting.md` | 流式不出现 / 桥版本过旧的排查项 |
| `docs/roadmap.md` | 记录完成状态与时间戳 |

## 5. 行为变化

- 回合运行中，正文 / 思考 / 工具参数按 chunk 出现，不再等回合结束；
- 回合结束后 live 行消失，由正式节点接管，内容与现在一致；
- 停止 / 错误 / 重试：live 清空，不残留半截文本；
- 旧桥或未重启服务时，行为与现在完全相同（整段出现），只多一条一次性提示。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 事件语义随 dsh 小版本变化（chunk 类型 / settle 时机） | live 行不出现或重复 | 关闭 live 分支（能力开关），退回整段出现 |
| 桥改动需重新 link + 重启服务 | 当前面板会话中断 | 提前告知；只影响本地开发会话 |
| 去重不严（settle 与 live 同帧） | 正文重复一小段 | 合成节点按 turn/step 去重；异常时 live 清空 |
| live 文本超过 20000 字符被截断 | 超长回复尾部不流式 | 与现有节点上限一致；最终消息不受影响 |
| 两条 cursor 处理错误 | 卡住不更新 | 重新 `subscribe` 即可恢复；保留 `refreshSnapshot` 兜底轮询 |

回滚：还原桥与四个原生文件即可；桥回滚后需重新 link + 重启服务。

## 7. 验证

1. `npm run build`、`npm run check`；
2. 重新 link `packages/dsh-obsidian-bridge` 到 profile，重启 DSH 服务；
3. 面板里发送 300+ 字回复：运行中正文出现 **≥ 3 个中间值**；
4. 思考 / 工具调用也逐步出现；工具结果与最终文本无重复；
5. 流式中点“停止”：live 立即清空，不残留；
6. 流式中切换会话 / 关闭面板再打开：不串会话、不残留；
7. 打开一个**正在运行**的会话（订阅时已在回合中）：live 能补齐；
8. 旧桥（未重启）场景：面板可用、不流式、提示一次；
9. 回归：审批、提问、模型 / 权限菜单、当前笔记引用、加载更早、重命名；
10. 记录流式期间的全量快照次数与 live 单包大小（CDP 或临时日志），确认没有按 chunk 拉全量。

## 8. 拍板结果

- [x] 传输：**B3**（`nextEvent` 携带 `liveCursor` / `live`）
- [x] 桥版本升到 3；缺 `liveStream` 时软降级 + 提示一次
- [x] live 包含 reasoning 与 tool-call 参数
- [x] 不做方案 A（不保留临时开关）

## 9. 实施记录

### 实际改动

| 文件 | 改动 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | `VERSION`→3；订阅 `binding.eventSource` 并维护 live 累加器；`nextEvent(cursor, timeoutMs, liveCursor)` 返回 `liveCursor` / `live`；session 订阅按 digest 去噪；live 增量按 50ms 合并；ping 增加 `liveStream`；cleanup 退订并清空 live |
| `packages/dsh-obsidian-bridge/package.json` | 版本 0.2.0 → 0.3.0 |
| `src/shared/native-types.ts` | `NativeChatLiveBlock` / `NativeChatLive`；`NativeEvent` 增加 `liveCursor?` / `live?` |
| `src/view/native/core-bridge.ts` | `nextEvent` 第三参数；`probe` 记录 `liveStream` 能力；`supportsLiveStream()` |
| `src/view/native/ui/native-chat-root.tsx` | live / liveTick state 与 cursor；poll 处理 live；切会话重置；旧桥提示一次 |
| `src/view/native/ui/timeline.tsx` | 接收 live / liveTick；自动吸底依赖 liveTick |
| `src/view/native/ui/timeline-model.ts` | `buildTimeline` 接受 live，生成合成 assistant-step 并去重 |
| `docs/` | 架构 / 开发 / 排障 / 路线图 / 本提案 |

与提案的两处偏差（均为实现细节，不改变方案）：

1. **live 增量合并 50ms**：reasoning 的 chunk 会成串到达（实测同一批 1ms 级），
   不合并会让 `nextEvent` 与 React 每秒被唤醒上百次；合并后最多 20 次/秒。
2. **旧原生端兼容判断**：`liveCursor === undefined` 时 waiter 忽略 live 唤醒，
   避免旧原生端（只传两个参数）在流式期间被 live 唤醒后空转。

### 验证结果（2026-10-27，CDP + 真实面板）

- `npm run build` 通过；`npm run check` 全部通过（版本 / 依赖 / tsc / bridge 语法 / main.js 一致）。
- 桥 v3 加载：`ping` 返回 `methods: [..., "liveStream"]`。
- 原生面板发 300+ 字回复：时间线文本在 4.8s / 5.0s / 5.4s / 5.5s / 5.8s / 6.3s 连续增长，
  结束（6.8s）由正式节点接管；截图确认“已思考 / 用时 7 秒”折叠与完整正文。
- 全量快照次数：12 秒内 15 次（约 1.25 次/秒），没有按 chunk 拉全量。
- 流式中点停止：`running` 结束、无残留 live、出现“已停止 用时 4 秒”的正式中断消息、无错误条。
- 流式中切换会话：时间线从 3673 字切到目标会话的 419 字，无串会话、无错误条。
- 打开正在运行的会话（订阅时已在回合中）：`nextEvent` 首次即返回 live（正文 66 字 / 思考 390 字）。
- 工具参数流式：`run_code` 的 `argsRaw` 从 92 → 147 → 218 → 282 → 333 → 375 字逐步出现，
  该 step settle 后 live 清空，正式 tool-call 节点接管。
- 去重修正：首轮验证发现“官方 UI 在 rAF 里短暂物化同一 step 的 running 节点”会和 live 重复正文
  （settle 时长度从 3544 掉到 3071）。在 `timeline-model.ts` 的 running 期间过滤同 turn/step 的官方节点后
  复测：5774 → 5894 → 6021 → 6196 → 6250，settle 不再回退，最后一个正文块 533 字与最终节点一致。
- 回归：发送、停止、会话切换、模型/权限菜单未受影响；面板无“事件通道中断”错误条。

### 生效方式

桥改动需要 **重新 link 到 profile + 重启 DSH 服务**（本地已 link）。本次验证通过
「禁用/启用插件 → 重新打开原生面板 → 重启 DSH 服务」完成；用户升级插件后同理。
旧桥未重启时面板仍可用，只是不流式，并提示一次。
