---
status: approved       # draft | approved | done | rejected
created: 2026-10-26
approved: 2026-10-26   # 用户确认：接受 dsh 插件；只做 ribbon + 命令 + 设置入口；只认 vault 一个项目；单栏常开；不做 DSH 设置入口
scope: src/view, src/main.ts, src/settings, src/shared, styles.css, README.md, docs；另新增外部 dsh 客户端插件
issue: 把 DSH 的「新建会话 / 单栏 / 只用 vault 项目」收敛成 Obsidian 的 ribbon、命令与设置状态，去掉面板里的左栏依赖
---

# 0005 用 Obsidian ribbon / 命令 + dsh 桥收敛 DSH 左栏（窄范围版）

> 状态：**已批准，执行中**（2026-10-26）。范围按用户拍板收窄：
> 1) 接受新增一个 dsh 客户端插件；2) 只做 ribbon + 命令 + 设置入口，不做原生会话列表；
> 3) 只把 Obsidian 库目录当作唯一项目；4) 单栏常开；5) 不做「打开 DSH 设置」。
>
> 原调研（会话列表、工作区树、设置面板迁移）保留在讨论记录里，不在本期实施。

## 1. 背景与问题

面板嵌的是完整 DSH 三栏。窄面板里左栏挤占聊天宽度，而实际日常只需要：

- 在 Obsidian 里一键**新建会话**（落在当前库，不选工作区）；
- **只保留中栏**（左栏、右栏都不显示），不再和 DSH 自己的侧栏抢空间；
- 不维护第二套会话/工作区浏览器，也不迁移 DSH 设置表单。

现状：左栏折叠在 macOS 上虽然能到 0 宽，但刷新/重开面板又恢复；右栏可能在打开文件时自动出现；新建会话仍要先进面板点按钮。

## 2. 目标与非目标

- 目标：
  1. Obsidian ribbon + 命令提供「新建 DSH 会话」：自动起服务、打开面板、在**当前 vault 工作区**新建并切入会话；
  2. **单栏模式始终开启**：dsh 侧桥持续保证左栏收起、右栏关闭（用户手动展开也会被收回）；
  3. 只认 Obsidian 库目录：桥把 vault 绝对路径配置成唯一目标工作区；不存在则创建；新建会话固定落在它上面；
  4. 插件设置页显示集成状态（桥版本 / 工作区解析结果 / 单栏状态），不提供单栏开关。
- 非目标：
  - 不做原生会话列表、工作区树、搜索/重命名/分叉/归档 UI（已拍板不做）；
  - 不做「打开 DSH 设置」入口，也不迁移 DSH 设置表单；
  - 不做原生聊天（M4）；
  - 不删除/改写用户已有的其它 DSH 工作区与会话（只是不再从 UI 暴露）；
  - 不支持 iframe 回退下的桥（跨源）。
- 约束：
  - dsh 插件放外部仓库 `~/dsh/dsh-plugin`（其 AGENTS §0 需同步登记本次例外）；
  - 不自行重启 DSH 服务；安装完成后由用户重启并验证。

## 3. 方案

### 3.1 dsh 侧：`dsh-obsidian-bridge`（纯客户端插件）

- 目录：`self-made/dsh-obsidian-bridge/`（独立 git）。
- `package.json`：`dsh.bundle.patch` + `dsh.client { platform: 'web', immediately: true }`；
  `lib/index.js` 是空 host 半身；`lib/client.js` 用 `window.__ModuleLoader__.load` 注册。
- 客户端桥（不渲染 UI、不注册 slot）：
  - 通过 `ctx.get(...)` 惰性拿服务，避免启动顺序失败：
    `uiWorkspace`、`workspaces`、`layout`、`sessions`、`sidebarRight`（可选）。
  - 暴露 `window.__DSH_OBSIDIAN_BRIDGE__`：
    - `version: 1`、`ping()`
    - `configure({ paths: string[] })`：按 `path` 找到 vault 工作区；没有则 `workspaces.create({ path })`；记住 `workspaceId`；
    - `newSession()`：`uiWorkspace.startSession(workspaceId)`（固定 vault 项目）；
    - `enforceSingleColumn()`：左栏已展开则 `layout.toggleSidebar()`；右栏 `sidebarRight.isExpanded()` 则 `toggleExpanded()`；
    - `state()`：`{ version, workspaceId, workspacePath, sidebarCollapsed, rightbarExpanded }`。
  - 常驻：`ctx.effect` 内 `setInterval(enforceSingleColumn, 500)` + 启动后多次延时补一次；dispose 时清理并删除全局。
  - 用 `data-rightbar-col` / `data-sidebar-collapsed` 判断列状态，**不依赖 CSS Modules 哈希**；`display:none` 禁用（会破坏 grid）。
