# 路线图

> 当前版本 **1.1.0**（以 [manifest.json](../manifest.json) 为准）· 方案 B 已可用 · 最后更新 2026-10-28

## 现状一句话

插件在 Obsidian 右侧面板提供**原生 React 聊天界面**，并自动拉起一个带**独立 profile（obsidian）+ 独立端口**的 dsh 服务，工作目录是当前 vault。
0.4.0 起删除可见的官方 Web GUI 面板（[0008](changes/0008-native-only-surface.md)）：原生面板内部保留一个离屏的官方 core webview 作为数据源；**只支持 dsh 0.2.x**（[0007](changes/0007-drop-legacy-and-migrate-bridge.md)）。
dsh 版本选择（[0003](changes/0003-dsh-version-selection-and-token-auth.md)）、webview 承载（[0004](changes/0004-webview-embedding.md)）与原生聊天 Phase 1（[0006](changes/0006-native-chat-panel.md)）已完成；bridge 插件已迁入本仓库 `packages/`，流式输出（[0017](changes/0017-native-streaming.md)）与 Agent Teams 只读团队面板（[0035](changes/0035-agent-team-support.md)）已落地。
**2026-10-27 起主线切换为「边用边改」**：插件进入真实使用阶段，后续起点是使用中提出的需求，不再按预设里程碑排期；未完成的 M3 / M5 余项转入候选池（见下一节）。

## 主线：边用边改（2026-10-27 起）

> 后续主线不是预先排好的里程碑，而是**你在真实使用中提出的需求**：用起来缺什么、哪里别扭、想加什么能力，随时提。M0–M7 作为已完成的历史阶段保留在下方；M3 / M5 余项进入候选池，等使用中触发再启动。

每个需求的固定流程（硬规则见 [AGENTS.md](../AGENTS.md) 规则 12、13）：

1. **登记**：你提出需求（一句话即可）→ 我在下面「需求待办」加一行（编号 `R-<n>`，状态 `待调研`），并在 `docs/changes/` 建一份 `draft` 提案；两边互相引用。
2. **调研路径**：我把实现路径写进提案的「实现路径调研」小节（≥ 2 条可行路径，含推荐与改动面 / 代价 / 风险对比），再把选项直接问你。
3. **你选路**：你确认走哪条路径 → 提案改 `approved` → 我按提案执行。
4. **收尾**：补「实施记录」，提案改 `done`，本表该行改成 `✅ 已完成` 并附日期。

### 需求待办

