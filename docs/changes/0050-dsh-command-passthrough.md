---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户选路：A（其余按推荐）
scope: src/settings, src/view
issue: 「/」菜单的命令行改为透传 dsh 自身的命令目录（commands），以及给命令行加与技能同款的白名单 / 黑名单（只影响菜单显示）
---

# 0050 「/」菜单透传 dsh 自身命令 + 命令范围（白名单 / 黑名单）

> 对应路线图 [R-33](../roadmap.md#需求待办)。用户原话：「帮我修改一下 / 命令的触发内容吧，直接透传 dsh 本身的命令，然后添加一个和 skills 类似的黑名单和白名单机制。」
> 本轮只登记 + 调研路径，**未改代码**；选路后再按提案执行。

## 1. 背景与问题

### 现状

输入框 `/` 菜单（[0025](0025-slash-commands.md)）的命令行是**写死的两项**：`new`（本地新建会话）与 `compact`（走 `bridge.executeCommand('/compact')`），再加一组技能行。
桥 v5 起其实已经暴露了 dsh 宿主的完整命令目录：

- `packages/dsh-obsidian-bridge/lib/client.js` 的 `commands()` → `ctx.remote.commands.list(sessionId)`，只返回 `{ name, description }`（**丢掉了 dsh 的 `input.hint` / `definitionId`**）；
- `executeCommand(line)` → `ctx.remote.commands.execute(sessionId, line, [])`，返回 `matched` + `CommandResult`；
- `src/view/native/core-bridge.ts` 已有 `commands()` / `executeCommand()` / `supportsCommands()`，但**原生 UI 从未调用 `commands()`**（`grep` 只有类型定义），菜单仍靠静态表。

dsh 侧（本机 `~/.local/bin/dsh` → `~/dsh/deepseek-harness` 0.2.1-rc.3，profile `obsidian`；已核对源码与 app.asar 构建，源码行号可对上）事实：

| 事实 | 证据 / 补充 |
|---|---|
| 命令注册表是 `packages/interaction/commands`，`list()` 返回 `CommandDescriptor`：`name` / `description`（英文）/ 可选 `input.hint`（+`attachments`）/ `definitionId`（first-party 身份）；名字规则 `/^[a-z][a-z0-9_-]*$/` | `packages/interaction/commands/src/index.ts`；桥 `client.js:1219-1236` 只取了 name + description |
| **命令目录按会话 / 预设变化**。本机 `obsidian` profile 默认 `ptc` 预设下是 **6 条**：`compact`、`export`、`feedback`、`goal`、`permission`、`plan`；`minimal` 预设只有 `compact`。带 `input.hint` 的是 `goal` / `feedback` / `plan` / `permission`，`compact` / `export` 没有 | `dsh-base` 的 `cordis.patch.yml`（feedback / permission）+ `dsh-web-app`（export；goal / plan / compact 在 presets 内以 agent 作用域挂载）；per-session RPC |
| 命令目录**不含技能**（技能是独立命名空间：`skills/list` + 客户端另一个 `/` source，选中只插纯文本 `/skill-name `，宿主在 pre-step 注入正文） | `packages/skill/*`、`packages/client/ui-skill/src/client/index.ts` |
| 官方 GUI 交互：**无 `input.hint` 的宿主命令选中即执行**（token 从草稿消失）；**有 hint 的只插入 `/name `**，补参数后 Enter 才 execute；同名时**命令优先于技能** | `packages/client/ui-commands/src/client/*`；`ui-skill` 注释明确写「A name shared with a host command still resolves to the command」 |
| `/` 触发**只认草稿开头**（前导空白后第一个非空白字符）；带 hint 的命令只在 leading 位显示 | `packages/client/ui-input-trigger/src/core/detect.ts` |
| `executeCommand` 入参必须是完整命令行、以 `/` 开头（`parseCommand`）；成功 / 失败都写 `command/run` + `command/done`，不产生模型消息；非 `compact` 在时间线是 `kind="command"` 节点，`/compact` 是 `manual-compaction` 节点（原生 `timeline-nodes.tsx` 已能渲染） | `packages/interaction/commands/src/index.ts`；`packages/client/ui-chat` |
| 把 `/compact` 当普通消息 `send()` **不会**执行；唯一会被宿主认领的字面量是技能名（`dsh-tool-skill` 的 pre-step 扫描） | 全仓 `parseCommand` 只在命令注册表 / 客户端触发层使用 |
| `/export` 经桥执行**不会真的下载**：宿主 handler 只回 `Session log download requested.`，真正下载由 Web 客户端的 `command/executed` 监听触发，而桥直连 `remote.commands.execute` 不经过 ui-commands | `packages/session-log-export/*`（host + client） |
| 官方 Web GUI 对 **subagent 子会话**直接返回空命令目录；宿主 `list` 本身会给该子 agent 的命令 | `ui-commands` 客户端分支 |

### 问题

1. 菜单内容与 dsh 脱节：宿主新增命令（含插件注册的命令）、切预设或 profile 组合变化时，原生菜单永远只显示 `new` / `compact`，无法「透传 dsh 本身的命令」。
2. 命令多了以后没有范围控制：技能行已有三档白名单 / 黑名单（[0037](0037-skill-slash-scope.md)），命令行没有同款机制。

### 影响范围

只影响输入框 `/` 菜单：命令行来源、选中后的行为、发送时对命令行的路由，以及「聊天」设置页新增的一项范围设置。
不影响技能目录 / 技能加载 / `/skill` 文本注入、@ 菜单、消息渲染、模型 / 权限 / 上下文、dsh 服务生命周期。

## 2. 目标与非目标

### 目标

- `/` 菜单的命令组改为**来自桥的 `commands()`**（当前会话的 dsh 命令目录），名字 + 描述按 dsh 返回展示；宿主新增命令 / 插件注册命令无需改插件代码，刷新菜单即出现。
- 命令**透传执行**：菜单选中命令后把 `/name ` 写进草稿（带参命令继续输入参数）；按 Enter 时，若草稿是「命令目录里的名字 + 可选参数」，改走 `bridge.executeCommand(整行)`，而不是 `bridge.send()`。
  - 这样 `/compact`、`/feedback <text>`、`/goal …`、`/plan …`、`/permission …` 都能用，参数就是用户输入。
- 保留本地 `/new`（dsh 命令目录里没有「新建会话」；它是插件调用 `bridge.createSession` 的本地动作），继续一步执行。
- 新增与技能同款的**命令范围**：设置页「聊天」tab 三档（不启用 / 白名单 / 黑名单），默认不启用；选中后展开添加栏；条目是 **dsh 命令名**（不是技能名），只过滤 `/` 菜单里的命令行。
  - 白名单：只显示命中条目；白名单为空时命令行全部隐藏（本地 `/new` 与技能行不受影响）。
  - 黑名单：隐藏命中条目；空黑名单不过滤。
  - 只影响菜单显示；手敲的 `/name` 仍照常透传执行（与技能范围「不影响加载」的边界一致）。
- 与官方一致的边界：只认草稿**开头**的 `/`（命令 claim 与执行路由都按这个判断）；同名技能行隐藏（命令优先）。
- 已知不可用命令（当前是 `/export`，见风险表）用一张极小的内置「原生面板不支持」名单从菜单隐藏，避免点了看起来成功、实际没有文件。
- 桥太旧（无 `commands` 能力）时：命令行区域降级（只显示 `/new` + 技能行 + 一行说明「命令列表需要更新 dsh-obsidian-bridge 并重启 DSH 服务」），不阻塞其它功能。

### 非目标

- 不实现官方 GUI 的完整 slash 输入框架（`inputTriggers` / command chip / hint placeholder / 图片附件）；本次只做「目录 + 插入 + 发送路由」。
- 不改 dsh 源码，不改宿主命令实现，不新增宿主命令。
- 不做命令参数补全 / 校验 / 帮助页；参数原样交给 dsh。
- 不合并命令范围与技能范围（名字空间不同：命令是扁平 `[a-z][a-z0-9_-]*`，技能名允许点号；两者独立配置）。
- 不变更技能行的既有行为（选中仍插入 `/技能名 `，由宿主注入）；只隐藏与命令同名的技能行。
- 不做 `/export` 的原生下载链路（需要另立需求，见第 8 节）。
- 不 bump 版本号；不重做 `/` 菜单的样式与键盘模型。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

三条路径的**命令范围**部分完全一致（宿侧设置 + 纯函数过滤，见第 4 节），差别只在「命令目录从哪来、选中后怎么执行、描述 / 参数提示怎么显示」：

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）宿侧透传，桥零改动** | 菜单命令组来自现有桥 `commands()`；选中命令一律只把 `/name ` 插入草稿；`composer.tsx` 的 Enter 分支在 `onSend()` 前判断「草稿开头是否是命令目录里的名字」：是 → 调根组件 `runCommand(整行)`（现有 `bridge.executeCommand` + 错误条 / 时间线节点），否则照旧 `bridge.send()`；本地 `/new` 单独走 `onNewSession`。展示上按 `name` 给 6 个 first-party 命令补中文标签 / 描述（未知 / 第三方命令回退 dsh 英文 description） | `src/view/*`（slash / command-scope / slash-menu / composer / root / view / panel-host）+ `src/settings/*` + `src/main.ts` + 文档，约 10 个文件；桥 0 改动 | 不改桥、不 relink、不重启服务；参数天然可用；但 `/compact` 从「选中即执行」变成「选中插入、再按一次 Enter」（多一步），且**拿不到 `input.hint`**（不显示参数占位）、拿不到 `definitionId`（中文标签只能按 name 白名单映射） | **推荐**：改动最小、可独立冒烟、回滚成本低；与项目「桥只做语义投影、宿侧管显示」的既有取舍一致（0037 已因此否掉桥侧过滤） |
| B 桥升一版暴露 `input` / `definitionId`（官方同款体验） | 在 A 的基础上：桥 `commands()` 透传 `input.hint`（+ `attachments`）与 `definitionId`，`VERSION 7 → 8`（若 [0044](0044-dsh-plugin-panels-in-obsidian.md) 先落地则顺延为 9，需协调）；菜单里**无 hint 的命令选中即 `executeCommand`**、有 hint 的命令插入 `/name ` 等参数，hint 作为占位提示；中文标题 / 图标按 `definitionId` 映射（与官方 zh 字典同源） | A 的全部 + 桥 1 文件 + 重新 link + 重启服务 + 桥版本与 0044 协调 | 体验最贴近官方（一步执行 + 参数占位 + 本地化）；但跨仓库两处、必须重启服务验证，且 0044 也在等桥 v8，版本号存在冲突需要协调 | 体验最好，但本次需求（目录透传 + 范围）用 A 已完整满足；建议作为后续体验优化单独立项 |
| C 全量即执行 | 菜单命令组来自 `commands()`，选中一律 `executeCommand(name)` 立即执行；不插入、不做发送路由 | 比 A 少（composer 的 Enter 路由省掉） | 带参命令（`feedback` / `goal` / `plan` / `permission`）**无法补参数**；与官方交互不一致；后续还得补 | 不推荐：看似「直接透传」，实际只对 `compact` 成立 |

> 建议：**A**。若你希望 `/compact` 保持「选中即压缩」的一步体验、并显示参数提示与官方中文标题，则选 **B**（需要改桥 + 重启服务）。

## 4. 改动清单

以路径 A 为准（B 的额外项在表后单列）：

| 文件 | 改动 |
|---|---|
| [src/settings/schema.ts](../../src/settings/schema.ts) | 新增 `CommandScope`（与 `SkillScope` 同形：`mode` / `allow` / `deny`）、`normalizeCommandName` / `normalizeCommandNames`（trim + 小写；只接受 dsh 命令名 `^[a-z][a-z0-9_-]*$`；拒绝空串 / 斜杠 / 点号等非法值；去重）；`DshPluginSettings` 加 `commandScope`（默认 `off`）/ `commandWhitelist` / `commandBlacklist`（默认空数组）；`mergeSettings` 非法模式回落 `off`、名单读取时归一化 |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 「聊天」tab 在「技能范围」之后新增一张范围卡片「命令范围」（复用 `renderScopeCard` / `renderScopePanel`）：三档下拉 + 白 / 黑名单添加栏；说明文案强调「只影响 `/` 菜单里显示的 dsh 命令，不影响命令目录与执行」；条目校验用命令名规则 |
| [src/view/native/command-scope.ts](../../src/view/native/command-scope.ts)（新增） | `filterSlashCommands(commands, scope)` 纯函数：`off` 原样返回；白名单只留**名字精确命中**条目（空白名单返回空）；黑名单排除命中；未知模式兜底不过滤；大小写不敏感。（命令是扁平命名空间，不做技能的 `- ` 前缀覆盖） |
| [src/view/native/slash.ts](../../src/view/native/slash.ts) | 删掉写死的 `compact` 规格，`SLASH_COMMANDS` 只保留本地 `new`；新增 `slashCommandItems(commands, query, available)` 把 `NativeCommand[]` 转成菜单行（`key: 'command:' + name`）；新增 first-party 中文标签表（按 name：compact / export / feedback / goal / permission / plan，未知命令回退 dsh description）；本地 new 用 `key: 'local:new'` 区分；`SlashItem.kind` 扩展 `'command' | 'local' | 'skill'`；提供「同名技能行隐藏」的纯函数（命令优先） |
| [src/view/native/ui/slash-menu.tsx](../../src/view/native/ui/slash-menu.tsx) | 命令行 / 技能行分组与行渲染适配新的 `kind`；命令组拿不到内容时复用现有 note 行（加载中 / 读取失败 / 桥太旧 / 全部被范围过滤 / 全部与技能同名） |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 新增 props：`loadCommands` / `getCommandScope`；新增 `commands` / `commandsLoading` / `commandsError` / `commandScope` 状态；打开 `/` 菜单时与技能目录一起拉取（`Promise.all`，互不阻塞）、按快照范围过滤；命令组只在**草稿 leading 位**显示（与官方一致；技能行沿用现有行首行为）；`slashItems` = 本地 new + 过滤后的命令 + 过滤后的技能（隐藏同名技能）；`activateSlash`：本地 new → `onNewSession`，dsh 命令 → `replaceSlash('/' + name + ' ')`（不执行），技能 → 原逻辑；Enter 分支：菜单未开且草稿 leading 是已知命令时改调新 prop `onRunCommand(整行)` 并清空草稿，否则 `onSend`；说明行覆盖「命令行已按范围过滤：当前没有可显示命令」 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `loadCommands={() => bridge.commands()}`、`getCommandScope={getCommandScope}`、`onRunCommand={(line) => void runCommand(line)}`；`runCommand` 复用现有 `bridge.executeCommand` + `matched` / error 处理；当前是子会话时不显示命令组（与官方 client 一致，见第 8 节可改） |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) | 透传 `getCommandScope`（与 `getSkillScope` 同处） |
| [src/view/native/core-bridge.ts](../../src/view/native/core-bridge.ts) / [src/shared/native-types.ts](../../src/shared/native-types.ts) | 路径 A 不需要改桥方法（`commands()` / `executeCommand()` / `NativeCommand` 已存在）；顺手清理 `native-types.ts` 里重复声明的 `NativeCommand` / `NativeSkill` / `NativeCommandResult`（当前重复了一遍，接口合并可编译但易误解） |
| [src/view/panel-host.ts](../../src/view/panel-host.ts) / [src/main.ts](../../src/main.ts) | `DshPanelHost` 加 `getCommandScope(): CommandScope`；`main.ts` 从 settings 组装 `{ mode, allow, deny }` |
| [docs/changes/0050-dsh-command-passthrough.md](0050-dsh-command-passthrough.md) | 本提案 |
| [docs/changes/README.md](README.md) | 索引登记 |
| [docs/roadmap.md](../roadmap.md) | 「需求待办」加 R-33 行 |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点表 / 配置持久化表 / 改动地图 / 回归清单补「命令行透传 + 命令范围」 |

