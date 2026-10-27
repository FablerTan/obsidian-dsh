---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户当轮明确指定「在设置面板启用实验插件」，按 AGENTS.md 规则 12 例外视为已批准
scope: src/service, src/settings, src/shared, styles.css, docs
issue: 「插件」tab 看不到官方面板里的实验性 / 可选插件，需要能在设置面板里启用它们
---

# 0032 可选 / 实验性插件：在设置面板里启用

> 对应路线图 [R-15](../roadmap.md#需求待办)。承接 [0031](0031-plugin-management-tab.md)（组件行清单 + 逐行启停）。

## 1. 背景与问题

0031 上线后，「插件」tab 只能列出 `dsh --profile obsidian --dump-config` 的**组合结果**。
用户对照官方面板的「实验性插件」区发现少了东西，问：为什么看不到、想在这里启用实验插件。

调研结论（本机 dsh 0.2.1-rc.3）：

- 官方面板的「实验性插件 / 更多」是 **optional bundle**：随 dsh 安装提供、默认不启用，
  不在 profile 的 `dsh.profile.bundles` 里，所以**没有参与组合**，dump-config 里自然没有它们的行。
- 名单来自 dsh 自带的 `@deepseek-ai/dsh-official-bundles`：
  `OPTIONAL_BUNDLES`（本机 14 个）、`EXPERIMENTAL_BUNDLES`（13 个，Set）、`ON_DEMAND_BUNDLES`（2 个：`dsh-subagent-claude-code` / `dsh-subagent-codex`，需要先 `dsh plugin add`）。
- 这些包随安装解析得到：用 dsh 自己的 `createRequire(installAnchor).resolve.paths` 能找到（本机在
  `…/apps/cli/node_modules/@deepseek-ai/` 下）。启用**只需要**把包名写进 profile 的
  `package.json` → `dsh.profile.bundles`，**不需要 pnpm、不需要改 dependencies**（实测在 `/tmp` 的 profile 副本上把
  voice-input / badge-skill 加进 bundles 后，`--dump-config` 立刻出现对应分层）。
- 每个可选 bundle 的展示信息：`package.json`（version / description / icon）+ `locale/zh.json` 的
  `meta.title` / `meta.description`（如「语音输入」/「智能体团队」）。

## 2. 目标与非目标

### 目标

- 「插件」tab 顶部新增「**可选 / 实验性插件**」卡片：列出官方目录里的可选 bundle（中文标题、包名、版本、「实验性」标记、描述），
  开关 = 写 profile 的 `dsh.profile.bundles`；已启用的显示为开。
- 写入沿用 0031 的约定：**写前备份**（`package.json.bak-<时间戳>`）、原子写、**写后重新组合复验**，失败自动回滚。
- 启用后立刻重读组合结果（新 bundle 的分组与组件行随即出现），并提示「点『重启服务』后生效」。
- 目录读不到（旧 dsh / 安装不完整）时给出说明，不影响 0031 的清单与启停。
- `ON_DEMAND_BUNDLES`（claude-code / codex）只提示「需要先 `dsh plugin add`」，不做安装。

### 非目标

- 不做安装 / 卸载 / 更新（pnpm 转发、网络、安装脚本授权）——与 0031 的非目标一致。
- 不做官方目录包「按需下载」、不做官方/实验性分组之外的分类（内置配置、更多菜单）。
- 不改变 profile 的 `dependencies`；不动 `cordis.patch.yml`（那是组件行启停）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）本地目录 + JSON 写入** | `service/plugin-catalog.ts`：用 `createRequire(installAnchor).resolve.paths` 找 `@deepseek-ai/dsh-official-bundles`，`require(entry)` 取三份名单（旧 Node 回落真正的 `import()`），再逐包解析目录读版本 + `locale/zh.json`；`service/plugin-bundles.ts`：`editBundlesJson()` 纯函数 + `setBundleEnabled()`（备份 / 原子写 / 复验回滚）；`main.ts` 注入 `getOptionalCatalog` / `setBundleEnabled`；`sections/plugins.ts` 渲染卡片 | 2 个新 service 文件 + settings / main / types / styles，约 600 行 | 无桥改动、不需要 relink、不需要 pnpm；写入只动一个 JSON 数组，回滚容易。风险：目录包是 ESM，Electron 渲染进程里 `import()` 走浏览器加载器加载不了 `file://`（已实测失败）→ 需要 `require(ESM)`（Obsidian 自带 Node 24 支持），旧 Node 回落 `import()`；名单随 dsh 版本变化但**不复制名单**，自动跟随 | **推荐**：与 0031 同一条数据链（都走 profile 文件 + 复验），改动可控 |
| B 桥 v6 调官方 Remote | `packages/dsh-obsidian-bridge/lib/client.js` 增加 `bundles()` / `setBundleEnabled()`，内部 `ctx.inject(['remote','remote.pluginManager'], …)` 调 `listBundles` / `setBundleEnabled`；原生端 `core-bridge.ts` + 设置页消费 `BundleInfo` | 桥 + 原生端 + 设置页 | 数据最全（official / updatable / error / rows / 版本 / 安装日志事件），与官方面板 1:1。但：要改桥、relink、重启；**设置页依赖聊天面板打开**（隐藏 core 才有桥）；耦合 dsh 内部 Remote 契约 | 不推荐本期：可用性与维护成本都更差 |
| C 扫描安装 node_modules | 遍历安装锚点的 `node_modules`，凡 `package.json` 带 `dsh.bundle.patch` 的包都当成候选 | 1 个 service 文件 | 能发现所有 bundle，但会把 `dsh-acp-app` / headless / sdk 这类 **app bundle** 也列出来，误启用可能把 profile 搞坏；dev checkout 的可选插件挂在 `apps/cli/node_modules`，扫描路径要先猜 | 不推荐：没有官方名单做边界 |
| D 硬编码名单 | 把 14 个包名写进 `src/shared/` | 1 个文件 | 最简；但 dsh 升级后名单必漂移，维护成本转嫁给用户 | 不推荐：与「文档/代码跟 dsh 版本走」相悖 |

**推荐 A**：官方目录包本身就是「哪些可选、哪些实验性」的唯一权威；读它比自己维护名单可靠。启用只写一个 JSON 数组，
和 0031 的 patch 写入共用「备份 / 原子写 / 复验 / 回滚」这套约定，风险与实现都最容易审。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/service/plugin-catalog.ts](../../src/service/plugin-catalog.ts)（新增） | `readOptionalCatalog()`：解析安装锚点 → 找 `@deepseek-ai/dsh-official-bundles` → `require(ESM)`（失败回落 `import()`）取 `OPTIONAL_BUNDLES` / `EXPERIMENTAL_BUNDLES`(Set) / `ON_DEMAND_BUNDLES`；逐包解析目录读 version + `locale/zh.json` 的 `meta.title`/`meta.description`；已启用状态读 profile `package.json`；15s 缓存（含 profile mtime） |
| [src/service/plugin-bundles.ts](../../src/service/plugin-bundles.ts)（新增） | `editBundlesJson()` 纯函数（增 / 删 `dsh.profile.bundles`，保留其它字段、2 空格缩进 + 结尾换行）；`setBundleEnabled()`：备份 `package.json.bak-<时间戳>`、原子写（0600）、复验失败回滚 |
| [src/shared/types.ts](../../src/shared/types.ts) | `DshOptionalBundle` / `DshOptionalCatalog` |
| [src/settings/context.ts](../../src/settings/context.ts) | `SettingsHost` 增加 `getOptionalCatalog(refresh?)` / `setBundleEnabled(name, enabled)` |
| [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts) | 顶部「可选 / 实验性插件」卡片：标题带「已启用 N 个」、14 行（中文标题 / 包名 · 版本 · 实验性 / 描述 / 开关），启用后重读组合结果；目录不可用时显示说明；`ON_DEMAND_BUNDLES` 提示需先安装；提示行补 `package.json` 的写入目标 |
| [src/main.ts](../../src/main.ts) | 实现两个 host 方法；`setBundleEnabled` 先用目录校验「只动可选 bundle」（防误删 dsh-base / web-app / 桥），写后复验用 `--dump-config` 是否包含该 bundle 层 |
| [styles.css](../../styles.css) | `.dsh-settings-plugins-optional` / `.dsh-settings-plugins-row-desc` / 静态分组头 / 目录提示 |
| docs | 本提案、索引、roadmap R-15、development（改动地图 + 回归 47–49）、architecture（关注点 + 目录树）、README（插件 tab）、troubleshooting（可选插件 / 备份恢复） |

