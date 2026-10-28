# DSH Native Chat

Chat with a local [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (dsh) agent inside Obsidian: the plugin runs a managed dsh service whose working directory is your vault, and renders the conversation in a native React panel in the right sidebar.

> Plugin id `dsh-native-chat` · version 1.1.0 · requires Obsidian ≥ 1.7.2 · **desktop only**

## Features

- **Native chat panel** — a real Obsidian view (not an embedded web GUI): streaming replies and thinking, stop button, session switcher, model and permission menus.
- **Context usage ring** — see how much of the model context the current session uses, with a breakdown on click.
- **`@` references** — insert notes and folders into the conversation; `@path` becomes a clickable note link in the reply.
- **`/` menu** — the dsh command catalog plus your skills, with optional allow/deny lists per scope.
- **Agent Teams & subagents** — read-only team roster and task board; open a subagent's child session, continue it or stop it.
- **Run status and goal bar** — dsh-style "thinking, Ns" indicator and a goal bar (pause / resume / edit / clear) above the composer.
- **Settings tabs** — service, dsh version, chat, integration and plugins, each managed separately.

## Requirements

| Item | Requirement |
|---|---|
| Obsidian | ≥ 1.7.2, **desktop only** (uses Node / `child_process`) |
| dsh | **0.2.x** (0.1.x is rejected as unsupported) |
| Platform | macOS (the verified platform) |

The plugin uses its own profile `obsidian` and default port **3081** (so it never clashes with the web UI on 3080). Model providers and credentials are configured in that profile, not in the plugin.

## Data, network and permissions

This plugin works with local resources only. The following disclosures are required by the Obsidian developer policies:

- **Network** — it talks to the dsh service it starts on `http://127.0.0.1:3081` (localhost). Nothing is sent to the plugin author; model requests are issued by dsh itself with the provider configured in your profile.
- **Files outside the vault** — it reads the dsh profile directory (default `~/.dsh/profiles/obsidian`), skill directories (`~/.dsh/skills`, `~/.agents/skills`, and the vault's `.dsh/skills`), and the dsh executable. The "Plugins" settings tab edits that profile's `package.json` / `cordis.patch.yml` when you enable or disable dsh plugins.
- **Child processes** — it spawns `dsh` and runs `dsh --dump-config` / version probes. It only ever stops dsh instances it started itself.
- **External dependency** — dsh must already be installed on the machine. The plugin does not download, install or update dsh.
- **No telemetry, no ads, no self-update.** The dsh agent may access your vault and the network depending on the permissions you grant it in dsh.

## Installation

Two routes, pick one:

- **A — release build**: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/dsh-native-chat`.
- **B — build from source**: `npm ci && npm run build && npm run check`.

The dsh-side bridge plugin `dsh-obsidian-bridge` is required for the panel (install it from the same release). Full steps, acceptance checks and troubleshooting: **[docs/install.md](docs/install.md)**. Then enable **DSH Native Chat** in *Settings → Community plugins*.

## Usage

- **First open** — the plugin probes `127.0.0.1:3081` and, when nothing is listening, starts `dsh --profile obsidian --port 3081` with cwd = the current vault. Auto-start is on by default.
- **Entry points** — the DSH whale ribbon icon, the "Open DeepSeek Harness" command, or the status bar item.
- **Sessions** — new sessions use the vault as their working directory; the title follows the dsh-generated title.
- **Settings changes** — after changing the port, profile or dsh binary, click "Restart DSH service".
- **Disabling** — disabling the plugin stops the dsh process it started; instances you started manually are left alone.

## Documentation

- [docs/install.md](docs/install.md) — installation, acceptance checks and failure matrix.
- [docs/troubleshooting.md](docs/troubleshooting.md) — startup, blank panel, port conflicts, PATH, model errors.
- [docs/development.md](docs/development.md) — environment, build, debug and code map.
- [docs/README.md](docs/README.md) — index of every project document.

## License

[MIT](LICENSE) © 2026 fabler

---

# 中文说明

在 Obsidian 右侧面板里，用**原生 React UI** 与 DeepSeek Harness（dsh）聊天；插件自动托管一个独立的 dsh 服务，工作目录就是当前笔记库。

> 插件 id `dsh-native-chat` · 版本 1.1.0 · 需要 Obsidian ≥ 1.7.2 · 桌面端专用

## 为什么用它

- **原生聊天界面**：右侧面板是 Obsidian 原生 React UI，不是嵌入官方 Web GUI；主题、快捷键、文件列表都跟 Obsidian 一体。
- **流式正文与思考**：回复正文与思考过程边生成边更新，随时可以停止。
- **上下文占用圆环**：输入栏显示当前会话的上下文占用，点开可看百分比、token 与构成。
- **「@」引用笔记与文件夹**：输入 `@` 选笔记或文件夹，内容随消息带进对话；文件夹引用可直接定位到左侧文件列表。
- **「/」命令与技能**：行首输入 `/` 打开命令菜单（dsh 命令目录 + 技能），可搜索、可执行，并可用白 / 黑名单裁剪显示范围。
- **引用可点击**：消息里的 `@路径` 会渲染成笔记短链接，点击在 Obsidian 主区打开对应笔记。
- **模型与权限**：面板底部可切换模型、思考强度与权限档位；选「完全访问」这类危险档位会二次确认。
- **插件管理**：设置页「插件」tab 列出 dsh profile 的插件，可逐行启用 / 停用，并可选启用官方实验性插件（如智能体团队、语音输入）。
- **智能体团队（Agent Teams）只读面板**：启用官方实验性插件后，会话标题右侧出现团队图标，可查看成员状态与共享任务板。
- **子智能体（subagent）目录与子会话**：会话有子智能体时标题右侧出现 bot 图标，可看模式、运行状态、耗时、token 与模型；点行打开子会话看正文、续聊与 Stop。
- **运行提示与目标条**：输入框上方显示 dsh 同款「深度求索中，用时 N秒」与 goal 目标条（暂停 / 恢复 / 编辑 / 清除）。
- **5 个设置 tab**：服务 / dsh 版本 / 聊天 / 集成 / 插件，按模块分别管理。

## 环境要求

| 项 | 要求 |
|---|---|
| Obsidian | ≥ 1.7.2，**桌面端**（插件依赖 Node / `child_process`，移动端不可用） |
| dsh | **0.2.x**（0.1.x 不支持；已装桌面端 DeepSeek Harness 时可直接用 App 内置的那份） |
| 平台 | macOS（当前验证平台） |

插件使用独立的 profile `obsidian` 与默认端口 **3081**（避开 web profile 的 3080），与日常使用的 dsh 互不干扰；模型与凭据在 profile 里配置。

## 安装

有两种装法，按自己的情况选一条：

- **A｜只装插件产物**：适合只想使用插件的人，不需要这份源码。
- **B｜源码构建**：适合要改代码或跟随最新提交的人。

两条路线的完整步骤、验收清单与失败处理见 **[docs/install.md](docs/install.md)**。装好后在 Obsidian「设置 → 第三方插件」中启用 **DSH Native Chat**。

> 机器上已装桌面端 DeepSeek Harness 的话，不必再单独安装 dsh：插件会自动检测 App 内置的 dsh，在设置页「dsh 版本」选中它并「重启服务」即可（见 [install.md 第 3 节情况 D](docs/install.md#3-安装-dsh-02x)；Windows 路径已适配、尚未实测）。

## 使用

- **首次打开**：插件探测 `127.0.0.1:3081`；未在监听时自动拉起 `dsh --profile obsidian --port 3081`（cwd = 当前 vault），就绪后面板自动连接。自动启动默认开启。
- **入口**：左侧功能区的 DSH 鲸鱼图标，或命令面板「打开 DeepSeek Harness」；状态栏 `DSH: 运行中` 也可点击打开。
- **新建会话**：面板右上 ＋、空态按钮或会话选择器；会话 cwd 固定为当前笔记库。
- **发消息**：发送后用户消息立即出现，回复正文与思考流式更新；回合进行中可以随时停止。
- **选区引用**：在主编辑区选中文字，右栏会立即显示引用预览；发送时自动把「当前笔记路径 + 选中原文」作为引用带上。点预览条或气泡里的引用卡都会回到原笔记的选中位置并高亮（摘录上限可在设置「聊天」里改，默认 2000 字）。
- **切换会话**：右上会话选择器切换历史会话；会话标题由 dsh 随对话自动生成。
- **改完设置**：修改端口、profile 或 dsh 版本后，点设置页「服务」里的「重启服务」（或命令「重启 DSH 服务」）才会生效。
- **结束 / 重启**：设置页「服务」可「结束后台 dsh」——结束插件拉起的 dsh 与占用当前端口的遗留 dsh（不动其它端口上的实例），结束后再点「重启服务」；两个按钮下方都就地显示进度与结果，不再叠多条 Notice。
- **禁用 / 卸载**：禁用插件会结束插件自己拉起的 dsh 进程；你手动启动的实例不会被动到。
- **升级插件**：替换插件文件后，在 Obsidian 里关闭再启用插件（或「重新加载插件」）即可；从 0.6.x 升级到 1.0.0 时插件目录名变为 `dsh-native-chat`，见 [docs/install.md](docs/install.md#从-06x-升级到-100插件-id-变更)。

### 状态栏常见状态

| 状态栏 | 含义 | 怎么办 |
|---|---|---|
| `DSH: …` | 正在探测 / 拉起服务 | 等几秒 |
| `DSH: 运行中` | 服务已就绪 | 正常，可打开面板 |
| `DSH: 启动失败` | 找不到 dsh 可执行文件 | 按安装指南装好 dsh |
| `DSH: 端口被占用` | 端口上跑着别的程序 | 换端口或结束占用进程 |
| `DSH: 需手动结束` | 端口上是拿不到 token 的遗留实例 | 设置页「服务」→「结束后台 dsh」后重启服务 |
| `DSH: 版本不支持` | 端口上的 dsh 不是 0.2.x | 结束它并选用 0.2.x |
| `DSH: 已结束` | 刚点过「结束后台 dsh」 | 点「重启服务」重新拉起 |

## 设置项一览

| tab | 管什么 |
|---|---|
| 服务 | 端口、profile 名、自动启动、结束后台 dsh、重启服务（就地进度 / 结果） |
| dsh 版本 | 使用哪份 dsh 安装（自动检测或手动指定）与运行环境 |
| 聊天 | 流式刷新节奏、`@` 引用范围、`/` 技能与命令范围、选区引用摘录上限 |
| 集成 | 项目目录与桥接状态检测（桥 v8） |
| 插件 | dsh 插件清单与启用 / 停用、可选实验性插件 |

## 已知限制

- 原生聊天面板仍是 **Phase 1**：暂不支持附件上传、queue/steer、plan-review 与文件预览；这些能力暂时请用桌面 DSH。
- 子智能体只支持一层直接子级（子代理的子代理留给后续）；目录只读，可继续子会话能续聊与 Stop，但面板不能创建 / 重命名子代理。
- 模型与 API Key 不在插件里配置，需要在 `obsidian` profile 中配置（与桌面端对齐），改完点「重启服务」。
- 只支持 dsh **0.2.x**；0.1.x 会被判为「版本不支持」。
- 0.2.x 的 Web token 每个进程新生成，插件只接管自己拉起的实例：上次遗留的实例会显示「需手动结束」，点设置页「服务」里的「结束后台 dsh」结束它再重启服务（只针对当前端口，不动其它实例）。
- 原生面板依赖 Obsidian 内置的 webview 能力：版本过旧时面板会提示「不支持 webview」，升级 Obsidian 即可（开发与实测版本 1.14.4）。
- 用桌面 App 内置的 dsh 时：App 的安装文件在 `app.asar` 里，普通 Node 读不到，设置页「插件」tab 的可选插件目录可能解析不到（聊天 / 服务不受影响）；App 内置版本与 profile 版本差太大时启动失败，切回另一份安装即可。

## 文档

- [docs/install.md](docs/install.md)：安装指南 —— 两种装法、验收清单、失败矩阵。
- [docs/troubleshooting.md](docs/troubleshooting.md)：排障 —— 起不来、面板空白、端口冲突、PATH、模型报错。
- [docs/development.md](docs/development.md)：开发 —— 环境、构建、调试与代码改动地图。
- [docs/README.md](docs/README.md)：全部项目文档的索引。
- [AGENTS.md](AGENTS.md)：面向 AI agent 的仓库结构与协作约定。

## 许可

[MIT](LICENSE) © 2026 fabler
