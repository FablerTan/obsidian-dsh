# dsh-obsidian-bridge

Obsidian 嵌入专用（纯客户端）DSH 插件。与 [obsidian-dsh](https://github.com/FablerTan/obsidian-dsh) 同仓库维护
（`packages/dsh-obsidian-bridge/`），作为插件原生聊天视图的数据源：

- **v8 原生数据桥**：会话列表、ChatSnapshot、会话动作、审批 / 提问答案、liveStream 流式
  正文 / 思考 / 工具参数、上下文占用（contextPressure / contextBreakdown 投影）、输入框命令 / 技能目录、
  Agent Teams 团队投影（`agentTeam` + 成员运行状态 / 模型）、子智能体目录（父会话 `subagentCatalog`
  + 子会话状态 / 耗时 / token / 模型）与 addressed 订阅（按 `SubagentAddress` 打开子会话），
  以及目标条数据（`goal` 投影 + `edit` / `pause` / `resume` / `clear` 目标操作），供 Obsidian 原生 UI 渲染。

> **只支持 DSH 0.2.x**。0.1.x、iframe 回退、非 token 鉴权实例都不在支持范围。
>
> API 版本为 **8**（包版本 0.5.0）；原生视图要求 v2+，其中流式需要 v3（缺 `liveStream` 时面板软降级为整段出现并提示一次），
> 上下文占用需要 v4（缺 `context` 时原生输入栏显示灰色空环），命令 / 技能菜单需要 v5，
> Agent Teams 团队入口需要 v6（缺 `team` 时不显示团队图标，其它功能不受影响），
> 子智能体入口与子会话导航需要 v7（缺 `subagents` 方法时不显示入口，其它功能不受影响），
> 目标条需要 v8（缺 `goal` / `goalAction` 方法时不显示目标条，其它功能不受影响）。
> 0008 的 native-only 面板删除了 v1 布局方法，0011 已把对应代码从包里移除。

## 对外 API（页面全局）

```js
window.__DSH_OBSIDIAN_BRIDGE__ = {
  version: 8,
  ping(),                                  // -> { version, native, methods }（methods 含 liveStream / context / team / subagents / goal / goalAction / commands）

  listSessions(),                          // -> { phase, sessions: [{ id, title, cwd, running, blank, updatedAt, origin, parentId }] }
                                           //    origin='subagent' 的子会话行由原生面板过滤（不进会话选择器）
  createSession(cwd?),                     // 新建会话并订阅 -> { ok, sessionId }
  subscribe(sessionId | { parentSessionId, childSessionId, mode }), // -> { ok, sessionId, revision }（后者 retain 子会话）
  unsubscribe(),                           // -> { ok }
  snapshot(),                              // -> { revision, sessionId, title, session, subagent, order, nodes, navigation, timeline, pending }
                                           //    subagent: { address: { parentSessionId, childSessionId, mode }, parentAvailable? } | null
  nextEvent(cursor, timeoutMs, liveCursor?), // 长轮询：结构变化 / live 更新都会返回
                                            // -> { cursor, changed, liveCursor, live: { turn, step, attemptId, blocks } | null }
  send(text),                              // -> { ok }
  cancel(),                                // -> { ok }
  loadOlder(),                             // -> { ok }
  models(),                                // -> { current, routable, groups, failures }
  selectModel({ provider, model, reasoningEffort? }), // -> { ok, selected }
  permissions(),                           // -> { currentValue, options } | null
  setPermission('workspace-write'),        // -> { ok }（内部走 /permission 命令）
  renameSession(title),                    // -> { ok, title }
  approvalAnswer('allowed-once'|'rejected'),// -> { ok }
  questionAnswer({ answers: [...] }),      // -> { ok }
  context(),                               // -> { pressure: { pressureTokens?, projectedTokens?, contextWindow? } | null,
                                           //      breakdown: { systemTokens, toolsTokens, messageTokens } | null }
  commands(), skills(), executeCommand(line),
  team(),                                  // -> { members: [{ id, name, role, phase, error?, running, pendingInteraction, model }],
                                           //      tasks: [{ id, revision, subject, description, status, blockedBy,
                                           //                writeScopes, ownerName?, ready, writeScopeWarnings }],
                                           //      failure? } | null（未启用「智能体团队」时为 null）
  subagents(),                             // -> { rootSessionId, currentSessionId, entries: [{ id, label, title, mode,
                                           //      createdAt, running, pendingInteraction, unread, settledMs, activeSince,
                                           //      totalTokens, model, current }] }
                                           //    目录来自父会话 subagentCatalog（只含直接子级、过滤 external）
  goal(),                                  // -> { id, revision, objective, phase, blockedReason?, maxGoalRounds,
                                           //      roundsStarted, activation? } | null（当前会话没有目标时 null）
                                           //    phase: active | paused | blocked | complete；activation: armed | disarmed
  goalAction(action, value?),              // 'edit' | 'pause' | 'resume' | 'clear'
                                           // -> { ok: true } | { ok: false, error: { code, message } }
                                           //    edit 需要非空 objective；ref 取当前投影的 { id, revision }
};
```

`snapshot().nodes` 是 JSON 投影（`key/id/kind/anchorSeq/turn/step/visibility/data`），
`data` 经过有界序列化（Map/Set/Date/循环引用、深度 8、数组 300、字段 60、字符串 20k）；
未知 kind 的数据原样保留，由原生 UI 决定是否渲染。

Obsidian 侧通过 `<webview>.executeJavaScript()` 调用；无桥时插件降级为「打开面板」提示，不会崩。

## 激活

在本仓库根目录执行（路径按实际 checkout 替换）：

```bash
dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge
# 重启 obsidian profile 的 GUI / 在 Obsidian 设置里「重启 DSH 服务」后生效
```

如果 profile 之前 link 的是外部旧路径，先 `dsh plugin --profile obsidian remove dsh-obsidian-bridge`
再按上面的命令重新 add，否则 link 会指向不存在的目录。

## 实现要点

- host 半身 `lib/index.js` 为空（纯客户端插件，保证 loader 正常导入）。
- v2：`sessions.retain(id)` + `uiSession.adapter.bindingSource(ref)` 取 `hooks.chat` / `hooks.session`；
  `uiSession.sessionStatus` 取 `pendingInteraction`；发送/停止/加载更早直接走
  `ref.binding.session`（`SessionFace`），避免 scope 寻址丢失会话标签。
- v3 liveStream（0017）：同步订阅 `ref.binding.eventSource`，把 `assistant/live-chunk` 折成
  `blocks`（text / reasoning / tool-call），`settle-assistant` / `assistant/message` 清空。
  0021 起**每个 chunk 立即递增 liveRevision 并唤醒原生端**（不在桥里做定时合并：离屏 webview 的
  `setTimeout` 会被 Chromium 拖到 ~75ms，反而把刷新率压到 13Hz）；合并/节流由原生端的
  `requestAnimationFrame` 按设置完成。结构 revision 与 liveRevision 分离，session 订阅按
  `running / hasMore / lastAgentError` 去噪，避免每个 chunk 触发全量快照。
- 模型：`sessions.models({ sessionId })` / `sessions.selectModel(...)`；权限：
  `session.projections.faceOf('permissions')` 与 `session.command('/permission <value>')`；
  重命名：`sessions.rename({ sessionId, title })`。
- 上下文占用（v4 / 0022）：读取 `session.projections.faceOf('contextPressure')` 与
  `faceOf('contextBreakdown')`；订阅时同时订阅这两个 face 并在变化时 `bump()`，
  让 `nextEvent` 能唤醒原生端刷新圆环。投影缺字段时返回 `null`，原生端画灰色空环。
- 标题（0033）：订阅会话的 `title` 投影，标题一变就 `bump()`，`snapshot().title` 与 `listSessions()` 立即反映，
  原生面板的标题与会话列表无需手动刷新。**不要在新建会话时 `renameSession('新会话')`**：显式 rename 会被
  DSH 当成用户固定标题，首消息 / 随对话的自动标题从此不再更新。
- 团队（v6 / 0035）：读 Lead 会话的 `agentTeam` 投影（dsh 实验性 bundle「智能体团队」）；
  投影只带持久 roster（phase / error）与任务板，`team()` 额外拼上成员的 `running`
  （`uiSession.sessionStatus`，与 Web 面板同源）、`pendingInteraction` 与 `model`
  （`sessions.list.projectionsBySession[...].modelSelection`）。订阅键表加入 `agentTeam`，
  团队变化会唤醒 `nextEvent`。未启用 bundle 时投影不存在，返回 `null`，原生端隐藏入口。
- 子智能体（v7 / 0041）：
  - `subagents()`：目录根 = 当前会话；当前是子会话时取它的父会话（这样能列出兄弟）。条目来自会话列表快照里的
    summary 投影 `subagentCatalog`，逐行拼 `subagentTiming`（耗时）、`tokenUsage`（token 四桶之和）、
    `modelSelection.next.model` 与 `uiSession.sessionStatus`（`running` / `pendingInteraction` / `completionUnread`）。
    只列**直接子级**并跳过 `external`；目录缺失时先 `refreshProjections` 再读一次，仍没有就返回空数组（原生端隐藏入口）。
  - `subscribe(address)`：接受 `SessionId` 或 `{ parentSessionId, childSessionId, mode }`；后者走 `sessions.retain(address)`
    并按地址调 `uiWorkspace.openSession()` 让隐藏 core 跟随。dsh 侧 `prompt` / `cancel` 对子会话自动路由
    （`subagents/prompt` / `subagents/interruptByParent`），所以续聊与 Stop 不需要新协议。
  - `snapshot().subagent` 透传 `session.subagent`（地址 + `parentAvailable`），供原生端做面包屑与只读判定。
  - 订阅键表补 `subagentCatalog` / `subagent` / `subagentTiming`；另外只对**目录根**的 `subagentCatalog` 做摘要订阅，
    目录变化才唤醒原生端，避免会话列表的任何变化都触发刷新。
- 目标条（v8）：
  - `goal()` 读会话的 `goal` 投影（`goal` 快照 + `roundsStarted`），返回目标条需要的
    `id / revision / objective / phase / blockedReason / maxGoalRounds / roundsStarted`；没有目标或投影未注册时返回 `null`。
  - `activation` 是进程内状态、**不在 durable 投影里**：phase 为 `active` 且缓存未命中时，
    后台调一次 `remote.goals.get(sessionId)`（同一 `{ id, revision }` 并发去重），读到后缓存并 `bump()`；
    同时订阅 `remote.$on('goal/activation-changed')`，事件只跟随当前会话，随订阅一起释放。
    读失败保持静默（目标条只显示 durable phase，不显示激活状态）。
  - `goalAction()` 用投影里的 `{ id, revision }` 作 CAS ref，走 `remote.goals.edit / pause / resume / clear`；
    业务错误与远端失败都返回 `{ ok: false, error: { code, message } }`，不向原生端抛异常。
- 变更通过 revision（结构）+ liveRevision（流式）+ 长轮询推送；不新增 HTTP/SSE 通道。

## 限制

- 依赖 DSH 0.2.x 的 `ctx.sessions` / `ctx.uiSession` 服务；升级后若改名，桥会降级为「服务不可用」。
- 只在 Obsidian 的 Electron `<webview>` 面板里可用；没有 iframe 路径。
- 不做设置入口、不做会话列表 UI、不做 provider / API key 配置；原生 UI 由 obsidian-dsh 渲染。
- 模型/权限/重命名是 v2 的增量方法：旧 v2 页面没有这些函数时，原生视图会提示更新并重启服务。
- `context` 是 v4 的增量方法：v3 桥没有时原生输入栏显示灰色空环，不影响聊天。
- `team` 是 v6 的增量方法：旧桥没有时原生面板不显示团队入口（工具行与消息照常）；
  团队面板只读，不提供创建 / 中断 / 删除，也不能从桥打开队友会话。
- `subagents` 是 v7 的增量方法：旧桥（v6）没有时原生面板不显示子智能体入口，`subscribe` 也只接受 `SessionId`，
  其它功能不受影响；新桥 + 旧插件等同于没有新增能力，行为与 v6 一致。
- `goal` / `goalAction` 是 v8 的增量方法：旧桥（v7）没有时原生面板不显示目标条，其它功能不受影响。
  需要 profile 装有 dsh 的 goal 插件（`remote.goals`），否则 `goalAction()` 返回
  `{ code: 'goal-unavailable' }`；`goal()` 仍可用，只是不带 `activation`。
- 子智能体目录只读取一层直接子级（深层子代理留给后续）。`listSessions()` 会返回子会话行（dsh 0.2.1-rc.3 的列表快照把子会话也放进 `ids`，行上带 `origin: 'subagent'` / `parentId`）；原生面板按 `origin` 过滤，因此子会话不进入会话选择器。