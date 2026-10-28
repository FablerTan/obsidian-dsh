---
name: project-guide
description: 本仓库（obsidian-dsh）的冷启动 + 结构指南：新会话先按它给的顺序查文档了解当前状况（不重读源码），再按落位决策表放新代码，含分层依赖、拆分判据与验收清单。
whenToUse: 每次开始在本仓库工作之前（尤其是新会话接手时）；以及需要新建 / 移动文件、拆分模块、判断代码该放 src/ 哪个域、或不确定当前进度与下一步时。
---

# 项目指南（obsidian-dsh）

一份技能管两件事：**新会话怎么快速搞清楚现状**（第 0~1 节），**代码该往哪放、结构怎么不跑偏**（第 2~8 节）。

三层分工：本技能 = 决策流程与验收清单；`AGENTS.md`（仓库根）= 硬规则（冲突以它为准）；`docs/` = 事实与背景。

> 本技能会同时以 `skills/project-guide/`（真实目录）与 `.dsh/skills/project-guide`（符号链接）两条路径被访问，
> 因此文中一律用**仓库相对路径**（如 `docs/roadmap.md`），不用 `../` 相对链接。

## 0. 开局 60 秒（新会话必做）

按顺序读，不要先翻源码：

| 顺序 | 读什么 | 拿到什么 |
|---|---|---|
| 1 | `docs/roadmap.md`（前 60 行 + 「需求待办」+ M 列表） | 当前版本、主线待办、里程碑状态、已知设计债 |
| 2 | `docs/changes/README.md` 的状态表 | 有没有 approved（已批准未做完）/done（最近改了什么）的提案 |
| 3 | 本文件第 1 节的查询地图 | 具体问题该去哪份文档 |
| 4 | 只在需要动手时：`docs/development.md` 的「代码结构与改动地图」 | 目标功能在哪个文件 |

```bash
sed -n '1,70p' docs/roadmap.md          # 主线 / 需求待办 / 候选池 / 版本
grep -n '^| \[' docs/changes/README.md  # 提案状态表
```

**读完能回答这 5 个问题，就算进入状态了**：

1. 当前版本号、主线在哪？「需求待办」里有没有 `待调研` / `等你选路` 的行？
2. 下一个该做的需求是什么？路径选了吗？有没有已批准 / 执行中的提案？
3. 某个功能（服务托管、面板、设置、探测…）在哪个文件？
4. 现在有哪些已知坑（起不来、端口占用、孤儿进程…）？
5. 要新增一个文件，该放哪个目录？

### 时效性自检

文档可能落后于代码。发现下列情况时，先把文档补齐再依赖它：

- `docs/roadmap.md` 顶部「最后更新」日期 < 最近一次源码改动时间（`ls -lt src/*/*.ts | head -3`）；
- `docs/changes/` 里有 `status: approved` 但没写「实施记录」的提案 → 说明有改动已批准、进度未知；
- 文档描述与代码不一致 → **以代码为准**，然后修正文档并在 roadmap 的「最后更新」上打时间戳；
- `docs/roadmap.md` 与 `docs/changes/` 的时间线冲突时，以最近一个 `status: done` 提案的「实施记录」为准（它记录的是实际落地内容）；
- 「需求待办」有 `R-<n>` 却找不到对应提案，或提案没写「实现路径调研」 → 先把账本和路径补齐，再问用户选路，不要先改代码。

### 什么时候才读源码

文档不足时再读，且按这个顺序，不要通读全仓：

1. `src/main.ts`（组合根，能看出有哪些模块被接起来）；
2. 目标域的入口文件（`service/manager.ts` / `view/native/native-chat-view.tsx` / `settings/tab.ts`）；
3. 具体实现文件。

Obsidian 自身 API（Plugin / ItemView / Vault / requestUrl…）**不要读类型定义**，用 `skills/obsidian-docs` 查官方文档。

## 1. 查询地图（问题 → 去哪）

