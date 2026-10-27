---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: src/view/native/ui, styles.css
issue: 原生聊天栏视觉收敛：标题去药丸、新会话默认名、当前笔记浮标、输入框加高去灰环、输入区悬浮与整块高亮
---

# 0013 原生聊天栏视觉收敛（标题 / 新会话名称 / 当前笔记 / 输入框）

## 1. 背景与问题

用户对原生聊天面板提出三组视觉调整：

1. 顶部会话标题一直带一块深灰「药丸」底，和面板背景割裂，字号也偏大；新建会话时标题直接显示工作目录名（本机是 vault 目录名），希望统一叫「新会话」。
2. 输入框上方的「当前笔记」是一条占满宽度的横幅（图标 + 「当前笔记」+ 名称 + ×），存在感太强；希望只保留一条悬浮的小字：笔记名 + 关闭按钮，字号约为正文的一半。
3. 聊天输入框只有 28px 高，写多行字很局促；聚焦时输入框上还会叠一圈 Obsidian 全局 `textarea:focus` 的灰色 box-shadow，和外层强调色边框重复。
4. 输入区上方有一条 `border-top` 分隔线，和聊天内容区生硬割裂；希望输入框看起来是悬浮在内容区上方的一块卡片。
5. 鼠标移到输入区时，只有 textarea 上半截变成 hover 底色；底部的模型、权限、发送按钮各自带一块灰色药丸底，看起来像一排便签按钮，而不是同一个输入块。

用 CDP 检查真实面板确认了原因：

- 标题的 `background: transparent` 被 Obsidian 全局 `button:not(.clickable-icon)`（`app.css`，specificity 0,1,1）压过，实际背景是 `var(--interactive-normal)`。
- 输入框内层灰环来自全局 `textarea:focus / :active` 的 `box-shadow: 0 0 0 2px var(--background-modifier-border-focus)`；插件里的 `.dsh-native-input { box-shadow: none }` specificity 不够。
- 「只有上半截高亮」来自全局 `@media (hover:hover)` 里的 `textarea:where(:not(:disabled)):hover`：它给 textarea 单独刷 `--background-modifier-form-field-hover`（0,1,1），压过插件的透明背景。
- 底部按钮的透明/强调色底同样被全局 `button:not(.clickable-icon)` 覆盖成 `--interactive-normal`（灰色），所以模型、权限、发送看起来是独立药丸。
- 新会话标题由 DSH 侧用 cwd 目录名兜底，桥的 `createSession` 不接收标题。

## 2. 目标与非目标

- 目标：
  - 标题与面板背景融为一体（不吃全局按钮底色），字号收紧。
  - 新建会话在面板与会话列表里显示为「新会话」，不再显示仓库名。
  - 当前笔记只保留一行小字浮标（名称 + ×），无整条横幅、无图标、无标签。
  - 输入框默认更高，聚焦时不再出现内层灰色焦点环。
  - 去掉输入区顶部分隔线，让输入卡片以阴影悬浮在内容区上方。
  - hover 时高亮整个输入卡片（正文 + 模型/权限/发送），聚焦后不再保留背景高亮（只留强调色边框）；底部控件不再各带灰色药丸底。
- 非目标：
  - 不改 DSH 桥协议、不重启/重新 link `packages/dsh-obsidian-bridge`。
  - 不改消息气泡、审批卡片等其它控件；底部控件只调底色与 hover 归属，不改菜单/发送交互。
  - 不做主题适配分支；继续只用 Obsidian 主题变量。

## 3. 方案

### 标题

- 选择器改为 `.dsh-native-app .dsh-native-title`（specificity 0,2,0），显式 `background: transparent` / `background-color: transparent`，压过全局按钮规则。
- `font-size` 从 `var(--font-ui-medium)`（15px）降到 `var(--font-ui-small)`（13px），`font-weight` 600 → 500，`padding` 4/6 → 2/4，`height: auto`，高度由 30px 收到约 20px。
- 保留 hover 底色作为可点击反馈。

### 新会话名称

