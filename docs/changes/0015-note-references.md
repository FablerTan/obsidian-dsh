---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: src/view/native, docs
issue: 消息内容里的 @路径 不渲染成 Obsidian 链接，[[…]] 双链能渲染但点了打不开笔记
---

# 0015 消息内容引用：@ 路径渲染为双链 + [[…]] 点击打开

## 1. 背景与问题

原生聊天面板把所有消息正文交给 `MarkdownRenderer.render` 渲染（`src/view/native/ui/timeline-nodes.tsx` 的 `MarkdownText`）。由此产生两个问题：

1. **当前笔记引用只是纯文本。** 发送时 `native-chat-root.tsx` 用 `mention(note.path)` 在正文前拼一段 `@路径`（带空格时是 `@"路径"`），渲染后仍是普通文字。
   CDP 实测（2026-10-27，Obsidian 1.14.5）：用户消息的 innerText 为 `@"Coding 项目流程.md"\n你现在时ptc模式吗`，对应 DOM 只有 `<p>@&quot;Coding 项目流程.md&quot;…</p>`，没有任何链接元素。
2. **[[…]] 双链能渲染，但点击无反应。** 助手输出里的 `[[笔记]]` 已被 `MarkdownRenderer` 解析成 `<a class="internal-link" data-href="…" href="…">`（CDP 实测：`data-href` 正确，例如 `Coding 项目流程.md`）。
   但面板没有注册任何点击处理：对该元素派发一次可冒泡的 `click`，返回 `defaultPrevented === false`，没有新 leaf、当前笔记也没变化。渲染器只负责生成标记，打开笔记是视图的职责，而本面板缺这一环；输入框上方「当前笔记」浮标能打开，是因为它直接调用了 `app.workspace.openLinkText()`。

影响：用户看到「引用」却点不开；想打开被引用的笔记只能自己去文件树里找。

## 2. 目标与非目标

- 目标：
  1. 把消息里的 `@vault/相对/路径.md` 与 `@"含 空格 的路径.md"` 渲染成 Obsidian 内部链接（双链的等价物），只在**该文件确实存在于 vault** 时转换，显示名用文件名；语音/邮件里的 `@` 与代码块里的示例不受影响。
  2. 面板内所有 `[[…]]` 内部链接可点击打开，行为对齐 Obsidian 自身：默认在当前/最近编辑区打开；Cmd/Ctrl+点击新标签、Cmd/Ctrl+Alt 分屏、中键新标签（复用 `Keymap.isModEvent`）。
  3. 发送当前笔记引用时直接写 `[[文件名]]` 短链接（不再写 `@路径`）；`@路径` 只作为历史消息与手动输入的转换来源，不改 dsh 侧插件。
  4. 点击链接总是打开到**主区新标签**，聊天面板始终保留在右栏；不加悬停预览。
- 非目标：
  - 悬停预览（`hover-link` 不是公开 API，另案再评估）；
  - 嵌入 `![[…]]` 的渲染与交互；
  - 输入框里的 `@` 自动补全（本次只做展示层）；
  - 把 vault 里不存在的 `@路径` 也变成「未解析链接」（这类文本保持原样）；
  - 外部 http(s) 链接、文件附件链接的点击行为（保持现状）；
  - 助手输出里其它非链接语法的改造。

## 3. 方案

### 方案 A（推荐）

**A1. 新增纯函数 `src/view/native/note-links.ts`**

`applyNoteLinks(text, resolve)`：把 `@路径` 转成 wiki 链接文本，`resolve(path)` 由调用方注入（返回 `{ name }` 或 `null`），因此该文件不 import obsidian，可单独冒烟。

规则：

