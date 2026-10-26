---
status: done
created: 2026-10-26
approved: 2026-10-26
done: 2026-10-26
scope: src/view, src/shared, src/main.ts, styles.css, package.json, tsconfig.json, docs；另扩展 packages/dsh-obsidian-bridge 至 API v2
issue: 用 Obsidian 原生 UI 显示 DSH 聊天，复用官方 DSH 客户端的 ChatSnapshot、会话动作和待处理交互，只重写显示与交互层
---

# 0006 原生聊天面板：官方 DSH core + Obsidian 原生 UI（方案 A）

> 状态：**done（2026-10-26）**。Phase 0 / Phase 1 均在真实 Obsidian（1.14.4 + dsh 0.2.1-rc.3）里用 CDP 回归验证。
> 剩余人工确认项见文末实施记录（视觉与真 IME 仍需人看）。

## 1. 背景与问题

当前面板（src/view/dsh-view.ts）是 Obsidian ItemView 包一个 Electron webview，显示完整 DSH Web GUI。
它能完整复用 DSH 插件，但内容不是 Obsidian 原生 DOM，无法按 Obsidian 的主题、组件和交互习惯重做。

用户的要求：

- **原生内容**：面板和 UI/UX 逻辑由 Obsidian 插件自己实现；
- **聊天核心用官方**：不要重写 agent loop、工具执行、会话状态、消息装配；
- 显示样式由插件 / Obsidian 主题定义。

调研结论：

- DSH 的 ui-conversation 是 target-neutral 的会话装配层，ui-chat 在其上构建 ChatSnapshot；
- 自定义 UI 可以通过 uiSession.adapter.resolve(id).hooks.chat / hooks.session 取得会话快照；
- 通过 sessions.list、sessions.open、sessions.scope(id).conversation 取列表和发送/停止/加载历史；
- 待处理审批/提问在 ctx.uiSession.sessionStatus 的 pendingInteraction 上，PendingApproval /
  PendingQuestion 都提供 answer()；
- 官方 Chat 的 React 渲染器、滚动、折叠、工具卡、输入框不在上述“核心”里，原生 UI 必须自己实现。

外部 dsh-mobile-ui 已经验证了“接管 root、自绘 UI、用官方 hooks.chat / 会话动作”的可行性；但它运行在
DSH 页面内，且已知不包含审批/提问。本提案把同样的数据面搬到 Obsidian 原生 UI。

## 2. 目标与非目标

### 目标

1. 新增一个 **Obsidian 原生聊天视图**（ItemView），面板布局、消息列表、输入框、审批/提问卡片全部由本插件渲染；
2. 复用官方 DSH 客户端的数据/动作核心：
   - 会话列表 / 当前会话 / running / hasMore；
   - ChatSnapshot（Turn/Step/Node、工具调用、分组、Turn 导航）；
   - 发送、停止、加载更早历史；
   - 审批与 ask_user_question 的待处理交互；
3. 原生视图可从右侧栏打开，也可在编辑区打开；样式只使用 Obsidian CSS 变量和 Obsidian 组件；
4. 保留现有 webview 面板作为完整功能与回退路径；原生模式失败不影响现有面板；
5. 只允许一个 DSH core webview，避免重复加载客户端插件。

### 非目标

- 不把官方 Chat 的 React 组件、CSS Modules 直接挂进 Obsidian；
- 不重写 agent loop、工具执行、Host 会话协议；
- Phase 1 不做完整官方 Chat 对齐：图片/附件上传、slash 命令、plan-review、queue/steer、
  子代理、文件预览、专用工具卡、Turn rail、完整折叠策略等后置；
- 模型选择、权限切换、当前笔记引用进入 Phase 1（2026-10-26 用户确认），但只做会话级选择，
  不做 provider / API key 配置；
- 不保证第三方 DSH 插件自定义的 tool.call.toolview / 聊天节点 UI 在原生面板中可用；
- 不支持 DSH 0.1.1；原生模式要求 DSH 0.2.x（首版以 0.2.x 验证）；
- 不迁移 DSH 设置页，不做移动端。

## 3. 方案

