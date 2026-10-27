---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: src/view, styles.css
issue: 点「新建会话」时标题栏下方闪出一条红色横幅（文字与底色同色，实际看不清），偶发常驻
---

# 0012 新建会话时红色错误条一闪而逝（会话切换竞态 + 错误条配色不可读）

## 1. 背景与问题

**现象**（用户报告）：点面板标题栏的「新建会话」按钮（+），标题栏正下方闪出一条红色横幅，几十毫秒就消失；有时会一直留在那里。因为太快，看不清写了什么。

**已用 CDP 在真实面板里复现**（Obsidian renderer，原生面板 rect `x=1225, y=52, w=424, h=834`）：

| 观测 | 值 |
|---|---|
| 点击「新建会话」后 | 60ms 时插入 `.dsh-native-error-banner` |
| 位置 | `x=1225, y=92, w=424, h=38`（header 底边 y=92，正是标题栏下方） |
| 文案 | 「事件通道中断：原生桥调用失败：尚未订阅会话」 |
| 计算样式 | `background: rgb(251,70,76)` / `color: rgb(251,70,76)`（同色，文字不可见） |
| 存活 | 42ms 后被移除（`attachSession` 的 `setError(null)`） |

本机主题下 `--background-modifier-error` 与 `--text-error` 都是 `#fb464c`，所以用户看到的不是"红字提示"，而是一条**纯红色残影**。

**根因（两处叠加）**

1. **切换会话的竞态（红条来源）**：`native-chat-root.tsx` 的 `poll()` 长轮询停在 `bridge.nextEvent()` 里；`createSession()` → 桥 `createSession()` 内部 `subscribe()` 先 `cleanup()`（`active = null` + `bump()`），把旧轮询唤醒，旧轮询接着调 `bridge.snapshot()`，桥侧 `snapshot()` 见 `active === null` 直接抛 `尚未订阅会话` → `poll` 的 catch 写入 `setError('事件通道中断：…')`。此时 `attachSession` 还没走到 `tokenRef.current += 1`，旧轮询仍被视为"当前轮询"。几十毫秒后 `attachSession` 执行 `setError(null)`，红条消失——就是用户看到的"一闪而逝"。
2. **失败时常驻**：若 `attachSession` 在 `tokenRef` 递增之前抛错（桥侧 `subscribe` 最多等 5s 拿 binding/hooks，超时会抛；或 `sessions.create` 失败），旧轮询不会被作废，之后每 1.2s 重试一次并把同一条错误重新写回 `error`，红条就会反复出现/常驻，且会覆盖掉真正的失败原因（"新建会话失败：…"）。

**为什么以前没发现**：现有实现没有考虑"切换会话期间桥侧 `active` 短暂为 null"是正常状态；同时错误条沿用 `--background-modifier-error` + `--text-error`，在部分主题下两者同色，视觉上退化成一条红条。

## 2. 目标与非目标

- 目标：
  - 切换会话（新建 / 打开 / 桥内 subscribe）期间不再产生假错误提示；红条不闪。
  - 切换真正失败时只显示一条可读的失败原因，且旧轮询立即停止，不刷屏。
  - 错误条在任何主题下文字可读（背景与文字不再同色）。
- 非目标：
  - 不改桥（`packages/dsh-obsidian-bridge/lib/client.js`）的 `subscribe`/`snapshot` 语义，避免重新 link + 重启服务。
  - 不改变 `lastAgentError`（"会话错误"）横幅的常驻行为。
  - 不动其他错误文案（"发送失败 / 打开会话失败"等前缀保持原样）。
  - 不引入动画/淡出，红条仍然即时出现、即时消失。

## 3. 方案

### 方案 A（推荐，只改插件侧 + 样式）

**A1. 切换前先作废旧轮询**（`src/view/native/ui/native-chat-root.tsx`）
新增一个 `invalidatePoll()`（`tokenRef.current += 1`），在 `createSession()` 与 `openSession()` 的**第一步**调用（早于 `bridge.createSession` / `bridge.subscribe`）。这样旧轮询在 `nextEvent` 返回后、以及 catch 里都会命中已有的 `token !== tokenRef.current` 分支直接退出，不会写入 `error`。
`attachSession` 内部原有的 `tokenRef.current += 1` 保留（它同时用于建立新轮询的 token）。

**A2. 把"尚未订阅"当切换中的正常态**（同文件 `poll()` 的 catch）
`NativeBridgeError.reason === 'not-subscribed'` 时不再 `setError`，改为 `await sleep(300); continue;` 静默重试。理由：桥侧只有 `active === null` 会给出该错误，而 `active` 为 null 在本 UI 里只发生在切换窗口（本插件不再调用 `unsubscribe`）；即使意外持续，也只是不刷红条，不会掩盖真正的桥缺失（那会是 `missing`/`version`/`call-failed`）。
（`not-subscribed` 在 `core-bridge.ts` 里已有 reason 常量，判断不需要改桥。）

**A3. 失败时也作废旧轮询**
`createSession()` / `openSession()` 的 catch 分支保持现有单条错误文案；因为 A1 已经作废旧轮询，不会再有 1.2s 反复覆盖。

**A4. 错误条配色**（`styles.css`）
`.dsh-native-error-banner` 改为不依赖 `--background-modifier-error` 的实心值：

```css
.dsh-native-error-banner {
	background: var(--background-secondary);
	color: var(--text-error);
	border-inline-start: 2px solid var(--text-error);
}
```

这样默认主题（半透明红底）与本机主题（实心 #fb464c）都可读；仍然是主题变量，不硬编码颜色。`.dsh-native-error-banner button` 的 `color: inherit` 不变。

