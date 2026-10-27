---
status: done           # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户选路 B（只读清单 + 组件行启停）
scope: src/settings, src/service, styles.css, docs
issue: 设置页新增单独的「插件」tab，参考 dsh 的插件管理面板，在 Obsidian 里查看 / 启停 / 安装 dsh 侧插件
---

# 0031 设置页「插件」tab：参考 dsh 插件管理面板

> 对应路线图 [R-14](../roadmap.md#需求待办)。用户已选**路径 B**（只读清单 + 组件行启停），按提案执行完毕（2026-10-27）。

## 1. 背景与问题

### 现状

- 设置页有 4 个 tab：服务 / dsh 版本 / 聊天 / 集成（[0027](0027-settings-panel-modules.md)）。**没有任何管理 dsh 插件的位置。**
- 0.4.0 起删除可见官方 Web GUI 面板（[0008](0008-native-only-surface.md)）：官方 GUI 只剩离屏隐藏 core，**dsh 自带的「插件」全局面板在 Obsidian 里已经点不到**。要装 / 停 / 看插件，目前只能手改 profile 文件（[README](../../README.md) 第 68 行只给了「模型/凭据改 `cordis.patch.yml`」这一句），门槛很高。
- 用户原话拆解：
  1. 在**插件设置**里加一个**单独的 tab**；
  2. **参考 dsh 的插件管理面板**（即官方侧栏「插件」全局面板）；
  3. 在 **Obsidian 的插件设置页面**里也能有一个类似的。

### dsh 官方插件管理面板长什么样（调研结论，dsh 0.2.1-rc.3）

来源：`~/dsh/deepseek-harness`（可读的 dsh checkout）里的
`packages/client/ui-plugin-manager`（浏览器半身，1861 行页面 + 1524 行 store）与
`packages/boot/plugin-manager`（宿主半身，1253 行）。

- 入口：左侧栏「插件」（`PANEL_ID = 'plugins'`），打开**全局面板**（不属于某个会话），默认「已安装」标签。
- 分组：**已安装插件**（profile 的 bundle 卡片）/ **内置插件配置**（官方插件配置项）/ **实验性插件**。
- 每张 bundle 卡片：本地化标题 + 描述、`v<版本>`、「包含的组件（共 N 个 / X 运行中 / Y 已停用 / Z 异常）」、来源信息（内置 / npm / Git / 本地目录）、组件逐行开关（`fiberPhase`：等待依赖 / 加载中 / 运行中 / 异常）。
- 操作：**添加插件**（npm 包 / Git 仓库 / 本地目录）、bundle 与组件**启用 / 停用**、**卸载**（带确认）、**版本列表与更新**、**详细介绍**、安装日志与失败分类。
- 生效方式：多数改动**需要重启 DSH**，面板会给出原因（`RestartReason`：no-hmr / package-moved / host-module / unmanaged-plugin / module-comparison）。
- 后端：`pluginManager` / `pluginInventory` / `pluginRegistryProbe` 三个 Remote；写用户层 patch 时用 `yaml` 包**保留注释** + 原子写；bundle 的启用状态写在 profile `package.json` 的 `dsh.profile.bundles`；安装转发给 pnpm。

### obsidian profile 实测数据

命令：`dsh --profile obsidian --dump-config`（在临时 `DSH_HOME` 副本上跑，避免动真 profile）：

- bundles：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-obsidian-bridge`；
- 组合后 **195 个顶层条目** + **107 个 preset 内的嵌套行**；其中 **33 条**自带 `disabled:`、**40 条**是 `disabled: !!js '<表达式>'` 条件行；
- 输出按 `# == <bundle>[ , patched by <layer>]` 分段，每段是 `- id / name / disabled / config` 的 YAML；
- profile 里的 `plugin-manager`、`plugin-inventory`、`ui-plugin-manager` 都在树里 → **运行中的 obsidian 服务确实带着官方插件管理后端**。

### 可达性（决定了路径怎么选）

| 数据来源 | 能拿到什么 | 代价 / 限制 |
|---|---|---|
| 直读 profile 文件（Node `fs`） | `package.json` 里的 bundles / dependencies、`cordis.patch.yml` 的用户条目、`node_modules` 的版本 | 要自己复刻「bundle patch 叠加」才能得到权威的组合结果，容易与 dsh 版本漂移 |
| spawn `dsh --profile <p> --dump-config` | **权威组合结果**（分组 + 每行的 disabled / 条件表达式） | 约 0.3–1s；dsh 启动时会重写 profile 的 `cordis.yml`（内容恒为 `[]`，与 boot 行为一致） |
| spawn `dsh plugin --profile <p> add\|remove <pkg>` | 安装 / 卸载（转发 pnpm） | 网络 / 磁盘 / 安装脚本授权；需要进度与失败分类 UI |
| 桥（隐藏 core） | 官方 `pluginManager` Remote（标题、描述、版本、更新、安装事件） | 需改 `packages/dsh-obsidian-bridge` + relink + 重启；**且设置页依赖聊天面板已打开**（隐藏 core 只在原生面板里） |

## 2. 目标与非目标

### 目标

- 设置页 tab 条新增**第 5 个 tab「插件」**（服务 / dsh 版本 / 聊天 / 集成 / 插件），沿用 0027 的 tab 条与 `SettingsRenderContext`（异步模块 + `isStale()`）。
- 内容按 **bundle 分组**展示 dsh 侧插件：包名 / 版本 / 来源（内置 / profile 依赖）/ 组件行数统计（运行中 / 已停用 / 条件启用）；每组可折叠，行级状态徽标（与官方面板一致的中文文案）。
- **行级启用 / 停用**（推荐路径含此项）：写 profile 用户层 `cordis.patch.yml` 的最小 `disabled` 覆盖；`!!js` 条件行只展示、不给开关。
- 顶部一行状态：当前 profile、dsh 版本、需要重启的提示 + 「重启服务」按钮（复用现有 `restartService()`）。
- 组件多（195 行）时的可用性：默认折叠分组 + 筛选输入框 + 只显示匹配行。
- 配置写坏可恢复：每次写前备份 `.bak-<时间戳>`、原子写、写后复验，失败回滚。

### 非目标

- 不复刻官方的**全局面板 / 侧栏入口 / 卡片美术 / 详细介绍页 / 安装脚本 allowBuilds 授权流程**——设置页里是一个模块，不是第二个全屏 App。
- 不做**模型 / 凭据 / preset** 的配置编辑（仍按 [README](../../README.md) 指到 `cordis.patch.yml`）。
- 不管 Obsidian 自身的第三方插件（`app.plugins`），只管 dsh 侧插件。
- 不做版本列表 / 更新 / 回退 / 预发布筛选（官方面板才有，依赖 registry 探测）。
- 不新增任何运行时依赖（含 `yaml` 包）：YAML 只做**最小行级编辑**，不引入解析器。
- 不改 `isDesktopOnly` 前提之外的平台适配；不做移动端分支。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A 只读清单** | 新增 `src/service/plugin-inventory.ts`（纯 Node）：用现有 `resolveDshInstall()` 拿命令 → spawn `dsh --profile <profile> --dump-config`（`buildSpawnEnv()`、超时 8s）→ 按缩进 + `# ==` 头解析成 `{ bundleName, patchedBy, rows: [{ id, name, disabled, conditional }] }`；版本从 profile / dsh 安装的 `node_modules/<pkg>/package.json` 读；新增 `src/settings/sections/plugins.ts` 渲染分组 / 折叠 / 筛选 / 徽标 / 复制命令；`SettingsHost` 加 `getPluginInventory()`；`settings/tab.ts` 的 `SECTIONS` 注册第 5 项；`styles.css` 加 `.dsh-settings-plugins*` | 6 个源文件 + docs，约 350 行 | 无写操作、无网络；风险最低。限制：只读；首次进 tab 有 0.3–1s loading；dump 输出格式属于 dsh 内部格式（本项目本来就锁 0.2.x） | 地基；只读够不够看你的诉求 |
| **B（推荐）A + 组件行启停** | A 之上新增 `src/service/plugin-patch.ts`（纯 Node）：`setPluginEnabled(patchPath, id, name, enabled)`——读文本 → 找**最后一条**同 `id`（无 `insert`）的覆盖条目 → 有则改 / 删 `disabled`，无则**追加** `- id: <id>\n  disabled: true`；写前备份 `.bak-<ts>` + 原子写 → 写后重跑 `--dump-config` 复验该行状态，失败则回滚备份；UI 加开关、`!!js` 行置灰、每次改动后显示「重启服务后生效」 | A + 2 个源文件，约 +250 行 | 覆盖「看 + 开关」这个最高频诉求；只动用户层 patch，不碰 pnpm / 网络 / 桥。风险：手写 YAML 可能挪动注释位置（结构仍合法）、误停关键行会让面板/服务异常（限制：条件行不给开关 + 写前备份 + 复验回滚） | **推荐**：改动集中在 `settings/` + `service/`，可独立冒烟，回滚只需还原备份 |
| C B + bundle 启停 | 在 B 上再加写 profile `package.json` 的 `dsh.profile.bundles`（JSON，安全）；UI 在 bundle 卡片放总开关 | B + 1 个文件，约 +80 行 | 停用 `dsh-base` / `dsh-web-app` 会让服务与原生面板直接不可用（官方面板也把这类列为只读 / 需二次确认） | 可选加分；默认挡掉 base / web-app，只允许第三方 bundle |
| D C + 安装 / 卸载 | 新增 `src/service/plugin-install.ts`：spawn `dsh plugin --profile <p> add\|remove <spec>`（cwd = profile 目录），流式输出 → 进度 / 失败分类（pnpm 缺失 / 网络 / 磁盘 / 权限 / 超时）；UI 加「添加插件」输入框（npm / git / 本地路径）+ 卸载确认 | +1 个文件 + UI，约 +400 行 | 覆盖官方面板的安装能力；但网络、磁盘、安装脚本授权、长任务状态机都要自己处理，测试成本高 | 不推荐本期做，留作 `0032`（需求触发再提） |
| E 桥 v6 直连官方 Remote | `packages/dsh-obsidian-bridge/lib/client.js` 新增 `plugins()` / `setPluginEnabled()` / `setBundleEnabled()`，调 `ctx.remote.pluginManager`；`src/view/native/core-bridge.ts` + 设置页消费官方 `BundleInfo`（标题 / 描述 / 版本 / 官方与实验分组 / 可用更新 / 安装日志事件） | 桥 + 原生端 + 设置页 | 与官方面板 1:1，但：要 relink + 重启；**设置页依赖聊天面板打开时隐藏 core 才有桥**（关闭面板时「插件」tab 不可用）；耦合 dsh 内部 Remote 契约 | 最像原版、可用性最差；不推荐本期 |
| F 隐藏 core 里直接显示官方面板 | 把隐藏 core 换成可见 webview 显示官方「插件」面板 | 推翻 0008 | 与 0008「只保留原生面板」冲突，且 token / 分区 / 焦点都要重做 | 不推荐（方向性冲突） |

**推荐 B**：它把「清单 + 开关」这条主线做完，全部落在 `service/`（可脱离 Obsidian 冒烟）+ `settings/`（不 import main），不碰 pnpm、不碰桥、不需要 relink；C 的 bundle 总开关价值低（obsidian profile 只有 3 个 bundle，且两个是基础层），D 的安装涉及网络与长任务，适合单独提案。

## 4. 改动清单（按推荐 B）

| 文件 | 改动 |
|---|---|
| [src/service/plugin-inventory.ts](../../src/service/plugin-inventory.ts)（新增） | `readPluginInventory()`：解析 dsh 命令 → spawn `--dump-config` → 解析分组 / 行 / 条件 → 合并 `node_modules` 版本；内存缓存（tab 重进复用，重启服务 / 写操作后失效）；返回纯数据 DTO |
| [src/service/plugin-patch.ts](../../src/service/plugin-patch.ts)（新增） | `setPluginEnabled()`：最小 YAML 覆盖的增 / 改 / 删 + `.bak-<ts>` 备份 + 原子写（`writeFile` 到临时文件再 `rename`）+ 失败回滚；不引入 YAML 依赖 |
| [src/shared/types.ts](../../src/shared/types.ts) | `DshPluginRow` / `DshPluginBundle` / `DshPluginInventory` DTO（纯类型，跨 `service` 与 `settings`） |
| [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts)（新增） | 「插件」tab：profile / dsh 版本状态行、筛选框、分组卡片（折叠、统计、行开关、`!!js` 行置灰）、错误 / loading / 空态、失败文案、重启提示 |
| [src/settings/context.ts](../../src/settings/context.ts) | `SettingsHost` 增加 `getPluginInventory()` / `setPluginEnabled(row, enabled)` |
| [src/settings/tab.ts](../../src/settings/tab.ts) | `SettingsSectionId` 加 `'plugins'`，`SECTIONS` 追加 `{ id: 'plugins', label: '插件' }`（第 5 位）；tab 条自带 `flex-wrap`，样式无需改 |
| [src/main.ts](../../src/main.ts) | 实现两个 `SettingsHost` 方法：组装命令 / profile 路径（`DSH_HOME ?? ~/.dsh`）后交给 `service/`；写成功后提示「重启服务生效」，不自动重启 |
| [styles.css](../../styles.css) | `.dsh-settings-plugins*`（分组卡 / 行 / 状态徽标 / 开关 / 筛选框 / 折叠箭头），只用主题变量 |
| docs | 本提案；`docs/changes/README.md` 索引；`docs/roadmap.md` R-14 行；`docs/development.md` 改动地图 + 回归清单；`docs/architecture.md` 关注点表；`README.md` 设置页功能列表 |

不改：`src/view/`、`packages/dsh-obsidian-bridge/`、`src/service/manager.ts`、`settings/schema.ts`（本提案不新增设置项，无需改 `data.json` 结构）。

## 5. 行为变化

- 设置页 tab 条从 4 个变 5 个，新增「插件」；默认仍进入「服务」tab，不记忆上次 tab（与 0027 一致）。
- 「插件」tab 首次打开显示「正在读取 dsh 插件…」，随后按 bundle 分组列出组件行：名称、状态（运行中 / 已停用 / 条件启用 / 异常）、包版本。
- 行开关：关闭 → 写 `cordis.patch.yml` 的 `- id: <id>\n  disabled: true`；打开 → 若是我们追加的覆盖条目则移除，否则按需保留（与 dsh 自己的 `writePluginEnabled` 的「冗余覆盖会被删掉」行为对齐）。改动后显示「重启服务后生效」+ 按钮。
- `!!js` 条件行（40 条，如 `hmr`、`plugin-manager` 自身）只显示状态、不给开关，提示「由 dsh 按运行环境自动决定」。
- 写入失败 / 复验不一致：显示错误行并**自动回滚**备份，`cordis.patch.yml` 保持原样。
- 原生聊天、流式、"@" 引用、"/" 菜单、服务托管行为**不变**。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 手写 YAML 覆盖把注释挪位 / 重复条目 | `cordis.patch.yml` 可读性下降 | 写入前备份 `.bak-<ts>`；追加前先查同 id 条目；写后 `--dump-config` 复验 |
| 误停关键行（如 `plugin-inventory`） | 面板 / 设置页异常 | 条件行不给开关；写后复验失败即回滚；文档写明备份文件名格式 |
| `--dump-config` 会重写 `cordis.yml`（`[]`） | 该文件本就是 dsh boot 时写的，手动改过会被覆盖 | 文档注明「不要手改 `cordis.yml`」；内容恒为 `[]`，无实际损失 |
| dump 输出格式随 dsh 版本变化 | 解析失败、tab 显示错误 | 本项目已锁 dsh 0.2.x；解析失败时降级为「只读文件摘要 + 错误提示」，不阻塞设置页其它 tab |
| 195 + 107 行渲染卡顿 | 设置页滚动 / 切 tab 变慢 | 默认折叠分组、按需渲染、筛选框 + 单组最多渲染 N 行 |
| spawn 失败（dsh 不可执行 / 版本不符） | tab 空白 | 显示原因 + 「检查 dsh 版本」链接到现有 tab |
| 用户想恢复面板原状 | — | 删 `.bak-*` 之外的改动即可；所有写入只发生在 `~/.dsh/profiles/<profile>/`，不碰 vault、不碰 `data.json` |

## 7. 验证

自动化：

```bash
npm run build   # tsc -noEmit -skipLibCheck + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

纯 Node 冒烟（两个新文件都不 import obsidian，可单独打包）：

```bash
./node_modules/.bin/esbuild src/service/plugin-inventory.ts --bundle --platform=node --format=esm --outfile=/tmp/plugin-inventory.mjs
./node_modules/.bin/esbuild src/service/plugin-patch.ts --bundle --platform=node --format=esm --outfile=/tmp/plugin-patch.mjs
```

- 解析用例：用真实 `--dump-config` 输出做固定 fixture（去掉 `config` 段落）→ 分组数、顶级行数、`disabled` / `!!js` 计数与实测一致（195 / 33 / 40）。
- 写入用例（临时目录里的 patch 副本）：追加新覆盖、改已有覆盖、删冗余覆盖、保留文件头注释、备份生成、原子写、复验失败回滚。

手动回归（Obsidian 内，先 `cp cordis.patch.yml cordis.patch.yml.manual-bak`）：

1. 设置页出现第 5 个 tab「插件」；打开后有 loading，随后列出 3 个 bundle 分组与组件行。
2. 停用一条非关键行 → 出现「重启服务后生效」→ 点重启 → 该行状态变为「已停用」，对应功能消失；再次启用 + 重启 → 恢复。
3. 条件行没有开关、有说明。
4. 筛选框只留匹配行；分组折叠不丢统计。
5. 写入失败路径（把 profile 目录设为只读）→ 设置页报错且 `cordis.patch.yml` 未被改坏（与 `.manual-bak` 一致）。
6. 切 tab / 快速连点「插件」→ 不出现串台、不重复 spawn（缓存生效）。
7. 原生聊天 / @ 菜单 / "/" 菜单行为不变。

**验收标准**：tab 出现且分组 / 行数与实测一致；行级启停在重启后真实生效；写坏可一键回滚；`npm run build` / `npm run check` 通过；`main.js` 与源码一致。

## 8. 拍板结果（2026-10-27）

- [x] 管的是 **dsh 侧插件**（profile 的 bundle + 组件行），不是 Obsidian 自身的第三方插件。
- [x] 实现路径：**B**（只读清单 + 组件行启停；不做 bundle 启停、不做安装 / 卸载）。
- [x] 允许插件写 `~/.dsh/profiles/obsidian/cordis.patch.yml`（每次写前自动备份 `.bak-<时间戳>`）。
- [x] 生效方式：只提示「重启服务」+ 按钮，**不自动重启**。
- [x] tab 名字与位置：**「插件」放第 5 个**（服务 / dsh 版本 / 聊天 / 集成 / 插件）。
- [x] 默认折叠 + 筛选够用（不做「只显示异常 / 停用」的预设视图）。

## 9. 实施记录（2026-10-27）

按 §8 拍板的路径 B 执行完毕。

### 实际改动

- [src/service/plugin-inventory.ts](../../src/service/plugin-inventory.ts)（新增，约 330 行）：`readPluginInventory()` 用 `resolveDshInstall()` 的启动方式 spawn `dsh --profile <profile> --dump-config`（15s 超时 / 16MB 缓冲 / `buildSpawnEnv`），解析成 `{ bundle, version, rows[{id,name,state,fromUserPatch}] }`；`parsePluginDump()` 纯函数（按 `# == <bundle>[, patched by <layer>]` 分段、只取行首 `- id:` 的顶层条目、同一 id 按后续层原地覆盖、排除 `cordis:group` 分组行）；版本按「profile 的 node_modules → 可执行文件 realpath 后逐层 `node_modules/<pkg>/package.json`」查找；清单缓存 15s（key 含 patch mtime，外部改动自动失效）；`clearPluginInventoryCache()` / `resolveDshHome()` / `profileDirOf()` / `profilePatchPath()` 导出。
- [src/service/plugin-patch.ts](../../src/service/plugin-patch.ts)（新增，约 290 行）：`editPatchText()` 纯函数做最小 YAML 覆盖（更新最后一个同 id 覆盖条目的 `disabled`；无条目则追加 `- id: …\n  disabled: true`；启用时删 `disabled` 行，只剩 id + name 的条目整条移除；块尾属于下一项的注释保留；`!!js` 条件行拒绝改动）；`togglePluginEnabled()` 负责写前备份 `cordis.patch.yml.bak-YYYYMMDD-HHmmss`（本地时间，同秒自动加序号）、临时文件 + rename 原子写（mode 0600）、写后 `verify()` 失败自动回滚。
- [src/shared/types.ts](../../src/shared/types.ts)：新增 `DshPluginRowState` / `DshPluginRow` / `DshPluginBundle` / `DshPluginInventory`。
- [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts)（新增，约 330 行）：状态行（profile / dsh 版本 / bundle 数 / 组件数与三态统计，title 显示 profile 目录与 patch 路径）、「重新读取」「重启服务」、说明行、提示行、筛选框、分组卡（折叠 / 版本 / 统计 / 键盘可操作）、行内 `ToggleComponent`（条件行显示「自动」）、loading / 错误 / 空态；启停后提示「点「重启服务」后生效」并同步统计。
- [src/settings/context.ts](../../src/settings/context.ts)：`SettingsHost` 增加 `getPluginInventory(refresh?)` / `setPluginEnabled(row, enabled)`。
- [src/settings/tab.ts](../../src/settings/tab.ts)：`SettingsSectionId` 加 `'plugins'`，`SECTIONS` 追加第 5 项「插件」。
- [src/main.ts](../../src/main.ts)：实现两个 `SettingsHost` 方法（`inventoryOptions()` 复用 `resolveDshInstall(settings.dshPath)` + profile + vault cwd；启停后用 `--dump-config` 复验该行状态，不一致由 service 回滚并抛错）；成功后写 `[obsidian-dsh]` 日志（含备份路径）。
- [styles.css](../../styles.css)：约 +190 行 `.dsh-settings-plugins*`（分组卡 / 行 / 开关区 / 筛选框 / 提示 / 空态；只用主题变量）。
- docs：本提案、[docs/changes/README.md](README.md) 索引、[docs/roadmap.md](../roadmap.md) R-14 行、[docs/development.md](../development.md)（改动地图 + 回归清单 44–46）、[docs/architecture.md](../architecture.md)（关注点表 + 目录树）、[README.md](../../README.md)（设置页与「插件」tab）、[docs/troubleshooting.md](../troubleshooting.md)（读不出清单 / 启停未生效 / 恢复备份）。
- 未改：`src/view/`、`packages/dsh-obsidian-bridge/`、`src/service/manager.ts`、`src/settings/schema.ts`（本功能不新增设置项，`data.json` 结构不变）。

### 验证结果（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 0.4.1）

- `npm run build` 通过（tsc + esbuild；`main.js` 约 260.7kb）。
- `npm run check` 全绿（版本三处一致、无运行时依赖、tsc、bridge 清单与语法、`main.js` 与源码一致）。
- 纯函数 / service 冒烟（esbuild 打包到 /tmp 后用 node 跑；真实 `--dump-config` 在 `/tmp` 的 `DSH_HOME` 副本上执行）：
  - 解析：3 个 bundle（base 97 / web-app 98 / bridge 1）、196 个组件行、24 停用 / 9 条件 / 163 运行；bridge 作为独立 bundle 段；`cordis:group` 分组行被排除；用户层覆盖行 `agent-default-model` / `llm-pi-ai` / `llm-deepseek` / `ui-settings-general` / `agent-preset-registry` 标记正确；版本解析 `0.2.1-rc.3` ×2 + `0.3.0`；
  - 性能：首次读取 126–153ms，缓存命中 0ms；
  - 写入：`[]` 追加、带 config 条目插入 / 删除 `disabled`、只剩 id+name 的条目整条移除且保留下一项前的注释、`!!js` 行拒绝、重复停用无改动；备份内容 = 写入前、原子写生效、`verify=false` 自动回滚且内容逐字节一致。
- CDP 实测（设置窗口的 5 个 tab：服务 / dsh 版本 / 聊天 / 集成 / 插件）：
  - 「插件」tab：summary「profile obsidian · dsh 0.2.1-rc.3 · 3 个 bundle / 196 个组件（运行中 163 · 已停用 24 · 条件 9）」；分组标题与统计（base 97 / web-app 98 / bridge 1）；筛选 `llm` → 7 行且自动展开；`hmr` 等条件行显示「由 dsh 决定 / 自动」且**没有**开关；截图见实施时记录。
  - 端到端：停用 `ui-settings-general` → 行变「已停用」、统计 162/25、patch 增 `  disabled: true`、生成 `cordis.patch.yml.bak-20261027-153543`；点「重启服务」→ 服务重启（`isRunning() = true`、状态栏「DSH: 运行中」、桥 v5 连接正常）；再启用 → 行回「运行中」、patch 与测试前 `shasum` 完全一致；再次重启 → 统计回到 163/24/9。
  - 运行前后 vault / `data.json` / 原生聊天均未受影响。

### 与提案的偏差

- 组件行只取**顶层条目**：preset 内的嵌套行（107 行）与 `cordis:group` 分组行不单独展示（与 dsh 官方 inventory「只暴露非 group 条目」口径一致）；如需展开 preset 内部，属于后续增强。
- `--dump-config` 会重写 profile 的 `cordis.yml`（`[]`，与 dsh boot 行为一致）——已写进 troubleshooting，不做拦截。
- 备份时间戳用**本地时间** `YYYYMMDD-HHmmss`（提案只写了 `.bak-<时间戳>`）。
- 启停复验放在 `main.ts` 注入的 `verify()` 里（service 只负责写 / 备份 / 回滚），比提案描述的「service 内部复验」少一层依赖。
- 未实现 bundle 级启停（C）与安装 / 卸载（D），按拍板结果留作后续需求。