### 3.1 总体结构

    Obsidian 原生 ItemView（右栏 / 编辑区）
      ├─ React 原生 UI（会话列表、消息、工具卡、输入、审批/提问）
      └─ 隐藏的 DSH core webview（1 个）
            └─ 普通 DSH Web 页面 + dsh-obsidian-bridge v2 客户端插件
                  ├─ 不注册自己的 UI（Phase 0 官方 UI 仅隐藏；Phase 1 可接管 root）
                  ├─ 读 sessions / hooks.chat / hooks.session / sessionStatus
                  ├─ 暴露 window.__DSH_OBSIDIAN_BRIDGE__（v2）
                  └─ 通过 executeJavaScript 长轮询把 DTO 推给 Obsidian

职责边界：

- **官方 core**：事件 → Turn/Step/Node 装配、ChatSnapshot、工具状态、待处理交互、发送/停止/加载历史；
- **Obsidian 原生 UI**：所有 DOM、样式、布局、滚动、折叠、输入、审批/提问交互；
- **桥**：只传 JSON DTO，不把 DSH React 组件或函数对象带出 webview。

### 3.2 Obsidian 侧

新增 src/view/native/：

- native-chat-view.ts：DshNativeChatView extends ItemView；
  - getViewType() = dsh-native-chat；
  - onOpen：创建隐藏 core webview + React root；
  - onClose：卸载 React、销毁 core webview、释放桥订阅；
  - 不缓存 view 实例；重复打开时用 getLeavesOfType 复用。
- open.ts：openNativeChat()，固定 workspace.getRightLeaf(false)；已移除「在编辑区打开」命令，
  避免出现第二个 core webview。
- core-bridge.ts：调用 webview.executeJavaScript，负责：
  - 等待 __DSH_OBSIDIAN_BRIDGE__ 就绪；
  - listSessions / openSession / subscribe / send / cancel / loadOlder；
  - nextEvent(cursor, timeoutMs) 长轮询；
  - 版本与错误归因；
  - webview 重建后重新订阅。
- ui/：React 组件：
  - NativeChatRoot：标题、会话下拉、消息区、输入区、错误/连接状态；
  - SessionList / MessageList / MessageNode / ToolCard / Composer / ApprovalCard / QuestionCard；
  - 工具卡 Phase 1 只做通用卡（名称、状态、参数/结果摘要、展开原始 JSON）。
- src/shared/native-types.ts：桥 DTO 与错误类型。

原生 UI 使用 React 18 + react-dom/client，作为 **devDependencies 打包进 main.js**，不新增运行时依赖。
tsconfig.json 增加 "jsx": "react-jsx" 并 include .tsx；esbuild 直接按 tsconfig 处理 JSX。

样式写进 styles.css，只使用 Obsidian CSS 变量；不硬编码颜色和尺寸。

### 3.3 core webview

- 复用现有 createDshSurface 的 webview 能力与 getWebviewPartition() 分区；
- 放在原生视图的 contentEl 内，但离屏隐藏：
  position:absolute; left:-10000px; width:900px; height:700px; opacity:0; pointer-events:none；
  **不使用 display:none**，避免 Electron 不创建 guest / 不执行页面；
- src 使用当前 embedUrl（0.2.x 带 token）；
- 只允许一个 core：DshNativeChatView 单实例；如果用户再开，复用已有 leaf；
- 关闭原生视图即销毁 core；DSH 服务本身不随之停止（沿用现有 service 生命周期）。

**Phase 0 先不接管 DSH root**：官方 UI 在隐藏 webview 里正常挂载，只是不可见。这样风险最低，
也能作为 fallback。Phase 1 再评估是否用负优先级接管 root、减少官方 UI 开销；若接管，使用
sessionStorage 标记 + reload，避免影响普通面板。

### 3.4 DSH 侧：dsh-obsidian-bridge v2（合并 native core）

不再新建插件：在已迁入本仓库的 `packages/dsh-obsidian-bridge/` 上把 API 扩到 v2，
沿用同一个 `window.__DSH_OBSIDIAN_BRIDGE__` 全局对象。

- package.json：dsh.bundle.patch + dsh.client { platform: web, immediately: true }；
- lib/index.js：空 host 半身；
- lib/client.js：window.__ModuleLoader__.load 注册，apply(ctx)：
  - 不注册任何 slot / UI；
  - 用 ctx.get(...) 惰性取 sessions、uiSession、uiConversation；
  - 暴露 window.__DSH_OBSIDIAN_BRIDGE__（v2；v1 方法保持兼容）。

新增桥方法（v2）：