| 编号 | 需求 | 状态 | 提案 |
|---|---|---|---|
| R-1 | 主线改为「边用边改」：需求先登记 + 先比路径再执行 | ✅ 已完成（2026-10-27） | [0018](changes/0018-usage-driven-workflow.md) |
| R-2 | 原生聊天面板融入右栏：去掉白底卡片与外圈间隙 | ✅ 已完成（2026-10-27） | [0019](changes/0019-native-panel-fullbleed.md) |
| R-3 | 过程行（含折叠层内思考 / 工具行）默认 / hover 底色互换：默认浅色叠加、hover 实心 | ✅ 已完成（2026-10-27） | [0020](changes/0020-process-row-background-swap.md) |
| R-4 | 流式输出刷新节奏可调：设置里在「逐字 / 每帧 / 平衡 / 省电」间自由切换，解决出字一跳一跳 | ✅ 已完成（2026-10-27） | [0021](changes/0021-stream-refresh-mode.md) |
| R-5 | 发送按钮左侧加当前上下文占用圆环：只显示圆环，点击查看详情 | ✅ 已完成（2026-10-27） | [0022](changes/0022-context-usage-meter.md) |
| R-6 | 输入框 @ 触发项目文件下拉菜单（参考 dsh）；当前笔记改为默认不引用、作为 @ 列表第一项「当前笔记」 | ✅ 已完成（2026-10-27） | [0023](changes/0023-at-file-mentions.md) |
| R-7 | 文件夹引用：Enter 采纳（@文件夹）、Tab / 箭头下钻；消息里的 @文件夹 渲染成可点击 chip，点击在左侧文件列表展开并选中 | ✅ 已完成（2026-10-27） | [0024](changes/0024-folder-references.md) |
| R-8 | 输入框 `/` 命令菜单：new 新建对话 / compact 压缩 / skills 列表（参考 dsh 的斜杠菜单） | ✅ 已完成（2026-10-27） | [0025](changes/0025-slash-commands.md) |
| R-9 | 输入框横向稍微加宽：卡片比正文文字列各外扩 11px，卡内文字仍与正文左边界对齐 | ✅ 已完成（2026-10-27） | [0026](changes/0026-composer-wider.md) |
| R-10 | 设置面板按模块拆分：参考截图改成顶部 tab（服务 / dsh 版本 / 聊天 / 集成），不再单页平铺 | ✅ 已完成（2026-10-27） | [0027](changes/0027-settings-panel-modules.md) |
| R-11 | 输入框整卡的鼠标悬停高亮在浅色主题下不可见：hover 底色 token 与卡片底色同值（深色主题才看得见）；追补：浅色填色「变暗」，改为描边 + 浮起阴影 | ✅ 已完成（2026-10-27） | [0028](changes/0028-composer-hover-highlight.md) |
| R-12 | 聊天正文（用户气泡 + 助手输出）字号稍微调小：比面板基准小 1px（15 → 14px），流式与收尾同字号 | ✅ 已完成（2026-10-27） | [0029](changes/0029-chat-content-smaller-font.md) |
| R-13 | @ 文件引用的检索范围：设置页「聊天」tab 三档（不启用 / 白名单 / 黑名单）+ 选中后展开黑白名单添加栏 | ✅ 已完成（2026-10-27） | [0030](changes/0030-mention-scope.md) |
| R-14 | 插件管理：设置页新增单独 tab，参考 dsh 的「插件」管理面板，在 Obsidian 里查看 / 启停 dsh 侧插件（路径 B） | ✅ 已完成（2026-10-27） | [0031](changes/0031-plugin-management-tab.md) |
| R-15 | 「插件」tab 补上官方「实验性 / 可选插件」：列出 optional bundle 并可在面板里启用 / 停用（写 profile 的 dsh.profile.bundles） | ✅ 已完成（2026-10-27） | [0032](changes/0032-optional-bundles.md) |
| R-16 | 新会话标题不再被 rename 钉成「新会话」：发消息后由 DSH 生成、启用「随对话更新的标题」后随之更新，面板列表跟随 | ✅ 已完成（2026-10-27） | [0033](changes/0033-session-title-auto-update.md) |
| R-17 | 「插件」tab 的「可选 / 实验性插件」默认收起，点标题才展开（复用 bundle 折叠头交互） | ✅ 已完成（2026-10-27） | [0034](changes/0034-collapse-experimental-plugins.md) |
| R-18 | 原生面板支持 dsh「智能体团队」（Agent Teams）插件：只读团队面板（roster + 任务板）、团队工具行、队友消息卡片 | ✅ 已完成（2026-10-27） | [0035](changes/0035-agent-team-support.md) |
| R-19 | 过程行按正文分界拆分：一轮里正文前后的思考 / 工具调用各自成栏，不再全部塞进第一条、正文也不再全排到后面 | ✅ 已完成（2026-10-27；build/check + 19 项合成冒烟 + CDP 实测） | [0036](changes/0036-process-segments.md) |
| R-20 | skills 的 / 命令也加 @ 同款白名单 / 黑名单：设置页「聊天」tab 三档 + 按技能名过滤菜单里的技能行，不影响技能加载 | ✅ 已完成（2026-10-27；build/check + 28 项纯函数冒烟 + CDP 实测） | [0037](changes/0037-skill-slash-scope.md) |
| R-21 | 设置页白 / 黑名单添加栏：在「添加」按钮左侧加「选取」按钮，自动获取符合条件的候选（vault 路径 / 技能名）并点选填入 | ✅ 已完成（2026-10-27；build/check + 纯函数/服务冒烟 + CDP 实测） | [0038](changes/0038-scope-picker.md) |
| R-22 | 设置页「聊天」tab：@ 与 / 的范围设置与其白 / 黑名单详情各收进一张带徽标的卡片，一眼看出名单归属 | ✅ 已完成（2026-10-27；build/check + CDP 实测 + 截图） | [0039](changes/0039-scope-settings-cards.md) |
| R-23 | 范围卡片标题去掉与徽标重复的「@」「/」：只留「引用范围」「技能范围」 | ✅ 已完成（2026-10-27；build/check + CDP 实测 + 截图） | [0040](changes/0040-scope-card-title.md) |
| R-24 | 原生面板支持 dsh「子智能体（subagent）」：子代理列表 / 树与状态、打开子会话看正文、可继续子代理续聊与 Stop | ✅ 已完成（2026-10-27；build/check + CDP 实测） | [0041](changes/0041-subagent-support.md) |
| R-25 | 子智能体浮层显示优化：纵向随内容变高（上限 72% 视口），长模型名换行、去掉横向滚动条 | ✅ 已完成（2026-10-27；build/check + CDP 实测 + 截图） | [0042](changes/0042-subagent-panel-layout.md) |
| R-26 | 提问卡片对齐官方：单题一屏 + 底部左右翻页（`‹ n/N ›`）、翻页保留草稿可回改、`跳过` / `提交` 与未答校验；字号 / 间距 / 复选框 /「推荐」徽标按官方重排 | ✅ 已完成（2026-10-27；build/check + CDP 端到端实测） | [0043](changes/0043-question-card-pager.md) |
| R-27 | 把 dsh 侧栏插件入口迁移到 Obsidian：ribbon / 命令列出全局面板，点击在中栏用可见 webview 渲染 dsh 插件页面（桥 v8 的 panels / openPanel） | 等你选路 | [0044](changes/0044-dsh-plugin-panels-in-obsidian.md) |
| R-28 | 提问工具在消息流里的渲染修复：上下文类卡片被上下文圆环的 24×24 规则压扁（JSON 逐字竖排）、`question-reply` 节点退化成原始 JSON | ✅ 已完成（2026-10-28；build/check + CDP 实测） | [0045](changes/0045-timeline-context-render.md) |
| R-29 | 原生面板对「模型只返回思考、没有正文/工具调用」的静默结束做兜底：提示本轮未产出内容 + 一键重试（发送「继续」；不改 dsh 源码） | ✅ 已完成（2026-10-28；build/check + 12 项纯函数冒烟 + CDP 端到端） | [0046](changes/0046-silent-turn-end-hint.md) |
| R-30 | 输入框上方左对齐加 dsh 同款运行提示：鲸鱼尾 +「深度求索中，用时 N秒 ···」，逐秒刷新、浅深主题配色 | ✅ 已完成（2026-10-28；build/check + 纯函数冒烟 + CDP 实测） | [0047](changes/0047-dsh-run-status.md) |
| R-31 | 运行提示位置可设置：默认输入框上方，可改为一直在输出最下方（左对齐、随对话滚动） | ✅ 已完成（2026-10-28；build/check + 归一化冒烟 + CDP 实测） | [0048](changes/0048-run-status-placement.md) |
| R-32 | 运行提示文字微光方向反了、循环卡顿：改成 dsh 同款的「高光左 → 右」遮罩扫光 | ✅ 已完成（2026-10-28；build/check + CDP 动画采样） | [0049](changes/0049-run-status-shimmer-sweep.md) |
| R-33 | 「/」菜单命令改为透传 dsh 自身命令目录（commands），并加与技能同款三档白 / 黑名单（只影响菜单显示） | ✅ 已完成（2026-10-28；build/check + 40 项纯函数冒烟 + CDP 实测） | [0050](changes/0050-dsh-command-passthrough.md) |
| R-34 | 命令范围补「选取」按钮：从当前会话 dsh 命令目录取候选（需原生面板打开），点选填入添加栏 | ✅ 已完成（2026-10-28；build/check + 7 项纯函数冒烟 + CDP 实测） | [0051](changes/0051-command-scope-picker.md) |
| R-35 | 为 goal 命令加一个悬浮窗口放在输入框上方，样式参考 dsh 官方（目标条：阶段标签 / 单行目标 / 暂停 / 恢复 / 编辑 / 清除，桥 v8） | ✅ 已完成（2026-10-28；build/check + CDP 实测） | [0052](changes/0052-goal-bar.md) |
| R-36 | 使用 goal 后目标条在 Obsidian 里持续闪烁 / 出现残影（半透明模糊底 + 每轮运行提示位移导致窗口反复重合成） | ✅ 已完成（2026-10-28；build/check + 用户确认无闪烁） | [0053](changes/0053-goal-bar-flicker.md) |
| R-37 | 目标条要始终显示在运行提示（深度求索中）下方、紧贴输入框，避免被每轮运行提示顶动 | ✅ 已完成（2026-10-28；build/check + CDP 实测） | [0054](changes/0054-goal-bar-below-run-status.md) |
| R-38 | 上架 Obsidian 官方社区目录：manifest 合规（id `dsh-native-chat` / name `DSH Native Chat` / 英文描述 / minAppVersion 1.7.2）+ 清零官方 ESLint error + README 政策披露 + 发布 1.0.0 | ✅ 已完成（2026-10-28；build/check + lint 0 error + release v1.0.0；目录提交待用户在网页完成） | [0055](changes/0055-obsidian-community-directory.md) |
| R-39 | 设置页新增「结束后台 dsh」按钮（结束遗留实例，不必再手动 pkill）+「重启服务」改为就地进度 / 结果反馈 | ✅ 已完成（2026-10-28；build/check + 35 项服务冒烟 + CDP 实测） | [0056](changes/0056-dsh-stop-button.md) |
| R-40 | 支持使用桌面 App 内置的 dsh：设置页「dsh 版本」能检测到 macOS / Windows 桌面 App 安装，并只用 App 的可执行文件拉起插件自用的 dsh | ✅ 已完成（2026-10-28；build/check + 原生 app 端到端冒烟 + Windows 路径逻辑断言） | [0057](changes/0057-desktop-app-dsh.md) |
| R-41 | 编辑器选区引用：发送时自动带上「当前笔记 + 选中文本」，气泡以微信式引用卡渲染；点击引用跳回笔记、选中并高亮原选区；同时处理右栏聊天改变编辑区焦点的问题 | ✅ 已完成（2026-10-28；build/check + 11 项纯函数冒烟 + CDP 实测） | [0058](changes/0058-selection-quote.md) |
| R-42 | 选区引用预览实时化：编辑区里选中文字时右栏立即显示/更新引用预览，不用先点输入框 | ✅ 已完成（2026-10-28；build/check + CDP 实测） | [0059](changes/0059-live-selection-preview.md) |
| R-43 | 引用预览条可点击：点输入框上方的预览条与点消息内引用卡一致，跳回笔记并选中高亮原选区（× 仍只取消本次引用） | ✅ 已完成（2026-10-28；build/check + CDP 实测） | [0060](changes/0060-quote-preview-clickable.md) |
| R-44 | 发布 1.1.0：把 0056–0060 的改动提交并推送到 GitHub，Releases 页面只写版本更新内容 | ✅ 已完成（2026-10-28；build/check/lint + push + release v1.1.0） | [0061](changes/0061-release-1.1.0.md) |
| R-45 | 引用预览条上面那层更亮的底色去掉、改统一颜色（与输入卡同色），条内按钮默认亮底不再露出，双引号图标离底边留点空隙 | ✅ 已完成（2026-10-28；check + CDP 计算样式与截图对比） | [0062](changes/0062-quote-preview-unified-background.md) |

