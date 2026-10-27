---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: styles.css, docs
issue: 原生面板的 AI 输出排版拥挤（行距、列表缩进、代码块过大），按 DSH Web 的实测值只修痛点
---

# 0014 原生聊天面板排版：只修痛点

## 1. 背景与问题

原生面板的助手输出直接继承 Obsidian 阅读视图（`.markdown-rendered`）的排版，与官方 DSH Web 消息区的克制版式差异明显。
用 CDP 实测两边（面板 `.dsh-native-markdown`，DSH Web `._markdown_rve47_5`）后的主要差距：

| 项目 | 面板现状 | DSH Web |
|---|---|---|
| 正文行高 | 15px / 22.5px（1.5） | 14px / 24px（1.71） |
| 列表缩进 / 项间距 | 0px / 0px | 18px / 6px |
| 行内代码 | 13.1px，padding 2×4，圆角 4px | 12.25px，padding 0×5，圆角 8px + 0.5px 描边 |
| 代码块 | 15px / 22.5（与正文同号），padding 12×16 | 11px / 19px，padding 6×22×20，圆角 16px |
| 内容留白 | 10px | 46.5px（列宽 680） |

对照样张见本轮会话附件；宽度同为 404px 时，面板的字更大、行更挤、代码块更重。

## 2. 目标与非目标

- 目标：不改变基准字号、不引入代码块顶栏的前提下，把「行距 / 列表 / 行内代码 / 代码块 / 块间距 / 内边距」调到接近 DSH Web 的观感。
- 非目标：
  - 不改基准字号（保持 15px，跟随 Obsidian 主题）；
  - 不做代码块语言/复制顶栏（涉及组件结构，属方案 B）；
  - 不重做标题层级（只收紧标题上下间距，字号仍跟随主题）；
  - 不动用户消息气泡、思考块、工具卡片的结构；
  - 不清理 `turn-process` 这类未知节点裸名（另案）。

## 3. 方案

### 方案 A（采用，用户选定「只修痛点」）

只改 `styles.css` 里 `.dsh-native-markdown` 作用域内的排版声明，显式覆盖主题默认值，避免换主题后回退：

- 行高 1.65（约 24.75px @15px）；
- 标题上下间距 24/12（h4~h6 为 16/8），字号不动；
- 列表 `padding-inline-start: 18px`、`li + li` 间距 6px、嵌套列表 4px、marker 用 `--text-muted`；
- 行内代码：padding `0 5px`、圆角 6px、0.5px 描边、背景 `--background-primary-alt`；
- 代码块：字号 12px、行高 1.6、padding `8px 12px`、圆角 `--radius-s`、背景 `--background-primary-alt`，内部 `code` 继承字号；
- 助手消息内块间距 10px（原来是 2px）；
- 时间线内边距 12/12/16（原 10/10/14）。

### 方案 B（未采用）

完全对齐 DSH Web（14px 基准、代码块顶栏、标题 21/19/18/14、链接无下划线）。用户选择先只修痛点，字号与组件结构保持不变。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `styles.css` | `.dsh-native-markdown` 行高、标题间距、列表、行内代码、代码块；`.dsh-native-message.is-assistant` 间距；`.dsh-native-timeline` 内边距 |
| `docs/changes/0014-native-chat-typography.md` | 本提案 |
| `docs/changes/README.md` | 索引登记 |
| `docs/roadmap.md` | 「最后更新」时间戳 |

## 5. 行为变化

- 面板内所有 markdown（助手输出、用户消息、工具参数外的正文）行距变松、列表有缩进、代码块明显变小变轻。
- 字号、颜色、结构、交互不变；不影响的 Obsidian 其他区域。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 行高 1.65 在用户消息气泡里显得偏松 | 观感问题 | 只回滚该条声明 |
| 代码块 12px 在部分主题下过小 | 可读性 | 调回 13px 或改回继承字号 |
| 覆盖主题样式导致某些用户主题失效 | 该面板内与主题不一致（预期内） | 回滚 `styles.css` 本次改动 |

## 7. 验证

- `npm run build`、`npm run check` 通过；
- 重新加载插件后，用 CDP 读回计算样式确认：markdown 行高 ≈ 1.65、`ul` padding-left 18px、`pre` 12px、`pre code` 12px、`li + li` 6px、助手消息 gap 10px；
- 面板截图人工确认：列表不再贴边、代码块不再压过正文。

## 8. 需要你拍板

- [x] 基准字号：保持 15px（选「只修痛点」即含此意）
- [x] 代码块顶栏：不做
- [x] 是否固定数值：本次改动的属性全部显式固定，标题字号仍跟随主题

## 9. 实施记录

实施日期：2026-10-26（用户在本轮明确选择「只修痛点」并要求继续，据此视为批准）。

改动全部落在 `styles.css` 的 `.dsh-native-markdown` / `.dsh-native-message.is-assistant` / `.dsh-native-timeline`：

- `.dsh-native-markdown`：`line-height: 1.65`（原 `var(--line-height-normal)`）；
- 新增 `.dsh-native-app .dsh-native-markdown :is(h1,h2,h3)` 24/12、`:is(h4,h5,h6)` 16/8 的上下间距（加 `.dsh-native-app` 前缀提高优先级：用户主题给 h1 的 `40px` 上间距优先级更高，不加前缀会覆盖不掉）；
- 新增 `:is(ul,ol)` `padding-inline-start: 18px`、`li + li` 6px、`li > :is(ul,ol)` 4px、`li::marker` 用 `--text-muted`；
- 新增 `:not(pre) > code`：padding `0 5px`、圆角 6px、0.5px 描边、背景 `--background-primary-alt`；
- `pre`：12px / 1.6、padding `8px 12px`、圆角 `--radius-s`、背景 `--background-primary-alt`；新增 `pre code` 继承字号并去掉内边距/背景；
- `.dsh-native-message.is-assistant` `gap: 10px`；
- `.dsh-native-timeline` padding `12px 12px 16px`。

验证结果：

- `npm run check` 通过（版本 / 依赖 / tsc / bridge / main.js 与源码一致）；
- 禁用再启用插件并重开面板后，CDP 读回计算样式：markdown 行高 24.75px（15×1.65）、`ul` padding-left 18px、`li + li` margin-top 6px、行内码 13.125px + 圆角 6px + 0.5px 描边、代码块 12px / 19.2px / padding 8×12、`pre code` 12px 无内边距、助手消息 gap 10px、时间线 padding 12/12/16；
- 面板截图确认：列表有缩进且项间留白、行内路径不再是一大块深色、单行代码块高度从约 90px 降到约 40px。

与提案的偏差：无。
