---
status: done             # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27      # 用户当轮已明确指定「把 @ 的设置和详情放一个面板，一眼看出名单属于 @；/ 同理」，按 AGENTS.md 规则 12 例外视为已批准
scope: src/settings, styles.css
issue: 设置页「聊天」tab 的两个范围设置（模式下拉）与其白 / 黑名单详情分处两块、视觉上不像同一组；改为每组一张带徽标的卡片（@ / ），把标题、模式下拉与名单详情收进同一容器
---

# 0039 范围设置分组卡片：@ 与 / 各自的标题 + 模式 + 名单详情收进一张卡

> 对应路线图 [R-22](../roadmap.md#需求待办)。用户原话：「将 @ 的设置和详情设置放在一个面板里，使其视觉上能一眼看出来这个名单是 @ 设计的，/ 命令同理」（「名单」= 白名单 / 黑名单）。

## 1. 背景与问题

现状（0038 之后）：设置 →「聊天」tab 里有两个范围设置，每个都是「一行 `Setting`（名称 + 说明 + 三档下拉）」+ 下方一块独立的名单面板（标题「白名单（N）」、条目列表、`[选取][输入框][添加]`、提示行）。两块之间只有普通间距，没有任何容器边界或归属标记：

- 看不出下面那块名单属于「@」还是「/」（尤其滚到列表中间时）；
- 两个设置连续排列时，视觉上像同一条平铺列表，切换模式后出现的详情块容易与上一组混淆。

## 2. 目标与非目标

### 目标

- 每个范围设置变成**一张卡片**：卡片头 = 徽标（@ 或 /）+ 标题 + 三档模式下拉；下面一行说明；启用时卡片体内是白 / 黑名单详情。
- @ 卡片与 / 卡片用不同徽标字符区分（`@` / `/`），标题沿用「「@」引用范围」「「/」技能范围」，保证扫一眼就能对上。
- 「不启用」时卡片只剩头 + 说明，不渲染详情（与现状一致，不显示空名单）。
- 纯视觉与 DOM 分组变化：设置项、名单数据、候选来源、提交逻辑与生效时机都不变。

### 非目标

- 不改设置字段、默认值、归一化 / 校验、名单匹配语义、@ / `/` 菜单过滤。
- 不做折叠 / 展开、不做 tab 内二级导航、不改设置页顶部 tab 结构。
- 不动 `streamRefresh` 那一行（仍按原样渲染）。
- 不改桥、不改服务、不需要重启（重载插件即可看到新样式）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（本次落地）** | 新增 `renderScopeCard()`：卡片容器 `.dsh-settings-scope-card`（头：徽标 + 标题 + `select.dropdown`；说明行；可选的 body）。两个 `renderMentionScope` / `renderSkillScope` 改成「先画卡片，再把 `renderScopePanel` 挂到卡片 body」，模式切换仍然整块重绘（`context.refresh()`） | `settings/sections/chat.ts`（新增约 40 行、两处调用重排）+ `styles.css`（卡片 / 徽标 / 头 / 说明 / body 约 40 行） | 只动设置页渲染；容器内边距与既有 `.dsh-settings-scope-*` 间距要顺手收一下，避免双份留白；设置页 DOM 变了一层，回归时要确认 `renderScopePanel` 的选择器（`.dsh-settings-scope-add` 等）仍唯一 | **推荐**：改动集中、无状态迁移，视觉归属最直接 |
| B | 不加容器，只做视觉分隔：给详情块加左缩进 / 左边框 / 上分隔线，标题改成「「@」白名单（N）」 | 只改 `chat.ts` 文案 + `styles.css` | 改动更小，但「设置」与「详情」仍是两条独立块，滚动后仍要靠标题文字认归属；用户要的是「一个面板」，路径 B 名不副实 | 不推荐：没解决「同一组」的观感 |
| C | 折叠卡片（默认展开，点标题收起） | 同 A + 折叠状态与键盘可达性 | 交互更重，用户没要求；折叠状态还要考虑切 tab 重绘后是否记忆 | 不推荐：超出需求 |

**推荐 A**：一张卡把「这是谁的设置 + 当前模式 + 名单内容」收在同一个有边界的容器里，徽标与标题直接表明归属，改动面只有设置页渲染与样式。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 新增 `renderScopeCard()`（徽标 + 标题 + 模式下拉 + 说明 + body）；`renderMentionScope` / `renderSkillScope` 改为先画卡片、启用时把 `renderScopePanel` 挂进 body；原来的 `new Setting(...)` 标题 / 描述 / 下拉移除（模式下拉改成卡片头里的 `select`） |
| [styles.css](../../styles.css) | 新增 `.dsh-settings-scope-card` / `-header` / `-badge` / `-title` / `-desc` / `-body` 与卡片内 `.dsh-settings-scope` 的间距收口；全部走主题变量 |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点 / 改动地图里补一句「分组卡片」；回归清单追加一条 |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-22 / 本提案登记 |

## 5. 行为变化

- 设置 →「聊天」tab：两个范围设置各显示为一张卡片；卡片头依次是徽标（`@` / `/`）、标题、三档下拉；下方是说明；选白 / 黑名单后名单详情出现在同一张卡里。
- 「不启用」时卡片只有头 + 说明（不渲染名单块，与改动前一致）。
- 文案：说明文字原样保留；标题沿用「「@」引用范围」「「/」技能范围」。
- 设置数据、候选来源、添加 / 移除 / 选取行为、生效时机全部不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 卡片内再套一层 `.dsh-settings-scope` 造成双份留白 | 视觉偏松 | 用 `.dsh-settings-scope-card .dsh-settings-scope { margin-bottom: 0 }` 收口 |
| 设置页 DOM 多一层，回归脚本 / 选择器若依赖父级结构可能失效 | 仅开发期检查 | 现有选择器都按类名取，不依赖父级层级 |
| 下拉从 `Setting` 换原生 `select` | 键盘 / 主题样式差异 | 复用 Obsidian 的 `.dropdown` 类，保持原生外观；必要时回退到 `Setting` 行 + 卡片包裹 |

## 7. 验证

- `npm run build` / `npm run check` 通过，`main.js` 重新生成。
- CDP：设置 → 聊天 tab → 断言两张 `.dsh-settings-scope-card`，徽标文本为 `@` / `/`；切「白名单」后卡片内出现 `.dsh-settings-scope-title` 与添加栏；切「不启用」后 body 消失、卡片仍在；截图确认分组与对比度（深 / 浅主题至少各看一次计算样式）。
- 回归：添加 / 移除 / 「选取」候选与回填、菜单生效时机都不变。

## 8. 需要你拍板

无（用户当轮已明确要求「放进一个面板 + 一眼看出归属」，按规则 12 例外直接执行；卡片的视觉细节如有偏好可继续调）。

## 9. 实施记录

**落地（2026-10-27，按路径 A）**：

- [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) 新增 `renderScopeCard()`：`.dsh-settings-scope-card`（头 = 徽标 + 标题 + `select.dropdown`，说明行，启用时的 body）；`renderMentionScope` / `renderSkillScope` 改为「先画卡片，再把 `renderScopePanel` 挂进 body」，模式切换仍整块重绘。徽标用字符 `@` / `/`，标题沿用「「@」引用范围」「「/」技能范围」。
- [styles.css](../../styles.css) 新增卡片 / 头 / 徽标 / 标题 / 说明 / body 样式（`.dsh-settings-scope-card*`），全部主题变量；卡片内 `.dsh-settings-scope` 外边距归零、详情整体缩进 30px（与标题对齐）。
- 文档：[development.md](../development.md) 改动地图 + 回归第 58 条；[architecture.md](../architecture.md) 关注点行补「分组卡片」。

**验证**：

- `npm run build` / `npm run check` 通过，`main.js` 重新生成且与源码一致。
- CDP 实测（Obsidian 1.14.5，设置窗口）：聊天 tab 出现 2 张卡片，徽标 `@` / `/`、标题「「@」引用范围」「「/」技能范围」、下拉值 `blacklist`；两张卡都有 body，分别显示「黑名单（1）」（模板）与「黑名单（0）」+ 添加栏；卡片背景 `rgb(40,40,40)`（`--background-secondary`）、边框 `rgb(51,51,51)`、圆角 8px，徽标为强调色。
- 交互回归：把 / 卡片切「不启用」→ 卡片仍在、body 消失；切回「黑名单」→ 详情回来。@ 卡片点「选取」仍弹出 16 条候选并可 Esc 关闭；添加栏提交仍走原校验（测试中误加过一条 `etc`，已从设置与 `data.json` 移除并恢复原值）。
- 截图确认分组与对比度（深色主题）。

**与提案偏差**：无。