> 新需求往下追加，编号连续（R-2、R-3…），不要删旧行。状态取值：`待调研` → `等你选路` → `执行中` → `✅ 已完成` / `⏸ 暂缓`。

### 候选池（等需求触发）

| 项 | 说明 | 原属 |
|---|---|---|
| 会话 / 回复写入 vault 笔记 | 面板里把当前会话或某条回复导出成 Markdown（含会话 id / 模型 / 时间 frontmatter） | M3 |
| 最小 CI + 发布 | GitHub Actions 跑 build + check；发布三件套并提交社区插件目录 | M5 |
| 人工确认遗留项 | 真 IME 组合输入、视觉细节、popout 窗口下的浮层定位 | M4 |

## 里程碑

| 阶段 | 目标 | 状态 |
|---|---|---|
| M0 方案 A | iframe 嵌入完整 GUI（历史；已被 webview 取代） | ✅ 完成 |
| M1 方案 B | 自动拉起独立服务（profile / 端口 / vault cwd）+ 设置页 + 状态栏 + 重启命令 | ✅ 完成 |
| M2 稳定性 | 服务自愈、重启无竞态、就绪探测可信、版本与文档一致、locator 版本可见 | ✅ 完成 |
| M3 数据互通 | postMessage 导出桥：会话/回复写入 vault 笔记 | ⏸ 候选池（等需求触发） |
| M4 方案 C | Obsidian 原生聊天视图；删除可见官方面板，保留隐藏 core | ✅ 完成（0006 + 0008；视觉/IME 待人工确认） |
| M5 工程化 | git 基线、CI、发布到社区插件目录 | 🚧 部分完成（git + pre-commit 就绪；CI / 发布转候选池） |
| M6 结构重构 | src 按职责域分层（service / view / settings / shared），纯搬运不改行为 | ✅ 完成 |
| M7 Obsidian 入口 | ribbon/命令新建会话 + 单栏常开 + 只用 vault 项目（dsh 侧桥，已迁入本仓库；单栏随 0008 不再调用） | ✅ 完成（待人工确认） |

