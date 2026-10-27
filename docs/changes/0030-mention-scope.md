---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户当轮已明确指定要改的具体项，按 AGENTS.md 规则 12 例外视为已批准
scope: src/settings, src/view, styles.css, docs
issue: @ 文件引用缺检索范围控制：设置页「聊天」tab 三档（不启用 / 白名单 / 黑名单），选中白名单 / 黑名单后展开添加栏
---

# 0030 @ 文件引用的检索范围（白名单 / 黑名单）

> 对应路线图 [R-13](../roadmap.md#需求待办)。用户当轮已明确指定要改的具体项，按 [AGENTS.md](../../AGENTS.md) 规则 12 例外视为已批准，直接执行。

## 1. 背景与问题

### 现状

输入框的 `@` 菜单（[0023](0023-at-file-mentions.md)）与文件夹下钻（[0024](0024-folder-references.md)）已经可用，但候选来源固定是**整个 vault**：
`native-chat-root.tsx` 的 `listMentionEntries()` 用 `app.vault.getAllLoadedFiles()` 取全量快照后直接交给菜单。
vault 变大后，`.git` / 附件 / 归档目录都会挤进候选，找一个常用目录要翻很久。

### 需求（用户原话拆解）

1. 为 `@` 文件功能加**黑名单 / 白名单**，能自由设置 `@` 预选检索的范围。
2. 设置里加一个 `@` 功能的设置，三个选项：**黑名单 / 白名单 / 不启用**。
3. 选中**白名单**后，下方展开一个「添加白名单」的栏；**黑名单同理**；**不启用时不显示栏**。

### 影响范围

只影响 `@` 菜单里「文件与文件夹」候选的**可见范围**；`/` 命令菜单、消息渲染（短链 / 文件夹 chip）、桥与 dsh 服务都不受影响。菜单的触发、排序、下钻、键位仍按 0023 / 0024 的规则走。

## 2. 目标与非目标

### 目标

- 设置页「聊天」tab 新增「「@」引用范围」下拉，三档：**不启用 / 白名单 / 黑名单**，默认**不启用**（`mentionScope: 'off'`，两个列表默认空数组）。
- 非「不启用」时，在该设置项下方展开添加栏：标题「白名单（N）」/「黑名单（N）」、已有路径列表（每条可移除，路径不存在时带标记）、输入框 +「添加」按钮、一行提示；「不启用」时不渲染添加栏。
- 条目是 **vault 相对路径**，可以是文件夹（含子目录）或单个文件，统一按前缀规则匹配：
  - **白名单**：只保留落在条目内（或条目本身）的候选，并保留这些条目的**祖先文件夹**，保证从根目录能逐级下钻进白名单；
  - **黑名单**：排除落在条目内（或条目本身）的候选，其余照常。
- 路径归一化：去首尾空白 / 斜杠、反斜杠转正斜杠、去重，拒绝空段与 `.` / `..` 段；非法模式回落 `off`（旧设置 / 手改 `data.json` 也能吃下）。
- 「当前笔记」首行始终保留，不受范围影响。
- 设置改动在**下一次打开 `@` 菜单**时生效，无需重启插件或服务。

### 非目标

- 不做 glob / 正则 / 标签 / 前端搜索式范围；条目只按路径前缀匹配。
- 不改 `@` 菜单的触发、排序、下钻、键位与插入格式，不做范围统计或「列出全部范围」的界面。
- 不把范围写进 dsh profile，不新增桥方法，不改 `packages/dsh-obsidian-bridge`，不需要重启 dsh 服务。
- 不影响 `/` 命令菜单、消息渲染、会话 / 模型 / 权限、上下文占用。
- 不做大小写不敏感或路径别名（`~`、`./`）扩展。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | Obsidian 侧设置 + 纯函数在**取快照处**整体过滤：`settings/schema.ts` 加 `mentionScope` / `mentionWhitelist` / `mentionBlacklist` 与路径归一化；`settings/sections/chat.ts` 加下拉与添加栏；`panel-host.ts` 加 `getMentionScope()`（`main.ts` 从 settings 组装）；`native-chat-view.tsx` 透传给 `NativeChatRoot`；新增 `view/native/mention-scope.ts` 的 `filterMentionEntries(entries, scope)`；`native-chat-root.tsx` 的 `listMentionEntries()` 在取完快照后套用它 | settings + view + `styles.css` + docs，约 7 个源文件；新增纯函数约 60 行 | 全部落在 Obsidian 侧，无桥改动、无需重启；过滤点是「菜单打开时的那一份快照」，与 0023 的按键过滤解耦，不改排序 / 下钻；风险是白名单祖先文件夹逻辑写错会导致无法下钻（用纯函数用例兜底） | **推荐**：改动面最小、可独立冒烟、回滚只需把模式切回「不启用」 |
| B | dsh 侧过滤：把范围交给 dsh（`file-reference` 一类 remote）或桥新增 `mentionScope` 方法，在 dsh 侧生成候选时就按范围裁剪，原生端只渲染 | `packages/dsh-obsidian-bridge`（桥版本 +1）+ `core-bridge.ts` + composer / 菜单改造 + 重新 link + 重启服务 | 桥与 dsh 侧都要动，改完必须 relink / 重启；候选生成目前就在宿侧（vault 索引），改到 dsh 侧等于重做 0023 的候选链路，还会引入每键一次 IPC 往返的延迟 | 不推荐：0023 已因同一原因否掉 dsh 侧候选；本次需求也不需要跨端状态 |
| C | 设置与路径也放 Obsidian 侧，但过滤**下沉到候选生成处**：给 `mention.ts` 的 `listMentionCandidates` 增加 scope 参数，在排序 / 目录直列里逐个过滤（每次按键都跑一遍） | `mention.ts` + `composer.tsx` 传参 + `native-chat-root.tsx` | 过滤与排序、目录直列、白名单祖先文件夹逻辑耦在一起（下钻要靠祖先目录，逐个过滤容易把祖先也滤掉）；纯函数难单独测；每次按键重复做同一份过滤 | 不推荐：复杂度更高、收益为零；保留 A 的「取快照处整体过滤」 |

**推荐 A**：范围是**宿侧视图的显示偏好**，与 dsh 无关；过滤放在「打开菜单取快照」这一步，正好复用 0023 已有的快照机制，按键过滤、排序、下钻一行都不用改。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/settings/schema.ts](../../src/settings/schema.ts) | 新增 `MentionScopeMode`（`off` / `whitelist` / `blacklist`）、`MentionScope` 接口、`normalizeScopePath` / `normalizeScopePaths`；`DshPluginSettings` 加 `mentionScope` / `mentionWhitelist` / `mentionBlacklist`；`DEFAULT_SETTINGS` 默认 `off` + 空数组；`mergeSettings` 归一化路径、非法模式回落 `off` |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 「聊天」tab 新增「「@」引用范围」下拉（不启用 / 白名单 / 黑名单）；非「不启用」时在下方渲染添加栏（标题带条数、已有路径 + 移除 +「路径不存在」标记、输入框 +「添加」（回车也可）、空列表 / 非法路径 / 重复路径的提示行）；切换模式与增删路径后重绘设置区 |
| [src/view/native/mention-scope.ts](../../src/view/native/mention-scope.ts)（新增） | `filterMentionEntries(entries, scope)` 纯函数：`off` 原样返回；白名单保留条目内候选 + 祖先文件夹；黑名单排除条目内候选；「当前笔记」不经过它 |
| [src/view/panel-host.ts](../../src/view/panel-host.ts) | `DshPanelHost` 增加 `getMentionScope(): MentionScope`（不把插件实例漏进 view） |
| [src/main.ts](../../src/main.ts) | 实现 `getMentionScope()`：从 settings 组装 `{ mode, allow, deny }` |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) | 把 `getMentionScope` 透传给 `NativeChatRoot` |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `listMentionEntries()` 取完 vault 快照后套 `filterMentionEntries(entries, getMentionScope())` |
| [styles.css](../../styles.css) | 设置页添加栏样式（`.dsh-settings-scope*`，约 +125 行；颜色 / 背景 / 边框只用主题变量，路径省略号防溢出） |
| [docs/changes/0030-mention-scope.md](0030-mention-scope.md) | 本提案 |
| [docs/changes/README.md](README.md) | 索引登记 |
| [docs/roadmap.md](../roadmap.md) | 「需求待办」加 R-13 行 |
| [docs/development.md](../development.md) | 改动地图补 `mention-scope.ts` / `chat.ts` 的 @ 范围 / `getMentionScope` 链路；回归清单补 @ 范围项 |
| [docs/architecture.md](../architecture.md) | 关注点表与 @ 菜单段落补范围过滤的来源与生效时机 |