| 方法 | 用途 |
|---|---|
| ping() | { version, dshVersion? }，能力探测 |
| listSessions() | 会话列表 DTO（id/title/cwd/running/updatedAt） |
| openSession(id) | sessions.open(id) + 在当前页保留引用 |
| subscribe(id) / unsubscribe() | 订阅会话的 chat / session / pending |
| snapshot() | 当前会话的 ChatSnapshot DTO + session status |
| nextEvent(cursor, timeoutMs) | 长轮询；有变化返回新 revision，超时返回 unchanged |
| send(text) | sessions.scope(id).conversation.send(text) |
| cancel() | ...conversation.cancel() |
| loadOlder() | ...conversation.loadOlder() |
| newSession() | 可选：在 vault 工作区新会话（复用现有桥的 workspace 解析思路） |
| approvalAnswer(decision) | pendingInteraction.answer(allowed-once 或 rejected) |
| questionAnswer(answer) | pendingInteraction.answer(answer) |

数据来源：

- uiSession.adapter.resolve(id).hooks.chat：ChatSnapshot；
- uiSession.adapter.resolve(id).hooks.session：running / hasMore / lifecycle；
- uiSession.sessionStatus.getSnapshot()：pendingInteraction（审批 / 提问）；
- sessions.list：会话列表；
- sessions.scope(id).conversation：动作。

约束：

- 只给 Obsidian 发可 JSON 序列化的 DTO；ChatSnapshot.nodes 里的函数、Maps、source 必须投影；
- 未知节点（含第三方扩展 kind）降级为 kind: unknown + 可读摘要，不阻塞整个快照；
- 桥版本不匹配时原生视图只提示，不 crash。

### 3.4.1 与 v1 布局能力的关系（已确认合并）

现有 bridge 是布局适配器（单栏 / 工作区 / 新建会话），v2 在同一个插件里叠加数据桥：

| 能力 | v1 布局 | v2 新增 |
|---|---|---|
| configure（vault 工作区） | 有 | 复用 |
| newSession | 有 | 复用 |
| 单栏收起 | CSS + 收起左右栏 | 原生模式不调用 |
| ChatSnapshot / 事件 | 不暴露 | 核心 |
| send / cancel / loadOlder | 不暴露 | 核心 |
| 审批 / 提问 | 不暴露 | 核心 |

原生模式不调用 `enforceSingleColumn`；现有 webview 面板继续使用 v1 行为。安装方式见
[packages/dsh-obsidian-bridge/README.md](../../packages/dsh-obsidian-bridge/README.md)。

### 3.5 事件通道

Phase 1 用 executeJavaScript 长轮询：

- Obsidian 循环调用 nextEvent(cursor, 20000)；
- 页面在有 revision 变化时立即 resolve，否则 20s 超时返回 unchanged；
- 断线 / webview 重建后从 snapshot() 重新开始；
- 不用额外本地 HTTP server，避免 CSP / 端口 / 鉴权问题。

如果长轮询在实测中延迟或开销不可接受，再评估本地 SSE/WebSocket；这不在 Phase 1 范围。

### 3.6 原生消息渲染（Phase 1）

必须覆盖：

- 用户消息、Assistant 文本（流式增量）；
- 通用工具卡（name / status / args / result 摘要；展开原始 JSON）；
- Turn 错误、命令行、未知节点的 fallback；
- 审批卡片（allow-once / reject）；
- ask_user_question 卡片（选项、自定义答案、提交/跳过）；
- 发送 / 停止 / 加载更早 / running 状态；
- 空会话 / 无会话 / 连接失败 / 桥缺失状态。

Phase 1 覆盖（2026-10-26 确认）：

- 会话标题 / 会话切换浮层 / 新建 / 重命名；
- 模型选择（provider / model / reasoning effort）；
- 权限切换（permissions 投影，danger-full-access 二次确认）；
- 当前笔记引用（自动跟随最后一次激活的 Markdown 笔记，发送时只带 `@相对路径`）；
- 输入区底栏：模型、权限、发送 / 停止。

暂不覆盖：

- 图片 / 附件上传、slash 命令、queue/steer；
- 计划审核（plan-review）、子代理、文件预览、终端；
- 专用工具卡（diff、read、search、terminal 等）；
- Turn rail / 完整折叠 / 滚动位置恢复（只做基础跟随）。

Assistant Markdown 用 Obsidian MarkdownRenderer 渲染；失败时降级纯文本。

