# AGENTS.md

给在本仓库工作的 AI agent 的约定。**只约束项目结构与硬性规则**；流程细节见 [docs/development.md](docs/development.md)，架构见 [docs/architecture.md](docs/architecture.md)。

> **新会话开场必做**：先加载 `project-guide` 技能，按它给的顺序查 `docs/` 了解当前状况（roadmap → changes 状态 → 改动地图），**不要靠通读源码来熟悉项目**。
> 文档与代码冲突时以代码为准，并把文档补上。

## 项目是什么

Obsidian 插件（56 个源文件、约 9200 行 TS/TSX，按职责域分层：`src/service` / `src/view` / `src/settings` / `src/shared`，`src/main.ts` 是组合根）：在 Obsidian 右侧面板提供**原生 React 聊天 UI**（`src/view/native/`），内部用离屏的官方 core webview + `dsh-obsidian-bridge` v6 取数据（v3 含 liveStream 流式，v4 含上下文占用，v5 含 “/” 命令与技能目录，v6 含 Agent Teams 团队投影）；不再提供可见的官方 Web GUI 面板（0008）。插件托管一个独立的 dsh 服务（profile `obsidian`、默认端口 3081、cwd = vault，只支持 dsh 0.2.x）。

## 目录约定

新文件必须落在下面对应位置，**根目录不要新增杂项**。

| 路径 | 放什么 | 注意 |
|---|---|---|
| `src/main.ts` | 组合根：只做注册 / 装配 / 结果到 Notice 的映射 | 不要往里塞业务逻辑 |
| `src/service/` | dsh 进程域：manager（托管）/ locator（路径解析） | **不 import obsidian**；纯 Node 逻辑 |
| `src/view/` | 面板域：native（原生聊天 React UI）/ surface（隐藏 core 的 webview 承载）/ panel-host（宿主接口）/ open（打开面板） | 不 import main.ts，只依赖 DshPanelHost 接口 |
| `src/settings/` | 配置域：schema（类型 / 默认值 / 端口校验）/ context（SettingsHost + 模块渲染上下文）/ tab（设置页 tab 条与调度）/ sections（各设置模块） | 默认值只在 schema.ts 定义 |
| `src/shared/` | 跨域基础件：constants / types / async / errors / log / host | 不放业务逻辑 |
| `main.js` | esbuild 构建产物 | **禁止手改**，只能由 `npm run build` 生成 |
| `manifest.json` / `versions.json` / `styles.css` | 插件清单、兼容表、样式 | 不要往 manifest 加自定义字段 |
| `docs/` | 给人看的项目文档（install / roadmap / architecture / development / troubleshooting / skills） | 不放实现日志、TODO 草稿；新文档要登记进 [docs/README.md](docs/README.md) |
| `docs/changes/` | 代码改动前的提案（draft → approved → done），含模板与编号索引 | **未批准前不要改代码**；每个需求一份，含 ≥ 2 条实现路径对比 |
| `skills/<name>/SKILL.md` | 给 agent 的技能入口 | 项目文档不要放这里 |
| `skills/<name>/data/` | 可重建的索引 / 缓存 | 不提交缓存与不可复现产物 |
| `.dsh/skills/<name>` | 指向 `../../skills/<name>` 的符号链接 | 不放真实文件 |
| `scripts/` | 开发工具：`check.mjs`（提交前检查）、`install-hooks.sh` / `githooks/pre-commit`（安装钩子） | 不放运行时逻辑 |
| `packages/dsh-obsidian-bridge/` | dsh 侧客户端插件（独立包，纯 JS）：v6 原生数据桥（v1 布局代码已在 0011 删除；v3 增加 liveStream，v4 增加 context，v5 增加 commands / skills / executeCommand，v6 增加 team / agentTeam 团队投影） | 不被打进 `main.js`；改完需重新 link 到 profile 并重启服务 |
| `data.json` | Obsidian 运行时设置（开发期因符号链接安装落在仓库根） | **不要当源码改、不要删** |
| `node_modules/` / `.DS_Store` | — | 不入版本库 |

根目录只应包含：插件运行必需文件（`main.js` / `manifest.json` / `styles.css` / `versions.json` / `data.json`）、构建配置（`package.json` / `package-lock.json` / `tsconfig.json` / `esbuild.config.mjs`）、说明与约定（`README.md` / `AGENTS.md`）、以及 `docs/`、`skills/`、`scripts/`、`packages/`、`.dsh/`。

## 硬性规则

