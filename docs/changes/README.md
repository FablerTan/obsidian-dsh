# 变更提案（改代码前必须写）

本目录存放**代码改动前**的提案。硬规则见 [AGENTS.md](../../AGENTS.md) 第 12、13 条：

> 用户提出的每个需求：先在 [roadmap](../roadmap.md)「需求待办」登记一行，**再在这里写提案（含 ≥ 2 条实现路径对比）→ 用户选路并确认（status: approved）→ 再严格按提案执行**。

每个需求同时对应 roadmap 的 `R-<n>` 和本目录的 `NNNN`，两处互相引用；**选路前不要改代码**。

## 命名与索引

文件名 `NNNN-<kebab-slug>.md`，四位编号递增，**不复用、不删除**（被否也保留，状态改 rejected）。

| 编号 | 提案 | 状态 |
|---|---|---|
| [0001](0001-m2-stability-fixes.md) | M2 稳定性：iframe 自愈 / 重启竞态 / 可信探测 / 版本一致 | ✅ 已完成 |
| [0002](0002-m2-locator-version-visibility.md) | M2-5：locator 版本可见性（实际路径/版本日志 + 冲突提示） | ✅ 已完成 |
| [0003](0003-dsh-version-selection-and-token-auth.md) | dsh 版本选择 + 0.2.1 token 鉴权支持（删除 0.1.1 的前置） | ✅ 已完成 |
| [0004](0004-webview-embedding.md) | 用 Electron `<webview>` 替换 iframe（解决 0.2.1 SameSite=Strict cookie 401） | ✅ 已完成（待人工确认） |
| [0005](0005-obsidian-native-surfaces.md) | 用 Obsidian ribbon/命令 + dsh 桥收敛 DSH 左栏（新建会话 / 单栏常开 / 只用 vault 项目） | 🚧 已实施，待人工确认 |
| [0006](0006-native-chat-panel.md) | 原生聊天面板：官方 DSH core + Obsidian 原生 UI（方案 A；桥合并进 dsh-obsidian-bridge v2） | ✅ 已完成（CDP 回归通过，视觉/IME 待人工确认） |
| [0007](0007-drop-legacy-and-migrate-bridge.md) | 只支持 dsh 0.2.x：移除 0.1.1 / iframe 兼容 + bridge 插件迁入本仓库 | ✅ 已完成（待人工确认） |
| [0008](0008-native-only-surface.md) | 只保留原生聊天面板：删除可见的官方 webview 面板，隐藏 core 改用专用分区 | ✅ 已完成（构建/检查 + CDP 回归通过；IME 待人工确认） |
| [0009](0009-native-chat-ui-polish.md) | 原生聊天栏打磨：按 vault 过滤会话 / 浮层锚定 / 权限图标 / 模型二级菜单 / DeepSeek 官方鲸鱼标签与面板图标 | ✅ 已完成（构建/检查 + CDP 回归通过；视觉待人工确认） |
| [0010](0010-command-entry-consolidation.md) | 入口收敛：功能区 / 命令面板各只留一个“打开 DeepSeek Harness”（删新建会话命令与 actions 通道） | ✅ 已完成（build/check 通过；UI 待重载确认） |
| [0011](0011-redundancy-cleanup.md) | 清理 0008/0009 后的冗余：死导出、重复错误文案、超长 UI 文件拆分、桥 v1 段 | ✅ 已完成（build/check + 语法检查通过；UI/桥 待重启验证） |
| [0012](0012-session-switch-error-flash.md) | 新建会话时红色错误条一闪而逝：切换会话竞态 + 错误条字色与底色同色 | ✅ 已完成（CDP 回归：banner 0 次；样式探针可读） |
| [0013](0013-native-chat-compact-ui.md) | 原生聊天栏视觉收敛：标题去药丸 / 新会话默认名 / 当前笔记浮标 / 输入框加高去灰环 / 输入区悬浮与 hover 整块高亮 | ✅ 已完成（build/check + CDP 探针通过） |
| [0014](0014-native-chat-typography.md) | 原生面板排版只修痛点：行距 / 列表缩进 / 行内码 / 代码块字号 / 块间距（对齐 DSH Web 实测值） | ✅ 已完成（check + CDP 计算样式与截图验证） |
| [0015](0015-note-references.md) | 消息引用：@路径 渲染为 Obsidian 短链 + `[[…]]` 点击打开笔记（发送也改 `[[…]]`） | ✅ 已完成（build/check + 纯函数冒烟 + CDP 点击验证） |
| [0016](0016-process-fold-rendering.md) | 原生消息渲染：思考 / 工具调用折叠成一行、点击展开；修收尾后工具内容消失 | ✅ 已完成（build/check + 模型冒烟 + CDP 回归） |
| [0017](0017-native-streaming.md) | 原生面板流式输出：桥订阅会话事件流（B3），`nextEvent` 携带 live tail | ✅ 已完成（build/check + CDP 流式回归） |
| [0018](0018-usage-driven-workflow.md) | 边用边改：需求登记 roadmap 待办 + 提案，先调研实现路径、由用户选路后再执行 | ✅ 已完成（文档流程；check 通过） |
| [0019](0019-native-panel-fullbleed.md) | 原生聊天面板融入右栏：去掉白底卡片与外圈间隙（全出血 / 透明底） | ✅ 已完成（check + CDP 计算样式与截图验证） |
| [0020](0020-process-row-background-swap.md) | 过程行（含思考 / 工具行）默认 / hover 底色互换：默认浅色叠加、hover 实心（修正被 Obsidian 按钮基础样式盖掉的优先级） | ✅ 已完成（check + CDP 计算样式与截图验证） |
| [0021](0021-stream-refresh-mode.md) | 流式刷新节奏可调（逐字 / 每帧 / 平衡 / 省电）：桥端逐 chunk 通知 + 宿侧 rAF 合帧 + 设置项 + 流式纯文本快通道 | ✅ 已完成（build/check + CDP 流式实测） |
| [0022](0022-context-usage-meter.md) | 输入栏上下文占用圆环：发送按钮左侧只显示圆环，点击看百分比 / token / 构成 | ✅ 已完成（build/check + CDP 实测） |
| [0023](0023-at-file-mentions.md) | 输入框 @ 文件引用菜单（参考 dsh）+ 当前笔记改为默认不引用、@ 首项「当前笔记」 | ✅ 已完成（build/check + 纯函数冒烟 + CDP 交互验证） |
| [0024](0024-folder-references.md) | 文件夹引用：Enter 采纳 / Tab·箭头下钻；@文件夹 渲染成可点击 chip，点击在左侧文件列表展开选中 | ✅ 已完成（build/check + 纯函数冒烟 + CDP 实测） |
| [0025](0025-slash-commands.md) | 输入框 `/` 命令菜单（new / compact + 「技能」分组的技能列表，参考 dsh）：桥 v5 + 压缩过程提示 | ✅ 已完成（build/check + 纯函数冒烟 + CDP 实测；技能改为同列表分组） |
| [0026](0026-composer-wider.md) | 输入框横向加宽：卡片比正文列各外扩 11px，卡内文字仍与正文左边界对齐 | ✅ 已完成（check + CDP 计算样式与截图） |
| [0027](0027-settings-panel-modules.md) | 设置面板按模块拆分：顶部 tab（服务 / dsh 版本 / 聊天 / 集成）替代单页平铺，tab 条 + 分 section 文件 | ✅ 已完成（build/check + CDP 实测） |
| [0028](0028-composer-hover-highlight.md) | 输入框悬停高亮在浅色主题下不可见：深色用 `--background-modifier-hover`，浅色改「描边 + 浮起阴影」（追补：浅色填色像变暗） | ✅ 已完成（check + CDP 浅/深主题计算样式与截图） |
| [0029](0029-chat-content-smaller-font.md) | 聊天正文字号稍微调小：消息正文比基准小 1px（15 → 14px），流式纯文本与 Markdown 同字号 | ✅ 已完成（check + CDP 计算样式与截图） |
| [0030](0030-mention-scope.md) | @ 文件引用的检索范围：设置「聊天」tab 三档（不启用 / 白名单 / 黑名单），白名单 / 黑名单选中后展开添加栏 | ✅ 已完成（2026-10-27；build/check + 纯函数冒烟 + CDP 实测） |
| [0031](0031-plugin-management-tab.md) | 设置页新增「插件」tab：参考 dsh 插件管理面板，查看 / 启停 dsh 侧插件（路径 B；安装 / 卸载留作后续） | ✅ 已完成（2026-10-27；build/check + service 冒烟 + CDP 实测） |
| [0032](0032-optional-bundles.md) | 「插件」tab 补上官方「实验性 / 可选插件」：读 official-bundles 目录，启用 / 停用可选 bundle（写 profile 的 `dsh.profile.bundles`） | ✅ 已完成（2026-10-27；build/check + service 冒烟 + CDP 实测） |
| [0033](0033-session-title-auto-update.md) | 新会话标题不再 rename 钉住「新会话」：去掉建会话 rename，标题交给 DSH（默认首消息 provider / 启用后随对话更新），标题一变列表就跟随 | ✅ 已完成（2026-10-27；build/check + CDP 实测） |
| [0034](0034-collapse-experimental-plugins.md) | 「插件」tab 的「可选 / 实验性插件」默认收起，点标题展开（复用 bundle 折叠头） | ✅ 已完成（2026-10-27；build/check 通过 + CDP 实测） |
| [0035](0035-agent-team-support.md) | 原生面板支持 dsh「智能体团队」（Agent Teams）：只读团队面板 / 团队工具行 / 队友消息 | ✅ 已完成（2026-10-27；build/check + CDP 实测） |
| [0036](0036-process-segments.md) | 过程行按正文分界拆分：一轮里正文前后的思考 / 工具调用各自成栏 | ✅ 已完成（2026-10-27；build/check + 19 项合成冒烟 + CDP 实测） |
| [0037](0037-skill-slash-scope.md) | 「/」菜单技能范围：设置「聊天」tab 三档 + 按技能名过滤技能行，只影响菜单出现、不影响技能加载 | ✅ 已完成（2026-10-27；build/check + 28 项纯函数冒烟 + CDP 实测） |
| [0038](0038-scope-picker.md) | 白 / 黑名单添加栏的「选取」按钮：自动获取候选（vault 路径 / 技能名）+ 点选填入添加栏 | ✅ 已完成（2026-10-27；A + A1 + B1 + C1；build/check + 冒烟 + CDP 实测） |
| [0039](0039-scope-settings-cards.md) | 范围设置分组卡片：@ 与 / 各一张带徽标的卡，标题 + 模式下拉 + 名单详情同卡 | ✅ 已完成（2026-10-27；build/check + CDP 实测 + 截图） |
| [0040](0040-scope-card-title.md) | 范围卡片标题去掉与徽标重复的 @ /：只留「引用范围」「技能范围」 | ✅ 已完成（2026-10-27；build/check + CDP 实测 + 截图） |

