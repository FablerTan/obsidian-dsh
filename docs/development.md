# 开发

## 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20（构建）；dsh 运行需 `^22.19.0 || >=24.0.0` | 版本不符会导致服务「启动失败(退出码 N)」 |
| npm | 随 Node | 只装 devDependencies |
| Obsidian | ≥ 1.4.0，桌面端 | 移动端不支持（插件用 `child_process`） |
| dsh | 已安装并可执行 | 见 [architecture.md](architecture.md#进程解析与环境) |

## 首次搭建

```bash
npm install          # esbuild / typescript / obsidian 类型；postinstall 自动安装 git hooks
npm run build        # tsc -noEmit -skipLibCheck && esbuild（production）→ main.js
npm run check        # 提交前检查：版本 / 依赖 / 类型 / main.js 与源码构建一致
npm run dev          # watch 模式：改源码自动重编译（Obsidian 里需「重新加载插件」）
```

## 安装到 vault

```bash
# 开发期推荐：符号链接，改代码即生效（记得 npm run build / npm run dev）
ln -s ~/fablerCode/test/obsidian-dsh ~/fablerCode/pi-coding/.obsidian/plugins/obsidian-dsh
```

发布/分享时才复制三件套到 `<vault>/.obsidian/plugins/obsidian-dsh/`：`main.js`、`manifest.json`、`styles.css`（可选加 `versions.json`）。
启用路径：Obsidian 设置 → 第三方插件 → 启用 **DSH in Obsidian**。

> 注意：符号链接安装时，插件目录就是本仓库，Obsidian 写的运行时设置 `data.json` 会落在仓库根目录。

## 调试

- **开发者工具**：`Cmd+Opt+I`。插件日志前缀 `[obsidian-dsh]`，服务日志前缀 `[dsh]`（stdout/stderr 已转发）。
- **状态栏**：`DSH: 运行中 / 启动失败 / 启动超时 / 启动失败(退出码 N) / 端口被占用 / 需手动结束`，点击可打开面板。
  「需手动结束」= 端口上是需要 token 的 dsh（通常是上次遗留的 0.2.1 实例），按 Notice 里的 `pkill` 命令清掉后重启服务。
- **实际使用的 dsh**：控制台搜 `[obsidian-dsh] dsh 版本:`（服务已在运行时为「插件将使用 dsh …」，尚未确认）；设置 → DSH in Obsidian →「dsh 版本」切换安装、「运行环境」看路径/版本/其他安装。0.2.1+ 的启动 URL 与 token 只在内存中使用，日志里 `token=***`。
- **手动对照**：直接跑服务，看它自己的输出：
  ```bash
  cd <vault 路径>
  dsh --profile obsidian --port 3081
  ```
- **改动的生效方式**：
  | 改了什么 | 怎么生效 |
  |---|---|
  | `src/*.ts`、`styles.css` | `npm run build` → Obsidian 里「重新加载插件」 |
  | `manifest.json` | 重启 Obsidian |
  | dsh profile / 外部客户端插件（host 半身） | 插件设置 →「重启服务」 |
  | 外部客户端插件的 client 半身 | HMR 自动生效，无需重启 |

## 代码结构与改动地图

`src/` 按职责域分层，依赖方向单向（分层图与硬约束见 [architecture.md](architecture.md#src-分层)）：

| 文件 | 职责 |
|---|---|
| [src/main.ts](../src/main.ts) | 组合根：注册视图 / 命令 / 状态栏 / 设置页，注入 `DshServiceManager`，把结果映射成 Notice |
| [src/service/manager.ts](../src/service/manager.ts) | `DshServiceManager`：探测 → 拉起 → 等待就绪（0.1.1 用 200 探测 / 0.2.1 用 stdout `dsh web:` 行）→ 重启 / 停止；`embedUrl` 与 `url` 分离 |
| [src/service/locator.ts](../src/service/locator.ts) | `resolveDshInstall()` / `resolveDshCommand()` / `listDshCandidates()` / `probeDshVersion()` / `inspectDshRuntime()` / `buildSpawnEnv()`：可执行文件解析、版本选择 / 探测与 PATH 注入 |
| [src/service/probe.ts](../src/service/probe.ts) | `defaultProbe`：fetch 兜底探测（四态契约在 `shared/types.ts`，可信实现在 `shared/host.ts`） |
| [src/view/dsh-view.ts](../src/view/dsh-view.ts) | `DshWebView`（ItemView）+ `DshPanelHost` 接口 |
| [src/view/surface.ts](../src/view/surface.ts) | 承载面（webview 优先 / iframe 回退）：创建、换源、重载、销毁、`executeJavaScript`（M2-1 / M3 的落点） |
| [src/view/bridge.ts](../src/view/bridge.ts) | 页面桥：调用 `window.__DSH_OBSIDIAN_BRIDGE__`、等待就绪、错误归因、状态探测 |
| [src/view/open.ts](../src/view/open.ts) | `openDshPanel()`：复用或新建右侧 leaf |
| [src/settings/schema.ts](../src/settings/schema.ts) | 设置类型、默认值（含 `dshPath`）、`serviceUrl()`、端口校验 |
| [src/settings/tab.ts](../src/settings/tab.ts) | `DshSettingTab` + `SettingsHost` 接口 |
| [src/shared/](../src/shared) | 视图常量与 `isDshPage()`、四态类型、`sleep`、日志约定（含 token 打码）、vault 路径、`createDshProbe()` |

| 想改 | 看哪里 |
|---|---|
| 启动、探测、等待就绪、重启 | `service/manager.ts` |
| 可执行文件查找、版本探测与 PATH | `service/locator.ts` |
| dsh 版本冲突提示（日志 / Notice / 设置页运行环境） | `service/manager.ts` + `main.ts` + `settings/tab.ts` |
| 切换 dsh 版本 / 0.2.1 token 就绪与承载面地址 | `settings/schema.ts` + `tab.ts` + `service/locator.ts` + `service/manager.ts` + `view/dsh-view.ts` |
| 探测判定 / 注入实现 | `service/probe.ts`（fetch 兜底）+ `shared/host.ts`（requestUrl 可信探测） |
| 承载面加载 / 自愈 / 消息桥（M2-1、M3） | `view/surface.ts` |
| 新建会话 / 单栏 / vault 工作区 | `view/bridge.ts` + `main.ts`（Obsidian 侧）；dsh 侧 `dsh-obsidian-bridge` |
| 面板布局与显示 | `view/dsh-view.ts` + [styles.css](../styles.css) |
| 新增设置项 | `settings/schema.ts`（类型 / 默认值）+ `settings/tab.ts`（控件） |
| 命令 / ribbon / 状态栏 | `main.ts` 的 `onload` |
| 默认端口 3081、默认 profile | `settings/schema.ts` 的 `DEFAULT_SETTINGS`（**并同步**本文件的表格、README、[AGENTS.md](../AGENTS.md)） |

分层规则（新增代码前按 `skills/project-guide` 的决策表落位；冷启动时它也定义了先读哪些文档）：`service/` 不 import `obsidian`；`view/` 不 import `main.ts`；不建 `index.ts` barrel。

`service/` 是纯 Node 逻辑，可以单独打包做冒烟（不必启动 Obsidian）：

```bash
./node_modules/.bin/esbuild src/service/locator.ts --bundle --platform=node --format=esm --outfile=/tmp/locator.mjs
node --input-type=module -e "import('/tmp/locator.mjs').then(async (m) => { const auto = m.resolveDshInstall(null); console.log('auto', auto, m.listDshCandidates()); console.log('selected', m.resolveDshInstall('/Users/…/.local/bin/dsh')); })"
```

## 变更流程：先提案，再改码

功能添加、BUG 修复、或任何会改变运行行为的代码改动，都要过这个闸门（硬规则见 [AGENTS.md](../AGENTS.md) 规则 12）：

1. 复制 [docs/changes/template.md](changes/template.md) → `docs/changes/NNNN-<slug>.md`（编号递增），状态保持 `draft`。
2. 写清：背景与问题、目标与非目标、方案（含备选）、改动清单（文件级）、行为变化、风险与回滚、验证方式、**需要你拍板的问题**。
3. 用户确认后：把 frontmatter 改成 `status: approved` 并填 `approved` 日期 → **才可以动代码**。
4. 实施完：填「实施记录」，状态改 `done`；被否则改 `rejected`，文件保留不删。

例外（不需要提案）：只改文档 / 注释 / 格式；用户当轮已明确指定要改的具体项；单纯 `npm run build`。
提案索引与状态表在 [docs/changes/README.md](changes/README.md)。

## 构建与产物

- 构建链：`npm run build` = 类型检查（`tsc -noEmit -skipLibCheck`）+ esbuild 打包（CJS、es2021、minify）→ 根目录 `main.js`。
- `main.js` 是**构建产物**，不手改；改完源码重新构建，可用 `cmp` 或 diff 确认产物与源码同步（esbuild 输出可复现）。
- `external` 已包含 `obsidian`、`electron`、`@codemirror/*`、`@lezer/*` 与 Node 内置模块，新增依赖前先想清楚是否会打进产物。

## 提交前检查（pre-commit）

- `npm run check`：版本三处一致、无运行时依赖 / `isDesktopOnly`、`tsc -noEmit -skipLibCheck`、`main.js` 与当前源码的生产构建逐字节一致（在内存中构建，不改写文件）。
- `npm run check -- --staged`：额外检查本次提交的暂存集：禁止 `.DS_Store` / `data.json` / `node_modules` / `skills/*/data/cache/`；源码或构建配置有变动时，要求 `main.js` 一起暂存且与构建结果一致。
- 钩子安装：`scripts/install-hooks.sh` 把 `scripts/githooks/pre-commit` 复制到 `.git/hooks/pre-commit`（幂等）；`npm install` 的 `postinstall` 与 `npm run hooks:install` 都会执行。改了模板后重跑 `npm run hooks:install`。
- 临时绕过（不推荐，须在 commit message 注明理由）：`SKIP_COMMIT_CHECK=1 git commit ...`。
- 检查读工作区源码并在内存中构建，**不会**替你 `git add`；`main.js` 不是最新时先 `npm run build` 再重新暂存。

## 版本号与发布

- 三处必须一致：`manifest.json.version`、`package.json.version`、`versions.json` 的键。
- `versions.json` 只在 **minAppVersion 变化**时追加条目：`{ "<插件版本>": "<最低 App 版本>" }`。
- 发布资产（GitHub release）：`main.js` + `manifest.json` + `styles.css`，tag 与 manifest 版本一致。

## 现状与手动回归

当前仓库有 git 版本控制与 `pre-commit` 检查（`npm run check`），但**没有**单元测试、lint、CI。改动靠检查 + 构建 + 手动回归验证，每次改完至少过一遍。

> 若服务根本起不来（状态条「启动失败」），先按 [troubleshooting.md](troubleshooting.md) 排查 profile / 可执行文件，再回来做回归。

1. 重新加载插件 → 状态栏显示 `DSH: 运行中`（或自动拉起中后转为运行中）。
2. 点 ribbon / 命令打开面板 → 右侧面板出现，承载面加载 GUI；控制台出现 `[obsidian-dsh] 面板承载方式: webview（persist:vault-…）`。
3. 先停掉服务再打开面板：banner 显示「正在启动」，服务起来后 GUI **自动出现**（无需关掉面板重开）。
4. 命令「重启 DSH 服务」→ 有成功 Notice，端口上仍只有一个 dsh。
5. 设置里改端口 → 重启服务 → banner 与承载面的 URL 同步变化。
6. 用别的程序占端口（如 `python3 -m http.server 3082`）→ 状态条显示「端口被占用」、不显示「运行中」；换端口后恢复。
7. 禁用插件 → 自启进程退出（`lsof -nP -iTCP:<port> -sTCP:LISTEN` 无输出）。
8. 重新加载插件 → 控制台出现 `[obsidian-dsh] dsh 版本: <版本>（<路径>）`；机器上有两份不同版本 dsh 时出现
   `发现其他版本的 dsh` 警告、弹一次 Notice，设置页「运行环境」显示当前版本与其他安装；重启服务后不再重复弹 Notice。
   若服务已在运行（非本次拉起）：日志为「服务已在运行（非本次拉起）；插件将使用 dsh …」、设置页注明未确认；
   点「重启服务」后变为「当前使用」。
9. 设置页「dsh 版本」：下拉列出检测到的安装（含版本号），「重新检测」能刷新；选 0.1.1 / 0.2.1 后点「重启服务」，
   面板分别正常加载，设置页「当前 dsh」显示对应版本；显式选择后不再弹冲突 Notice。
10. 0.2.1：控制台出现 `dsh 就绪信号: http://…?token=***` 与 `面板承载方式: webview（persist:vault-…）`；面板正常加载 GUI；日志里没有明文 token。
    重启服务后 token 变化，旧面板若空白 → 重开面板。
11. 端口上留一个 0.2.1 实例再重载插件 → 状态条「需手动结束」+ Notice 给 `pkill -f "dsh --profile obsidian"` 提示；清掉后重启服务恢复。
12. 删除 0.1.1（`mv ~/.local/lib/node_modules/@deepseek-ai/dsh ~/.local/lib/node_modules/@deepseek-ai/dsh.bak`）→
    自动模式解析到 PATH `dsh`（0.2.1）→ 重启服务后面板正常。
13. 回退路径：若控制台出现 `当前环境不支持 webview，面板回退到 iframe`，0.2.1 面板应弹一次兼容提示
    （不会静默空白）；升级 Obsidian 或改用 0.1.1 后恢复。
14. 装 `dsh-obsidian-bridge` → 重启 DSH 服务 → 重载插件：面板左右栏收起（**没有 56px 轨道**）；
    手动展开左栏或打开右栏，≤1s 被收回。
15. 功能区 / 命令「新建 DSH 会话」→ 面板出现新会话且输入框可用；会话归属 vault 工作区。
16. 停用桥（profile 移除或换回未装桥的实例）→ 新建命令提示「未检测到 dsh-obsidian-bridge」，
    面板与既有命令不回归；设置页「桥接状态」同步显示。
