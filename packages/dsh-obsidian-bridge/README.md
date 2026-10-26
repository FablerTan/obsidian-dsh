# dsh-obsidian-bridge

Obsidian 嵌入专用（纯客户端）DSH 插件。与 [obsidian-dsh](https://github.com/fabler/obsidian-dsh) 同仓库维护
（`packages/dsh-obsidian-bridge/`），配合其 webview 面板与原生聊天视图使用：

- **v1 布局**：把 Obsidian 库目录解析成唯一工作区、`newSession()`、强制单栏；
- **v2 原生数据桥**：会话列表、ChatSnapshot、会话动作、审批 / 提问答案，供 Obsidian 原生 UI 渲染。

> **只支持 DSH 0.2.x**。0.1.x、iframe 回退、非 token 鉴权实例都不在支持范围。
>
> API 版本为 **2**。Obsidian 侧旧面板只要求 v1 方法，原生视图要求 v2。

## 对外 API（页面全局）

```js
window.__DSH_OBSIDIAN_BRIDGE__ = {
  version: 2,
  ping(),                                  // -> { version, native }

  // v1 布局
  configure({ paths: [string] }),          // -> { version, workspaceId, workspacePath, singleColumn }
  newSession(),                            // -> { ok, workspaceId, workspacePath }
  enforceSingleColumn(),                   // -> { sidebarCollapsed, rightbarExpanded }
  state(),                                 // -> 当前解析到的 workspace

  // v2 原生数据桥
  listSessions(),                          // -> { phase, sessions: [{ id, title, cwd, running, blank, updatedAt }] }
  createSession(cwd?),                     // 新建会话并订阅 -> { ok, sessionId }
  subscribe(sessionId),                    // -> { ok, sessionId, revision }
  unsubscribe(),                           // -> { ok }
  snapshot(),                              // -> { revision, sessionId, title, session, order, nodes, navigation, timeline, pending }
  nextEvent(cursor, timeoutMs),            // 长轮询：变化 -> { cursor, changed: true }；超时 -> { cursor, changed: false }
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
- v1：`ctx.get()` 惰性拿 `workspaces` / `uiWorkspace` / `layout` / `sidebarRight`；每 500ms 执行一次 `enforceSingleColumn`。
- v2：`sessions.retain(id)` + `uiSession.adapter.bindingSource(ref)` 取 `hooks.chat` / `hooks.session`；
  `uiSession.sessionStatus` 取 `pendingInteraction`；发送/停止/加载更早直接走
  `ref.binding.session`（`SessionFace`），避免 scope 寻址丢失会话标签。
- 模型：`sessions.models({ sessionId })` / `sessions.selectModel(...)`；权限：
  `session.projections.faceOf('permissions')` 与 `session.command('/permission <value>')`；
  重命名：`sessions.rename({ sessionId, title })`。
- 变更通过 revision + 长轮询推送；不新增 HTTP/SSE 通道。
- 列状态用 `data-rightbar-col` / `data-sidebar-collapsed` 判断，不用 CSS Modules 哈希，也不 `display:none`（会破坏 grid）。

## 限制

- 依赖 DSH 0.2.x 的 `ctx.uiWorkspace` / `ctx.workspaces` / `ctx.sidebarRight` / `ctx.uiSession` 服务；升级后若改名，桥会降级为「服务不可用」。
- 只在 Obsidian 的 Electron `<webview>` 面板里可用；没有 iframe 路径。
- 不做设置入口、不做会话列表 UI、不做 provider / API key 配置；原生 UI 由 obsidian-dsh 渲染。
- 模型/权限/重命名是 v2 的增量方法：旧 v2 页面没有这些函数时，原生视图会提示更新并重启服务。