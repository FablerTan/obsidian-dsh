---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28       # 用户当轮明确指定要改的具体项（AGENTS 规则 12 例外）
scope: src/service / src/settings / src/view / src/main.ts / src/shared / styles.css / docs
issue: 设置页新增「结束后台 dsh」按钮（结束遗留实例、不必再手动 pkill）+「重启服务」改为就地进度 / 结果反馈
---

# 0056 设置页「结束后台 dsh」按钮 + 重启服务就地反馈

> 对应路线图 [R-39](../roadmap.md#需求待办)。用户原话：「给设置页面添加一个结束后台dsh的按钮，然后优化一下现在重启按钮的反馈」。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外（用户当轮已明确指定要改的具体项，视为已批准、可直接做），本提案用于补齐记录与路径对比。

## 1. 背景与问题

2026-10-28 使用现场：Obsidian 状态栏显示 `DSH: 需手动结束`，插件端口（当时 3088）上是**上次遗留**的 dsh——裸 URL 返回 401、需要浏览器 token，插件拿不到它的 token，无法接管。

| 问题 | 现象 | 影响 |
|---|---|---|
| 只能按 Notice 手动结束 | 旧 Notice 要求用户复制 `pkill -f "dsh --profile obsidian"` 去终端执行 | 一次启动会叠加**三条相同**的「端口上的 dsh 需要 token」Notice，用户得逐条看、手动复制命令 |
| `pkill -f` 按 profile 模糊匹配 | 本机还有 3082 等其它同 profile 实例（桌面端 / 另一个 vault） | 一条 `pkill` 会把它们一起杀掉，正在进行的回合直接中断 |
| 「重启服务」没有中间态 | 点击后只有最终一条 Notice（成功 / 失败），没有「正在重启」的反馈 | 20s 级别的重启期间用户不知道点没点上，容易连点、叠出多条 Notice |
| 失败没有下一步 | 遗留实例场景下「重启服务」必然失败，Notice 只说失败 | 用户不知道该先「结束」再「重启」 |

相关记录：[0003](0003-dsh-version-selection-and-token-auth.md)（`auth` 四态与「需手动结束」）、[0007](0007-drop-legacy-and-migrate-bridge.md)（只支持 0.2.x）、[0055](0055-obsidian-community-directory.md)（1.0.0 文档与 lint 基线）。

## 2. 目标与非目标

### 目标

- 设置页「服务」tab 新增一行「结束后台 dsh」（按钮「结束」）：先停插件自拉子进程；端口上有遗留 dsh 时按**端口精确识别**后结束；
- 「结束」与「重启服务」都改为**就地反馈**：执行中按钮禁用并显示「结束中… / 重启中…」，行下状态行逐 0.2s 刷新计时（`正在结束后台 dsh… 1.2s` / `正在重启 dsh 服务… 3.4s`），结束后显示 `HH:mm:ss · 结果`（如 `16:20:31 · 已结束后台 dsh（PID 5742，用时 1.2s）` / `16:20:31 · 服务已重启（端口 3081，用时 3.4s）`），失败时结果行带「结束失败：/ 重启失败：」前缀，下一行给下一步建议；
- 设置页内的结束 / 重启不再叠加 Notice；命令面板触发「重启 DSH 服务」仍用 Notice 汇报（进行中一条常驻、结束后换成结果一条）；
- Notice / 状态栏文案改为**指引按钮**，不再要求用户复制 `pkill`；`pkill` 降级为 [troubleshooting](../troubleshooting.md) 里的手动兜底（只在 `unidentified` 的建议里出现）。

### 非目标

- 不做「重启时自动结束遗留实例」（路径 A）：结束必须是**用户显式点击**的动作；
- 不改 dsh 源码 / 桥协议（`dsh-obsidian-bridge` 仍 0.5.0 / API v8）；
- 不动用户自起的**其它端口**实例（如本机 3082）；只处理插件当前端口上的 dsh；
- 不新增设置项 / 开关，不改默认端口 3081、profile `obsidian`；
- 不做别的平台专项适配：macOS / Linux 走 `lsof`（缺 lsof 的 Linux 回落 `ss`），Windows 走 `netstat` + `powershell Get-CimInstance`；两者都拿不到监听 PID 时返回 `unidentified`，提示手动结束。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| A 重启时自动结束 | `manager.restart()` 探测到 `auth` / `unsupported` 时直接结束端口上的进程再 spawn | `service/manager.ts` 一处，改动最小 | 未经用户明确动作就杀非自拉进程，突破「只杀自己 spawn」的默认约定；「重启」语义被扩大成「结束 + 重启」，用户无法只结束不重启 | 不采用 |
| **B（选定）独立按钮 + 端口精确识别** | 新增 `service/port-dsh.ts`（`listPortListenerPids` / `readProcessCommand` / `looksLikeDshCommand` / `terminateProcesses` / `isProcessAlive` 等）；`manager.stopBackground()`；设置页新增行 + 就地状态行；`main.stopBackgroundService()` | `service` + `settings` + `view` + `main.ts` + `shared/types.ts` + `styles.css` | 新增平台命令分支（`lsof` / `ss` / `netstat` / `powershell`）；取不到 PID 时只能提示、不能动手。误杀风险由「端口限定 + `ps` 命令行核实」双重限制 | **采用** |
| C `pkill -f "dsh --profile <profile>"` / 提示手动 | Notice 里给一条按 profile 匹配的 `pkill`，或做成「一键 pkill」 | 最小（一次 `spawn`） | 会连带杀掉 3082 等其它同 profile 实例（本次问题的核心痛点）；Windows 无 `pkill`；没有 PID 与结果反馈，仍然是「让用户去终端」 | 不采用（仅作按钮失败后的手动兜底） |

> 用户 2026-10-28 原话即指定了「加按钮 + 优化重启反馈」，属于规则 12 的例外，不再等二次选路；上表保留对比是为了记录为什么不选 A / C。
>
> **设计取舍（记一笔）**：结束非自拉进程正是这个按钮的显式目的，因此不套用「只杀自己 spawn」的默认，改为更严格的三个条件——**只在用户点击后、只对当前端口的监听 PID、且命令行确实是 dsh** 才动手；自动路径（启动 / 重启 / 卸载）仍然只结束自拉子进程。

### 已定的实施细节（路径内的次决策）

- **类型位置**：`DshStopOutcome` 定义在 `src/service/manager.ts`（service 不依赖插件层）；`DshActionResult`（`{ ok, message, hint?, elapsedMs }`）与 `DshStopResult`（`{ ok, message, hint?, pids, stoppedOwn }`）放 `src/shared/types.ts`，设置页与命令面板共用。
- **顺序**：先停自拉子进程（`stopAndWait`，并等正在进行的 `start()` 收敛、必要时二次收尾），再探测端口——`down` 直接视为成功；`foreign`（端口上是别的程序）**拒绝**；`auth` / `running` 才走「取监听 PID → 命令行核实 → SIGTERM → 轮询 3s → SIGKILL → 轮询端口释放 3s（自拉进程再多等 1.5s 让系统回收监听套接字）」。
- **命令行核实**：`looksLikeDshCommand` 要求命令行含 `dsh`，且带 `--profile` / `dsh web` / `@deepseek-ai/dsh` / `bin.js` 之一；只是文件名带 dsh 的进程不算。命令行优先用 `ps -o command=` 读，`ps` 不可用（受限环境 / 缺失）时回退 `pgrep -laf`，判定依据不变。
- **失败分类**：`foreign`（端口是别的程序）/ `unidentified`（列不出 PID 或命令行不像 dsh，只提示不动手）/ `timeout`（发了信号但端口仍被占用，返回 `stuck` 里仍存活的 PID）。
- **状态栏**：结束后 `DSH: 已结束`；失败时分别写 `DSH: 端口被其他程序占用` / `DSH: 无法结束` / `DSH: 结束超时`，再点「重启服务」回到 `DSH: 运行中`。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/service/port-dsh.ts`（新增） | 端口探测与结束的原语（纯 Node）：`PortListener` / `listPortListenerPids`（POSIX `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`，缺 lsof 的 Linux 回落 `ss -ltnp`；Windows `netstat -ano -p tcp`）、`readProcessCommand`（`ps -o command= -p <pid>`，不可用时回退 `pgrep -laf`；Windows `powershell Get-CimInstance`）、`listPortListeners`、`looksLikeDshCommand`、`terminateProcesses`（SIGTERM → 轮询 3s → SIGKILL → 再等 1s）、`isProcessAlive`；绝不向插件自身 PID 发信号 |
| `src/service/manager.ts` | `DshStopOutcome` + `stopBackground()`：停自拉进程（含正在 start 的收敛与二次收尾）→ 探测端口（`down` 成功 / `foreign` 拒绝）→ 取监听 PID + 命令行核实 → 终止 → 轮询端口释放；结果写进 `onStatus`（已结束 / 端口被其他程序占用 / 无法结束 / 结束超时） |
| `src/shared/types.ts` | `DshActionResult` / `DshStopResult` |
| `src/settings/context.ts` | `SettingsHost`：`restartService()` 改返回 `DshActionResult`；新增 `stopBackgroundService(): Promise<DshStopResult>` |
| `src/settings/sections/service.ts` | 「重启服务」行改用返回值、新增「结束后台 dsh」行：按钮「重启」/「结束」，执行中互斥禁用并显示「重启中…」/「结束中…」，行下 `.dsh-service-action-status` 状态行计时；结束后 `HH:mm:ss · 结果`（失败加前缀）+ `.dsh-service-action-hint` 建议行 |
| `src/settings/sections/plugins.ts` | 「插件」tab 的重启按钮改用 `DshActionResult`：执行中「重启中…」，结果就地显示（失败带建议） |
| `src/view/panel-host.ts`、`src/view/native/native-chat-view.tsx` | `DshPanelHost.restartService()` 改返回 `DshActionResult`；面板错误页重启失败时用返回的 hint 弹一条 Notice |
| `src/main.ts` | `restartService()` 返回 `DshActionResult`（并发复用同一 Promise，成功后非阻塞重载面板）；新增 `stopBackgroundService()`；新增 `describeOutcome()` / `describeStop()` 文案翻译与 `actionText()` 统一前缀；命令面板入口改为「进行中常驻 Notice → 结果 Notice」 |
| `styles.css` | `.dsh-service-action-status`（空内容不占位 / busy / error 三态）与 `.dsh-service-action-hint` |
| `docs/changes/0056-dsh-stop-button.md` | 本提案 |
| `docs/changes/README.md` | 索引追加 0056 |
| `docs/roadmap.md` | 「需求待办」追加 R-39 |
| `docs/troubleshooting.md` | 「需手动结束」「0.1.x 不再支持」等小节首选改为按钮，`pkill` 降为手动兜底 |
| `docs/development.md` | 调试「状态栏」条目、改动地图（`port-dsh.ts` / `manager.ts` / `service.ts`）、「想改」表、手动回归清单 |
| `docs/architecture.md` | 关注点表 + 服务生命周期补「结束」路径 |
| `README.md`、`docs/install.md` | 使用 / 状态栏 / 设置项一览 / 排错矩阵同步按钮 |

## 5. 行为变化

- **设置页「服务」tab**：现有顺序为 端口 / Profile / 自动启动 / **重启服务** / **结束后台 dsh**；两个动作互斥，一个执行中另一个也禁用。
- **重启服务**：按钮「重启」→ 执行中「重启中…」，状态行「正在重启 dsh 服务… 1.2s」（每 0.2s 刷新）→ 结果 `16:20:31 · 服务已重启（端口 3081，用时 3.4s）`（服务本就在跑时 `服务已在运行（端口 3081）`）。失败为 `16:20:31 · 重启失败：<原因>` + 建议行：`locator` → 在「dsh 版本」里选一份可用安装；`exited` / `timeout` → 看控制台 `[dsh]` 日志；`occupied` → 换端口；`auth` / `unsupported` → **先点「结束后台 dsh」**。
- **结束后台 dsh**：按钮「结束」→「结束中…」，状态行「正在结束后台 dsh… 1.2s」→ 结果三选一：`已结束后台 dsh（PID 5742，用时 1.2s）`（多个 PID 用 `、` 分隔）/ `已结束插件拉起的 dsh 服务（用时 1.2s）` / `没有在运行的 dsh 服务（端口 3081 空闲）`。失败为 `结束失败：<原因>` + 建议：`foreign` → 换端口或在系统里手动处理；`timeout` → 再点一次，仍不行在终端手动结束；`unidentified` → 给出手动兜底 `pkill -f "dsh --profile obsidian"`（注明会结束同 profile 的所有实例）。
- **状态栏**：结束成功后 `DSH: 已结束`；失败分别为 `DSH: 端口被其他程序占用` / `DSH: 无法结束` / `DSH: 结束超时`；再点「重启服务」回到 `DSH: 运行中`。
- **命令面板「重启 DSH 服务」**：先弹一条常驻 Notice「DSH：正在重启服务…」，结束后换成结果 Notice（`DSH：<message> — <hint>`，成功 8s / 失败 15s）；原生面板错误页重启失败同样弹一条带 hint 的 Notice。设置页内的操作不再弹 Notice。
- 其余行为（启动 / 探测 / 就绪 / 面板承载 / 桥协议）不变。

## 6. 风险与回滚

| 风险 | 影响 | 处理 / 回滚方式 |
|---|---|---|
| 误杀同 profile 的其它实例（如 3082） | 用户其它会话中断 | 结束对象限定为「当前端口的监听 PID」且命令行核实为 dsh 才动手；不做按 profile 名的模糊匹配（路径 C 已否） |
| 平台命令缺失 / 无权限 | 取不到 PID → `unidentified`，只提示不动手 | POSIX 缺 `lsof` 回落 `ss`；Windows 用 `netstat` + `powershell`；状态行给出手动兜底，**不**自动降级成 `pkill` |
| 进程不响应 SIGTERM | 轮询 3s 后转 SIGKILL，再等 1s；仍不释放则 `timeout` | 状态行提示再点一次 / 终端手动结束；「重启服务」会再次探测 |
| 结束过程中端口被别的进程抢占 | 结束成功但端口仍被占 | 状态行如实报结果；用户再点「重启服务」时按 `occupied` 提示换端口 |
| 回滚 | 不涉及数据迁移 | 删「结束后台 dsh」行与 `stopBackground()` / `port-dsh.ts`，`restartService()` 回到「直接 restart + 单条 Notice」；`main.js` 重新构建即可 |

## 7. 验证

自动化（2026-10-28 已执行，结果见第 9 节）：

```bash
npm run build     # tsc + esbuild，无错误
npm run check     # 版本 / 依赖 / 类型 / 产物一致 / 桥清单
npm run lint      # 官方 eslint-plugin-obsidianmd recommended，0 error
```

`service/` 可单独冒烟（不必启动 Obsidian）：

```bash
./node_modules/.bin/esbuild src/service/port-dsh.ts --bundle --platform=node --format=esm --outfile=/tmp/port-dsh.mjs
node --input-type=module -e "import('/tmp/port-dsh.mjs').then(async (m) => { console.log(await m.listPortListenerPids(3081)); })"
```

手动 / CDP 实测（验收标准，可判定）：

1. 制造遗留实例：`dsh --profile obsidian --port 3088 &` → Obsidian 状态栏 `DSH: 需手动结束`（或在端口上留一个已有实例后重载插件）；
2. 设置 → DSH Native Chat →「服务」→「结束」→ 按钮「结束中…」、状态行「正在结束后台 dsh… N.Ns」→ 结果 `HH:mm:ss · 已结束后台 dsh（PID …，用时 N.Ns）`，`lsof -nP -iTCP:3088 -sTCP:LISTEN` 无输出，状态栏 `DSH: 已结束`；
3. 同机另起一个 3082 的同 profile 实例 → 步骤 2 结束后 3082 **仍在**（`lsof` 仍能看到）；
4. 点「重启」→ 状态行「正在重启 dsh 服务… N.Ns」→ 结果 `HH:mm:ss · 服务已重启（端口 …，用时 N.Ns）` → 状态栏 `DSH: 运行中`，原生面板连接（桥 v8）并发送成功；
5. 端口换成别的程序（如 `python3 -m http.server <port>`）→「结束」显示 `结束失败：端口 … 被其他程序占用（不是 dsh），没有结束它` 且**不杀**该进程；
6. 从命令面板「重启 DSH 服务」→ 先出现「DSH：正在重启服务…」，结束后换成结果 Notice；
7. 连续点两次结束 / 重启 → 两按钮互斥、执行中不可重复触发，状态行不重复叠加。

## 8. 需要你拍板

- [x] 实现路径：B（用户 2026-10-28 明确指定「加按钮 + 优化重启反馈」，按规则 12 例外直接执行）。
- [x] 结束范围：只结束插件自拉进程与**当前端口**上的 dsh，不碰其它端口实例。
- [x] 反馈方式：设置页就地状态行（不叠加 Notice），命令面板保留 Notice。
- [x] 失败原因与手动兜底命令的具体措辞：按实测输出定稿（foreign / unidentified / timeout 三态 + 建议行）。
- [x] 提案状态（`approved` → `done`）与第 9 节实施记录：2026-10-28 验收完成。

## 9. 实施记录

**实际改动**（与第 4 节一致，另有 2 处实现补强）：

- 新增 `src/service/port-dsh.ts`：`PortListener` / `listPortListenerPids`（POSIX `lsof`，缺 lsof 的 Linux 回落 `ss`；Windows `netstat`）/ `readProcessCommand`（`ps`，不可用时 `pgrep`；Windows `powershell`）/ `listPortListeners` / `looksLikeDshCommand` / `isProcessAlive` / `terminateProcesses`；可执行文件用绝对路径候选 + PATH 兜底（Finder 启动的 Obsidian PATH 精简），不向插件自身 PID 发信号。
- `src/service/manager.ts`：`DshStopOutcome` + `stopBackground()`（停自拉进程 → 等 `starting` 收敛 → 二次收尾 → 探测端口 → `foreign` 拒绝 → 取监听 PID → 命令行核实 → 终止 → 轮询端口释放）与私有 `waitPortFree()`。
- `src/shared/types.ts`：`DshActionResult` / `DshStopResult`；`src/settings/context.ts` / `src/view/panel-host.ts` 的 `restartService()` 改返回 `DshActionResult`，新增 `stopBackgroundService()`。
- `src/main.ts`：重启 Promise 并发去重、`describeOutcome()` / `describeStop()` / `actionText()`、命令面板「进行中常驻 Notice → 结果 Notice」、重启成功后**非阻塞**重载原生面板（重载最长 25s，不拖按钮反馈）。
- `src/settings/sections/service.ts`：「结束后台 dsh」行 + 两行就地状态（0.2s 计时 / `HH:mm:ss · 结果` / 失败 hint / 空内容不占位）；`src/settings/sections/plugins.ts` 与 `src/view/native/native-chat-view.tsx` 改用返回值。
- `styles.css`：`.dsh-service-action-status`（busy / error）/ `.dsh-service-action-hint`，全部走主题变量。
- 文档：本提案 + `docs/changes/README.md` + `docs/roadmap.md` + troubleshooting / development / architecture / install / README。

**与提案的偏差**（均为实现层面补强，不改变路径 B 的语义）：

1. `readProcessCommand` 增加 `pgrep -laf` 兜底：受限沙箱里 setuid 的 `/bin/ps` 会被拒绝（首轮冒烟 7 项因此失败）；macOS BSD `pgrep` 必须带 `-a` 才能读到调用者自身。命令行判定依据（含 dsh + 启动形态）不降级。
2. 端口释放预算从「先固定等 1.5s」改为「3s 预算 + 自拉进程额外 1.5s，端口一空立即返回」，避免无条件白等。
3. Windows 分支（`netstat` + `powershell Get-CimInstance`）只有实现与解析逻辑，本机 macOS 无法实测。

**验证结果（2026-10-28）**：

- `npm run build` 通过；`npm run check` 全项通过（版本三处一致 / 无运行时依赖 / manifest 合规 / `tsc` / 桥清单 / `main.js` 与源码构建一致）；`npm run lint` **0 error**（新增代码无新增 error，warning 均为 HEAD 已有）。
- 服务层冒烟（`/tmp/smoke-service.ts` → esbuild 打包 → node 运行；只用 31998 / 31999 与自建假进程）：**35/35 通过**。覆盖 PID 发现、命令行可读性、`looksLikeDshCommand` 正反例、SIGTERM → SIGKILL 升级、`stopBackground` 的 `auth` / `foreign` / `down` / `unidentified` 分支、自身进程保护、测试端口无残留监听。
- CDP 实测（Obsidian 1.14.5 + DigitalGarden vault，端口 3088）：
  1. 手工制造遗留实例（PID 14369）→ 重载插件 → 状态栏 `DSH: 需手动结束` + 单条 Notice 指引（不再叠三条）；
  2. 设置 →「服务」→「结束」：按钮「结束中…」、两个按钮互斥禁用、行下计时 → `16:44:31 · 已结束后台 dsh（PID 14369，用时 0.3s）`；`lsof` 确认 3088 释放、状态栏 `DSH: 已结束`；3082 / 3089 实例仍在（无误杀）；
  3. 点「重启」：计时 → `16:44:54 · 服务已重启（端口 3088，用时 1.5s）`、状态栏 `DSH: 运行中`，原生面板隐藏 core 桥 `connected v8`；
  4. 端口换成 `python3 -m http.server 3088` → `16:47:39 · 结束失败：端口 3088 被其他程序占用（不是 dsh），没有结束它` + 换端口建议，python 进程仍存活（`foreign` 拒绝）；
  5. 命令面板「重启 DSH 服务」→ 活动窗口先出现常驻 `DSH：正在重启服务…`，1.6s 后换成 `DSH：服务已重启（端口 3088，用时 1.6s）`；
  6. 设置页截图确认按钮布局、就地状态行、失败红框与建议行样式。
