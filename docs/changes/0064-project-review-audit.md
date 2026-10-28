# 0064 项目结构审阅报告（2026-10-28）

> 本报告由 `project-review` 技能产出：**只读扫描 + 人工复核，本次未立项、未改任何代码**。
> 若你确认进入重构，会按 AGENTS.md 规则 12/13 另开 `R-47` + 提案（≥ 2 条实现路径），提案链接本报告；报告里的批次只是建议，不是已批准的执行计划。

## 元信息

| 项 | 内容 |
|---|---|
| 审阅日期 | 2026-10-28 |
| 审阅范围 | 仓库根：质量类 `src/` + `packages/`；结构 / 文档类全仓 |
| 扫描命令 | `node skills/project-review/scripts/audit.mjs --json`（默认参数 `--top 10` / `--min-block 8`；原始 JSON 在 /tmp，可随时重跑复现） |
| 机器输出 | 127 条 findings（分布见 0.1，明细见各章节） |
| 是否改码 | **否**（本轮只新增技能与文档；`src/` / `packages/` / `main.js` 未动） |
| 关联需求 | 未立项；前序 [0063](0063-project-review-skill.md)（技能本身） |
| 报告状态 | 已立项：执行提案 [0065](0065-structure-refactor.md)（2026-10-28 用户选范围 C；`listPortListeners` 删除） |

## 0. 概览

### 0.1 扫描结果

| 指标 | 值 |
|---|---|
| 全仓代码 | 75 文件 / 17467 行（含 scripts / 技能脚本） |
| 质量类范围 | src + packages：72 文件 / 15051 行 |
| 候选 findings | 127 条 |
| 复核后成立 | 3 条高置信死导出；31 个超阈值文件（2 个强拆候选 + 10 个 300~500 行可评估 + 19 个提示级，另 3 个例外）；5 组跨文件重复；5 条契约值散落；67 条「export 多余」低风险整理项 |
| 误报 / 已知例外 | 3 个允许超长的文件；2 条改动地图误报（目录汇总行已覆盖）；6 组同文件 JSX 重复（候选不合并） |

| 报告章节 | category | 脚本命中 | 复核成立 |
|---|---|---|---|
| 1 超长文件 | `long-file` | 34 | 34（含 3 条已知例外，实际可评估 31） |
| 2 无调用方导出与死文件 | `unused-export` / `dead-file` | 70 / 0 | 3 条可删 + 67 条可去 export |
| 3 重复实现 | `duplicate-block` / `magic-literal` | 13 / 5 | 5 组跨文件可收敛 + 5 条契约值 + 6 组同文件候选 |
| 4 结构漂移 | `layer-violation` / `barrel` / `cross-package` / `root-clutter` | 0 | 0 |
| 5 遗留标记 | `todo-marker` | 0 | 0 |
| 6 文档漂移 | `doc-missing-file` / `doc-map-missing` | 0 / 5 | 0 条断链；3 条建议补登记 + 2 条误报 |

### 0.2 结论（3~5 条）

1. **结构债集中在 UI 与设置页**：`composer.tsx` 702 行、`settings/sections/chat.ts` 568 行是唯二 ≥500 的非例外文件；其余 300~500 行的文件「可拆但不紧急」。
2. **死代码很少，但存在 3 条高置信无调用方导出**：`installAnchors`、`listPortListeners`、`clearSkillCatalogCache`；其中 `installAnchors` 与 `plugin-catalog.ts` 的 `anchorsOf()` 逻辑重复，属于「既死又重」。
3. **重复实现集中在 service 层**：`createBackup` / `writeAtomic` 在 `plugin-bundles` 与 `plugin-patch` 完全同构；`safeMtime` / `unquoteYaml` / `anchorsOf` 各有一份重复。
4. **分层与目录纪律干净**：分层违规、barrel、src↔packages 互引、根目录杂项、TODO 全部为 0；文档没有断链。
5. **不建议动的东西**：`client.js`（桥单文件契约）、`native-chat-root.tsx`（状态编排器）、`main.ts`（组合根）、`native-types.ts`（纯类型）——行数高是形态，不是问题。

### 0.3 误报与已知例外（已排除，不排期）