- `createSession()` 成功后在桥侧调用 `renameSession('新会话')`，失败不阻塞建会话（标题只是展示信息）。
- 新增 `sessionTitle()`：若会话仍是 `blank` 且 title 等于 cwd 目录名，则展示为「新会话」。用于覆盖重命名失败与历史遗留的空白会话。
- 会话列表与空态「最近会话」在写入 state 前统一映射；头部标题仍以 `snapshot.title` 为准，保证首条消息触发的自动标题能即时反映。

### 当前笔记浮标

- 去掉 `file-text` 图标与「当前笔记」label，保留名称按钮 + ×。
- 容器改为右对齐、`width: fit-content`、透明背景、2px 上边距；字号 `calc(var(--font-ui-smaller) * 0.75)`（9px），× 图标 `size={9}`。
- 用 `.dsh-native-app .dsh-native-note button` 覆盖全局按钮的固定高度与底色，避免小按钮又被撑成 30px 的灰色药丸。
- 去掉笔记名 hover 的整块底色，只把文字从 `--text-faint` 提到 `--text-muted`。

### 输入框

- CSS `min-height: 72px`、`max-height: 240px`；TSX 同步常量 `INPUT_MIN_HEIGHT = 72` / `INPUT_MAX_HEIGHT = 240`，空输入也有 72px。
- 新增 `.dsh-native-app .dsh-native-input:active/:focus/:focus-visible { box-shadow: none; outline: none; }`，只去掉内层灰环；外层 `.dsh-native-input-shell:focus-within` 的强调色边框保留。

### 输入区悬浮

- `.dsh-native-composer` 去掉 `border-top`，背景改为透明，padding 调整为 `6px 8px 10px`，不再有贯穿面板的分隔线。
- `.dsh-native-input-shell` 增加 `box-shadow: var(--shadow-s)`，配合原有的 1px 边框与圆角，形成浮在内容区上方的卡片感。
- 笔记浮标仍在卡片右上方，和输入卡片一起构成悬浮区域；输入框仍占据底部布局空间，不改时间线的滚动/点击区域。

### 整块高亮与底部控件

