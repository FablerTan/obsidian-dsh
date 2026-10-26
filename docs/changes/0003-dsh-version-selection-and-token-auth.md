---
status: done             # draft | approved | done | rejected
created: 2026-10-26
approved: 2026-10-26     # 用户逐条确认第 8 节决策项后批准
scope: src/service, src/view, src/settings, src/shared, src/main.ts, docs
issue: 支持 dsh 0.2.1 的 token 鉴权，并允许在设置里自由选择检测到的 dsh 版本（移除 0.1.1 的前置）
---

# 0003 dsh 版本选择 + 0.2.1 token 鉴权支持

> 状态：**已完成（2026-10-26）**。按方案 A 实施；用户已确认第 8 节全部决策项。
> 前置：[0002](0002-m2-locator-version-visibility.md)（M2-5 版本可见性，已完成）。
> 背景：按用户要求清理 0.1.1 时发现 0.2.1 需要 token 鉴权，插件直接切过去会判成「端口被占用」、面板起不来；
> 目前已恢复 0.1.1，等本提案落地并验证后再删。
> 后续变化（0004）：面板改用 Electron `<webview>`（回退 iframe），`src/view/frame.ts` 并入 `src/view/surface.ts`；
> 本文的 token 流程与设置项仍然有效，iframe 描述保留为当时实现记录。

## 1. 背景与问题

2026-10-26 实测（临时端口 3099、profile `obsidian`、`--no-open`）：

| 版本 | 启动日志 | 根 URL（无 cookie） | 带 token 的 URL |
|---|---|---|---|
| 0.1.1-rc.2（全局安装） | 无 `dsh web:` 行 | **200**，正文含 `__ModuleLoader__` | —（没有 token 机制） |
| 0.2.1-alpha.2（PATH checkout） | 异步打印 `dsh web: http://127.0.0.1:3099/?token=…` | **401**（或短窗口 404） | 302 + Set-Cookie，随后 200 且含 `__ModuleLoader__`；cookie 生效后根 URL 也是 200 |

0.2.1 的 web-server 文档明确：dist 根与 index 由 Connection 做浏览器会话鉴权（「token redirect or 401」），
非 index 静态资源公开；token 是**每个进程新生成**的，`dsh web --help` 没有关闭鉴权的参数。

插件当前实现（[manager.ts](../../src/service/manager.ts) / [host.ts](../../src/shared/host.ts) /
[dsh-view.ts](../../src/view/dsh-view.ts)）：

- 就绪探测：`requestUrl(http://127.0.0.1:<port>)` → 要求 200 且正文含 `__ModuleLoader__`，否则算 `foreign`；
- iframe：固定加载 `http://127.0.0.1:<port>`（[schema.ts](../../src/settings/schema.ts) 的 `serviceUrl()`）。

于是换成 0.2.1 后：探测 401 → 判成「端口被占用」；即便忽略探测，iframe 加载裸地址也只会看到 401。
**直接删掉 0.1.1 会让面板完全不可用**，这就是本次清理被中止的原因。

另外，M2-5 只做到了「让用户看见实际用的是哪份 dsh」，还不能**选择**用哪份：
设置页只有端口 / profile / 自动启动，用户想从 0.1.1 切到 0.2.1 只能改安装顺序（删旧版 / 改 PATH）。

## 2. 目标与非目标

- 目标：
  1. **版本可选**：设置页「dsh 版本」下拉列出 locator 检测到的所有安装（版本 + 路径），
     可选「自动（按现有优先级）」或指定某一份；选择持久化到 `data.json`，改完点「重启服务」生效。
  2. **0.2.1 可用**：拉起子进程后从 stdout 捕获 `dsh web: <带 token 的 URL>`，把它作为
     **就绪信号**和 **iframe 地址**（token 只用于首次登录，浏览器随后用 cookie）；
     0.1.1 走原有 200 探测兜底，两个版本都能用。
  3. **版本提示与选择联动**：自动模式下保留 M2-5 的冲突提示；显式选择后只在日志/设置页展示其他版本，
     不再每次启动弹 Notice。
  4. 验证通过后，用户可安全删除 0.1.1，插件自动模式落到 0.2.1。