| # | 位置 | 脚本判定 | 排除理由 |
|---|---|---|---|
| 1 | `packages/dsh-obsidian-bridge/lib/client.js` | long-file high→info | 桥单文件是 dsh 客户端插件的契约边界，拆包会改变加载语义 |
| 2 | `src/main.ts` | long-file high→info | 组合根只做注册 / 装配，拆开增加跳转成本 |
| 3 | `src/view/native/ui/native-chat-root.tsx` | long-file high→info | 状态编排器，拆开会产生跨文件状态同步 |
| 4 | `src/shared/async.ts` / `errors.ts` | doc-map-missing info | `docs/development.md` 的 shared/ 汇总行已写 sleep / errorText()，扫描器只匹配文件名，属误报 |
| 5 | 6 组同文件 JSX 重复 | duplicate-block low | 结构相似 ≠ 语义相同；未确认等价前不合并 |
| 6 | `client.js` 12 行 ×2 | duplicate-block low | 桥单文件内的注册样板；保持单文件契约优先 |

### 0.4 待确认（需要你或后续验证）

| # | 位置 | 疑点 | 需要什么证据 / 决定 |
|---|---|---|---|
| 1 | `port-dsh.ts` `listPortListeners` | 代码 0 调用，但 `docs/development.md` 把它列为 0056 的「端口探测原语」 | 确认是否留作外部冒烟 / 后续复用；不留则删 |
| 2 | `plugin-inventory.ts` `installAnchors` | 0032 提案说「供目录解析复用」，但 catalog 自己实现了 `anchorsOf` | 删（重复），或让 catalog 复用它；二选一 |
| 3 | 6 组同文件 JSX 重复 | 是否值得抽组件 | 需读实现 + 视觉回归；收益低于风险时只记录 |
| 4 | 5 条 magic-literal | 是否收敛到 `DEFAULT_SETTINGS` / `shared/constants.ts` | 低风险整理，可并入批次 4，也可只记录 |

## 1. 超长文件

阈值：≥150 提示、≥300 建议拆、≥500 强信号；范围 `src/` + `packages/`（工具脚本不计入）。三个已知例外（`main.ts` / `native-chat-root.tsx` / 桥 `client.js`）已固定为 `info`。