> M0–M7 是历史阶段，不再是后续主线；M3 / M5 未完成项见上一节「候选池」，等真实使用中的需求触发再启动。

## M2 稳定性（优先）

> 两条提案均已落地：[0001](changes/0001-m2-stability-fixes.md)（M2-1 ~ M2-4、M2-6）、[0002](changes/0002-m2-locator-version-visibility.md)（M2-5）。立项与实施一律走「先提案后改码」。

1. **服务起来后承载面自动加载** ✅ 已完成（2026-10-26）
   原问题：`onOpen` 先设承载面地址再拉起服务；服务就绪后只更新状态条文案，承载面停在 Chromium 错误页，必须关掉面板重开。
   处理：`DshSurface.reload()`（webview 用 `loadURL` 重新导航；iframe 分支已由 0007 移除）+ view 记录 `surfaceReady`，服务就绪且尚未成功加载时自动重载一次。
   验收：从「服务未运行」到「原生面板显示会话」全自动（需在 Obsidian 里手动确认一次）。
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
- 处理：stdout 整行解析 `dsh web:` 作为 0.2.x 就绪信号与承载面地址（token 打码进日志）；探测扩为四态
  （`running/auth/foreign/down`）；设置页新增「dsh 版本」下拉（自动 / 检测到的安装）+「重新检测」；
  显式选择后不再弹版本冲突 Notice；遗留的 0.2.x 实例提示手动结束。0.1.1 兼容当时保留，**2026-10-26 已由 0007 移除**。