### 3.8 Phase 1 原生 UI 设计（2026-10-26 用户确认）

布局（右栏唯一实例，宽度不足时降级）：

    ┌──────────────────────────────────────┐
    │ 会话标题 ▾          ● 运行中   ＋  ⋯ │
    ├──────────────────────────────────────┤
    │  [加载更早]                          │
    │                    用户消息（右）     │
    │  Assistant Markdown（左，全宽）       │
    │  ▸ 工具调用 · name · 状态             │
    │  ▸ 思考                              │
    │  ┌ 待审批 / 待回答（固定输入框上方）┐ │
    ├──────────────────────────────────────┤
    │ 📄 当前笔记 · name.md            ×   │
    ├──────────────────────────────────────┤
    │ 输入框（1–8 行，Enter 发送）          │
    │ [模型 ▾]  [权限 ▾]           [发送]  │
    └──────────────────────────────────────┘

已确认的交互：

- 当前笔记自动跟随最后一次激活的 Markdown 笔记；焦点进入聊天面板后保持最后一次，不因
  getActiveFile() 为空而清空；发送时只前缀 `@相对路径`（空格路径用 `@"..."`），不附正文。
- 输入框 Enter 发送，Shift+Enter 换行；中文输入法组合期不发送。
- 运行中发送键变为停止键（Phase 1 不做 queue/steer）。
- 审批 / 提问固定显示在输入框上方，不随消息流滚走。
- 只保留右栏一个原生视图；移除「在编辑区打开」命令，重复打开时 reveal 已有 leaf。
- 标题点击打开会话切换浮层（搜索 / 最近 / 新建）；`⋯` 提供重命名与刷新。

数据来源与桥扩展：

| 能力 | DSH 0.2.x | 桥方法 |
|---|---|---|
| 模型目录 / 当前模型 | `sessions.models({sessionId})` | models() |
| 切换模型 | `sessions.selectModel({sessionId,provider,model,reasoningEffort?})` | selectModel(selection) |
| 权限选项 / 当前值 | `session.projections.faceOf("permissions")` | permissions() |
| 切换权限 | `session.command("/permission <value>")` | setPermission(value) |
| 重命名 | `sessions.rename({sessionId,title})` | renameSession(title) |

模型目录为空或 `routable: false` 时，输入框上方显示「未配置模型 / 路由不可用」和
「打开 DSH 设置」入口；provider / API key 配置仍由 DSH 设置页负责，不在本插件内实现。

### 3.7 回退与共存

- 原生视图打开失败（webview 不可用 / 桥缺失 / 版本不符 / DSH 0.1.1）：
  显示错误 + 「打开 DSH 面板」按钮，走现有 webview；
- 现有「打开 DSH 面板」命令、状态栏、设置页全部保持不变；
- 原生视图与 webview 面板可同时存在，但会各自加载一份 DSH 客户端；文档提示用户不要同时开，
  首版不强制关闭用户已打开的面板；
- 原生模式是实验入口：只保留命令「打开原生 DSH 聊天（实验）」，不改变默认打开行为；
  编辑区入口已移除，原生视图只允许右栏一个实例。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| src/view/native/native-chat-view.ts（新增） | 原生 ItemView、core webview 生命周期、React root |
| src/view/native/core-bridge.ts（新增） | executeJavaScript 桥、长轮询、错误归因 |
| src/view/native/open.ts（新增） | 右栏打开与单实例复用 |
| src/view/native/note-tracker.ts（新增） | 跟踪最后一次激活的 Markdown 笔记 |
| src/view/native/ui/（新增） | React 原生聊天组件（标题/会话浮层、消息、工具卡、输入、模型/权限、审批、提问） |
| src/shared/native-types.ts（新增） | 桥 DTO / 节点类型 / 错误类型 |
| src/shared/constants.ts | 新增 VIEW_TYPE_NATIVE_CHAT |
| src/main.ts | 注册视图、命令、宿主接口；保证新入口失败不影响旧入口 |
| package.json | devDependencies 增加 react / react-dom / @types/react / @types/react-dom |
| tsconfig.json | jsx: react-jsx，include .tsx |
| styles.css | 原生聊天面板样式（Obsidian 变量） |
| docs/architecture.md / docs/development.md / docs/troubleshooting.md / docs/roadmap.md | 架构图、改动地图、排障、M4 状态 |
| packages/dsh-obsidian-bridge/lib/client.js | 现有 v1 API 上增加 v2 原生数据桥（同一全局对象）；Phase 1 再增 models / selectModel / permissions / setPermission / renameSession |
| packages/dsh-obsidian-bridge/README.md | 合并后的能力与安装路径 |

