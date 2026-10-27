---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: src/view/native, styles.css, docs
issue: 输入框 @ 触发项目文件下拉菜单（参考 dsh）；当前笔记改为默认不引用、作为 @ 列表第一项「当前笔记」
---

# 0023 输入框 @ 文件引用菜单（当前笔记改为 @ 首项）

## 1. 背景与问题

### 现状

- 输入框上方有一条「当前笔记」小浮标（[0013](0013-native-chat-compact-ui.md)），发送时**默认**在正文前拼 `[[文件名]]`；只有点 × 才能本次不引用（`src/view/native/ui/native-chat-root.tsx` 的 `noteReference()` / `noteDismissed`）。
- [0015](0015-note-references.md) 明确把「输入框里的 @ 自动补全」列为非目标，当时只做了**展示层**：消息里的 `@路径` 渲染成 Obsidian 短链、点击打开笔记。
- 输入框是普通 `textarea`，没有任何行内补全能力；要引用别的笔记只能手动敲路径，且敲错了没有反馈。

### 需求（用户原话拆解）

1. 输入框内输入 `@` 出现下拉菜单，显示项目文件，交互参考 dsh 的 @ 功能。
2. 当前笔记的功能改成**默认不引用**（不再自动拼前缀）。
3. 输入 `@` 后列表第一项就是当前笔记，第一项的名字叫「当前笔记」。
4. 其余项参考 dsh。

### dsh 的 @ 参考行为（0.2.1-rc.3 源码核对）

参考 dsh checkout 的 `packages/context/file-reference/src/grammar.ts`、`packages/context/file-reference-local/src/search.ts`、`packages/client/ui-input-trigger/src/core/detect.ts`、`packages/client/ui-reference/src/client/index.ts`、`packages/client/ui-conversation/src/client/input/facade.ts`：

| 环节 | 规则 |
|---|---|
| 触发 | `@` 只在草稿开头或空白之后生效；词内（如邮箱）不触发；`@"…` 可含空格，且允许未闭合的引号（选目录后继续展开） |
| 候选 | 空查询列出**当前目录的直接子项**（文件 + 文件夹）；查询含 `/` 时只列该目录的直接子项，其余情况按全量索引模糊排序 |
| 数量 | 最多 20 条；索引上限 1 万条；排除 `.git` / `node_modules`；路径中带 `.` 开头的段默认隐藏（查询里出现 `.` 才显示） |
| 排序 | 名字完全匹配 1000 > 名前缀 900 > 名字包含 700 > 路径包含 500 > 路径子序列 300+；目录 +25；同分先目录、再路径短、再字典序 |
| 行 | `文件 · 名字` / `文件夹 · 名字/`，右侧灰字显示完整路径；分组标题「文件与文件夹」 |
| 插入 | `@path`；含空白用 `@"path"`；目录用 `@path/`（引号保持打开）并**继续展开**下一级；选中后若后面不是空格，自动补一个空格 |
| 键位 | ↑/↓ 移动高亮，Enter/Tab 选中，Esc 关闭；焦点始终留在输入框（combobox 模式），行用 mousedown 选中 |
| 外观 | 贴在输入框上沿，最高 320px，圆角 12px，行高约 40px，高亮整行底色 |

> dsh 的会话引用（`@session`）不在本次范围；我们只做项目文件。

## 2. 目标与非目标

### 目标

1. 输入 `@`（草稿开头或空白后）弹出菜单，列当前 vault 的项目文件与文件夹，规则对齐上表。
2. 菜单**第一项固定为「当前笔记」**（当前激活的 Markdown 笔记），显示名为「当前笔记」，右侧说明为 vault 相对路径；空查询时排第一。
3. 选中后把 `@` 到光标的内容替换为 `@路径`（含空格 `@"路径"`），焦点留在输入框；选中文件夹插入 `路径/` 并继续展开下一级。
4. 取消「当前笔记自动引用」：发送不再拼前缀；输入框上方的笔记浮标及其样式删除；空态文案改成提示用 `@` 引用。
5. 消息渲染继续走 `applyNoteLinks`：`@路径` 仍显示为短链、点击打开笔记（[0015](0015-note-references.md) 行为不变）。

### 非目标

- 不改 dsh 侧 bridge（`packages/dsh-obsidian-bridge`）与桥协议；不需要重新 link / 重启服务。
- 不做 `@session`；不做发送前的路径存在性校验。
- 不做原子 chip / 富文本输入框：仍是 `textarea` 纯文本，`@路径` 在草稿里是可编辑文本。
- 不改标题、会话、模型、权限、上下文占用等其它交互；不动 Obsidian 的全局 suggest / modal 弹窗。

