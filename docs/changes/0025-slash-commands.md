---
status: done           # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27
scope: src/view, src/shared, styles.css, packages/dsh-obsidian-bridge
issue: 输入框输入 / 弹出下拉菜单（new 新建对话 / compact 压缩 / skills 列表），参考 dsh 的斜杠菜单
---

# 0025 输入框 `/` 命令菜单（new / compact / skills）

## 1. 背景与问题

原生聊天输入框目前只有 `@` 引用菜单（[0023](0023-at-file-mentions.md) / [0024](0024-folder-references.md)）；
用户希望像 dsh 一样输入 `/` 弹出命令列表，先要三项：

1. `new` 新建对话（立即新建并切到新会话）
2. `compact` 压缩（压缩当前会话历史）
3. `skills` 列表（打开技能列表，选中把 `/技能名 ` 写进草稿）

参考 dsh 的实现（本次已核对 dsh 开发 checkout 源码）：

| dsh 里的位置 | 做了什么 | 对本次的含义 |
|---|---|---|
| `packages/client/ui-input-trigger` | 通用的 `/` 触发源框架（candidates / onPick / 匹配） | 原生面板自己实现一套同构的轻量逻辑即可（React 侧），不依赖该框架 |
| `packages/client/ui-commands` | 注册 `trigger: '/' / name: 'command'` 源；目录走 `ctx.remote.commands.list(sessionId)`，执行走 `ctx.remote.commands.execute(sessionId, line, attachments)` | `/compact` 是**宿主命令**，必须经 `command.execute` 提交；客户端把 `/compact` 当普通文本发送不会压缩 |
| `packages/compaction/command-compact` | 宿主 `/compact` 命令实现（`ctx.compaction.compactNow`） | 执行后宿主会在时间线产生 command / compaction 节点，原生面板已能渲染（`timeline-nodes.tsx:76 / :136`） |
| `packages/client/ui-skill` | 注册 `trigger: '/' / name: 'skill'` 源；目录走 `ctx.remote.skills.list({sessionId})`；选中只插入纯文本 `/name ` | `/skills` 的列表与插入语义照此实现：**插入文本、不直接执行**，宿主在 prepend 阶段识别 `/技能名` 注入技能正文 |

现状代码：

- `src/view/native/ui/composer.tsx`：`@` 菜单的 token 检测 → 菜单 → 键盘（↑↓ / Tab / Enter / Esc）→ 文本替换，一整套可复用；
- `src/view/native/mention.ts`：token / 排序 / 格式化的纯函数范例（不 import obsidian）；
- `packages/dsh-obsidian-bridge/lib/client.js`：桥 v4 已通过 `ctx.remote` / `ctx.get(...)` 访问宿主；
  新增 `commands` / `skills` 只是再加两个 `ctx.remote` 调用，不需要碰宿主代码；
- `/new` 不需要桥改动：插件已有 `bridge.createSession(cwd)`（`native-chat-root.tsx` 的 `createSession`）。

## 2. 目标与非目标

- 目标：
  - 草稿开头 / 空白后输入 `/` 弹出下拉菜单，固定三项：`new`（新建对话）、`compact`（压缩）、`skills`（列表）；
  - 继续输入按名字过滤；↑↓ 选择、Enter 执行、Esc 关闭；菜单在输入框上方，焦点始终留在 textarea；
  - `/new` 立即新建会话并切过去；`/compact` 执行宿主压缩并在时间线出现 command 节点；`/skills` 打开二级列表，选中把 `/技能名 ` 插进草稿。
- 非目标：
  - 不做 dsh 的全量命令目录（goal / plan / feedback / export / permission 等），只保留本次要求的 3 项；
  - 不实现技能正文预览 / 「打开技能文件」（dsh 有，本次不做）；
  - 不改 `@` 引用菜单的行为与排序。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）语义化桥 v5 + 原生菜单** | 桥 `client.js` 升 v5，新增三个语义方法：`commands()`（`ctx.remote.commands.list(sessionId)`）、`skills()`（`ctx.remote.skills.list({sessionId})`）、`executeCommand(line)`（`ctx.remote.commands.execute(sessionId, line, [])`），`ping.methods` 增加三项；插件侧新增 `src/view/native/slash.ts`（纯逻辑：token 检测 / 过滤 / 命令表）+ `ui/slash-menu.tsx`（含 skills 二级），`composer.tsx` 接键盘与替换，`native-chat-root.tsx` 传三个回调，`core-bridge.ts` 加三个方法 + 能力探测 | 桥 1 文件 + `src` 4 文件 + `styles.css` 少量 | 需要重新 link bridge 并重启 DSH 服务才能生效；桥 v5 与旧面板互不影响（方法只增不减）；改动跨仓库两处，验证要覆盖「桥没更新」的降级 | 语义清晰、插件侧不泄漏 dsh RPC 细节；三项能力都能真做对 |
