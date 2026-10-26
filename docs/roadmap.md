# 路线图

> 当前版本 **0.2.0**（以 [manifest.json](../manifest.json) 为准）· 方案 B 已可用 · 最后更新 2026-10-26

## 现状一句话

插件能在 Obsidian 右侧面板用 Electron `<webview>` 嵌入 DSH Web GUI（环境不支持时回退 iframe），并自动拉起一个带**独立 profile（obsidian）+ 独立端口**的 dsh 服务，工作目录是当前 vault。
稳定性修复（M2）已完成，可以日常使用；dsh 0.2.1 兼容、版本选择（[提案 0003](changes/0003-dsh-version-selection-and-token-auth.md)）与 webview 承载（[提案 0004](changes/0004-webview-embedding.md)）代码已完成；
M7 把「新建会话 / 单栏 / 只用库目录」收敛到 ribbon/命令（[提案 0005](changes/0005-obsidian-native-surfaces.md)，待人工确认）；数据互通（M3）还没做；工程化（M5）已有 git 基线与提交前检查，CI / 发布未做。

## 里程碑

| 阶段 | 目标 | 状态 |
|---|---|---|
| M0 方案 A | iframe 嵌入完整 GUI | ✅ 完成 |
| M1 方案 B | 自动拉起独立服务（profile / 端口 / vault cwd）+ 设置页 + 状态栏 + 重启命令 | ✅ 完成 |
| M2 稳定性 | 服务自愈、重启无竞态、就绪探测可信、版本与文档一致、locator 版本可见 | ✅ 完成 |
| M3 数据互通 | postMessage 导出桥：会话/回复写入 vault 笔记 | ⬜ 未开始 |
| M4 方案 C | Obsidian 原生聊天视图，不再 webview/iframe 套壳 | ⬜ 未开始 |
| M5 工程化 | git 基线、CI、发布到社区插件目录 | 🚧 进行中（git + pre-commit 已就绪） |
| M6 结构重构 | src 按职责域分层（service / view / settings / shared），纯搬运不改行为 | ✅ 完成 |
| M7 Obsidian 入口 | ribbon/命令新建会话 + 单栏常开 + 只用 vault 项目（dsh 侧桥） | ✅ 完成（待人工确认） |

## M2 稳定性（优先）

> 两条提案均已落地：[0001](changes/0001-m2-stability-fixes.md)（M2-1 ~ M2-4、M2-6）、[0002](changes/0002-m2-locator-version-visibility.md)（M2-5）。立项与实施一律走「先提案后改码」。

1. **服务起来后承载面自动加载** ✅ 已完成（2026-10-26）
   原问题：`onOpen` 先设承载面地址再拉起服务；服务就绪后只更新状态条文案，承载面停在 Chromium 错误页，必须关掉面板重开。
   处理：`DshSurface.reload()`（webview 用 `loadURL` 重新导航；iframe 先跳 about:blank 再赋回原地址）+ view 记录 `surfaceReady`，服务就绪且尚未成功加载时自动重载一次。
   验收：从「服务未运行」到「面板显示 GUI」全自动（需在 Obsidian 里手动确认一次）。
2. **重启无竞态** ✅ 已完成（2026-10-26）
   原问题：发 `SIGTERM` 后固定 sleep 1s 就重新拉起，老进程没退干净会 `EADDRINUSE`，或被就绪探测误判为已启动。
   处理：新增 `stopAndWait(3000)`（等 `exit` 事件，超时 `SIGKILL` 再等 1s），`restart()` 改为「等退出 → 再 start」。
   验收：实测 start 1035ms、连续两次 restart 1043ms / 579ms，每次都先看到旧进程 exited 再 spawn，端口上始终只有一个监听。
3. **就绪探测可信** ✅ 已完成（2026-10-26）
   原问题：`fetch(mode:'no-cors')` 是 opaque 响应，任何监听都算成功，无法区分 dsh 与别的程序。
   处理：探测改为三态（running / foreign / down）；插件注入基于 Obsidian `requestUrl` 的实现（能读状态码与正文，用 `__ModuleLoader__` 标记确认是 dsh）。0003 起扩展为四态（增加 `auth`，见 M2 后续）。
   验收：实测端口被普通 http server 占用时报 occupied（状态条「端口被占用」），不再误判运行中、不再重复 spawn。
4. **版本与配置一致** ✅ 已完成（2026-10-26）
   原问题：`manifest.json` 0.2.0 与 `package.json` 0.1.0 不一致。
   处理：`package.json` 升到 0.2.0，三处一致；文档继续区分「出厂默认端口 3081」与「本机实际 3082」。
   验收：三处版本号一致（已核对）。
