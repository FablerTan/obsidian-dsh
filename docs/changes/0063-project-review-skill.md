---
status: done
created: 2026-10-28
approved: 2026-10-28
scope: skills/project-review, docs/skills.md, docs/README.md, skills/README.md, skills/project-guide, docs/roadmap.md, docs/changes
issue: 用户要一个可复用的「审阅项目」技能：自动排查冗余、重复定义、结构混乱、超长文件等结构债，整理成分级报告给用户，用户确认后再在不改功能的前提下分批重构
---

# 0063 新增 project-review 技能：审阅 → 报告 → 用户确认 → 不改功能分批重构

## 1. 背景与问题

审阅需求一直存在，但此前只有一次性人工排查（[0011](0011-redundancy-cleanup.md)：删 3 个无调用方导出、收敛 7 处重复错误文案、拆 571 行的 `menus.tsx` 与 398 行的 `timeline.tsx`、删桥 v1 段），没有沉淀成可复用流程：

| 问题 | 现状 | 后果 |
|---|---|---|
| 结构债靠碰运气发现 | 0011 之后没有系统性扫描；新文件只靠 `project-guide` 的落位规则约束 | 无调用方导出、重复工具函数、超长文件继续累积 |
| 判断缺机械证据 | 新会话 agent 容易通读全仓后凭印象说「这里可以优化」 | 结论不可判定、误删风险高、用户无法复核 |
| 审阅与改动没有闸门 | 直接改代码会违反 AGENTS 规则 12/13（先登记、先比路径、用户选路） | 重构范围膨胀，或改着改着顺手改行为 |
| 项目无单测 / CI | 只能靠 `npm run build` + `npm run check` + 手动回归兜底 | 「不改功能」必须靠批次纪律，而不是测试 |

本次用户直接要求「创建一个审阅项目的 skills」，属于 `docs/changes/README.md`「不需要提案的改动」第 2 条（用户当轮已明确指定、视为已批准），但仍按规则补本提案记录。

## 2. 目标与非目标

**目标**

- 一个可复用技能：`skills/project-review`，DSH 从 `.dsh/skills/project-review` 符号链接发现。
- 机械扫描器 `scripts/audit.mjs`：零依赖、只读，输出超长文件 / 无调用方导出 / 死文件 / 重复代码块 / 同名导出 / 重复字面量 / 分层违规 / barrel / 根目录杂项 / TODO / 文档断链 / 改动地图缺登记，附 file:line 证据。
- 报告模板与判定标准：把「什么问题算问题、误报怎么排、严重度怎么定」写成可判定规则，而不是「建议优化」。
- 流程：审阅 → 分级报告 → **用户确认** → 按 AGENTS 12/13 登记 R-n + 提案（≥ 2 路径）→ 用户选路 → 分批纯搬运/删死码 → 每批 build + check → 收尾写实施记录。
- 「不改功能」硬边界写进技能：命令 id / Notice 文案 / 状态条文案 / 时序参数 / 默认值 / 桥 v8 契约 / 用户可见交互。

**非目标**

- 不做自动修复（`--fix`）、不加 CI 门禁、不新建 `docs/reviews/` 报告目录（见路径 B，留作可选扩展）。
- 不改任何 `src/` / `packages/` / `styles.css`；本轮不重构代码，只交付技能与文档。
- 不替代 `project-guide` 的日常落位决策；两者分工：审阅找问题，guide 决定新代码放哪。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）纯技能包** | `skills/project-review/`：`SKILL.md` + `scripts/audit.mjs`（只读扫描）+ `references/checks.md`（13 类判定与误报排除）+ `references/report-template.md`；报告默认在对话里给「摘要 + 批次 + 拍板项」，完整报告按需 `--out docs/changes/NNNN-<slug>-audit.md`；重构继续复用现有 roadmap + 提案流程 | 只新增 skills/ 与文档登记；不动 `src/`、构建、依赖 | 低。脚本是启发式，必须人工复核；不新增自动门禁，结构债仍靠人触发审阅 | 采用 |
| B 技能 + 工程化 | A 之上再加：`docs/reviews/` 报告目录与索引、`npm run audit` 脚本、CI 在 PR 上 `--fail-on-high`、`--fix` 自动纯搬运 | skills/ + docs/ + package.json + CI；自动修复会直接改 `src/` | 高。仓库无单测 / CI（M5 还在候选池），自动修复没有测试兜底，且与「用户确认后再改」的闸门冲突；报告目录会新增一类需长期维护的文档 | 不做，留作可选扩展 |
| C 一次性审阅 | 不建技能，只跑一次人工排查出报告 | 无 | 最低，但不可复用，下个会话又从零开始 | 不选 |