- 非目标：
  - 不自动判定「新版更好」并擅自改选（版本号不代表兼容性，选择权交给用户）。
  - 不支持手动输入任意路径（只从检测到的安装里选；确有需要再另起提案）。
  - 不接管「已在运行、但拿不到 token」的 0.2.1 实例（token 是进程内的，插件无法从外部读取；
    这类实例只能提示用户手动结束）。
  - 不改 dsh 侧代码、不给 dsh 加关闭鉴权参数。
  - 不在本提案里删除 0.1.1（删除是验证通过后的用户操作，不写进代码）。

## 3. 方案

### 方案 A（推荐）：stdout 就绪信号 + tokenized iframe + 设置页版本选择

**3.1 设置与解析**

- `settings/schema.ts`：`DshPluginSettings` 增加 `dshPath: string | null`，默认 `null` = 自动；
  兼容旧 `data.json`（`mergeSettings` 补默认值）。
- `service/locator.ts`：`resolveDshCommand(preferredPath?: string | null)` ——
  有偏好时在 `listDshCandidates()` 里按展示路径精确匹配（必要时 realpath 归一），命中即用；
  未命中 / 为空则回退现有优先级（行为与 M2-5 一致）。
- `service/manager.ts`：`DshServiceConfig` 增加 `dshPath`，每次 spawn 时读取最新设置；
  解析不到指定项时写警告日志并用自动结果，运行信息里带上「已回退」。

**3.2 0.2.1 token 流程（核心）**

- `spawnChild` 已经 pipe 了 stdout：在其上做行缓冲，匹配 `/dsh web: (https?:\/\/\S+)/`，
  命中后保存 `webUrl`（含 token），并通过现有 `onRuntime` 或新增回调通知插件层。
- 就绪等待改为「任一条件成立」：
  - 0.2.1：收到 `dsh web:` 行即就绪（dsh 自己说明该行是 supervisor 就绪信号）；
  - 0.1.1：沿用原有 200 探测（`running` + `__ModuleLoader__`）；
  - 期间同时 race 子进程 `exit`；总超时仍为 40 × 500ms ≈ 20s。
- 探测扩展为四态：`running` / `foreign` / `auth` / `down`
  （`auth` = 能连上但需要 token，即 401/302 的 dsh）。
  - spawn 后的等待循环忽略 `auth`（自己的 0.2.1 还没吐 URL 时会出现），靠 URL 行或 exit 收敛；
  - spawn **前**的预检查：`running` → 复用；`auth` → 不 spawn，返回新原因 `auth`，
    Notice 提示「端口上已有需要 token 的 dsh（可能是上次遗留的实例）」并给出手动结束方式；
    `foreign` / `down` 语义不变。
- 对外 URL 拆分：
  - `manager.webUrl` / `embedUrl`：带 token（iframe 用）；
  - `manager.url` / `displayUrl`：不带 token 的 `http://127.0.0.1:<port>`（banner、日志、设置页展示用）。
- iframe：`DshFrame` 增加按新地址重载的能力（`reload(url?)` 或复用 `load`），
  面板就绪后加载 tokenized URL；服务重启后 token 会变，需要重新取 `embedUrl`。
- 日志脱敏：`shared/log.ts` 的 `logChild` 把 `token=...` / `?token` 打码为 `token=***`
  （dsh 自己会打印带 token 的 URL，避免 token 落在控制台/截图里）。
- 遗留限制（写进 troubleshooting）：非本次拉起的 0.2.1 实例没有 token，插件只能提示
  `pkill -f "dsh --profile obsidian"` 后重启服务；不自动杀陌生进程。

**3.3 设置页「dsh 版本」**

- `SettingsHost` 增加 `detectDshInstalls(): Promise<DshInstall[]>`（locator 候选 + 版本探测）。
- 设置页新增下拉：`自动（按优先级）` + 每个检测到的安装，label 形如
  `0.1.1-rc.2 — /Users/…/bin.js`；旁边「重新检测」按钮重新拉列表。
- 检测是异步的：先渲染已保存值，列表到达后补 options（Obsidian `Setting.addDropdown` 支持后加）。
- 修改后提示「点『重启服务』生效」；「运行环境」小节继续显示当前实际使用的路径/版本，
  并标注「自动 / 手动选择」。
- 自动模式 + 多版本时保留 M2-5 的一次性 Notice；显式选择后不再弹（避免每次启动打扰）。

### 方案 B（备选）：只做 token 支持，不做版本选择