| 我想知道 | 去看 |
|---|---|
| 现在做到哪了 / 需求待办 / 下一步 / 已知设计债 | `docs/roadmap.md` |
| 最近改了什么 / 有哪些提案在等批准 | `docs/changes/README.md` + 对应提案 |
| 某条链路怎么跑（服务生命周期、原生面板与隐藏 core、探测） | `docs/architecture.md` |
| 某个功能在哪个文件 / 怎么改 | `docs/development.md` 的「改动地图」 |
| 报错、起不来、面板空白、端口占用 | `docs/troubleshooting.md` |
| 目录约定、默认值、版本、验证要求 | `AGENTS.md` |
| Obsidian 使用/插件 API | `skills/obsidian-docs`（不要猜） |
| 本仓库的文档清单 | `docs/README.md` |

## 2. 落位决策（30 秒）

按顺序问，第一个「是」就是答案：

1. 它管 dsh 进程的启动 / 探测 / 重启 / 停止 / 路径解析？ → `src/service/`
2. 它是 Obsidian 视图、webview 承载、面板打开？ → `src/view/`
3. 它是设置项定义、默认值、校验、设置页控件？ → `src/settings/`
4. 它被多个域共用（常量、类型、sleep、日志、vault 路径、探测实现）？ → `src/shared/`
5. 它只是把上面几块接起来并注册到 Obsidian？ → `src/main.ts`
6. 它是 dsh 侧客户端插件（单栏 / workspace / 原生数据桥）？ → `packages/dsh-obsidian-bridge/`
7. 都不是（文档 / 技能 / 提案 / 构建配置）→ 看第 3 节目录地图。

反问题：**这段逻辑能脱离 Obsidian 运行吗？** 能 → `service/`；不能 → `view/`。

## 3. 目录地图

| 路径 | 放什么 | 禁止 |
|---|---|---|
| `src/main.ts` | 组合根：注册视图/命令/ribbon/状态栏/设置页，注入依赖，结果映射成 Notice | 业务分支、spawn、探测细节 |
| `src/service/` | `manager.ts`（进程托管）、`locator.ts`（可执行文件 + PATH） | import obsidian、弹 Notice、碰 DOM |
| `src/view/` | `native/`（原生聊天 React UI + 数据桥）、`surface.ts`（隐藏 core webview）、`panel-host.ts`（宿主接口）、`open.ts`（打开面板） | import main.ts、自己读 settings |
| `src/settings/` | `schema.ts`（类型 / 默认值 / 端口校验）、`tab.ts`（设置页） | 进程逻辑、视图细节 |
| `src/shared/` | `constants.ts`（视图类型 + `isDshPage`）、`types.ts`（Probe 契约）、`async.ts`、`log.ts`、`host.ts`（vault 路径 + requestUrl 探测） | 业务逻辑（出现分支说明该去具体域） |
| `docs/` | 人读文档：roadmap / architecture / development / troubleshooting / skills | 实现日志、草稿、临时脚本 |
| `docs/changes/` | 改代码前的提案（draft → approved → done） | 未批准前直接改代码 |
| `skills/<name>/` | 给 agent 的技能：`SKILL.md` + 可选 `scripts/` / `references/` / `data/` | 项目文档、不可复现的产物 |
| `.dsh/skills/<name>` | 指向 `../../skills/<name>` 的符号链接 | 放真实文件 |
| `packages/dsh-obsidian-bridge/` | dsh 侧客户端插件：`lib/client.js`（v7 数据桥：快照 / liveStream / context / commands / team / subagents；v1 已删）、`cordis.patch.yml`、独立 `package.json` | import `src/`、被打进 `main.js` |
| 根目录 | 插件运行必需文件 + 构建配置 + `README.md` / `AGENTS.md` + `docs/`、`skills/`、`packages/`、`.dsh/` | 任何临时代码、脚本、备份 |

## 4. src 分层（单向依赖）

```text
main.ts ──► service/ · view/ · settings/ · shared/
view/   ──► service 的接口 · settings/schema · shared/
service/ ─► shared/            （纯 Node，可单独打包冒烟）
settings/ ─► shared/
shared/ ──► 无内部依赖
```