| **B 薄桥：通用 `rpc(method, args)` 透传** | 桥只加一个 `rpc(method, args)`（`ctx.remote` 上按路径取方法），插件侧硬编码 `commands.list` / `commands.execute` / `skills.list` 三个 RPC 名与参数形状 | 桥 1 文件（更小）+ `src` 4 文件 + `styles.css` | 桥只加一次，以后再加命令不用改桥；但 dsh RPC 名 / 参数 / 返回值形状泄漏到插件侧，升级 dsh 时插件要跟着改，类型只能在插件侧松散建模（`unknown`） | 灵活但不稳；只建议在「以后还要接更多 dsh RPC」时选 |
| **C 分期：本期只做 UI + `/new`** | 不改桥：`slash.ts` + `slash-menu.tsx` + composer 接线全部实现，`new` 立刻可用；`compact` / `skills` 两行显示为「需要更新桥后可用」的禁用态（点击给 Notice） | `src` 4 文件 + `styles.css` | 不碰桥 = 不用重 link / 重启服务，风险最低、当天就能看到菜单；但需求只兑现 1/3，二期还得再做一次桥扩展 | 只作为「先看交互、桥改动另开一轮」的折中；不推荐作为最终形态 |

> 三条路径的 UI 部分（`slash.ts` / `slash-menu.tsx` / composer 接线）完全一致，差别只在「`compact` / `skills` 的数据从哪来」，
> 因此 C 可以在之后无痛升级成 A。

## 4. 改动清单

以路径 A 为准（B / C 的差异见上表）：

| 文件 | 改动 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | `VERSION = 5`；新增 `commands()` / `skills()` / `executeCommand(line)`；`ping.methods` 增加 `commands` / `skills` / `executeCommand`；均要求已订阅会话 |
| `src/shared/native-types.ts` | 新增 `NativeCommand`（name / description）、`NativeSkill`（name / description / modelInvocable）、`NativeCommandResult`（kind / text） |
| `src/view/native/core-bridge.ts` | `commands()` / `skills()` / `executeCommand(line)`；`probe()` 记录 v5 能力位（`supportsCommands()`） |
| `src/view/native/slash.ts`（新） | 纯逻辑：`activeSlashToken(draft, caret)`（只在草稿开头或空白后的行首触发）、`rankCommands(list, query)`、命令表 `SLASH_COMMANDS`（new / compact / skills 的标签、图标、可用性） |
| `src/view/native/ui/slash-menu.tsx`（新） | 菜单渲染 + 高亮 + skills 二级列表；复用 `.dsh-native-mention` 的样式骨架（键盘事件仍由 Composer 统一处理） |
| `src/view/native/ui/composer.tsx` | 新增 slash token 状态、↑↓ / Enter / Esc / Tab 分支、执行后清掉该行 token；`@` 菜单与 `/` 菜单互斥 |
| `src/view/native/ui/native-chat-root.tsx` | 传 `onNewSession`（复用 `createSession`）、`onRunCommand`（bridge.executeCommand + 错误 Notice）、`listSkills`（bridge.skills，打开菜单时取一次快照） |
| `styles.css` | 复用 `.dsh-native-mention*`；补命令徽标（`is-command` 之类）与 skills 二级列表的缩进，颜色/尺寸全部用 `var(--...)` |

## 5. 行为变化

