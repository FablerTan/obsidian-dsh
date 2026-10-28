# 审阅检查清单（13 个 category）

配合 `skills/project-review/SKILL.md` 使用：扫描器 `skills/project-review/scripts/audit.mjs` 只产出**候选**，本文件定义每个 category 该
「怎么检测、什么算问题、怎么取证、哪些是误报、默认多严重、最后怎么处理」，供阶段 2 人工复核逐条对照。

约定：

- 本文件按扫描器 findings 的 `category` 取值逐条写，**13 条一个不多一个不少**；每条注明它落在报告哪一章（`1`–`6`）。
- 扫描器的 `severity` 取值 `high | medium | low | info`，`confidence` 取值 `mechanical | high | medium | low`；
  人工复核可以改判，但要在报告里写理由。
- 默认值只代表「脚本初判」，不是结论；`info` 项默认只记录，不排期。
- 复核结论写进报告时的章节与字段格式，见 `skills/project-review/references/report-template.md`（章节必须与扫描器同名同序）。
- 扫描范围按 category 分档（以 `audit.mjs` 实际行为为准）：
  质量类（`long-file` / `unused-export` / `duplicate-block` / `magic-literal`）**只扫 `src/` + `packages/`**，
  不再扫 `skills/`、`scripts/` 与扫描器自身；结构类、遗留标记、文档类仍按各自规则扫全仓（`root-clutter` 只查根目录条目、
  `doc-map-missing` 只拿 `src/` 比对 `docs/development.md`）。
- `--root <dir>` 指向子目录（如 `src/view`）时，质量类退化为扫描该根下全部代码，不再套 `src + packages` 过滤。

## 总表

| # | category | 中文标签 | 报告章节 | 默认 severity | 默认 confidence | 处理方式 |
|---|---|---|---|---|---|---|
| 1 | `long-file` | 超长文件 | `1` | 按行数：≥500 high / ≥300 medium / ≥150 low；三个已知例外固定 info | mechanical | 搬运拆分 |
| 2 | `unused-export` | 无调用方导出 | `2` | 0 引用 medium（`packages/` 下降为 low）；仅本文件引用 low | high / low | 删（先过确认清单） |
| 3 | `dead-file` | 死文件 | `2` | medium | medium | 删或只记录 |
| 4 | `duplicate-block` | 重复代码块 | `3` | medium | 跨文件 medium / 同文件 low | 收敛（确认等价后） |
| 5 | `duplicate-export-name` | 同名导出 | `3` | low | medium | 改名 / 合并 |
| 6 | `magic-literal` | 重复字面量 | `3` | info | mechanical | 只记录，值得才收敛 |
| 7 | `layer-violation` | 分层违规 | `4` | medium | high（硬违规）/ medium（view→service 视为候选） | 搬运 / 抽窄接口 |
| 8 | `barrel` | barrel 文件 | `4` | medium | mechanical | 删 barrel + 改 import |
| 9 | `cross-package` | src 与 packages 互引 | `4` | medium | mechanical | 收敛到契约 |
| 10 | `root-clutter` | 根目录杂项 | `4` | info | mechanical | 归位 / 删 |
| 11 | `todo-marker` | 遗留标记 | `5` | info | mechanical | 只记录 / 转需求 |
| 12 | `doc-missing-file` | 文档断链 | `6` | medium | high | 以代码为准改文档 |
| 13 | `doc-map-missing` | 改动地图缺登记 | `6` | info | low | 文档同步批次补 |

---

## 1. `long-file` — 超长文件（报告 `1`）

- **检测方式**：脚本只扫 `src/` + `packages/`（工具脚本不计入），按行数给候选（≥150 提示 / ≥300 建议拆 / ≥500 高优），
  `confidence` 为 `mechanical`；可用 `--top` 控制展示条数。
- **已知例外（脚本已内置）**：`src/main.ts`、`src/view/native/ui/native-chat-root.tsx`、
  `packages/dsh-obsidian-bridge/lib/client.js` 无论多少行都给 `severity: info`，`evidence` 写「已知例外，允许超长」。
  拿到的 `info` 超长条目**不需要再复核是否要拆**，只需在报告里引用本文件的例外理由。
- **什么算问题**：行数超判据**且**混了两个以上职责。判据来自 `skills/project-guide/SKILL.md` 第 5 节：
  单文件超过约 150 行多半混了两个职责；拆分看「职责数」不看「行数本身」。