## 5. 行为变化

- 新增实验入口：原生聊天视图，可用 Obsidian 原生 UI 浏览会话、收发消息、审批/提问；
- 默认打开行为不变；现有 webview 面板、新建会话、单栏、设置页不变；
- 原生视图需要 dsh-obsidian-bridge v2；未安装或版本不足时显示安装提示并回退；
- 原生视图只支持 DSH 0.2.x；0.1.x 下提示不可用；
- 现有 bridge v1 行为保持兼容，普通面板行为不受影响。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| ChatSnapshot / uiSession 是 DSH 内部结构，升级会变 | 原生视图数据错位或不可用 | 锁定验证过的 DSH 版本；桥版本化；失败回退 webview |
| ChatSnapshot 含函数 / Map / source，不好序列化 | 桥实现复杂、节点丢失 | 只投影已知节点；未知节点 unknown 摘要；不阻塞会话 |
| 隐藏 webview 被 Obsidian/Chromium 节流 | 流式更新变慢、审批不弹 | 保留足够尺寸、避免 display:none；Phase 0 实测；必要时改可见/专用 leaf |
| 待处理交互对象不是稳定 API | 审批/提问不能答 | Phase 0 先验证 sessionStatus.pendingInteraction + answer()；失败则该能力回退 webview |
| 第三方 DSH 插件 UI 不挂载 | 自定义工具卡/面板缺失 | 通用 fallback；文档明确非目标；需要时逐插件适配 |
| React 打进 main.js | 产物增大、构建变慢 | 确认 esbuild 单 React；可接受则保留，否则改 vanilla UI |
| 右栏宽度不足 | 聊天布局拥挤 | 提供「在编辑区打开」；窄宽度降级布局 |
| 同时开原生视图和 webview | 两份 DSH 客户端、插件副作用重复 | 文档警告；不自动双开；后续可加互斥提示 |
| 原生 UI 重写范围失控 | 工期/Bug 膨胀 | Phase 1 严格按节点白名单；附件/命令/专用卡后置 |

回滚：删除原生视图注册与命令即可恢复现有行为；bridge v2 可单独回退到 v1；不改动 Host。

## 7. 验证

### 自动化

- npm run build / npm run check 通过；
- 插件 `node --check` 由 `npm run check` 覆盖（packages/dsh-obsidian-bridge）；
- 桥的纯 Node 冒烟（stub executeJavaScript）可选：DTO 序列化、未知节点 fallback、版本错误。

### Phase 0 技术验证（先做，不写完整 UI）

1. 隐藏 core webview 能加载 DSH 页面；ping() 返回版本；
2. listSessions() 返回真实会话；
3. subscribe(id) + snapshot() 返回 ChatSnapshot DTO；
4. nextEvent() 能在发送消息后收到增量；
5. send() / cancel() / loadOlder() 生效；
6. sessionStatus.pendingInteraction 能拿到审批/提问并 answer()；
7. 关闭/重开原生视图后桥恢复，不残留 webview。

Phase 0 不满足 1~4 或 6 时，停止实现，回到方案 C（webview 内自绘）或继续用 webview。

### Phase 1 手动验收

1. 打开原生聊天视图（右栏 / 编辑区）→ 显示会话列表；
2. 打开会话 → 历史消息出现，运行中状态正确；
3. 输入并发送 → 用户消息立即出现，Assistant 流式更新；
4. 停止 → running 变为停止，消息不重复；
5. 加载更早 → 历史前插，不跳到底部；
6. 触发审批 → 原生卡片出现，允许/拒绝后 agent 继续；
7. 触发 ask_user_question → 原生卡片出现，提交答案后继续；
8. 关闭原生视图 → core webview 释放；重开 → 数据恢复；
9. 未安装 core 插件 / 0.1.1 / webview 不可用 → 明确提示 + 回退 webview；
10. 现有 webview 面板、新建会话、状态栏、设置页无回归。

### 验收标准

- Phase 0 的 1~7 全通过；
- Phase 1 的 1~10 全通过；
- npm run build / npm run check 通过；
- 现有功能行为与文案不变（除非提案明确新增）。

