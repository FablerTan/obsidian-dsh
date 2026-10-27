# obsidian-dsh — 在 Obsidian 里使用 DSH（方案 B）

在 Obsidian 右侧面板使用**原生 React UI** 与 DeepSeek Harness 聊天，并**由插件自动拉起一个独立的 dsh 服务**。官方 Web GUI 面板已移除（0008）：原生面板内部保留一个离屏的官方 core 页面作为数据源。

- 独立 profile：`obsidian`（`$DSH_HOME/profiles/obsidian/`，base + web-app，与日常 `web` profile 互不干扰）
- 独立端口：默认 **3081**（避开 web profile 的 3080，两个 GUI 可同时运行）
- 工作目录 = 当前 vault：dsh 的 workspace / 会话分组 / AGENTS.md / 技能发现都落在笔记库上
- 进程生命周期由插件托管：端口未监听 → 自动 spawn；插件卸载 → 杀掉自启进程（你自己手动启动的实例不会被杀）

## 目录结构

```
obsidian-dsh/
├─ manifest.json          # 插件清单（id/name/version/minAppVersion/isDesktopOnly）
├─ versions.json          # 版本 → 最低 App 版本映射（发布用）
├─ package.json           # 依赖与脚本（npm run dev / build）
├─ tsconfig.json          # TS 配置
├─ esbuild.config.mjs     # 构建配置（产物 main.js，勿手改产物）
├─ styles.css             # 面板样式（跟随 Obsidian 主题变量）
├─ data.json              # 插件运行时设置（端口 / profile / 自动启动）
├─ README.md              # 本文件：快速开始
├─ AGENTS.md              # 给 AI agent 的项目结构约定
├─ src/
│  ├─ main.ts             # 组合根：注册与装配（不含业务逻辑）
│  ├─ service/            # dsh 进程域：manager / locator（纯 Node）
│  ├─ view/               # 面板域：native / surface / panel-host / open
│  ├─ settings/           # 配置域：schema / tab
│  └─ shared/             # 跨域基础件：constants / async / log / host
├─ docs/                  # 项目文档（路线图 / 架构 / 开发 / 排查 / 技能）
├─ skills/                # 给 agent 的技能（obsidian-docs：官方文档检索）
├─ packages/
│  └─ dsh-obsidian-bridge/ # dsh 侧客户端插件（原生数据桥 v6：快照 + 流式 + 上下文占用 + “/” 命令/技能目录 + 团队投影）
└─ .dsh/skills/           # → ../../skills/ 的符号链接（DSH 技能发现入口）
```

## 开发环境

要求：Node.js ≥ 20、npm。官方文档建议单独建一个测试 vault，不要在主力 vault 里开发。
更细的调试、改动地图与回归清单见 [docs/development.md](docs/development.md)。

```bash
cd obsidian-dsh
npm install          # 安装 esbuild / typescript / obsidian 类型
npm run build        # 类型检查 + 构建 → 生成 main.js
npm run dev          # 监听模式：改代码自动重编译（Obsidian 里"重新加载插件"生效）
```

## 安装到 Obsidian

```bash
# 符号链接（开发期推荐，改代码即时生效）：
ln -s ~/path/to/obsidian-dsh ~/path/to/vault/.obsidian/plugins/obsidian-dsh
```

Obsidian：设置 → 第三方插件 → 启用 **DSH in Obsidian** → 点左侧栏的 DSH 鲸鱼图标打开右侧聊天面板。
完整安装链路（dsh 0.2.x / obsidian profile / 模型接入 / 桥 / 验收 / 失败矩阵）见 [docs/install.md](docs/install.md)，可直接交给 agent 照着执行。

## 使用

- **首次打开**：插件探测 `127.0.0.1:3081`，未监听则自动执行
  `dsh --profile obsidian --port 3081`（cwd = vault），等端口就绪后原生面板连接隐藏 core。
- **设置页**（插件设置，顶部 5 个 tab：服务 / dsh 版本 / 聊天 / 集成 / 插件）：端口、profile 名、**dsh 版本**、自动启动开关、**流式刷新节奏**（逐字 / 每帧 / 平衡 / 省电）、**「@」引用范围**（不启用 / 白名单 / 黑名单，选中后展开添加栏）、"重启服务"按钮（改完端口/Profile/版本后点它）；
  「dsh 版本」可选自动或检测到的某个安装（显示版本+路径），「重新检测」刷新列表；
  「运行环境」显示实际使用的 dsh 路径/版本，以及机器上其他版本的安装。
- **「插件」tab**：列出 dsh profile 的插件清单（按 bundle 分组：dsh-base / dsh-web-app / 第三方 bundle），
  每个组件行显示名称、id、运行 / 停用 / 条件状态与版本；可逐行**启用 / 停用**（写 profile 用户层
  `cordis.patch.yml`，写前自动备份 `.bak-时间戳`，点「重启服务」后生效）；`!!js` 条件行由 dsh 按运行环境决定，不提供开关；
  支持筛选与「重新读取」。