- **怎么取证**：`wc -l <file>`；数导出个数；按职责给 import 分组（React 状态 / 数据桥调用 / 纯逻辑 / 样式常量）；
  再看变更历史 `git log --oneline -- <file>` 是否总是「两个不相干的改动一起进」。
  - 案例（0011）：`src/view/native/ui/menus.tsx`（**现已删除**）571 行，浮层基础设施 + 4 个菜单同文件，超出判据；
    拆成 `menu-shell.tsx` / `model-menu.tsx` / `permission-menu.tsx` / `session-menu.tsx`（四个文件现在都存在）。
    做法是**纯搬运**，一次只搬一个文件，搬完立刻构建。
- **常见误报**：纯类型声明；常量或数据表；组合根 / 状态编排器 / 桥单文件（脚本已降为 `info`，见下方「超长文件的判定例外」）。
  构建产物 `main.js` 与 `skills/`、`scripts/` 下的工具脚本已不在扫描范围内，不会再命中。
- **建议严重度**：默认按脚本档位（≥500 `high` / ≥300 `medium` / ≥150 `low`）；职责单一的可在报告里下调并写明理由，
  混职责且改动频繁的可上调到 `high`。三个已知例外脚本已固定为 `info`，不要自行改回 `high`。
- **处理方式**：搬运拆分，进「纯搬运拆分」批次；拆分时禁止改名导出、改 props、改 DOM 结构或类名语义。

## 2. `unused-export` — 无调用方导出（报告 `2`）

- **检测方式**：统计导出符号在本文件之外的引用数；0 引用 → `severity: medium, confidence: high`；
  仅本文件内引用 → `severity: low, confidence: low`；`default export` 脚本跳过（无法可靠判断）。
- **什么算问题**：导出没人调用，且不是刻意保留的公共 API、桥契约或文档示例。
- **怎么取证**：按下方「无调用方导出删除前确认清单」逐项过；最终以
  `grep -rn "<符号>" src packages docs skills scripts README.md AGENTS.md`（排除 `main.js`）只剩声明处作为证据。
  - 案例（0011，这三个导出当时已删除）：`src/settings/schema.ts` 的 `serviceUrl()`、`src/service/locator.ts` 的 `resolveDshCommand()`、
    `src/view/native/core-bridge.ts` 的 `diagnose()`，证据都是「全仓仅声明处」；删除后
    `grep -rn "serviceUrl" src` 无输出。注意 `diagnose` 是插件侧包装，桥侧 `client.js` 仍保留该能力供手工调试——
    这正是「删除前要确认桥契约」的典型。
- **已知漏报**：脚本按原始文本做词边界计数，**注释或字符串里提到同名标识也会算作引用**，可能把真死码判成「有引用」；
  所以脚本只能初筛，删除前必须人工 `grep` + 读上下文。
- **常见误报**：只在本文件引用（脚本已经降级）；被 `docs/` 或 `skills/` 的示例引用；
  被外部调试脚本使用（见 `docs/obsidian-cdp.md` 的片段）；通过 `import * as` 使用（grep 不到符号名，要搜命名空间）；
  通过字符串拼名动态调用；导出给 dsh 插件页面用的全局对象。
- **建议严重度**：默认按脚本；`packages/` 下的导出脚本已降为 `low` / `low`（可能被 dsh 运行时或外部插件消费），
  删前必须查 profile 用法与桥契约；有桥 / 外部契约风险时**先降置信度再核实**，不要直接删。
- **处理方式**：删（进「死码清理」批次）；确认被契约保留的改「只记录」，并在报告写明保留理由。

## 3. `dead-file` — 死文件（报告 `2`）

- **检测方式**：文件不在任何 import 链上，按文件名 / 相对路径引用做启发式匹配（`confidence: medium`）。
- **什么算问题**：既不被 import、也不被动态 require / 脚本入口 / 配置引用，且不是入口文件。
- **怎么取证**：`grep -rn "<文件名去掉扩展名>" src packages scripts`；查 `package.json` 的 scripts 与
  `esbuild.config.mjs` 的入口；查 `docs/` 与 `skills/` 里的引用；最后看 `git log --oneline -- <file>` 判断是不是废弃半成品。
  - 案例（0011）：桥插件 `lib/client.js` 的 v1 段（约 150 行 + 注册块）在 0008 之后已无调用方，删除前先确认
    「插件侧 `core-bridge.ts` 只调 v2 方法、`docs/obsidian-cdp.md` 的调试片段只用 v2 与 `open-dsh-view`」，
    再删并同步文档。按文件处理死代码时用同一套确认逻辑。