> 推荐 A 的理由：审阅的价值在「证据 + 闸门 + 可复用流程」，不在自动化改码；项目没有单测，任何自动改写都放大回归风险。B 的自动修复应等 M5 有 CI 之后再评估。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `skills/project-review/SKILL.md` | 新增：定位与边界、六阶段流程、扫描器用法、人工复核顺序、报告要求、记账衔接、分批重构守则、验收清单、反模式 |
| `skills/project-review/scripts/audit.mjs` | 新增：零依赖只读扫描器（Markdown / `--json` / `--out` / `--root` / `--top` / `--min-block`） |
| `skills/project-review/references/checks.md` | 新增：13 类问题的检测方式、取证标准、误报排除、严重度与处理方式 |
| `skills/project-review/references/report-template.md` | 新增：与扫描器同名同序的报告模板 + 填写示例 |
| `.dsh/skills/project-review` | 新增符号链接 → `../../skills/project-review` |
| `docs/skills.md` / `skills/README.md` | 登记新技能与扫描命令 |
| `docs/README.md` | `skills.md` 行的描述补上项目审阅 |
| `skills/project-guide/SKILL.md` | 查询地图 / 相关文档加入「审阅项目」入口 |
| `docs/roadmap.md` | 「需求待办」加 `R-46` |
| `docs/changes/README.md` | 索引加 0063 |

**不改**：`src/`、`packages/`、`styles.css`、`main.js`、`manifest.json`、默认值、命令 id、桥契约。

## 5. 行为变化

- 插件运行时：**无**。不动源码与构建配置，`main.js` 不重新生成。
- 仓库层面：新增一个可供 agent 加载的技能（Obsidian 重载插件 / 新会话后出现在技能 catalog）、一个只读扫描脚本、四份文档登记。
- 用户可见：无 UI 变化；后续用该技能审阅时，会先拿到分级报告，确认后才进入提案与重构。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 扫描器启发式误报（重复块 / 无调用方导出） | 误删仍在使用的导出或产生噪音报告 | 技能强制「人工复核 + grep 全仓含 docs/packages/skills」；未确认前不删；删前查桥契约 |
| 技能流程与 AGENTS 规则漂移 | 下个会话按错误流程直接改码 | SKILL.md 明确「冲突以 AGENTS 为准」，并把 12/13 的登记/选路步骤写进阶段 4；本提案同步 |
| 符号链接失效 | 技能不出现在 catalog | `ln -sfn ../../skills/project-review .dsh/skills/project-review` 重建；docs/skills.md 有约定 |
| 扫描结果不稳定 / 太慢 | 无法复核 | 要求确定性排序、只读、无第三方依赖；自验含两次输出 diff |

## 7. 验证

自动化：

```bash
node --check skills/project-review/scripts/audit.mjs
node skills/project-review/scripts/audit.mjs --top 10          # 7 个章节齐全、无崩溃
node skills/project-review/scripts/audit.mjs --json | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"
npm run check                                                  # 本轮未改 src / 构建配置
readlink .dsh/skills/project-review                            # → ../../skills/project-review
```

验收标准：

- [x] 扫描器在仓库根秒级完成，输出含 file:line 证据；连跑两次除生成时间外完全一致；`--json` 可解析
- [x] 扫描器对 `/tmp` fixture 能命中：无调用方导出、重复代码块、分层违规、文档断链
- [x] 技能 frontmatter `name` = `project-review` = 目录名；文中引用的仓库路径均存在
- [x] `docs/skills.md` / `skills/README.md` / `docs/README.md` / `project-guide` 均已登记
- [x] `npm run check` 通过；`git status` 只多出预期文件，无 `src/` / `main.js` 改动
- [x] 用户在 Obsidian 里重载插件后，技能目录出现 `project-review`（本会话技能 catalog 已自动发现，无需重载）

## 8. 需要你拍板

- [ ] 是否按路径 A 交付（本轮已按 A 实施；若想改成 B 的 `docs/reviews/` + CI 门禁 + 自动修复，另开提案）
- [ ] 是否现在就让我用这个技能跑一次全仓审阅，把报告给你确认后再进入重构（本轮未做，等你决定）
- [ ] 以后审阅的触发方式：你主动说「审阅项目」，或每完成若干需求做一次例行审阅（建议后者，成本低）

## 9. 实施记录

2026-10-28 实施（用户本轮明确要求「创建审阅项目的 skills」，按 [changes/README](README.md)「不需要提案的改动」第 2 条视为已批准，采用路径 A）。

**交付文件**