不改 `src/service/`、`src/shared/`、`packages/`、`main.js`（产物由 `npm run build` 生成）。

## 5. 行为变化

- 设置页「聊天」tab 出现「「@」引用范围」三档，默认 **不启用**；不启用时 `@` 菜单与改动前完全一致，且**不渲染**添加栏。
- 选「白名单」→ 下方展开「白名单（N）」栏；添加一个文件夹（如 `模板`）后，`@` 菜单只保留该文件夹及其子项（以及用于下钻的祖先文件夹），其余候选消失；白名单为空时只剩「当前笔记」首行。
- 选「黑名单」→ 下方展开「黑名单（N）」栏；添加 `模板` 后，`@` 菜单不再出现 `模板` 及其子项，其它候选照常。
- 白名单保留的祖先文件夹不仅用于下钻，也会作为正常候选显示、可被当作最终引用（生成 `@a/b/` 形式）；范围外的文件不会出现。
- 范围不突破 [mention.ts](../../src/view/native/mention.ts) 原有的隐藏规则：`.git` / `node_modules` 段始终排除、点开头的段默认隐藏——即使白名单指向这些位置，菜单里默认也看不到（查询以 `.` 开头才显示）。
- 添加栏：标题带当前条数；已有路径可逐个移除（条数同步）；路径不存在时置灰并标「路径不存在」；输入框 +「添加」（回车等效）；重复路径提示「已经在列表里」，非法路径（空 / 空段 / `.` / `..`）被拒绝，首尾斜杠自动去掉。
- 路径归一化后落盘：去除首尾空白与斜杠、反斜杠转正斜杠、去重；手改 `data.json` 的非法模式回落 `off`、非法路径被丢弃。
- 「当前笔记」首行始终保留。
- **生效时机**：设置改动后，下一次打开 `@` 菜单即按新范围取候选，无需重启插件 / 服务；已打开的菜单不中途刷新。
- `/` 命令菜单、消息渲染、模型 / 权限 / 上下文占用、桥与 dsh 服务行为不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 白名单祖先文件夹漏掉 | 无法从根目录下钻进白名单目录 | `filterMentionEntries` 的固定用例覆盖「根下 / 子目录 / 同名前缀」；把模式切回「不启用」即恢复 |
| 前缀匹配误伤（`a` 命中 `ab`） | 候选多出 / 少了无关项 | 匹配规则固定为「等于条目」或「以 条目 + '/' 开头」，用例覆盖同名前缀 |
| 白名单为空看起来像 @ 坏了 | 菜单只剩「当前笔记」 | 添加栏提示当前范围为空；切回「不启用」立即恢复 |
| 旧设置 / 手改 `data.json` 的非法值 | 菜单候选异常或设置页报错 | `mergeSettings` 回落 `off` 并丢弃非法路径（归一化在读取时做） |
| 添加栏样式与主题不协调 | 观感 | 样式只在 `.dsh-settings-*` 命名空间内、只用主题变量；删掉该段即回到无添加栏状态 |
| 用户想临时取消限制 | — | 设置里切回「不启用」；列表内容保留，切回白名单 / 黑名单即恢复 |

