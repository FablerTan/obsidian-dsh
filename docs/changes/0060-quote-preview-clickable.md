---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确指定：点预览条与点消息内引用效果一致
scope: src/view/native, styles.css
issue: 引用预览条可点击：点输入框上方的预览条与点聊天消息里的引用卡一致，跳回笔记并选中高亮原选区
---

# 0060 引用预览条可点击（跳回并高亮）

> 对应路线图 [R-43](../roadmap.md#需求待办)；前置提案 [0058](0058-selection-quote.md) / [0059](0059-live-selection-preview.md)。
> 用户原话：「在添加一个小功能，就是点击这个，和点击聊天消息内引用的效果一样，会高亮对应的文本内容。」（截图指向输入框上方的引用预览条）
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 例外（用户当轮已明确指定要改的具体项）直接执行并补记录。

## 1. 背景与问题

0058 / 0059 之后，编辑区选中文字 → 右栏出现引用预览条（笔记名 + 行范围 + 摘录 + ×）。但预览条本身不可点：用户想确认「这段引用到底在笔记哪里」时，只能先发消息、再点气泡里的引用卡；或者手动去编辑区找。

消息里的引用卡（`QuoteCard`）已经能跳回并选中高亮；预览条应复用同一行为。

## 2. 目标与非目标

- 目标：点击预览条主区域（图标 / 笔记名 / 行范围 / 摘录）→ 与点引用卡一致：打开/切到该笔记 → 选中原范围 → 聚焦（原生选区高亮可见）；预览条保留（引用仍待发送）。
- × 保持原语义：只取消本次引用，不跳转、不改编辑器选区。
- 键盘可达：主区域是真正的 `button`，Enter / Space 可触发；× 仍是独立按钮。
- 非目标：不改引用编码 / 发送 / 引用卡 / 实时监听逻辑；不改设置。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）预览条主区域做成 `button`，回调 `onOpenQuote` 到根组件** | `quote-preview.tsx` 拆成「主按钮 + ×」；`composer.tsx` 新增 `onOpenQuote`；`native-chat-root.tsx` 里 `onOpenQuote={() => jumpToQuote(app, pendingQuote)}`，与 `QuoteCard` 共用同一个跳转函数。 | 3 个文件 + CSS | 低：行为复用同一条 `jumpToQuote`，卡片 / 预览今后不会漂移；无新依赖、无内部 API；可键盘操作 | **推荐** |
| B 预览条外层整块 `div[role=button]`，× 点击 `stopPropagation` | 少改一个结构，外层直接 `onClick` | 2 个文件 | 实现快；但 `role=button` 里再嵌 `button` 语义不佳、键盘 Enter/Space 要手写，且点 × 的冒泡依赖 stopPropagation 容易回归 | 否掉：可访问性与稳健性都更差 |
| C 不新增回调，让 `QuotePreview` 直接 import `jumpToQuote` 并接收 `app` | 与 `QuoteCard` 一样在组件内部跳转 | 2 个文件 | 可行；但 UI 组件直接拿 `App` 做副作用，与 `QuoteCard` 现状一致却让 composer 多传 `app` | 否掉：回调更符合现有 composer 的「只拿窄接口」风格（`onSend` / `onStop` 都是回调） |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/view/native/ui/quote-preview.tsx](../../src/view/native/ui/quote-preview.tsx) | 新增 `onOpen`；主区域改为 `<button className="dsh-native-quote-preview-main">`（图标 + 笔记名 + 行范围 + 摘录，`aria-label` / `title` = 跳转到 …），× 保持独立按钮 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 新增 `onOpenQuote` prop 并传给 `QuotePreview` |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `onOpenQuote` 复用 `jumpToQuote(app, pendingQuote)`（与引用卡同一函数） |
| [styles.css](../../styles.css) | `.dsh-native-quote-preview-main` 按钮重置（透明底 / 无边框 / flex / 文本左对齐）+ hover 摘录提亮 + focus-visible 描边 |

## 5. 行为变化

- 点预览条 → 主区打开/切到笔记、选中原范围并高亮，焦点到编辑区；预览条不消失（仍可继续发送这条引用）。
- 点 × → 仅取消本次引用，不跳转、不移动选区。
- 键盘：Tab 到预览条主按钮 + Enter / Space 同样跳转。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 点预览条后焦点离开输入框 | 用户要继续打字需再点输入框 | 与引用卡行为一致（用户要求「效果一样」）；预览保留，再点输入框即可 |
| 窄面板里主按钮挤压 × | 摘录被压缩 | 主按钮 `flex:1` + `min-width:0`，摘录 `ellipsis`；× 固定宽 |
| 笔记已不存在 / 行号漂移 | 跳转失败或位置偏 | 复用 `jumpToQuote` 的 Notice 与摘录搜索兜底 |

回滚：恢复 `quote-preview.tsx` 的静态结构并删掉 `onOpenQuote` 接线即可，无数据 / 配置影响。

## 7. 验证

- `npm run build` / `npm run check` 通过，`npm run lint` 0 error。
- CDP 实测（Obsidian 1.14.5）：
  1. 编辑区选中 12 字 → 右栏出现预览条（`aria-label` = 跳转到 …）；
  2. **真实鼠标点击预览条主区域** → `activeEditor` 回到笔记、`cm-focused=1`、选中 4:0–4:12、`window.getSelection()` 非空（高亮可见）；
  3. 点击后预览条仍在（引用未被清掉）；
  4. 点 × → 预览消失、编辑器选区不变、不触发跳转。

## 8. 需要你拍板

- [x] 预览条是否可点击并跳回高亮：**是**，2026-10-28 用户指定。
- [x] 交互边界：点击主区域 = 跳转；× = 仅取消本次引用（不跳转）。2026-10-28 按用户「和点击聊天消息内引用的效果一样」实现。

## 9. 实施记录

**落地（2026-10-28）**：`QuotePreview` 主区域改为 `button` 并新增 `onOpen`；`Composer` 新增 `onOpenQuote` 回调；`NativeChatRoot` 用它调用与引用卡相同的 `jumpToQuote(app, pendingQuote)`；`styles.css` 补主按钮重置 / hover / focus-visible。

**与提案的偏差**：无。

**验证结果**：`npm run build` / `npm run check` 通过，`npm run lint` 0 error；真实鼠标点击预览条与点 × 的行为均符合第 7 节。