5. **locator 版本可见性** ✅ 已完成（2026-10-26）
   原问题：`~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js` 存在时优先用它（本机是 0.1.1-rc.2），而 PATH 上的 `dsh` 是更新的开发 checkout（0.2.1-alpha.2）；启动日志只有 spawn 命令，看不到版本，容易把旧版的报错误判成 checkout 的问题。
   处理：locator 新增 `listDshCandidates()` / `probeDshVersion()` / `inspectDshRuntime()`（版本探测在后台跑，不拖慢启动）；启动日志打印实际路径与版本；存在版本不同的其他安装时写警告日志，插件加载/重启后弹一次 Notice；设置页新增「运行环境」。服务已在运行（非本次拉起）时结果显示为「未确认的解析结果」，点「重启服务」转为确认。**解析顺序不变**，只暴露不改变选择。
   验收：见 [proposal 0002](changes/0002-m2-locator-version-visibility.md#7-验证)。
6. **拉起服务时不要打开系统浏览器** ✅ 已完成（2026-10-26）
   问题：`spawn` 只传了 `--profile / --port`，dsh 默认会打开系统浏览器（日志：`dsh web: opening the default browser; pass --no-open to disable`）。
   处理：`src/service/manager.ts` 的 args 增加 `--no-open`；实测启动后不再出现该日志、服务仍正常响应。
   验收：启动服务后不出现新的浏览器标签（已满足）。

## M2 后续：dsh 0.2.1 兼容与版本选择 ✅ 已完成（2026-10-26）

> 提案：[docs/changes/0003-dsh-version-selection-and-token-auth.md](changes/0003-dsh-version-selection-and-token-auth.md)。

- 问题：0.2.1 引入浏览器会话 token 鉴权（启动打印 `dsh web: <带 token 的 URL>`，裸 URL 401），
  插件原来的 200 探测与固定地址（当时是 iframe）会误判「端口被占用」；且用户无法选择用哪份 dsh。
- 处理：stdout 整行解析 `dsh web:` 作为 0.2.1 就绪信号与承载面地址（token 打码进日志）；探测扩为四态
  （`running/auth/foreign/down`）；设置页新增「dsh 版本」下拉（自动 / 检测到的安装）+「重新检测」；
  显式选择后不再弹版本冲突 Notice；遗留的 0.2.1 实例提示手动结束。0.1.1 兼容保留。
- 验收：0.1.1/0.2.1 双版本手动回归（见提案第 7 节）；删除 0.1.1 后自动模式落到 0.2.1。
- **剩余人工确认**：Obsidian 内验证 0.1.1/0.2.1 版本切换、遗留实例提示（0.2.1 面板加载见下一节 0004）；通过后再删 0.1.1。

## M2 后续（2）：0.2.1 webview 承载 ✅ 已完成（2026-10-26）

> 提案：[docs/changes/0004-webview-embedding.md](changes/0004-webview-embedding.md)。

- 问题：0.2.1 的会话 cookie 是 `SameSite=Strict`，面板 iframe 在 `app://obsidian.md` 顶层下属于跨站，
  token 登录 303 后不带 cookie → 401；0003 的 token 已就绪，但 iframe 承载不了。
- 处理：面板改用 Electron `<webview>`（与核心 Web viewer 共用 `persist:vault-<appId>` 分区），
  能力探测失败时回退 iframe；回退 + token 地址时给一次兼容提示。`src/view/frame.ts` → `src/view/surface.ts`。
- 验收：`npm run build` 可复现；承载面双路径冒烟通过；Obsidian 内 0.2.1 面板加载待人工确认。
- **剩余人工确认**：面板加载、重启后 token 更新、0.1.1 回归、iframe 回退提示；通过后可删除 0.1.1。

## M3 数据互通（postMessage 导出桥）

- 目标：在面板里把当前会话/某条回复写进 vault 笔记（可指定目标笔记或 daily note）。
- 思路：dsh 侧客户端插件在 GUI 里暴露导出事件（`window.postMessage`），Obsidian 侧插件监听后调用 Vault API 落盘。
- 验收：面板点「导出」→ vault 出现对应 Markdown，含 frontmatter（会话 id、模型、时间）。
- 依赖与风险：需要 dsh 客户端侧配合；相关客户端插件目前在外部仓库 `/Users/fabler/dsh-plugin` 维护，不属本仓库。

## M4 方案 C：Obsidian 原生聊天界面

- 目标：用 ItemView + Obsidian 原生组件实现聊天 UI，不再 webview/iframe 套壳（可参考 `dsh-remote-web-ui` 的 `/m` 前端）。
- 前置：M3 的通信层可复用；需要抽象出与 dsh 的传输层（HTTP / SSE / WebSocket）。
- 风险：与 dsh 前端的交互协议属内部实现，升级可能破坏；投入远大于 M2/M3。

## M5 工程化与发布

- ✅ `git init` 建立基线（2026-10-26；`main` 分支 + 首次提交）。
- ✅ 提交前检查（2026-10-26）：`npm run check` + `scripts/githooks/pre-commit`（版本三处一致、无运行时依赖、`tsc`、`main.js` 与源码构建一致、暂存集禁入 `.DS_Store` / `data.json` / 缓存）。
- ⬜ 最小 CI：GitHub Actions 跑 `npm run build` + `npm run check`。
- ⬜ 发布：版本号三处对齐（manifest / package / versions.json）、GitHub release 附件（`main.js` / `manifest.json` / `styles.css`）、提交社区插件目录。
- ⬜ 可选：给 `skills/obsidian-docs/scripts/obsdocs.mjs` 加 smoke test（用 `sync --from` 离线重建索引）。

## M6 结构重构（已完成，2026-10-26）

- 目标：把单文件 ~440 行拆成可定位的模块，为 M2 的三处修复与 M3 的通信层留出稳定落点。
- 做法：**纯搬运不改行为** —— src/main.ts 只保留组合根，进程托管进 src/service/，面板进 src/view/，
  配置进 src/settings/，基础件进 src/shared/。
- 验收：`npm run build` 通过；service 层可脱离 Obsidian 单独打包冒烟；命令 id / Notice 文案 / 状态条文案 / 探测与等待时序全部不变；
  [AGENTS.md](../AGENTS.md) 与 [docs/architecture.md](architecture.md#src-分层) 已同步。
- 后续约束：分层规则与冷启动流程固化在 `skills/project-guide` 技能里，新增文件按它的决策表落位。

## M7 Obsidian 入口（2026-10-26）

> 提案：[0005](changes/0005-obsidian-native-surfaces.md)。

- 目标：把「新建会话 / 只留中栏 / 只用库目录」收敛成 Obsidian 的 ribbon、命令与设置状态，
  不再依赖 DSH 左栏；不做原生会话列表，也不迁移 DSH 设置。
- 处理：新增 dsh 客户端插件 `dsh-obsidian-bridge`（外部仓库）：解析 vault 工作区、
  `newSession()`、CSS 零化左右轨道 + 收起 store；插件侧新增 `view/bridge.ts`、ribbon/命令
  「新建 DSH 会话」、设置页「Obsidian 集成」状态。
- 验收：见提案第 7 节；**待人工确认**：单栏常开、跨栏收回、新建会话落在 vault、未装桥时降级。

## 非目标（当前阶段明确不做）

- **移动端支持**：插件依赖 `child_process` / Node API，保持 `isDesktopOnly: true`。
- **一个 Obsidian 实例托管多个 dsh 服务**：只支持单实例、单端口。
- **自建代理或改写 dsh 前端**：优先走 dsh 官方插件机制（bundle / cordis patch）。
- **替代 dsh GUI**：面板只负责承载，不做文件浏览器/编辑器的替代实现。

## 风险与依赖

| 风险 | 影响 | 应对 |
|---|---|---|
| dsh 升级改了前端 CSS Modules 哈希 / bundles 接口 | 面板布局插件（`dsh-ui-obsidian-layout`）失效、profile 启动失败 | 升级后回归面板布局；profile 的 bundles 保持 `dsh-base + dsh-web-app` 最小集 |
| 插件用符号链接安装 | 运行时设置 `data.json` 落在本仓库里，误删会丢端口配置 | 改端口后用「重启服务」验证；`data.json` 视为运行时数据，不入版本库 |
| Obsidian 从 Finder 启动时 PATH 精简 | 找不到 dsh / node | `buildEnv` 前置候选目录；兜底可用 node 直跑 `bin.js` |
| 通过隧道/公网访问 | dsh 拒绝非 loopback Host | dsh 侧配 `--trusted-host` |
| profile 的 `cordis.patch.yml` 只有注释、没有 `[]` | dsh 启动直接报错（必须顶层 YAML 数组），面板永远起不来 | 文件末尾补一行 `[]`；见 [troubleshooting](troubleshooting.md) |
| 全局安装的 dsh 版本落后于 checkout | 行为/API 与文档不一致，报错来自旧代码 | 启动日志打印实际路径/版本，冲突时有警告日志 + 一次 Notice；设置页「dsh 版本」可直接切换（0003） |
| dsh 0.2.1+ 的 token 鉴权 | 裸 URL 401、遗留实例无法接管 | 插件从 stdout 读就绪 URL 并用于 webview 承载面；遗留实例提示手动结束；重启后 token 变化需重开面板 |
| Obsidian 收紧 webviewTag | 0.2.1 面板无法登录 | 自动回退 iframe + 一次兼容提示；0.1.1 不受影响 |

## 维护规则

- 状态变化只改本文件（必要时同步 [docs/README.md](README.md) 索引），**不要**在根 README 复制路线图清单。
- 新增里程碑按 M6/M7 续编号，必须写「验收标准」，否则不算可交付项。
- 已完成项保留在表里（历史可查），不要删除。