- **常见误报**：入口文件（`src/main.ts`，脚本已排除）；技能脚本（由 `node` 直接执行、不经 import）；
  构建配置引用的文件；`docs/` 里作为示例引用的文件；`data/` 下可重建的索引；构建产物。
  当前扫描只覆盖 `src/` 下的代码文件，`packages/` 与 `skills/` 的文件不会报这条。
- **建议严重度**：默认 `medium`；确认是废弃半成品可上调，确认有外部用途则降为 `low` 并只记录。
- **处理方式**：删（死码清理批次）；不确定的只记录，并写清「为什么不敢删」。

## 4. `duplicate-block` — 重复代码块（报告 `3`）

- **检测方式**：重复的连续代码块，按 `--min-block` 设定最小行数（默认 8）；只扫 `src/` + `packages/`。
  置信度分档：**跨文件 `medium` / 同文件 `low`**——同文件的 `evidence` 会注明「同文件内重复，可能是 JSX / 表格结构，
  优先人工判断」，这类通常不是真重复。
- **什么算问题**：语义相同、变更原因相同，两处未来会一起改 → 收敛候选。
- **怎么取证**：定位两处原文；读语义是否真等价（入参 / 边界 / 错误处理）；看归属域（同域就近抽函数，
  跨域才进 `src/shared/`）；看两处是否总在同一次提交里一起改。
  - 案例（0011）：7 处手写 `error instanceof Error ? x.message : String(x)`，散在 `main.ts` / `settings/tab.ts` /
    `native-chat-view.tsx` / `core-bridge.ts` / `native-chat-root.tsx`；收敛成 `src/shared/errors.ts` 的
    `errorText()` 后替换 7 处。证据是 `grep -c` 的前后计数 + 收敛后只剩 `errors.ts` 一处定义。
- **常见误报**：协议常量 / 文案表；结构相似但语义不同（DTO 投影 vs UI 状态）；相似但演进方向不同的两段；
  JSX / 表格样板（脚本标为同文件 `low` 的多属此类）；测试数据或示例；生成物。**重复块只能当候选**（见下方专节）。
- **建议严重度**：默认 `medium`；没确认等价前不要上调，也不要在报告里写「必须合并」。
- **处理方式**：收敛（最后一批）；跨域抽到 `src/shared/`，同域抽到本域文件；必须证明行为等价并跑手动回归。

## 5. `duplicate-export-name` — 同名导出（报告 `3`）

- **检测方式**：两个以上文件导出同名函数 / 常量 / 类型（`severity: low, confidence: medium`）。
- **什么算问题**：同名但语义不同 → 误 import 风险；同名同义 → 应单点定义。
- **怎么取证**：`grep -rn "export function <name>\|export const <name>" src`；对比两处实现；看调用方 import 自哪个文件。
  - 案例（本仓库真实存在，但**不是**同名导出命中）：`sameModel`（`src/view/native/ui/model-menu.tsx`）与
    `sameGoal`（`src/view/native/ui/native-chat-root.tsx`）是各自文件里的**私有函数**（没有 `export`），
    属于「同名私有函数族」。扫描器只统计 `export`，所以不会命中它——**这类只能靠人工复核看到**。
    看到同名私有函数时先判断语义是否同源，不要当成同名导出问题；真同名同义才收敛。
- **常见误报**：类型与值同名（合法）；不同域的私有辅助函数本来就允许同名；测试替身。
- **建议严重度**：默认 `low`；同名且语义不同、已造成一次误 import 的上调 `medium`。
- **处理方式**：改名或合并——改名会动导出名，**不算纯搬运**，单独小批次或并入收敛批次。

## 6. `magic-literal` — 重复字面量（报告 `3`）

