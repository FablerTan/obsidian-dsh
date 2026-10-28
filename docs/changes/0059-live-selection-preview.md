---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确指定：右栏要实时显示编辑区选中的文字
scope: src/view/native
issue: 选区引用预览实时化：编辑区里选中文字时右栏立即显示/更新引用预览，不用先把焦点移到输入框
---

# 0059 选区引用预览实时化

> 对应路线图 [R-42](../roadmap.md#需求待办)；前置提案 [0058](0058-selection-quote.md)。
> 用户原话：「右栏要实时显示我在编辑区中选中的文字，而不是我把焦点移动之后才会更新。」
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 例外（用户当轮已明确指定要改的具体项）直接执行并补记录。

## 1. 背景与问题

0058 的选区快照只在两个时机抓：输入卡 `onMouseDownCapture` 与 textarea `onFocus`。也就是说：用户在编辑区选中文字后，必须先点一下右栏输入框，预览条才会出现 / 更新。用户要求「实时显示」——只要编辑区选区变了，右栏就立刻跟着变，不需要先移动焦点。

约束：面板获得焦点后 `workspace.activeEditor` 会变成 null（0058 实测），但失焦的 `MarkdownView` 里 CM6 选区仍保留；实时监听要围绕「编辑区选区变化事件」而不是「面板事件」。

## 2. 目标与非目标

- 目标：编辑区里**选中 / 改选 / 折叠/取消选中**时，右栏输入框上方的引用预览条在 ~100ms 内出现 / 更新 / 消失；不点输入框也能看到；点 × 的「本次不引用」仍生效（同一选区保持隐藏，选区变化后恢复）。
- 非目标：不改 0058 的引用编码、发送、引用卡、跳转逻辑；不做多光标 / 多编辑器同时预览（取 `getMostRecentLeaf()` 的最后活跃编辑器）；不改桥、不改设置项。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）`selectionchange` + workspace 事件 + 80ms 防抖** | 在 `editor-selection.ts` 新增 `observeEditorSelection(app, listener)`：`document.addEventListener('selectionchange')` 触发后延迟 80ms 读 `captureSelectionQuote(app)`，与上次 `quoteKey` 比较后回调；同时监听 `active-leaf-change` / `file-open`（切笔记 / 切叶子时重读）。React 根用 `useEffect` 订阅。 | 2 个文件（editor-selection + native-chat-root） | 低：不用内部 API、不轮询；拖选时事件很密，靠防抖与 key 去重压掉多余重渲染；popout 窗口里的编辑器选区不在主 document 的 `selectionchange` 上（已知边界，主窗口正常） | **推荐** |
| B 定时轮询（如 250ms 读一次选区） | `setInterval` 调 `captureSelectionQuote`，key 变了才更新 | 1 个文件 | 实现更简单；但一直有定时器唤醒（空闲也跑），且有 0–250ms 延迟，拖选时跳动明显 | 否掉：常驻开销与观感都更差 |
| C CM6 `EditorView.updateListener`（`editor.cm` 内部 API） | 直接拿 `editor.cm` 注册 selection 更新监听 | 1 个文件 + CM6 类型依赖 | 实时性最好；但 `editor.cm` 是未文档化内部 API，0058 调研已确认渲染进程拿不到 `@codemirror/*` 模块构造器，跨版本风险高 | 否掉：为一个预览引入内部 API 不划算 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/view/native/editor-selection.ts](../../src/view/native/editor-selection.ts) | 新增 `observeEditorSelection(app, listener)`：`selectionchange` + `active-leaf-change` / `file-open`，80ms 防抖，按 `quoteKey` 去重；返回清理函数 |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | `applyQuote()`（快照 → 预览状态；选区变化时清掉旧的 dismissed；`null` 也清 dismissed，让折叠后重选同范围能恢复）；`useEffect` 订阅 `observeEditorSelection`；删掉 0058 里「切会话清空预览」的 effect（预览是编辑区状态，与会话无关）；保留 mousedown / focus 捕获作为兜底 |

不改 `quote.ts`、`timeline-nodes.tsx`、设置、样式、桥。

## 5. 行为变化

- 在编辑区拖选 / Shift+方向键选 / 双击选词：右栏预览条即时出现并更新（笔记名 + 行范围 + 摘录），无需点输入框。
- 点编辑区空白处折叠选区（或把选区删掉）：预览条消失。
- 点输入框：预览保留（编辑器选区仍在，失焦不清状态）。
- 点 ×：该选区在预览里隐藏；之后折叠再重新选同一段 → 重新出现（dismissed 在选区清空时重置）。
- 切换会话不再清掉预览（预览只反映当前编辑区选区）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 拖选时 `selectionchange` 很密 | 频繁 setState | 80ms 防抖 + `quoteKey` 去重；实测无卡顿 |
| 选区在 popout 窗口的编辑器里 | 主窗口 `selectionchange` 收不到，预览可能不跟随 | 已知边界；主窗口正常，popout 场景留待真实需求再处理 |
| 面板里选中/复制消息文本触发 `selectionchange` | 会重读编辑区选区，但 key 未变 → 不更新 | key 去重兜底 |
| 关闭编辑器 / 无 md leaf | `captureSelectionQuote` 返回 null → 预览消失 | 符合预期 |

回滚：删除 `observeEditorSelection` 与根组件里的 `useEffect` 订阅即可回到 0058 的「点输入框才更新」行为。

## 7. 验证

- `npm run build` / `npm run check` 通过，`npm run lint` 0 error。
- CDP 实测（Obsidian 1.14.5）：
  1. 编辑区 `setSelection`（不点面板）→ 400ms 内预览出现，标签「第 5 行」+ 摘录正确；
  2. 改选另一行 → 预览随更新（第 1 行 / 新摘录）；
  3. `setCursor` 折叠 → 预览消失；
  4. 重新选中同一范围 → 预览恢复；
  5. 点输入框 → 预览保留；
  6. 点 × → 消失；折叠后重选同范围 → 恢复；
  7. **真实鼠标拖选**（CDP `Input.dispatchMouseEvent` 按下 → 移动 → 抬起）→ 预览出现，标签与摘录与实际选区一致。

## 8. 需要你拍板

- [x] 是否实时显示（而不是点输入框才更新）：**是**，2026-10-28 用户指定。
- [x] 实现方式：`selectionchange` + workspace 事件 + 80ms 防抖（路径 A），不引入内部 API、不轮询。

## 9. 实施记录

**落地（2026-10-28）**：`editor-selection.ts` 新增 `observeEditorSelection`；`native-chat-root.tsx` 用 `applyQuote` 统一「快照 → 预览」状态并对订阅做清理，移除切会话清空预览的 effect。mousedown / focus 捕获保留为兜底。

**与提案的偏差**：无。

**验证结果**：`npm run build` / `npm run check` 通过，`npm run lint` 0 error；CDP 七步实测（含真实鼠标拖选）全部符合预期，详见第 7 节。

**追补（R-43 / [0060](0060-quote-preview-clickable.md)，2026-10-28）**：预览条主区域改为可点击按钮，点击与引用卡一致（`jumpToQuote` 跳回并选中高亮）；× 仍只取消本次引用。