用户仍需靠删除/安装顺序决定版本，无法在 0.1.1 与 0.2.1 之间来回验证、回滚成本高。
不选。

### 方案 C（备选）：读 dsh 进程环境或文件拿 token

token 是进程内生成的，磁盘/环境没有稳定入口；无论文承诺，且要访问其他进程内存，不可行。不选。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/settings/schema.ts` | 新增 `dshPath: string \| null`（默认 `null`）；设置类型/默认值/注释 |
| `src/settings/tab.ts` | 「dsh 版本」下拉 + 「重新检测」；`SettingsHost.getRuntimeInfo()` 旁增 `detectDshInstalls()` |
| `src/service/locator.ts` | `resolveDshCommand(preferredPath?)`；按路径匹配 + 回退自动 |
| `src/service/manager.ts` | config 增加 `dshPath`；stdout 捕获 `dsh web: <url>`；就绪逻辑改为 URL 行/200 探测二选一；四态探测；`embedUrl`/`displayUrl`；新失败原因 `auth`；运行信息带「选择/回退」 |
| `src/shared/types.ts` | `ProbeResult` 增加 `'auth'`；运行信息补充选择状态（如需） |
| `src/shared/host.ts` | requestUrl 探测把 401/302 识别为 `auth`（保守判定，见风险） |
| `src/shared/log.ts` | `logChild` 对 `token=` 打码 |
| `src/view/frame.ts` | 支持按新地址重载（token 变化 / 端口变化） |
| `src/view/dsh-view.ts` | banner 用 displayUrl；iframe 用 embedUrl；就绪后按最新 embedUrl 加载 |
| `src/main.ts` | 注入 `dshPath`；实现 `detectDshInstalls()`；`auth` 原因映射 Notice；自动/手动模式的冲突提示策略 |
| `docs/` | roadmap（M2-7 / 可选后续）、architecture（token 与 URL 拆分、四态探测）、development（改动地图/回归）、troubleshooting（遗留 0.2.1、手动结束、删 0.1.1 的步骤）、README（设置项）、changes/README 索引 |

## 5. 行为变化

- 设置页多出「dsh 版本」：可选自动或指定某个检测到的安装；改完重启服务生效。
- 选 0.2.1 时：面板能正常加载（iframe 使用带 token 的 URL），日志里的 token 被打码；
  状态条文案与「重启服务」命令不变。
- 选 0.1.1 时：行为与现在完全一致（200 探测兜底）。
- 显式选择后启动不再弹版本冲突 Notice；自动模式行为与 M2-5 相同。
- 端口上已有「需要 token 的 dsh」时，不再误报「端口被占用」，而是明确提示需要手动结束。
- 删除 0.1.1 后，自动模式解析到 0.2.1，面板照常工作。

## 6. 风险与回滚

| 风险 | 影响 | 回滚/缓解 |
|---|---|---|
| requestUrl 对 tokenized URL 的 cookie 行为与浏览器不同（跟随 302 后可能仍 401） | 探测误判 | 就绪判定以 stdout `dsh web:` 行为准，不依赖探测携带 cookie；探测只做预检查 |
| 401 被陌生程序命中，误判为 `auth` | 不 spawn、提示手动结束 | 判定保守（401 + 可识别的 dsh 响应头/正文特征，具体在实现时用实测响应确定）；拿不准时按 `foreign` 处理 |
| token 泄漏到控制台/截图 | 本地会话 token 泄露 | `logChild` 打码；banner 与设置页只显示裸 URL；iframe DOM 内 src 仍含 token（本地 iframe，可接受） |
| 显式选择的安装被删除 | 启动失败 | 回退自动 + 警告日志 + 设置页标注「已回退」 |
| 版本切换后需要重启服务，用户忘记 | 面板仍连旧实例 | 设置页提示文案；README/development 同步 |
| 0.1.1 兼容逻辑被改坏 | 旧用户无法启动 | 保留 200 探测路径；回归清单同时覆盖两版 |

整体回滚：`dshPath` 默认 `null` 且旧代码会忽略未知字段，直接回退代码即可恢复现行为；0.1.1 在验证通过前不删除。

## 7. 验证

自动化（不依赖 Obsidian）：

1. `npm run build` 通过；`main.js` 两次构建 hash 一致。
2. locator 冒烟：`resolveDshCommand()`（自动）与 `resolveDshCommand('/…/bin.js')` 返回预期；
   不存在的路径回退自动。
3. manager 冒烟（node 脚本，注入假 probe / 假子进程）：
   - 假 0.2.1：stdout 打印 `dsh web: http://127.0.0.1:<p>/?token=abc` → 就绪、`embedUrl` 含 token、
     `displayUrl` 不含；日志中 token 为 `***`；
   - 假 0.1.1：不打印 URL、探测 200 + `__ModuleLoader__` → 就绪；
   - 端口先被普通程序占用 → `foreign`；被「401 假 dsh」占用 → `auth` 且不 spawn。