- **「插件」tab 顶部「可选 / 实验性插件」**：列出 dsh 随安装提供、默认未启用的插件（官方 `OPTIONAL_BUNDLES`：
  语音输入 / 智能体团队 / 会话搜索 / 自动授权审查 …，带中文说明与「实验性」标记）；开关 = 写 profile 的
  `package.json` → `dsh.profile.bundles`（同样先备份 `.bak-时间戳`），点「重启服务」后生效；
  需要先安装的插件（claude-code / codex 子智能体）只提示 `dsh plugin --profile obsidian add <包名>`。
- **智能体团队（Agent Teams）**：在「插件」tab 启用官方实验性插件「智能体团队」并重启服务后，会话标题右侧出现团队图标；
  点开是只读面板：成员列表（运行中 / 空闲 / 创建中 / 失败、模型、等待授权标记）与共享任务板（状态、负责人、依赖、就绪、写入范围与警告），
  随团队变化实时更新；团队工具在过程行里显示中文标题与参数摘要，队友发来的消息显示成「队友 xxx」卡片。
  只读面板不提供创建 / 中断 / 删除，也不能从面板打开队友会话（需要队友授权时请到 dsh 桌面端 / Web 处理）。
- **状态栏**：`DSH: 运行中 / 启动失败 / …`，点击直接打开原生聊天。
- **入口**：功能区一个 DSH 鲸鱼按钮 + 命令面板 `打开 DeepSeek Harness`（都打开右栏原生聊天）；
  命令面板另有 `重启 DSH 服务`。
- **新建会话**：在面板内右上 ＋ / 空态按钮 / 会话选择器新建；cwd 固定为**当前库目录**，不需要先进面板点左栏。
- **没有官方面板入口**：模型/凭据仍通过 `$DSH_HOME/profiles/obsidian/cordis.patch.yml` 配置，改完点设置页「重启」。原生面板里的「配置说明」按钮会提示这一点。

## dsh 侧依赖

> **2026-10-26 现状**：obsidian profile 当前装的是 `dsh-base` + `dsh-web-app` + **`dsh-obsidian-bridge`**；
> `dsh-obsidian-mentions` / `dsh-ui-obsidian-layout` 已不在 profile（见外部仓库 `PROFILES.md`），
> 下面两段保留作历史参考。

- `dsh-obsidian-bridge`（v0.4.0，纯客户端，本仓库 `packages/dsh-obsidian-bridge/`）：**原生聊天数据桥 v6**（v2 能力 + `liveStream` 流式 live + `context` 上下文占用 + `commands` / `skills` / `executeCommand` 输入框 “/” 菜单 + `team` Agent Teams 团队投影）；v1 的单栏 / 工作区 / 新建会话已随 0011 删除。
  安装：`dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge`，
  装完在设置页点「重启」。页面里暴露 `window.__DSH_OBSIDIAN_BRIDGE__`，Obsidian 通过隐藏 core 的 `<webview>.executeJavaScript()` 调用。
  详见 [packages/dsh-obsidian-bridge/README.md](packages/dsh-obsidian-bridge/README.md)。
- `$DSH_HOME/profiles/obsidian/` 已创建：bundles 基础为 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`
  （`dsh plugin add` 会把 `dsh-obsidian-bridge` 自动并入 `dsh.profile.bundles`；内置包从 dsh 安装目录解析，无需 npm 安装）。
- 可执行文件解析顺序：node 直接跑 `~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（存在时优先）
  → PATH `dsh` → `~/.local/bin/dsh` → `/opt/homebrew/bin/dsh` → `/usr/local/bin/dsh`。
  设置页「dsh 版本」可以直接选检测到的任一份（要求 0.2.x），不用改安装顺序；启动日志会打印实际路径与版本。
- dsh 0.2.x 的 Web UI 需要浏览器会话 token：插件从启动输出里读取带 token 的 URL，交给原生视图里的隐藏 core
  （token 只在首次登录用，随后走插件专用分区 `persist:dsh-obsidian` 的 cookie；日志里 `token=***`）。只支持 0.2.x；0.1.x 与 iframe 回退已移除（提案 0007）。
- 想给 obsidian profile 加功能插件：手动在 `~/.dsh/profiles/obsidian/cordis.patch.yml` 挂行，
  或 `dsh plugin --profile obsidian add <pkg>`（仅限 npm 上完整发布的包）。
- `dsh-obsidian-mentions`（v0.1.1）：输入框 **@ 索引项目文件/文件夹**，选中后文件内容注入
  AI 提示词（≤40KB）。**忽略列表可在 dsh 设置 → 通用 → "@ 索引忽略列表"里配置**
  （每行一个目录/文件名，basename 精确匹配、大小写不敏感，即时生效）。改它的
  `lib/index.js`（host 半身）后需重启服务（设置 → 重启服务）；改 `lib/client.js` 走 HMR 自动生效。