整体回滚：范围只是显示层偏好，删除过滤调用 / 把 `mentionScope` 固定为 `'off'` 即恢复改动前的全量候选；设置值留在 `data.json` 不影响其它功能。

## 7. 验证

自动化（代码侧由 Lead 执行）：

```
npm run build   # tsc -noEmit -skipLibCheck + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

纯函数冒烟（`mention-scope.ts` 不 import obsidian，可单独打包）：

```
./node_modules/.bin/esbuild src/view/native/mention-scope.ts --bundle --platform=node --format=esm --outfile=/tmp/mention-scope.mjs
```

用例：`off` 原样返回；白名单命中条目本身 / 子目录、保留祖先文件夹、同名前缀不误伤；黑名单排除条目与子目录、保留兄弟目录；空列表行为；首尾斜杠自动去掉，空串 / 空段 / `.` / `..` 被拒绝。

手动回归（Obsidian 内）：

1. 设置页 →「聊天」tab：默认「不启用」，`@` 菜单候选与改动前一致，且看不到添加栏。
2. 选「白名单」→ 出现「白名单（N）」添加栏；添加 `模板` → `@` 菜单只剩 `模板` 及其子项，从根目录仍能逐级下钻。
3. 选「黑名单」→ 出现「黑名单（N）」添加栏；添加 `模板` → `模板` 及其子项不再出现，其它候选照常。
4. 添加栏：移除条目计数同步、重复条目不重复、非法路径被拒绝；「当前笔记」首行始终在；改设置后下一次打开菜单生效；重载插件后设置保留。
5. `/` 命令菜单、消息短链 / 文件夹 chip 点击不受影响。

**验收标准**：

- 三档都能选，默认「不启用」，且选中「不启用」时添加栏不渲染；
- 白名单 / 黑名单的实际候选与上述规则一致（含子目录、祖先文件夹、同名前缀）；
- 「当前笔记」首行始终可选；
- 设置改动无需重启，下一次打开 `@` 菜单即生效；
- `/` 菜单、消息渲染、桥与 dsh 服务无行为变化；
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致。

## 8. 拍板结果

- [x] 实现路径：**A**（Obsidian 侧设置 + 纯函数在打开菜单取快照时整体过滤，不动桥、不重启服务）（2026-10-27）
- [x] 三档与默认值：**不启用 / 白名单 / 黑名单**，默认 **不启用**（2026-10-27）
- [x] 条目语义：vault 相对路径，文件 / 文件夹同一套前缀规则；白名单保留祖先文件夹以支持下钻，黑名单只排除目标（2026-10-27）
- [x] 「当前笔记」首行不受范围影响（2026-10-27）
- [x] 生效时机：下一次打开 `@` 菜单，无需重启（2026-10-27）
- [x] 范围只作用于 `@` 文件 / 文件夹候选，`/` 命令菜单、消息渲染、桥与 dsh 服务不动（2026-10-27）

## 9. 实施记录（2026-10-27）

用户当轮已明确指定要改的具体项，按 [AGENTS.md](../../AGENTS.md) 规则 12 例外与提案 §8 执行完毕。

### 实际改动

- [src/settings/schema.ts](../../src/settings/schema.ts)：新增 `MentionScopeMode`（`off` / `whitelist` / `blacklist`）、`MentionScope` 接口、`normalizeScopePath`（trim、反斜杠转正斜杠、去首尾斜杠，拒绝空串 / 空段 / `.` / `..`）、`normalizeScopePaths`（归一化 + 去重 + 丢弃非字符串）；`DshPluginSettings` 加 `mentionScope` / `mentionWhitelist` / `mentionBlacklist`；`DEFAULT_SETTINGS` 默认 `off` + 空数组；`mergeSettings` 非法 mode 回落 `off`，两个数组读取时归一化并复制（不与 `DEFAULT_SETTINGS` 共享可变数组）。
- [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts)（169 行）：`renderChatSection` 拆成 `renderStreamRefresh`（行为 / 文案不变）与 `renderMentionScope`；「「@」引用范围」三档下拉；`off` 时不渲染任何下方内容；非 `off` 时渲染 `div.dsh-settings-scope`（标题带条数、空提示、路径列表（不存在置灰 + 「路径不存在」）、`setIcon('x')` 移除、输入框 +「添加」（Enter 同样提交）、提示行）；非法 / 重复路径各有提示；写操作 `saveSettings()` 后 `context.refresh()`。
- [src/view/native/mention-scope.ts](../../src/view/native/mention-scope.ts)（新增，60 行）：`filterMentionEntries(entries, scope)` 纯函数；`off` 原样返回；白名单只留条目内（含子目录）候选 + 祖先文件夹；黑名单排除条目内候选；前缀判断固定为 `path === scopePath || path.startsWith(scopePath + '/')`；复用 `schema.ts` 的 `normalizeScopePaths`；未知 mode 显式兜底为「不过滤」。
- [src/view/panel-host.ts](../../src/view/panel-host.ts)：`DshPanelHost` 增加 `getMentionScope(): MentionScope`。
- [src/main.ts](../../src/main.ts)：实现 `getMentionScope()`，从 settings 组装 `{ mode, allow, deny }`。
- [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx)：把 `getMentionScope` 透传给 `NativeChatRoot`。
- [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx)：`listMentionEntries()` 取完 vault 快照后套 `filterMentionEntries(entries, getMentionScope())`。
- [styles.css](../../styles.css)：约 +125 行 `.dsh-settings-scope*` 样式；颜色 / 背景 / 边框全用主题变量，路径省略号防溢出。
- [README.md](../../README.md)：设置页功能列表补「「@」引用范围」。
- 未改：`composer.tsx`、`mention.ts`、`note-links.ts`、`settings/tab.ts`、`context.ts`、`packages/dsh-obsidian-bridge`、`src/service/`。

### 验证结果（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 0.4.1）

- `npm run build` 通过（tsc + esbuild；`main.js` 约 247.1kb）。
- `npm run check` 全绿（版本三处一致、无运行时依赖、tsc、bridge 清单与语法、`main.js` 与源码一致）。
- 纯函数冒烟（esbuild 打包 `mention-scope.ts` / `schema.ts` 到 /tmp 后用 node `assert` 跑）：
  - `off` 原样返回；白名单空 → `[]`；白名单文件夹（含子目录）；白名单深层文件夹保留祖先链；白名单单个文件；黑名单文件夹（含子目录）；黑名单单个文件；黑名单 `日记` 不误伤 `日记本.md`；
  - 路径归一化 `/日记//子/` → `日记/子`；`normalizeScopePath` 对 `a\b` → `a/b`、`a//b` → null、`a/../b` → null、`./a` → null、空串 → null；
  - `mergeSettings` 非法 mode 回落 `off`、非法路径被丢弃、合并结果与 `DEFAULT_SETTINGS` 不共享数组。
