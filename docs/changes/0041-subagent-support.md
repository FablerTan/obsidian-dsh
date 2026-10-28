---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27      # 用户选路：C（含 A/B）+ 按提案第 9 节的推荐取舍
scope: packages/dsh-obsidian-bridge, src/view/native, src/shared, styles.css, docs
issue: 原生面板支持 dsh「子智能体（subagent）」：能看到子代理列表 / 树与状态，能打开子会话看正文、续聊与停止
---

# 0041 原生面板支持 dsh 子智能体（subagent）

> 对应路线图 [R-24](../roadmap.md#需求待办)。**本文只做调研与路径对比，选路前不改代码。**

## 1. 背景与问题

用户问「子代理功能还不支持吗？」——这里的「子代理」是 dsh 的 subagent（中文 UI 叫「子智能体」），
与 [0035](0035-agent-team-support.md) 已支持的「智能体团队（Agent Teams）」是**两套相关但不同的能力**：

- **智能体团队**：实验性 bundle 提供 roster + 任务板 + 团队工具，Lead 的队友是可继续子会话；
- **子智能体**：dsh base 自带，模型用 `subagent` / `subagent_fork` 委派一次性或可继续的子会话，
  dsh Web/Desktop 在会话页头有「子智能体计数」入口，可展开目录、打开子会话、续聊、Stop。

本机 obsidian profile **两者都在**（`~/.dsh/profiles/obsidian/package.json` 的 bundles 含
`dsh-experimental-agent-team-profile`；本机 vault 会话 `session-aa2d6011…`（cwd = DigitalGarden，ptc 预设）
在 2026-10-27 真实跑出过一条 `subagent/catalog`：`{ mode: 'continuable', label: '读取 README.md 前 20 行并汇报', childId: '72983ebe…' }`）。
即：**工具能跑、子会话真的建出来了，但原生面板看不见**。

现状（代码核对）：

| 方面 | 现状 | 缺口 |
|---|---|---|
| 工具行 | `subagent` / `task` 落入 `subagents` 类目（[chat-node-data.ts](../../src/view/native/ui/chat-node-data.ts)），标题「子智能体」、activity「协调子智能体」 | 标题与 dsh Web 不一致（Web 是「创建子智能体」）；`subagent_fork` 未映射，显示原始英文名 + 扳手图标 |
| 子代理列表 / 树 | ❌ 完全没有 | 看不到「这轮 spawn 了哪些子代理、谁还在跑」 |
| 子会话正文 | ❌ 没有导航入口 | `snapshot().session` 已带 `subagent.address`，但原生端没人读 |
| 子会话续聊 / Stop | ❌ 没有 | 桥 `send()` / `cancel()` 对子会话天然可用（dsh 侧自动路由），只是打不开子会话 |
| 子代理审批 / 提问 | ❌ 没有 | 实际不构成缺口：dsh 子代理的 ask-user 被 seam 拒绝，子会话里基本没有审批可处理 |
| 子代理系统消息 | 通用 context 卡片 | `subagent-settled` 来源没有友好化（团队消息在 0035 已做） |
| 团队工具误标 | `send_message` / `list_agents` / `interrupt_agent` 被归进 `team` 类目 | 非团队场景过程行会说「协调团队 / 协调了团队」 |

## 2. 目标与非目标

**目标**

1. 原生面板能看出当前会话有哪些子智能体（直接子级 + 一层嵌套）、模式（可继续 / 一次性 / 外部 / 未知）、运行 / 空闲 / 等待授权、耗时、token、模型等可拿到的状态；
2. 能从列表打开子会话，看到正文 / 流式输出 / 工具行，并能返回父会话；
3. 可继续子代理能继续发消息与 Stop（dsh 侧已提供路由），一次性 / 父不可用的子会话明确只读；
4. 顺带修正工具行类目与标题（`subagent_fork`、`*_message / list_agents / interrupt_agent`），不再误标「团队」。

**非目标**

- 不做「子代理」的创建 / 重命名 / fork 等模型侧动作（那是模型的工具，不是面板的职责）；
- 不做右侧栏 `subagentchat` tab、不做完整的深树懒加载 / 键盘树导航（首版可留后续）；
- 不改 dsh profile 的 bundle 组合，不替换原生面板（与 [0008](0008-native-only-surface.md) 的 native-only 方向一致）；
- 不动会话列表的过滤规则（子会话仍不进入会话列表，只从子代理入口进）。

## 3. 调研结论：dsh 侧有哪些数据可用

> 依据：dsh 0.2.1-rc.3 checkout（`~/dsh/deepseek-harness`），关键源码：
> `packages/subagent/subagent/src/catalog.ts`、`projection.ts`、`packages/api/session-controller/src/client/sessions/{manager,service,session}.ts`、
> `packages/client/ui-subagent/lib/client.js`、`packages/client/ui-workspace`。

### 3.1 投影（父会话 / 子会话）

- **`subagentCatalog`（父会话）**：wire 形状 `Array<{ id, createdAt, mode: 'one-shot' | 'continuable' | 'external' | 'unknown', label? }>`；
  只含**直接子级**，普通 fork 不算；不含执行状态。
- **`subagent`（子会话）**：`{ mode, label?, seq } | null`；**`subagentTiming`（子会话）**：`{ settledMs, active?, lastTurnCompleted? }`
  （只区分「最近一轮正常完成 vs 其它 inactive」，无失败原因）。
- 这三个都是 **summary 投影**：`sessions.list.getSnapshot().byId[id].projectionValues` 里就有，
  **且子会话会以 fallback 行进入 `byId`**（`origin='subagent'`、`parentId`、`running`），但不在 `ids` 里。
  所以桥**不需要任何新 RPC**就能拿到整棵直接子级目录。
- 运行 / 等待授权：`uiSession.sessionStatus.getSnapshot(): Map<SessionId, { running?, pendingInteraction?, completionUnread }>`
  （与 Web 同源；`completionUnread` 可做「有新结果」圆点）。
- 模型：`byId[id].projectionValues.modelSelection.next.model`；token：`projectionValues.tokenUsage`。

### 3.2 打开子会话（官方同款能力，桥可直接复用）

- `ctx.sessions.retain(target)` 支持 `SessionId | SubagentAddress`，
  `SubagentAddress = { parentSessionId, childSessionId, mode: 'one-shot' | 'continuable' | 'unknown' }`；
  传裸 childId 时内部会从 catalog / 会话摘要反推地址（`manager.ts#resolveTarget / subagentAddress`）。
- 拿到 ref 后走**现有** `uiSession.adapter.bindingSource(ref)` → `chat / session / eventSource`，即桥现在的整套快照 / 流式 / 事件管线**不用改**。
- `SessionSnapshot.subagent = { address, parentAvailable? }`（子会话快照里已有），可直接做面包屑与只读判定。
- `prompt` 自动走 `subagents/prompt`，`cancel` 自动走 `subagents/interruptByParent`（`session.ts#prompt / cancel`），
  所以续聊与 Stop 不需要新协议。
- `ctx.uiWorkspace.openSession(SessionId | SubagentAddress)` 可让隐藏 core 的官方 UI 跟随；
  `sessions.refreshProjections(childId)` 用于展开深层子目录时补读。

### 3.3 官方 Web UI 的形态（对标）

- 根会话：页头 actions 区「子智能体计数」trigger（catalog 空 / 加载中不显示），hover 150ms 开树、点击 pin；
  行 = 模式 + 活动点 + 标题，右列 token / 本轮时长；可展开嵌套。
- 子会话：lineage 面包屑（父标题 / `Switch subagent: label` / `N subagent`），正文用共享 conversation 渲染；
  composer 规则：one-shot → 只读；continuable 且父在线 → 正常输入（follow-up 进 child FIFO，Stop 走 interruptByParent）；
  continuable 且父离线且未运行 → 只读恢复提示；父离线但仍在跑 → 输入禁用、Stop 可用。
- 父会话里子代理完成会产生 `subagent-settled` 来源的 context 节点（「Subtask status updated」）。

### 3.4 与 Agent Teams 的边界

- 两者投影**不互斥**：`subagentCatalog` 来自 base 的 `dsh-subagent`（常驻），`agentTeam` 来自实验 bundle。
- **每个 teammate 同时也是 `subagentCatalog` 里的 continuable 子项**（团队用 `startActivation` 起人），
  但 catalog 里分不出「这是 teammate」——只能拿 `team()` 的 member id 去比对。团队额外有 name / role / tasks / phase。
- 因此「子智能体」面板天然会把队友也列出来。这是产品取舍点（见第 9 节），不是技术障碍。
- 本机实测旁证：当前 obsidian 会话的 system prompt 同时带 Agent Teams 说明与 `subagent` / `subagent_fork` 工具说明，
  且 vault 会话 `session-aa2d6011…` 真实产生了 `subagent/catalog`（continuable）——本 profile 下两者可并存。
  （agent-team-profile 的顶层 `disabled` 行与 preset 内按 id 重挂 delegation 组的覆盖关系未逐一证实，
  实现时以「工具行是否出现」为准；ptc 预设下 `workflow-ptc` / `tool-workflow` 为 disabled，故本提案不依赖 workflow 事件。）

## 4. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A 只修工具行（零桥改动）** | [chat-node-data.ts](../../src/view/native/ui/chat-node-data.ts)：补 `subagent_fork`、新增 `agentControl` 类目（`send_message / list_agents / interrupt_agent` 从 `team` 拆出）；[tool-row.tsx](../../src/view/native/ui/tool-row.tsx)：`subagent` 标题对齐 Web「创建子智能体」、`subagent_fork`「继承上下文创建子智能体」、agentControl 用中性 activity/past；[timeline-nodes.tsx](../../src/view/native/ui/timeline-nodes.tsx)：`subagent-settled` context 卡片友好化 | 3 个原生文件，约 60–100 行；**不改桥** | 成本最低、零协议风险；但只解决「读得懂」，看不到列表与正文，等于没解决用户的问题 | 作为 B/C 的顺带项，不单独立项 |
| **B A + 只读子智能体面板** | 桥 v7：`VERSION=7`、`subagents()`（从 `sessions.list.byId` 的 `projectionValues.subagentCatalog` 组一层树，子行拼 `subagent` / `subagentTiming` / `tokenUsage` / `modelSelection` / `sessionStatus.running` / `pendingInteraction` / `completionUnread`）、`subscribe()` 投影键表补 `subagentCatalog` / `subagentTiming`、`ping.methods` 加 `subagents`；[core-bridge.ts](../../src/view/native/core-bridge.ts) 能力位 + `supportsSubagents()` / `subagents()`；[native-types.ts](../../src/shared/native-types.ts) DTO；新增 [subagent-panel.tsx](../../src/view/native/ui/subagent-panel.tsx)（复用 `MenuShell` + 0035 的状态点/成员行/两行折叠）；[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) 页头「子智能体」图标（bot，catalog 非空才出现）+ 浮层 + `refreshSubagents`（照抄 `refreshTeam` 的请求序号 / 失败即隐藏）；`styles.css` 样式 | 桥 1 文件 + 原生 5 文件 + CSS，约 250–350 行 | 中等；纯读投影、零 RPC、不碰会话切换，风险低。但「能看到子代理在跑」却**看不到它在干什么**，价值一半 | 可作为 C 的第一步；若只想先稳，选 B |
| **C（推荐）B + 子会话导航 / 续聊** | 在 B 之上：桥 `subscribe(target)` 支持 `SessionId | { parentSessionId, childSessionId, mode }`（`sessions.retain(address)` + `uiWorkspace.openSession(address)`），`snapshot()` 继续带 `session.subagent`；原生端加「当前子会话」状态与面包屑（父标题 / `← 返回父会话` / 当前 label）、子会话打开（复用现有 snapshot / live / poll / pending 管线）、composer 只读判定（one-shot 或 `parentAvailable === false` → 只读提示；continuable 且父在线 → 正常输入 + Stop）；子代理列表行可点、当前行高亮；切回父会话后恢复正常上下文；`subagents()` 可带可选 `refresh` 参数调 `sessions.refreshProjections` 以展开一层嵌套 | B 的全部 + 桥 subscribe 1 处 + 原生 3 文件（root / composer / panel）+ CSS，约 +250–350 行（合计 550–700 行） | 较高：addressed retain 的地址解析、子会话与父会话切换竞态、一次性 / 未知模式只读、官方 UI 跟随、团队入口在子会话里是否隐藏，都要 CDP 实测。但**这才是「支持子代理」**：能看正文、能续聊、能 Stop | **推荐**；按 B → C 两步落地，同一提案内先只读再接导航 |
| D（不选）把官方 Web 面板 / iframe 变可见 | 直接显示隐藏 core 的官方 UI | — | 与 [0008](0008-native-only-surface.md) 的 native-only 方向冲突，删过的入口不再加 | 否 |

**推荐 C**：子代理能力的关键价值是「看得到子代理在干什么、能接话」，只有 C 做到；
B 的投影读取与列表 UI 本来就是 C 的第一步，C 只是把「retain 子会话 + 面包屑 + 只读判定」接上去。
桥侧之所以敢做，是因为 dsh 已经提供了 addressed retain、prompt / cancel 路由与 `session.subagent` 元数据，
不需要新协议，也不需要改 dsh。

## 5. 改动清单（路径 C，含 A/B）

| 文件 | 改动 |
|---|---|
| [packages/dsh-obsidian-bridge/lib/client.js](../../packages/dsh-obsidian-bridge/lib/client.js) | `VERSION = 7`；补丁头注释写 v7；`subscribe(target)` 接受 `SessionId` 或 `{ parentSessionId, childSessionId, mode }`（后者走 `sessions.retain(address)`，`uiWorkspace.openSession(address)`）；投影订阅键表补 `subagentCatalog` / `subagentTiming`；新增 `subagents()`（从 list 快照组一层树 + 补状态 / 耗时 / token / 模型 / 未读）+ 可选 `subagents({ parentSessionId })` 调 `refreshProjections`；`ping().methods` 加 `subagents`；bridge 对象导出 |
| [src/shared/native-types.ts](../../src/shared/native-types.ts) | `NativeSubagentEntry` / `NativeSubagentTree` / `NativeSubagentTarget` DTO |
| [src/view/native/core-bridge.ts](../../src/view/native/core-bridge.ts) | `subagentCapability`、`supportsSubagents()`、`subagents()`；`subscribe` 支持 target 对象 |
| [src/view/native/ui/subagent-panel.tsx](../../src/view/native/ui/subagent-panel.tsx)（新） | 只读列表（一层树）：label / 标题、模式 chip（可继续 / 一次性 / 外部 / 未知）、状态点（运行中 / 空闲 / 失败未知）、等待授权 / 未读标记、耗时、token、模型；行点击打开子会话；当前会话高亮 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 状态 `subagents` / `subagentAddress`；`refreshSubagents`（照抄 `refreshTeam` 软降级）；页头「子智能体」图标（catalog 非空才出现，带运行中圆点 / 未读标记）；面包屑（当前是子会话时显示「父标题 › label」+ 返回按钮）；子会话只读判定传给 Composer；切会话时清空 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 只读态：不可输入、不显示发送，显示「一次性子智能体，只能查看」/「父会话离线」提示；子会话运行时保留 Stop |
| [src/view/native/ui/chat-node-data.ts](../../src/view/native/ui/chat-node-data.ts) | `subagents` 类目补 `subagent_fork`；新增 `agentControl` 类目（`send_message` / `list_agents` / `interrupt_agent`）；`subagent` 归 `subagents` |
| [src/view/native/ui/tool-row.tsx](../../src/view/native/ui/tool-row.tsx) | `subagent` → 「创建子智能体」、`subagent_fork` → 「继承上下文创建子智能体」；agentControl 标题 / 图标 / activity / past 中性化（不再说「协调团队」） |
| [src/view/native/ui/timeline-nodes.tsx](../../src/view/native/ui/timeline-nodes.tsx) | `subagent-settled` context 节点 → 「子任务状态更新」卡片（source summary + 子标签） |
| [styles.css](../../styles.css) | 子智能体面板 / 模式 chip / 面包屑 / 只读提示样式（全部主题变量，复用 team-* 的状态点） |
| [manifest.json](../../manifest.json) / [package.json](../../package.json) / [versions.json](../../versions.json) | 插件 `0.5.0 → 0.6.0`（三处一致，versions 追加新键） |
| [packages/dsh-obsidian-bridge/package.json](../../packages/dsh-obsidian-bridge/package.json) | bridge `0.4.0 → 0.5.0`（v7） |
| docs | [architecture.md](../architecture.md) 数据面补 v7 `subagents()` / `subagentCatalog` / addressed 订阅；[development.md](../development.md) 改动地图补子代理面板与回归步骤；README 功能清单；[troubleshooting.md](../troubleshooting.md) 补「子代理面板空 / 打不开子会话」；bridge README；changes 索引；roadmap |

## 6. 行为变化

- 会话页头新增「子智能体」图标：当前会话有子代理（catalog 非空）才出现；运行中有圆点、完成未读有标记。
  点开是只读列表：label、模式、运行 / 空闲 / 等待授权、耗时、token、模型；嵌套子代理可展开一层。
- 点列表行（或工具行）可打开子会话：正文 / 流式 / 工具行照常；页头出现「父标题 › label」面包屑与返回；
  按 dsh 规则决定 composer：可继续且父在线 → 正常输入 + Stop；一次性 / 未知 / 父离线且未运行 → 只读提示；
  父离线但仍在跑 → 输入禁用、Stop 可用。
- 子代理列表里也会出现「智能体团队」的队友（catalog 里本就是 continuable 子项）；团队入口与团队面板行为不变。
- 工具行：`subagent` 显示「创建子智能体」，`subagent_fork` 不再显示英文原名；
  `send_message / list_agents / interrupt_agent` 在非团队场景不再说「协调团队」；`subagent-settled` 消息显示成子任务卡片。
- 无子代理、旧桥（v6）或投影缺失时：入口隐藏，其余行为完全不变。

## 7. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 桥 v7 与插件版本错配 | 新插件 + 旧桥：不显示子智能体入口，其余可用；旧插件 + 新桥：无影响 | 能力探测（`supportsSubagents()` 按 `ping.methods`）天然降级 |
| addressed retain 失败（catalog / 地址未就绪） | 打不开子会话 | 打开前先 `refreshProjections`；失败进错误条并停留在父会话；`mode === 'unknown'` 时给出明确提示 |
| 子会话与父会话切换竞态 | 快照串台 / 短暂空状态 | 复用现有 `sessionIdRef` / 请求序号 / `not-subscribed` 静默重试；切回父会话后重新 `refreshSnapshot` |
| 一次性 / 父离线子会话被误当可写 | 发送报错 | composer 按 `subagent.mode` + `parentAvailable` 判定只读；桥 `send` 失败仍进错误条 |
| 团队队友在子代理列表里重复出现 | 两个入口都列同一人 | 见第 9 节取舍；可给队友行标「团队」或过滤（`team()` 的 member id 比对） |
| 深层子代理目录未加载 | 展开为空 | 首版只做一层；展开时调 `refreshProjections`，失败显示「加载失败」 |
| 回滚整体 | — | 还原桥 + 原生文件，`npm run build`，重启 dsh、重载插件，版本号回退三处 |

## 8. 验证

自动化：

    npm run build        # tsc + esbuild
    npm run check        # 版本 / 依赖 / 类型 / main.js 与源码一致
    node --check packages/dsh-obsidian-bridge/lib/client.js

桥冒烟（不依赖 Obsidian）：重新 link 桥 → 重启 obsidian profile 服务；
隐藏 core 页面执行 `window.__DSH_OBSIDIAN_BRIDGE__.ping()` 确认 `version === 7`、methods 含 `subagents`；
无子代理时 `subagents()` 返回空树而不是抛错；对已有子代理的父会话确认条目数量与 `subagent/catalog` 一致。

手动（Obsidian 内，CDP 可辅助）：

1. 打开有子代理历史的会话（本机 vault 会话 `session-aa2d6011…` 就有）→ 页头出现「子智能体」图标，列表能列出那条 `continuable` 子项；
2. 新建会话发一句让模型 spawn 一个子代理（如「用 subagent 让一个子智能体读 README 并汇报」）→ 列表实时出现「运行中」；
3. 点该行 → 打开子会话，正文 / 流式正常；页头面包屑显示父标题；返回父会话后状态恢复；
4. 可继续子代理：在子会话里发一句追加指令，能收到回复；Stop 能中断当前轮；
5. 一次性子代理：composer 显示只读提示，不能输入；
6. 停用相关能力 / 换回旧桥 → 入口消失，普通聊天无异常；
7. 团队功能回归：启用「智能体团队」后团队图标与面板照旧，子代理列表里队友行可打开（若选「包含」）。

**验收标准（可判定）**：`bridge.subagents()` 在父会话返回的条目数与 `subagentCatalog` 一致且含 `mode`；
DOM 中存在子智能体入口且 `aria-expanded` 随点击切换；点击子项后 `snapshot().sessionId === childId` 且
`snapshot().session.subagent.address.parentSessionId === parentId`；返回后 `sessionId === parentId`；
一次性子会话 composer 不可输入；`subagent_fork` 工具行不再显示英文原名。

## 9. 需要你拍板

- [ ] **选哪条路径**：A（只修工具行）/ B（只读列表）/ **C（推荐：B + 子会话导航与续聊）**。
      倾向先稳可以先批 B，C 再单独立项；想一次到位选 C。
- [ ] **子智能体入口位置**：会话标题右侧第二个图标（bot，与团队图标并列）——推荐；或只在会话列表 / 更多菜单里。
- [ ] **团队队友是否出现在子智能体列表**：推荐「出现并标『团队』徽标」（catalog 里本来就是子代理，过滤会让人以为漏了）；
      若嫌重复，可改成「有团队投影时过滤掉 teammate」。
- [ ] **子会话里是否隐藏团队入口**：推荐隐藏（子会话是「看/接话」场景，团队 roster 属于父会话），保留会话菜单与返回。
- [ ] **一次性 / 父离线子会话**：推荐 composer 只读 + 明确文案，不做「接管」。
- [ ] **首版嵌套深度**：推荐只列一层直接子级（展开够用再说），深层目录留后续。
- [ ] **版本号**：插件 `0.6.0` + 桥 `v7 / 0.5.0` 是否照此。

## 10. 实施记录

- **2026-10-27（实现）**：按用户选定路径 **C**（含 A/B）落地；插件 `0.5.0 → 0.6.0`，桥 `VERSION 6 → 7`（包 `0.4.0 → 0.5.0`）。
  实际改动：
  - **桥**：`subscribe(target)` 接受 `SessionId | SubagentAddress`（`retain(address)` + `uiWorkspace.openSession(address)`）；
    投影订阅键表补 `subagentCatalog` / `subagent` / `subagentTiming`，并订阅 `sessions.list`（catalogDigest 去噪）；
    新增 `subagents()`：目录根 = 当前会话（子会话时取父会话），从 `sessions.list` 的 summary 投影组一层目录，
    子行拼 `subagentTiming` / `tokenUsage` / `modelSelection` / `uiSession.sessionStatus` / `completionUnread`，
    目录缺失时 `refreshProjections` 再读一次，过滤 `external`；`snapshot()` 透出 `subagent`；
    `listSessions()` 透出 `origin` / `parentId`；`ping.methods` 加 `subagents`。
  - **原生**：`native-types` 子智能体 DTO；`core-bridge` 能力位 + `supportsSubagents()` / `subagents()` + `subscribe(target)`；
    新增 `ui/subagent-panel.tsx`（模式 / 状态 / 等待授权 / 未读 / 耗时 / token / 模型 / 团队徽标）；
    `native-chat-root` 状态与刷新、标题右侧「子智能体」图标（运行数角标 / 橙点）、子会话面包屑返回、
    子会话隐藏团队入口、子会话不请求模型目录（避免错误条）、按 `snapshot.subagent` 决定 composer 只读；
    `composer.tsx` 增 `readOnly` 分支（只读提示，运行中保留 Stop）；
    `chat-node-data` / `tool-row`：`subagent_fork` 归 `subagents`，`send_message` / `list_agents` / `interrupt_agent` 归新类目
    `agentControl`（逐工具标题「发送消息 / 查看子智能体 / 中断子智能体」），subagent 标题对齐 Web「创建子智能体」；
    `timeline-nodes` 把 `subagent-settled` 渲染成「子任务状态更新」卡片；`styles.css` 新增入口 / 面包屑 / 只读 /
    目录浮层样式（全部主题变量）。
  - **版本 / 文档**：manifest / package / versions.json 三处 `0.6.0`；bridge 包 `0.5.0`；
    README、architecture、development（回归 59–66）、troubleshooting、bridge README 同步。
- **与提案的偏差**：
  1. `subagents()` 没有 `{ parentSessionId }` / `refresh` 参数：目录缺失时内部自动 `refreshProjections` 再读一次，失败返回空目录。
  2. 面板模式只显示 可继续 / 一次性 / 未知；`external` 在桥侧过滤（提案里的「外部」chip 未实现）。
  3. **提案外补充**：实测 dsh 0.2.1-rc.3 的 `sessions.list` 会把子会话行也放进 `ids`（与调研结论「只进 byId」不符）。
     否则会话选择器会混入子会话（实测确实混入）。桥 `listSessions()` 因此增加 `origin` / `parentId`，
     原生面板按 `origin !== 'subagent'` 过滤，保证子会话不进入会话选择器。
  4. 子智能体入口只在根会话显示：子会话里只能通过面包屑返回（第 9 节「首版一层」的取舍）。
- **验证**：
  - `npm run build` / `npm run check` 通过；`node --check packages/dsh-obsidian-bridge/lib/client.js` 通过。
  - CDP 实测（Obsidian 1.14.x，DigitalGarden vault，插件 0.6.0，dsh 0.2.1-rc.3）：
    重载插件后 `ping()` 返回 `version: 7` 且 methods 含 `subagents`；
    打开含子代理的会话（`session-aa2d6011…`）标题右侧出现子智能体图标；浮层列出
    「读取 README.md 前 20 行并汇报」（团队徽标、可继续、空闲、模型、85.6k token、耗时 23s）；
    点行打开子会话：面包屑「创建 reviewer 队友并汇总 README › 读取 README.md 前 20 行并汇报 / 可继续」，
    子会话正文与 composer 正常（父会话在线时可输入、发送按钮可用）；返回父会话正常；子会话里团队入口隐藏；
    以子会话 id 直接打开（旧路径）时显示只读「父会话不可用：只能查看。」；
    会话选择器不再出现子会话（`origin` 过滤生效）；团队图标 / 团队面板行为与 0035 一致；
    过程行里 `list_agents` 显示「查看子智能体」等新标题。
  - 未实测：新 spawn 子代理的实时运行角标 / 等待授权、一次性子会话的只读实机样本（代码路径与 DOM 结构已核对，
    留待真实使用补验）。