- **检测方式**：同一**完整引号 token**（如 `'3081'` / `"3081"` / `'127.0.0.1'` / `'obsidian'` / `'persist:dsh-obsidian'`）
  出现在唯一来源（白名单）之外的代码里（`severity: info, confidence: mechanical`）；只扫 `src/` + `packages/`，**跳过注释行与 import 说明符**。
  字符串拼接片段、模板变量、被引号切断的子串不会被匹配，所以「命中少」是设计而非漏报；
  白名单外**哪怕只出现 1 处**也会报（含义是「该契约值没进唯一来源」，不是「出现两次」）。
- **什么算问题**：该值是共享契约（视图类型、命令 id、类名前缀、端口、缓存时长、防抖时间）却写在白名单文件之外，
  改一处容易漏另一处。
- **怎么取证**：`grep -rn "<字面量>" src packages`（用完整引号形式，避免子串命中）；确认是否已有唯一来源
  （`src/shared/constants.ts`、`src/settings/schema.ts` 的 `DEFAULT_SETTINGS`、`src/shared/types.ts`）；
  判断它是「契约」还是「恰好相同的字符串」。
  - 本仓库当前基线（5 条）：`src/main.ts:167` 的持久化键 `'persist:dsh-obsidian'`、`src/settings/sections/service.ts:25`
    的 `'3081'`、`service.ts:41` 与 `service.ts:44` 以及 `src/settings/sections/plugins.ts:153` 的 `'obsidian'`。
    这些是默认值 / profile 名的散落拷贝，**要对照 `src/settings/schema.ts` 的 `DEFAULT_SETTINGS` 判断**：
    属于占位提示文案的可以只记录，属于真契约值的才进收敛批次。
- **常见误报**：不同上下文的相同文案；样式数值（大量重复但没有同一语义）；日志前缀；一次性字符串；
  `docs/`、`skills/` 里的解释性文本（已不在扫描范围内）。
- **建议严重度**：固定 `info`，只记录。
- **处理方式**：只记录；确认是契约值的，进「收敛重复」批次抽到唯一来源，并同步文档与 `AGENTS.md` 默认值表。

## 7. `layer-violation` — 分层违规（报告 `4`）

- **检测方式**：按 import 方向匹配 `AGENTS.md` 规则 11 与 `docs/architecture.md`「src 分层」的禁止清单
  （`severity: medium`；`confidence` 硬违规为 `high`，`view` → `service` 这种「候选违规」为 `medium`）。
- **什么算问题**：`service/` import `obsidian`；`view/` import `main.ts`；`service/` 与 `view/` 互引；
  `settings/`、`shared/` 反向依赖上层。
- **怎么取证**：
  ```bash
  grep -rn "from 'obsidian'" src/service          # 期望无输出（service 是纯 Node）
  grep -rn "from '.*main'" src/view               # 期望无输出（view 只依赖 DshPanelHost）
  grep -rn "from '.*view/" src/service            # 期望无输出
  ```
  - 案例（本仓库真实基线）：写作时 `src/service` 无 `obsidian` import，可作为审阅基线；
    但同一条命令的**误报来源**是 `src/settings/sections/integration.ts` 里那段安装命令文案
    （字符串提到 `packages/dsh-obsidian-bridge`，不是 import）。
- **常见误报**：`import type` 只取类型（仍要按规则判断，但影响面不同）；字符串 / 文案里提到路径；
  `docs/` 与提案里的代码示例；合法的窄接口（`DshPanelHost` / `SettingsHost` 就是为打破反向依赖而设计的）。
- **建议严重度**：默认 `medium`；形成循环依赖或导致 `service` 无法单独打包的上调 `high`。
- **处理方式**：搬运到正确域，或抽窄接口到调用方域 / `src/shared/`；参考 `project-guide` 第 7 节「漂移症状 → 纠正」；
  独立成批，不和其他类混。

## 8. `barrel` — barrel 文件（报告 `4`）

- **检测方式**：`src/` 下出现 `index.ts` / `index.tsx`，或有 import 引用目录路径（`severity: medium, confidence: mechanical`）。
- **什么算问题**：本仓库规则 11 明确禁止 barrel；单产物打包下只会增加循环依赖风险。
- **怎么取证**：`find src -name 'index.ts*'`；`grep -rn "from '\./" src` 找目录级 import；确认目标文件是否真是入口。
- **常见误报**：`node_modules` 里的包；`skills/*/references/` 的索引文件；`data/` 下的索引；
  `main.js` 构建产物。脚本若扫到这些属于范围错误，以报告里的 `file` 为准人工排除。