- 安装：`dsh plugin --profile obsidian add link:<path>`（reconcile 会并入 `dsh.profile.bundles`），随后由用户重启服务。

### 3.2 Obsidian 侧

- `src/view/surface.ts`：`DshSurface` 增加 `executeJavaScript<T>(code)`；webview 透传 `el.executeJavaScript`，iframe 抛「当前承载方式不支持脚本」。
- `src/view/dsh-view.ts`：`DshWebView.runScript<T>(code)`，没有承载面时抛错。
- `src/view/bridge.ts`（新增）：
  - `callDshBridge(app, method, ...args)`：取当前 DSH 面板的 view → runScript；统一把「无面板 / 非 webview / 无全局 / 版本不匹配 / 桥方法抛错」翻译成 `BridgeError(reason)`；
  - `waitForDshBridge(app, timeoutMs)`：轮询 `ping()`（300ms 间隔）；
  - 不 import main.ts。
- `src/main.ts`：
  - ribbon：`message-square-plus`（DSH 新建会话）→ `newDshSession()`；
  - 命令：`new-dsh-session`「新建 DSH 会话」；
  - `newDshSession()`：`ensureDsh()` → `openDshPanel()` → `waitForDshBridge` → `configure({ paths: [vault, realpath] })` → `newSession()`；失败按原因给 Notice（服务失败 / 面板不可用 / 桥未安装 / 桥版本不符 / iframe）。
- `src/settings/tab.ts` + `schema.ts`：
  - 新增只读「Obsidian 集成」段：单栏模式=始终开启；桥状态（检测按钮，显示版本或安装提示）；项目目录（vault 路径）；
  - 不新增单栏开关。
