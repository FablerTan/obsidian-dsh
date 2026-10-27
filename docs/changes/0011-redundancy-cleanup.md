---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: src/service, src/settings, src/view, src/shared, packages/dsh-obsidian-bridge, docs
issue: 审阅 0008/0009 后的遗留：无调用方的导出、重复实现、超过拆分判据的 UI 文件、以及仍停留在旧行为的文档
---

# 0011 清掉 0008/0009 之后的冗余代码与结构漂移

## 1. 背景与问题

0010 收敛入口时发现一批「改完没回头收尾」的遗留。逐项核实（`grep` 全仓 + tsc）：

| # | 位置 | 问题 | 证据 |
|---|---|---|---|
| 1 | `src/settings/schema.ts` `serviceUrl()` | 无调用方；`service/manager.ts` 自己内联 `'http://127.0.0.1:' + port` | 全仓仅声明处 1 处引用；文档仍称它派生地址 |
| 2 | `src/service/locator.ts` `resolveDshCommand()` | 无调用方，只是 `resolveDshInstall()?.install.command` 的包装 | 全仓仅声明处 |
| 3 | `src/view/native/core-bridge.ts` `diagnose()` | 无调用方（桥侧 `client.js` 仍有该能力，可手工调试） | 全仓仅声明处 |
| 4 | `packages/dsh-obsidian-bridge/lib/client.js` v1 段 | `configure` / `newSession` / `enforceSingleColumn` / `state` 与 workspace 解析，0008 后插件不再调用 | 插件侧 `core-bridge.ts` 只调 v2 方法；约 150 行 + 注册块 |
| 5 | 7 处 `error instanceof Error ? x.message : String(x)` | 同一手写模式散在 main / tab / root / view / core-bridge | `grep -c` |
| 6 | `src/view/native/ui/menus.tsx` 571 行 | 浮层基础设施 + 4 个菜单同文件，超出技能「>150 行多半混了两个职责」判据 | `skills/project-guide` 第 5 节 |
| 7 | `src/view/native/ui/timeline.tsx` 398 行 | 10 个节点渲染器 + Timeline 同文件 | 同上 |
| 8 | `src/view/open.ts` `revealLeaf` 未 await | 同函数内其余调用都 await，这里留下浮空 promise | 行的上下文 |
| 9 | 文档与代码漂移 | architecture 目录树仍列已删除的 `controller.ts`、README 写「机器人图标」、roadmap 版本停在 0.4.0、AGENTS 写 25 文件 / 3900 行 | 本次已修，见第 9 节 |

## 2. 目标与非目标

- 目标：删掉无调用方代码；把超过判据的 UI 文件按「纯搬运」拆开；收敛重复的错误文案工具；把文档改到与代码一致。
- 非目标：不改任何用户可见文案与交互；不改命令 id；不重写 `menus` / `timeline` 内部逻辑（只搬文件）；不动 `src/shared/native-types.ts` 的 DTO 形状。

## 3. 方案

### 方案 A（推荐）

- **1–3**：直接删导出，文档同步（涉及 `docs/architecture.md`、`docs/development.md`、`skills/project-guide`、AGENTS 目录表里 schema 的「URL 推导」描述）。
- **4**：删桥侧 v1 段 + README「v1 布局」小节；AGENTS / skill 里「v1 保留但不再调用」的说明改为「已删除」。**需要确认没有外部脚本依赖 v1**（`docs/obsidian-cdp.md` 的调试片段只用 v2 与 `open-dsh-view`）。
- **5**：新增 `src/shared/errors.ts` 的 `errorText(error: unknown): string`，替换 7 处。（若嫌新文件，可并入 `shared/log.ts`；我倾向前者，log 管日志格式，不该顺带管错误文案。）
- **6–7**：纯搬运拆分，一次只搬不改：
  - `menus.tsx` → `menu-shell.tsx`（`MenuAnchor` / `useMenuStyle` / `MenuShell` / `SubmenuPanel` / `clamp` / `sameModel`）+ `model-menu.tsx` + `permission-menu.tsx` + `session-menu.tsx`（含 `RenameSessionModal`）；
  - `timeline.tsx` → 保留 `Timeline` 外壳，节点渲染器搬到 `timeline-nodes.tsx`。
- **8**：加 `await`（行为等价，消除浮空 promise）。

### 方案 B（备选）