- 跳过围栏代码块（三个反引号或 `~~~` 开头的块）与行内代码（反引号）；
- 跳过已存在的 `[[…]]`，以及前面紧邻单词字符的 `@`（避免 `user@example.com` 之类）；
- 匹配 `@"…"`（带空格路径）与 `@token`；token 末尾的 `，。；：！？,.;:!?)` 等标点回填到链接之后；
- 只有 `resolve()` 命中 vault 内真实文件才替换，否则原样保留；
- 输出**短链接** `[[basename]]`（2026-10-27 拍板，见第 8 节）：目标与显示都用文件名，Obsidian 按就近/最近规则解析；同名笔记可能落到相近的另一篇，属于已接受的取舍；
- 路径含 `|`、`#`、`[]`、`^` 等会破坏链接语法的字符时不转换，保持 `@路径` 原样。

**A2. 新增 `src/view/native/ui/markdown-text.tsx`**

把 `MarkdownText` 从 `timeline-nodes.tsx` 搬出来，负责三件事：

1. 渲染前调用 `applyNoteLinks`，resolver 用 `app.vault.getAbstractFileByPath(path)`（返回 `TFile` 且是 markdown 时取 `file.basename`）；
2. 在渲染容器上做事件委托（React `onClick` + `onAuxClick`）：命中 `a.internal-link`（读 `data-href`，回退 `href`）时 `preventDefault()` 并
   `void app.workspace.openLinkText(href, sourcePath, true)`（第三参 `true` = 主区新标签，CDP 实测聊天面板保留）；
3. 其余链接（外部链接等）不拦截，保持现状。

**A3. 发送格式改为短链接**

`native-chat-root.tsx` 的 `mention(path)` 换成 `noteReference(note)`：正文前拼 `[[note.name]]`（短链接，与展示一致）；笔记名含 `|`、`#`、`[]`、`^` 等破坏链接语法的字符时回退旧的 `@路径` 写法。笔记浮标不变（仍显示文件名、点击打开）。

**A4. 接线**

- `timeline-nodes.tsx` 删除本地 `MarkdownText`，改为 `import { MarkdownText } from './markdown-text';`（用户消息、追加消息、助手文本三处调用不变）。
- `styles.css` 不改：内部链接沿用 Obsidian 主题里 `.markdown-rendered a.internal-link` 的颜色/下划线/未解析样式。

### 方案 B（部分采用：与 A3 合并）

原方案 B 是「发送时直接拼 wiki 链接、不碰展示层」。2026-10-27 用户选择发送也改成 `[[文件名]]`（见 A3），因此 A3 采用本方案的做法；但历史消息里的旧 `@路径` 仍需要 A1 的展示层转换兜底，所以不是纯 B。

### 方案 C（不采用）：让 `MarkdownRenderer` 自带点击处理

