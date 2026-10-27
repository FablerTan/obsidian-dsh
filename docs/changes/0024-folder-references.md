---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: src/view/native, styles.css, docs
issue: 文件夹引用：Enter 采纳（@文件夹）、Tab / 箭头下钻；消息里的 @文件夹 渲染成可点击 chip，点击在左侧文件列表展开并选中
---

# 0024 文件夹引用：Enter 采纳 / Tab 下钻 + 可点击的文件夹 chip

## 1. 背景与问题

1. [0023](0023-at-file-mentions.md) 的 @ 菜单里，Enter 和 Tab 都做了同一件事：选目录 → 写入 `@目录/` 并继续展开。
   dsh 的真实语义是**两个动作**（源码 `packages/client/ui-input-trigger/src/types.ts` 的 `PickAction`）：
   - **Enter（settling pick）**：把目录本身作为最终引用采纳；
   - **Tab / 行内箭头 / 面包屑（drill）**：只下钻，保留可继续输入的 `@目录/` 文本并保持菜单打开。
   这与用户的手感不一致：选文件夹时按 Enter 应该得到 `@文件夹`，Tab 才进入子级。
2. 发送后的 `@文件夹/` 只是纯文本：`note-links.ts` 的 resolver 只认 Markdown 文件，文件夹会被原样留下。
   用户希望它有「额外渲染」，点一下就能在左侧文件列表里展开并选中对应文件夹，而不是自己去文件树里找。

### dsh 参考

- 目录行有两个动作：settling pick 和 drill；drill 的快捷键是 **Tab**，行上还有一个箭头（`drill.key` / `drill.hint` 文案）。
- 发送后的用户正文里，文件夹引用渲染成 `ReferenceChip appearance="folder"`（文件夹图标 + `名字/`，dsh 里只展示、不可点）。

## 2. 目标与非目标

### 目标

1. @ 菜单里目录行：
   - **Enter / 鼠标点行** = 采纳：写入完整目录引用（`@目录/`；含空格时补上右引号 `@"目录/"`），补一个空格并关闭菜单。
   - **Tab / 行内箭头** = 下钻：写入 `@目录/`（含空格保持打开引号），菜单继续展开该目录。
   - 文件行：Enter / Tab / 鼠标点击都是采纳（不变）。
2. 消息里的 `@文件夹/`（含 `@"含 空格 的文件夹/"`）渲染成可点击 chip：文件夹图标 + `名字/`，主题强调色；悬停有底色，键盘可聚焦。
3. 点击 chip：展开左侧栏 → 在文件列表里展开该文件夹（含祖先）→ 选中并滚动到可见；文件列表没打开时先用 `file-explorer:open` 打开再定位。
4. 文件引用（`@笔记.md` → `[[短链]]`）与代码块 / 邮箱 / 已有双链的保护逻辑不变。

### 非目标

- 不把文件夹 chip 做成 dsh 的原子引用（仍是发送文本里的 `@路径/`）。
- 不在 chip 上做悬停预览 / 右键菜单 / 拖拽。
- 不改 bridge、不重启服务、不加设置项。
- 不修改 dsh 侧的 ReferenceChip。