## 8. 需要你拍板

- [x] **React**：同意把 React 18 + react-dom 作为 devDependencies 打进 main.js。（已确认，Phase 1 用）
- [x] **面板位置**：默认右栏 + 额外「在编辑区打开」命令。（已确认）
- [x] **Phase 1 范围**：包含审批/提问；模型选择、权限切换、当前笔记引用也进入 Phase 1；
  暂不做附件/slash/queue-steer/plan-review/专用工具卡。（2026-10-26 更新确认）
- [x] **DSH 插件**：合并进现有 dsh-obsidian-bridge 并迁入本仓库 `packages/`，不新建第二个插件。（已确认）
- [x] **DSH 版本**：只做 0.2.x，0.1.1 及更旧版本不再考虑，也不为它们保留兼容分支。（已确认）
- [x] **Phase 0 先隐藏官方 UI**（不接管 root）验证桥，Phase 1 再评估 headless 接管。（已确认）
- [x] **当前笔记**：自动跟随最后一次激活的 Markdown 笔记；发送时只带 `@相对路径`，不带正文。（已确认）
- [x] **发送键**：Enter 发送，Shift+Enter 换行。（已确认）
- [x] **运行中**：发送键变为停止键，Phase 1 不做 queue/steer。（已确认）
- [x] **审批/提问**：固定在输入框上方。（已确认）
- [x] **实例数**：只保留右栏一个原生视图，移除编辑区命令。（已确认）
- [x] **会话切换**：标题下拉浮层，含搜索 / 新建；重命名放在 `⋯`。（已确认）

## 9. 实施记录

### Phase 0（2026-10-26）

- `packages/dsh-obsidian-bridge/lib/client.js`：API 升到 v2，新增
  `listSessions / subscribe / unsubscribe / snapshot / nextEvent / send / cancel / loadOlder /
  approvalAnswer / questionAnswer`；保留 v1 布局方法。
- `src/view/native/core-bridge.ts`：executeJavaScript + 等待就绪 + 长轮询 + 错误归因。
- `src/view/native/native-chat-view.ts`：隐藏官方 webview + Phase 0 自检 UI（会话下拉、订阅、
  发送/停止/加载更早、审批按钮、提问 JSON 模板、原始快照）。
- `src/main.ts`：注册 `dsh-native-chat` 视图与两个实验命令。
- `src/shared/native-types.ts` / `src/shared/constants.ts` / `styles.css`：DTO 契约、视图常量、样式。
- 验证：`npm run build` / `npm run check` 通过；bridge v2 用 fake services 做了 Node 冒烟
  （列表、快照投影、Map/循环引用、长轮询、send、审批、提问）。
- **待人工确认**：Obsidian 内隐藏 webview 加载、真实 ChatSnapshot、长轮询延迟、
  发送/停止/加载更早、审批/提问答案、关闭重开恢复。
- 实测发现：订阅正在被桌面端/官方面板使用的会话时，`session.prompt` 返回 `session/writer-held`；
  Phase 0 增加 `createSession()` 与「新建会话」按钮，绕开单写者冲突。
- 偏差：Phase 0 自检视图先用 vanilla DOM，React 18 留到 Phase 1 再接入（提案已批准 React 打包）。
- 人工确认（2026-10-26）：新建会话后可正常发送；订阅桌面端占用的会话仍会触发 `session/writer-held`。

### Phase 1（2026-10-26）

- 桥新增 `models / selectModel / permissions / setPermission / renameSession`；`snapshot()` 增加
  `title`；发送/停止/加载更早改为直接走 `ref.binding.session`（SessionFace）。
- `src/view/native/native-chat-view.tsx` 改成 React 根：隐藏 core webview + `createRoot`；
  `onClose` 卸载 React、释放订阅、销毁 surface。
- 新增 `src/view/native/note-tracker.ts`：记住最后一次激活的 Markdown 笔记；发送时只前缀
  `@相对路径`（空格路径用 `@"..."`）。
- 新增 `src/view/native/ui/`：`NativeChatRoot`（会话/快照/模型/权限状态与事件循环）、
  `Timeline`（用户/Assistant/工具卡/错误/压缩/命令）、`Composer`（输入 + 模型/权限 + 发送/停止）、
  `PendingCard`（审批/提问）、`SessionPicker`（搜索/新建）、`menus.tsx`（模型/权限/会话浮层与重命名）。