### 方案 B（备选）

只做 A4（颜色），靠用户自己忽略闪一下。不选：竞态与常驻刷屏仍在，且属于用户能感知的假错误。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/ui/native-chat-root.tsx` | 新增 `invalidatePoll()`；`createSession`/`openSession` 先作废旧轮询；`poll()` catch 对 `not-subscribed` 静默重试 |
| `styles.css` | `.dsh-native-error-banner` 背景/文字/左边框改为可读组合 |
| `main.js` | `npm run build` 重新生成（不手改） |
| `docs/changes/0012-…md`、`docs/changes/README.md` | 本提案与索引 |

## 5. 行为变化

- 点「新建会话」/ 切换会话：不再出现红色错误条；界面照旧直接进入新会话。
- 真的切换失败（桥报错）：仍显示错误条，但只有一条、文字可读。
- 聊天流中真正的长轮询中断（例如隐藏 core 页面被重载）：仍会提示"事件通道中断"，只是文案不再被同色的假错误覆盖。
- 会话错误（`lastAgentError`）横幅行为不变，只是颜色变可读。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| `not-subscribed` 被静默后，罕见情况下轮询卡在重试循环 | 会话事件不更新，但每 300ms 重试；不会刷红条 | 回滚 `poll()` catch 的该分支 |
| 切换时提前作废 token，导致旧轮询提前退出 | 只影响被替换的会话轮询，新轮询由 `attachSession` 建立 | 去掉 `invalidatePoll()` 调用 |
| 配色改动影响其他使用该 class 的横幅 | 两处横幅（error / agentError）都会变成可读样式 | 回滚 `styles.css` 该规则 |

回滚整体：`git checkout -- src/view/native/ui/native-chat-root.tsx styles.css && npm run build`。

## 7. 验证

自动化：

- `npm run build`、`npm run check` 通过。
- CDP（`pageId` 为 Obsidian 主窗口）：注入 MutationObserver 监听 `.dsh-native-error-banner` 的新增，点击 `.dsh-native-icon-button[title="新建会话"]`，**验收标准**：3s 内 banner 新增次数 = 0（当前实测为 1，存活 42ms）。
- 人为制造错误（停掉 dsh 服务后发送一条消息）：banner 仍出现，且 `getComputedStyle` 的 `color` 与 `background-color` 不再相同（验收：两值不同，文字可读）。

手动：

1. 重载插件 → 打开面板 → 连续点「新建会话」5 次：没有红条闪烁。
2. 从会话选择器切换 3 个会话：没有红条闪烁。
3. 用「更多 → 刷新会话列表」与正常发送：错误条只在真失败时出现，且可读。

## 8. 需要你拍板

- [ ] 配色按方案 A4（`--background-secondary` 底 + 红字 + 左侧红边）还是保留红底、只把文字换成 `var(--text-on-accent)`？
- [ ] 是否接受"插件侧修复、不动桥"（不必重新 link/重启 dsh 服务，只需重载插件）？
- [ ] 是否顺手把"事件通道中断"的文案改成更具体的"与 DSH 页面的连接中断，正在重试…"？（会改一处用户可见文案）

## 9. 变更记录

- **2026-10-26（实施时，用户已批准「按推荐改」）**
  - **A1 未采用**：`createSession`/`openSession` 开头作废旧轮询，会在切换失败时永久停掉当前会话的轮询，界面静默冻结；而 A2 已足以消除假错误与 1.2s 刷屏，并保留切换失败后的存活能力。故只做 A2 + A4。用户可见结果与提案一致（不再闪红条、真失败仍提示一条可读错误）。
  - **A2 需要一处前置改动**：桥返回的「尚未订阅会话」原本被 `core-bridge.invoke()` 一律归为 `call-failed`，`reason === 'not-subscribed'` 永远不成立。实际在 `src/view/native/core-bridge.ts` 把它归类为 `not-subscribed`（多改 1 个文件，行为不变，仅错误归因更准确）。
  - 第 8 节第 3 项「事件通道中断」文案**未改**（保持原文案，避免额外用户可见变更）。

## 10. 实施记录

- 实际改动：
  - `src/view/native/core-bridge.ts`：`invoke()` 把包含「尚未订阅会话」的桥错误归为 `not-subscribed`。
  - `src/view/native/ui/native-chat-root.tsx`：`poll()` 的 catch 对 `not-subscribed` 静默重试（300ms），不再写 `error`。
  - `styles.css`：`.dsh-native-error-banner` 改 `--background-secondary` 底 + `--text-error` 字 + 左侧 2px 红边。
  - `main.js`：`npm run build` 重新生成。
- 验证结果：
  - `npm run build`、`npm run check` 均通过（main.js 与源码一致）。
  - CDP（Obsidian 主 renderer，重载插件后）点击「新建会话」：观察 3.5s，`.dsh-native-error-banner` 新增 **0** 次（修复前 1 次，60ms 出现 / 42ms 消失）。
  - 连续「新建会话 → 打开选择器 → 切到另一个会话」：banner 新增 0 次。
  - 样式探针（同 class 临时节点，测完即删）：`background: rgb(40,40,40)` / `color: rgb(251,70,76)` / `border-left: 2px solid rgb(251,70,76)`，不再同色，位置仍在 header 下方 y=92。
- 与提案偏差：见第 9 节（A1 未做、多改 core-bridge 一处）。
- 生效方式：重载插件即可（未改桥，不需要重启 dsh 服务；验收时已重载一次插件，重启的 dsh 服务由插件自动拉起）。
