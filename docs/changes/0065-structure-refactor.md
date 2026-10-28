---
status: approved
created: 2026-10-28
approved: 2026-10-28
scope: src/service, src/view, src/settings, src/shared, docs
issue: 按 0064 审阅报告执行结构重构（批次 1–4：文档同步 / 导出清理 / 超长文件拆分 / 重复收敛），不改功能
---

# 0065 结构重构：文档同步 / 导出清理 / 超长文件拆分 / 重复收敛

## 1. 背景与问题

[0064](0064-project-review-audit.md) 由 `project-review` 技能产出（只读扫描 + 人工复核，127 条候选）。结论：

- 结构债集中在两处 UI：`src/view/native/ui/composer.tsx` 702 行、`src/settings/sections/chat.ts` 568 行——唯二 ≥500 的非例外文件；
- 死代码少，但有 3 条高置信无调用方导出：`installAnchors` / `listPortListeners` / `clearSkillCatalogCache`；另有 66 个符号「只需去掉 `export`」（低风险整理）；
- 5 组跨文件重复：`createBackup` / `writeAtomic` / `safeMtime` / `unquoteYaml` / `anchorsOf`；另有 5 条契约值散落在实现里；
- 分层违规 / barrel / 跨包互引 / 根目录杂项 / TODO / 文档断链全部为 0（除 3 条改动地图漏登记）——这些**不做**。

本提案是 0064 的执行面：只做「减法 + 纯搬运 + 等价收敛」，**不改任何用户可见行为**。

## 2. 目标与非目标

- 目标：按 0064 的 4 个批次落地；结束时无死导出、两处超长文件 < 400 行、重复实现收敛到 `service/` 内公共文件。
- 非目标（明确不做，防范围膨胀）：
  - 不拆 0064 的 3 个已知例外（`src/main.ts`、`native-chat-root.tsx`、桥 `client.js`）与纯类型 `shared/native-types.ts`；
  - 不合并 0064 列出的 6 组同文件 JSX 样板（结构相似 ≠ 语义等价，本轮只记录）；
  - 不动桥 v8 契约、命令 id、Notice / 状态栏文案、时间常量（80ms / 15s / SIGTERM 3000ms）与 `DEFAULT_SETTINGS` 默认值；
  - 不顺手改功能、不改视觉、不调整行为分支。

## 3. 实现路径调研

### 3.1 范围路径（0064 7.2，用户已选）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| A（推荐） | 批次 1+2：文档登记 + 删死导出 / 去多余 export | docs + 约 25 个 src 文件，纯删减 | 低：无行为变化，构建即可验证 | 范围最小 |
| B | A + 批次 3：拆 `composer.tsx` / `chat.ts` | 再加大 diff 纯搬运 | 中：需重载插件回归输入框与聊天设置 | — |
| C | 全部 1–4：再收敛 service 重复实现与契约值 | 再加 `service/` 5 个文件 + settings 2 个文件 | 中高：无单测，需证明行为等价 + 服务冒烟 | **用户 2026-10-28 选定** |

### 3.2 批次内的技术做法（实现细节，按推荐执行，偏离要记「变更记录」）