## 5. 行为变化

- 「插件」tab 顶部出现「可选 / 实验性插件」卡片：14 个包（本机），中文标题 + 包名 + 版本 + 「实验性」标记 + 一行描述。
- 打开某个开关 → 写 profile `package.json` 的 `dsh.profile.bundles`（先备份），立刻重读组合结果：
  下方多出该 bundle 的分组与组件行；提示「点『重启服务』后生效」。关闭同理（分组消失）。
- 重启服务后，dsh 真正加载 / 卸载该 bundle；原生聊天面板照常连接。
- `ON_DEMAND_BUNDLES`（claude-code / codex）显示为提示行，不提供开关。
- 目录读不到时显示原因（如「这个 dsh 安装没有提供可选插件目录」），组件行清单与启停不受影响。
- 0031 的行为（组件行启停、条件行只读、筛选、统计）不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| Electron 渲染进程加载不了 ESM 目录包 | 卡片显示「读取可选插件目录失败」 | 已实现 `require(ESM)` + `import()` 双路径；都失败时只影响这张卡片 |
| 启用了起不来的实验性插件 | 服务启动失败 / 面板报错 | 关掉同一个开关 → 重启；或把 `package.json.bak-<时间戳>` 覆盖回去再重启 |
| 误把基础 bundle 删掉 | 服务 / 原生面板直接不可用 | host 侧只允许启停目录里的可选 bundle；基础层不在名单里，删不到 |
| 写坏的 package.json（磁盘 / 权限） | 服务起不来 | 写前备份 + 原子写 + 复验失败自动回滚；失败文案给出备份路径 |
| 实验性插件首次使用要下载运行时（如语音输入 SenseVoice） | 首次使用慢 / 需要网络 | 属于插件自身行为；不用时关掉开关 + 重启即恢复 |