| 行数 | 文件 | 严重度 | 评估 |
|---|---|---|---|
| 1636 | `packages/dsh-obsidian-bridge/lib/client.js` | info（例外） | 已知例外：桥单文件是契约边界，允许超长；新增能力先看 v8 契约 |
| 1228 | `src/view/native/ui/native-chat-root.tsx` | info（例外） | 已知例外：原生聊天状态编排器；新增职责优先进子组件 / 纯函数 |
| 702 | `src/view/native/ui/composer.tsx` | high | 强拆候选：输入框 + 菜单 + 附件 + 发送编排混装；先纯搬运拆 composer-shell / menus / send |
| 587 | `src/main.ts` | info（例外） | 已知例外：组合根只做注册 / 装配 / Notice 映射；出现业务分支即漂移 |
| 568 | `src/settings/sections/chat.ts` | high | 强拆候选：聊天设置多项平铺；按卡片拆 section 文件 |
| 498 | `src/service/manager.ts` | medium | 可评估：探测 / 拉起 / 停止 / 结果映射同文件，可拆 stop 与 status |
| 417 | `src/view/native/ui/pending.tsx` | medium | 可评估：审批卡 + 提问卡 + 翻页，可拆 pending-question / pending-approval |
| 402 | `src/settings/sections/plugins.ts` | medium | 可评估：插件列表 / 启停 / 可选包折叠，可拆渲染与动作 |
| 383 | `src/view/native/ui/timeline-nodes.tsx` | medium | 可评估：多类节点渲染器，可按节点族拆 |
| 371 | `src/service/port-dsh.ts` | medium | 可评估：平台探测 / 命令行核实 / 结束策略，可按平台拆 |
| 368 | `src/view/native/ui/timeline-model.ts` | medium | 可评估：折叠 / 分段纯逻辑，可抽纯函数并配冒烟 |
| 355 | `src/shared/native-types.ts` | medium | 纯类型声明：不拆，保持 DTO 单一来源 |
| 355 | `src/view/native/core-bridge.ts` | medium | 可评估：模型 / 命令 / 团队 / 子智能体 / goal 方法集中，可按域拆 |
| 343 | `src/view/native/ui/goal-bar.tsx` | medium | 可评估：目标条 + 内联编辑 + 动作按钮，可拆纯逻辑 |
| 317 | `src/service/plugin-inventory.ts` | medium | 可评估：清单解析 / 缓存 / 锚点解析，可拆解析与缓存 |
| 286 | `src/service/locator.ts` | low | 提示级：职责单一可不动 |
| 282 | `src/view/native/ui/tool-row.tsx` | low | 提示级：职责单一可不动 |
| 264 | `src/service/plugin-catalog.ts` | low | 提示级：职责单一可不动 |
| 261 | `src/service/plugin-patch.ts` | low | 提示级：职责单一可不动 |
| 231 | `src/settings/schema.ts` | low | 提示级：职责单一可不动 |
| 226 | `src/view/native/ui/model-menu.tsx` | low | 提示级：职责单一可不动 |
| 215 | `src/view/native/native-chat-view.tsx` | low | 提示级：职责单一可不动 |
| 214 | `src/settings/sections/service.ts` | low | 提示级：职责单一可不动 |
| 206 | `src/view/native/mention.ts` | low | 提示级：职责单一可不动 |
| 200 | `src/view/native/ui/team-panel.tsx` | low | 提示级：职责单一可不动 |
| 194 | `src/view/native/editor-selection.ts` | low | 提示级：职责单一可不动 |
| 191 | `src/view/native/ui/context-meter.tsx` | low | 提示级：职责单一可不动 |
| 180 | `src/view/native/note-links.ts` | low | 提示级：职责单一可不动 |
| 178 | `src/view/native/slash.ts` | low | 提示级：职责单一可不动 |
| 176 | `src/view/native/ui/menu-shell.tsx` | low | 提示级：职责单一可不动 |
| 170 | `src/view/native/ui/chat-node-data.ts` | low | 提示级：职责单一可不动 |
| 166 | `src/view/native/quote.ts` | low | 提示级：职责单一可不动 |
| 153 | `src/shared/types.ts` | low | 提示级：职责单一可不动 |
| 151 | `src/view/native/ui/subagent-panel.tsx` | low | 提示级：职责单一可不动 |

**优先级**：批次 3 只建议动 `composer.tsx` 与 `settings/sections/chat.ts`（≥500 且非例外）；其余 300~500 行的文件先记录，等改动触及时再拆。

## 2. 无调用方导出与死文件

### 2.1 高置信无调用方（全仓代码 0 引用，建议删 / 复用）

| 位置 | 导出 | 证据 | 处理 |
|---|---|---|---|
| `src/service/plugin-inventory.ts:296` | installAnchors | 全仓代码引用 0 次（本文件 0 / 其他文件 0）；docs 与 skills 提及 1 次。 | 删除（与 catalog 的 anchorsOf 重复） |
| `src/service/port-dsh.ts:278` | listPortListeners | 全仓代码引用 0 次（本文件 0 / 其他文件 0）；docs 与 skills 提及 3 次。 | 先确认是否留作原语；不留则删 |
| `src/service/skill-catalog.ts:30` | clearSkillCatalogCache | 全仓代码引用 0 次（本文件 0 / 其他文件 0）；docs 与 skills 提及 0 次。 | 删除（无引用、无文档） |

### 2.2 仅本文件引用（export 多余，67 条低风险整理）

这些符号不是死代码，只是**不需要 `export`**：去掉关键字即可（行为不变），或确认外部用途后保持现状。逐文件清单（`符号@行号`）：