禁止清单：

- `service/` import `obsidian`（需要状态就传 `onStatus` 回调，需要探测就注入函数）。
- `view/` import `main.ts` 或拿 `Plugin` 实例（用窄接口 `DshPanelHost` / `SettingsHost`）。
- 任何 `index.ts` barrel（单产物打包，barrel 只会带来循环依赖）。
- `view` 与 `service` 互相 import。

命名：文件 kebab-case；一个文件一个主导出；文件名与主导出对应（`manager.ts` → `DshServiceManager`）。

## 5. 什么时候该新建文件 / 拆域

- **该拆**：某段逻辑 ≥ 30 行且属于已有一个域；或被两个以上调用点使用；或单文件超过约 150 行（多半混了两个职责）。
- **该建新域**：出现 3 个以上同域文件，或该域需要独立依赖规则（例如以后 M3 的 `transport/`）。
- **不该拆**：< 30 行且单调用点；只为「看起来整齐」；为复用而制造参数搬运。
- **拆的姿势**：**纯搬运**（只移动文件、改 import，行为与文案不变）→ 构建 + 回归 → 再改进逻辑。一次提交别既搬又改。

## 6. 验收清单（改动后逐条过）

结构改动：

- [ ] `npm run build` 通过（`tsc -noEmit -skipLibCheck` + esbuild）
- [ ] `main.js` 已重新生成，无手改痕迹
- [ ] 命令 id、Notice 文案、状态条文案、时序参数未变（除非提案里写明要改）
- [ ] `service/` 可单独冒烟（`esbuild --platform=node` 打包到 /tmp 后跑）

文档（保证下个会话能靠文档进入状态）：

- [ ] `docs/architecture.md`：分层图、关注点表、生命周期
- [ ] `docs/development.md`：改动地图、回归清单
- [ ] `docs/roadmap.md`：状态 + 「最后更新」时间戳
- [ ] `docs/changes/`：提案状态与实施记录
- [ ] `AGENTS.md`：目录表与规则未过期
- [ ] `docs/skills.md` 与 `skills/README.md`：新增/改名技能已登记
- [ ] 内部相对链接与锚点仍有效

## 7. 漂移症状 → 纠正

| 症状 | 纠正 |
|---|---|
| `main.ts` 里出现 spawn / fetch / 业务分支 | 搬回 `service/` |
| `view/` 里出现默认值或路径解析 | 搬回 `settings/schema.ts` / `service/locator.ts` |
| `service/` 里出现 `Notice` / `HTMLElement` | 改成返回值或回调，UI 归 `view/` 或 `main.ts` |
| 两个域互相 import | 抽窄接口到调用方域（如 `DshPanelHost`）或 `shared/` |
| 默认值散落多处 | 收敛到 `settings/schema.ts` 的 `DEFAULT_SETTINGS` |
| 根目录冒出脚本 / 临时文件 | 进 `docs/` 或 `skills/`，或删掉 |
| 文档与代码不一致 | 以代码为准改文档，并更新 roadmap 时间戳 |
| 新功能没有提案就改了代码 | 补提案（`docs/changes/template.md`），标 `approved` 并写实施记录 |
| 新需求没登记 roadmap / 没比路径就开工 | 在 roadmap「需求待办」补 `R-<n>`，提案补 ≥ 2 条实现路径，把选项给用户选 |
| 为新功能新建 `src/utils/` | 按第 2 节重新归位；确实跨域的才进 `shared/` |

## 8. 相关文档

| 需要什么 | 去哪 |
|---|---|
| 硬规则（冲突以此为准） | `AGENTS.md` |
| 当前进度与下一步 | `docs/roadmap.md` |
| 提案索引与状态 | `docs/changes/README.md` |
| 架构与数据流 | `docs/architecture.md` |
| 改动地图、构建、回归 | `docs/development.md` |
| 排障 | `docs/troubleshooting.md` |
| 技能目录约定 | `docs/skills.md` |
| Obsidian 官方文档检索 | `skills/obsidian-docs/SKILL.md` |
