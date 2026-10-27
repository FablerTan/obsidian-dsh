---
status: done           # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户选路：B / 标题右侧图标 / 显示等待授权 / 0.5.0
scope: packages/dsh-obsidian-bridge, src/view/native, src/shared, styles.css, docs
issue: 原生面板支持 dsh「智能体团队」（Agent Teams）插件：能看到团队 roster / 任务板，团队工具行与队友消息可读
---

# 0035 原生面板支持 dsh「智能体团队」（Agent Teams）

> 对应路线图 [R-18](../roadmap.md#需求待办)。**本文只做调研与路径对比，选路前不改代码。**

## 1. 背景与问题

用户要为本插件添加对 dsh「智能体团队」插件的支持，先要弄清两件事：

1. **这个插件增加什么能力**（模型侧工具、团队领域、Web 面板、数据投影）；
2. **本插件的原生面板要适配哪些面**（工具行、消息渲染、团队状态、会话导航、设置启用链）。

现状：本插件的原生聊天面板（`src/view/native/`）通过离屏官方 core webview 里的
`dsh-obsidian-bridge` v5 取数据（`listSessions / subscribe / snapshot / nextEvent / send /
models / permissions / context / commands / skills / executeCommand`），自己渲染 React UI。
「智能体团队」是 dsh 随安装提供、默认关闭的实验性 bundle
`@deepseek-ai/dsh-experimental-agent-team-profile`（中文名「智能体团队」），
在设置页「插件 → 可选 / 实验性插件」里已经能看到并启停（[0032](0032-optional-bundles.md) 已落地）。
但启用后，原生面板只把它当成普通工具调用与上下文注入，**看不到成员列表和共享任务板**，
也**无法打开队友会话**——这正是本提案要补的部分。

## 2. 调研结论：Agent Teams 插件增加了什么

> 依据：`~/dsh/deepseek-harness`（本机实际运行的 dsh 0.2.1-rc.3 checkout）。
> 关键源码：`packages/experimental/agent-team-profile/`、`packages/experimental/agent-team/`、
> `packages/experimental/tool-agent-team/src/index.ts`、`packages/experimental/client-ui-agent-team/src/client/`。

### 2.1 启用方式与组合

- 单个实验性 bundle：`@deepseek-ai/dsh-experimental-agent-team-profile`（`package.json.icon` + `locale/zh.json` 的 `meta.title = 智能体团队`）。
- `cordis.patch.yml` 在 `dsh-base` 之后：**禁用** `tool-subagent-control` / `tool-subagent` / `tool-subagent-fork`
  （即通用 `subagent`、`subagent_fork` 与旧的 continuable-subagent 控制），**插入**团队领域服务、
  `tool-agent-team` 九个工具与 `ui-agent-team` Web 面板；成员上限 8。
- 它是 profile 级改动，**启用 / 停用后必须重启 dsh 服务**；隐藏 core 页面是重启后重新加载的，
  所以本插件现有的「插件」tab →「重启服务」链路刚好覆盖。

### 2.2 团队领域（模型与数据）

- 每个 Lead 会话最多一支 Team；成员是 Lead 的**直接子会话**，共享同一个工作目录（无 worktree 隔离、无文件锁）。
- 持久状态写在 Lead 会话日志里：roster（name / description / provider / context / phase / error）、
  mailbox 消息、共享任务 DAG（`revision` CAS、`blockedBy`、提示性 `writeScopes`）。
- 客户端可见投影 **`agentTeam`**（挂在 Lead 会话上，wire view 固定形状）：

  ```ts
  interface TeamProjection {
    members: { id: SessionId; name: string; role: 'lead' | 'teammate';
               phase: 'provisioning' | 'active' | 'failed'; error?: string }[]
    tasks: { id: string; revision: number; subject: string; description: string;
             status: 'pending' | 'in_progress' | 'completed';
             blockedBy: string[]; writeScopes: string[];
             ownerName?: string; ready: boolean; writeScopeWarnings: string[] }[]
    failure?: string
  }
  ```

  **投影里没有 `running` 与 `model`**：running 要另取会话状态，model 要另取 `modelSelection` 投影。
  teammate 子会话上读到的是「自己当 lead、无成员无任务」的空投影，所以必须读 **Lead（根）会话** 的投影。
- 变更通过 Host 控制流 `sessions.control` 的 projection frame 广播；客户端按 `sessionId + key` 写入投影仓库。
  桥里用 `sessionFace().projections.faceOf('agentTeam').subscribe(...)` 即可（与现有 `contextPressure` / `contextBreakdown` 完全同一条路）。

### 2.3 模型工具（九个）

| 工具 | 用途 | 主要参数 | 结果要点 | Web 中文标题 |
|---|---|---|---|---|
| `spawn_teammate` | 创建队友（仅 Lead） | name / description / prompt / context | `{ member }`（用 `target` 而非 sessionId） | 创建队友 |
| `send_message` | 给成员发消息 | target / message | `{ sent: true }` | 发送消息 |
| `list_agents` | 查看成员与状态 | — | 成员数组（`target` / 状态） | 查看子智能体 |
| `wait_agent` | 等下一次团队变化 | timeout_ms | `{ timedOut, noProgress? }` | 等待子智能体 |
| `interrupt_agent` | 中断成员当前轮（仅 Lead） | target | `{ previousStatus }` | 中断智能体 |
| `team_task_create` | 建共享任务 | subject / description / blocked_by? / write_scopes? | TaskView | 创建团队任务 |
| `team_task_list` | 列任务 | status? / owner? / ready? / cursor? / limit? | `{ tasks, nextCursor? }` | 查看团队任务 |
| `team_task_get` | 读任务 | task_id | TaskView | 读取团队任务 |
| `team_task_update` | 更新任务（CAS） | task_id / expected_revision / action / … | TaskView | 更新团队任务 |

工具结果**不暴露成员 sessionId**（统一叫 `target`），所以原生面板要拿成员会话 id 只能读 `agentTeam` 投影。

### 2.4 Web 面板（与原生面板对标）

- 会话页头一个「团队」action（users 图标），hover 150ms / 点击打开浮层；面板**只读**：
  roster（状态点：running / inactive / provisioning / failed，当前会话标签，模型标签）、
  共享任务板（状态点：idle / warning / ongoing / done，负责人、依赖、就绪、写入范围与重叠警告、描述两行折叠展开）、
  投影 `failure` 错误条。
- 成员状态 = `useSessionStatus[id].running`（全局 `api-session/status` 事件），回退会话列表摘要；
  模型 = 成员自己的 `modelSelection.next.model` 投影。
- 点成员会 `uiWorkspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' })`
  打开 teammate 子会话（addressed-subagent 路径）。
- 面板不提供 spawn / rename / delete / interrupt；晚启用插件需要刷新页面才收到投影。

### 2.5 队友消息如何进入 Lead 会话

- teammate 发来的消息在 Lead 历史里是 `source.kind = 'team-message'` 的 **context 节点**
  （`senderName` 在 source 里），触发下一轮；不是 user 消息。
- Web 把它渲染成「Team message received」触发器 + 内容；不会显示成用户自己说的话。

## 3. 本插件的适配缺口（基于代码核对）

| 方面 | 现状 | 缺口 | 本提案结论 |
|---|---|---|---|
| 启用 / 停用 bundle | ✅ 「插件」tab 已能发现并启停（0032），并已提示「重启服务后生效」 | 无 | 不改；只在文档里补充「团队成员上限 8 / 晚启用需重载」 |
| 模型工具运行 | ✅ 工具调用原样进 `snapshot().nodes` | 无 | 不改 |
| 团队工具行 | 九个工具都落到 `category: 'tools'`：扳手图标 + 原始工具名 + JSON 参数，摘要「调用了工具」 | 没有中文标题 / 图标 / 参数摘要 | 新增 `team` 类目 + 按工具名的标题 / 摘要（A） |
| 团队 roster + 任务板 | ❌ 完全没有；只能从 Lead 的文字回复里猜 | 缺 `agentTeam` 读取与 UI | bridge v6 `team()` + 只读面板（B） |
| 队友入站消息 | 渲染成通用「上下文注入」折叠 JSON 卡片 | 认不出 `team-message`、没有发送者 | 友好化 `team-message` context 卡片（A） |
| 成员会话导航 | ❌ 打不开队友会话 | 子会话不在 `listSessions` 的 `ids` 里；需要 addressed 地址 | 放到路径 C |
| 会话列表被队友子会话污染 | ✅ 不存在：`listSessions` 只映射 `snapshot.ids`，teammate 子会话只在 `byId` | 无 | 不为此改动；若将来要导航再暴露 `origin/parentId` |
| 成员运行状态 / 模型标签 | ❌ 面板都没有 | 投影不含 running/model，需从会话状态与 `modelSelection` 拼 | B 里一并做（成本低） |
| 队友等待授权 | ❌ 原生面板只订阅当前会话的 `pendingInteraction`，看不到队友的 | 需要成员级 pending 或导航到成员会话 | B 可选显示标记；能处理要 C |

桥侧可行性（已验证）：

- `agentTeam` 投影：`sessionFace().projections.faceOf('agentTeam').getSnapshot()` 可读，`subscribe` 可订阅；
  `subscribe()` 里现有 context 投影的订阅键表加一个 `"agentTeam"` 就能无刷新。
- 成员 running：`uiSession.sessionStatus.getSnapshot().get(memberId)?.running`（与 Web 同源，含 `api-session/status` 事件与 pendingInteraction）。
- 成员 model：`sessions.list.getSnapshot().projectionsBySession[memberId]?.values.modelSelection?.next?.model`（与 Web 同源）。
- 投影只挂在 Lead 会话：面板只在 Lead 会话订阅时展示即可（路径 B 不切会话，天然满足）。

## 4. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A 最小适配：工具行 + 队友消息** | [chat-node-data.ts](../../src/view/native/ui/chat-node-data.ts) 加 `team` 类目与九个工具名映射；[tool-row.tsx](../../src/view/native/ui/tool-row.tsx) 加标题 / 图标 / activity / past / 参数摘要（spawn→name+description、send_message→target、team_task_*→subject 等）；[timeline-nodes.tsx](../../src/view/native/ui/timeline-nodes.tsx) 的 ContextCard 识别 `source.kind === 'team-message'`，显示「队友 <name>」+ 正文 | 3 个 UI 文件，约 80–120 行；**不改桥、不改协议** | 成本最低；但看不到 roster / 任务板，队友在干什么只能从工具行与消息推断；审批仍然不可见 | 可选基线，但不单独立项（并入 B） |
| **B（推荐）A + 只读团队面板** | 桥 v6：`client.js` `VERSION = 6`、methods 加 `team`、`subscribe()` 投影键表加 `agentTeam`、新增 `team()`（读投影 + 拼 running/model + sanitize）；[core-bridge.ts](../../src/view/native/core-bridge.ts) 能力探测 + `team()`；[native-types.ts](../../src/shared/native-types.ts) 加团队 DTO；新增 [team-panel.tsx](../../src/view/native/ui/team-panel.tsx)（复用 MenuShell 浮层）；[native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) 页头加「团队」图标按钮（有投影时出现）+ 状态与刷新；[styles.css](../../styles.css) 面板样式 | 桥 1 文件 + 原生 7 文件 + CSS；约 400–500 行 | 中等；只读，不碰会话切换 / 地址 / prompt 链路，风险低。限制：队友需要授权时面板只能提示、不能处理（原生面板仍只能看当前会话的 pending） | **推荐先做**：与 Web 面板对齐（除导航），一次把「看得到团队」补上 |
| **C 一步到位：B + 成员会话导航** | 桥 `subscribe` 支持带 `SubagentAddress`（`{parentSessionId, childSessionId, mode:'continuable'}`）retain，并在看子会话时保留 Lead 引用；`team()` 按根会话取投影；原生页头加「Lead / 队友」面包屑与返回；成员行可点开其会话，队友 pending 授权因此可见 | B 的全部 + 桥会话模型重构 + 原生导航状态；约 +250–350 行 | 较高：addressed-subagent 的 retain / history / prompt 路由、Lead 引用保持、切会话竞态、返回后状态恢复都要验证；`retain(childId)` 依赖父会话 `subagentCatalog` 已加载，否则可能 `unknown session` | 与 Web 完全等价；**如果经常需要处理队友的授权弹窗，选 C**；建议 B 落地后单独立项 |
| D（不选）回到官方 Web 面板 / iframe | 直接把隐藏 core 变成可见面板 | — | 与 [0008](0008-native-only-surface.md) 的 native-only 方向冲突，删过一遍的入口不要再加 | 否 |

**推荐 B**：用户要的「支持」首先是**看得到团队在做什么**。B 用只读投影做到 roster + 任务板 + 实时更新，
不触碰最容易出竞态的会话切换与 addressed 地址；A 的工具行与消息友好化顺带包含。
C 的导航价值主要在「处理队友的授权 / 继续对话」，可以作为 B 落地后的下一个需求（用真实使用触发）。

## 5. 改动清单（按路径）

### 路径 B（推荐；含 A）

| 文件 | 改动 |
|---|---|
| [packages/dsh-obsidian-bridge/lib/client.js](../../packages/dsh-obsidian-bridge/lib/client.js) | `VERSION = 6`；补丁头注释写 v6；`subscribe()` 的投影订阅键表加 `"agentTeam"`；新增 `team()`：`projectionValue('agentTeam')` → 无投影返回 `null`；成员拼 `running`（`uiSession.sessionStatus`）与 `model`（`list.projectionsBySession`）；`sanitize()` 后返回 `{ members, tasks, failure? }`；`ping().methods` 加 `team`；bridge 对象导出 `team` |
| [src/shared/native-types.ts](../../src/shared/native-types.ts) | `NativeTeamMember` / `NativeTeamTask` / `NativeTeamProjection` DTO |
| [src/view/native/core-bridge.ts](../../src/view/native/core-bridge.ts) | `teamCapability`（methods 含 `team`）、`supportsTeam()`、`team(): Promise<NativeTeamProjection \| null>` |
| [src/view/native/ui/team-panel.tsx](../../src/view/native/ui/team-panel.tsx)（新） | 只读面板：roster（状态点 / 名字 / 角色 / 状态文案 / 模型 / 当前会话标）+ 任务板（状态点 / 标题 / 两行描述展开 / owner / blockedBy / writeScopes / warnings）+ failure 错误条；复用 [menu-shell.tsx](../../src/view/native/ui/menu-shell.tsx) 的锚定浮层 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 状态 `team`；`refreshSnapshot` 后按能力刷新 `team()`；页头「团队」图标按钮（投影存在才显示）+ 浮层开关；会话切换时收起 |
| [src/view/native/ui/chat-node-data.ts](../../src/view/native/ui/chat-node-data.ts) | `ProcessCategory` 加 `team`；九个工具名 → team；按工具名的中文标题表 |
| [src/view/native/ui/tool-row.tsx](../../src/view/native/ui/tool-row.tsx) | team 类目的标题 / 图标（users、list-checks、send 等）/ activity / past / 参数摘要 |
| [src/view/native/ui/timeline-nodes.tsx](../../src/view/native/ui/timeline-nodes.tsx) | `ContextCard` 识别 `data.source.kind === 'team-message'` → 队友消息卡片（senderName + 正文），其余 context 不变 |
| [styles.css](../../styles.css) | 团队面板与状态点样式（Obsidian 主题变量） |
| [manifest.json](../../manifest.json) / [package.json](../../package.json) / [versions.json](../../versions.json) | 插件版本 `0.4.1 → 0.5.0`（三处一致，versions 追加新键） |
| [packages/dsh-obsidian-bridge/package.json](../../packages/dsh-obsidian-bridge/package.json) | bridge 版本 `0.3.0 → 0.4.0`（v6） |
| docs | [architecture.md](../architecture.md) 数据面补 v6 `team()` / `agentTeam`；[development.md](../development.md) 改动地图补团队面板；README 功能清单；[troubleshooting.md](../troubleshooting.md) 补「启用智能体团队后要重启并重载」 |

### 路径 C 额外改动

- 桥：`subscribe(sessionId)` 增加可选 `address` 参数并按 `sessions.retain({ parentSessionId, childSessionId, mode })` retain；
  看子会话期间保留 Lead 引用（`team()` 取根投影）；`snapshot()` 暴露 `subagent.address` 供原生端做面包屑。
- 原生：页头面包屑 / 返回 Lead；成员行可点击；会话切换与 pending 卡片复用现有逻辑；
  同步补 [docs/architecture.md](../architecture.md) 的「订阅会话」约束（一次只有一个 active 会话 + 父引用）。

## 6. 行为变化

路径 B：

- 启用「智能体团队」并重启后，Lead 会话页头出现「团队」图标；点开是只读面板：
  - roster：Lead + 队友（运行中 / 空闲 / 创建中 / 失败、模型标签、当前会话标）；
  - 任务板：状态点 + 标题 + 描述（两行折叠）+ 负责人 / 依赖 / 就绪 / 写入范围与警告；投影失败时显示错误条。
- 队友执行时面板状态实时变化（无需刷新）；成员增删、任务增删改同样实时。
- 九个团队工具在过程行里显示中文标题与关键参数摘要；队友发来的消息显示成「队友 xxx」卡片，而不是 JSON。
- 未启用团队（无 `agentTeam` 投影）时：不出现团队入口，其余行为完全不变；旧桥（v5）也不显示入口。

路径 C 追加：

- 点成员行打开其会话；页头显示「Lead / 队友名」并可返回；队友的授权 / 提问卡片可正常处理。
- 会话列表仍不显示队友子会话（只从团队面板进入）。

## 7. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 桥 v6 与插件版本错配 | 新插件 + 旧桥：不显示团队入口，工具行 / 消息仍可用；旧插件 + 新桥：无影响 | 能力探测（`supportsTeam()`）已按 methods 判断，天然降级 |
| `agentTeam` 投影缺失 / 晚启用 | 入口不出现或出现后为空 | `team()` 返回 `null`，UI 隐藏；重启服务 + 重载插件后恢复 |
| 成员 running 状态短暂缺失 | 显示为空闲 | 用会话状态优先、列表摘要兜底；缺失时显示「—」 |
| 任务描述 / 写入范围过长 | 面板拥挤 | 描述两行折叠 + 展开；writeScopes 用紧凑 chip / 换行 |
| 桥 `sanitize` 截断（数组 300 / 深度 8） | 成员 8、任务通常远小于上限，风险低 | 面板只依赖投影字段，必要时提高上限 |
| C 的 addressed 导航失败 | 打不开队友会话 / 不能继续对话 | C 单独提案 + 特性开关（先只读面板），失败时退回只能看 |
| 回滚整体 | — | 还原 8 个源码 / 样式文件 + bridge 文件，重新 `npm run build`、重启 dsh、重载插件；版本号回退三处 |

## 8. 验证

自动化：

    npm run build    # tsc + esbuild
    npm run check    # 版本 / 依赖 / 类型 / main.js 与源码一致
    node --check packages/dsh-obsidian-bridge/lib/client.js

桥冒烟（不依赖 Obsidian）：把 `packages/dsh-obsidian-bridge` 重新 link 到 obsidian profile（已是 link），重启 dsh，
在隐藏 core 页面里执行 `window.__DSH_OBSIDIAN_BRIDGE__.ping()` 确认 `version === 6`、methods 含 `team`；
`team()` 在未启用团队时返回 `null`。

手动（Obsidian 内）：

1. 设置 → 插件 → 可选 / 实验性插件 → 启用「智能体团队」→ 重启服务 → 重载插件；
2. 新建会话，发一句「创建一个名为 reviewer 的队友检查仓库结构，再让它用团队任务板记录结论」；
3. 过程行出现「创建队友 / 发送消息 / 等待子智能体 / 创建团队任务」等中文行，参数摘要可读；
4. 页头「团队」图标出现，面板列出 lead + reviewer 与任务状态，任务 / 成员变化实时更新；
5. reviewer 回复时，Lead 历史里出现「队友 reviewer」消息卡片（不是 JSON）；
6. 停用「智能体团队」→ 重启 → 团队入口消失，普通会话无异常。

验收标准（可判定）：DOM 里存在 `.dsh-native-team-trigger` 且 `aria-expanded` 随点击切换；
启用团队后 `bridge.team()` 返回非 null 且 `members.length >= 2`；未启用时返回 null；
九个团队工具行标题与 Web 一致；`team-message` context 卡片不再渲染原始 JSON。

路径 C 追加：点成员行后 `snapshot().sessionId === memberId`，页头出现返回按钮；返回后恢复 Lead；
队友 pending 授权卡片可提交并继续。

## 9. 需要你拍板

- [x] **选哪条路径**：**B**（只读团队面板；用户 2026-10-27 选定）。
- [x] 团队入口位置：**会话标题右侧，只显示一个图标**（用户指定；仅在有团队投影时出现）。
- [x] B 是否显示「队友等待授权」标记：**显示**（用户指定）。
- [x] 版本号：**`0.5.0`**（用户确认）。

## 10. 实施记录

- **2026-10-27（实现）**：按用户选定路径 **B** 落地；入口放在会话标题右侧（仅有团队投影时出现的 users 图标）；
  面板显示成员「等待授权」标记与标题图标橙点；版本 `0.4.1 → 0.5.0`，桥 `VERSION 5 → 6`（包版本 `0.3.0 → 0.4.0`）。
  实际改动：
  - 桥：`VERSION=6`；`subscribe()` 投影订阅键加入 `agentTeam`；新增 `team()`（读 Lead 投影 +
    `uiSession.sessionStatus` 的 running/pendingInteraction + `sessions.list.projectionsBySession` 的 model + `sanitize`）；
    `ping.methods` 与 bridge 对象导出 `team`。
  - 原生：`native-types.ts` 增团队 DTO；`core-bridge.ts` 增 `teamCapability` / `supportsTeam()` / `team()`；
    新增 `ui/team-panel.tsx`（只读 roster + 任务板，复用 `MenuShell`）；`native-chat-root.tsx` 增团队状态、
    刷新（随快照 / 切会话）、标题右侧图标与面板；`chat-node-data.ts` + `tool-row.tsx` 增 `team` 类目、
    九个工具中文标题与参数摘要；`timeline-nodes.tsx` 把 `team-message` context 节点渲染成「队友 <name>」卡片。
  - 样式：`styles.css` 增团队面板 / 状态点 / 等待授权 badge / 队友消息样式（全部主题变量）。
  - 文档：README、AGENTS、architecture、development（改动地图 + 回归 51–53）、troubleshooting（新增团队排障）、
    project-guide、bridge README、changes 索引、roadmap。
- **验证**：
  - `npm run build`（tsc + esbuild）通过；`npm run check` 通过（版本三处一致 / 无运行时依赖 / 类型 /
    main.js 与源码一致 / bridge 清单与语法）。
  - CDP 实测（Obsidian 1.14.5，开发 vault，dsh 0.2.1-rc.3）：启用「智能体团队」并重启后，
    标题右侧出现团队图标；面板列出 `lead` + `reviewer`（运行中 / 空闲、模型标签）与 `task-1`（已完成、负责人）；
    真实跑一轮 team turn 时成员 / 任务状态实时更新；过程行摘要出现「协调了团队」，注入的团队工具节点显示
    「创建队友 / 更新团队任务」与参数摘要；注入的 `team-message` context 节点渲染成「队友 reviewer」卡片、
    不再出现原始 JSON；模拟 `pendingInteraction` 时行左侧出现橙边、头部「等待授权」badge、标题图标橙点；
    旧桥 / 无投影路径由 `supportsTeam()` + `team() === null` 隐藏入口（代码路径确认）；控制台无本次改动引起的报错。
  - 测试时在本机 obsidian profile 启用了「智能体团队」并保持启用；不需要可在设置页「插件」tab 关闭后重启服务。
- **与提案的偏差**：无实质偏离。补充两条实现期发现：
  1. PTC 预设下团队工具是在 `run_code` 内调用的，过程行只显示「运行代码」而不是逐条团队工具行；
     这是会话预设行为，不是渲染缺陷（已写进 troubleshooting）。
  2. 桥只读面板按 B 路径不提供成员会话导航；队友授权只能在成员行看到「等待授权」标记，
     处理需到桌面端 / Web（路径 C 的前置条件与风险见提案第 4 节）。