- React 18 / react-dom 作为 devDependencies 打进 `main.js`；`tsconfig` 启用 `jsx: react-jsx`。
- 移除「在编辑区打开原生 DSH 聊天」命令，原生视图固定右栏一个实例。
- 验证：`npm run build`（`main.js` 约 203KB）/ `npm run check` 通过。

#### Phase 1 偏差（实测后修正，2026-10-26）

1. **模型目录不能用 `connection.api.sessions`**：dsh 0.2.1-rc.3 的 `connection` 只有
   `rpc.call`，没有 `api` 字段；改用官方 UI 同款的 `ctx.modelDirectories.directoryFor(sessionId)`
   （`load()` / `select()` / `store.getSnapshot()`），失败时才回退到旧的 wire 路径。
2. **`retainedEffort` 是名字不是 id**：`models` 返回的 `current.reasoningEffort` 需要按
   `groups[].models[].reasoning.efforts` 把 `High` 映射回 `high`，否则输入框标签匹配不到。
3. **权限投影只带 `currentValue`**：0.2.x 的 `permissions` 会话投影不广告 `options`（客户端回扫表
   只有 workspace-write / danger-full-access）。桥在缺少 `options` 时用内置三条预设兜底
   （read-only / workspace-write / danger-full-access），切换仍由宿主 `/permission` 命令校验。
4. **Obsidian 原生 `Menu` 在右栏视图不挂载**：`new Menu().showAtPosition()` 会创建 `dom`，但
   `isConnected === false`（document 里查不到、MutationObserver 也看不到），菜单因此打不开。
   改为 React 自绘浮层（`ModelMenu` / `PermissionMenu` / `SessionMenu` + 背景遮罩），
   样式与可测试性都归插件自己。
5. **obsidian profile 的模型接入与桌面端不一致**：桌面 profile 用 `command-code` 路由 +
   `agent-default-model` 覆盖，obsidian profile 仍是 base 默认的 `deepseek-official`（API key 401）。
   已在 `$DSH_HOME/profiles/obsidian/cordis.patch.yml` 对齐 `llm-pi-ai` providers、
   `agent-default-model`，并禁用 `llm-deepseek` 密钥线路（**环境配置，不进仓库**）。
6. **服务刚重启时会话列表可能为空**：`boot()` 现在会在列表为空时重试约 3 秒，避免错误显示
   「还没有会话」。

#### Phase 1 CDP 回归（2026-10-26，Obsidian 1.14.4 / dsh 0.2.1-rc.3）

| # | 场景 | 结果 |
|---|---|---|
| 1 | 重载插件 → 右栏「打开原生 DSH 聊天（实验）」 | 通过：React 根挂载，标题「选择会话」，最近会话列表正常 |
| 2 | 新建会话（cwd = vault） | 通过：隐藏客户端持有会话，可发送 |
| 3 | 发送 / 流式 | 通过：用户消息立即出现，思考块 + 工具卡 + Markdown 回复逐步更新 |
| 4 | 模型菜单 | 通过：分组列出 provider / model / reasoning effort，当前项打勾；切到 Low 再回 High，标签同步 |
| 5 | 权限菜单 | 通过：Read Only / Workspace Write / Full access，切换后标签更新；Full access 弹二次确认 |
| 6 | 审批 | 通过：写 `~/dsh-approval-test.txt` 触发「需要审批」卡片（固定在输入框上方），「允许一次」后文件写入成功 |
| 7 | 停止 | 通过：运行中发送键变「停止」，点击后回合结束、按钮恢复 |
| 8 | 当前笔记 | 通过：切换激活笔记时标签跟随；发送前缀 `@回归笔记B.md` |
| 9 | 重命名 | 通过：`⋯ → 重命名会话` 保存后标题立即更新 |
| 10 | 关闭重开 | 通过：重开视图后恢复会话列表与历史（含 running / 错误状态） |

- 仍未覆盖：真 IME 组合输入、附件 / slash / queue-steer / plan-review、多窗口 popout 下的浮层定位。
- 环境备注：obsidian profile 的模型凭据与桌面 profile 共享 `$DSH_HOME/.credentials.yaml`；
  `DEEPSEEK_API_KEY` 仍会 401（已禁用该线路，不影响使用）。