- `styles.css`：仅当有新增 DOM 时补样式；本期预计无需新增。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/surface.ts` | `DshSurface.executeJavaScript` + webview/iframe 实现 |
| `src/view/dsh-view.ts` | `runScript` 窄接口 |
| `src/view/bridge.ts`（新增） | 桥调用、错误归因、等待就绪 |
| `src/main.ts` | ribbon + 命令 + `newDshSession` 流程 |
| `src/settings/tab.ts` / `schema.ts` | 集成状态段（只读） |
| `src/shared/types.ts` / `constants.ts` | 桥错误类型、脚本接口类型（如需） |
| `README.md` / `docs/architecture.md` / `docs/development.md` / `docs/troubleshooting.md` / `docs/roadmap.md` | dsh 侧依赖、分层图、改动地图、排障、里程碑 |
| 外部 `self-made/dsh-obsidian-bridge/` | 新插件（package.json / cordis.patch.yml / lib/index.js / lib/client.js / README） |
| 外部 `AGENTS.md` / `PROFILES.md` | 登记本次例外与 profile 链接 |

## 5. 行为变化

- ribbon/命令新增「新建 DSH 会话」：不需要先进面板点左栏按钮。
- 单栏常开：DSH 面板内左栏、右栏被持续收起；用户手动展开会被收回。
- 新建会话固定落在 vault 对应的 DSH 工作区；不再依赖“当前/最近工作区”的隐式选择。
- 未安装桥插件时：新建会话命令提示安装方法，面板行为不变；不会崩。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| dsh 客户端服务名/方法变化 | 桥失配 | `version` + `ping` 能力探测；失败只影响新命令与单栏，面板仍可用；可移除 dsh 插件 |
| 单栏强制与用户操作打架 | 无法用 DSH 侧栏/右栏 | 移除 dsh 桥插件即恢复；Obsidian 侧无开关（按需求常开） |
| vault 路径与 dsh workspace path 不一致（符号链接） | 找不到工作区、重复创建 | `paths` 同时传 `getBasePath()` 与 `realpath`；创建前先精确匹配；设置页显示解析结果 |
| 面板未打开时命令拿不到桥 | 新建会话失败 | 命令先打开面板并等待桥；超时给明确 Notice |
| 安装 dsh 插件失败（pnpm/权限） | 功能不可用 | 保留手动安装说明；Obsidian 侧不硬依赖 |
| 外部仓库 §0 范围约束 | 治理冲突 | 同一次变更在 AGENTS §0 登记例外；仅限该插件 |

## 7. 验证

- 自动化：`npm run build`；`node --check` dsh 插件两个 lib 文件；桥的纯 Node 冒烟（可选，stub execute）。
- 手动（需用户执行，因为外部规则禁止自行重启 DSH）：
  1. 安装桥插件 → 重启 DSH 服务 → 重载 Obsidian 插件；
  2. 面板打开后：左栏/右栏保持收起；手动点开左栏或打开右栏，≤1s 被收回；
  3. ribbon/命令「新建 DSH 会话」→ 面板出现新会话且输入框可聚焦；
  4. 新建的会话在 vault 工作区下（可在 dsh 侧栏临时展开确认）；
  5. 未安装/停用桥插件 → 命令给出安装提示，面板与既有命令不回归；
  6. iframe 回退（若可模拟）→ 命令提示不支持，不崩溃。
- 验收标准：1~5 全部通过；`npm run build` 可复现；既有命令/状态条文案不变。

## 8. 需要你拍板

（已拍板，留档）
- [x] 接受新增 dsh 插件。
- [x] 只做 ribbon + 命令 + 设置入口；会话列表不做。
- [x] 只认 Obsidian 库目录作为唯一项目。
- [x] 单栏常开。
- [x] 不做「打开 DSH 设置」。

## 9. 实施记录（2026-10-26，待人工确认）

### 实际改动

- dsh 侧（外部仓库 `~/dsh/dsh-plugin/self-made/dsh-obsidian-bridge`）：
  - 新插件 `dsh-obsidian-bridge@0.1.0`：host 空壳 + client 桥；
  - `configure({ paths })` 解析/创建 vault 工作区（同时接受原路径与 realpath）；
  - `newSession()` → `ctx.uiWorkspace.startSession(vaultWorkspaceId)`；
  - `enforceSingleColumn()`：500ms 周期 + 启动补帧；**CSS 零化 frame 的左右轨道并隐藏两列**
    （Web 构建收起左栏仍留 56px，单靠 store 不够）+ `layout.toggleSidebar()` + `sidebarRight.toggleExpanded()`；
  - 已链接进 obsidian profile（`package.json` 的 dependencies 与 `dsh.profile.bundles` 均含 `dsh-obsidian-bridge`），
    `dsh --profile obsidian --dump-config` 能看到插件行。
- Obsidian 侧（本仓库）：
  - `src/view/surface.ts` 增加 `executeJavaScript`（webview 透传，iframe 拒绝）；
  - `src/view/dsh-view.ts` 增加 `surfaceKind` / `runScript`；
  - 新增 `src/view/bridge.ts`：调用、等待就绪、错误归因、状态探测；
  - `src/main.ts`：ribbon「新建 DSH 会话」+ 命令 `new-dsh-session`；流程 = 起服务 → 开面板 → 等桥 →
    `configure([vault, realpath])` → `newSession()`；设置宿主新增 `getBridgeStatus()`；
  - `src/settings/tab.ts`：新增「Obsidian 集成」段（单栏常开说明、项目目录、桥状态 + 重新检测 + 安装命令）；
  - `src/shared/types.ts`：`DshBridgeStatus`；`styles.css`：安装命令折行；
  - 文档：README / architecture / development / troubleshooting / roadmap / 本提案与索引。

### 与提案的偏差

- 原计划“只调 `layout.toggleSidebar()`”在 Obsidian 的 **Web** 构建里只到 56px 轨道；实施改为
  **CSS 零化轨道 + 隐藏两列**（hash-free：`div:has(> [data-rightbar-col])`），store 收起保留作状态同步。
  因此单栏在 0.1.x 上不生效（没有 `data-rightbar-col`），文档已写明要求 0.2.x。
- 设置页新增了“桥状态/项目目录”，未新增单栏开关（按要求常开）。

### 已验证

- `npm run build` 通过（tsc + esbuild）。
- dsh 插件 `node --check lib/client.js` / `lib/index.js` 通过。
- 桥客户端用 Node stub 冒烟通过：`configure` 能匹配已有工作区 / 创建新工作区，`newSession` 调到
  `uiWorkspace.startSession(workspaceId)`，`enforceSingleColumn` 返回 CSS 标记。
- `dsh plugin --profile obsidian add link:…` 成功；profile `dsh.profile.bundles` 含 `dsh-obsidian-bridge`；
  `--dump-config` 含插件行。
- 未做（需人工）：Obsidian 内单栏实际效果、跨栏收回、新建会话落点、未装桥降级、iframe 回退。

### 待人工确认

1. 重启 DSH 服务 + 重载插件后：左右栏是否完全消失（无 56px 轨道）；手动展开是否 ≤1s 收回；
2. 功能区/命令「新建 DSH 会话」是否新会话且输入框可用；
3. 新会话是否归属 vault 工作区（临时展开 DSH 左栏确认）；
4. 设置页「桥接状态」是否显示已连接（v1）；
5. 移除桥后命令是否只提示、不崩。