## 3. 实现路径调研

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 菜单分离 pick / drill；消息渲染走「文本 → 内联 HTML chip」+ 事件委托：`note-links.ts` 把带结尾斜杠的 @token 换成 `<span class="dsh-folder-ref" data-dsh-folder="路径">…</span>`，`markdown-text.tsx` 拦截点击/Enter；新增 `folder-reveal.ts` 用文件列表视图的内部 API（`fileItems` / `tree.selectItem` / `revealInFolder`）展开选中 | composer、mention-menu、note-links、markdown-text、新增 folder-reveal、styles | 文件列表 API 非公开，需要按存在性调用 + `file-explorer:open` 兜底；内联 HTML 依赖 MarkdownRenderer 保留 span/SVG（已实测）；排序/grammar 不变 | **推荐** |
| B | 生成自定义协议链接 `[📁 名字/](dsh-folder:路径)`，拦截 `a[href^="dsh-folder:"]` 的点击 | note-links + markdown-text + styles | 实测渲染器会保留 href，但会加 `external-link` 类和外链图标/悬停行为，需要覆盖；复制/导出时会带出伪链接文本；语义上也不是文档链接 | 不推荐 |
| C | 渲染后遍历 DOM 文本节点，把文件夹引用包成 chip | markdown-text + 新装饰函数 | `note-links` 保持纯文本，但要在渲染后再遍历一次 DOM、重复实现 grammar，流式重渲染成本更高，难做纯函数测试 | 不推荐 |
| D | 只用官方 API：`openLinkText` / `file-explorer:reveal-active-file` | — | 官方没有「定位任意文件夹」的入口，reveal-active-file 只认当前文件；不满足需求 | 不满足 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/mention.ts` | 新增 `completeMention()`：目录被采纳时补上 drill 语义故意留空的右引号 |
| `src/view/native/ui/composer.tsx` | `pick(item, 'pick' \| 'drill')`；Enter / 鼠标行 = pick，Tab / 箭头 = drill；目录采纳补空格并关闭，含空格路径补右引号 |
| `src/view/native/ui/mention-menu.tsx` | 目录行末尾加「进入目录（Tab）」箭头（`onDrill`），行点击仍是采纳 |
| `src/view/native/note-links.ts` | resolver 目标改为 file / folder 联合类型；带结尾斜杠的 @token 渲染成 `dsh-folder-ref` 内联 HTML（含文件夹 SVG、HTML 转义） |
| `src/view/native/folder-reveal.ts` | 新增 `revealFolderInExplorer()`：展开左侧栏、展开祖先与自身、`tree.selectItem` 选中、`revealInFolder` 滚动/闪烁；无视图时用 `file-explorer:open` 打开后重试 |
| `src/view/native/ui/markdown-text.tsx` | resolver 支持文件夹；点击 / Enter / Space 激活 `.dsh-folder-ref` |
| `styles.css` | `.dsh-folder-ref`（强调色、悬停底色、焦点环、图标尺寸）与 `.dsh-native-mention-drill` |
| `docs/changes/0023-at-file-mentions.md` | 追加变更记录，指向本提案 |
| `docs/roadmap.md` / `docs/changes/README.md` / `docs/development.md` / `docs/architecture.md` | R-7、索引、改动地图与回归清单 |

## 5. 行为变化

- 目录行：Enter / 鼠标点行 → `@目录/`（含空格 `@"目录/"`）+ 空格，菜单关闭；Tab / 箭头 → `@目录/`（含空格 `@"目录/` 保持打开），菜单继续展开子级。
- 消息里的文件夹引用从纯文本变成强调色 chip（文件夹图标 + `名字/`）；点击会在左侧文件列表里展开、选中并滚动到该文件夹。
- 文件引用、代码块保护、邮箱跳过、已有 `[[…]]` 跳过均不变。
- 无新设置项、无命令、无桥变化。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 文件列表视图内部 API 变动（`fileItems` / `tree.selectItem` / `revealInFolder`） | 点击 chip 不展开/不选中 | 所有调用都做 typeof 守卫；失败时至少用 `file-explorer:open` 打开文件列表。可整体回退到「只打开文件列表」的保守实现 |
| 文件列表未创建（左侧栏换成别的视图） | 首次点击可能只打开文件列表、不定位 | 打开后 60ms 重试一次；仍失败则用户再点一次 |
| 内联 HTML 被 MarkdownRenderer 清洗 | chip 退化成纯文本或属性丢失 | 已实测 span / SVG / data 属性均保留；若主题或版本变化导致丢失，可改走路径 C（渲染后 DOM 装饰） |
| 文件引用转换误伤普通文本 | 少量 `@…/` 被当文件夹 | 只有 vault 里真实存在的 TFolder 且 token 带结尾斜杠才转换；其余保留原文 |
| 目录采纳后补右引号影响 drill | Tab 仍保留打开引号，不受影响 | `completeMention` 只在 settling pick 调用 |
| chip 的 tabindex 增加 Tab 停靠点 | 键盘用户多几个焦点 | 保留（可键盘激活）；如不需要可去掉 tabindex |

## 7. 验证

自动化：

```bash
npm run build
npm run check
# note-links 纯函数冒烟（不启动 Obsidian）
./node_modules/.bin/esbuild src/view/native/note-links.ts --bundle --platform=node --format=esm --outfile=/tmp/note-links.mjs
# mention 纯函数冒烟（completeMention）
./node_modules/.bin/esbuild src/view/native/mention.ts --bundle --platform=node --format=esm --outfile=/tmp/mention.mjs
```

手动 / CDP：

1. `@` → 目录行显示「进入目录」箭头；Enter / 鼠标点行 → 草稿 `@目录/ `、菜单关闭。
2. Tab / 箭头 → 草稿 `@目录/`、菜单继续列出子项。
3. 含空格的文件夹：Enter → `@"目录/" `（完整引号）；Tab → `@"目录/`（引号打开）。
4. 发送含 `@目录/` 的消息 → 气泡里是文件夹图标 + `目录/` 的 chip。
5. 折叠该文件夹后点击 chip → 左侧文件列表展开该文件夹（含祖先）并选中，滚动到可见。
6. 文件引用 `@笔记.md` 仍是可点击短链；代码块里的 `@目录/` 不变。