4. 设置页（Obsidian）：下拉列出两份安装、选择持久化到 `data.json`、「重新检测」能刷新。

手动回归（Obsidian）：

1. 选「自动」+ 0.2.1 在 PATH：重载插件 → 面板加载 GUI、控制台 token 打码、设置页显示 0.2.1。
2. 下拉选 0.1.1 → 重启服务 → 面板正常，设置页显示 0.1.1。
3. 再切回 0.2.1 → 重启服务 → 面板正常（token 每次变化不影响）。
4. 删除 0.1.1 后（用户操作）：自动模式 → 重启服务 → 面板正常、设置页只剩 0.2.1。
5. 端口上留一个 0.2.1 实例后重载插件：状态/Notice 明确提示需手动结束，不误报「端口被占用」。

验收标准：上述手动回归全部通过，且 0.1.1 删除后插件在 Obsidian 里能长期正常使用。

## 8. 需要你拍板

用户 2026-10-26 逐条确认：

- [x] **选择粒度**：只列「检测到的安装」，不做手动路径输入。
- [x] **显式选择后的提示**：不再弹版本冲突 Notice，只在设置页 / 日志展示。
- [x] **遗留 0.2.1 实例**：接受「提示用户手动 `pkill`」，不加结束进程命令。
- [x] **token 日志打码**：控制台里 token 打码为 `***`。
- [x] **切换版本后的动作**：保持「改完点重启服务」，不自动重启。
- [x] **版本选择的默认值**：自动 = 现有优先级，不按版本号高低自动改选。
- [x] 实施顺序：先做本提案并验证 0.2.1 面板可用，之后再确认删除 0.1.1。

## 9. 实施记录

**2026-10-26 实施完成**（方案 A；用户已确认第 8 节全部决策项）。

| 项 | 实际改动 | 验证 |
| --- | --- | --- |
| 设置 | `schema.ts` 新增 `dshPath: string \| null`（默认 `null`）；`tab.ts` 新增「dsh 版本」下拉（自动 + `detectDshInstalls()` 结果，label = 版本 + 路径）+「重新检测」 | `tsc`/build 通过；Obsidian 内渲染待人工确认 |
| locator | `resolveDshInstall(preferredPath)`：展示路径 / 启动命令 / realpath 三种匹配，未命中回退自动并标 `fallback`；`resolveDshCommand(preferredPath?)` 复用 | 冒烟：auto = 全局 bin.js；选 PATH `dsh` = 0.2.1；选 symlink realpath 命中；选不存在路径 → `fallback: true` |
| manager | `DshServiceConfig` 增加 `dshPath`；stdout/stderr 按**整行缓冲**后解析 `dsh web: <url>`（就绪信号 + token 地址）并打码转发；`embedUrl`（带 token）与 `url`（干净）分离；探测四态；新失败原因 `auth`（状态条「需手动结束」）；spawn 后的 `auth`/`foreign` 继续等（预检查的 `foreign` 才报占用）；超时先杀掉自启子进程；版本回退警告 | 假 HOME 七场景 + 真实 0.2.1 E2E（见下） |
| 插件层 | main 注入 `dshPath`、实现 `embedUrl` / `detectDshInstalls()` / `auth` Notice；显式选择后不再弹冲突 Notice；回退提示一次 | `npm run build` 通过 |
| view | `DshPanelHost.embedUrl`；iframe 用 embedUrl；就绪后用最新 embedUrl `reload(url)` | build 通过；GUI 待人工确认 |
| 文档 | roadmap / architecture / development / troubleshooting / README / AGENTS / changes 索引同步 | 相对链接与锚点全量校验通过 |

验证结果：