- CDP 实测（`<vault>`，vault 根有 `日记/`、`模板/` 与根级 `AGENTS.md` 等）：
  - 设置页「聊天」tab：默认「不启用」、无添加栏；切白名单后标题「白名单（0）」+ 空提示 + placeholder；添加 ` 模板/ ` 归一化为 `模板`、计数 1；添加 `../outside` 后提示行变错误文案并加 `is-error`；添加重复 `模板` 提示「已经在列表里：模板」；添加 `日记` 计数 2；点移除 `日记` 计数 1；切黑名单后「黑名单（0）」独立列表，添加 `模板` 后「黑名单（1）」；切回不启用后添加栏消失；`data.json` 落盘为归一化后的路径；路径不存在时行置灰 + 「路径不存在」；截图确认布局 / 主题变量正常。
  - @ 菜单：不启用时根级全量（当前笔记 + `日记/` + `模板/` + 根文件）；白名单 `[模板]` 只有「当前笔记（AGENTS.md）」+「模板/」；输入 `@模板/` 只列 `模板/日记模板.md`；输入 `@模` 列 `模板/` + `模板/日记模板.md`；白名单 `[模板/日记模板.md]` 根级只有当前笔记 + `模板/`（祖先用于下钻），`@模板/` 只列该文件；黑名单 `[模板]` 时 `模板/` 及其子项消失、`日记/` 与根文件照常、当前笔记在；黑名单 `[模板]` 下输入 `@模` 菜单不打开；白名单空只剩「当前笔记」；改设置后不重载插件，下一次打开 @ 即按新范围。
  - 实测后已把运行时设置恢复默认（`off` + 空数组），`data.json` 当前即默认值。
- 未覆盖：真 IME、深色主题目测、popout 下浮层定位（与本次无关）。

### 与提案的偏差

- `mention-scope.ts` 复用 `schema.ts` 的 `normalizeScopePaths`，不再单独实现归一化逻辑。
- 未知 mode 显式兜底为「不过滤」（防御手改 `data.json`）。
- 设置页错误文案按实际归一化行为改为「首尾的斜杠会自动去掉」（不是「以 `/` 开头即非法」）。
- 其余与提案一致；未改 composer / mention / tab / bridge。