| 取舍 | 采用 | 理由 | 备选（未采用） |
|---|---|---|---|
| `composer.tsx` 拆分边界 | 保留 `Composer` 壳（状态 / 输入区 / 键盘编排），把「@ 与 / 菜单候选构造 / 菜单渲染」和「附件 / 引用条 / 运行提示等子渲染」抽成同目录文件 | 按职责切，跨文件只传 props 与回调，不动状态归属 | 抽自定义 hook：状态跨文件，diff 更大也更易走样 |
| `chat.ts` 拆分边界 | `chat.ts` 只留卡片调度；三个 scope 卡 + 名单面板 + `ScopePickerModal` 移到 `chat-scope.ts` | 现有函数已按卡片分组，天然可搬运 | 每张卡一个文件：文件数膨胀 |
| `service` 重复实现落位 | 新增 `src/service/file-atomic.ts`（`createBackup` / `writeAtomic` / `safeMtime`）与 `src/service/yaml-scalar.ts`（`unquoteYaml`）；`anchorsOf` 复用（删 `installAnchors`） | 都在 service 域内，不把文件 IO 细节跨域塞进 `shared/` | 放 `shared/`：违反 shared 只放基础件的约定 |
| 契约值收敛 | 持久化键移到 `shared/constants.ts`；端口 / profile 改引用 `DEFAULT_SETTINGS` | 单一来源，符合 AGENTS 规则 3 | 就地保留：重复定义风险仍在 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `docs/development.md` | 批次 1：ui/ 汇总行补 `session-picker.tsx` / `turn-end.ts` / `turn-end-hint.tsx`；批次 2：`port-dsh` 行去掉 `listPortListeners` |
| `src/service/plugin-inventory.ts` / `port-dsh.ts` / `skill-catalog.ts` | 删 `installAnchors` / `listPortListeners` / `clearSkillCatalogCache` |
| 66 个符号（约 25 个文件） | 去掉多余 `export`（`DEFAULT_SETTINGS` 保留，规则 3） |
| `src/view/native/ui/composer.tsx` + 新增同目录文件 | 纯搬运拆分（< 400 行） |
| `src/settings/sections/chat.ts` + 新增 `chat-scope.ts` | 纯搬运拆分（< 400 行） |
| `src/service/plugin-bundles.ts` / `plugin-patch.ts` / `plugin-catalog.ts` / `plugin-inventory.ts` | 改用 `file-atomic.ts` / `yaml-scalar.ts` |
| `src/shared/constants.ts`、`src/main.ts` | 持久化键单一来源 |
| `src/settings/sections/service.ts` / `plugins.ts` | 端口 / profile 改引用 `DEFAULT_SETTINGS` |
| `docs/roadmap.md` / `docs/changes/README.md` / 本文件 | 登记与收尾 |

## 5. 行为变化

无。逐条说明：

- **删导出**：三个符号全仓 0 调用（含 `docs/` / `packages/` / `skills/` grep）；产物里不再包含它们，用户不可见。
- **去 `export`**：只收窄模块导出面，文件内引用与运行结果不变。
- **纯搬运拆分**：导出名、JSX 文案、CSS 类名、事件绑定、hook 顺序不变；拆分后 `wc -l` 下降，grep 文案 / 类名计数与拆分前一致。
- **收敛重复**：新工具逐行等价于原实现（备份命名 `.bak-<时间戳>`、临时文件 + rename、mtime 读取、YAML 标量去引号），失败回滚路径不变。
- **契约值**：值不变（`3081` / `obsidian` / `persist:dsh-obsidian`），只改引用来源。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 去 `export` 误伤跨文件引用 | 构建报错 | `npm run build` 立即暴露；单文件 `git checkout` |
| 拆分漏搬样式类 / 文案 | 视觉或文案变化 | 拆分前后 grep 类名与文案计数对比；按批 commit 回滚 |
| 收敛重复时行为微差（mtime 精度 / YAML 引号 / 备份命名） | 插件启停或 bundle 切换异常 | 保留原实现语义逐行对照；31 项服务冒烟 + 手动启停回归 |
| 大 diff 夹带功能改动 | 违反「不改功能」 | 每批独立 commit；review 时 diff 中不出现逻辑新增 |

## 7. 验证

自动化：

```bash
npm run build && npm run check && npm run lint
node skills/project-review/scripts/audit.mjs --json    # unused-export / long-file / duplicate-block 显著下降
grep -rn -e installAnchors -e listPortListeners -e clearSkillCatalogCache src packages   # 无输出
wc -l src/view/native/ui/composer.tsx src/settings/sections/chat.ts                      # 均 < 400
```