1. **产物与源码同步**：改 `src/` 后必须 `npm run build`；仓库里的 `main.js` 必须是最新构建结果（esbuild 输出可复现，改动后可对比构建前后是否一致）。
2. **版本号三处一致**：`manifest.json.version` = `package.json.version` = `versions.json` 的最新键；每次版本变化都追加 `{ "<版本>": "<minAppVersion>" }`（`npm run check` 会校验最新键）。
3. **默认值一处改、处处同步**：端口 3081 / profile `obsidian` / `autoStart: true` 定义在 `DEFAULT_SETTINGS`；改动需同步 [README](README.md)、[docs/development.md](docs/development.md)、[docs/troubleshooting.md](docs/troubleshooting.md)。
4. **保持 `isDesktopOnly: true`**：插件依赖 `child_process` / Node API，移动端不可用，不要加移动端兼容分支。
5. **不引入运行时依赖**：`package.json` 只放 devDependencies；产物必须自包含（`obsidian`、`electron`、`@codemirror/*`、`@lezer/*`、Node 内置已在 external）。
6. **进程生命周期**：只杀自己 spawn 的子进程（用户手动起的实例不动）；`onunload` 不 `detach` 视图（官方 guideline）；本项目 `minAppVersion` 是 1.4.0，不要引入 1.7.2+ 才有的 `onUserEnable()` 等 API。
7. **样式**：写进 `styles.css`，用 Obsidian 主题变量（`var(--...)`），不硬编码颜色、尺寸。
8. **文档跟着行为走**：改端口 / profile / 命令 id / 目录结构 / 构建步骤 → 同步 `docs/` 对应文件。路线图状态只改 [docs/roadmap.md](docs/roadmap.md)，README 不重复维护清单。
9. **技能接入方式固定**：新增技能 = `skills/<name>/SKILL.md` + `ln -sfn ../../skills/<name> .dsh/skills/<name>`；frontmatter 必须有 `name`（小写字母、数字、连字符）与 `description`。
10. **不提交**：`.DS_Store`、`data.json`（本机运行时设置）、`skills/*/data/cache/`、临时文件。
11. **分层单向依赖**：`main` → `service` / `view` / `settings` / `shared`；`service` → `shared`；`view` → 接口 + `settings/schema` + `shared`。禁止反向 import、禁止 `index.ts` barrel。`packages/` 是独立 dsh 插件，不 import `src/`，也不被 `src/` import。新增或移动文件前，按 `skills/project-guide` 的决策表落位（该技能也定义了拆分的判据、验收清单与冷启动读文档流程）。
12. **需求先登记、路径先选、再动代码**：任何功能添加、BUG 修复、优化或会改变运行行为的代码改动，默认走四步，不要跳步：
    1. **登记**：用户提出需求 → 在 [docs/roadmap.md](docs/roadmap.md)「需求待办」加一行（`R-<n>`，状态 `待调研`，链接到提案），并在 `docs/changes/` 落一份 `status: draft` 提案（复制 template）；两处互相引用。
    2. **比路径**：把调研写进提案的「实现路径调研」小节，至少 2 条可行路径，写清改动面 / 代价 / 风险，标明推荐哪条；不确定的点进「需要你拍板」。
    3. **等你选路**：把路径选项直接呈现给用户并**到此为止**——这一轮不要改代码，也不要替用户默认选完就开工。用户选定路径后，才把提案改 `status: approved` 并填日期。
    4. **执行与收尾**：严格按提案执行；实质偏离要追加「变更记录」、退回 `draft` 重新确认；完成后补「实施记录」改 `done`，并把 roadmap 待办行改成 `✅ 已完成`。
    例外：只改文档 / 注释 / 格式；用户当轮已明确指定要改的具体项（视为已批准，可直接做；属于用户需求的，仍要在 roadmap 待办表留一行并补提案记录）；单纯重建产物。
13. **路线图是唯一主线账本**：用户提出的每个需求都必须同时出现在 [docs/roadmap.md](docs/roadmap.md)「需求待办」（`R-<n>`）和 `docs/changes/` 提案（`NNNN`）里，两处互相链接、状态一致。当前主线是「边用边改」——不再主动排新里程碑；M3 / M5 未完成项留在候选池，等使用中触发。已完成的历史里程碑（M0–M7）保留，不要删除。
14. **提交前检查**：`npm run check` 必须通过（`pre-commit` 钩子已自动安装并执行同一脚本）；不要用 `SKIP_COMMIT_CHECK` 绕过，除非在 commit message 写明理由。

## 验证（改完必做）

> 动代码之前先确认：需求已登记到 roadmap「需求待办」、提案的「实现路径调研」已给用户看过、**用户已选定路径**，且 `docs/changes/<提案>.md` 的 `status` 已是 `approved`，然后按提案执行（见规则 12）。

```bash
npm run build        # tsc -noEmit -skipLibCheck + esbuild，必须无错误
npm run check        # 版本 / 依赖 / 类型 / main.js 与源码构建一致 + bridge 插件清单与语法（提交钩子跑同一脚本）
node --check skills/obsidian-docs/scripts/obsdocs.mjs   # 仅在改了技能脚本时
```

`npm install` 的 `postinstall` 会把 `scripts/githooks/pre-commit` 装到 `.git/hooks/`；改了检查逻辑后重跑 `npm run hooks:install`。

手动回归（当前无单测/CI，清单见 [docs/development.md](docs/development.md#现状与手动回归)）：
重新加载插件 → 状态栏 `DSH: 运行中` → 原生聊天面板能打开并连接（桥 v6）→ 发消息能看到流式正文、输入栏出现上下文占用圆环 → 启用「智能体团队」后标题右侧出现团队图标、面板能看 roster / 任务板 → 「重启 DSH 服务」成功 → 禁用插件后端口释放。

## 外部依赖（不在本仓库）

- `$DSH_HOME/profiles/obsidian/`：dsh profile，bundles = `dsh-base` + `dsh-web-app`。
  模型接入要跟桌面 profile 对齐（`llm-pi-ai` + `agent-default-model` + 禁用 `llm-deepseek`），
  否则原生聊天会走 base 默认的 `deepseek-official` 并报 `Authentication Fails`；凭据共享
  `$DSH_HOME/.credentials.yaml`，配置见 [docs/development.md](docs/development.md#profile-的模型接入与桌面端一致)。
- dsh 可执行文件：`node + ~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（存在时优先），或 PATH 上的 `dsh`，或 `~/.local/bin/dsh` 等绝对路径候选；设置页「dsh 版本」可手动选择检测到的任一份。
- 客户端插件 `dsh-obsidian-bridge`：已迁入本仓库 `packages/`；`dsh-obsidian-mentions`、`dsh-ui-obsidian-layout` 仍在外部仓库（如 `~/dsh-plugin`）维护，改它们不算本仓库任务。

需要跨仓库配合时，在说明里写清依赖的版本与生效方式（是否需要「重启服务」）。