- 输入 `/` 且光标位于草稿开头或空白之后 → 输入框上方出现三项菜单（「/new 新建对话」「/compact 压缩」「/skills 技能列表」）；
- 继续输入（`/co`）按名字过滤；↑↓ 移动高亮、Enter 执行、Esc 关闭、鼠标点击执行；焦点不离开输入框；
- `/new`：关闭菜单、清空该行 token、调用既有 `createSession()`（新建 + 重命名「新会话」+ 切换）；
- `/compact`：关闭菜单、清空该行 token、`executeCommand('/compact')`；运行中禁用重复提交；结果由时间线既有 command / compaction 节点呈现（不额外造卡片）；
- `/skills`：菜单内切到二级列表（技能名 + 描述，`modelInvocable === false` 标「仅用户」）；选中把 `/技能名 ` 插入草稿并把光标放到末尾，**不发送**；
- 会话未打开 / 桥 < v5：菜单仍显示，`compact` / `skills` 行标为不可用（disabled），点击给一条 Notice 说明「需要更新 dsh-obsidian-bridge 并重启服务」；
- 已有 `@` 菜单行为不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 桥 v5 未重新 link / 未重启服务 | compact / skills 不可用（降级为禁用 + Notice），`/new` 仍可用 | 插件侧本来就有能力位判断，无需回滚代码 |
| `commands.execute` 在未订阅 / 会话未 open 时抛错 | `/compact` 点击后报错 | 桥侧先校验 `active`，错误信息翻成中文提示；root 侧 try/catch + Notice |
| skills 目录视图一次拉取可能较慢 | 二级菜单短暂 loading | 打开菜单时预取一次并缓存到本次菜单生命周期；失败显示「无法读取技能列表」 |
| 与 `@` 菜单抢键盘 / 同时打开 | 两套菜单互相覆盖 | composer 里显式互斥：`token !== null` 时不再检测另一种 token |
| 桥版本升级影响旧面板 | 方法只增不减，v4 面板照常工作 | 不改动既有方法签名 |

## 7. 验证

- `npm run build`、`npm run check` 通过；
- 纯函数冒烟：`slash.ts` 的 token 检测 / 过滤表驱动用例（`node` 里直接跑 `esbuild` 打包后的模块，参考 0023 的做法）；
- 手动（重载插件 + 重启 DSH 服务后）：
  1. 空草稿输入 `/` → 出现三项菜单；输入 `/co` 只剩 compact；Esc 关闭；再输入 `/` 重现；
  2. `/new` → 新建会话并切过去，标题为「新会话」；
  3. `/compact` → 时间线出现 `/compact` command 节点与压缩卡片；
  4. `/skills` → 列出技能；选中后草稿里是 `/技能名 `（带尾空格），Enter 才发送；
  5. 未更新桥时（临时把 `data.json` 指向旧 bridge 或直接看能力位）→ compact / skills 为禁用态并给出提示；
- 验收标准：上述 5 条逐条可见成立；`main.js` 为最新构建产物。

## 8. 需要你拍板（已拍板 2026-10-27）

- [x] 选哪条实现路径：**A**（语义化桥 v5 + 原生菜单）；
- [x] `skills` 的交互：**菜单内二级列表**；
- [x] `/compact` 执行时：**需要**「正在压缩…」的过程提示；
- [x] 三项之外：**暂不加** `/permission`、`/goal` 等。

## 9. 实施记录（2026-10-27）

### 实际改动

| 文件 | 改了什么 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | `VERSION = 5`；新增 `commands()`（`ctx.remote.commands.list`）/ `skills()`（`ctx.remote.skills.list`）/ `executeCommand(line)`（`ctx.remote.commands.execute`），`ping.methods` 追加三项 |
| `src/shared/native-types.ts` | `NativeCommand` / `NativeSkill` / `NativeCommandResult` |
| `src/view/native/core-bridge.ts` | `commands()` / `skills()` / `executeCommand()` + `supportsCommands()`（ping 里三个方法齐全才算 v5 可用） |
| `src/view/native/slash.ts`（新） | 行首 token 检测、`SLASH_COMMANDS` 三项表、名字过滤排序、技能行模型、`formatSkillReference` |
| `src/view/native/ui/slash-menu.tsx`（新） | 命令菜单 + skills 二级列表 + 返回头 + 空态/加载态，键盘仍由 Composer 统一处理 |
| `src/view/native/ui/composer.tsx` | `/` 状态与 `@` 互斥；↑↓ / Enter / Tab / Esc / 技能层 Backspace；三项命令的动作；「正在压缩会话历史…」过程提示；占位文案加「/ 命令」 |
| `src/view/native/ui/native-chat-root.tsx` | `runCommand()`（matched=false / error 进错误条），向 Composer 传 `commandsAvailable` / `onNewSession` / `onCompact` / `loadSkills` |
| `src/view/native/ui/timeline-nodes.tsx` | 新增 `manual-compaction` 节点渲染（见「偏差」） |
| `styles.css` | 菜单容器 / 行样式与 @ 菜单共用选择器；新增命令名等宽、二级返回头、禁用态、空态与压缩过程提示；全部用主题变量 |