**路径 B 的额外改动**：`packages/dsh-obsidian-bridge/lib/client.js`（`commands()` 返回 `input.hint` / `input.attachments` / `definitionId`、`VERSION 7 → 8`）、`native-types.ts`（`NativeCommand` 带上这几个字段）、`slash.ts`（菜单行带 hint / 按 definitionId 映射中文）、`composer.tsx`（无 hint 命中即执行；hint 作为草稿占位）、重新 link 到 profile 并重启服务。另外需与 [0044](0044-dsh-plugin-panels-in-obsidian.md)（同样计划桥 v8）确认谁先落地、版本号顺延。

## 5. 行为变化

- 输入 `/`（草稿开头）：菜单命令组 = 本地「/new 新建对话」+ 当前会话 dsh 命令目录。ptc 预设下是 `/compact`、`/feedback`、`/goal`、`/permission`、`/plan`（`/export` 按第 8 节决定隐藏或显示）；技能行仍单列「技能」分组，与命令同名的技能行隐藏。
- 选中 **dsh 命令** → 草稿里出现 `/name `（不立即执行）；补参数（`/feedback 模型回答太慢`、`/plan off`、`/permission <preset>`）后 Enter → 命令走 `executeCommand`，结果由时间线节点 / 错误条呈现。
- 选中 **/new** → 仍立即新建并切换会话（不变）。
- 选中 **技能** → 仍插入 `/技能名 `，发送时由宿主注入技能正文（不变）。
- 手敲 `/compact` / `/goal …` 后 Enter：只要草稿 leading 是当前命令目录里的名字就走 `executeCommand`（以前会当普通消息发给模型）；不在目录里的 `/xxx`、或 `/` 不在 leading 位时仍按普通消息发送。
- 设置页「聊天」新增「命令范围」卡片（徽标建议用 `⌘` 以区别技能范围的 `/`）：默认不启用；白名单 / 黑名单只改变菜单里**显示**哪些命令行；命令目录、执行、技能、`/new`、手敲命令都不受影响。
- 桥太旧：命令行区域显示说明「命令列表需要更新 dsh-obsidian-bridge 并重启 DSH 服务」，`/new` 与技能照常。
- 改设置后**下一次打开 `/` 菜单**生效，无需重载插件 / 重启服务（同 0030 / 0037）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 发送路由误伤：用户想把以 `/name` 开头的文本发给模型，而它恰好是命令名 | 消息被当命令执行 | 只在「草稿 leading 位置」且「名字在当前 `commands()` 目录里」时路由；`/` 不在开头一律不路由；出错时错误条说明 |
| `/export` 经桥执行没有文件 | 看起来成功、实际没下载 | 初版用内置「原生面板不支持」名单隐藏 `/export`；或在第 8 节选「显示 + 明确提示」/「另立需求接导出」 |
| 同名技能 vs 命令 | 点技能行插入文本、回车却执行命令 | 菜单里隐藏与命令同名的技能行（官方优先级：命令优先）；文档写明 |
| 命令目录异步、菜单打开瞬间命令尚未返回 | 首屏只看到 `/new` + 技能，稍后补齐 | 与技能一样显示「正在读取命令列表…」；返回后渲染（本次菜单不关） |
| 桥太旧 / 会话未订阅导致 `commands()` 报错 | 命令行不可用 | 降级为 `/new` + 技能 + 说明行；不阻塞发送 |
| 命令范围把命令行全挡掉 | 菜单里没有 dsh 命令 | 说明行「命令行已按「/」命令范围过滤：当前没有可显示命令」；切回「不启用」立即恢复 |
| 不同预设 / profile 命令目录不同 | 菜单行数变化，用户以为丢命令 | 说明「来自当前会话的 dsh 命令目录」；不缓存跨会话 |
| subagent 子会话：宿主会返回命令、官方 GUI 却显示空 | 子会话里能执行宿主命令（可能不符合预期） | 默认跟随官方：子会话不显示命令组（第 8 节可改为显示） |
| 中文标签按 name 白名单硬编码（路径 A） | 新增 / 改名的 first-party 命令回退英文描述 | 回退到 dsh 返回的 description 即可；路径 B 用 `definitionId` 映射可根治 |
| 路径 B 桥版本与 0044 冲突 | 两边都声明 v8 | 选 B 时与 0044 排期协调，后落地者顺延 |