| 文件 | 符号 | 建议 |
|---|---|---|
| `src/service/locator.ts` | `DesktopAppInstall@36`、`desktopAppRoots@52`、`listDesktopAppInstalls@89`、`ResolvedDshInstall@185` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/manager.ts` | `DshServiceConfig@15`、`DshServiceOptions@46` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/plugin-bundles.ts` | `SetBundleOptions@12`、`SetBundleResult@22`、`BundleEdit@29`、`editBundlesJson@36` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/plugin-catalog.ts` | `OptionalCatalogOptions@38` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/plugin-inventory.ts` | `PluginInventoryOptions@33`、`ParsedPluginBundle@145`、`parsePluginDump@157` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/plugin-patch.ts` | `TogglePluginOptions@14`、`TogglePluginResult@25`、`PatchEdit@36`、`editPatchText@54` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/port-dsh.ts` | `isProcessAlive@306` | 去掉 export 或确认外部用途后降为私有 |
| `src/service/skill-catalog.ts` | `skillRoots@35` | 去掉 export 或确认外部用途后降为私有 |
| `src/settings/schema.ts` | `STREAM_REFRESH_MS@5`、`DEFAULT_QUOTE_EXCERPT_LIMIT@17`、`DEFAULT_SETTINGS@182` | 去掉 export 或确认外部用途后降为私有 |
| `src/settings/scope-candidates.ts` | `ScopePathKind@17` | 去掉 export 或确认外部用途后降为私有 |
| `src/settings/tab.ts` | `SettingsSectionId@10` | 去掉 export 或确认外部用途后降为私有 |
| `src/shared/native-types.ts` | `NativeModelReasoning@96`、`NativeModelFailure@114`、`NativePermissionOption@127`、`NativeChatLiveBlock@166`、`NativeContextPressure@182`、`NativeSubagentInfo@251`、`NativeGoalPhase@288`、`NativeGoalBlockedReason@291`、`NativeGoalError@317`、`NativeBridgeErrorReason@328` | 去掉 export 或确认外部用途后降为私有 |
| `src/shared/types.ts` | `DshBridgeState@57` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/command-scope.ts` | `NATIVE_UNSUPPORTED_COMMANDS@20` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/note-links.ts` | `FileLinkTarget@11`、`FolderLinkTarget@18`、`noteLinkOf@31`、`isLinkSafe@35`、`folderChipOf@61` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/quote.ts` | `QuoteExcerpt@38`、`ParsedQuote@44` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/slash.ts` | `SlashCommandSpec@29`、`SLASH_COMMANDS@37` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/chat-node-data.ts` | `categoryOfTool@82` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/context-meter.tsx` | `ContextOccupancy@14`、`contextOccupancy@21`、`formatTokenCount@36` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/goal-bar.tsx` | `GoalBarProps@16` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/model-brand.tsx` | `ModelMark@19`、`ModelBrand@21`、`resolveModelBrand@62`、`ModelChip@70` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/native-chat-root.tsx` | `NativeChatRootProps@106` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/permission-icon.tsx` | `PermissionVisual@4`、`permissionVisual@18` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/permission-menu.tsx` | `ConfirmModal@7` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/run-status.tsx` | `formatRunDuration@31` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/timeline-model.ts` | `ProcessStatus@26`、`TextItem@40`、`NodeItem@48`、`TimelineItem@53` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/tool-row.tsx` | `toolTitle@109`、`prettyJson@217` | 去掉 export 或确认外部用途后降为私有 |
| `src/view/native/ui/turn-end.ts` | `SilentTurnEnd@12` | 去掉 export 或确认外部用途后降为私有 |

其中 `DEFAULT_SETTINGS`（`src/settings/schema.ts`）是 AGENTS 规定的单点默认值来源，**保留 export**，不按本条处理。

删除前按 `skills/project-review/references/checks.md` 的 8 条确认清单过一遍（全仓 grep 含 docs / packages / skills；桥契约；动态引用；外部脚本）。

## 3. 重复实现

### 3.1 重复代码块（13 条）

