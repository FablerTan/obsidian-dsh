---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户选定 A + F1（R2）
scope: src/view/native, styles.css, docs
issue: 编辑器选中文字后发送时自动带上「当前笔记 + 选中文本」，聊天里以微信式引用卡展示，点击跳回笔记并高亮原选区；同时处理右栏聊天改变编辑区焦点的问题
---

# 0058 编辑器选区引用（自动附带笔记 + 选区、微信式引用卡、点击跳回并高亮）

> 对应路线图 [R-41](../roadmap.md#需求待办)。用户原话：「在编辑器选中文字的时候，会自动在我发送的时候将相关笔记+文本发送过去，这个要单独处理，不要常规渲染，而是类似微信聊天工具引用的感觉，点击引用的内容会跳转到对应笔记的选中位置并高亮选中的文本。处理的时候注意一个问题，就是现在点击输入框是会失去 obsidian 编辑区的焦点，你想办法做到在右栏聊天时不改变焦点。」

## 1. 背景与问题

### 现状

原生聊天面板（`src/view/native/`）的发送链路只发纯文本：`composer.tsx` 的 Enter / 发送按钮 → `native-chat-root.tsx` 的 `send()`（`draft.trim()`）→ `core-bridge.ts` 的 `bridge.send(text)` → 桥 `client.js` 的 `sessionFace().prompt([{ type: "text", text }], "queue")`。消息正文由 dsh 原样落库，再经快照 `projectNode` 回显成 `kind: "user"` 的 `data.content`，面板 `UserMessage` 用 `textOfContent` 取出后交给 `MarkdownText` 常规渲染（先 `applyNoteLinks`，再 `MarkdownRenderer`）。

「当前笔记」今天只用于 `@` 菜单首项（`note-tracker.ts` 记录最后激活的 md），**发送时不附带正文**（空状态文案就写着「引用只带路径，不会把正文塞进消息」）。已有引用渲染先例：`@路径` → `[[短链]]`、`@目录/` → 可点击文件夹 chip（`note-links.ts` + `markdown-text.tsx` + `folder-reveal.ts`），但**没有「选区」这个概念**，也没有「跳回并高亮」的链路。

### 问题

1. 选中一段文字后想就这段内容提问：只能手工复制粘贴，或先 `@` 整篇笔记；模型拿不到「你选中的是哪几行」。
2. 面板里需要「微信式引用」：引用块不是普通 Markdown 渲染，而是独立卡片（笔记名 + 行范围 + 摘录），点击能跳回原笔记的选中位置并高亮。
3. 点右栏输入框后编辑区失焦（实测见下表），面板必须自己保留「最后一次活跃编辑器 + 选区」，否则发送那一刻已经读不到选区；用户还要求「右栏聊天时不改变焦点」。

### 关键实测（Obsidian 1.14.5 / Electron 43，CDP 9222，只读 eval）

| 行为 | 实测结果 |
|---|---|
| 编辑区有选区、有焦点 | `workspace.activeEditor` 有值；`editor.getSelection()` 返回原文；`.cm-editor.cm-focused` = 1；窗口激活时原生选区可见 |
| `.dsh-native-input` 获得焦点后 | `activeLeaf` 变成 dsh-native-chat；`workspace.activeEditor` → null；`getActiveViewOfType(MarkdownView)` → null；`getActiveFile()` 仍是原 md；`cm-focused` = 0；`window.getSelection()` 清空 → **原生选区不可见** |
| 失焦后的 MarkdownView 引用 | `view.editor.getSelection()` / `getCursor` / `posToOffset` / CM6 `state.selection` **全部保留**（发送时仍能读到选区） |
| 取「最后一次活跃编辑器」 | 官方 `workspace.getMostRecentLeaf()` 在侧栏活跃时仍返回主区 md leaf；文档原文："Useful for interacting with the leaf in the root split while a sidebar leaf might be active" |
| 归还焦点 | `view.editor.focus()` → activeLeaf / activeEditor / cm-focused 全恢复，原生选区重新可见；只触发 1 次 `active-leaf-change`、0 次 `file-open`（`NoteTracker` 路径相同会早退） |
| 跳转 | `leaf.openFile(file, { eState: { line } })` 会定位并自动 focus；`editor.setSelection(from,to)` + `scrollIntoView({from,to}, true)` + `focus()` 后选区可见 |
| 能否「不抢 DOM 焦点输入」 | 不存在：同一 document 只有一个焦点元素，textarea 要打字就必须拿 focus（IME 同理）。只能做到「快照 + 预览 + 归还」 |
| CM6 装饰器加持久高亮 | 不可行：渲染进程 `require('@codemirror/state')` 报 Cannot find module，拿不到 `Decoration` 构造器；`editor.cm` 是未文档化内部 API |

### 影响范围

只影响原生面板的「发送 / 用户消息渲染 / 主区跳转」，以及 `styles.css` 的引用卡样式。不改 dsh 源码、不改 `packages/dsh-obsidian-bridge`（v8 够用）、不重启服务、不动设置页与 @ 菜单。

## 2. 目标与非目标

### 目标

- 发送时**自动**把「最后一次活跃的 Markdown 编辑器 + 非空选区」作为引用带上：消息正文前置一段引用块（笔记路径 + 行/列范围 + 选区摘录），模型能直接读到选中原文。
- 面板里该消息**不走常规 Markdown 渲染**：引用块单独渲染成微信式引用卡（左侧竖线 + 笔记名 + 行范围 + 两行摘录），正文仍按 Markdown 渲染；解析失败时整段降级为普通 Markdown（不影响旧消息）。
- 点击引用卡 → 打开/切到对应笔记（主区，面板保留）→ 定位并选中原选区 → **焦点回到编辑区，选区可见**。
- 选区在打开输入框前被快照并显示为输入框上方的「引用预览条」（笔记名 + 行范围 + 摘录 + 关闭），让用户确认这次会带什么。
- 焦点：发送带引用的消息后，默认把焦点与选区**还给编辑区**（可拍板改默认）；面板空白区域点击不抢焦点（可选）。
- 降级：无选区、只读子会话、草稿以 `/` 开头（dsh 命令判定要求单 text block 且以 / 开头）→ 不加引用，行为与今天一致。

### 非目标

- 不改 dsh 源码 / 桥版本；不做结构化富消息（无 metadata 通道，见 3.1 路径 C）。
- 不做「整篇笔记正文自动塞进消息」（默认只带路径 + 选区；如需要见第 8 节拍板）。
- 不做选区持久高亮（聊天期间编辑区不聚焦就看不见原生选区；CM6 装饰器不可行，DOM 覆盖层不划算）。
- 不做微信式多级引用（引用别人的引用）、不做引用卡片编辑/删除（引用已随消息落库）。
- 不改 `@` 菜单、`/` 菜单、团队/子智能体、设置页（除非拍板加开关）。
- 不改官方 Web GUI 的渲染（它在别的客户端里会看到引用块 Markdown，见风险）。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

### 3.1 引用数据怎么随消息往返、怎么渲染

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）文本内联引用块 + 原生引用卡** | 发送文本 = 首行 `> 引用自 [[vault路径\|笔记名]] · 第 N 行 a–b 字` + 逐行 `> 摘录` + 空行 + 用户正文；`UserMessage`（`timeline-nodes.tsx`）先用纯函数 `parseQuote` 拆出引用与正文：命中 → `QuoteCard`（React，非 Markdown）+ 正文 `MarkdownText`；未命中 → 原样。点击卡走 `jumpToQuote`。 | 新增 1 个纯函数文件 + 1 个宿主文件 + 1 个 UI 组件；改 3 个现有文件 + CSS | 低；不动桥、不重启服务；引用随文本落库，**刷新/重启/其它客户端都还在**，旧消息天然兼容；代价是消息文本多几行（模型可见），行号可能漂移（用摘录搜索兜底） | **推荐**：满足「单独处理、微信式引用、可跳回」，改动最小、可回放 |
| B 隐藏 HTML 注释元数据 + 可见引用块 | 文本前置 `<!--dsh-cite v1 {"path":…,"from":[l,c],"to":[l,c]}-->` 存精确偏移，紧跟人类可读的 `> 引用自 [[…]] · …` 与摘录；面板解析注释 + 引用块后剥离。 | 与 A 相近 + 注释编解码 | 精确偏移无需从展示文本猜；但官方桌面 GUI / 其它客户端会把注释原文露出来（用户消息是纯文本渲染），且依赖渲染器保留注释；调试成本更高 | 可行但不推荐：收益（精确偏移）用 A 的「行/列 + 摘录搜索兜底」已能覆盖 |
| C 结构化 / 本地映射（桥 v9 或 sidecar） | 桥加 `send(text, quote)` 或宿侧把 quote 存进本地映射，按 `NativeChatNode.id`（= dsh message UUID，稳定）关联；正文保持干净。 | 桥 1 文件 + core-bridge + 原生 2~3 文件 + 存储/清理 | 高：dsh 的 prompt 只有 text/image，没有 metadata 通道；发送时拿不到 messageId（prompt 只回 `{ok:true}`），只能靠「文本相同 + 新出现」反查（重复文本会错配）；需升桥版本 + 重启服务；内存 map 重载即丢，持久化要新存储；**其它客户端完全看不到引用** | 否掉：成本/风险与收益不匹配 |
| D 只发文本、不做引用卡 | 选区原文以普通引用块发送，气泡照旧 `MarkdownText` 渲染。 | 1 个文件 | 最小；但没有「微信式引用」、不能跳回高亮，不满足需求 | 否掉：不满足用户明确要求 |

### 3.2 焦点与选区怎么处理

| 路径 | 做法 | 代价与风险 | 结论 |
|---|---|---|---|
| **F1（推荐）快照 + 预览 + 归还** | `composer` 的 mousedown（捕获阶段）与 focus 时用 `getMostRecentLeaf()` 读 `MarkdownView`（source 模式）的选区快照；输入框上方显示引用预览条；发送带引用的消息后 `editor.setSelection(from,to) + scrollIntoView + focus()` 把焦点与选区还给编辑区。 | 低；官方 API；编辑区在聊天期间不显示原生选区（用预览条替代）；发送后焦点会切回编辑区（连发需再点输入框，可拍板） | **推荐**：物理上无法「完全不抢焦点」，这是能做到且体验完整的一档 |
| F2 F1 + 保持 Obsidian「当前编辑器指针」 | 输入框获焦时 `workspace.setActiveLeaf(mdLeaf, { focus: false })`：activeLeaf / activeEditor 仍指向笔记，键盘仍归输入框。 | 中：全局热键 / 编辑器命令（如加粗）可能作用到笔记正文上；需短用或只在该次带引用时启用。实测选区仍然不可见，只是「逻辑焦点」不变 | 可选增强；是否常驻需拍板，默认不启用 |
| F3 真·不抢焦点 | 面板弹独立窗口（popout，独立 document）或全局监听按键转发进输入框。 | 高：popout 改变使用习惯且浮层定位有已知问题；按键转发会破坏 IME（中文输入法组合事件只发给焦点元素） | 否掉：不值得 |

### 3.3 推荐组合

**A + F1**（编码用「可见引用块」，焦点用「快照 + 预览条 + 带引用发送后归还」）。这是唯一同时满足「自动附选区 + 微信式引用卡 + 点击跳回高亮 + 尽量不改变焦点」且不依赖内部 API / 桥升级的组合。

> 按仓库流程，这一段写完就停下来问用户选哪条，不要默认开工。

## 4. 改动清单（按 A + F1）

| 文件 | 改动 |
|---|---|
| `src/view/native/quote.ts`（新增） | 纯函数：`formatQuote(quote)`（生成引用块文本，含摘录上限与截断标记）、`parseQuote(text)`（拆出 `{ quote, body }`，解析失败返回 null 保持原文）、`clampPosition(doc, pos)` / 行范围格式化；不 import obsidian，可单独冒烟 |
| `src/view/native/editor-selection.ts`（新增） | 宿主侧：`captureQuote(app)`（`getMostRecentLeaf` → `MarkdownView` → `getMode() === 'source'` → `getSelection/getCursor`，非空才返回）、`jumpToQuote(app, quote, sourcePath)`（复用已开 leaf / `openLinkText(path, sourcePath, true)` → 必要时切 source 模式 → `setSelection` + `scrollIntoView(…, true)` + `focus()`，行列 clamp，行号漂移时按摘录搜索兜底）、`restoreQuoteFocus(app, quote)`（发送后归还） |
| `src/view/native/ui/quote-card.tsx`（新增） | 微信式引用卡：左侧竖线 + 笔记图标 + 笔记名 + 行范围 + 最多两行摘录；整卡 `role="button" tabindex={0}`，点击 / Enter 触发跳转；`title` 放完整摘要 |
| `src/view/native/ui/timeline-nodes.tsx` | `UserMessage` 先 `parseQuote(text)`：命中 → `QuoteCard` + `MarkdownText(body)`；否则维持现状。`NodeView` 的 user / steering 分支把 `app` 传下去（已有） |
| `src/view/native/ui/composer.tsx` | 输入卡容器加 `onMouseDownCapture` / `onFocus` 回调（在 textarea 拿焦点前抓快照）；输入框上方渲染「引用预览条」（笔记名 + 行范围 + 单行摘录 + 关闭按钮），无引用时不占位 |
| `src/view/native/native-chat-root.tsx` | 持有 `pendingQuote` 状态；`send()` 里：有引用且草稿不是 `/` 命令且非只读 → `formatQuote` 后前置；成功后清空预览、刷新快照、按拍板决定是否 `restoreQuoteFocus`；失败保留引用；只读子会话 / slash 命令不加引用 |
| `styles.css` | 新增 `.dsh-native-quote-*` 块（卡片 / 竖线 / 图标 / 行范围 / 摘录两行截断 / hover 与 focus-visible），颜色与尺寸走主题变量；不改现有气泡规则 |
| `docs/roadmap.md`、`docs/changes/README.md` | R-41 登记与 0058 索引 |
| `docs/development.md`、`docs/architecture.md` | 实施后补改动地图、回归清单、数据流说明 |

不改 `packages/dsh-obsidian-bridge`、不改 `src/service`、不改设置 `schema.ts`（除非拍板要开关）。

## 5. 行为变化

- 在编辑区选中一段文字 → 点右栏输入框：输入框上方出现引用预览条（笔记名 + 行范围 + 摘录一行 + 关闭按钮）。
- Enter / 发送按钮发送时：消息文本自动前置引用块（模型能读到路径、行范围、选中原文），正文不变。
- 发送后气泡里：引用块渲染成微信式引用卡（不是 Markdown blockquote），正文仍按 Markdown 渲染；点击引用卡 → 主区打开该笔记、选中原范围并聚焦（原生选区高亮可见）。
- 发送带引用的消息成功后：按拍板 **R2 不自动切回编辑区**（留在输入框方便连发）；点引用卡时才把焦点交给笔记。不带引用、只读子会话、`/` 命令、草稿为空时不改变今天的行为。
- 引用解析失败（用户自己写了一个类似的 blockquote、旧消息、别的客户端发的消息）→ 按普通 Markdown 渲染，不出现引用卡。
- 笔记后来被编辑导致行号漂移 → 跳转按摘录搜索兜底；找不到就打开笔记并定位到 clamp 后的行，不报错。
- 官方桌面 GUI / 其它客户端：用户消息正文里会看到引用块 Markdown（A 路径的选择，可接受；B 路径会额外露出注释原文）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 引用块与用户自己写的 blockquote 混淆 | 极少数消息被误识别成引用卡 | 解析要求首行精确匹配「引用自 [[…]] · 第 N 行 a–b 字」；不匹配就按原文渲染 |
| 笔记后续编辑导致行/列漂移 | 跳转位置偏 | 行列 clamp + 摘录搜索兜底；只影响定位精度，不阻塞 |
| 选区很长（超 2000 字 / 很多行） | 模型上下文变大 | 摘录设上限（默认 2000 字，带「已截断，共 N 字」），完整范围仍用行列记录；拍板可调 |
| 桥 `sanitize` 的 `MAX_STRING=20000` 截断 | 超长消息被截断，标记丢失 | 引用块始终放在最前；摘录上限远小于 20000 |
| 草稿以 `/` 开头 | 加引用会破坏 dsh 的命令判定（要求单 text block 且以 / 开头） | 该情况不加引用（与今天一致） |
| 只读子会话（one-shot / unknown / 父不可用） | 不能发消息 | 不显示预览条、不加引用（现有只读逻辑不变） |
| 发送后强制归还焦点 | 想连续发多条消息要多点一次输入框 | 拍板默认行为；可改成只在带引用时归还 / 不归还 |
| 跳转时强制切 source 模式 | 预览阅读模式被打断 | 仅当目标是 preview 模式才切换，失败则只打开笔记 |
| `[[路径\|名字]]` 遇到路径含 \`]\` / \`|\` 等字符 | 双链语法坏掉 | 解析前检查；不安全时首行退回纯文本路径 |
| 官方桌面 GUI 显示引用块 Markdown | 跨客户端观感不一致 | A 路径只多几行可读文本；不采用 B 的注释方案 |

整体回滚：revert 新增/改动的文件 → `npm run build`；不涉及桥与存储，无数据迁移。已发送的历史消息保留引用块文本，删掉组件后会按普通 Markdown 显示，不会坏。

## 7. 验证

自动化：

```bash
npm run build        # tsc -noEmit -skipLibCheck + esbuild
npm run check        # 版本 / 依赖 / manifest / 类型 / main.js 与源码一致
# quote.ts 纯函数冒烟（esbuild 打包到 /tmp 后用 node 跑断言，覆盖 ≥ 10 例）
```

手动 / CDP 回归（Obsidian 内）：

1. 主区打开一篇 md（source / live preview），选中 2~3 行中的一段 → 点右栏输入框：出现引用预览条（笔记名 / 行范围正确 / 摘录一行），× 可关闭。
2. 发一条消息 → dsh 侧用户消息文本以 `> 引用自 [[…]]` 开头；气泡里引用卡不是普通 blockquote（无 > 缩进、有竖线与卡片底），正文正常 Markdown。
3. 点引用卡 → 主区打开/切到该笔记，滚动到选中位置，原选区**高亮可见**，焦点在编辑区；面板仍留在右栏。
4. 刷新面板 / 重开 Obsidian / 重启服务后再点同一条引用：仍能跳回（历史可回放）。
5. 不选文字直接发送 / 选中文稿后发送 `/compact` / 只读子会话发送 → 不出现引用条、不加引用，行为与今天一致。
6. 选区跨多行、含空行、含 `[[` 或 `|` 的笔记路径、超长选区（> 2000 字）→ 引用块可解析、跳转可用、截断标记正确。
7. 发送后焦点行为符合拍板结果；连续发送两条不带引用的消息不受影响。

**验收标准**：

- 选中文字后发送，消息文本确实带上「笔记路径 + 行范围 + 选中原文」，模型可见；
- 气泡内引用卡由原生组件渲染（不是 Markdown blockquote），点击能跳回并让选区高亮可见；
- 刷新 / 重启后历史消息的引用仍可点击跳转；
- 无选区 / 只读 / `/` 命令路径不改变现有行为；
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致。

## 8. 需要你拍板

- [x] **实现路径**：**A**（文本内联引用块 + 原生引用卡）。2026-10-28 用户选定。
- [x] **焦点策略**：**F1**（快照 + 预览条）。2026-10-28 用户选定；不启用 F2。
- [x] **发送后焦点**：**R2** —— 不自动切回编辑区（留在输入框方便连发）；用户点引用卡时再聚焦笔记。2026-10-28 用户选定。
- [x] **引用内容**：只带「笔记路径 + 选中原文」，不附整篇正文。2026-10-28 用户选定。
- [x] **摘录上限**：默认 2000 字，**可在设置页「聊天」tab 修改**（100–20000）。2026-10-28 用户选定。
- [x] **面板空白区域点击不抢焦点**：要（不阻断时间线/消息正文的文本选择与复制）。2026-10-28 用户选定。

## 9. 实施记录

**落地（2026-10-28，路径 A + F1；用户拍板：R2 / 只带路径 + 选中原文 / 摘录上限默认 2000 可在设置改 / 空白点击不抢焦点）**

| 文件 | 实际改动 |
|---|---|
| `src/view/native/quote.ts`（新增） | 引用块编解码纯函数：`formatQuote` / `parseQuote` / `quoteExcerpt` / `quoteKey` / `quoteLineLabel`；路径含 `|` / `]` 时回退笔记名；截断标记「…（已截断，共 N 字）」。 |
| `src/view/native/editor-selection.ts`（新增） | `captureSelectionQuote()`：官方 `workspace.getMostRecentLeaf()` → `MarkdownView`（source 模式）→ `getSelection/getCursor`；`jumpToQuote()`：复用已开 leaf / `openLinkText(path, sourcePath, true)` 开主区新标签 → 必要时切 source → `setSelection + scrollIntoView + focus`；行号漂移时按摘录搜索兜底。 |
| `src/view/native/ui/quote-card.tsx`（新增） | 微信式引用卡：竖线 + 笔记图标 + 笔记名 + 行范围 + 两行摘录；`role="button"` + Enter / Space 可跳转。 |
| `src/view/native/ui/quote-preview.tsx`（新增） | 输入框上方引用预览条：笔记名 + 行范围 + 单行摘录 + ×。 |
| `src/view/native/ui/timeline-nodes.tsx` | `UserMessage` 先 `parseQuote`：命中 → 引用卡 + 正文 `MarkdownText`；未命中按原逻辑（旧消息 / 普通 blockquote 不受影响）。 |
| `src/view/native/ui/composer.tsx` | 输入卡 `onMouseDownCapture` + textarea `onFocus` 抓选区快照；预览条渲染在输入卡上方；新增 `quote` / `quoteLimit` / `onCaptureQuote` / `onClearQuote`。 |
| `src/view/native/ui/native-chat-root.tsx` | `pendingQuote` 状态 + `dismissedQuoteRef`（× 后同一选区不再自动带回；切会话清空）；`send()` 在草稿不以 `/` 开头时前置引用块，发送成功后清预览、记 dismissed（R2：不切回焦点）；面板空白 `onMouseDownCapture` 阻止默认（排除时间线 / 输入框 / 可交互元素）。 |
| `src/settings/schema.ts` | 新增 `quoteExcerptLimit`（默认 2000，范围 100–20000）+ `quoteExcerptLimitOf()` 归一化并并入 `mergeSettings`。 |
| `src/settings/sections/chat.ts` | 「聊天」tab 新增「选区引用摘录上限」数字输入（越界不写入）。 |
| `src/view/panel-host.ts` / `src/main.ts` / `src/view/native/native-chat-view.tsx` | 新增宿主能力 `getQuoteExcerptLimit()` 并传入 React 根。 |
| `styles.css` | `.dsh-native-quote-card*`（卡片 / 竖线 / 摘录两行截断 / hover / focus-visible）与 `.dsh-native-quote-preview*`（预览条 / ×），全部走主题变量。 |
| `docs/` | roadmap R-41、changes 索引、development 改动地图 / 回归清单、architecture 关注点与设置表、README 使用说明。 |

**与提案的偏差**

- 按用户拍板采用 **R2**（发送后不自动归还焦点），提案第 5 节原默认 R1 的描述以此为准。
- 「面板空白点击不抢焦点」落成「只拦截非交互且非时间线区域」，避免破坏消息正文的文本选择与复制。
- 设置项 `quoteExcerptLimit` 是用户追加要求（提案原为固定 2000 字），落在「聊天」tab。

**验证结果（2026-10-28）**

- `npm run build` / `npm run check` 通过；`npm run lint` 0 error（32 条既有 warning，未新增 error）。
- 11 项纯函数冒烟全过：单行 / 跨行 + 空行往返、正文保留 Markdown 与 `>` 行、截断标记与 `truncatedTotal`、未截断无标记、路径含 `|` 回退、三类误判拒绝、只有引用块、`quoteKey` 随范围变化、行标签、`quoteExcerpt` 边界。
- CDP 端到端（Obsidian 1.14.5）：
  - 编辑区选中 20 字 → 点输入框：输入框上方出现预览条（`引用 关于输入方式的优化 · 第 5 行` + 摘录）；
  - 发送后气泡出现引用卡（名称 / 行范围 / 摘录，`role=button`），气泡内 `blockquote` 数为 0、正文 Markdown 正常 —— 说明引用块经发送 → dsh 落库 → 快照回显后仍能被解析（不是本地状态）；
  - 点引用卡：`activeEditor` 回到笔记、`cm-focused=1`、选中原 20 字、`window.getSelection()` 非空；关掉笔记标签后再点 → 主区重新打开并定位，面板不关闭；
  - 点 ×：预览消失；失焦再点回同一选区不自动带回；改选区后重新出现；
  - 面板空白处真实点击（CDP Input.dispatchMouseEvent）：编辑区焦点与选区保持（`cm-focused=1`）；消息流区域不拦截（保留文本选择 / 复制）；
  - 设置 →「聊天」出现「选区引用摘录上限」（默认 2000、范围 100–20000），改值写入设置且 `getQuoteExcerptLimit()` 跟随。
- 已知未覆盖：官方桌面 GUI 观感（其它客户端把引用块按普通 Markdown 显示）；超长选区真实发送（纯函数冒烟已覆盖截断）；阅读模式下不给引用（`getMode() !== 'source'` 直接不捕获），与预期一致。

**追补（R-42 / [0059](0059-live-selection-preview.md)，2026-10-28）**：预览改为实时跟踪编辑区选区（`observeEditorSelection`：`selectionchange` + `active-leaf-change` / `file-open`，80ms 防抖 + `quoteKey` 去重），不再等点击输入框；`applyQuote` 统一处理「× 后同一选区隐藏 / 选区变化或清空后恢复」；切换会话不再清空预览（预览只反映编辑区状态）。