手动回归（清单见 [development.md](../development.md#现状与手动回归)）：重新加载插件 → 状态栏 `DSH: 运行中` → 发消息看流式正文与上下文圆环 → @ 菜单与「/」菜单 → 设置页各 tab（聊天卡片 / 服务端口 / 插件启停）→「重启服务」→ 禁用插件后端口释放。

验收标准（可判定）：

- `npm run build` / `check` / `lint` 全绿，仓库 `main.js` 为最新构建；
- 三个死符号在代码目录 grep 无输出；
- `composer.tsx` / `chat.ts` 均 < 400 行；
- 审计对应类别（`unused-export` / `long-file` / `duplicate-block` / `magic-literal` / `doc-map-missing`）数量下降，剩余每条在本文件实施记录里给出保留理由。

## 8. 需要你拍板

- [x] 范围：**C**（全部 4 个批次，2026-10-28 确认）
- [x] `listPortListeners`：**删除**（2026-10-28 确认；全仓 0 调用，非 0056 运行路径）
- [ ] 6 组同文件 JSX 重复：本轮只记录（建议保持；要抽组件需另行排期）

## 9. 实施记录

执行时间 2026-10-28。0064 的 4 个批次全部落地，build / check / lint 全绿。

### 9.1 批次 1：文档同步

- `docs/development.md`：ui/ 汇总行补 `session-picker.tsx` / `turn-end.ts` / `turn-end-hint.tsx`（0064 的 3 条漏登记），顺带修掉该行一处标点。
- 0064 的另 2 条（`shared/async.ts` / `errors.ts`）确认为误报：`shared/` 汇总行已写 `sleep` / `errorText()`，扫描器只按文件名匹配。

### 9.2 批次 2：导出清理

- 删除 3 条死导出（删前全仓源码 grep 0 引用）：
  - `src/service/plugin-inventory.ts` `installAnchors`（与 `plugin-catalog.ts` 的 `anchorsOf` 重复，后者保留）；
  - `src/service/port-dsh.ts` `listPortListeners`（无调用方，非 0056 的结束路径；`PortListener` 类型与 `listPortListenerPids` 保留）；
  - `src/service/skill-catalog.ts` `clearSkillCatalogCache`。
- 66 个「仅本文件引用」符号去掉 `export`（`DEFAULT_SETTINGS` 按规则 3 保留 export）。
- `docs/development.md` 的 `port-dsh` 行去掉已删符号。

### 9.3 批次 3：纯搬运拆分

| 文件 | 行数 |
|---|---|
| `src/view/native/ui/composer.tsx` | 702 → 398 |
| `src/view/native/ui/composer-mentions.tsx`（新） | 318 |
| `src/view/native/ui/composer-accessories.tsx`（新） | 163 |
| `src/view/native/ui/composer-props.ts`（新） | 68 |
| `src/settings/sections/chat.ts` | 568 → 98 |
| `src/settings/sections/chat-scope.ts`（新） | 397 |
| `src/settings/sections/scope-picker.ts`（新） | 91 |

- `Composer` 壳保留状态 / effects / 输入区 / 发送编排；@ 与「/」的候选构造、菜单渲染、键盘导航进 `composer-mentions.tsx`；压缩与模型提示、只读提示、底栏 chip 与上下文圆环进 `composer-accessories.tsx`；`ComposerProps` 类型进 `composer-props.ts`。
- `chat.ts` 只留调度与三个非范围卡片；三张范围卡 + 名单面板进 `chat-scope.ts`；候选 `SuggestModal` 进 `scope-picker.ts`。
- 等价性证据：CSS 类名 token 合计与逐类计数不变（composer 17 / chat `dsh-settings-scope` 26）；中文文案 token 数与按行多重集不变；保留段 diff 仅新增必要的 `export`。

### 9.4 批次 4：重复收敛与契约值

- 新增 `src/service/file-atomic.ts`：`createBackup` / `writeAtomic` / `safeMtime`，逐行等价于被删的 6 份副本（两类各 2 份）（备份名 `.bak-<本地时间戳>`、同秒加序号、mode 0600、临时文件 + rename、失败清理、mtime 截断）。
- 新增 `src/service/yaml-scalar.ts`：`unquoteYaml`，等价于 inventory / patch 两份副本。8 份函数副本收敛为 4 个导出（file-atomic 3 + yaml-scalar 1）。
- 行数：`plugin-bundles.ts` 143 → 106、`plugin-patch.ts` 261 → 214、`plugin-catalog.ts` 264 → 256、`plugin-inventory.ts` 317 → 283（其中批次 2 删 `installAnchors` 后先降到 300）。
- 契约值：`shared/constants.ts` 新增 `WEBVIEW_PARTITION`（`persist:dsh-obsidian`）并由 `main.ts` 引用；`settings/sections/service.ts` 的端口 / profile 占位与兜底、`settings/sections/plugins.ts` 的 profile 兜底改引用 `DEFAULT_SETTINGS`（渲染文字不变）。
- `plugin-catalog.ts` 的 `anchorsOf` 保留为单点实现。

### 9.5 验证结果

| 项 | 结果 |
|---|---|
| `npm run build` | 通过，`main.js` 已重建 |
| `npm run check` | 通过（版本三处一致 / tsc / 桥清单与语法 / `main.js` 与源码一致） |
| `npm run lint` | 0 error（31 warning，均为改动前既有） |
| 死符号 | `installAnchors` / `listPortListeners` / `clearSkillCatalogCache` 在 `src` + `packages` grep 无输出 |
| 拆分目标 | composer 398 / chat 98，均 < 400（提案验收线） |
| 审计重跑 | HEAD 快照（`--root` 指向 `git worktree` 的 HEAD）复现 0064 的 127 条；当前 46 条：`unused-export` 70 → 0，`magic-literal` 5 → 0，`doc-map-missing` 5 → 2（误报），`duplicate-block` 13 → 8（跨文件 5 组全部消失；composer 的 2 组同文件样板随搬运换了文件名仍属候选），`long-file` 34 → 36（新增文件均 < 400，无新增例外） |
| 独立复核 | 另一 agent 只读复核：逐函数 AST 对比 + 字面量 / JSX 属性多重集对比，结论「等价，未发现行为差异」（详见 9.6 / 9.7） |

### 9.6 与提案的偏差

1. `composer.tsx` 拆成 4 个文件而非 3 个：多一个纯类型 `composer-props.ts`——55 行 props 类型留在主文件会超过 400 行；属纯类型搬运，不改变行为。
2. 原 8 个 `useMemo` 收敛为 1 个 `buildSlashView()`：hook 数量变化，但仍在组件顶层无条件调用、顺序稳定；输出逐字等价（`commandNote` / `skillNote` / `items` / `open` 的判定顺序与边界一致），仅「草稿变化时整段重算」（几十条数组过滤，无用户可见差异）。
3. 菜单键盘导航抽成 `handleMenuKeyDown()` 纯函数（状态值与 setter 以回调传入）；主文件仍持有 IME 判定、Enter 路由与发送编排。
4. `plugins.ts` 那行文本拼接因加长改为多行对象字面量，渲染文字逐字节相同。
5. `settings/sections/service.ts` 端口说明里「默认 3081…」的散文未改（不是引号常量，改了会动渲染文字）。
6. `buildSlashView()` 合并 memo 后唯一可观察差异：`slashView.items` 数组 identity 更频繁更新，`SlashMenu` 的 `useEffect([active, items, commandNote, skillNote])` 可能多跑一次 `scrollIntoView({ block: 'nearest' })`——目标行已可见时不产生视觉 / 状态变化。

### 9.7 后续可选项（本轮不做，记录备查）

- `composer-mentions.tsx` 318 / `chat-scope.ts` 397 / `plugins.ts` 405 仍在 300–500 区间：若后续审计继续报，再按职责二拆（`renderScopePanel`、插件卡片渲染是最自然的切点）。
- 0064 列出的 6 组同文件 JSX 样板仍未合并（结构相似 ≠ 语义等价），保持记录。
- 0064 报告里的数字是重构快照，后续以重跑 `audit.mjs` 为准。