- **建议严重度**：默认 `medium`。
- **处理方式**：删 barrel 并把 import 改到具体文件（纯搬运批次）。当前仓库 `src` 下没有 `index.ts`，
  **出现即问题**，可直接按规则 11 记一条。

## 9. `cross-package` — src 与 packages 互引（报告 `4`）

- **检测方式**：`src/` import `packages/dsh-obsidian-bridge/`，或桥插件 import `src/`（`severity: medium, confidence: mechanical`）。
- **什么算问题**：`AGENTS.md` 规则 11 与目录表规定 `packages/` 是独立 dsh 插件，不 import `src/` 也不被 `src/` import；
  互引会破坏独立发布，且可能把桥代码卷进插件产物。
- **怎么取证**：
  ```bash
  grep -rn "dsh-obsidian-bridge" src --include='*.ts*'   # 只应有安装说明文案，不应有 import
  grep -rn "\.\./src" packages                          # 期望无输出
  ```
  - 案例（本仓库真实）：全仓唯一命中是 `src/settings/sections/integration.ts` 里的安装命令文案，
    **不是 import**——这是典型误报。插件与桥的实际通信走隐藏 core 的页面全局对象（桥 v8 契约），
    见 `src/view/native/core-bridge.ts` 与 `packages/dsh-obsidian-bridge/lib/client.js`。
- **常见误报**：界面文案里的路径（如上）；`docs/`、`README`、`AGENTS.md` 的说明；桥包自己的 `package.json` 名称；
  构建配置里的 external 路径。
- **建议严重度**：默认 `medium`；真的 import 且已进产物上调 `high`。
- **处理方式**：收敛到契约（桥方法 / 页面全局对象）或各侧自留实现；任何桥改动都要按 SKILL.md 5.3 重新 link + 重启服务。

## 10. `root-clutter` — 根目录杂项（报告 `4`）

- **检测方式**：根目录出现不在允许清单里的文件 / 目录（`severity: info, confidence: mechanical`）。脚本的清单与
  `AGENTS.md`「目录约定」一致：`main.js` / `manifest.json` / `styles.css` / `versions.json` / `data.json`、构建配置、
  `README.md` / `AGENTS.md` / `LICENSE`、`docs` / `skills` / `scripts` / `packages` / `src` / `.dsh`、`.git` / `.gitignore` / `node_modules` / `.DS_Store`。
- **什么算问题**：根目录只允许插件运行必需文件、构建配置、`README.md` / `AGENTS.md`，以及 `docs/`、`skills/`、
  `scripts/`、`packages/`、`.dsh/`；临时文件、备份、草稿脚本、审阅报告都不该出现。
- **怎么取证**：`ls -1` 对照 `AGENTS.md`「目录约定」；`git status --short` 看未跟踪文件；确认 `.gitignore` 是否覆盖。
- **常见误报**：清单内的条目本身不会命中，所以 `data.json` / `node_modules` / `main.js` / `src/` / `.DS_Store`
  都不报；真正常见的是**新增的临时文件**（`*.bak`、`*.log`、草稿 `.md`、审阅报告落在根目录）。
  注意 `data.json` 允许存在但**不入库**（`.gitignore` 已覆盖）。
- **建议严重度**：固定 `info`。
- **处理方式**：归位（文档 / 脚本进对应目录）或删；审阅报告进 `docs/changes/` 作伴随文件，**不要落根目录**。

## 11. `todo-marker` — 遗留标记（报告 `5`）

- **检测方式**：`TODO` / `FIXME` / `XXX` / `HACK` / `@ts-ignore` / `@ts-expect-error`（`severity: info, confidence: mechanical`）。
- **什么算问题**：不是所有标记都算。算问题的是：没有说明原因与清理条件的；与当前行为矛盾的；
  用 `@ts-ignore` / `@ts-expect-error` 掩盖真实类型错误的；出现在核心链路（启动 / 桥 / 数据解析）上的。
- **怎么取证**：读标记所在函数的上下文；看 `docs/roadmap.md` 与 `docs/changes/` 是否已有对应需求；
  用 `git log -S "<标记>"` 看它是何时埋下的。
  - 本仓库当前基线：0 条（脚本扫全仓代码文件：`src` / `packages` / `scripts` / 技能脚本，跳过扫描器自身）。
    这是「干净」的基线，不构成「以后不会有」的结论；新增标记按本节判断是否算问题。