## 需求受理（2026-10-27 起）

用户在使用中提出的每个需求 = 两个动作，缺一不可：

1. [roadmap.md](../roadmap.md)「需求待办」加一行：`R-<n>` / 需求一句话 / `待调研` / 指向本目录提案；
2. 本目录建 `NNNN-<slug>.md`（`status: draft`），frontmatter 的 `issue` 与 roadmap 行保持一致。

顺序固定：**两条记录 → 写「实现路径调研」（≥ 2 条 + 推荐）→ 把选项给用户 → 用户选路 → approved → 执行 → done**。
状态变化时同步 roadmap 行：`待调研` → `等你选路` → `执行中` → `✅ 已完成`（或 `⏸ 暂缓`）。

## 状态机

```text
draft（待批准） ──► approved（已批准，执行中） ──► done（已实施并验证）
       │
       └──► rejected（用户否掉，附理由）
```

- 状态写在文件 frontmatter 的 `status`，并在本表同步。
- 批准后开工前填 `approved` 日期；实施完填「实施记录」并改 `done`。
- 批准后如果选定的实现路径有实质变化：追加「变更记录」、状态退回 `draft` 重新确认。

## 起稿

复制 [template.md](template.md)。必填小节：背景与问题、目标与非目标、**实现路径调研（≥ 2 条可行路径 + 推荐 + 改动面 / 代价 / 风险对比）**、
改动清单（文件级）、行为变化、风险与回滚、验证方式、**需要你拍板的问题**（推荐哪条路径要在这里再问一次）。

写完路径调研就停下来问用户选哪条，**不要替用户默认选完就开工**；用户选定后才改 `approved`。

## 不需要提案的改动

- 只改文档 / 注释 / 格式；
- 用户当轮已明确指定要改的具体项（视为已批准，可直接做；属于用户需求的，仍需在 roadmap「需求待办」留行并补提案记录）；
- 单纯重建产物（`npm run build`，不改源码）。

## 写作要求

- 说清楚「改哪个文件、改什么行为、怎么验证、失败怎么退」；
- 实现路径必须 ≥ 2 条，给对比并标明推荐哪个 / 为什么不选其他；
- 不确定的点单独列进「需要你拍板」，不要混在正文里；
- 提案就是评审材料，不要写成实现笔记；路径写完先问用户，不要默认开工。