只做 1–5 + 8（删死代码、收敛工具），UI 大文件先不动。理由：拆分收益是结构可读性，但会制造一次较大 diff，而项目当前无单测，纯搬运也有回归成本。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/settings/schema.ts` | 删 `serviceUrl()` 与注释里的 URL 推导 |
| `src/service/locator.ts` | 删 `resolveDshCommand()` |
| `src/view/native/core-bridge.ts` | 删 `diagnose()` |
| `src/shared/errors.ts` | 新增 `errorText()` |
| main / tab / native-chat-root / native-chat-view / core-bridge | 7 处手写错误文案改调 `errorText()` |
| `src/view/open.ts` | `revealLeaf` 加 `await` |
| `src/view/native/ui/menus.tsx` → 4 个文件 | 纯搬运（方案 A） |
| `src/view/native/ui/timeline.tsx` → `timeline-nodes.tsx` | 纯搬运（方案 A） |
| `packages/dsh-obsidian-bridge/lib/client.js` / README | 删 v1 段（方案 A） |
| `docs/architecture.md` / `docs/development.md` / `skills/project-guide/SKILL.md` / `AGENTS.md` | 同步删除项与目录描述 |

## 5. 行为变化

- 插件侧：无（都是删无调用方代码 / 纯搬运；`await` 只影响时序细节，语义等价）。
- 桥侧：页面全局对象不再提供 `configure` / `newSession` / `enforceSingleColumn` / `state`；插件从不调用，手工 CDP 调试脚本若用到会失效（文档里没有这种用法）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 拆分时漏改 import | 构建失败 | tsc 会挡住；按文件逐个搬 |
| 误删被外部/手工使用的桥 v1 | 外部调试脚本报错 | 恢复 `client.js` 的 v1 段并重新 link + 重启服务 |
| 文档与代码再次不同步 | 下个会话误判 | 同一次提交里改文档，`npm run check` 之外人工过一遍目录表 |

## 7. 验证

- `npm run build`、`npm run check` 通过；`vue-tsc` 不涉及。
- 拆分后：`grep` 确认 `menus.tsx` / `timeline.tsx` 的行数与导出位置变化，但 `styles.css` 类名引用数不变（应为 0 未引用）。
- 删桥 v1 后：`node --check packages/dsh-obsidian-bridge/lib/client.js`（check 已覆盖）；重载插件 + 重启服务，原生面板会话列表 / 发送 / 审批正常。
- 验收标准：`grep -rn "serviceUrl\|resolveDshCommand\|diagnose(" src` 无输出；`ui/` 下不再有 >300 行文件（除 `native-chat-root.tsx`，它是状态编排器；`timeline-nodes.tsx` 330 行已在实施记录里说明）。

## 8. 需要你拍板

- [ ] 1–3（删三个无调用方导出）——零风险，建议做。
- [ ] 4（删桥 v1 段）——需要在真实的 dsh profile 上重 link + 重启验证；确认没有别的项目/脚本用 v1。
- [ ] 5（新增 `shared/errors.ts` 收敛错误文案）——纯整理。
- [ ] 6–7（拆 `menus.tsx` / `timeline.tsx`）——纯搬运，但 diff 大；也可以留到下次动这两个文件时顺手做。
- [ ] 8（`open.ts` 加 await）——一行。

## 9. 实施记录

2026-10-26 实施（用户多选确认全部 5 项）：

**1–3 删无调用方导出**

- `settings/schema.ts`：删 `serviceUrl()`（地址改由 `manager.ts` 内联构造，文档同步）；
- `service/locator.ts`：删 `resolveDshCommand()`（`resolveDshInstall()` 直接使用）；
- `view/native/core-bridge.ts`：删 `diagnose()` 包装（桥侧 `client.js` 的 diagnose 仍在，供手工调试）。

**5 收敛错误文案**

- 新增 `src/shared/errors.ts` 的 `errorText(error)`；
- 替换 7 处手写 `instanceof Error ? message : String(...)`：`main.ts`、`settings/tab.ts`、`native-chat-view.tsx` ×2、`core-bridge.ts` ×2、`native-chat-root.tsx`（原本地 `messageOf` 删除）。

**8 open.ts**

- `revealLeaf()` 补 `await`，与同函数其他调用一致。

**4 删桥插件 v1**

- `client.js`：删 `STYLE_ID` / `ENFORCE_INTERVAL_MS` / `TOGGLE_GUARD_MS` / `normalizePath` / `injectCss` / `removeCss` / `readyWorkspaces` / `state` / `configure` / `newSession` / `enforceSingleColumn` 与对应注册项、单栏 CSS effect（864 → 711 行）；
- `ctx.effect` 只保留 `native.dispose()` + 全局对象清理；
- README / `cordis.patch.yml` / AGENTS / project-guide 的 v1 描述同步为「已删除」。

**6–7 拆文件（纯搬运）**

- `ui/menus.tsx`（571 行）→ `menu-shell.tsx`（定位 / 背板 / 二级浮层）、`model-menu.tsx`、`permission-menu.tsx`（含 `ConfirmModal`）、`session-menu.tsx`（含 `RenameSessionModal`）；`menus.tsx` 删除，`native-chat-root.tsx` 改为分别 import；
- `ui/timeline.tsx`（398 行）→ `timeline.tsx`（75 行滚动外壳）+ `timeline-nodes.tsx`（330 行节点渲染，导出 `NodeView`）。

**偏差与说明**

- `timeline-nodes.tsx` 330 行，略高于验收里的 300 行目标；节点渲染器彼此内聚，未再拆（继续增长时按「消息 / 卡片」再分）。
- `ConfirmModal` 只有权限菜单使用，随 `PermissionMenu` 放进 `permission-menu.tsx`，未单独建 modal 文件。

**验证**

- `npm run build` 通过（main.js 207.7kb）；`npm run check` 全绿；`node --check packages/dsh-obsidian-bridge/lib/client.js` 通过。
- `grep -rn "serviceUrl\|resolveDshCommand\|diagnose(" src` 无输出；`styles.css` 的 92 个 `dsh-*` 类在 src 中仍全部有引用。
- 未做人工 UI 回归：需重载插件 + 重启 DSH 服务（桥包路径未变，重启即加载新代码）后确认会话列表 / 发送 / 审批 / 菜单与时间线。
