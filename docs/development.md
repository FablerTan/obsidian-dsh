# 开发

## 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20（构建）；dsh 运行需 `^22.19.0 || >=24.0.0` | 版本不符会导致服务「启动失败(退出码 N)」 |
| npm | 随 Node | 只装 devDependencies |
| Obsidian | ≥ 1.7.2，桌面端 | 移动端不支持（插件用 `child_process`） |
| dsh | 已安装 0.2.x 并可执行 | 0.1.x 不再支持；见 [architecture.md](architecture.md#进程解析与环境) |

## 首次搭建

```bash
npm install          # esbuild / typescript / eslint / obsidian 类型；postinstall 自动安装 git hooks
npm run build        # tsc -noEmit -skipLibCheck && esbuild（production）→ main.js
npm run check        # 提交前检查：版本 / 依赖 / manifest 合规 / 类型 / main.js 与源码构建一致
npm run lint         # 官方 eslint-plugin-obsidianmd recommended（Obsidian 社区目录同一套），0 error
npm run dev          # watch 模式：改源码自动重编译（Obsidian 里需「重新加载插件」）
```

## 安装到 vault

```bash
# 开发期推荐：符号链接，改代码即生效（记得 npm run build / npm run dev）
ln -s ~/path/to/obsidian-dsh ~/path/to/vault/.obsidian/plugins/dsh-native-chat
```

发布/分享时才复制三件套到 `<vault>/.obsidian/plugins/dsh-native-chat/`：`main.js`、`manifest.json`、`styles.css`（可选加 `versions.json`）。
启用路径：Obsidian 设置 → 第三方插件 → 启用 **DSH Native Chat**。

> 注意：符号链接安装时，插件目录就是本仓库，Obsidian 写的运行时设置 `data.json` 会落在仓库根目录。

## profile 的模型接入（与桌面端一致）

obsidian profile 的模型配置是独立的：base 默认走 `deepseek-official`，那条线路的 API key 往往不可用
（发送报 `Authentication Fails`）。开发/使用原生聊天前，把 `$DSH_HOME/profiles/obsidian/cordis.patch.yml`
对齐桌面端：

- `llm-pi-ai`：至少配 `command-code`（`api: openai-responses` + `apiKeyEnv: COMMAND_CODE_API_KEY` +
  `deepseek/deepseek-v4.1-flash`）；
- `agent-default-model`：`provider: command-code`、`reasoningEffort: high`；
- `llm-deepseek`：`disabled: true`（避免无效 key 线路出现在模型菜单）。

凭据在 `$DSH_HOME/.credentials.yaml` 的 refs 里，各 profile 共享，不需要复制密钥。改完「重启 DSH 服务」，
原生聊天底部应显示 `DeepSeek V4.1 Flash (latest) · High`。完整片段见
[troubleshooting.md](troubleshooting.md#模型报-authentication-fails--模型和桌面端不一致)。

## 调试

- **开发者工具**：`Cmd+Opt+I`。插件日志前缀 `[dsh-native-chat]`，服务日志前缀 `[dsh]`（stdout/stderr 已转发）。info 级日志走 `console.debug`（官方 guideline：默认控制台只应有 error），需要把控制台级别切到 **Verbose** 才看得到；warn / error 照常显示。
- **让 dsh 自己看界面 / 控制台**：用 CDP + MCP（开发期，agent 不要跑在面板里）；启动、配置、cookbook 与全流程见 [obsidian-cdp.md](obsidian-cdp.md)。
- **状态栏**：`DSH: 运行中 / 启动失败 / 启动超时 / 启动失败(退出码 N) / 端口被占用 / 需手动结束 / 版本不支持`；点「结束后台 dsh」后为 `已结束`（失败时 `端口被其他程序占用` / `无法结束` / `结束超时`）。点击可打开原生聊天。
  「需手动结束」= 端口上是需要 token 的 dsh（通常是上次遗留的 0.2.x 实例）：设置 → DSH Native Chat →「服务」→「结束后台 dsh」行的「结束」，行下显示「已结束后台 dsh（PID …）」后再点「重启服务」。
- **实际使用的 dsh**：控制台搜 `[dsh-native-chat] dsh 版本:`（服务已在运行时为「插件将使用 dsh …」，尚未确认）；设置 → DSH Native Chat →「dsh 版本」切换安装、「运行环境」看路径/版本/其他安装。0.2.x 的启动 URL 与 token 只在内存中使用，日志里 `token=***`。
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
  | dsh profile / 客户端插件（host 半身） | 插件设置 →「重启服务」 |
  | `packages/dsh-obsidian-bridge/lib/client.js` | 已 link 到 profile 时 HMR 自动生效；改 `package.json` / patch 需重启服务 |

## 代码结构与改动地图

`src/` 按职责域分层，依赖方向单向（分层图与硬约束见 [architecture.md](architecture.md#src-分层)）：

| 文件 | 职责 |
|---|---|
| [src/main.ts](../src/main.ts) | 组合根：注册视图 / 命令 / 状态栏 / 设置页，注入 `DshServiceManager`，把结果映射成 Notice |
| [src/service/manager.ts](../src/service/manager.ts) | `DshServiceManager`：探测 → 拉起 → 等待就绪（0.2.x 用 stdout `dsh web:` 行）→ 重启 / 停止；`stopBackground()`（0056）结束自拉进程与当前端口上的遗留 dsh；`embedUrl` 与 `url` 分离 |
| [src/service/port-dsh.ts](../src/service/port-dsh.ts) | 结束后台 dsh 的平台实现（0056）：`PortListener` / `listPortListenerPids`（POSIX `lsof`，缺 lsof 的 Linux 回落 `ss`；Windows `netstat`）、`readProcessCommand`（`ps -o command=`，不可用时回退 `pgrep -laf`；Windows `powershell`）、`looksLikeDshCommand` 命令行核实、`terminateProcesses`（SIGTERM → 轮询 3s → SIGKILL → 再等 1s）、`isProcessAlive`；不向插件自身发信号 |
| [src/service/locator.ts](../src/service/locator.ts) | `resolveDshInstall()` / `listDshCandidates()` / `probeDshVersion()` / `inspectDshRuntime()` / `buildSpawnEnv()`：可执行文件解析、版本选择 / 探测与 PATH 注入 |
| [src/service/plugin-inventory.ts](../src/service/plugin-inventory.ts) | 插件清单（0031）：spawn `dsh --profile <p> --dump-config` 取**组合结果**，按 `# ==` 分段 + 顶层条目解析成 bundle / 组件行（排除分组行），版本从 `node_modules` 逐层读；15s 缓存 + patch mtime 感知 |
| [src/service/plugin-patch.ts](../src/service/plugin-patch.ts) | 组件行启停（0031）：最小 YAML 覆盖的增 / 改 / 删（`disabled`）、写前备份 `.bak-<时间戳>`、原子写、写后复验失败回滚；不引入 YAML 依赖 |
| [src/service/plugin-catalog.ts](../src/service/plugin-catalog.ts) | 可选 / 实验性插件目录（0032）：解析 `@deepseek-ai/dsh-official-bundles`（`require(ESM)`，失败回落 `import()`）取 OPTIONAL / EXPERIMENTAL / ON_DEMAND 名单，逐包读版本与 `locale/zh.json` 标题描述；15s 缓存 |
| [src/service/plugin-bundles.ts](../src/service/plugin-bundles.ts) | bundle 级启停（0032）：改 profile `package.json` 的 `dsh.profile.bundles`（JSON），备份 / 原子写 / 复验失败回滚 |
| [src/service/file-atomic.ts](../src/service/file-atomic.ts) | profile 文件写入的公共约定（0031 / 0032，0065 收敛）：`createBackup`（`.bak-<本地时间戳>`，同秒自动加序号）、`writeAtomic`（临时文件 + rename，mode 0600，失败清理）、`safeMtime`（mtime 截断，读不到为 0）；`plugin-patch` / `plugin-bundles` / `plugin-inventory` / `plugin-catalog` 共用 |
| [src/service/yaml-scalar.ts](../src/service/yaml-scalar.ts) | YAML 标量去引号 `unquoteYaml`（单引号 `''` 转义 / 双引号 / 裸值），`plugin-inventory` 与 `plugin-patch` 共用；不引入 YAML 依赖（0065） |
| [src/view/panel-host.ts](../src/view/panel-host.ts) | `DshPanelHost` 接口：原生视图需要的地址 / 分区 / 服务生命周期 / 设置读取（流式刷新、@ 引用范围、/ 技能与命令范围、选区引用摘录上限） |
| [src/view/surface.ts](../src/view/surface.ts) | 隐藏 core 的 Electron webview：创建、换源、重载、销毁、`executeJavaScript` |
| [src/view/native/core-bridge.ts](../src/view/native/core-bridge.ts) | 原生聊天数据桥（v2–v8）：executeJavaScript 调用、探测、等待就绪、结构 + live 长轮询、上下文占用、命令 / 技能目录、Agent Teams 团队投影、子智能体目录与 addressed 订阅（`supportsSubagents` / `subagents()`）、目标投影与目标操作（`supportsGoal` / `goal()` / `goalAction()`）、错误归因 |
| [src/view/native/native-chat-view.tsx](../src/view/native/native-chat-view.tsx) | 原生聊天视图：隐藏 core + React root + probe / 重启重载 |
| [src/view/native/note-tracker.ts](../src/view/native/note-tracker.ts) | 记住最后一次激活的 Markdown 笔记（@ 菜单的「当前笔记」候选） |
| [src/view/native/quote.ts](../src/view/native/quote.ts) | 选区引用纯逻辑（0058）：`formatQuote`（引用块 + 摘录上限 / 截断标记）/ `parseQuote`（拆出引用与正文，解析失败返回 null）/ `quoteExcerpt` / `quoteKey` / `quoteLineLabel`；不 import obsidian，可单独冒烟 |
| [src/view/native/editor-selection.ts](../src/view/native/editor-selection.ts) | 选区 ↔ 主编辑器（0058 / 0059）：`captureSelectionQuote()` 用官方 `workspace.getMostRecentLeaf()` 在面板获焦前读「最后一次活跃 MarkdownView」的选区（面板获焦后 `activeEditor` 会变 null，但编辑器 CM6 选区仍在）；`observeEditorSelection()` 实时跟踪（`selectionchange` + `active-leaf-change` / `file-open`，80ms 防抖 + `quoteKey` 去重）；`jumpToQuote()` 复用已开 leaf / `openLinkText(path, sourcePath, true)` 打开笔记、必要时切 source 模式、`setSelection + scrollIntoView + focus`，行号漂移时按摘录搜索兜底 |
| [src/view/native/slash.ts](../src/view/native/slash.ts) | “/” 命令菜单纯逻辑：行首 token 检测（`/` 独占行首、含空格/斜杠不触发）、本地命令表（仅 new，0050 起 dsh 命令来自 `commands()`）、名字过滤排序（完全 > 前缀 > 包含 > 子序列）、命令 / 技能行模型与 `/name ` 插入格式化；first-party 命令按 name 映射中文标签（compact / export / feedback / goal / permission / plan），未知命令回退 dsh 英文描述 |
| [src/view/native/mention.ts](../src/view/native/mention.ts) | @ 引用纯逻辑：token 检测（起点/空白后、`@"…` 引号、词内邮箱不触发）、候选排序（对齐 dsh）、目录直列、`@path` 插入格式化（目录 drill 保留打开引号 / 采纳时 `completeMention` 补齐）、20 条上限 |
| [src/view/native/mention-scope.ts](../src/view/native/mention-scope.ts) | @ 菜单候选范围过滤（0030，纯函数）：`filterMentionEntries(entries, scope)` —— 白名单保留条目内候选并补上祖先文件夹（保证从根目录能下钻）、黑名单排除条目内候选；「当前笔记」首行由菜单自己维护，不经过它 |
| [src/settings/scope-candidates.ts](../src/settings/scope-candidates.ts) | 设置页白 / 黑名单「选取」的候选构造（0038 / 0051，纯函数）：`listPathCandidates(entries, existing)` / `listSkillCandidates(names, existing)` / `listCommandCandidates(names, existing)` —— 排除隐藏段与 `.git` / `node_modules`、名单里已有条目、被名单条目覆盖的冗余项；技能按 `-` 前缀覆盖、命令按精确匹配；文件夹排前、按路径 / 名字排序 |
| [src/service/skill-catalog.ts](../src/service/skill-catalog.ts) | 本地技能目录扫描（0038）：vault `.dsh/skills`、`.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`；目录取 `SKILL.md` frontmatter `name`、单文件取 `*.md`；跟随符号链接；15s 缓存；失败返回空数组 |
| [src/view/native/skill-scope.ts](../src/view/native/skill-scope.ts) | 「/」菜单技能行范围过滤（0037，纯函数）：`filterSlashSkills(skills, scope)` —— 白名单只留命中技能名（空白名单返回空）、黑名单排除命中技能名；条目按技能名前缀语义匹配（`office` 覆盖 `office` 与所有 `office-*`）；只影响菜单显示，不碰技能目录 / 加载 / 执行 |
| [src/view/native/command-scope.ts](../src/view/native/command-scope.ts) | 「/」菜单命令行范围与降级过滤（0050，纯函数）：`filterSlashCommands(commands, scope)` 精确匹配（命令是扁平命名空间，不走 `-` 前缀）、`filterUnsupportedCommands()`（隐藏 `/export`：桥直连 execute 不触发 Web 下载）、`hideCommandNamedSkills()`（同名时命令优先）、`leadingCommandLine()`（草稿开头命令识别，供 Enter 路由）；只影响菜单显示与发送路由，不碰命令目录 / 执行 |
| [src/view/native/note-links.ts](../src/view/native/note-links.ts) | `applyNoteLinks` / `noteLinkOf` / `isLinkSafe` / `folderChipOf`：消息里的 `@vault/路径.md` → 短链接；带结尾斜杠的 `@文件夹/` → 可点击文件夹 chip（跳过代码块 / 行内代码 / 已有 `[[…]]` / 邮箱；按 vault 存在性校验） |
| [src/view/native/folder-reveal.ts](../src/view/native/folder-reveal.ts) | `revealFolderInExplorer`：点击文件夹 chip 时展开左侧栏、逐级展开祖先、选中并滚动到文件列表里的该文件夹（内部 API 全部按存在性调用，缺视图时用 `file-explorer:open` 兜底） |
| [src/view/native/ui/markdown-text.tsx](../src/view/native/ui/markdown-text.tsx) | `MarkdownText`：消息 markdown 渲染 + 引用转换 + `a.internal-link` 点击在**主区新标签**打开（聊天面板保留）+ 文件夹 chip 点击在左侧文件列表展开选中 |
| [src/view/native/ui/](../src/view/native/ui) | React 18 UI：浮层骨架 `menu-shell.tsx`（定位/背板/二级浮层）、`mention-menu.tsx`（@ 引用下拉：当前笔记 + 文件与文件夹分组、键盘高亮、目录行「进入目录」箭头）、`slash-menu.tsx`（“/” 命令下拉：本地命令 + dsh 命令组 + 「技能」分组，同一个列表、没有二级菜单，命令组 / 技能组各有说明行）、`model-menu.tsx` / `permission-menu.tsx` / `session-menu.tsx` / `context-meter.tsx`（上下文占用圆环与详情）、`timeline.tsx`（滚动外壳）+ `timeline-model.ts`（折叠过程：按正文分界分段，0036）+ `timeline-process.tsx`（过程行 / 思考行）+ `tool-row.tsx`（工具行）+ `timeline-nodes.tsx`（其余节点）+ `markdown-text.tsx`（消息排版与引用链接）+ `team-panel.tsx`（Agent Teams 只读团队浮层）+ `subagent-panel.tsx`（只读子智能体目录：模式 / 状态 / 耗时 / token / 模型 / 团队徽标）、输入框、`pending.tsx`（审批 / 提问卡片：提问单题一屏 + 底部翻页与草稿）、`run-status.tsx`（输入框上方的运行提示：dsh 同款鲸鱼 + 逐秒计时，0047）、`goal-bar.tsx`（输入框上方的目标条：目标图标 / 阶段标签 / 单行目标 / 暂停 / 恢复 / 内联编辑 / 清除，0052）、`quote-card.tsx`（微信式选区引用卡：竖线 + 笔记名 + 行范围 + 两行摘录，点击跳回并高亮，0058）、`quote-preview.tsx`（输入框上方的引用预览条 + ×）、`session-picker.tsx`（会话浮层：按 vault 过滤的会话列表）、`turn-end.ts`（静默结束判定纯函数）+ `turn-end-hint.tsx`（静默结束兜底提示条与「重试」，0046）；输入框是 0065 纯搬运拆出来的：`composer.tsx`（壳：状态 / effects / 输入区 / 发送编排）+ `composer-props.ts`（`ComposerProps` 类型）+ `composer-mentions.tsx`（@ 候选构造、`/` 菜单视图模型 `buildSlashView`、菜单渲染与 ↑↓·Tab·Enter·Esc 导航）+ `composer-accessories.tsx`（压缩 / 模型提示、只读提示、底栏 chip + 上下文圆环）；品牌与权限图标在 `model-brand.tsx` / `permission-icon.tsx` |
| [src/shared/native-types.ts](../src/shared/native-types.ts) | 原生聊天 DTO（会话/节点/模型/权限/笔记/团队/子智能体）与桥错误类型 |
| [src/view/open.ts](../src/view/open.ts) | `openNativeChat()` / `findNativeChat()`：复用或新建右侧 leaf |
| [src/settings/schema.ts](../src/settings/schema.ts) | 设置类型、默认值（含 `dshPath`）、端口校验 |
| [src/settings/context.ts](../src/settings/context.ts) | `SettingsHost` 接口 + `SettingsRenderContext`（模块渲染上下文：host / app / `isStale()` / `refresh()`） |
| [src/settings/tab.ts](../src/settings/tab.ts) | `DshSettingTab`：顶部 5 个模块 tab（服务 / dsh 版本 / 聊天 / 集成 / 插件）+ 内容区调度 |
| [src/settings/sections/](../src/settings/sections) | 各模块渲染函数：`service.ts`（端口 / Profile / 自动启动 /「结束后台 dsh」/ 重启，后两者带就地进度与结果状态行，0056）、`runtime.ts`（版本选择 + 运行环境）、`chat.ts`（调度 + 流式刷新 / 运行提示位置 / 选区引用摘录上限）、`chat-scope.ts`（@ 与「/」的三张范围卡 + 名单添加栏，0065 拆出）、`scope-picker.ts`（候选 `SuggestModal`，0065 拆出）、`integration.ts`（项目目录 / 桥接状态 / 安装提示）、`plugins.ts`（dsh 插件清单 / 组件行启停 / 可选·实验性插件，0031 + 0032） |
| [src/shared/](../src/shared) | 视图常量与 `isDshPage()`、四态类型、`sleep`、`errorText()`、日志约定（含 token 打码）、vault 路径、`createDshProbe()`、DSH 鲸鱼图标（`brand.ts`） |

| 想改 | 看哪里 |
|---|---|
| 启动、探测、等待就绪、重启 | `service/manager.ts` |
| 结束后台 dsh / 重启就地反馈（0056） | `service/port-dsh.ts`（端口监听 PID + 命令行核实 + SIGTERM/SIGKILL）+ `service/manager.ts`（`stopBackground()` / `DshStopOutcome`）+ `settings/sections/service.ts`（两个按钮 + 行下状态行）+ `settings/context.ts` / `view/panel-host.ts` / `view/native/native-chat-view.tsx`（`restartService` 返回 `DshActionResult`）+ `settings/sections/plugins.ts`（插件 tab 重启也用返回值）+ `main.ts`（`stopBackgroundService()` / `describeOutcome()` / `describeStop()`）+ `shared/types.ts` + `styles.css`（`.dsh-service-action-*`） |
| 可执行文件查找、版本探测与 PATH（含桌面 App 内置 dsh 探测：`desktopAppRoots()` / `listDesktopAppInstalls()`） | `service/locator.ts` |
| dsh 版本冲突提示（日志 / Notice / 设置页运行环境） | `service/manager.ts` + `main.ts` + `settings/sections/runtime.ts` |
| 切换 dsh 版本 / 0.2.x token 就绪与隐藏 core 地址 | `settings/schema.ts` + `settings/sections/runtime.ts` + `service/locator.ts` + `service/manager.ts` + `view/native/native-chat-view.tsx` |
| 设置页 tab 条 / 模块划分 | `settings/tab.ts`（tab 条 + 调度）+ `settings/sections/` + `styles.css`（`.dsh-settings-*`） |
| 探测判定 / 注入实现 | `shared/host.ts`（requestUrl 可信探测）；`service/` 只消费注入的探测 |
| 隐藏 core 加载 / 自愈 / 专用分区 | `view/surface.ts` + `view/native/native-chat-view.tsx` + `main.ts` |
| 原生聊天数据桥 / React UI | `view/native/` + `packages/dsh-obsidian-bridge/lib/client.js` |
| 流式正文 / 思考 / 工具参数（live tail） | `packages/dsh-obsidian-bridge/lib/client.js`（eventSource 累加 + `nextEvent`）+ `src/view/native/ui/native-chat-root.tsx` + `timeline-model.ts` |
| 流式刷新节奏（逐字 / 每帧 / 平衡 / 省电） | `settings/schema.ts` + `settings/sections/chat.ts` + `view/panel-host.ts` + `view/native/ui/native-chat-root.tsx`（rAF 合帧）；桥只负责每个 chunk 唤醒 |
| 输入栏上下文占用圆环 / 详情 | `view/native/ui/context-meter.tsx` + `composer-accessories.tsx`（底栏圆环）+ `native-chat-root.tsx`；桥 `context()` + `contextPressure` / `contextBreakdown` 投影 |
| 输入框上方的目标条（0052） | `view/native/ui/goal-bar.tsx`（官方 artwork 图标 + `goalLabel` 阶段文案 + 单行省略正文 + 28px 圆形动作 + 内联 textarea：Enter 保存 / Shift+Enter 换行 / Esc 取消 / IME 安全，6 行封顶；complete 返回 null）+ `composer.tsx`（`goalBar` 槽，**0054：目标条位于运行提示（深度求索中）下方**，顺序 `RunStatus` → `goalBar` → 输入卡）+ `native-chat-root.tsx`（`goal` / `goalPending` / `goalError`、`refreshGoal` 请求序号、`goalAction` 成功后 `refreshSnapshot`）+ `core-bridge.ts`（`supportsGoal()` / `goal()` / `goalAction()`）+ `shared/native-types.ts`（`NativeGoal*`）+ `styles.css`（`.dsh-native-goal-*`；**0053：主题实色卡片**——去掉 `backdrop-filter` / `isolation` 伪元素底，避免 Obsidian 窗口闪烁）；桥 `goal()` / `goalAction()` + `goal` 投影与 `goal/activation-changed` 订阅；`native-chat-root.tsx` 的 `sameGoal()` 深度比较（目标没变不重渲染） |
| 运行提示（0047 / 位置 0048 / 扫光 0049） | `view/native/ui/run-status.tsx`（`formatRunDuration` 纯函数 + 每秒刷新的 `RunStatus`，`variant` 区分输入框上方 / 输出最下方）+ `composer.tsx`（`showRunStatus`）+ `timeline.tsx`（`runningStatus` 挂在列表末尾）+ `settings/schema.ts` / `settings/sections/chat.ts`（`runStatusPlacement`）+ `panel-host.ts` / `main.ts`（`getRunStatusPlacement`）+ `styles.css`（`.dsh-native-run-*`，dsh 配色与 12px / 22px 节奏） |
| Agent Teams 团队入口 / 只读面板 / 团队工具行 / 队友消息 | `view/native/ui/team-panel.tsx`（roster + 任务板）+ `native-chat-root.tsx`（标题右侧图标 / 状态刷新）+ `chat-node-data.ts` / `tool-row.tsx`（team 类目与九个工具标题摘要）+ `timeline-nodes.tsx`（`team-message` 卡片）；桥 `team()` + `agentTeam` 投影订阅 |
| 子智能体入口 / 只读目录 / 子会话导航 / 只读 composer（0041） | `view/native/ui/subagent-panel.tsx`（目录浮层）+ `native-chat-root.tsx`（bot 图标 / 面包屑 / `readOnlyReason` / `refreshSubagents` / `openSubagent`）+ `composer.tsx` / `composer-accessories.tsx`（`readOnly` 提示，运行中仍可 Stop）+ `core-bridge.ts`（`supportsSubagents()` / `subagents()` / addressed `subscribe`）+ `shared/native-types.ts`（`NativeSubagentAddress` / `Info` / `Entry` / `List`）；桥 `subagents()` + `subagentCatalog` / `subagent` / `subagentTiming` 投影 |
| 输入框 “/” 命令菜单（本地 new + dsh 命令目录 + 技能列表，0050） | `view/native/slash.ts`（纯逻辑：本地命令 + dsh 命令映射 + 技能分组）+ `view/native/command-scope.ts`（范围 / 降级 / 发送路由判断）+ `view/native/ui/slash-menu.tsx` + `composer.tsx`（替换 / 打开时刷新命令与技能目录 / Enter 路由 / 压缩过程提示）+ `composer-mentions.tsx`（菜单视图模型与键盘导航）+ `native-chat-root.tsx`（`onNewSession` / `loadCommands` / `onRunCommand` / `loadSkills`）；桥 `commands()` / `skills()` / `executeCommand()` |
| 新建会话（面板内 ＋ / 空态 / 会话选择器） | `view/native/ui/native-chat-root.tsx` + `view/native/core-bridge.ts`；dsh 侧 `packages/dsh-obsidian-bridge/` |
| 消息里的引用渲染 / `[[…]]` 点击打开 | `view/native/note-links.ts` + `view/native/ui/markdown-text.tsx`；`@` 插入在 `view/native/ui/composer.tsx`（候选构造与菜单在 `composer-mentions.tsx`；发送不再自动拼前缀） |
| 编辑器选区引用（0058 / 0059：实时预览、发送自动附笔记 + 选区、微信式引用卡、点击跳回并高亮） | `view/native/quote.ts`（引用块编解码）+ `view/native/editor-selection.ts`（选区快照 / 实时监听 `observeEditorSelection` / 跳转选中）+ `view/native/ui/quote-card.tsx` / `quote-preview.tsx` + `composer.tsx`（mousedown / focus 捕获兜底）+ `native-chat-root.tsx`（`applyQuote` 实时状态、发送前置引用、预览条点击跳转、空白点击不抢焦点）+ `settings/schema.ts` / `settings/sections/chat.ts`（`quoteExcerptLimit`）+ `view/panel-host.ts` / `main.ts`（`getQuoteExcerptLimit`）+ `styles.css`（`.dsh-native-quote-*`） |
| 文件夹 chip 点击定位（左侧文件列表展开选中） | `view/native/folder-reveal.ts` + `view/native/ui/markdown-text.tsx`（事件委托）+ `view/native/note-links.ts`（chip HTML） |
| 面板布局与显示 | `view/native/ui/` + [styles.css](../styles.css) |
| 思考 / 工具调用的折叠、展开与一行摘要 | `view/native/ui/timeline-model.ts` + `timeline-process.tsx` + `tool-row.tsx` |
| 过程行分段（正文分界、段内用时、跨段工具结果合并） | `view/native/ui/timeline-model.ts`（`buildTimeline` 的 `openGroups` / `closeSegment` / `toolGroups`） |
| 新增设置项 | `settings/schema.ts`（类型 / 默认值）+ `settings/sections/<模块>.ts`（控件）；新模块要在 `settings/tab.ts` 的 `SECTIONS` 注册 |
| 命令 / ribbon / 状态栏 | `main.ts` 的 `onload` |
| 原生聊天入口 / 视图类型 / 旧 leaf 迁移 | `main.ts`（registerView + 命令 + migrateLegacyPanel）+ `shared/constants.ts`（`dsh-native-chat` / `dsh-web`）+ `view/native/` |
| 输入框 @ 引用（触发 / 候选 / 排序 / 插入） | `view/native/mention.ts`（纯函数）+ `view/native/ui/mention-menu.tsx` + `composer.tsx` / `composer-mentions.tsx`；候选来自 `app.vault.getAllLoadedFiles()`，范围裁剪见下一行 |
| @ 菜单的检索范围（白名单 / 黑名单） | `settings/schema.ts`（`mentionScope` / `mentionWhitelist` / `mentionBlacklist` + 路径归一化）+ `settings/sections/chat-scope.ts`（三档下拉与添加栏）+ `view/panel-host.ts` / `main.ts`（`getMentionScope`）+ `view/native/mention-scope.ts`（纯函数过滤）+ `native-chat-root.tsx`（打开菜单取快照时套用） |
| 「/」菜单的技能行范围（白名单 / 黑名单） | `settings/schema.ts`（`ScopeMode` 泛化 + `skillScope` / `skillWhitelist` / `skillBlacklist` + 技能名归一化）+ `settings/sections/chat-scope.ts`（三档下拉与添加栏）+ `view/panel-host.ts` / `main.ts`（`getSkillScope`）+ `view/native/skill-scope.ts`（纯函数过滤）+ `composer.tsx`（打开菜单拉技能目录时套用；过滤为空说明行） |
| 「/」菜单命令透传 + 命令范围（0050） | `settings/schema.ts`（`commandScope` / `commandWhitelist` / `commandBlacklist` + `normalizeCommandName(s)`）+ `settings/sections/chat-scope.ts`（「命令范围」卡片）+ `view/panel-host.ts` / `main.ts`（`getCommandScope`）+ `view/native/command-scope.ts`（范围过滤 / 隐藏 export / 同名技能 / leading 识别）+ `composer.tsx`（命令目录、Enter 路由、说明行）+ `native-chat-root.tsx`（`runCommand` / `showCommands`） |
| 命令范围的「选取」（0051） | `settings/context.ts` / `main.ts`（`getCommandCandidates` → `findNativeChat`）+ `view/native/native-chat-view.tsx`（`listCommandNames()` → 桥 `commands()`，过滤 `/export`）+ `settings/scope-candidates.ts`（`listCommandCandidates`）+ `settings/sections/chat-scope.ts`（命令卡片 `pickKind: 'command'`）+ `settings/sections/scope-picker.ts`（弹窗类型「命令」）；面板未打开时手动输入兜底 |
| 设置页范围设置分组卡片（@ / 各一张卡，0039） | `settings/sections/chat-scope.ts`（`renderScopeCard`：徽标 + 标题 + 模式下拉 + body）+ `styles.css`（`.dsh-settings-scope-card*`） |
| 白 / 黑名单添加栏的「选取」（候选自动获取 + 点选填入，0038） | `settings/sections/chat-scope.ts`（行首按钮 + 添加栏）+ `settings/sections/scope-picker.ts`（`SuggestModal` + 回填输入框）+ `settings/scope-candidates.ts`（纯函数候选构造）+ `service/skill-catalog.ts`（技能名来源）+ `settings/context.ts` / `main.ts`（`getSkillCandidates`）+ `styles.css`（`.dsh-settings-scope-pick` / `.dsh-settings-scope-suggestion`） |
| dsh 插件清单 / 组件行启停（设置页「插件」tab） | `service/plugin-inventory.ts`（`--dump-config` 解析 + 版本 + 缓存）+ `service/plugin-patch.ts`（写 profile 用户层 `cordis.patch.yml`：备份 / 原子写 / 复验回滚）+ `settings/sections/plugins.ts`（UI）+ `settings/context.ts` / `main.ts`（`getPluginInventory` / `setPluginEnabled`） |
| 可选 / 实验性插件（启用 / 停用 bundle） | `service/plugin-catalog.ts`（官方目录 + 版本 + 中文标题）+ `service/plugin-bundles.ts`（写 profile `package.json` 的 `dsh.profile.bundles`）+ `settings/sections/plugins.ts`（顶部卡片；0034 起默认收起、点标题展开）+ `settings/context.ts` / `main.ts`（`getOptionalCatalog` / `setBundleEnabled`；只允许目录内的可选 bundle） |
| 模型 / 权限 / 当前笔记 | `view/native/ui/model-menu.tsx` + `permission-menu.tsx` + `composer-accessories.tsx`（底栏 chip） + `model-brand.tsx` + `permission-icon.tsx` + `note-tracker.ts`；dsh 侧 `packages/dsh-obsidian-bridge/lib/client.js` |
| 默认端口 3081、默认 profile | `settings/schema.ts` 的 `DEFAULT_SETTINGS`（**并同步**本文件的表格、README、[AGENTS.md](../AGENTS.md)） |

分层规则（新增代码前按 `skills/project-guide` 的决策表落位；冷启动时它也定义了先读哪些文档）：`service/` 不 import `obsidian`；`view/` 不 import `main.ts`；不建 `index.ts` barrel。

`service/` 是纯 Node 逻辑，可以单独打包做冒烟（不必启动 Obsidian）：

```bash
./node_modules/.bin/esbuild src/service/locator.ts --bundle --platform=node --format=esm --outfile=/tmp/locator.mjs
node --input-type=module -e "import('/tmp/locator.mjs').then(async (m) => { const auto = m.resolveDshInstall(null); console.log('auto', auto, m.listDshCandidates()); console.log('selected', m.resolveDshInstall('/Users/…/.local/bin/dsh')); })"
```

## dsh 侧插件（packages/dsh-obsidian-bridge）

- 源码在本仓库，profile 用 `dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge` 安装；
  旧的外部路径 link 先 `remove` 再重新 `add`，然后重启 DSH 服务。
- 改 `lib/client.js`：已 link 时由 dsh HMR 自动生效；改 `package.json` / `cordis.patch.yml` 需重启服务。
  改 `VERSION` 或新增桥方法（如 0052 的 `goal` / `goalAction`）后，原生面板要重新探测能力，需「重启服务」。
- 当前桥 `VERSION = 8`（包版本 0.5.0）。方法：`listSessions / subscribe / snapshot / nextEvent / send / cancel / loadOlder /
  models / selectModel / permissions / setPermission / renameSession / approvalAnswer / questionAnswer / context /
  commands / skills / executeCommand / team / subagents / goal / goalAction`。
  `subscribe` 同时接受会话 id 与子会话地址 `{ parentSessionId, childSessionId, mode }`；`snapshot()` 带 `subagent` 字段。
- 0017 起 `nextEvent(cursor, timeoutMs, liveCursor)` 同时返回 `liveCursor` / `live`：
  桥同步订阅 `binding.eventSource`，把 `assistant/live-chunk` 累积成正文 / 思考 / 工具参数 tail；
  旧原生端只传两个参数时行为不变（`ping.methods` 里的 `liveStream` 用于能力探测）。
- `npm run check` 会校验该包的清单并 `node --check lib/index.js` / `lib/client.js`。
- 只支持 dsh 0.2.x；原生聊天数据桥（0006 的 v2 能力 + 0017 的 v3 liveStream + 0022 的 v4 context + 0025 的 v5 commands / skills / executeCommand + 0035 的 v6 team + 0041 的 v7 subagents / addressed subscribe + 0052 的 v8 goal / goalAction）都在这个包里。
  `remote.commands` / `remote.skills` 是 cordis 作用域依赖，必须用 `ctx.inject([...], cb)` 取；profile 缺对应插件时只有这两项报错，桥照常加载。

## 变更流程：登记 → 路径调研 → 用户选路 → 按提案执行

用户提出的每个需求（功能 / BUG / 优化）都走这条流水线，硬规则见 [AGENTS.md](../AGENTS.md) 规则 12、13：

0. **登记**：在 [docs/roadmap.md](roadmap.md)「需求待办」加一行（`R-<n>`，状态 `待调研`，链接到提案），同时在 `docs/changes/` 建 `NNNN-<slug>.md`（复制 [template](changes/template.md)，`status: draft`）；两处互相引用。
1. **调研实现路径**：写进提案第 3 节「实现路径调研」——至少 2 条可行路径，逐条写改动面 / 代价 / 风险，并标明推荐；需要拍板的写进第 8 节。
2. **问用户选哪条**：把路径对比直接呈现给用户；**这一轮到此为止**，既不要改代码，也不要替用户默认选完。用户选定后，才把提案改 `status: approved` 并填 `approved` 日期。
3. **执行**：严格按提案改码；实质偏离要追加「变更记录」并退回 `draft` 重新确认。
4. **收尾**：填「实施记录」，状态改 `done`；roadmap 待办行改成 `✅ 已完成`（附日期）。被否则改 `rejected`，文件保留不删。

例外（不需要提案）：只改文档 / 注释 / 格式；用户当轮已明确指定要改的具体项；单纯 `npm run build`。
提案索引与状态表在 [docs/changes/README.md](changes/README.md)；当前主线与需求待办见 [roadmap.md](roadmap.md)「需求待办」。

## 构建与产物

- 构建链：`npm run build` = 类型检查（`tsc -noEmit -skipLibCheck`）+ esbuild 打包（CJS、es2021、minify）→ 根目录 `main.js`。
- `main.js` 是**构建产物**，不手改；改完源码重新构建，可用 `cmp` 或 diff 确认产物与源码同步（esbuild 输出可复现）。
- `external` 已包含 `obsidian`、`electron`、`@codemirror/*`、`@lezer/*` 与 Node 内置模块，新增依赖前先想清楚是否会打进产物。

## 提交前检查（pre-commit）

两条命令分工不同，发版前都要过：

- `npm run lint`：ESLint，配置 [eslint.config.mjs](../eslint.config.mjs)，规则来自官方 `eslint-plugin-obsidianmd` 的 `recommended`（与 Obsidian 社区目录对 Source code 的扫描是同一套），只扫 `src/`；目标是 **0 error**，warning 不阻断。
- `npm run check`：仓库自身规则——版本三处一致、无运行时依赖 / `isDesktopOnly`、manifest 合规（0055：id / name / description / authorUrl / minAppVersion）、`tsc -noEmit -skipLibCheck`、`main.js` 与当前源码的生产构建逐字节一致（在内存中构建，不改写文件）、桥插件清单与 `node --check` 语法。
- `npm run check -- --staged`：额外检查本次提交的暂存集：禁止 `.DS_Store` / `data.json` / `node_modules` / `skills/*/data/cache/`；源码或构建配置有变动时，要求 `main.js` 一起暂存且与构建结果一致。
- 钩子安装：`scripts/install-hooks.sh` 把 `scripts/githooks/pre-commit` 复制到 `.git/hooks/pre-commit`（幂等）；`npm install` 的 `postinstall` 与 `npm run hooks:install` 都会执行。改了模板后重跑 `npm run hooks:install`。
- 临时绕过（不推荐，须在 commit message 注明理由）：`SKIP_COMMIT_CHECK=1 git commit ...`。
- 检查读工作区源码并在内存中构建，**不会**替你 `git add`；`main.js` 不是最新时先 `npm run build` 再重新暂存。

## 版本号与发布

- 三处必须一致：`manifest.json.version`、`package.json.version`、`versions.json` 的键。
- `versions.json` 每次版本变化都追加一条 `{ "<插件版本>": "<最低 App 版本>" }`；`npm run check` 校验最新键等于当前版本。
- 发布资产（GitHub release）：`main.js` + `manifest.json` + `styles.css`，tag 与 manifest 版本一致。

## 现状与手动回归

当前仓库有 git 版本控制、`pre-commit` 检查（`npm run check`）与本地 lint（`npm run lint`），但**没有**单元测试与 CI。改动靠检查 + 构建 + 手动回归验证，每次改完至少过一遍。

> 若服务根本起不来（状态条「启动失败」），先按 [troubleshooting.md](troubleshooting.md) 排查 profile / 可执行文件，再回来做回归。

1. 重新加载插件 → 状态栏显示 `DSH: 运行中`（或自动拉起中后转为运行中）。
2. ribbon / 命令 / 状态栏点击 → 只出现原生聊天面板，不再出现官方 Web GUI 面板。
3. 先停掉服务再打开原生面板 → 自动拉起，页面就绪后显示会话列表 / 空态。
4. 命令「重启 DSH 服务」→ 成功 Notice，端口上仍只有一个 dsh；已打开的原生面板自动重载并恢复。
5. 设置里改端口 → 重启服务 → 原生面板连接新端口；界面不再展示服务 URL。
6. 用别的程序占端口（如 `python3 -m http.server 3082`）→ 状态条「端口被占用」、不显示「运行中」；换端口后恢复。
7. 禁用插件 → 自启进程退出（`lsof -nP -iTCP:<port> -sTCP:LISTEN` 无输出）。
8. 重新加载插件 → 控制台出现 `[dsh-native-chat] dsh 版本: <版本>（<路径>）`；有冲突 / 回退时 Notice 与设置页「运行环境」一致。
9. 设置页「dsh 版本」切换 → 重启服务 → 原生面板正常连接；显式选择后不再弹冲突 Notice。
10. 0.2.x：控制台出现 `dsh 就绪信号: http://…?token=***`；日志无明文 token。
11. 端口上留一个 0.2.x 实例再重载插件 → 状态条「需手动结束」+ Notice 指引「结束后台 dsh」；点设置页「服务」→「结束」后端口释放（行下显示 PID），再「重启服务」恢复。
12. 重新 link 桥插件并重启 → 设置页「桥接状态」显示「已连接（v8）」；原生面板发送 / 停止 / 流式正常。
13. 输入框输入 `/` → 出现 `/new`、`/compact` 与「技能」分组（当前会话没有技能时显示一行说明）；`/co` 过滤到 compact；点技能行插入 `/技能名 `；`/compact` 执行时输入框上方出现「正在压缩会话历史…」，结束后时间线出现 `/compact` 卡片。
13. 端口上放一个 0.1.x（裸 URL 200）→ 状态条「版本不支持」+ Notice。
14. webview 不可用的环境 → 原生视图显示错误提示，不出现 iframe、不静默空白。
15. 升级前先打开旧的 `dsh-web` 面板 → 重载插件后旧 leaf 被关闭，并打开一个原生面板；不会留下空白视图。
16. 面板内新建会话（右上 ＋ / 空态按钮 / 会话选择器）→ 服务就绪，新会话可直接输入；会话 cwd 是 vault，未发消息时标题显示「新会话」而不是仓库名（0033：只做展示占位，不再 rename）。
17. 发送 → 用户消息立即出现，Assistant 文本流式更新；停止 → 回合结束、消息不重复。
18. 输入框 Enter 发送 / Shift+Enter 换行；中文输入法组合期不误发；运行中发送键变停止。
19. 输入框输入 `@` → 弹出「当前笔记 + 文件与文件夹」菜单：第一项是当前笔记（跟随最后激活的 Markdown 笔记，说明行是 vault 路径），其余按 dsh 规则排序；↑/↓ 移动、Esc 关闭；文件行 Enter / Tab / 鼠标点行都是采纳；目录行 Enter / 鼠标点行 = 采纳 `@目录/ `，Tab / 行内箭头 = 进入子级（菜单继续展开）；发送**不再自动**带当前笔记前缀。
20. 模型菜单（自绘浮层）列出已配置 provider/model（含 reasoning effort）；切换后标签与发送模型同步。
    空菜单时点「配置说明」→ Notice 指向 `$DSH_HOME/profiles/obsidian/cordis.patch.yml`。
21. 权限菜单列出预设，切换后标签更新；`danger-full-access` 弹二次确认。
22. 触发审批 → 卡片固定在输入框上方，可「允许一次 / 拒绝」；触发提问 → 单题一屏，底部 `‹ n/N ›` 翻页（草稿保留、可回改），单选选中自动前进，`跳过` / `提交` 后继续；整批有未答且未跳过的题时 `提交` 会跳回该题并提示。
23. 关闭原生视图 → 隐藏 webview 与 React 卸载；重开 → 会话列表恢复；官方面板不会回归。
24. 与桌面端 / 另一个 Obsidian 窗口同时持有同一会话再发送 → 提示 `session/writer-held`，不静默失败。
25. 停用桥（profile 移除或换回未装桥的实例）→ 原生面板提示桥缺失，设置页「桥接状态」同步。
26. profile 模型对齐：底部标签为 `DeepSeek V4.1 Flash (latest) · High`，发送不再报 `Authentication Fails`。
27. 服务刚重启时立刻打开原生视图 → 不误显示「还没有会话」；最近会话列表在 ~3 秒内补齐。
28. 在核心 Web viewer 打开 `http://127.0.0.1:<port>/` → 401（专用分区不共享登录 cookie；带 token 的地址仍可首次登录）。
29. `npm run check` 通过。
30. 会话选择器与「最近会话」只出现 cwd 在当前 vault（含子目录）的会话；其他目录的会话不出现。
31. 点模型 / 权限 chip → 浮层贴着按钮上方；点右上「更多」→ 浮层在按钮下方；右栏拖窄后浮层仍完整可见、不越界。
32. 一轮里出现「工具 → 正文 → 工具」时，时间线按正文分界显示多条过程行（0036）：每行只统计自己段内的工具 / 思考，正文与过程行严格交替；展开后顺序与该段 blocks 一致。
32. 权限 chip 只有图标：Read Only=眼睛、Workspace Write=方框铅笔、Full access=红色盾牌告警、Custom=滑杆；
    悬停 tooltip 有名称与描述。
33. 模型菜单一级只列模型；悬停有层级的模型 → 右侧出现层级菜单并勾选当前层级；点层级后 chip 与发送模型更新；
    DeepSeek chip 显示官方鲸鱼 + 层级（无层级只鲸鱼），其他模型显示「名称 · 层级」。
34. 标签页与命令 / ribbon 显示「DeepSeek Harness」（命令 id 是 `dsh-native-chat:open-dsh-view`）；功能区与命令面板各只有一个打开入口；
    标签页 / ribbon 使用 DSH 鲸鱼图标（单色，跟随主题）。
35. 消息引用：用 `@` 选中的文件在正文里是 `@vault/相对路径`，气泡里渲染成可点击短链接；点链接在**主区新标签**打开、聊天面板保留；
    历史 `@路径` / `[[…]]` 消息同样渲染成链接；代码块 / 邮箱 / vault 里不存在的路径保持纯文本。
36. 过程行：一轮的思考 / 工具调用默认只占一行（运行中显示实时活动，收尾显示「运行了代码…」+ 用时，停止显示「已停止」）；
    点击展开思考全文与工具参数 / 结果；收尾后工具内容仍在；不再出现 “turn-process” 原始 JSON 卡。
37. 输入栏发送按钮左侧：有 usage 的会话显示上下文占用圆环（无数字），hover 显示百分比，点击展开详情
    （百分比、`~已用 / 窗口`、system / tools / messages 构成）；新会话 / 旧桥显示灰色空环，点击详情给出说明；
    切换会话后跟随，点击面板外 / Esc 关闭。
38. 文件夹引用：气泡里的 `@目录/`（含空格 `@"目录/"`）渲染成文件夹图标 + `目录/` 的 chip；点它 → 左侧文件列表展开该目录（含祖先）并选中、滚动到可见；文件列表没打开时先打开再定位；折叠目录后点击应重新展开。
39. 设置页顶部 5 个 tab（服务 / dsh 版本 / 聊天 / 集成 / 插件）：默认「服务」，重开设置页仍回到「服务」；切 tab 只重绘内容区、tab 条不重建；
    打开设置页不再等 dsh 版本探测，「dsh 版本」首次进入先显示「正在检测 dsh 版本…」；快速连点 tab 不出现串台内容。
40. 设置页「聊天」tab 新增「「@」引用范围」：默认「不启用」，此时 @ 菜单候选与改动前一致、看不到添加栏；切到「白名单 / 黑名单」后下方才出现对应添加栏（标题带当前条数）。
41. 白名单：添加一个文件夹（如 `模板`）→ @ 菜单只保留该文件夹及其子项，其余候选消失；从根目录仍能逐级下钻进白名单里的深层文件夹；白名单为空时只剩「当前笔记」首行。
42. 黑名单：添加 `模板` → @ 菜单不再出现 `模板` 及其子项，其它候选照常；同一路径换写成 `模板/`、反斜杠或重复输入时不会产生重复条目。
43. 添加栏操作：已有路径可逐个移除（计数同步）、非法路径（空 / `..` / 绝对路径）被拒绝、路径不存在时有标记；改完设置不重载插件，下一次打开 @ 菜单即生效；`/` 命令菜单与消息里的短链 / 文件夹 chip 不受影响。
44. 设置页「插件」tab：打开时显示「正在读取 dsh 插件清单…」→ 按 bundle 分组列出组件行（默认全部折叠，标题带版本与「共 N 个组件 · 运行中 / 已停用 / 条件」统计）；
    点分组标题展开 / 收起；筛选框只留命中「名称或 id」的行并自动展开命中的组；顶部「重新读取」跳过缓存重读、「重启服务」重启并重读。
45. 组件行启停：非条件行右侧开关可用，`!!js` 条件行显示「自动」且没有开关；切换后提示「已保存：点「重启服务」后生效」，
    profile 的 `cordis.patch.yml` 出现 / 移除对应 `disabled` 覆盖、旁边生成 `.bak-<时间戳>` 备份；重启服务后该行状态与实际功能同步变化；再次切回后 patch 与改动前一致。
46. 写入失败（profile 只读 / 复验不一致）：设置页显示错误、`cordis.patch.yml` 保持写入前内容（自动回滚）；
    读不出清单时显示原因（dsh 不可用 / profile 不存在 / dump 失败），其它 tab 不受影响。
47. 「插件」tab 顶部「可选 / 实验性插件」卡片：**默认收起**，只显示标题（箭头朝右）与「共 N 个 · 已启用 M 个」；
    点标题（或聚焦后 Enter / 空格）展开，列出官方目录里的可选 bundle（中文标题、包名 · 版本 · 实验性、一行描述、开关），
    再点收起；展开状态下切开关后列表保持展开。目录读不到时显示原因且不影响下方清单。
48. 启用一个可选插件（如「语音输入」）→ `package.json` 的 `dsh.profile.bundles` 增加包名 + 生成 `package.json.bak-时间戳`；
    组合结果立刻多出该 bundle 分组与组件行；点「重启服务」后服务与原生面板正常，关掉再重启可回到原状（`package.json` 与改动前一致）。
49. `ON_DEMAND_BUNDLES`（subagent-claude-code / subagent-codex）只显示「需要先 `dsh plugin add`」的提示，没有开关。
50. 标题随对话（0033）：新建会话发第一条消息 → 标题先变首条消息派生的 fallback，随后（默认首消息 provider）变成模型短标题；面板标题与会话选择器列表**自动**跟随，不用手动刷新；启用「随对话更新的标题」并重启服务后，后续消息按 provider 修订标题；手动重命名仍会钉住标题（DSH 语义，自动更新不再覆盖）。
51. 智能体团队（0035）：设置 → 插件 → 可选 / 实验性插件启用「智能体团队」→ 重启服务 → 新建会话，标题右侧出现 users 图标；点开只读面板显示 lead 一行与「还没有共享任务」，粘住 / 点击外部 / Esc 可关闭。
52. 让 Lead 创建 teammate 并建一条团队任务 → 面板成员与任务数量、状态、负责人、模型标签**实时**更新（不刷新）；任务描述超过两行有「展开 / 收起」；成员等待授权时行左侧出现橙色边、头部有「等待授权」badge、标题图标右上出现橙点。
53. 队友发消息给 Lead → 历史里出现「队友 <name>」消息卡（不是「上下文注入」JSON）；过程行里团队工具显示「创建队友 / 发送消息 / 等待子智能体 / 更新团队任务」等中文标题与参数摘要；停用「智能体团队」并重启后入口消失，普通会话无异常。
54. 设置页「聊天」tab 在「「@」引用范围」之后出现「「/」技能范围」：默认「不启用」（`/` 菜单技能行与改动前一致、看不到添加栏）；切到「白名单 / 黑名单」后下方才出现对应添加栏（标题带当前条数）。
55. 白名单：添加 `office` → `/` 菜单「技能」分组只剩 `office` 与 `office-*` 技能行；白名单为空时技能行全部隐藏，`/new`、`/compact` 仍在；添加栏支持移除（计数同步）、重复 / 非法技能名被拒绝、输入自动转小写。
56. 黑名单：添加 `office` → `office` 与 `office-*` 技能行不再出现、其它技能照常；技能行被全部挡掉且原本有技能时菜单显示「技能行已按「/」技能范围过滤：当前没有可显示技能」，命令与原有说明行正常；改完设置不重载插件，下一次打开 `/` 菜单即生效；`/name` 插入与技能加载 / 调用不受影响。
57. 设置 →「聊天」→ @ / 「/」范围选「白名单」或「黑名单」：添加栏行首出现「选取」；点它弹出可搜索候选（@ 为 vault 文件 / 文件夹、/ 为本地技能目录里的名字），已在名单里或被名单条目覆盖的条目不再出现；点候选只填入输入框并聚焦，仍需「添加」/ 回车提交；候选为空时提示可手动输入（0038）。
58. 设置 →「聊天」tab：@ 与 / 的范围设置各是一张卡片（徽标 @ / + 标题 + 模式下拉 + 说明），选白 / 黑名单后名单详情出现在同一张卡里；切「不启用」详情消失、卡片保留；「选取」/ 添加 / 移除行为不变（0039）。
59. 子智能体（0041）：打开有子代理历史的会话 → 标题右侧出现 bot 图标（无子代理的会话不出现）；点开只读目录，头部显示「N 个」与运行中数量，行内显示模式（可继续 / 一次性 / 未知）、状态、耗时、token 与模型；运行中的行左侧是运行点、等待授权 / 未读有橙点与徽标；团队队友行带「团队」徽标；点击外部 / Esc 关闭。
60. 让模型用 subagent 起一个子代理（或用 subagent_fork）→ 目录无需刷新即出现新行，运行中时图标带数字角标；结束后角标消失、状态转「空闲」或「已完成（未读）」。
61. 点目录行打开子会话 → 正文 / 流式 / 工具行正常；页头出现面包屑「← 父标题 › 标签 + 模式」，团队入口隐藏；点返回按钮回到父会话，标题、模型与团队入口恢复。
62. 可继续（continuable）子会话且父会话在线 → composer 正常输入：发追加指令能收到回复（follow-up 进 child FIFO），运行中 Stop 能中断当前轮；父会话历史里出现「子任务状态更新」卡片（不再是「上下文注入」JSON）。
63. 一次性（one-shot）或类型未知的子会话 → composer 变成只读提示（「只能查看」），没有输入框；父会话不可用且子会话未运行 → 只读；父会话不可用但子会话仍在跑 → 只读提示 + Stop 可用。
64. 子会话里不显示团队图标 / 团队入口；返回父会话后（若启用「智能体团队」）团队图标恢复。
65. 旧桥（v6，或 `ping().methods` 不含 `subagents`）→ 原生面板不显示子智能体入口，消息 / 团队 / 流式等其它功能照常；设置页「桥接状态」显示实际桥版本（v8 时「已连接（v8）」）。
66. 工具行与消息：`subagent` 显示「创建子智能体」、`subagent_fork` 显示「继承上下文创建子智能体」（不再是英文名 + 扳手）；`send_message` / `list_agents` / `interrupt_agent` 显示「发送消息 / 查看子智能体 / 中断子智能体」，非团队场景不再说「协调团队」；展开仍能看到参数 / 结果。
67. 输入框 “/” 命令菜单透传 dsh 命令（0050）：命令组来自当前会话的 `commands()`（ptc 预设下为 `/compact` `/feedback` `/goal` `/permission` `/plan`，`/export` 因桥直连执行不会触发 Web 下载而隐藏；minimal 预设只有 `/compact`），描述中文、第三方命令回退 dsh 英文描述；本地 `/new` 始终在最前；技能分组照旧。
68. 选中 `/goal` → 草稿变成 `/goal ` 且**不执行**；补参数后 Enter → 走 `executeCommand`，时间线出现 command 节点；选中 `/compact` 后 Enter → 出现 manual-compaction 节点且输入框上方有「正在压缩会话历史…」提示；手敲 `/compact` + Enter 同样执行；手敲不存在的 `/xyz` 仍按普通消息发送；`hello\n/compact` 不执行（非 leading）。
69. 设置 →「聊天」第三张卡「命令范围」（⌘ 徽标）：默认不启用、无「添加栏」；白名单添加 `goal` → `/` 菜单只剩 `/goal`（`/new` 与技能仍在）；空白名单 → 命令行全部隐藏 + 说明行；黑名单添加 `goal` → `/goal` 消失、其它命令照常；改完设置不重载插件，下一次打开菜单即生效。
70. 命令范围「选取」（0051）：原生聊天面板打开并选中会话 → 设置 → 聊天 → 命令范围 → 白名单，添加栏行首出现「选取」；点击弹出当前会话命令候选（compact / feedback / goal / permission / plan，export 不列，类型标「命令」）；点候选只回填输入框，仍需「添加」/ 回车；关闭面板后再点「选取」→ 提示需要先打开面板，仍可手输；@ / 技能范围的「选取」不受影响。
71. 同名技能 / 子会话（0050）：技能目录里造一个与 dsh 命令同名的技能 → `/` 菜单不显示该技能行（命令优先）；打开 subagent 子会话 → 不显示命令组（与官方 Web 一致）。
72. 目标条（0052）：在原生输入框敲 `/goal <objective>` + Enter → **输入框上方**（0054 起在运行提示下方）出现目标条：目标图标 + 「进行中的目标」+ 单行目标正文 + 右侧图标动作；点暂停 → 「已暂停的目标」+ 恢复按钮；点恢复 → 回到「进行中的目标」；点编辑 → 条内 textarea（多行随内容长高、6 行后框内滚动；Shift+Enter 换行、Escape 取消、Enter 保存、中文 IME 组合期 Enter 不保存）；点清除 → 条消失；重载面板 / 切走会话再切回 → 条按当前会话恢复。
73. 目标条降级（0052）：目标 complete 或会话无目标 → 不显示目标条；旧桥（v7，或 `ping().methods` 不含 `goal`）→ 完全不显示目标条，消息 / 流式 / 命令 / 团队 / 子智能体照常；profile 缺 dsh goal 插件 → 条不出现，强行点动作时错误文案在条内 `role="alert"` 显示（不弹 Notice）。
74. 目标条不闪烁（0053）：使用 goal 且自动续跑时，Obsidian 窗口不再持续闪烁，输入框上方只有一条目标条（不出现「半透明残影 + 实条」双份）；目标条为实色卡片（主题底 + 1px 描边 + 阴影，无模糊底），暂停 / 恢复 / 编辑 / 清除照常。
75. 目标条位置（0054）：运行中「深度求索中」运行提示在目标条**上方**，目标条紧贴输入卡；运行提示每轮出现 / 消失时目标条不被顶开、与输入卡间距不变；无运行提示时目标条仍是输入卡正上方一张卡，无目标时不占位。
76. 结束后台 dsh（0056）：端口上有遗留 dsh 时（状态条「需手动结束」）→ 设置 →「服务」→ 点「结束」→ 按钮「结束中…」、两个按钮都禁用、行下「正在结束后台 dsh… N.Ns」→ 结果 `HH:mm:ss · 已结束后台 dsh（PID …，用时 N.Ns）`、状态栏 `DSH: 已结束`、`lsof -nP -iTCP:<port> -sTCP:LISTEN` 无输出；同机 3082 等其它同 profile 实例仍在；再点「重启」→ `DSH: 运行中`。
77. 桌面 App 内置 dsh（0057）：装好 DeepSeek Harness 桌面端（macOS /Applications 或 Windows `%LOCALAPPDATA%\Programs`）→ 设置 →「dsh 版本」多出一项，路径是 App 根目录、版本与 App 内置 dsh 一致；选中它 →「重启服务」→ 控制台路径为 App 根目录、原生面板正常收发；`lsof -nP -iTCP:<port> -sTCP:LISTEN` 的进程是 App 的 Electron 可执行文件；改回「自动」后仍走原来的默认安装。
77. 结束 / 重启的就地反馈（0056）：点「重启」→ 按钮「重启中…」、行下「正在重启 dsh 服务… N.Ns」→ 结果 `HH:mm:ss · 服务已重启（端口 …，用时 N.Ns）`，设置页不再弹 Notice；端口上是别的程序时「结束」给出「被其他程序占用（不是 dsh）」+ 换端口建议且**不杀**该进程；从命令面板「重启 DSH 服务」→ 先出现「DSH：正在重启服务…」，结束后换成结果 Notice。
78. 选区引用（0058）：编辑区选中一段文字 → 点右栏输入框，输入框上方出现引用预览条（笔记名 / 行范围 / 摘录）；发送后气泡里是引用卡（竖线 + 笔记名 + 行范围 + 两行摘录，不是 blockquote），正文照旧 Markdown；点引用卡 → 主区打开 / 切到该笔记、选中原范围并高亮，聊天面板留在右栏；刷新面板 / 重启服务后同一条引用仍可点击（引用随消息文本落库）。
79. 选区引用边界（0058）：不选文字 / 只读子会话 / 草稿以 `/` 开头发送 → 不显示预览、不加引用；点预览条 × 后同一选区不再自动带回、改选区后重新出现；面板空白处点击不抢编辑区焦点（消息正文与输入框保持原行为，仍可选词复制）；设置 →「聊天」→ 选区引用摘录上限改成 100 → 发送超长选区时消息里带「…（已截断，共 N 字）」，行号范围仍完整。
80. 选区预览实时化（0059）：在编辑区拖选文字（不点右栏）→ 右栏输入框上方立即出现预览条；改选别的行 → 预览跟着变；点编辑区空白折叠选区 → 预览消失；重新选中同一段 → 预览恢复；点输入框后预览保留；点 × 后同一段隐藏、折叠后重选恢复；切换会话不影响预览（预览只反映编辑区当前选区）。
81. 引用预览条可点击（0060）：选中文字出现预览条 → 点预览条主区域 → 主区打开 / 切到笔记、选中原范围并高亮、焦点到编辑区，预览条保留；点 × 只取消本次引用（不跳转、不动选区）；键盘 Tab + Enter / Space 同样能跳转。