- 验收：双版本手动回归（当时）；0007 后只测 0.2.x。
- **剩余人工确认**：Obsidian 内验证 0.2.x 版本切换与遗留实例提示（面板加载见下一节 0004）。

## M2 后续（2）：0.2.1 webview 承载 ✅ 已完成（2026-10-26）

> 提案：[docs/changes/0004-webview-embedding.md](changes/0004-webview-embedding.md)。

- 问题：0.2.1 的会话 cookie 是 `SameSite=Strict`，面板 iframe 在 `app://obsidian.md` 顶层下属于跨站，
  token 登录 303 后不带 cookie → 401；0003 的 token 已就绪，但 iframe 承载不了。
- 处理：面板改用 Electron `<webview>`（0004 当时与核心 Web viewer 共用 `persist:vault-<appId>` 分区；
  **0008 后仅隐藏 core 使用专用 `persist:dsh-obsidian`**）；当时能力探测失败会回退 iframe ——
  0.2.x 的 token 在跨站 iframe 里不可用，**0007 已移除回退**。
- 验收：`npm run build` 可复现；Obsidian 内 0.2.x 面板加载待人工确认。
- **剩余人工确认**：面板加载、重启后 token 更新；0.1.1 与 iframe 已由 0007 移除。

## M3 数据互通（候选池；postMessage 导出桥）