- `dsh-ui-obsidian-layout`（v0.5.3 侧边栏交互：默认全隐藏，左上角悬浮按钮（固定位置，不随内容移动）
  → 点击侧边栏撑满全宽覆盖聊天（新会话/工作区/会话记录都在里面）、按钮移到右上（logo 行下方）
  → 再点恢复；侧边栏内部收起时自动退出覆盖模式。**标题让位**：会话头部加 60px 左内边距，
  标题/标签行右移避开按钮，按钮本身不动）。
  Obsidian 面板视口 < 1024px 时 AppFrame 处于 narrow 模式、侧边栏默认已收起，此时调
  `toggleSidebar()` 反而会把它展开（v0.2.1 修复）。实现要点：CSS `visibility:hidden`
  隐藏侧边栏列（**不能 `display:none`**，否则 grid 列顺移导致聊天区 0px、详情列占满全宽）
  + MutationObserver 改写 frame 行内 grid（聊天模式零化第一轨道保留详情；覆盖模式
  `minmax(0px,1fr) 0px 0px`；**格式判断按首段形状**，`minmax(0px, 1fr)` 按空格拆是两段）
  + API toggle 同步 store。CSS 类名是 CSS Modules 哈希 `pI_x6G_*`，dsh 升级后若失效需
  同步更新。改它的 `lib/client.js` 后无需重启服务，`dsh-client-hmr` 会自动热更新。

## 已知边界

- 原生面板是 **Phase 1 React UI**：隐藏官方页面 + 原生消息/工具卡/输入框；可见的官方 Web GUI 面板已删除。
  隐藏 core 仍是 `<webview>`，这是原生面板的数据源；零 webview 需要重写 DSH 客户端核心，不在当前范围。
- 模型选择只列已配置的 provider；provider / API key 不再有官方设置页入口，需编辑 obsidian profile 的
  `cordis.patch.yml` 后重启。接入需与桌面 profile 对齐（`llm-pi-ai` + `agent-default-model`），否则会报
  `Authentication Fails`，见 [docs/development.md](docs/development.md#profile-的模型接入与桌面端一致)。
- 原生面板暂不支持附件上传、slash 命令、queue/steer、plan-review、子代理、文件预览和专用工具卡；
  这些能力暂时只能用桌面 DSH。
- 若 dsh 通过樱花等隧道暴露，需在 dsh 侧配 `--trusted-host`（loopback 访问不需要）。
- Obsidian 从 Finder 启动时 PATH 不完整，已用候选路径兜底；若仍找不到 dsh，看开发者控制台日志。
- 0.2.x 的 token 是每进程新生成的：插件只能接管自己拉起的实例；上次遗留的实例会显示「需手动结束」，
  按提示 `pkill -f "dsh --profile obsidian"` 后重启服务。重启服务后已打开的原生面板会自动重载。

## skills/ — 给 agent 的技能

`skills/obsidian-docs/` 把 Obsidian 三套官方文档（中文帮助 / 英文帮助 / 开发者文档）索引到本地，
让 agent 回答 Obsidian 使用与插件开发问题时**先查后答**：

```bash
node skills/obsidian-docs/scripts/obsdocs.mjs find 属性     # 搜目录
node skills/obsidian-docs/scripts/obsdocs.mjs get 编辑与格式化/属性  # 取正文
```

目录约定、完整命令与维护方式见 [docs/skills.md](docs/skills.md)，技能入口是 [skills/obsidian-docs/SKILL.md](skills/obsidian-docs/SKILL.md)。

## 文档

长期维护的说明在 [docs/](docs/README.md)，路线图与状态只在 [docs/roadmap.md](docs/roadmap.md) 维护：

| 文档 | 内容 |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | 路线图：主线「边用边改」+ 需求待办 / 历史里程碑 / 非目标 / 风险 |
| [docs/architecture.md](docs/architecture.md) | 架构：服务生命周期、profile 与端口、原生面板与隐藏 core |
| [docs/development.md](docs/development.md) | 开发：前置条件、构建、安装、调试、代码改动地图 |
| [docs/install.md](docs/install.md) | 安装指南（给 agent）：全链路安装、验收清单、失败矩阵、卸载回滚 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 故障排查：起不来 / 面板空白 / 端口冲突 / PATH |
| [docs/skills.md](docs/skills.md) | `skills/` 目录约定与 obsidian-docs 技能 |
| [AGENTS.md](AGENTS.md) | 给 AI agent 的项目结构约束（目录、版本、验证） |

当前进度：方案 A / B 已完成，M2 稳定性（含 M2-5 版本可见性、dsh 版本选择 + 0.2.x token 支持、webview 承载）已完成；0.3.0 起只支持 dsh 0.2.x，bridge 插件迁入本仓库（[0007](docs/changes/0007-drop-legacy-and-migrate-bridge.md)）；M4 原生聊天（[0006](docs/changes/0006-native-chat-panel.md)）Phase 1 已完成；[0008](docs/changes/0008-native-only-surface.md) 起删除可见官方面板，只保留原生聊天面板。
2026-10-27 起主线切换为「边用边改」：后续需求先在 [roadmap](docs/roadmap.md) 登记待办、调研并对比实现路径，按你选定的路径实施（[0018](docs/changes/0018-usage-driven-workflow.md)）。
