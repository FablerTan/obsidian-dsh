---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27     # 用户当轮选定路径 A + 历史会话先不管 + 标题一变就刷新
scope: src/view, docs   # 若选 A2 / B 还会涉及 packages/dsh-obsidian-bridge
issue: 新建会话全叫「新会话」，启用官方「随对话更新的标题」也不变——建会话时的 rename 把标题钉死，面板列表也不跟随标题变化
---

# 0033 新会话标题：不再 rename「新会话」，让 DSH 标题随对话更新

> 对应路线图 [R-16](../roadmap.md#需求待办)。承接 [0013](0013-native-chat-compact-ui.md)（新会话默认名）与
> [0032](0032-optional-bundles.md)（实验性插件启停入口）。

## 1. 背景与问题

### 现象

- 面板里新建的会话全部叫「新会话」，发完消息也不变。
- 在「插件」tab 启用官方实验插件 **随对话更新的标题**
  （`@deepseek-ai/dsh-experimental-session-titles-bundle`）并重启服务后，标题仍然不变。

### 根因（已核对本机代码与真实会话日志）

1. **建会话时显式 rename，把标题钉死。** [0013](0013-native-chat-compact-ui.md) 为了让新会话显示「新会话」，
   `createSession()` 在桥返回后立刻调用 `bridge.renameSession('新会话')`
   （[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) 的 `NEW_SESSION_TITLE`）。
2. **DSH 把显式 rename 视为「用户固定标题」。** `dsh-session-title` 的 `rename()` 追加
   `session/title { source: { kind: "user" } }`；服务在 `onUserMessage()` 里遇到 user 源直接 return，
   后续用户消息**不再调度任何自动标题**（首消息 provider 与随对话 provider 都不会跑）；
   只有显式 `refresh()` 才能解钉。
3. **实验插件只是换 provider，不会覆盖用户固定标题。** `dsh-experimental-session-titles-bundle`
   通过 `cordis.patch.yml` 关掉 `session-title-llm`、插入 `dsh-session-title-all-prompts-llm`
   （每条符合条件的用户消息触发一次修订）。它对非 pinned 会话有效，对 rename 过的会话完全无效。
4. **面板的会话列表也不会跟随 DSH 侧的标题变化。** 桥只订阅 `chat` / `session` / `sessionStatus`
   与上下文投影，不订阅 `sessions.list` 的 `title`；面板只在 boot / 新建 / rename / 菜单「刷新」时
   重拉列表（[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) 的 `refreshSessions`）。
   所以即使某个标题在 DSH 侧生成成功，列表也要等下一次手动刷新才变。

### 证据（2026-10-27 本机）

- `~/.dsh/sessions/--<vault 路径编码>--` 的 60 个会话中，**40 条**
  `session/title` 的 source 是 `{"kind":"user"}`、标题恰为「新会话」（即 0013 的 rename）。
- 16:05–16:08 用户启用过该实验 bundle（profile `package.json` 与 `.bak-*` 备份可见），
  16:07 有一条真实会话发了消息（「检查一下当前项目…」），日志里**没有任何 `title-llm-request`**——
  因为标题已 pinned。
- 反证：改造前的旧会话（未 rename）能正常生成标题——`session-69b277cc` 的
  `session/title` 记录就是 `session-title-all-prompts-llm` 生成的「Obsidian 禅模式插件查找」。
- 桌面端（不走本插件 rename）同一机制工作正常：当前这条桌面会话的标题就是 provider 生成的。

### 影响

新会话标题永远停在「新会话」；实验性标题插件在 Obsidian 面板里等于失效。

## 2. 目标与非目标

- 目标：
  - 新会话在**未发消息**时仍显示「新会话」（保持 0013 的视觉）。
  - 发出第一条消息后，标题由 DSH 生成（默认首消息 provider → fallback/LLM）。
  - 启用「随对话更新的标题」并重启服务后，后续用户消息会按 provider 修订标题。
  - 标题变化后，面板标题与会话列表**无需手动刷新**即可跟随。
- 非目标：
  - 不改 DSH 侧的标题服务 / 实验 bundle 本身。
  - 不批量迁移历史 40 个已 pinned 的「新会话」（可作为后续需求）。
  - 不动会话列表的排序、搜索、过滤规则。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）原生端去钉 + 列表跟随** | ① 删掉 `createSession()` 里的 `bridge.renameSession(NEW_SESSION_TITLE)`（[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx)）；blank 会话继续由 `sessionTitle()` 把「cwd 目录名」显示成「新会话」（DSH 的 `displayTitleOf` 对无标题会话返回 cwd basename，本机实测成立）。② 在 `refreshSnapshot()` 里比较新标题与当前会话标题，变化时 `refreshSessions()`（或收到 turn/end 时刷一次），让列表跟随。 | 只改 `src/view/native/ui/native-chat-root.tsx`（约 10~20 行）；不用改桥、不用 relink、不用重启服务 | 小。风险：DSH 若将来把无标题会话的 displayTitle 改成别的（不是 cwd basename），占位判断要跟着改；需补一条兜底（空标题也显示「新会话」）。 | **推荐**：直击根因（不再写 user 源标题），改动力度最小，标题恢复自动化 |
| A2：A + 桥 v6 解钉历史会话 | 在 A 之上，桥新增 `refreshTitle()`（调 `sessionTitle.refresh()`，对当前订阅会话解钉并重生成）；打开标题仍是「新会话」的旧会话时调用一次。 | 桥 + 原生端 + relink + 重启 | 中。能救回历史 40 个会话，但 `refresh()` 要求会话 live（桥要 retain/打开该会话），且会额外发一次标题 LLM 请求。 | 可以拆成后续需求；本期不做 |
| B：保留 rename，发消息后解钉 | 保留建会话 rename；桥 v6 暴露 `refreshTitle()`，面板在首条消息后（以及启用实验插件后每条消息后）调用，用显式 refresh 覆盖 user 标题。 | 桥 + 原生端 + relink + 重启 | 大。每条消息都可能额外发标题请求（与 provider 的调度重复/打架），且标题钉住期间仍是「新会话」；维护成本明显高于 A。 | 不推荐 |
| C：rename 成首条消息片段 | 建会话不改名，发首条消息时由插件自己截取消息开头 rename。 | 原生端 | 小，但仍是 user 源 → **永远不会随对话更新**，只是换个固定名。 | 不推荐（与目标冲突） |
| D：保持现状 + 文档说明 | 不改代码，只在文档里说明「新会话标题是设计如此」。 | 文档 | 无 | 不推荐（实验插件看起来失效） |

## 4. 改动清单（按 A）

| 文件 | 改动 |
|---|---|
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 删除 `createSession()` 里的 `renameSession`；`sessionTitle()` 保持 blank → 「新会话」；`refreshSnapshot()` 检测标题变化并 `refreshSessions()` |
| 本提案 / [roadmap](../roadmap.md) / [changes/README](README.md) | R-16 状态、提案索引 |
| [docs/development.md](../development.md) | 改动地图补标题链路（如需要） |

> 若选 A2 / B，再加：`packages/dsh-obsidian-bridge/lib/client.js`（v6 `refreshTitle`）、`src/view/native/core-bridge.ts`、
> bridge README、relink 与重启说明。

## 5. 行为变化

- 新建会话（`+`、`/new`、空状态按钮、会话选择器「新建会话」）仍显示「新会话」。
- 发第一条消息后：先出现 DSH 确定性 fallback 标题（首条消息开头），随后（默认首消息 provider）变成模型生成的短标题。
- 启用「随对话更新的标题」并重启后：每条符合条件的用户消息都会触发标题修订，面板标题与列表跟随更新。
- 历史已 pinned 的「新会话」保持不变（非目标；需要时可走 A2）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 无标题会话的占位判断依赖 DSH 的 displayTitle（cwd basename） | 可能显示成仓库目录名而不是「新会话」 | `sessionTitle()` 增加空标题兜底；回归时覆盖新建/重命名/旧空白会话三种 |
| 标题变化触发 `refreshSessions()` 太频繁 | 每次标题变化多一次列表 IPC | 只在标题字符串变化时刷新；必要时改为 turn/end 触发 |
| 用户的既有使用习惯（列表里全是「新会话」）改变 | 会话列表出现真实标题 | 无需回滚；旧会话仍叫「新会话」 |

## 7. 验证

自动化：

```bash
npm run build
npm run check
```

手动回归（Obsidian 内）：

1. 打开面板 → 新建会话：标题与列表都显示「新会话」，无 rename 调用（可在 `package.json`/日志侧忽略）。
2. 发送「检查一下当前项目」：标题变成该句派生的 fallback；约 1s 后变成模型标题（默认首消息 provider）。
3. 打开会话选择器：列表里的该会话标题同步更新，无手动刷新。
4. （可选）在「插件」tab 启用「随对话更新的标题」→ 重启服务 → 同一会话再发一条消息，标题按 provider 修订；
   再发一条不同主题的消息，观察标题是否更新（模型可能保留旧标题，属正常）。
5. 旧 pinned 会话（标题「新会话」）行为不变。

**验收标准**：新建会话仍显示「新会话」；发消息后无需手动刷新就能看到 DSH 生成/更新的标题；日志里出现 `title-llm-request`（启用 provider 时）；`npm run build` / `npm run check` 通过。

## 8. 需要你拍板

- [x] 选哪条实现路径：**A**（A2 / B / C / D 不做）
- [x] 历史已叫「新会话」的会话：**先不管**（A2 留作后续需求）
- [x] 列表跟随的时机：**标题一变就刷新**

## 9. 实施记录（2026-10-27）

### 实际改动

- [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx)：`createSession()` 删除
  `renameSession('新会话')`；`sessionTitle()` 保留 blank + cwd 目录名的占位映射并补空标题兜底；
  顶栏标题也走同一套占位映射（否则空白会话会显示仓库名）；`refreshSnapshot()` 用 `titleRef` 比较快照标题，
  一变就 `refreshSessions()`；`attachSession()` 重置 `titleRef`。
- [packages/dsh-obsidian-bridge/lib/client.js](../../packages/dsh-obsidian-bridge/lib/client.js)：`subscribe()` 的投影订阅
  从 `contextPressure` / `contextBreakdown` 扩到 `title`，标题一变就 `bump()`（不新增 API、不改协议版本）。
- docs：本提案；[roadmap](../roadmap.md) R-16；[changes 索引](README.md)；[development](../development.md) 回归 16 / 50；
  [architecture](../architecture.md) 桥订阅说明；[troubleshooting](../troubleshooting.md) 新增「标题一直是新会话」；
  [bridge README](../../packages/dsh-obsidian-bridge/README.md) 实现要点。

### 与提案的偏差（变更记录）

- 提案 A 写的是「只改原生端、不改桥」。拍板要求「标题一变就刷新」，而桥的结构 revision 只在
  `running / hasMore / lastAgentError` 或会话事件变化时 bump——标题 LLM 在回合结束之后才完成时会漏。
  因此桥额外订阅了 `title` 投影（一行改动，**不新增 API、不改协议版本**），代价是**需要重启 DSH 服务**才生效。
  其余严格按 A 执行。

### 验证结果（Obsidian 1.14.5 + dsh 0.2.x + 0.4.1）

- `npm run build` 通过（`main.js` 271.0kb）；`npm run check` 全绿。
- CDP 实测（重载插件 → 自动拉起新服务 → 打开原生面板）：
  - 新建会话：顶栏显示「新会话」（不是仓库名）；会话列表同项也显示「新会话」。
  - 发送「你好，测试一下会话标题会不会自动更新」→ 12s 后顶栏变「测试会话标题自动更新」，会话选择器首行
    同步为该标题——**没有手动刷新**。
  - 会话日志（`session-a77b9793-…`）：`seq 15` fallback（「你好，测试一下会话标题会不」）→
    `seq 16` `title-llm-request`（`session-title-first-prompt-llm`）→ `seq 17` provider 标题
    （「测试会话标题自动更新」）；**没有** `source: {"kind":"user"}` 的 `session/title` 事件（证明不再被 rename 钉住）。
- 未现场验证：「随对话更新的标题」bundle 的运行时修订（这次没有改 profile 开关）。前置条件已满足——
  标题来源是 provider（非 user），DSH 的 `all-prompts` 在每条符合条件用户消息后调度；该 provider 在本 profile
  之前已实测能生成标题（`session-69b277cc` 的「Obsidian 禅模式插件查找」）。要现场确认：插件 tab 启用 →
  重启服务 → 同一会话再发一条不同主题的消息。
- 测试产物：vault 会话列表里多了一条「测试会话标题自动更新」的测试会话（正常，可忽略）。