### 与提案的偏差

1. **桥取 remote 的方式**：提案写的是「桥已通过 `ctx.remote` 访问宿主」，实测 cordis 会拒绝未注入的
   `remote.commands` / `remote.skills`（`cannot get property "remote.skills" without inject`）。
   直接放进 `exports.inject` 又会让 profile 缺插件时整个桥不加载，故改为
   `ctx.inject(['remote', 'remote.commands' | 'remote.skills'], cb)` 两个子 fiber 分别注入，
   插件缺失只影响对应功能。行为与提案一致（能力位判断 + 降级提示）。
2. **补了 `manual-compaction` 渲染**：提案认为时间线已能渲染 command / compaction 节点，
   但 dsh 0.2.x 的 `/compact` 实际发的是 `manual-compaction` 包装节点（`{ command, compaction }`），
   原生面板原样显示成一坨 JSON。故在 `timeline-nodes.tsx` 增加 15 行：复用 command 卡片样式，
   显示 `/compact` + 完成/失败 + 宿主给的 `outcome.text`（"Compacted N history items (~N tokens)."）。

### 验证

- `npm run build`、`npm run check` 通过（`main.js` 与源码一致）。
- `slash.ts` 纯函数冒烟：esbuild 打包到 /tmp 后 node 跑 20 条断言（token 边界、行首触发、路径不触发、
  过滤与子序列排序、桥不可用时的 disabled / 提示文案、技能行「仅用户」前缀、`/name ` 格式化）——全部通过。
- CDP 实测（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 桥 v5，vault = `<vault>`）：
  1. 输入 `/` → 三项菜单（`/new 新建对话`、`/compact 压缩`、`/skills 列表`），首行高亮；
  2. `/co` → 只剩 compact；`/sk` → 只剩 skills，且 `@` 菜单同时收起；
  3. Escape 关闭；技能层点返回头 / Esc 回到命令层；
  4. `/new`（Enter）→ 新建会话并切过去（标题「新会话」），草稿里的 `/new` 被清掉；
  5. `/compact` → 输入框上方出现「正在压缩会话历史…」，结束后时间线显示
     `/compact 完成 Compacted 55 history items (~7063 tokens).`；
  6. `/skills` → 该 vault 没有 `.dsh/skills`，二级列表显示「没有可用的技能」（RPC 正常返回空）；
  7. `@` 菜单回归正常（当前笔记 + 文件/文件夹）。
- 未做端到端验证：桥停留在 v4 时的禁用态（需要临时回退桥版本）；该分支由纯函数冒烟（disabled + 提示文案）覆盖。

### 副作用说明

验证 `/compact` 时压缩的是测试会话「简短测试确认」的历史（55 条，约 7063 tokens），dsh 侧为 shadow 语义。

### 生效方式

- `lib/client.js` 已 link 到 obsidian profile，dsh 的 HMR 已自动加载 v5（页面里 `ping()` 返回 5）；
  其它机器 / 重装环境需要 `dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge` 后重启服务；
- 插件侧改动需要重新加载插件（`main.js`）。

## 10. 变更记录（2026-10-27，用户指定）

用户提供 dsh 桌面截图，要求 **skills 不做二级菜单**，而是像 dsh 一样：技能直接列在同一个 `/` 下拉里，
在命令下面单独一个「技能」分组。已按此调整：

- 删除 `/skills` 命令行、二级列表状态与返回头；`SLASH_COMMANDS` 只剩 `new` / `compact`。
- 命令组在上（无标题），技能组在下（标题「技能」），说明文字右对齐；`/` 打开时拉一次技能目录。
- 技能拿不到内容时在「技能」分组下显示一行说明：加载中 / 读取失败 / 没有技能 / 桥太旧。
- 键盘行为合并为一套：↑↓ 跨组移动、Enter / Tab 采纳、Esc 关闭。

验证（CDP，临时在 vault 建了 `dsh-slash-test` 技能后删除）：`/` 显示 `/new` `/compact` + 「技能」分组 + 该技能行；
`/dsh` 过滤到技能行，点击插入 `/dsh-slash-test `（带尾空格、菜单关闭）；删除技能后同一位置显示「当前会话没有可用技能」，
vault 里的临时目录已清理。