> 已转入候选池：等使用中真的需要「把会话 / 回复写进笔记」时，按「需求待办 + 路径调研」重新启动，不预先排期。

- 目标：在面板里把当前会话/某条回复写进 vault 笔记（可指定目标笔记或 daily note）。
- 思路：dsh 侧客户端插件在 GUI 里暴露导出事件（`window.postMessage`），Obsidian 侧插件监听后调用 Vault API 落盘。
- 验收：面板点「导出」→ vault 出现对应 Markdown，含 frontmatter（会话 id、模型、时间）。
- 依赖与风险：需要 dsh 客户端侧配合；`dsh-obsidian-bridge` 已在本仓库 `packages/`，其余客户端插件仍在外部仓库（如 `~/dsh-plugin`）维护。

## M4 方案 C：Obsidian 原生聊天界面

> 原生聊天提案：[0006](changes/0006-native-chat-panel.md)（done 2026-10-26）：官方 DSH core（ChatSnapshot / 会话动作 / 审批提问）+ Obsidian 原生 UI；数据桥合并在 `packages/dsh-obsidian-bridge` v2，不新建插件。

- ✅ Phase 0（2026-10-26）：bridge v2（listSessions / subscribe / snapshot / nextEvent / send / cancel / loadOlder / approvalAnswer / questionAnswer）+ 隐藏 webview 自检视图；真实 Obsidian 内已确认订阅、快照与发送（新建会话绕开单写者）。
- ✅ Phase 1（2026-10-26）：React 原生聊天 UI（消息、工具卡、输入、模型/权限、当前笔记、审批/提问、会话浮层、重命名）；桥增补 models / selectModel / permissions / setPermission / renameSession。
  实测修正：模型目录走 `modelDirectories`（`connection.api.sessions` 在 0.2.1-rc.3 不可用）；权限投影只带 currentValue 时用内置预设；原生 `Menu` 在右栏不挂载，改成自绘浮层。