| 文件 | 行数 | 内容 |
|---|---|---|
| `skills/project-review/SKILL.md` | 349 | 定位与边界、六阶段流程、扫描器契约、人工复核、报告要求、记账、分批重构、验收清单、反模式 |
| `skills/project-review/scripts/audit.mjs` | 1511 | 零依赖只读扫描器：13 个 category、8 个固定章节、--json / --out / --root / --top / --min-block |
| `skills/project-review/references/checks.md` | 304 | 13 类问题的检测 / 取证 / 误报 / 严重度 / 处理方式 + 4 个专节 |
| `skills/project-review/references/report-template.md` | 198 | 与扫描器同名同序的报告模板、批次表、拍板项、验收表 |
| `.dsh/skills/project-review` | — | 符号链接 → `../../skills/project-review` |

**扫描器自验**（scan-builder 实现 + Lead 复核）

- `node --check` 通过；仓库根运行约 0.10s，`## 0.`–`## 7.` 八个章节齐全，无 undefined / NaN。
- 连跑两次：除「生成时间」外逐字节一致；`--json` 可 parse，字段 / 取值域 / 排序符合契约。
- `--out` 写文件成功（Markdown / JSON 各自），stdout 只有一行「已写入 …；findings N 条」。
- `/tmp` fixture 命中：unused-export / dead-file / duplicate-block / layer-violation / doc-missing-file 各至少 1 条。
- 参数 / IO 错误 exit 2，有 findings exit 0；扫描前后 `git status` / `git diff` 不变（只读）。
- 当前仓库 findings 127 条：long-file 34（含 main.ts / native-chat-root.tsx / client.js 三条已知例外 info）、
  unused-export 70（high 3 / 仅自引用 low 67）、duplicate-block 13（跨文件 3 条 medium）、magic-literal 5、doc-map-missing 5；
  dead-file / layer-violation / barrel / cross-package / root-clutter / todo-marker / doc-missing-file 均为 0。
  去注释行后 duplicate-block 由 10 增至 13（新增 3 条均为真实代码：safeMtime ×2、unquoteYaml ×2、menu-shell 浮层定位 useLayoutEffect）。

**接入与文档**

- `.dsh/skills/project-review -> ../../skills/project-review`；本会话技能 catalog 已出现 `project-review`（DSH 自动发现）。
- `docs/skills.md`、`skills/README.md`、`docs/README.md`、`skills/project-guide/SKILL.md` 已登记；roadmap `R-46`、本提案、`docs/changes/README.md` 索引三处互链一致。
- 文档相对链接检查（排除 `docs/changes/` 历史提案与 `skills/*/data`）：78 个 Markdown、219 条相对链接、0 断链（2026-10-28 实测）。
- 首次全仓审阅（只读、未立项）：[0064-project-review-audit.md](0064-project-review-audit.md)（2026-10-28；127 条候选，重构范围待用户确认）。

**验证**

- `node --check skills/project-review/scripts/audit.mjs` 通过。
- `node skills/project-review/scripts/audit.mjs` / `--json` / `--out` / `--root` 均按契约工作（明细见上）。
- `npm run check` 全绿（本轮未改 `src/` 与构建配置，`main.js` 未变）。
- 独立只读验收（review-verifier）：契约 / 实跑 / 只读性 / 5 类证据抽查 / 文档登记 / 规则衔接均通过；其指出的代码问题
  （`--root` 子树下例外与白名单失效、`--top` 对 doc-map 无效、纯注释块被当重复代码、报告头计数口径）
  与文档问题（checks.md 两处范围/措辞、SKILL.md 状态条证据、本记录数字）已全部修复并复验。
- `git status`：只新增 `skills/project-review/`、`.dsh/skills/project-review` 与本次文档改动；无 `src/` / `packages/` 改动；`styles.css` 的改动来自上一需求 0062。

**偏差与说明**

- SKILL.md 结构：阶段 1/2 的细节合并进第 2 节（全文 0–9 共 10 节），流程、判据与验收不变。
- 扫描器默认 root：向上查找 `package.json` + `AGENTS.md` 定位仓库根（保留 3 级兜底），避免从 `skills/project-review/scripts` 数错层级。
- 质量类扫描范围收窄为 `src/` + `packages/`：工具脚本（`scripts/`、`skills/*/scripts/`）不计入结构指标，避免自指噪声。
- 未做路径 B（`docs/reviews/` 报告目录 + CI 门禁 + `--fix` 自动修复）；自动改码与「用户确认后再改」冲突，且仓库无单测兜底，留作 M5 有 CI 后再评估。
- **本轮不改任何 `src/` / `packages/` 代码**：审阅报告与重构等用户确认后，按「报告 → R-n + 提案（≥ 2 路径）→ 选路 → 分批重构」执行。