## 3. 实现路径调研

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | Obsidian vault 索引 + 新 @ 菜单组件：新增纯函数 `src/view/native/mention.ts`（token 检测 / 候选构建 / dsh 同款排序 / 插入文本格式化）与 `src/view/native/ui/mention-menu.tsx`（分组列表、高亮、键盘/鼠标选中）；`composer.tsx` 跟踪 textarea 光标与 @ token，选中后替换区间并回填光标；`native-chat-root.tsx` 删除自动引用；样式进 `styles.css` | 4 个源文件 + `styles.css` + docs | 排序/触发规则要照 dsh 重写（约 150 行纯函数，可单测）；索引是内存全量过滤（Obsidian 已缓存 `vault.getFiles()`，万级文件每次按键 O(n)，实测可接受）；不碰桥、无需重启服务 | **推荐**：与 dsh 行为对齐、无往返延迟、不依赖 dsh 内部 remote |
| B | 走 dsh 的 `fileReferences` Remote：`packages/dsh-obsidian-bridge/lib/client.js` 增 `fileReferences(query)`，转调 dsh 的 `ctx.remote`；`core-bridge.ts` 加方法；composer 每次输入异步取候选 | bridge v5 + `core-bridge.ts` + composer + docs | 桥版本 +1，必须重新 link 并重启 DSH 服务；每键一次 `executeJavaScript` 往返（数十到上百 ms），要处理滞后/竞态；只能在已 attach 会话后用；「当前笔记」仍是宿侧概念，需单独注入；依赖 dsh 内部 remote 名，版本漂移风险高 | 不推荐：实时性差、升级成本高 |
| C | 内容可编辑 + 原子引用 chip：把 textarea 换成 contenteditable，选中后插入不可分割的 chip（对齐 dsh 编辑器观感），序列化输出 `@path` | 输入框整体重写 + 样式 + 发送/草稿接线 | 高度自适应、IME、光标、粘贴、可访问性都要重做，与现有发送逻辑耦合深；收益主要是视觉 | 不推荐：风险与本次需求不匹配，可作后续体验升级 |

### 推荐方案 A 的落点

- `src/view/native/mention.ts`（纯函数，不 import obsidian）：
  - `activeAtToken(draft, caret)`：照 `@"…"` → `@token` 两段正则（允许未闭合引号）；
  - `buildCandidates(entries, query, currentNote)`：目录直列 / 全量模糊 + 排序 + 截断 20 条 + 隐藏/排除规则；
  - `formatMention(candidate)`：`@path` / `@"path"` / 目录 `@"path/`。