- ✅ 原生-only（2026-10-26，[0008](changes/0008-native-only-surface.md)）：删除可见 `dsh-web` 面板与相关入口，原生面板成为唯一入口；隐藏 core 改用插件专用 `persist:dsh-obsidian` 分区；旧 leaf 自动迁移；命令重启会重载隐藏 core。
- ✅ CDP 回归（2026-10-26）：发送/流式、模型与 effort 切换、权限切换与二次确认、审批「允许一次」、停止、当前笔记 `@路径`、重命名、关闭重开，见 [0006 实施记录](changes/0006-native-chat-panel.md#phase-1-cdp-回归2026-10-26obsidian-1144--dsh-021-rc3)。
- ✅ 0008 CDP 回归（2026-10-26）：native-only 入口、专用分区、桥 v2、关闭重开、命令重启恢复、旧 leaf 迁移/去重、新建会话与发送，见 [0008 实施记录](changes/0008-native-only-surface.md#9-实施记录)。
- ✅ 聊天栏打磨（2026-10-26，[0009](changes/0009-native-chat-ui-polish.md)）：会话按 vault（含子目录）过滤；模型 / 权限浮层锚定触发按钮并在边缘内收 / 翻转；权限 chip 改图标；模型菜单两级（悬停出思考层级）；DeepSeek chip 用官方鲸鱼 logo + 层级；标签页 / ribbon 换成 DSH 鲸鱼图标，显示名改为 DeepSeek Harness；0.4.1。
- ✅ 消息引用（2026-10-27，[0015](changes/0015-note-references.md)）：发送前缀改成 `[[文件名]]`；历史 `@路径` 渲染成短链接；`[[…]]` 点击在**主区新标签**打开，聊天面板保留。
- ✅ 过程行折叠（2026-10-27，[0016](changes/0016-process-fold-rendering.md)）：思考 / 工具调用默认一行，点击展开；修收尾后工具内容消失（hidden 节点兜底）。
- ✅ 流式输出（2026-10-27，[0017](changes/0017-native-streaming.md)）：根因是隐藏 core 的 rAF 被节流导致官方 UI 要等 3 帧；桥 v3 改为直接订阅 `SessionBinding.eventSource`，`nextEvent` 携带 live tail（正文 / 思考 / 工具参数），不再依赖 rAF；旧桥软降级。
- ⬜ 人工确认：真 IME 组合输入、视觉细节、popout 窗口下的浮层定位；见 [development.md](development.md#现状与手动回归) 1–43。

- 目标：用 ItemView + Obsidian 原生组件实现聊天 UI；可见层不再有官方 Web GUI（0008 已完成），但内部仍保留隐藏 core。
- 零 webview（彻底不加载官方页面）需要重写 DSH 客户端核心：会话装配、投影、审批、模型目录都依赖未公开 API；投入远大于 M2/M3，暂不做。
- 模型/凭据配置入口随官方面板删除后，只剩 obsidian profile 的 `cordis.patch.yml`；原生面板内没有 provider/API key 表单。

## M5 工程化与发布

- ✅ `git init` 建立基线（2026-10-26；`main` 分支 + 首次提交）。
- ✅ 提交前检查（2026-10-26）：`npm run check` + `scripts/githooks/pre-commit`（版本三处一致、无运行时依赖、`tsc`、`main.js` 与源码构建一致、暂存集禁入 `.DS_Store` / `data.json` / 缓存）。
- ✅ 0.3.0（2026-10-26）：只支持 dsh 0.2.x，移除 0.1.1 / iframe 兼容，bridge 插件迁入 `packages/dsh-obsidian-bridge/`（[0007](changes/0007-drop-legacy-and-migrate-bridge.md)）。
- ✅ 0.4.0（2026-10-26）：删除可见官方面板，只保留原生聊天；隐藏 core 改用专用分区（[0008](changes/0008-native-only-surface.md)）。
- ✅ 0.4.1（2026-10-26）：原生聊天栏打磨（[0009](changes/0009-native-chat-ui-polish.md)）。
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
- 处理：新增 dsh 客户端插件 `dsh-obsidian-bridge`（现已迁入本仓库 `packages/dsh-obsidian-bridge/`）：
  解析 vault 工作区、`newSession()`、CSS 零化左右轨道 + 收起 store；插件侧新增 `view/bridge.ts`（已由 0008 删除）、ribbon/命令
  「新建 DSH 会话」、设置页「Obsidian 集成」状态。
- 验收：见提案第 7 节；**待人工确认**：新建会话落在 vault、未装桥时降级。单栏常开 / 跨栏收回已随 0008 删除官方面板而不再适用。

## 0010 入口收敛与 0011 清理（2026-10-26）

- ✅ 0010：功能区 / 命令面板各只留一个「打开 DeepSeek Harness」；删除 `new-dsh-session` 命令、`newDshSession()` 与随之为空的 actions 通道（[0010](changes/0010-command-entry-consolidation.md)）。
- ✅ 0011：删 `serviceUrl` / `resolveDshCommand` / `diagnose()` 三个无调用方导出、收敛 7 处错误文案、拆 `menus.tsx` 与 `timeline.tsx`、删桥插件 v1 段（[0011](changes/0011-redundancy-cleanup.md)）。

## 非目标（当前阶段明确不做）

- **移动端支持**：插件依赖 `child_process` / Node API，保持 `isDesktopOnly: true`。
- **一个 Obsidian 实例托管多个 dsh 服务**：只支持单实例、单端口。
- **自建代理或改写 dsh 前端**：优先走 dsh 官方插件机制（bundle / cordis patch）。
- **替代 dsh GUI**：原生面板只负责聊天，不做文件浏览器/编辑器或 DSH 设置页的替代实现。

## 风险与依赖

| 风险 | 影响 | 应对 |
|---|---|---|
| dsh 升级改了前端 CSS Modules 哈希 / bundles 接口 | 面板布局插件（`dsh-ui-obsidian-layout`）失效、profile 启动失败 | 升级后回归面板布局；profile 的 bundles 保持 `dsh-base + dsh-web-app` 最小集 |
| 插件用符号链接安装 | 运行时设置 `data.json` 落在本仓库里，误删会丢端口配置 | 改端口后用「重启服务」验证；`data.json` 视为运行时数据，不入版本库 |
| Obsidian 从 Finder 启动时 PATH 精简 | 找不到 dsh / node | `buildEnv` 前置候选目录；兜底可用 node 直跑 `bin.js` |
| 通过隧道/公网访问 | dsh 拒绝非 loopback Host | dsh 侧配 `--trusted-host` |
| profile 的 `cordis.patch.yml` 只有注释、没有 `[]` | dsh 启动直接报错（必须顶层 YAML 数组），面板永远起不来 | 文件末尾补一行 `[]`；见 [troubleshooting](troubleshooting.md) |
| 全局安装的 dsh 版本落后于 checkout | 行为/API 与文档不一致，报错来自旧代码 | 启动日志打印实际路径/版本，冲突时有警告日志 + 一次 Notice；设置页「dsh 版本」可直接切换（0003） |
| dsh 0.2.x 的 token 鉴权 | 裸 URL 401、遗留实例无法接管 | 插件从 stdout 读就绪 URL 交给隐藏 core；遗留实例提示手动结束；重启命令会自动重载隐藏 core |
| Obsidian 收紧 webviewTag | 原生面板无法取数 | 隐藏 core 仍依赖 webview；不可用时明确报错，需升级 Obsidian |
| 官方面板删除后没有设置页 | 模型 / 凭据只能改 profile 文件 | 原生面板「配置说明」给 Notice；文档给出 `cordis.patch.yml` 片段 |

## 维护规则

- 状态变化只改本文件（必要时同步 [docs/README.md](README.md) 索引），**不要**在根 README 复制路线图清单。
- **用户提出需求**：先在「需求待办」加一行（`R-<n>`）并建 `docs/changes/` 提案，两边互链；调研完路径先问用户选哪条，选路前不改代码。
- 新需求按 R 编号连续追加；不删旧行，完成 / 暂缓只改状态。提案编号另按 `docs/changes/` 的 `NNNN` 递增。
- 新增里程碑按 M6/M7 续编号，必须写「验收标准」，否则不算可交付项；当前阶段不再主动新增里程碑，需求走「需求待办」。
- 已完成项保留在表里（历史可查），不要删除。