- **常见误报**：文档或注释里解释性的 "TODO" 字样；英文单词（如 `todos`）；示例代码；刻意保留并已写原因与条件的标记。
- **建议严重度**：默认 `info` 只记录；`@ts-ignore` 掩盖真实错误的可上调 `medium`。
- **处理方式**：只记录 / 就地补「为什么 + 何时清」（纯文档批次）/ 转成 `R-<n>` 需求进 roadmap。

## 12. `doc-missing-file` — 文档断链（报告 `6`）

- **检测方式**：扫描 `docs/`、`skills/`、`README.md`、`AGENTS.md` 里的仓库相对路径与链接，指向不存在的文件
  （`severity: medium, confidence: high`）。**跳过 `docs/changes/` 整个目录**（历史提案记的是当时事实）与
  含 `<>` / `$` 的占位符路径（如 `src/<文件>.ts`、`$DSH_HOME/...`），http / 锚点 / mailto 也不查。
- **什么算问题**：正文引用的路径失效 → 下个会话按文档找文件找不到，直接掉进坑里。
- **怎么取证**：报告给的 `file:line` 逐条 `test -e <path>` 复核；锚点（`#src-分层` 之类）脚本不查，人工点开看；
  用 `grep -rn "<路径>" docs skills README.md AGENTS.md` 找还有谁在引用。
  - 案例（0011 第 9 条）：`docs/architecture.md` 的目录树仍列已删除的 `controller.ts`，README 写「机器人图标」，
    roadmap 版本停在 0.4.0 —— 都属于文档与代码漂移，按「以代码为准」修掉。
- **常见误报**：`docs/changes/` 里**历史提案**提到的当时路径（如 0008 / 0010 / 0011 里的 `controller.ts`）——
  脚本已整目录跳过，但**人工复核时看到也要判定为不断链**；外部 URL；`$DSH_HOME` 等环境路径；
  含 `<>` 的占位路径；锚点链接。
- **建议严重度**：默认 `medium`；指向 `AGENTS.md` / `docs/architecture.md` 等入口文档的上调 `high`。
- **处理方式**：以代码为准改文档（文档同步批次）；历史提案保留原样，必要时加「已删除」说明；
  改完更新 `docs/roadmap.md` 的「最后更新」。

## 13. `doc-map-missing` — 改动地图缺登记（报告 `6`）

- **检测方式**：**只拿 `src/` 下的文件**比对 `docs/development.md`「代码结构与改动地图」，找「源码有、文档没登记」的文件
  （`severity: info, confidence: low`，按文件名 / 路径匹配，会有合理漏报）；`docs/architecture.md` 目录树不参与自动比对，
  需人工顺带核。
- **什么算问题**：改动地图是 `project-guide` 冷启动的入口；缺登记 = 下个会话不知道文件存在、也不知道该改哪。
- **怎么取证**：`grep -rn "<文件名>" docs/development.md docs/architecture.md AGENTS.md`；
  对照本次新增文件清单（`git status --short` / 提案的改动清单）逐条核。
  - 案例（0011）：新增 `src/shared/errors.ts` 后同步了 `docs/architecture.md` 的 `shared/` 目录树与
    `docs/development.md` 的相关行——新增文件必须同批登记，这是既定做法。
- **常见误报**：纯内部辅助函数 / 小工具确实不必逐条登记；已被上层文件汇总说明覆盖的拆分文件
  （例如 `ui/` 汇总行里描述了 `timeline-nodes.tsx`）；`packages/`、`scripts/`、`skills/` 下的文件不要求进 src 地图（本来也不在比对范围）。
- **建议严重度**：固定 `info`，默认只记录。
- **处理方式**：文档同步批次补一行；过细的只记录，并在报告里说明判断标准。

---

## 超长文件的判定例外

行数只是信号，**职责数**才是判据。下列三个文件的例外**已内置进扫描器**：无论多少行都输出 `severity: info`，
`evidence` 写「已知例外，允许超长（…）；理由见 references/checks.md」，不会再报强拆信号。
报告里引用这份理由即可，不必重新论证；若它们继续增长，仍要写明「若继续增长怎么拆」：

