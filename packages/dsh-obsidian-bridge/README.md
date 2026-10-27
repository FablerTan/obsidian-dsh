# dsh-obsidian-bridge

Obsidian 嵌入专用（纯客户端）DSH 插件。与 [obsidian-dsh](https://github.com/FablerTan/obsidian-dsh) 同仓库维护
（`packages/dsh-obsidian-bridge/`），作为插件原生聊天视图的数据源：

- **v6 原生数据桥**：会话列表、ChatSnapshot、会话动作、审批 / 提问答案、liveStream 流式
  正文 / 思考 / 工具参数、上下文占用（contextPressure / contextBreakdown 投影）、输入框命令 / 技能目录，
  以及 Agent Teams 团队投影（`agentTeam` + 成员运行状态 / 模型），供 Obsidian 原生 UI 渲染。

> **只支持 DSH 0.2.x**。0.1.x、iframe 回退、非 token 鉴权实例都不在支持范围。
>
> API 版本为 **6**；原生视图要求 v2+，其中流式需要 v3（缺 `liveStream` 时面板软降级为整段出现并提示一次），
> 上下文占用需要 v4（缺 `context` 时原生输入栏显示灰色空环），命令 / 技能菜单需要 v5，
> Agent Teams 团队入口需要 v6（缺 `team` 时不显示团队图标，其它功能不受影响）。
> 0008 的 native-only 面板删除了 v1 布局方法，0011 已把对应代码从包里移除。

## 对外 API（页面全局）

```js
window.__DSH_OBSIDIAN_BRIDGE__ = {
  version: 6,
  ping(),                                  // -> { version, native, methods }（methods 含 liveStream / context / commands / team）

  listSessions(),                          // -> { phase, sessions: [{ id, title, cwd, running, blank, updatedAt }] }
  createSession(cwd?),                     // 新建会话并订阅 -> { ok, sessionId }
  subscribe(sessionId),                    // -> { ok, sessionId, revision }
  unsubscribe(),                           // -> { ok }
  snapshot(),                              // -> { revision, sessionId, title, session, order, nodes, navigation, timeline, pending }
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
- 变更通过 revision（结构）+ liveRevision（流式）+ 长轮询推送；不新增 HTTP/SSE 通道。

## 限制

- 依赖 DSH 0.2.x 的 `ctx.sessions` / `ctx.uiSession` 服务；升级后若改名，桥会降级为「服务不可用」。
- 只在 Obsidian 的 Electron `<webview>` 面板里可用；没有 iframe 路径。
- 不做设置入口、不做会话列表 UI、不做 provider / API key 配置；原生 UI 由 obsidian-dsh 渲染。
- 模型/权限/重命名是 v2 的增量方法：旧 v2 页面没有这些函数时，原生视图会提示更新并重启服务。
- `context` 是 v4 的增量方法：v3 桥没有时原生输入栏显示灰色空环，不影响聊天。
- `team` 是 v6 的增量方法：旧桥没有时原生面板不显示团队入口（工具行与消息照常）；
  团队面板只读，不提供创建 / 中断 / 删除，也不能从桥打开队友会话。