- textarea 的 hover/active/focus 统一改为透明背景，不再由全局 textarea 规则单独刷上半截。
- `.dsh-native-input-shell:hover:not(:focus-within)` 使用 `--background-modifier-form-field-hover` 作为整卡底色；`:focus-within` 只切换 `--interactive-accent` 边框，不再保留背景填充。这样鼠标悬停（预选中）时整块高亮，点入后回到正常底色。
- `.dsh-native-chip` 提升为 `.dsh-native-app .dsh-native-chip` 并显式透明底，hover 规则同步提升 specificity；模型/权限 chip 不再有常驻灰底。
- 发送按钮提升为 `.dsh-native-app .dsh-native-send`，恢复 `--interactive-accent` 底与停止态 `--color-red`；禁用时仍保持 0.4 透明。
- 顺带把 `.dsh-native-icon-button` 也提升 specificity，去掉标题栏 + / ... 的全局灰底（同一根因）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/ui/native-chat-root.tsx` | `NEW_SESSION_TITLE`、`sessionTitle()`、建会话后重命名、列表标题映射 |
| `src/view/native/ui/composer.tsx` | 输入框高度常量与自动增高上限；笔记浮标去掉图标/label，× 缩到 9px |
| `styles.css` | 标题透明化/缩小；笔记浮标右对齐小字；输入框加高与焦点灰环移除；输入区去顶线与悬浮阴影；整卡 hover/聚焦高亮与底部控件底色修正 |
| `main.js` | `npm run build` 重新生成 |
| `docs/changes/0013-…md`、`docs/changes/README.md` | 本提案与索引 |

## 5. 行为变化

- 标题不再有常驻深灰底，字号从 15px 降到 13px，垂直占用从 30px 降到约 20px。
- 新建会话标题与会话列表显示「新会话」；历史空白会话若标题仍是仓库名，打开列表时也显示「新会话」。
- 当前笔记变成输入框右上方一行 9px 小字：`笔记名 ×`，无背景条。
- 输入框默认高度 28px → 72px，最多可长到 240px；聚焦时只有外层紫色描边，不再有内层灰色光圈。
- 输入区上方不再有横线分隔；输入卡片带主题阴影，视觉上浮在消息内容上方。
- 鼠标悬停且未选中时，整块输入卡片（正文 + 底部控件）一起变亮；点入输入框后背景高亮消失，只保留强调色边框。
- 模型/权限 chip 变为透明底，发送按钮恢复强调色圆形；它们看起来贴在同一个长方形输入卡片底部。
- 标题栏的 + / ... 也顺带去掉全局灰底（同一 specificity 问题）。
- 首条消息后若 DSH 自动生成标题，头部会按 snapshot 立即更新（列表标题刷新时更新）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 建会话后多一次 `renameSession` 桥调用 | 新建会话多几十毫秒；失败仅影响标题 | 删除 `createSession` 里的 try/catch 调用即可 |
| 9px 字号在部分缩放比例下偏小 | 笔记名/× 可读性下降 | 调整 `font-size` 的 `0.75` 系数或 `Icon size` |
| 强 specificity 选择器影响其它同类按钮 | 只作用于笔记浮标、输入区 chip/发送、标题栏图标，范围可控 | 回滚对应规则 |
| hover 底色依赖主题的 `--background-modifier-form-field-hover` | 个别主题可能偏亮/偏暗 | 改用 `--background-modifier-hover` |
| 输入框变高挤压时间线 | 面板较矮时消息区变短 | 下调 `min-height` / `max-height` |

整体回滚：`git checkout -- src/view/native/ui/composer.tsx src/view/native/ui/native-chat-root.tsx styles.css && npm run build`。

## 7. 验证

自动化：

- `npm run build`、`npm run check` 通过（main.js 与源码一致）。
- CDP 真实面板探针（重载插件后）：
  - 标题：`font-size: 13px`、`background-color: rgba(0,0,0,0)`、`box-shadow: none`、高度 20px。
  - 新建会话：头部标题为「新会话」，选择器首行为「新会话」。
  - 笔记浮标：`font-size: 9px`、高度约 10.8px、`background: transparent`；× 为 9px。
  - 输入框：空态高度 72px；聚焦后 `box-shadow: none`，shell 仍有 `1px solid rgb(138,92,245)` 强调色边框。
  - 输入区：`.dsh-native-composer` 的 `border-top: 0px none`、背景透明；`.dsh-native-input-shell` 的 `box-shadow` 非 none（`var(--shadow-s)`）。
  - 整块 hover：shell 背景 `rgb(46,46,46)`（`--background-modifier-form-field-hover`），textarea 背景 `rgba(0,0,0,0)`、无 shadow。
  - 整块聚焦：shell 背景回到 `rgb(28,28,28)`、边框 `1px solid rgb(138,92,245)`；模型/权限 chip 背景 `rgba(0,0,0,0)`；发送按钮 `rgb(138,92,245)`（禁用 0.4 opacity）。
  - 标题栏图标按钮：背景 `rgba(0,0,0,0)`，不再有 `rgb(51,51,51)` 灰底。

手动：

1. 重载插件 → 打开面板 → 新建会话：标题与列表都显示「新会话」，标题无药丸底。
2. 切换笔记：右下角出现 `笔记名 ×` 小字；点名称打开笔记，点 × 后不再引用当前笔记。
3. 聚焦输入框：无灰色内圈；输入多行文字时高度增长到 240px 为止。

## 8. 实施记录

- 2026-10-26：按用户当轮明确指定的三项直接实施（视为已批准），无范围偏离。
- 实际改动与第 4 节一致；`npm run build`、`npm run check` 均通过。
- CDP 实测值与第 7 节验收标准一致；新建会话实测标题为「新会话」。
- 2026-10-26 追加（用户指定）：去掉输入区顶部分隔线，`.dsh-native-composer` 透明化，输入 shell 加 `var(--shadow-s)` 阴影，形成悬浮卡片；截图中已确认无横线、卡片阴影可见。
- 2026-10-26 再追加（用户指定）：hover/聚焦高亮从 textarea 上半截扩展到整个 shell；修正全局 `button` / `textarea:hover` 覆盖，让模型/权限 chip 透明、发送按钮恢复强调色，底部控件与正文同属一个长方形卡片。顺带修正标题栏图标按钮的灰底。
- 2026-10-26 再追加（用户指定）：高亮只在未选中的 hover 态出现；`:focus-within` 去掉背景填充，只保留强调色边框，避免点入后一直亮着。
- 生效方式：重载插件（未改桥，不需要重启 dsh 服务）。