- `npm run build` 通过；`main.js` 连续两次构建 sha256 均为 `5a883533a69c7b6cc4abe28d038c89a362ae7a57572ed4b3486e80df15d1a099`（19003 B，可复现）。
- **manager 冒烟（假 HOME + 假子进程，7 个场景）**：
  - 0.2.1 形态：URL 行被拆成两个 chunk（分别在 `?token=` 前、后断开）→ 两种情况都拿到完整 token；`embedUrl` 含 token、`url` 不含、日志中 token 为 `***`（含跨 chunk 场景）；
  - 0.1.1 形态：无 URL 行，探测 `running` 后判定就绪，`embedUrl === url`；
  - 启动期探测返回 `foreign`（模拟 0.2.1 前端 fallback 注册前的 404）+ URL 延迟 1.5s → 仍继续等待并成功就绪（不再误报「端口被占用」）；
  - `auth` 预检查：`reason: 'auth'`、状态条「需手动结束」、不 spawn；
  - 指定不存在的安装：`onRuntime.fallback = true`，仍按自动结果拉起；
  - 子进程提前退出：立即 `reason: 'exited', exitCode: 1`，不干等 20s。
- **真实 dsh 0.2.1 端到端（最终代码）**（端口 3198、`--no-open`、cwd = vault）：就绪约 2.0s，`embedUrl` 含 token、`url` 干净、`runtime.version = 0.2.1-alpha.2`、日志无明文 token。
- locator 冒烟：见上表。
- **待在 Obsidian 里人工确认**：设置页下拉/重新检测、0.2.1 面板真实加载（cookie）、0.1.1↔0.2.1 切换、遗留 0.2.1 的「需手动结束」、删除 0.1.1 后自动模式落到 0.2.1。

偏差与说明：

- URL 行改为「整行到齐再匹配」：假子进程实测首 chunk 可能正好截断在 `?token=` 前，提前匹配会丢 token（已修）。
- 独立验证（verifier）发现并已修复：
  1. **阻塞**：spawn 后、URL 行到齐前，0.2.1 会短暂 401/404（分别是 `auth` / `foreign`），原实现遇到 `foreign` 会提前报「端口被占用」并留下子进程。现在 spawn 后忽略 `auth`/`foreign`（预检查阶段的 `foreign` 仍报占用），由 URL 行 / exit race / 20s 超时收敛；超时会先杀掉自启子进程。
  2. **重要**：每个 stdout chunk 单独打码时，token 被 chunk 拆开会漏打码。现在 stdout/stderr 都按**整行**缓冲，整行打码后再转发（跨 chunk 也不会泄漏）。
  3. 次要：设置页 `display()` 改为 async —— 先探测版本再渲染下拉，避免异步补 options 覆盖用户刚改的值，并补 `catch`；`detectDshInstalls()` 过滤 PATH 占位候选（不再出现「未知版本 — dsh (PATH)」伪选项）。
- `auth` 判定用 0.2.1 的 401 正文特征 `dsh web authentication required`，避免把任意 401 都当成 dsh。
- token 只在内存里用于 iframe 首次登录；日志/设置页/banner 均不显示明文（iframe src 里仍有，本地 iframe 必需）。
- 显式选择版本后不弹冲突 Notice（按你的选择）；自动模式仍保留 M2-5 的一次性提示。
- 切换版本后需要手动点「重启服务」（按你的选择）；重启后 token 变化，已打开的面板建议重开。

可选后续（未做）：

- 无任何 dsh 安装时 `listDshCandidates()` 仍会加入占位 `{ cmd: 'dsh' }`，所以 `resolveDshInstall` 不返回 `null`（既有行为，测试已确认）；manager 会 spawn ENOENT 并等 ~20s 超时。设置页下拉已过滤掉这个占位项。要彻底改成「无法定位」需要单独调整 locator（另起提案）。
- 删除 0.1.1 是验证后的用户操作（见 troubleshooting），不在代码改动内。
- **既有问题（非 0003 引入，verifier 复验时发现）**：`manager.stop()` 的 SIGKILL 兜底用 `if (!child.killed)` 判断，
  但 Node 在 SIGTERM 发送成功后就把 `child.killed` 置 true，该兜底实际不会执行。正常 dsh 会响应 SIGTERM，
  所以目前影响有限；若某版本忽略 SIGTERM，超时/卸载仍可能留下进程。建议后续改为检查 `exitCode/signalCode`
  或 2s 后无条件 SIGKILL（单独小改动，需先提案）。