| 位置 | 规模 | confidence | 人工判断 |
|---|---|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js:842` | 节省 12 行 | low | 同文件内重复；桥单文件契约，优先保持现状（候选，不合并） |
| `src/service/plugin-bundles.ts:104` | 节省 10 行 | medium | 与 plugin-patch.ts:195 的 createBackup 同构；收敛到 service 内公共文件 |
| `src/service/plugin-bundles.ts:118` | 节省 18 行 | medium | 与 plugin-patch.ts:210 的 writeAtomic 完全同构；收敛为原子写工具 |
| `src/service/plugin-catalog.ts:177` | 节省 12 行 | medium | anchorsOf() 与 inventory 的 installAnchors() 同逻辑；后者还无人调用，可先删 / 复用 |
| `src/service/plugin-catalog.ts:255` | 节省 8 行 | medium | safeMtime() 与 inventory 同实现；抽 service 公共工具 |
| `src/service/plugin-inventory.ts:225` | 节省 8 行 | medium | unquoteYaml() 与 plugin-patch 同实现；抽 service 公共工具 |
| `src/view/native/ui/composer.tsx:504` | 节省 9 行 | low | 同文件 JSX 样板，可能可抽小函数（候选） |
| `src/view/native/ui/composer.tsx:592` | 节省 8 行 | low | 同文件 JSX 样板（候选） |
| `src/view/native/ui/goal-bar.tsx:32` | 节省 66 行 | low | 同文件 7 处相似 JSX 属性模板；抽组件前先确认是否只是结构相似（候选） |
| `src/view/native/ui/goal-bar.tsx:52` | 节省 12 行 | low | 与上一块重叠的同文件 JSX 模板（候选，不重复计工作量） |
| `src/view/native/ui/menu-shell.tsx:37` | 节省 10 行 | low | 同文件浮层定位 effect 两处相似（候选） |
| `src/view/native/ui/pending.tsx:291` | 节省 16 行 | low | 同一卡片的两个渲染分支高度相似，可抽渲染函数（候选） |
| `src/view/native/ui/timeline-nodes.tsx:79` | 节省 13 行 | low | 两类节点渲染相似，可抽节点外壳（候选） |

**已核实的跨文件重复**（建议收敛到 `src/service/` 内公共工具，不跨域进 `shared/`）：

- `createBackup` / `writeAtomic`：两份逐行同构，可抽 `service/file-atomic.ts`；
- `safeMtime`：两处各一份（7 行），可并入上述工具或 `service/file-meta.ts`；
- `unquoteYaml`：两处各一份，可抽 `service/yaml-scalar.ts`；
- `anchorsOf` / `installAnchors`：同一套安装锚点解析；删后者即可消除重复。

### 3.2 同名导出

无（没有同名导出出现在 2 个以上文件）。

### 3.3 重复字面量（5 条）

| 位置 | 字面量 | 评估 |
|---|---|---|
| `src/main.ts:167` | 持久化键 persist:dsh-obsidian | 持久化分区名，当前是唯一来源（main.ts 内联）；建议移到 shared/constants.ts |
| `src/settings/sections/plugins.ts:153` | profile obsidian | 提示文案里的兜底 profile；改用当前 settings / DEFAULT_SETTINGS.profile |
| `src/settings/sections/service.ts:25` | 端口 3081 | 占位符硬编码端口；改用 DEFAULT_SETTINGS.port（显示值不变） |
| `src/settings/sections/service.ts:41` | profile obsidian | 占位符硬编码 profile；改用 DEFAULT_SETTINGS.profile |
| `src/settings/sections/service.ts:44` | profile obsidian | 空输入兜底值硬编码；改用 DEFAULT_SETTINGS.profile |

## 4. 结构漂移

无。检过的项：`service/` 未 import `obsidian`；`view/` 未 import `main.ts` 或 `service` 实现；`settings/`、`shared/` 无反向依赖；无 `index.ts` barrel；src 与 packages 互不 import；根目录无杂项。

## 5. 遗留标记

无。`TODO` / `FIXME` / `HACK` / `XXX` / `@ts-ignore` / `@ts-expect-error` 在代码里均未命中（扫描器跳过自身）。

## 6. 文档漂移

### 6.1 相对链接断链

无。扫描 `docs/`（排除 `docs/changes/` 历史提案）、`skills/*/SKILL.md`、`README.md`、`AGENTS.md`：78 个 Markdown、219 条相对链接、0 断链。

### 6.2 改动地图缺登记（5 条）

| 文件 | 评估 |
|---|---|
| `src/shared/async.ts` | 误报：development.md 的 shared/ 汇总行已写 sleep()，无需单列 |
| `src/shared/errors.ts` | 误报：development.md 的 shared/ 汇总行已写 errorText()，无需单列 |
| `src/view/native/ui/session-picker.tsx` | 未登记：建议并入 ui/ 汇总行（会话浮层） |
| `src/view/native/ui/turn-end-hint.tsx` | 未登记：建议并入 ui/ 汇总行（静默结束兜底） |
| `src/view/native/ui/turn-end.ts` | 未登记：建议并入 ui/ 汇总行（静默结束判定） |

## 7. 建议重构批次

### 7.1 批次汇总

| 批次 | 内容 | 涉及文件 | 风险 | 验证 |
|---|---|---|---|---|
| 1 文档同步 | 补 3 条改动地图登记；2 条误报只需确认 | `docs/development.md` | 零代码风险 | `npm run check`；grep 确认新登记存在 |
| 2 导出清理 | 删 3 条高置信死导出；67 条「去掉多余 export」可分文件小批 | `service/*.ts` 与 view/settings 若干 | 低（删前 grep + 确认桥契约；listPortListeners 需先决定） | `npm run build` + `npm run check`；grep 目标符号无输出 |
| 3 纯搬运拆分 | 只拆 composer.tsx（702）与 chat.ts（568）；先搬不改 | `view/native/ui/`、`settings/sections/` | 中（diff 大，需重载插件手动回归） | 每拆一个文件 build；导出名 / 文案 / 类名计数不变；手动回归输入框与聊天设置 |
| 4 收敛重复 | 抽 service 文件工具（createBackup / writeAtomic / safeMtime / unquoteYaml）；5 条契约值改用 DEFAULT_SETTINGS / shared/constants | `service/plugin-*.ts`、`settings/sections/service.ts` 等 | 中（需证明行为等价；无单测） | build + check + 31 项服务冒烟（沿用 0031/0032/0056）；手动回归插件启停 / 重启服务 |

### 7.2 需要你拍板

| 选项 | 范围 | 工作量 | 风险 | 说明 |
|---|---|---|---|---|
| A（推荐） | 批次 1 + 2 | 小 | 低 | 先清死码与文档，零行为风险；listPortListeners 若保留，批次 2 只删另 2 条 + 67 条去 export |
| B | 批次 1 + 2 + 3 | 中 | 中 | 多一次 composer.tsx / chat.ts 大 diff，需重载插件回归输入框与设置页 |
| C | 全部（1~4） | 大 | 中高 | 收敛重复要证明行为等价；仓库无单测，回归面最大 |

- [ ] 选哪一项（默认推荐 A；选别的请说明）
- [ ] `listPortListeners` 保留为原语还是删除？（影响批次 2 范围）
- [ ] 6 组同文件 JSX 重复：本轮只记录，还是抽组件（需另行排期）？

### 7.3 验收标准（可判定）

| 验收项 | 命令 | 期望 |
|---|---|---|
| 死导出已删 / 已复用 | `grep -rn -e installAnchors -e listPortListeners -e clearSkillCatalogCache src packages docs skills` | 无输出（或只剩提案历史记录） |
| 多余 export 已收敛 | 重跑 `node skills/project-review/scripts/audit.mjs --json` | unused-export 数量显著下降，剩余每条有理由 |
| 超长文件已拆 | `wc -l src/view/native/ui/composer.tsx src/settings/sections/chat.ts` | 均 < 300 行（或提案写明例外与理由） |
| 构建与检查 | `npm run build` / `npm run check` | 通过，main.js 为最新构建 |
| 行为不变 | `docs/development.md`「现状与手动回归」相关项 | 输入框发送 / 设置页 / 插件启停 / 重启服务逐条通过 |

## 附：复现方式

```bash
node skills/project-review/scripts/audit.mjs                 # 人读 Markdown
node skills/project-review/scripts/audit.mjs --json > /tmp/audit.json   # 结构化 findings
node skills/project-review/scripts/audit.mjs --top 20        # 每类最多 20 条
```

扫描器只读、零依赖、约 0.1s；报告里的数字（文件数 / 行数 / 引用数）以当场命令输出为准。

> 复现口径：本报告的 127 条已用 `git worktree add /tmp/head-wt <本报告对应的 HEAD>` + `node skills/project-review/scripts/audit.mjs --root /tmp/head-wt --json` 核过（同一默认参数）。`duplicate-block` 一类受全仓 shingle 索引影响，比较时应按清单逐条看，不要只看条数。
> 执行结果见 [0065](0065-structure-refactor.md) 第 9 节。

> 编号说明：本报告占用 `0064`；若确认重构，提案用 `R-47` + `docs/changes/0065-*.md` 并链接本报告，避免与报告号冲突。