整体回滚：删除路由分支 + 命令组恢复为静态表 + `commandScope` 固定 `'off'` 即回到 0025 行为；设置值留在 `data.json` 不影响其它功能。

## 7. 验证

自动化（代码侧由 Lead 执行）：

```
npm run build   # tsc -noEmit -skipLibCheck + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

纯函数冒烟（`command-scope.ts` / `slash.ts` 不 import obsidian，可单独 esbuild 打包到 /tmp）：

- `filterSlashCommands`：off 原样；白名单精确命中 / 空白名单返回空 / 不误伤前缀（`goal` 不命中 `goal-x`）；黑名单排除命中、空黑名单不过滤；未知模式兜底；大小写与首尾空格归一化。
- `normalizeCommandName`：拒绝空串 / 斜杠 / 点号 / 空格 / 中文；接受 `compact` / `feedback` / `goal` / `a-b_c`。
- `slashCommandItems`：目录映射为菜单行（含中文标签 / 英文回退）、查询过滤 / 排序沿用原 `rank`、空目录不产生行；本地 `new` 始终在首位；同名技能行被隐藏。
- leading 判定：草稿 `\n/compact` / `  /compact` 视为 leading；`hello\n/compact` 不视为命令（走普通发送）。

手动回归（Obsidian 内，CDP 或人工）：

1. 打开 `/` 菜单：显示 `/new` + 当前会话 dsh 命令（ptc 预设下至少 `/compact`、`/feedback`、`/goal`、`/permission`、`/plan`；`/export` 按拍板隐藏或显示）+ 技能分组；描述中文优先、第三方命令回退 dsh 英文描述。
2. 选 `/goal` → 草稿 `/goal `；补 `暂停当前任务` 后 Enter → 走 `executeCommand`，时间线出现 command 节点；`/goal` 单独 Enter 也能执行（显示当前目标）。
3. 选 `/compact` → 草稿 `/compact `，Enter 后出现 manual-compaction 节点（比改动前多按一次 Enter，属预期）；手敲 `/compact` + Enter 同样执行。
4. `/permission` / `/plan` 带参数执行成功、时间线节点出现；`/feedback` 空参执行 → 宿主返回错误 → 错误条显示宿主文案。
5. 手敲不存在的 `/xyz` + Enter → 仍作为普通消息发送；`hello\n/compact` 发送 → 作为普通消息（不执行）。
6. 设置页「聊天」→ 命令范围：默认不启用，添加栏不渲染；白名单添加 `compact` → 菜单只剩 `/compact`（`/new` 与技能仍在）；空白名单 → 命令行全部隐藏 + 说明行；黑名单添加 `goal` → `/goal` 消失、其它命令照常；改设置后下一次打开菜单即生效。
7. 同名技能（若 vault 技能目录里造一个与命令同名的技能）→ 技能行不出现，命令正常执行。
8. 桥降级：临时用旧桥（无 `commands`）→ 命令行说明「需要更新 dsh-obsidian-bridge…」，`/new`、技能、发送均正常。
9. 子会话：打开 subagent 子会话 → 命令组按拍板隐藏（默认）或显示。
10. 技能行为回归：选技能插入 `/技能名 `，发送后宿主注入正文；技能范围（0037）仍只过滤技能行，与命令范围互不影响。

**验收标准**：

- 菜单命令行与当前会话 `commands()` 一致（含插件注册的命令），不再写死；命令范围只影响显示；
- 选中命令只插入、不丢参数；Enter 时 leading 已知命令走 `executeCommand`，未知 `/xxx` 或非 leading 仍走 `send()`；
- `/new`、技能、@、消息渲染、桥与 dsh 服务无其它行为变化；同名技能不出现；
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致。

## 8. 需要你拍板

- [x] **实现路径**：**A**（宿侧透传，桥零改动；选中插入 + Enter 路由到 `executeCommand`）（2026-10-28）
- [x] **`/export` 怎么处理**：**隐藏**（内置「原生面板不支持」名单，避免看起来成功却没文件）（2026-10-28）
- [x] **/new 去留**：**保留**为本地行（dsh 目录里没有新建会话）（2026-10-28）
- [x] **命令范围条目语义**：**精确匹配**命令名（命令是扁平命名空间，不做 `-` 前缀）（2026-10-28）
- [x] **命令范围的「选取」按钮**：初版不做、只手动输入（设置页拿不到 dsh 命令目录）（2026-10-28）；**0051 已补上**（2026-10-28）
- [x] **subagent 子会话是否显示命令组**：**跟随官方隐藏**（2026-10-28）
- [x] 其他取舍：范围卡片徽标用 **`⌘`**；顺便清理 `native-types.ts` 的重复声明（2026-10-28）

## 9. 实施记录

**落地（2026-10-28，路径 A + 全部推荐项）**：桥零改动；菜单命令行改由 `commands()` 驱动，Enter 时把 leading 命令交给 `executeCommand`；命令范围作为第三张设置卡片（`⌘` 徽标、无「选取」）。

| 文件 | 实际改动 |
|---|---|
| [src/settings/schema.ts](../../src/settings/schema.ts) | 新增 `CommandScope`、`normalizeCommandName` / `normalizeCommandNames`（`^[a-z][a-z0-9_-]*$`，trim + 小写，去重）；`commandScope` / `commandWhitelist` / `commandBlacklist` 默认值；`mergeSettings` 校验 / 归一化 |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 「聊天」tab 增加第三张范围卡片「命令范围」（`⌘` 徽标）；命令白 / 黑名单文案；`ScopePanelOptions.pickKind` / `pick` 改为可选，没有候选源时不渲染「选取」按钮（@ / 技能行为不变） |
| [src/view/native/command-scope.ts](../../src/view/native/command-scope.ts)（新增） | `filterSlashCommands`（精确匹配）、`filterUnsupportedCommands`（隐藏 `/export`）、`hideCommandNamedSkills`（命令优先）、`leadingCommandLine`（草稿开头命令识别）；`NATIVE_UNSUPPORTED_COMMANDS = ['export']` |
| [src/view/native/slash.ts](../../src/view/native/slash.ts) | `SLASH_COMMANDS` 只保留本地 `new`；新增 `slashCommandItems(commands, query)`（`commands()` → 菜单行）；first-party 命令按 name 映射中文标签 / 说明（compact / export / feedback / goal / permission / plan），未知命令回退 dsh 英文 description；`SlashItem.kind` 增加 `'local'`；新增 `formatCommandReference` |
| [src/view/native/ui/slash-menu.tsx](../../src/view/native/ui/slash-menu.tsx) | 拆成命令组 + 技能组渲染，命令组 / 技能组各有独立说明行；本地行同样显示 `/` 前缀 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 新增 `showCommands` / `loadCommands` / `onRunCommand` / `getCommandScope` props；命令 / 技能并行加载（命令保留上次结果，供菜单关闭后的 Enter 路由）；命令范围快照与过滤；命令组只在 leading 位显示；同名技能隐藏；Enter 时 `leadingCommandLine` 命中即清草稿并 `onRunCommand`，否则原 `onSend`；`/compact` 仍显示「正在压缩会话历史…」提示 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `getCommandScope` prop；`Composer` 接线 `showCommands`（subagent 子会话隐藏）/ `loadCommands` / `onRunCommand`；`runCommand` 注释更新，仍复用 `bridge.executeCommand` |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) / [src/view/panel-host.ts](../../src/view/panel-host.ts) / [src/main.ts](../../src/main.ts) | 透传 `getCommandScope`，`main.ts` 从 settings 组装 `{ mode, allow, deny }` |
| [src/shared/native-types.ts](../../src/shared/native-types.ts) | 清理重复声明的 `NativeCommand` / `NativeSkill` / `NativeCommandResult`（接口合并可编译但易误解） |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点表 / 配置表 / 文件职责表 / 改动地图 / 回归清单（67–71） |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-33 与 0050 状态收尾 |

**验证结果**：

- `npm run build` 通过（tsc + esbuild，main.js 313.4kb / 320,891 字节）；`npm run check` 全通过（版本 / 依赖 / 类型 / 桥清单 / main.js 与源码一致）。
- 纯函数冒烟 **40 项全过**（esbuild 打包 `slash.ts` / `command-scope.ts` / `schema.ts` 到 /tmp 后直接调用）：命令映射与中文标签 / 英文回退、查询过滤、`formatCommandReference`、范围 off / 白名单 / 黑名单 / 空白名单 / 未知模式 / 大小写、精确匹配不误伤前缀、隐藏 `/export`、同名技能隐藏、leading 识别（`\n  /goal` 命中、`hello\n/compact` 不命中、未知命令不命中）、`normalizeCommandName(s)`、`mergeSettings` 默认 / 非法模式 / 名单归一化 / 不共享默认数组。
- **CDP 实测**（Obsidian 1.14.5，dsh 0.2.1-rc.3，ptc 预设，端口 3088，重载插件后）：
  - `/` 菜单：本地 `/new` + `/compact` `/feedback` `/goal` `/permission` `/plan`（`/export` 已隐藏）+ 8 个技能行；命令描述为中文，技能行不变。
  - 选中 `/goal` → 草稿 `/goal `（不执行、菜单关闭、焦点回输入框）；Enter 后草稿清空，时间线出现 `/goal` command 节点（`No goal is currently set.`），无错误条。
  - 命令范围：白名单 `goal` → 菜单保留 `/new` + `/goal` + 技能；白名单为空 → 命令行全部隐藏并显示「命令行已按「/」命令范围过滤：当前没有可显示命令」；黑名单 `goal` → `/goal` 消失、其它命令照常；改设置下一次打开菜单生效；测试后已还原为「不启用」。
  - 设置页「聊天」：三张卡片（@ 引用范围 / / 技能范围 / ⌘ 命令范围），命令范围默认不启用；切白名单出现添加栏（0050 当时没有「选取」，已由 0051 补上）；输入 `Goal` 添加后存为 `goal`、标题「白名单（1）」；测试后已还原。
- 未做 / 未实测：同名技能隐藏与 subagent 子会话隐藏只做了纯函数 / 类型 / 代码路径核对（当前 vault 没有与命令同名的技能，也没有在子会话里操作）；命令参数（`/feedback <text>`、`/plan off`）未真跑；视觉细节（⌘ 徽标排版）只核对 DOM。

**与提案的偏差**：

- 范围状态 / 命令目录的加载时机：命令目录在**会话就绪时预取**、打开菜单时再刷新，且关闭菜单**不清空**（供 Enter 路由识别）；技能仍是关闭即清空、下次重取。原因：Enter 路由发生在菜单关闭之后，必须保留最近一次目录。
- `leadingCommandLine` 放在 `command-scope.ts`（与范围 / 降级同域），没有放进 `slash.ts`。
- 命令范围卡片 0050 落地时没有「选取」：`renderScopePanel` 的 `pickKind` / `pick` 改为可选，只有传了才渲染按钮（0051 已给命令范围补上，见下）。
- 子会话隐藏命令组通过 `showCommands={(snapshot?.subagent ?? null) === null}` 实现（同时关闭路由）。
- `/export` 的隐藏发生在**读取命令目录后**（`filterUnsupportedCommands`），所以即使命令范围白名单写了 `export` 也加不回来；手敲 `/export` 不再被路由，按普通消息发送。

**后续补充（2026-10-28，[0051](0051-command-scope-picker.md)）**：命令范围的白 / 黑名单添加栏已补「选取」按钮，候选来自原生面板桥的 `commands()`（面板未打开时手动输入兜底）；本提案第 8 节「初版不做」的取舍已被 0051 覆盖。
