---
status: done               # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28       # 用户当轮明确要求：推送更新到 GitHub，Releases 只写版本更新内容
scope: manifest.json / package.json / package-lock.json / versions.json / README.md / docs
issue: 发布 1.1.0：把 0056–0060 的改动提交并推送到 GitHub，创建 Release（正文只写版本更新内容）
---

# 0061 发布 1.1.0（推送 GitHub + Release 只写版本更新内容）

> 对应路线图 [R-44](../roadmap.md#需求待办)。用户原话：「参考dsh的官方发布文档，帮我将项目更新推送到github上，Releases页面只写版本更新内容」。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外（用户当轮已明确指定要做的具体项，视为已批准），本提案登记版本决策与发布内容。

## 1. 背景与问题

R-39–R-43（[0056](0056-dsh-stop-button.md) / [0057](0057-desktop-app-dsh.md) / [0058](0058-selection-quote.md) / [0059](0059-live-selection-preview.md) / [0060](0060-quote-preview-clickable.md)）的代码与文档已全部落地并通过各自验证，但仍在工作区未提交；GitHub 上最新提交与 Release 都停在 1.0.0（2026-10-28 上架社区目录那一版）。

同时，1.0.0 的 Release 正文包含「两种装法 / 校验」等安装与验证说明。用户要求这次 Releases 页面**只写版本更新内容**（参考 dsh 官方发布文档的写法）：不再重复安装步骤，安装细节统一指向 [docs/install.md](../../docs/install.md)。

## 2. 目标与非目标

### 目标

- 把 0056–0060 的代码、文档、构建产物（`main.js`）作为一个版本提交并推送到 `origin/main`；
- 版本号从 1.0.0 升到 **1.1.0**（三处一致：`manifest.json` / `package.json` / `versions.json`），并同步 `package-lock.json` 与文档里的版本字样；
- 打 tag `v1.1.0`，创建 GitHub Release，正文**只写本版更新内容**（不写安装步骤、不写校验清单）；
- 上传发布资产：`main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`。

### 非目标

- 不改任何功能代码（0056–0060 已实现并验证；本次只做版本号、文档字样、提交与发布）；
- 不改桥 `dsh-obsidian-bridge`（仍 0.5.0 / API v8，无需重装）；
- 不动 Obsidian 社区目录的提交状态（1.0.0 的目录提交仍由用户在网页完成）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次采用）1.1.0 minor 发布** | 0056–0060 都是向后兼容的新功能（服务管理按钮、桌面 App dsh 探测、选区引用），按 SemVer 升 minor；一个 `feat:` 提交 + tag + Release。 | 版本三处 + `package-lock` + README / roadmap / install 的版本字样；新增本提案。 | 低：与既有发布节奏一致（0.5.0 / 0.6.7 / 1.0.0 都是 feat 提交 + tag）；社区目录能识别到新版本。 | **推荐** |
| B 1.0.1 patch 发布 | 当作补丁版本发。 | 同上 | 语义错误：新增了可见功能，用户与社区目录会误判为纯修复。 | 否掉 |
| C 不升版本，只推一个提交 / 草稿 Release | 不 bump，直接 push / 建 draft。 | 只提交与推送 | Obsidian 社区目录按 `manifest.version` 识别更新，不升版本不会分发；且与「发布」诉求不符。 | 否掉 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `manifest.json` / `package.json` / `package-lock.json` | 版本 1.0.0 → 1.1.0（lock 文件根与 `packages[""]` 两处） |
| `versions.json` | 追加 `"1.1.0": "1.7.2"` |
| `README.md` | 英文 / 中文头部版本字样 → 1.1.0 |
| `docs/roadmap.md` | 当前版本 → 1.1.0；新增 R-44 行 |
| `docs/install.md` | 事实核对行、`VERSION` 示例与成功判据里的版本 → 1.1.0（历史迁移章节保留 1.0.0 字样） |
| `docs/changes/README.md` | 索引追加 0061 |
| 发布资产 | `main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`（zip 由 `packages/dsh-obsidian-bridge/` 现打包，结构与 1.0.0 资产一致） |

## 5. 行为变化

无功能行为变化；只有版本号与文档字样变化。发布页正文只列本版更新内容：

- 设置页「结束后台 dsh」+ 重启 / 结束就地进度与结果；
- 支持桌面 App 内置的 dsh（macOS / Windows）；
- 编辑器选区引用（实时预览、发送附带、引用卡、点击跳回高亮、摘录上限设置）；
- 面板空白点击不再抢编辑区焦点。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 版本三处不一致 | `npm run check` 拦截，pre-commit 钩子会拒绝提交 | 按检查输出补齐；不要跳过钩子 |
| `main.js` 与源码不一致 | 发布出去的产物不是当前源码的构建结果 | `npm run build` 后重新提交；`npm run check` 逐字节校验 |
| Release 正文混入安装步骤 | 不符合用户「只写版本更新内容」的要求 | 用 `gh release edit v1.1.0 --notes-file` 重写 |
| 资产名与安装文档不一致 | A 路线 `curl` 404 | 按 1.0.0 的资产名（`main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`）上传 |
| 推送后才发现问题 | 远端已有 tag / Release | 修正提交后补发 1.1.1；不要强推已发布的 tag |

## 7. 验证

- `npm run build` 通过，`main.js` 与源码一致（`npm run check` 内存构建逐字节比对）；
- `npm run check`、`npm run lint`（0 error）通过；
- 本地 tag `v1.1.0` 指向发布提交；`git status` 干净（`data.json` / `.DS_Store` / 缓存仍被忽略）；
- 远端 `origin/main` 与 tag 存在；`gh release view v1.1.0` 的正文只有版本更新内容，资产齐全；
- 安装文档的版本字样与 `manifest.json` 一致。

## 8. 需要你拍板

- [x] 版本号 1.1.0（minor）——用户已明确要求「推送更新 + 发布」；如希望用其它版本号请告知，可在推送前调整。

## 9. 实施记录

**落地（2026-10-28）**：

- 版本 1.0.0 → **1.1.0**：`manifest.json` / `package.json` / `package-lock.json`（根与 `packages[""]` 两处）/ `versions.json`（追加 `"1.1.0": "1.7.2"`）；README（中 / 英头部）、`docs/roadmap.md`、`docs/install.md`（事实核对行、`VERSION` 示例、成功判据）同步版本字样；产物大小判据更新为 `main.js` 约 346 KB / `styles.css` 约 74 KB。
- 文档顺带修正：`README.md` 的 Child processes 披露改为「显式点结束后台 dsh 时会结束当前端口上核实过的 dsh」；`AGENTS.md` 规则 6 补同一例外；README 英文 Features / Usage / Requirements 补选区引用、服务控制与桌面 App 内置 dsh。
- 提交 `ccd25e1`（40 个文件），打注释 tag `v1.1.0`，推送 `origin/main` 与 tag。
- Release：<https://github.com/FablerTan/obsidian-dsh/releases/tag/v1.1.0>，正文仅「本版内容」四条（不含安装 / 校验步骤），资产 `main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`。
- 桥 zip 由 `packages/dsh-obsidian-bridge/` 现打包（结构与 1.0.0 资产一致：根目录 `package.json` / `cordis.patch.yml` / `README.md` + `lib/`）。

**验证结果**：

- `npm run build` 通过（esbuild 输出 `main.js` 346.0kb）；`npm run check` 全项通过（版本三处一致 / 无运行时依赖 / manifest 合规 / `tsc` / 桥清单与语法 / `main.js` 与源码构建逐字节一致）；`npm run lint` 0 error（32 条既有 warning）。
- 本地 tag `v1.1.0` = `ccd25e1`；`git ls-remote` 显示远端 `main` = `ccd25e1`、`refs/tags/v1.1.0` 已存在。
- 下载 Release 资产逐一比对 SHA-256：`main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip` 与本地发布文件完全一致；远端 `manifest.json` 的 `version` 为 `1.1.0`。
- `gh release view v1.1.0` 确认：非 draft / 非 prerelease，正文只有「本版内容」，5 个资产齐全。

**与提案的偏差**：无功能改动；额外把 README 的进程披露与 AGENTS 规则 6 补上 0056 的显式结束例外（发布前发现的文档准确性问题）。