验收标准：以上 6 条全部符合，`build` / `check` 通过。

## 8. 拍板结果（2026-10-27）

> 用户当轮明确指定了改动项（Enter=@文件夹、Tab=进入子级、文件夹 chip 点击在左侧展开选中），按 [AGENTS.md](../../AGENTS.md) 规则 12 例外视为已批准；实现路径取推荐 A。

- [x] 路径 A：内联 HTML chip + 文件列表内部 API（带守卫与兜底）
- [x] 鼠标点行 = 采纳；目录行末尾箭头 = 下钻（与 dsh 的两个动作一致）
- [x] chip 可点击、可键盘激活；dsh 的文件夹 chip 本身不可点，这里按需求增强
- [x] 不做原子引用、不改 bridge

## 9. 实施记录（2026-10-27）

### 实际改动

- `src/view/native/mention.ts`：`completeMention()`（`@"dir/` → `@"dir/"`；普通 `@dir/` 不变）。
- `src/view/native/ui/composer.tsx`：`pick(item, mode)`；Enter / 鼠标 = `pick`，Tab / 箭头 = `drill`；目录采纳后补空格并关菜单，drill 保持菜单。
- `src/view/native/ui/mention-menu.tsx`：目录行渲染 `.dsh-native-mention-drill` 箭头（title「进入目录（Tab）」），mousedown 阻止冒泡后调用 `onDrill`。
- `src/view/native/note-links.ts`：`NoteLinkTarget` 拆成 `FileLinkTarget` / `FolderLinkTarget`；新增 `folderChipOf()` 与 HTML 转义；带结尾斜杠且 resolver 命中 TFolder 的 token 渲染成 `<span class="dsh-folder-ref" data-dsh-folder="…" role="button" tabindex="0">SVG + 名字/</span>`。
- `src/view/native/folder-reveal.ts`（新增）：展开左侧栏；`fileItems[path]` 逐级 `setCollapsed(false)`（含祖先）；`revealInFolder` 滚动/闪烁；`tree.selectItem` 选中；视图缺失时先跑 `file-explorer:open` 再重试。
- `src/view/native/ui/markdown-text.tsx`：resolver 识别 TFolder；点击 / Enter / Space 激活 `.dsh-folder-ref` 并调用 reveal。
- `styles.css`：`.dsh-folder-ref`（`--text-accent`、悬停底色、焦点环、1em 图标）与 `.dsh-native-mention-drill`。
- 文档：roadmap R-7、changes 索引、development 改动地图 / 回归清单、architecture UI 组成、0023 变更记录。

### 验证

- `npm run build` / `npm run check` 通过。
- 纯函数冒烟：folder chip（`@模板/`、`@"My Folder/"`）、标点回填（`@模板/，然后`）、HTML 转义（`A&B`）、无斜杠不转换、行内代码 / 围栏代码 / `[[…]]` / 邮箱不转换；`completeMention` 对带空格目录补齐右引号、普通目录与文件不变。
- CDP 实测（Obsidian 1.14.5，`<vault>`）：
  - Enter 于「日记/」→ 草稿 `@日记/ `、菜单关闭；
  - Tab 于「日记/」→ `@日记/`、菜单继续列出 `2026-10-14.md`；
  - 点「模板/」行末箭头 → `@模板/`、菜单列出 `日记模板.md`；菜单里恰有 2 个目录箭头（日记/、模板/）；
  - 发送「测试文件夹引用 @日记/ 谢谢」→ 气泡内 `<span class="dsh-folder-ref" role="button" data-dsh-folder="日记">`（文件夹图标 + `日记/`）；
  - 折叠「日记」后点击该 chip → `collapsed=false`、标题 `is-selected`、滚动到可见；左侧栏先 `collapse()` 再点击 → `is-sidedock-collapsed` 被清掉并重新展开；
  - 鼠标点目录行 → `@日记/ ` 且菜单关闭；鼠标点文件行（含空格）→ `@"Board Forge.md" ` 且菜单关闭；
  - 文件引用 `@AGENTS.md` 仍渲染为内部链接（未回归）；重载后控制台无 React 警告 / 新增错误。
- 说明：点击 chip 走的是文件列表视图的内部 API（Obsidian 无公开替代），已做守卫与 `file-explorer:open` 兜底；流式期间仍是纯文本，settle 后出现 chip（与现有 Markdown 渲染时机一致）。

### 与提案的偏差

- 无实质偏差；chip 图标用内联 SVG（Obsidian 的 Lucide folder），颜色走 `currentColor`。