官方只保证 `render()` 生成标记（[MarkdownRenderer.render 文档](https://docs.obsidian.md/Reference/TypeScript+API/MarkdownRenderer/render)），没有公开的「渲染即注册链接点击」入口；click 处理器属于视图层，需要自己接。方案 A 的事件委托直接调用官方 `Workspace.openLinkText`（[文档](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/openLinkText)）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/note-links.ts` | 新增：`applyNoteLinks` / `noteLinkOf` / `isLinkSafe` 纯函数（跳过代码与已有链接、引号路径、存在性校验、短链接） |
| `src/view/native/ui/markdown-text.tsx` | 新增：`MarkdownText` 组件（渲染 + `@路径` 转换 + `a.internal-link` 点击打开主区新标签） |
| `src/view/native/ui/timeline-nodes.tsx` | 删除本地 `MarkdownText` 与 `MarkdownRenderer/Component` import，改用新组件 |
| `src/view/native/ui/native-chat-root.tsx` | `mention()` → `noteReference()`：发送内容开头改为 `[[文件名]]`，特殊字符回退 `@路径` |
| `docs/changes/0015-note-references.md` | 本提案 |
| `docs/changes/README.md` | 索引登记 |
| `docs/development.md` | 改动地图补两行（`note-links.ts` / `markdown-text.tsx`） |
| `docs/roadmap.md` | 完成后更新「最后更新」时间戳（不改里程碑状态） |

不改 `styles.css`、`shared/`、`service/`、`packages/`。

## 5. 行为变化

- 新消息的当前笔记引用从 `@"Coding 项目流程.md"` 变成 `[[Coding 项目流程]]`（发送文本与展示都是短链接），渲染成可点击的内部链接；点一下在**主区新标签**打开该笔记，聊天面板保持在右栏。
- 历史消息里的旧 `@路径` 在渲染时转换成同样的短链接（文件仍存在才转换）。
- 助手输出（以及用户手动输入的）`[[笔记]]` 现在可以点击，总是主区新标签打开。
- 短链接按 Obsidian 规则解析：同名笔记可能落到就近的另一篇（第 8 节已拍板接受）；笔记改名/移动后旧链接变成普通文字。
- 代码块/行内代码中的 `@路径`、邮箱地址、vault 里不存在的 `@路径` 仍按普通文本显示。
- 模型看到的消息前缀由 `@路径` 变成 `[[文件名]]`；会话历史、停止/重试、其它桥行为不变。
- 无新增设置项、无新命令、无样式变更。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| mention 正则误伤普通文本 | 少量 `@…` 被转成链接 | 有存在性校验 + 跳过代码/已有链接；可只删 `applyNoteLinks` 调用 |
| 点击事件与 Obsidian 将来内置处理重复触发 | 可能开两个标签 | 已 `preventDefault()`；若真重复出现，改 `stopPropagation()` 或去掉自带处理 |
| 点击打开后聊天气泡被新标签盖住 | 用户需要切回右栏面板（面板本身不关） | 面板固定在右栏；不满意可改回「当前标签」或 `Keymap.isModEvent` |
| 短链接同名歧义（用户已选择） | 极少数同名笔记会打开就近的另一篇 | 把 `noteReference` / `applyNoteLinks` 的输出改成 `[[完整路径\|文件名]]` |
| 发送格式变化影响 dsh 侧识别 | 当前 profile 未安装 mentions 插件，无影响；将来若恢复需同步 | 回滚 `noteReference` 到旧 `mention()` |
| 路径含竖线、`#`、`[]`、`^` | 生成的链接语法错误 | 跳过转换/回退 `@路径`，保持原文本 |

## 7. 验证

自动化：

```bash
npm run build
npm run check
```

CDP 回归（Obsidian 主窗口，步骤见 [docs/obsidian-cdp.md](obsidian-cdp.md)）：

1. 纯函数冒烟（esbuild 打包到 /tmp 后 node 跑）：`@"Coding 项目流程.md"` → `[[Coding 项目流程]]`；`@folder/Note.md` → `[[Note]]`；代码块/行内代码里的 `@路径`、`user@example.com`、不存在的路径保持原样；已有 `[[…]]` 不被二次处理；
2. 打开一个笔记 → 新建会话发送一条短消息 → 断言用户消息里出现 `a.internal-link`，文本 = `Coding 项目流程`、`data-href` = `Coding 项目流程`，且不再残留 `@` 路径文本；同时读 newest 会话文件，断言 user 消息前缀是 `[[Coding 项目流程]]`；
3. 对该链接 `dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` → 断言 `defaultPrevented === true`、`getLeavesOfType('markdown')` / 打开的视图文件等于目标笔记（新标签，宽度在主区）、`getLeavesOfType('dsh-native-chat').length` 仍为 1；验证后关闭测试新开的标签；
4. 助手历史消息里的 `[[…]]` 链接重复步骤 3；
5. 打开一个带 `@路径` 的历史用户消息（本轮已有），断言它也被转换成短链接；
6. 控制台无新增报错。

手动验收：

- 点击引用打开正确笔记；Cmd/Ctrl+点击开新标签；Cmd/Ctrl+Alt 分屏；中键开新标签；聊天面板始终保留在右栏。
- 邮件地址 / 不存在的 `@路径` / 代码块示例保持纯文本。
- 关闭再打开面板、重启服务后引用样式与点击均正常。

## 8. 需要你拍板

- [x] **链接显示形式**：选 C，短链接 `[[Note]]`
- [x] **转换范围**：助手输出里的 `@路径` 也转换（仅 vault 中能找到该文件时）
- [x] **点击打开位置**：固定「总是主区新标签」
- [x] **发送文本**：顺便改成 `[[…]]`
- [x] **悬停预览**：不做

**拍板记录（2026-10-27）**：用户在提案评审时按上述 5 点答复，提案据此把 A3（发送格式）、A2（点击行为）、A1（短链接输出）改到位；其余范围与非目标不变。

## 9. 实施记录

实施日期：2026-10-27（用户在本轮按第 8 节 5 点拍板，提案据此执行并标 `done`）。

实际改动：

- 新增 `src/view/native/note-links.ts`：`applyNoteLinks`（按行处理围栏代码、按反引号跳过行内代码、已有 `[[…]]` 与邮箱不处理、支持 `@"…"`、标点回填；先整段解析，失败再按标点截断）+`noteLinkOf`/`isLinkSafe`；
- 新增 `src/view/native/ui/markdown-text.tsx`：`MarkdownText` 从 `timeline-nodes.tsx` 搬出；渲染前 `applyNoteLinks`（resolver = `app.vault.getAbstractFileByPath`，要求 `TFile` 且 `.md`，取 `basename`）；`onClick`/`onAuxClick` 处理 `a.internal-link`，`preventDefault()` + `openLinkText(href, sourcePath, true)`（主区新标签）；
- `timeline-nodes.tsx`：删除本地 `MarkdownText` 与 `MarkdownRenderer/Component` import，改用新组件；
- `native-chat-root.tsx`：`mention(path)` → `noteReference(note)`，发送前缀 `[[note.name]]`（不安全名字回退旧 `@路径`）；
- `docs/development.md`：改动地图补 `note-links.ts` / `markdown-text.tsx`，回归清单第 19 条改为 `[[文件名]]` 并新增第 35 条；`docs/roadmap.md`：时间戳 + M4 条目；`docs/changes/README.md`：状态改 done。

验证结果：

- `npm run build` 通过；`npm run check` 全部通过（版本 / 依赖 / tsc / bridge / main.js 一致）。
- 纯函数冒烟（esbuild 打包到 `/tmp` + node）：22 条断言全部通过，覆盖 `@"…"`、`@folder/Note.md`、空格路径、标点（`，然后` / `,`）、多引用、未解析、邮箱、已有 `[[…]]`、行内代码、围栏代码、不安全字符、URL、无替换时返回同一引用等。
- CDP（Obsidian 1.14.5，vault `<vault>`）：
  - 重载插件后，历史用户消息（原始 `@未命名思维导图.md`）渲染为 `a.internal-link`（`data-href=未命名思维导图`），时间线不再残留 `@` 文本；
  - 点击该链接：`defaultPrevented === true`（事件被拦截），标签数 13→14，`activeFile=未命名思维导图.md`，宽度 842（主区），`dsh-native-chat` 仍为 1；
  - 打开含 `[[Coding 项目流程]]` 的助手历史消息，点击链接同样新开主区标签（markdown、842），面板保留；测试标签已关闭；
  - 新建会话发送「引用测试，请只回复 OK。」：气泡渲染为「日记模板」链接（`data-href=日记模板`）；会话文件 `turnOutline` 的 prompt 为 `"[[日记模板]] 引用测试，请只回复 OK。"`，确认发送格式；模型回复 OK，面板无错误，控制台无插件相关新错误。

与提案的偏差：无（按第 8 节拍板执行：短链接、助手输出也转换、总是主区新标签、发送 `[[…]]`、不做悬停预览）。测试新建的会话「新会话」保留在会话列表中，未删除。
