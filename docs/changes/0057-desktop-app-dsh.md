---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28       # 用户当轮明确指定要改的具体项（AGENTS 规则 12 例外）
scope: src/shared / src/service / docs
issue: 把桌面 App 内置的 dsh 加进可执行文件探测（macOS + Windows），由插件拉起自己的服务
---

# 0057 支持使用桌面 App 内置的 dsh（macOS + Windows 路径探测）

> 对应路线图 [R-40](../roadmap.md#需求待办)。用户原话：「我想的就是把桌面app当可执行文件，然后拉一个插件自用的dsh，我的想法就是在设置的检索里面加上app地址，记得适配win版本的app软件」。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外（用户当轮已明确指定要改的具体项，视为已批准、可直接做），本提案用于补齐记录与路径对比。

## 1. 背景与问题

桌面端 DeepSeek Harness App 自带一份 dsh 运行时（`app.asar` + 随包的 Electron），并提供一个命令行入口：

- macOS：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`（shell 脚本，`exec` App 的 Electron 二进制）；
- Windows：`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`（桌面端测试快照里的固定路径）。

插件的 [locator](../../../src/service/locator.ts) 目前只认三类来源：全局 npm 的 `bin.js`、PATH 上的 `dsh`、`~/.local/bin` 等固定绝对路径。
因此机器上**只装了桌面 App、没单独装 dsh** 时，插件会报「无法定位 dsh 可执行文件」，只能另跑 npm 安装。

实测（macOS 15 / 桌面 App 0.2.1-rc.3）：

```text
$ ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
    --expose-internals "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" --version
0.2.1-rc.3

# 用临时 DSH_HOME 复制 obsidian profile 后启动（不动真实 profile）
dsh web: http://127.0.0.1:3099/?token=***
```

即：桌面 App 自带的 0.2.x 能拉起插件的 `obsidian` profile，并输出插件唯一认的就绪信号 `dsh web: <url>`。

## 2. 目标与非目标

### 目标

- `listDshCandidates()` 增加「桌面 App 内置 dsh」候选，按平台探测标准安装位置：
  - macOS：`/Applications/DeepSeek Harness.app`、`~/Applications/DeepSeek Harness.app`；
  - Windows：`%LOCALAPPDATA%\Programs\DeepSeek Harness`、`%ProgramFiles%\DeepSeek Harness`、`%ProgramFiles(x86)%\DeepSeek Harness`；
- 启动方式直接跑 App 的 Electron 二进制（`ELECTRON_RUN_AS_NODE=1` + `--expose-internals` + `app.asar/.../dsh-desktop-host/lib/cli.js`），
  **不经过** macOS 的 shell 启动器 / Windows 的 `.cmd`（原因见路径对比）；
- 设置页「dsh 版本」下拉自动列出这一项（展示路径 = App 根目录，版本 = `--version` 探测值，可选中 → `data.json` 的 `dshPath`）；
- 版本探测、插件清单 `--dump-config` 与插件 tab 的启停都走同一个 `DshCommand`（含额外 env），保证选中后各处行为一致；
- Windows 路径按桌面端仓库的打包/测试快照适配（见上）。

### 非目标

- 不接管桌面 App **正在运行**的那个 dsh 实例：0.2.x 的 token 是进程内生成的，插件仍只拉起并管理自己的子进程；
- 不做 Windows 专项回归：本次只能在 macOS 实测；Windows 路径与启动方式按上游快照实现，并在文档标注「未实测」；
- 不修 `app.asar` 不可读导致的「插件」tab 限制（普通 Node 读不了 asar，可选插件目录可能解析不到）；
- 不改端口 / profile / 默认值，不动桥协议，不改桌面 App 本身。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（选定）Electron-as-node 直跑** | locator 探测 App 根目录 → `{ cmd: <Electron 可执行文件>, prefix: ['--expose-internals', 'app.asar/.../dsh-desktop-host/lib/cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }`；`DshCommand` 增加可选 `env`；manager spawn / 版本探测 / `--dump-config` 都合并这份 env | `shared/types.ts` + `service/locator.ts` + `service/manager.ts` + `service/plugin-inventory.ts` + docs | 子进程就是 Electron 进程本身，`SIGTERM/SIGKILL` 能直接结束、端口能释放；macOS 已端到端实测。风险：依赖 App 内部路径（`app.asar/dsh/.../cli.js`）与随包 Electron 文件名，App 大版本改布局时需跟随 | **采用** |
| B 交给用户手动装 CLI | 文档教用户执行桌面 App 的命令行安装（macOS 写 `/usr/local/bin/dsh`，Windows 写用户 PATH），插件不改 | 只改文档 | 零代码风险；但需要管理员 / 手动操作，且全局 npm 安装优先级更高时会继续盖住 App 版本；「开箱即用」目标不成立 | 不采用（保留为兜底文档） |
| C 直接 spawn App 自带启动脚本 | macOS 跑 `runtime/cli/bin/dsh`、Windows 跑 `dsh.cmd` | locator 最小 | POSIX 脚本会 `exec` 成 Electron，没问题；但 Windows 的 `.cmd` 必须经 `cmd.exe /c` 才能 spawn，插件 `child.kill()` 只会结束 cmd.exe，Electron 子进程残留 → 停不掉、端口不释放，除非再加一套进程树清理 | 不采用（Windows 生命周期不可靠） |

> 用户 2026-10-28 原话已指定「把桌面 App 当可执行文件 / 在检索里加 App 地址 / 适配 Windows」，属于规则 12 的例外，不再等二次选路；上表用于记录为什么不选 B / C。

### 路径内的次决策

- **候选顺序**：追加在现有三类之后（不改变已有安装的默认解析结果）；想用 App 版本时在「dsh 版本」里显式选中。
- **展示路径**：用 App 根目录（`/Applications/DeepSeek Harness.app` / `C:\\Users\\…\\DeepSeek Harness`），比 asar 内部路径短、且 App 更新后不变。
- **探测条件**：Electron 可执行文件 + `resources/app.asar` 都存在才算命中；入口 `cli.js` 在 asar 内，普通 `existsSync` 不可读，不单独校验。
- **Windows 路径**：来自桌面端仓库 `apps/desktop/tests/expected/command-management-win32-*.json` 的固定路径
  `C:\\Users\\<user>\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd`；
  本次实现只取根目录 + `resources/app.asar`，不依赖 `.cmd`。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | `DshCommand` 增加可选 `env`（额外注入的子进程环境变量） |
| `src/service/locator.ts` | 新增 `listDesktopAppInstalls()`（按平台探测 App 根目录）；`listDshCandidates()` 追加 App 候选；`buildSpawnEnv(extra?)` 合并额外 env；`probeDshVersion()` 使用 `command.env` |
| `src/service/manager.ts` | spawn 时 `buildSpawnEnv(resolved.env)` |
| `src/service/plugin-inventory.ts` | `--dump-config` 时 `buildSpawnEnv(options.command.env)` |
| `docs/install.md` / `docs/troubleshooting.md` / `docs/development.md` / `AGENTS.md` / README | 新增「情况 D」、解析顺序、限制与排查项 |
| `docs/roadmap.md` / `docs/changes/README.md` | R-40 登记与索引 |

## 5. 行为变化

- 机器上装了桌面 App 时，设置页「dsh 版本」会多出一项（版本为 App 内置 dsh 的 0.2.x）；不选它时默认解析顺序与现在一致。
- 选中后：服务、版本探测、插件清单都使用 App 的 Electron-as-node 进程；状态栏 / 日志里的路径是 App 根目录。
- 桌面 App 与插件共用 `$DSH_HOME`（默认 `~/.dsh`），但分别跑 `desktop` / `obsidian` profile，互不接管。
- 已知限制：`app.asar` 内的文件普通 Node 读不到，「插件」tab 的可选插件目录可能解析不到；`obsidian` profile 是 0.2.2-alpha.2 建的、
  App 内置是 0.2.1-rc.3 时，仍以「0.2.x」兼容，但若 profile 组合失败需在「dsh 版本」切回另一份（文档写明）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| App 升级后内部入口路径变化 | 版本探测为「未知」、启动失败（进程提前退出） | 「dsh 版本」切回自动 / 其它安装；后续跟随 App 布局修 locator |
| 用旧版 App 的 dsh 跑新版 profile | dsh 启动报 profile / bundle 错误 | 在「dsh 版本」切回 npm 安装；重启服务 |
| Windows 未实测 | 可能 spawn 失败或版本探测超时 | 文档标注；用户可切回全局安装。失败时只多一个「未知版本」候选，不影响默认解析 |
| 每次探测多起一个 Electron 进程 | 设置页 / 启动时多几百 ms | 版本探测沿用 3s 超时、失败即跳过；候选顺序在最后，不影响现有默认 |

## 7. 验证

自动化：

```bash
npm run build && npm run check && npm run lint
# 用 esbuild 单独打包 locator 做冒烟（docs/development.md 的既有做法）
node --input-type=module -e "import('/tmp/locator.mjs').then(m => { ... })"
```

冒烟断言（macOS 实测）：

- `listDesktopAppInstalls()` 返回 `/Applications/DeepSeek Harness.app`；
- `listDshCandidates()` 最后一项展示路径为 App 根目录，`probeDshVersion` 得到 `0.2.1-rc.3`；
- 用该 `DshCommand` 在临时 `DSH_HOME` 下启动 `obsidian` profile → stdout 出现 `dsh web: http://127.0.0.1:<port>/?token=…`；
- 发 SIGTERM → 进程退出、端口释放（验证「不经过 .cmd」的收益）；
- 构造 `platform='win32'` + 假 `LOCALAPPDATA` 调 `listDesktopAppInstalls`，断言返回 `…\\DeepSeek Harness` 根目录、`resources` / `DeepSeek Harness.exe` 路径拼接正确（纯路径断言，不启动）。

手动：设置 → DSH Native Chat → dsh 版本 → 选中 App 条目 → 服务 → 重启服务 → 原生面板正常收发。

## 8. 需要你拍板

- [x] 选哪条实现路径：用户当轮已指定「App 当可执行文件 + 检索里加 App 地址 + 适配 Windows」→ 采用 A
- [x] 候选顺序：追加在现有安装之后，选中才生效（不改变别人的默认行为）

## 9. 实施记录

### 实际改动

- `src/shared/types.ts`：`DshCommand` 新增可选 `env`（`Record<string, string>`），只作用于该次 spawn / 探测。
- `src/service/locator.ts`：
  - 新增 `desktopAppRoots(platform, env, home)`（纯函数，便于 Windows 路径断言）与 `listDesktopAppInstalls()`；
  - `DESKTOP_CLI_ENTRY` + `desktopAppCommand()`：`{ cmd: <App 的 Electron>, prefix: ['--expose-internals', 'app.asar/.../dsh-desktop-host/lib/cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }`；
  - `listDshCandidates()` 在绝对路径候选之后追加 App 候选（展示路径 = App 根目录）；
  - `probeDshVersion()` 用 `buildSpawnEnv(command.env)`；`buildSpawnEnv(extra?)` 合并额外 env。
- `src/service/manager.ts`：spawn 改为 `buildSpawnEnv(resolved.env)`。
- `src/service/plugin-inventory.ts`：`--dump-config` 改为 `buildSpawnEnv(options.command.env)`（插件 tab 与主服务用同一份 env）。
- 文档：`docs/install.md`（情况 D + 解析顺序 ④ + 排障表）、`docs/troubleshooting.md`（「用桌面 App 内置的 dsh」）、`docs/development.md`（改动地图 + 回归 77）、`AGENTS.md`（外部依赖）、`README.md`（环境要求 / 安装提示 / 已知限制）、`docs/roadmap.md`、`docs/changes/README.md`。

### 验证结果（2026-10-28，macOS 15 / 桌面 App 0.2.1-rc.3）

- `npm run build` 通过；`npm run check` 全部通过；`npm run lint` 0 error（31 warning，均为既有项）。
- esbuild 单打包 locator 冒烟：
  - `listDesktopAppInstalls()` → `/Applications/DeepSeek Harness.app`（resources / executable 路径正确）；
  - `listDshCandidates()` 3 项，最后一项 path = `/Applications/DeepSeek Harness.app`，command 带 `--expose-internals` + asar CLI 入口 + `ELECTRON_RUN_AS_NODE=1`；
  - `probeDshVersion()` → `0.2.1-rc.3`，实测 255ms（< 3s 超时）；
  - `desktopAppRoots('win32', 假 LOCALAPPDATA / ProgramFiles / ProgramFiles(x86))` → 3 个 `…\Programs\DeepSeek Harness` / `…\Program Files\DeepSeek Harness` 根目录；
  - 用工作区假目录（`<tmp>/Local/Programs/DeepSeek Harness/{DeepSeek Harness.exe,resources/app.asar}`）验证 Windows 布局探测命中，resources / exe 拼接正确。
- 端到端（临时 `DSH_HOME` + 复制 `obsidian` profile，不动真实配置）：
  - `--profile obsidian --dump-config` 退出码 0、stdout 46993 字节、stderr 空（env 透传生效）；
  - 启动 `--profile obsidian --port 3099 --no-open` → 918ms 出现就绪行 `dsh web: http://127.0.0.1:3099/?token=***`；
  - 发 SIGTERM → 46ms 内退出（exit code 0），端口释放、无监听（验证直跑 Electron 的好处）；临时目录已清理。

### 与提案的偏差

- 为便于平台无关测试，把根目录构造拆成纯函数 `desktopAppRoots()`（提案只写了 `listDesktopAppInstalls()`）；行为不变。
- Windows 只做了路径与布局的逻辑断言，未在 Windows 实机启动（提案已标注非目标）；macOS 未真正在 Obsidian 里切换选中后回归（需要用户手动确认一次）。