整体回滚：关掉开关（或还原 `package.json.bak-*`）→ 重启服务；不改任何代码即可回到 0031 的状态。

## 7. 验证

自动化：

```bash
npm run build   # tsc + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

service 冒烟（esbuild 打包 `plugin-catalog.ts` / `plugin-bundles.ts` 到 /tmp 后用 node 跑）：

- 目录：解析到 `…/apps/cli/node_modules/@deepseek-ai/dsh-official-bundles`；14 个可选包、13 个 `experimental`、中文标题（含「语音输入」「智能体团队」）、2 个 on-demand；
- `editBundlesJson`：追加 / 移除 / 幂等 / 空清单 / 非法 JSON；`setBundleEnabled`：备份内容 = 写入前、复验失败回滚后内容不变。

手动回归（Obsidian 内）：

1. 打开「插件」tab：卡片显示 14 个可选插件，全部关闭。
2. 打开「语音输入」→ 组合结果多出 4 个组件行（200 行 / 4 bundle），`package.json` 增加一项并生成备份。
3. 点「重启服务」→ 服务重启成功、状态栏「运行中」、原生面板桥连接正常。
4. 关掉「语音输入」→ `package.json` 与改动前 **sha 完全一致**，组合结果回到 3 bundle / 196 行；再重启服务 → 正常。
5. 目录不可用时（换一份旧 dsh）卡片显示说明，清单与组件行启停不受影响。

**验收标准**：可选插件全部列出且可启停；启用 / 停用后 `package.json` 变化正确且有备份；重启后服务与原生聊天正常；`npm run build` / `npm run check` 通过。

## 8. 拍板结果

- [x] 需求由用户当轮明确指定（「设置面板里启用实验插件」），按 [AGENTS.md](../../AGENTS.md) 规则 12 例外视为已批准，直接实现。
- [x] 路径：**A**（本地读官方目录 + 写 profile `dsh.profile.bundles`），不做桥、不做 pnpm。
- [x] 范围：可选 / 实验性插件「启用 / 停用」；安装 / 卸载 / 更新与 on-demand 安装不做。

## 9. 实施记录（2026-10-27）

### 实际改动

- [src/service/plugin-catalog.ts](../../src/service/plugin-catalog.ts)（新增，约 250 行）：`readOptionalCatalog()` + `clearOptionalCatalogCache()`；安装锚点复用 `plugin-inventory` 的 `resolveExecutable`；`require(ESM)` 优先、`import()` 兜底（Electron 渲染进程里 `import()` 实测加载不了 `file://` ESM）；`EXPERIMENTAL_BUNDLES` 兼容 Set / 数组两种形态；15s 缓存 + profile `package.json` mtime。
- [src/service/plugin-bundles.ts](../../src/service/plugin-bundles.ts)（新增，约 160 行）：`editBundlesJson()` + `setBundleEnabled()`（备份 / 原子写 / 复验回滚）。
- [src/shared/types.ts](../../src/shared/types.ts)：`DshOptionalBundle` / `DshOptionalCatalog`。
- [src/settings/context.ts](../../src/settings/context.ts)：两个新 host 方法。
- [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts)：顶部可选插件卡片（14 行、中文标题、实验性标记、描述、开关、已启用计数）、on-demand 提示、目录失败提示；启停后重读组合结果；修正「重读时把刚写好的成功提示清空」的顺序问题。
- [src/main.ts](../../src/main.ts)：`getOptionalCatalog` / `setBundleEnabled`；写入前用目录做白名单校验（只允许可选 bundle），写后以 `--dump-config` 是否包含该 bundle 层复验。
- [styles.css](../../styles.css)：可选卡片样式（约 +30 行）。
- [src/service/plugin-inventory.ts](../../src/service/plugin-inventory.ts)：导出 `resolveExecutable` / `installAnchors`（供目录解析复用）。
- docs：本提案、索引、roadmap R-15、development、architecture、README、troubleshooting。