| 文件 | 为什么允许 | 要求 |
|---|---|---|
| `src/main.ts`（组合根） | 注册 / 装配天然收敛在一个入口，拆开反而增加跳转成本 | 不得塞业务逻辑；出现分支 / spawn / 探测细节即记结构漂移 |
| `src/view/native/ui/native-chat-root.tsx`（状态编排器） | 一个面板的全部状态与事件编排，拆开会产生跨文件状态同步 | 出现可独立成文件的纯逻辑即搬走；新增职责优先进子组件 / 纯函数 |
| `packages/dsh-obsidian-bridge/lib/client.js`（桥单文件） | 桥要注入页面全局对象，单文件是契约边界，拆包会改变加载语义 | 新增能力先看是否该进 v8 契约；改动后必须 relink + 重启服务验证 |

另外两类**不算候选**：构建产物（`main.js`）与可重建数据（`skills/*/data/`）。纯类型声明文件超长按 `low` 处理。

判例（0011）：`timeline-nodes.tsx` 拆分后 330 行略高于 300 行目标，实施记录里写明了「节点渲染器彼此内聚，未再拆」——
**允许超，但必须在提案 / 报告里写理由**，不能默默放过。

## 无调用方导出删除前的确认清单

按顺序过，任一项命中即**不删**，改为「只记录」并写清保留理由：

1. **全仓文本搜索**：`src` / `packages` / `docs` / `skills` / `scripts` / `styles.css` / `README.md` / `AGENTS.md`；
   排除 `main.js`（构建产物会命中）与 `node_modules`。
2. **同文件内引用**：只在定义文件内使用 → 不是「无调用方」，是「该降级为私有」或「整段死代码」，结论不同。
3. **动态引用**：字符串拼名调用（`obj[name]`）、`import * as` 命名空间、事件总线注册、反射式加载。
4. **桥契约**：是不是 `packages/dsh-obsidian-bridge` 暴露的方法或页面全局对象（v8 契约）？
   插件侧包装可以删，**桥侧契约不能删**（0011 的 `diagnose()` 就是这个区别）。
5. **文档与技能**：`docs/`、`skills/` 的示例或排障片段是否在教用户用它？
6. **外部脚本 / 其它仓库**：`$DSH_HOME/profiles/obsidian`、`docs/obsidian-cdp.md` 的调试片段、
   用户可能自备的脚本。
7. **历史意图**：`git log -S "<符号>"` 看它是不是刚加的、是否有提案要求保留。
8. **删除后验证**：`npm run build` + `npm run check` + `grep` 证据，必要时跑一次相关手动回归。

## 为什么重复代码块只能当「候选」

- **相同文本 ≠ 相同语义**：DTO 投影、UI 状态、协议解析经常长得很像但演进方向不同，合并后一处变更会污染另一处。
- **重复本身可能是设计**：桥代码与插件代码各自持有拷贝，是为了保持契约边界与独立发布。
- **收敛有成本**：抽公共函数会引入参数搬运、增加间接层，收益低于成本时应该「只记录」。
- **判断标准**只有一条：**它们是否因为同一个原因而改变**。会一起改 → 收敛；不会 → 保持独立。
- 所以报告里写「重复块，疑似等价，建议复核」，不要写「必须合并」；确认等价后再进「收敛重复」批次。

## 文档漂移的修复纪律

1. **以代码为准**：文档与代码冲突时改文档，不改代码来迁就文档；若代码行为本身是错的，另立 `R-<n>` 需求，
   不要用「改文档」掩盖 bug。
2. **同批改完**：受影响文档一次改齐（`docs/architecture.md` / `docs/development.md` / `AGENTS.md` /
   `skills/project-guide/SKILL.md` / `docs/changes/README.md`），不要留「下次再说」。
3. **更新 roadmap 时间戳**：修改 `docs/roadmap.md` 顶部「最后更新」；状态与里程碑只在这里维护。
4. **不写会过期的细节**：优先描述职责与约定，行号与实现细节以源码为准（`docs/README.md` 的维护约定）。
5. **改完复验**：`grep` 原词确认旧说法已消失；`test -e` 确认新路径存在；锚点链接人工点开。
6. **历史提案不改**：`docs/changes/` 里 `done` / 历史记录保持原样（它记录的是当时事实），只在必要时加一句「已删除」。
