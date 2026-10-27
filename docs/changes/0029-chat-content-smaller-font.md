---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户当轮明确要求「稍微调小一点聊天内容的字体大小」，视为已批准
scope: styles.css
issue: 聊天正文字号偏大：消息正文（用户气泡 + 助手输出）在 432px 窄栏里长回复显得密，整体小一档更耐读
---

# 0029 聊天正文字号稍微调小

## 1. 背景与问题

用户反馈：「稍微调小一点聊天内容的字体大小」。

CDP 实测（Obsidian 1.14.5，原生面板宽 432px，默认主题）：

| 元素 | 计算字号 / 行高 | 来源 |
|---|---|---|
| `body` | 15px / 19.5px | Obsidian 应用基准字号（`--font-text-size` 是 16px，但面板不吃它） |
| `.dsh-native-app` / `.dsh-native-timeline` / `.dsh-native-message` | 15px / 19.5px | 从 `body` 继承 |
| `.dsh-native-markdown`（消息正文） | 15px / 24.75px | 继承 15px + [0014](0014-native-chat-typography.md) 的 `line-height: 1.65` |
| `.dsh-native-markdown :not(pre) > code`（行内码） | 13.125px | 主题给 `code` 的 0.875em |
| `.dsh-native-markdown pre`（代码块） | 12px / 19.2px | [0014](0014-native-chat-typography.md) 固定值 |

也就是说：聊天正文与面板其它 UI（标题、过程行）都锚在 15px，窄栏里长回复偏「满」。[0014](0014-native-chat-typography.md) 当时明确「不改基准字号」，这次只把**消息正文**降一档。

## 2. 目标与非目标

- 目标：聊天正文（用户消息气泡 + 助手输出，含流式期间的纯文本）字号比继承基准小 1px（15px → 14px），行高跟随比例到约 23.1px；流式与收尾后字号一致，不出现「收尾时字突然变大 / 变小」。
- 非目标：
  - 不改标题、列表、块间距等 0014 已定稿的排版；
  - 不改代码块（仍 12px）、行内码随正文等比缩小到约 12.25px（这是继承结果，不是单独调整）；
  - 不改过程行（思考 / 工具）、命令卡片、标签、输入框字号；
  - 不新增设置项（见路径 D）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| A（采纳） | [styles.css](../../styles.css) 给 `.dsh-native-markdown, .dsh-native-live-text` 加 `font-size: calc(1em - 1px)` | 1 条 CSS | `1em` 取父级（15px）→ 14px，跟随 Obsidian 字号 / 主题缩放；两个消息正文渲染器（Markdown 与流式纯文本）同一字号。风险：某些主题把 `body` 改得很小时，再减 1px 的占比略大（可接受） | **推荐**：最小、可逆、跟随主题 |
| B | 把字号设在消息容器 `.dsh-native-message` 上，正文继承 | 1 条 CSS | 现在效果同 A，且未来消息内新增内容自动继承；但未来若把非正文内容（卡片 / 按钮）塞进消息容器会一并缩小，作用面偏大 | 备选：将来消息内元素变多时可换成它 |
| C | 直接写 `font-size: 14px` | 1 条 CSS | 最直观；但不随 Obsidian 字号设置 / 主题缩放，违背本仓库「样式用主题变量」的偏好（AGENTS 规则 7） | 不推荐：硬编码尺寸 |
| D | 在设置页「聊天」tab 加「正文字号」档位（小 / 默认 / 大） | schema + 设置 section + CSS 变量 + 文档，约 4 个文件 | 用户可自选；但本次需求是「默认值稍微小一点」，加设置项属于范围膨胀，且 0014 已说明字号跟随主题 | 不推荐：超出本次范围；将来真需要再加 |

> 本次用户已明确指定要改的具体项，按 AGENTS 规则 12 的例外直接执行并补提案记录；上表保留路径对比，便于以后回溯为什么不是设置项。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [styles.css](../../styles.css) | 新增 `.dsh-native-markdown, .dsh-native-live-text { font-size: calc(1em - 1px); }` 及说明注释（0029） |
| `docs/changes/0029-chat-content-smaller-font.md` | 本提案 |
| [docs/changes/README.md](README.md) | 索引登记 |
| [docs/roadmap.md](../roadmap.md) | 「需求待办」加 R-12 行 |

## 5. 行为变化

- 消息正文（用户气泡文字 + 助手输出）字号 15px → 14px，行高 24.75px → 23.1px；
- 正文里的行内码 13.125px → 12.25px（等比，且更接近 DSH Web 的 12.25px）；代码块保持 12px；
- 流式纯文本与收尾后的 Markdown 同字号，收尾不跳字；
- 标题、列表间距、过程行、输入框、菜单等不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 主题把 `body` 字号调得很小（如 13px）时，正文变 12px 偏小 | 可读性 | 改成固定 `14px`（路径 C）或按主题另调 |
| 用户希望改的是助手输出以外的区域 | 观感 | 把选择器收窄到 `.dsh-native-message.is-assistant .dsh-native-markdown` 等 |
| 整体回滚 | — | 删除该 CSS 规则并重载插件 |

## 7. 验证

自动化：

- `npm run check` 通过（纯 CSS，`main.js` 不变）。

CDP（Obsidian 1.14.5，实时面板，把新规则热注入现有时取样）：

- `.dsh-native-markdown` 计算字号 14px、行高 23.1px；
- `.dsh-native-markdown :not(pre) > code` 12.25px；
- `.dsh-native-markdown pre` 仍 12px / 19.2px；
- 面板截图与大字号版本对比，长回复观感更收。

**验收标准**：以上 4 条全部成立，且 `npm run check` 无错误。

## 8. 需要你拍板

- [x] 调小范围：用户已指定「聊天内容」，按消息正文（用户气泡 + 助手输出）处理。
- [x] 调小幅度：取「小 1px」（15 → 14），符合「稍微」；如还想更小可把 `1px` 改成 `2px`。

## 9. 实施记录

实施日期：2026-10-27（用户当轮明确要求调小，按 AGENTS 规则 12 例外直接执行）。

实际改动：

- [styles.css](../../styles.css) 在 `.dsh-native-live-text` 之后新增：

  ```css
  .dsh-native-markdown,
  .dsh-native-live-text {
      font-size: calc(1em - 1px);
  }
  ```

- 未改 TS/TSX，未改设置项；`main.js` 应保持不变。

验证结果（Obsidian 1.14.5，CDP 热注入同一条规则后取样）：

- `.dsh-native-markdown`：`font-size 14px`、`line-height 23.1px`（改前 15px / 24.75px）；
- 行内码：`12.25px`（改前 13.125px）；
- 代码块：`12px / 19.2px` 不变；
- 截图对比：长回复的正文明显收一档，气泡与正文仍对齐，列表 / 代码块结构正常；
- `npm run check` 通过。

与提案的偏差：无。生效方式：重载插件（CSS 随插件加载）。