### 验证结果（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 0.4.1）

- `npm run build` 通过（`main.js` 约 270.8kb）；`npm run check` 全绿。
- service 冒烟：目录解析到 `~/dsh/deepseek-harness/apps/cli/node_modules/@deepseek-ai/dsh-official-bundles`；14 个可选包、13 个实验性、中文标题（个性化推荐 / Computer Use / 会话搜索 / Ralph 循环 / 持久终端 / DSH 徽章技能 / 随对话更新的标题 / 智能体团队 / 语音输入 / 思考过程机器翻译 / 自动授权审查 / 开发者工具 / 自定义插件索引 / Git 工作树）、2 个 on-demand；`editBundlesJson` 与 `setBundleEnabled` 用例全过。
- CDP 实测：
  - 设置页「插件」tab 顶部卡片：14 行、全部关闭、「共 14 个 · 已启用 0 个」；on-demand 提示正确；
  - 启用「语音输入」→ `package.json` 增加 `@deepseek-ai/dsh-experimental-voice-input-bundle` + 生成备份；组合结果立刻变 4 bundle / 200 行，出现该 bundle 分组；卡片显示「已启用 1 个」；
  - 点「重启服务」→ `isRunning() = true`、状态栏「DSH: 运行中」、桥 v5 连接正常；
  - 停用「语音输入」→ `package.json` 与改动前 **sha 完全一致**（`c4a05f49…`），组合结果回到 3 bundle / 196 行；再重启 → 服务与桥正常；
  - 验证产生的 `package.json.bak-*` 已清理，profile 恢复原状。

### 与提案的偏差

- 目录包的加载方式从「动态 import」改为「`require(ESM)` 优先 + `import()` 兜底」：Electron 渲染进程里 `import()` 走浏览器加载器，加载不了 `file://` 的 ESM（实测报 Failed to fetch dynamically imported module）。
- `setBundleEnabled` 在 host 侧加了「只允许目录内可选 bundle」的白名单校验（提案未写，属于防御）。
- 其余与提案一致；未动桥、未动组件行启停逻辑。