- `src/view/native/ui/mention-menu.tsx`：只负责渲染与高亮（复用 `.dsh-native-menu` 基础样式 + `is-mention` 修饰），键盘事件由 composer 统一处理。
- `composer.tsx`：`onChange` / `onClick` / `onKeyUp` 时重算 token；↑/↓/Enter/Tab/Esc 优先给菜单；选中用 `textarea.setRangeText()`（或受控 setState + 下一帧设置 selection）后重新检测 token，文件夹选择后菜单保持打开。
- `native-chat-root.tsx`：删除 `noteReference()` / `noteDismissed` / 浮标 props 与样式；`Composer` 改为接收 `currentNote`；空态文案改为「输入 @ 引用当前笔记或项目文件」。
- 定位用纯 CSS：把输入卡片包一层 `position: relative` 的容器，菜单 `position: absolute; bottom: calc(100% + 4px)`，`max-height: min(320px, 45vh)`，列表内部滚动。输入框长高时菜单跟随，不用 JS 量坐标（popout / 缩放下的坐标问题一并绕开）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/mention.ts` | 新增：@ token 检测、候选构建与排序、插入文本格式化（纯函数） |
| `src/view/native/ui/mention-menu.tsx` | 新增：@ 下拉菜单（「当前笔记」+「文件与文件夹」分组、行、高亮） |
| `src/view/native/ui/composer.tsx` | 跟踪光标 / token，键位与选中替换，接入菜单；删除当前笔记浮标 |
| `src/view/native/ui/native-chat-root.tsx` | 删除 `noteReference` / `noteDismissed` 与自动前缀；传 `currentNote`；改空态文案 |
| `styles.css` | 删除 `.dsh-native-note*`；新增 @ 菜单与行样式（只用主题变量） |
| `docs/changes/0023-at-file-mentions.md` | 本提案 |
| `docs/changes/README.md` | 索引登记 |
| `docs/development.md` | 改动地图补 `mention.ts` / `mention-menu.tsx`，更新「当前笔记」相关行与回归清单 |
| `docs/architecture.md` | UI 组成那行补 @ 菜单与 `mention.ts` |
| `docs/roadmap.md` | 完成后把 R-6 改 `✅ 已完成` 并更新时间戳 |

不改 `packages/`、`src/service/`、`src/settings/`、`src/shared/`。

## 5. 行为变化

- 输入 `@` 弹出菜单；第一项「当前笔记」（说明为路径），下面是「文件与文件夹」分组；↑/↓/Enter/Tab/Esc 与鼠标都能选。
- 选中文件：草稿里插入 `@笔记路径.md`（含空格加引号），若后面不是空格会自动补一个；发送后消息渲染成短链并可点击（0015 行为不变）。
- 选中文件夹：插入 `@文件夹/`，菜单继续展开该目录。
- **不再自动引用当前笔记**：每条消息不再自动带 `[[文件名]]` 前缀；想引用时走 `@` 菜单（或手动输入）。
- 输入框上方的笔记浮标消失；空态提示文案改变。
- 新消息的模型可见前缀由 `[[文件名]]` 变成 `@vault/相对/路径.md`（与 dsh 的 @ 语法一致；如果用户选择保留 `[[文件名]]` 插入格式，则以拍板结果为准）。
- 无新增设置项、无新命令、无桥变化、无服务重启。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 触发规则误判（词内 @ / 邮箱 / 中文标点后） | 菜单弹出或漏弹 | 纯函数固定用例覆盖；随时可把 `activeAtToken` 改回「仅空白后」 |
| 键盘事件抢走 Enter / Tab / 方向键 | 无法换行或切换焦点 | 只在菜单打开时 preventDefault；IME 组合输入期间一律不处理（沿用现有 `isComposing`） |
| 菜单位置被侧栏裁切 / 输入框长高后错位 | 菜单看不全 | 纯 CSS 贴输入卡片上沿并限制 `max-height`；列表内部滚动 |
| 大 vault 每次按键全量排序卡顿 | 输入不跟手 | 索引在菜单打开时取一次快照；排序只对候选路径跑；实测超过 1 万文件再考虑增量/防抖 |
| 插入格式改成 `@path` 后，渲染/点击出现回退 | 引用不可点 | `applyNoteLinks` 已有存在性校验与引号支持；若异常，可改回插入 `[[文件名]]`（不影响菜单本身） |
| 与 Obsidian 全局快捷键冲突（Esc / ↑↓） | 行为不一致 | 菜单打开时在 textarea 内捕获并 stopPropagation；失焦即关闭 |

## 7. 验证

自动化：

```bash
npm run build   # tsc -noEmit -skipLibCheck + esbuild，必须无错误
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
# mention.ts 是纯函数，可单独打包冒烟（不启动 Obsidian）：
./node_modules/.bin/esbuild src/view/native/mention.ts --bundle --platform=node --format=esm --outfile=/tmp/mention.mjs
node --input-type=module -e "import('/tmp/mention.mjs').then((m) => { /* token / 排序 / 格式化用例 */ })"
```

手动回归（Obsidian 重载插件后）：

1. 打开原生聊天面板，输入 `@`：菜单出现，第一项是「当前笔记」（说明为路径），下面是「文件与文件夹」。
2. ↑/↓ 移动、Enter 选中、Esc 关闭；鼠标点选；焦点始终在输入框。
3. 选中一个文件 → 草稿出现 `@路径`，后面自动补空格；选中含空格的文件 → `@"…"`。
4. 选中文件夹 → 出现 `@文件夹/`，菜单继续列出该目录；再选子文件。
5. 关键词过滤（名字前缀 / 包含 / 路径子序列）；查询带 `/` 只列该目录；`.git` / `node_modules` / 隐藏文件不出现（查询带 `.` 时出现）。
6. 发送后：消息里的 `@路径` 渲染成短链，点击在主区新标签打开；**不再自动带当前笔记前缀**。
7. 切换当前笔记后，`@` 第一项的「当前笔记」与路径同步更新。
8. 输入框上方不再有笔记浮标；空态文案已更新。

验收标准：以上 8 条全部符合，且 `npm run build` / `npm run check` 通过。

## 8. 拍板结果（2026-10-27）

> 用户当轮已明确指定要改的具体项（@ 菜单、当前笔记默认不引用、列表首项叫「当前笔记」），按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外视为已批准；路径单选未等到答复，按推荐路径与推荐默认值执行，后续可随时调整。

- [x] 实现路径：**A**（Obsidian 侧 vault 索引 + 新菜单组件；不改 bridge、不重启服务）。
- [x] 插入文本：`@vault相对路径`（含空格用 `@"…"`），消息展示层继续转短链。
- [x] 当前笔记行：跟随查询过滤（查询为空时排第一；不匹配时隐藏，避免回车误选）。
- [x] 文件范围：全部文件 + 文件夹（排除 `.git` / `node_modules`；点开头的段默认隐藏）。
- [x] 笔记浮标：删除，由 @ 菜单取代。

## 9. 实施记录（2026-10-27）

### 实际改动

- 新增 `src/view/native/mention.ts`：`activeMentionToken`（起点/空白后触发，`@"…` 允许未闭合引号，词内邮箱不触发）、`listMentionCandidates`（空查询 / 带 `/` 直列目录，其余全量模糊；名字精确 > 前缀 > 包含 > 路径包含 > 子序列，目录 +25）、`mentionsQuery`、`formatMention`（`@path` / `@"path"` / 目录 `@"path/`）、20 条上限。
- 新增 `src/view/native/ui/mention-menu.tsx`：分组列表（首行「当前笔记」无分组标题，文件分组为「文件与文件夹」）、图标 + 名称 + 路径说明、`aria-activedescendant` 高亮、mousedown 选中且不抢焦点。
- `composer.tsx`：textarea 跟踪 @ token，↑/↓/Enter/Tab/Esc、鼠标选中，选中后替换区间并回填光标；文件夹选后保持菜单展开；Shift+Enter 仍换行；选择期间用 `suppressRef` 屏蔽旧光标事件。删除笔记浮标与其 props。
- `native-chat-root.tsx`：删除 `noteReference` / `noteDismissed`，发送不再拼前缀；新增 `listMentionEntries()`（`app.vault.getAllLoadedFiles()`）；空态文案改为「输入 @ 可引用当前笔记或项目文件」。
- `styles.css`：删除 `.dsh-native-note*`；新增 `.dsh-native-input-wrap` 与 `.dsh-native-mention*`（纯 CSS 贴输入卡片上沿，`max-height: min(320px, 45vh)`，列表内部滚动）。
- 文档：`docs/development.md`（改动地图、回归清单 19 / 35）、`docs/architecture.md`、`docs/roadmap.md`（R-6）、`docs/changes/README.md`。

### 验证

- `npm run build` 通过；`npm run check` 全绿（版本三处一致、无运行时依赖、tsc、bridge 清单、main.js 与源码一致）。
- 纯函数冒烟（esbuild 打包 `mention.ts` 到 /tmp）：裸 `@`、行首 / 空白 / 换行后触发、邮箱不触发、`@"…` 引号、根目录直列（目录在前）、`b/` 子目录、隐藏文件、`node_modules` 排除、三种插入格式、`mentionsQuery` 全部符合预期。
- CDP 实测（Obsidian 1.14.5，`<vault>`，2026-10-27）：输入 `@` 菜单打开，首行「当前笔记 / AGENTS.md」，分组「文件与文件夹」，高度 320px；↑/↓ 高亮移动、Enter 选中、Esc 关闭、blur 关闭；`@模板` → 选中文件夹后草稿为 `@模板/` 且菜单继续列出 `日记模板.md`；手输 `@模板/日` 命中 `模板/日记模板.md`；含空格文件插入 `@"Coding 项目流程.md" `；`@Cod` 时当前笔记隐藏、只留 Coding；正文中间（`请看 @`）同样触发并在 token 原位替换；切换到 `模板/日记模板.md` 后首行路径同步。
- 端到端：发送「请只回复 OK @AGENTS.md」→ 用户气泡显示「请只回复 OK AGENTS」（AGENTS 为可点击内部链接），**没有**旧版的自动笔记前缀；消息历史正常。流式与模型回复未做完整回归（本次只验证发送与渲染）。

### 与提案的偏差

- 行内不显示 dsh 的「文件 · 名字」前缀，改为图标 + 文件名 + 灰色路径（侧栏更窄、图标已区分类型）；分组标题保持「文件与文件夹」。
- 菜单高度用 `min(320px, 45vh)` 而不是按上方可用空间动态量算；列表内部滚动。
- 用户当轮已明确指定需求，按规则 12 例外直接执行（未等待路径答复），路径与默认值取推荐项；如需 B / C 或其它取舍，可在本提案追加「变更记录」后重新调整。

### 变更记录

- 2026-10-27：目录交互按 dsh 的两个动作拆开——Enter / 鼠标点行改为**采纳** `@目录/ `（菜单关闭），Tab / 行内箭头仍是**下钻**；消息里的 `@目录/` 增加可点击 chip（点击在左侧文件列表展开选中）。详见 [0024](0024-folder-references.md)。
