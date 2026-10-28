---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28       # 用户当轮选定路径 A
scope: manifest / docs / src（合规清理）/ README
issue: 上架 Obsidian 官方社区目录（community.obsidian.md）：满足 manifest 规则、清零官方 ESLint error、补 README 披露，发布 1.0.0
---

# 0055 上架 Obsidian 官方社区目录（1.0.0 合规改造）

> 对应路线图 [R-38](../roadmap.md#需求待办)。用户原话：「怎么发布到 Obsidian 的官方仓库啊」→ 给出流程与本仓库阻断项后选定**路径 A：一次到位**。
> 官方流程已变更：不再人工提 PR 到 obsidian-releases，改为在 [community.obsidian.md](https://community.obsidian.md) 用 Obsidian 账号提交，目录自动扫描 Manifest / Releases / Source code / Build verification（error 阻断，warning 不阻断）。参考：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)、[Submission requirements](https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins)、[Developer policies](https://docs.obsidian.md/Community+directory/Developer+policies)、[Manifest](https://docs.obsidian.md/Reference/Manifest)。

## 1. 背景与问题

2026-10-28 用官方 `eslint-plugin-obsidianmd`（0.4.2，目录扫描同一套 recommended 规则）扫本仓库：**19 error / 35 warning**，另有 manifest 硬性不合规：

| 类别 | 现状 | 判定 |
|---|---|---|
| `id` | `obsidian-dsh` | 违反「id 不能包含 obsidian」（legacy 插件为历史遗留，新提交会被拦） |
| `name` | `DSH in Obsidian` | 违反「name 不能含 Obsidian 及变体」 |
| `authorUrl` | `https://127.0.0.1:3080` | 指向本机 dsh 地址，非作者主页 |
| `description` | 中文 + 全角标点，不以 `.` 结尾 | 要求动作句、≤250 字符、句号结尾、无 emoji / 特殊字符 |
| `minAppVersion` | `1.4.0` | 代码用了 `Workspace.revealLeaf`（`@since 1.7.2`）→ `no-unsupported-api` error |
| Source code | 17 条其它 error（`no-console` / `no-new-func` / `no-static-styles-assignment` / `no-manual-html-headings` / `no-misused-promises` / `prefer-promise-reject-errors` / `no-control-regex` / `no-useless-escape` / `no-unnecessary-type-assertion` / `eslint-comments/require-description` / `react-hooks/*` 未定义规则） | 目录「Source code」段直接报错 |
| README | 无网络 / vault 外文件 / 子进程 / 外部依赖披露 | Developer policies 要求「clearly indicated in your README」 |

> identifier 一旦通过提交就不能再改（改名会重置下载量、要求所有用户重装），所以必须在首次提交前一次改到位。

## 2. 目标与非目标

### 目标

- manifest 完全合规：新 `id` / `name` / 英文 `description` / 合法 `authorUrl` / `minAppVersion` ≥ 1.7.2；
- 官方 ESLint recommended **error 清零**（warning 尽量削减，不阻断）；
- README 补齐政策要求披露：本机网络、vault 外文件、子进程、外部依赖 dsh、付费类型；
- 版本升到 **1.0.0**（manifest / package.json / versions.json 三处一致 + 新键），重新构建 `main.js`，出 release 供目录扫描；
- 仓库内落地 `lint` 脚本与 `eslint.config.mjs`，`npm run check` 增加 manifest 合规校验，避免下次发版再踩。

### 非目标

- 不改插件功能行为、不改桥协议（`dsh-obsidian-bridge` 仍 0.5.0 / API v8）、不改 dsh 源码；
- 不改 GitHub 仓库名 / URL（仍 `FablerTan/obsidian-dsh`）、不改 npm 包名、不改 profile / 端口默认值；
- 不代用户提交 community.obsidian.md 表单（需要 Obsidian 账号 + GitHub OAuth，由用户点）；
- 不改历史提案 `docs/changes/00xx`（历史记录不重写）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（用户选定）一次到位** | 改 id/name/描述/authorUrl/minAppVersion → 清 19 个 error → README 披露 → 1.0.0 + 新 release → 直接提交；id 变更作为 1.0.0 破坏性升级写进文档 | manifest + src（合规清理）+ README + docs + scripts | 中；id 变更导致已装用户需重装 / 设置不迁移；但一次性避免「先上架再改名重置下载量」 | **采用** |
| B 分两步（先 beta） | 先只做 manifest + README + minAppVersion 最小集，用 BRAT 发 beta；之后再统一清 lint 并改 id | 同上，分两次 | 小步但重复改 manifest 两次；beta 期间 id 仍是违规值，无法提交 | 不采用 |
| C 只本地预检不上架 | 加 lint 工具链、修 error，但不改 id/name、不发 release | src + scripts | 最低风险；但永远无法提交（id / name 不合规） | 不采用 |

> 用户 2026-10-28 回复「A」。

### 已定的实施细节（路径内的次决策）

- **id**：`dsh-native-chat`（对现有 9570 条目录条目核对：id / name 均未被占用）。
- **name**：`DSH Native Chat`（不含 Obsidian；与已上架的 `DSH` / `DSH Bridge` / `DeepSeek Harness` 等 14 个同类不重名）。
- **minAppVersion**：`1.7.2`（`revealLeaf` 的下限；webview 承载仍以 1.14.4 实测为准，README 写明）。
- **description**（英文、动作句、句号结尾、≤250）：`Chat with a local DeepSeek Harness agent in a native side panel, with streaming replies, tool calls, and vault-aware sessions.`
- **authorUrl**：`https://github.com/FablerTan`（删掉本机 127.0.0.1 地址）。
- **日志前缀**：`[obsidian-dsh]` → `[dsh-native-chat]`；info 日志由 `console.log` 改 `console.debug`（官方 guideline：默认控制台只应有 error；实测 `console.debug` 不被 `no-console` 命中，而 `eslint-disable` 被 `eslint-comments/no-restricted-disable` 禁止）。
- **样式动态值**：`no-static-styles-assignment` 只对**字面量**赋值报错；`el.style.height = 'auto'` 改为 `removeProperty('height')` / CSS 变量，保留自动高度行为。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `manifest.json` | id / name / version 1.0.0 / minAppVersion 1.7.2 / 英文 description / authorUrl |
| `package.json`、`package-lock.json` | version 1.0.0；新增 devDeps `eslint`、`eslint-plugin-obsidianmd`；新增 `lint` 脚本 |
| `versions.json` | 追加 `"1.0.0": "1.7.2"` |
| `eslint.config.mjs`（新增） | 官方 `obsidianmd.configs.recommended` + projectService |
| `scripts/check.mjs` | 增加 manifest 合规校验（id 规则 / name 不带 Obsidian / description 长度与句号 / authorUrl 非本机 / minAppVersion） |
| `src/**` | 清 19 个 ESLint error；日志前缀改名；info 日志改 `console.debug`；设置页标题不写插件名（官方 `no-problematic-settings-headings` 禁止重复插件名，删除原 `h2`） |
| `README.md` | 英文介绍 + 披露（网络 / vault 外文件 / 子进程 / 外部依赖 / 付费）+ 新 id / 安装路径 / 命令 id |
| `docs/install.md`、`docs/development.md`、`docs/architecture.md`、`docs/troubleshooting.md`、`docs/obsidian-cdp.md`、`skills/project-guide/SKILL.md`、`AGENTS.md` | 同步 id / name / 版本 / 安装目录 / 命令 id / 日志前缀；install 增加「0.6.x → 1.0.0 id 变更迁移」小节 |
| `docs/roadmap.md`、`docs/changes/README.md` | R-38 登记 + 0055 索引 |

## 5. 行为变化

- 插件 id 由 `obsidian-dsh` → `dsh-native-chat`：安装目录变成 `<vault>/.obsidian/plugins/dsh-native-chat`；命令 id 变成 `dsh-native-chat:open-dsh-view` / `dsh-native-chat:restart-dsh-service`；控制台前缀变成 `[dsh-native-chat]`。
- 0.6.x 已装用户升级到 1.0.0 需要：重命名 / 重建插件目录（符号链接安装则重命名链接名），设置 `data.json` 不会自动迁移（本仓库用符号链接安装，`data.json` 仍落在仓库根，不受影响）。
- 功能、桥协议、profile / 端口默认值、dsh 版本支持范围（0.2.x）不变。

## 6. 风险与回滚

- 风险：id 变更后用户需重装；官方扫描若仍有 error 会阻断上架（用本地 `npm run lint` + `npm run check` 预检，且目录提供 Review branch 预扫）。
- 回滚：id / name / 版本在原 0.6.7 release 上仍可下载；若 1.0.0 扫描失败，可回退 manifest 到 0.6.7 并保留仓库可用（已装用户不受影响）。

## 7. 验证方式

```bash
npm run build     # tsc + esbuild，无错误
npm run check     # 版本三处一致 / 产物一致 / manifest 合规
npm run lint      # 官方 eslint-plugin-obsidianmd recommended，0 error
```

手动回归（[docs/development.md](../development.md#现状与手动回归)）：重载插件 → 状态栏 `DSH: 运行中` → 面板连接（桥 v8）→ 发消息流式 → 重启服务 → 禁用插件端口释放；另验证设置页左侧名称为 `DSH Native Chat`（来自 manifest.name；设置页内容区不再重复插件名）、控制台前缀为 `[dsh-native-chat]`（info 走 `console.debug`，需在开发者工具里打开 Verbose 级别）。

## 8. 需要你拍板的问题

- [x] 路径：A（用户 2026-10-28 选定）。
- [x] 名称 / id：`DSH Native Chat` / `dsh-native-chat`（已核对目录无冲突）。
- [x] minAppVersion：1.7.2（代码 API 下限）。
- [ ] 提交 community.obsidian.md：由用户在网页完成（需 Obsidian 账号 + 关联 GitHub）。

## 9. 实施记录

2026-10-28 完成（路径 A）：

- **manifest**：id `dsh-native-chat` / name `DSH Native Chat` / version `1.0.0` / minAppVersion `1.7.2` / 英文 description / authorUrl `https://github.com/FablerTan`；`versions.json` 追加 `"1.0.0": "1.7.2"`。
- **src**：19 个官方 ESLint error 清零 —— `new Function` 换原生动态 `import()`、`console.log` → `console.debug`、`style.height='auto'` → `removeProperty`、`h2` 标题按 `no-problematic-settings-headings` 去掉、控制字符正则换 `\p{Cc}`、多余转义 / 断言 / disable 指令清理；日志前缀 `[dsh-native-chat]`。
- **工具链**：新增 `eslint.config.mjs` 与 `npm run lint`（官方 `eslint-plugin-obsidianmd` recommended，与目录 Source code 扫描同一套）；`npm run check` 增加 manifest 合规校验（id / name / description / authorUrl / minAppVersion）。
- **文档**：README 重写为英文介绍 + 政策披露（本机网络 / vault 外文件 / 子进程 / 外部依赖 / 无遥测）；install 增加 0.6.x → 1.0.0 迁移小节；development / architecture / troubleshooting / obsidian-cdp / AGENTS / bridge README 同步 id、名称、版本、日志前缀与 lint 说明。
- **验证**：
  - `npm run build` ✓（main.js 323.8 KB）
  - `npm run check` ✓（版本三处一致、manifest 合规、tsc、main.js 与源码一致、桥清单与语法）
  - `npm run lint` ✓ **0 error / 33 warning**（改造前 19 error / 34 warning；warning 均为 `ui/sentence-case` / `prefer-window-timers` 等不阻断项）
  - GUI 手动回归由用户在自己的 vault 做（本机 vault 仍指向旧 id 目录，需要按 install 迁移小节改名）
- **Release**：v1.0.0（tag 与 manifest version 一致），附 `main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`。
- **待用户执行**：community.obsidian.md 登录 → 关联 GitHub → Plugins → New plugin 提交（自动扫描四项，error 清零后可安装）；提交前可先用 Review branch 预扫。

