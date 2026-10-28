---
status: approved
created: 2026-10-28
approved: 2026-10-28       # 用户当轮明确要求：推送到 GitHub 并发布
scope: manifest.json / package.json / package-lock.json / versions.json / README.md / docs
issue: 发布 1.1.1：把 0063–0065（审阅技能 + 结构重构）推送到 GitHub，创建 Release（正文只写版本更新内容）
---

# 0066 发布 1.1.1（推送 GitHub + Release 只写版本更新内容）

> 对应路线图 [R-48](../roadmap.md#需求待办)。用户原话：「帮我推送到github并发布」。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外（用户当轮已明确指定要做的具体项，视为已批准），本提案登记版本决策与发布内容。

## 1. 背景与问题

[0063](0063-project-review-skill.md)（审阅技能）、[0064](0064-project-review-audit.md)（审计报告）、[0065](0065-structure-refactor.md)（结构重构）已提交到本地 `main`（`7c092e2` / `df18292`），但远端 `origin/main` 落后 3 个提交；GitHub Release 仍停在 1.1.0。

这批改动**不改变任何用户可见行为**：新增的是审阅技能与重构（删死导出、拆分超长文件、合并重复实现），产物 `main.js` 只少了不少重复代码。

## 2. 目标与非目标

### 目标

- 把 0063–0065 的提交推送到 `origin/main`；
- 版本 1.1.0 → **1.1.1**（三处一致：`manifest.json` / `package.json` / `versions.json`），同步 `package-lock.json` 与文档版本字样；
- 打 tag `v1.1.1`，创建 GitHub Release，正文**只写本版更新内容**（不写安装步骤）；
- 上传资产：`main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`。

### 非目标

- 不改任何功能代码（重构已等价验证；本次只做版本号、文档字样、推送与发布）；
- 不改桥 `dsh-obsidian-bridge`（仍 0.5.0 / API v8，无需重装）；
- 不升 minor / major（没有新增功能）。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次采用）1.1.1 patch 发布** | 内部重构、无行为变化 → SemVer patch；一个 `refactor:` 发布提交 + tag + Release。 | 版本三处 + `package-lock` + README / roadmap / install 的版本字样；新增本提案。 | 低：与既有发布节奏一致；社区目录能识别到新版本。 | **推荐** |
| B 不升版本，只推送提交 | 不 bump，直接 push。 | 只推送 | 与「发布」诉求不符：没有新 tag / Release，社区目录也不会更新。 | 否掉 |
| C 1.2.0 minor 发布 | 当作新功能版本发。 | 同上 | 语义错误：0010 之后没有新增用户可见功能，用户会误判有变化。 | 否掉 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `manifest.json` / `package.json` / `package-lock.json` | 版本 1.1.0 → 1.1.1（lock 文件根与 `packages[""]` 两处） |
| `versions.json` | 追加 `"1.1.1": "1.7.2"` |
| `README.md` | 中 / 英头部版本字样 → 1.1.1 |
| `docs/roadmap.md` | 当前版本 → 1.1.1；新增 R-48 行 |
| `docs/install.md` | 事实核对行、`VERSION` 示例、成功判据里的版本 → 1.1.1；产物体积按实际更新 |
| `docs/changes/README.md` | 索引追加 0066 |
| 发布资产 | `main.js` / `manifest.json` / `styles.css` / `versions.json` / `dsh-obsidian-bridge.zip`（zip 由 `packages/dsh-obsidian-bridge/` 现打包） |

## 5. 行为变化

无功能行为变化（0065 已按「不改功能」落地并做过等价性复核）。Release 正文只列本版内容：

- 新增 `project-review` 审阅技能（只读扫描 + 分级报告）；
- 内部结构重构：清理无调用方导出 / 拆分超长文件（`composer.tsx` 702→398、`chat.ts` 568→98）/ 合并重复实现；
- 无用户可见行为变化。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 版本三处不一致 | `npm run check` 拦截，pre-commit 拒绝提交 | 按检查输出补齐；不要跳过钩子 |
| `main.js` 与源码不一致 | 发布产物不是当前源码的构建结果 | `npm run build` 后重新提交；`npm run check` 逐字节校验 |
| 发布页混入安装步骤 | 不符合「只写版本更新内容」 | `gh release edit v1.1.1 --notes-file` 重写 |
| 资产名与安装文档不一致 | A 路线 `curl` 404 | 沿用既有资产名 |
| 推送后发现问题 | 远端已有 tag / Release | 补发 1.1.2；不要强推已发布的 tag |

## 7. 验证

- `npm run build` 通过，`main.js` 与源码一致（`npm run check` 内存构建逐字节比对）；
- `npm run check`、`npm run lint`（0 error）通过；
- 本地 tag `v1.1.1` 指向发布提交；`git status` 干净；
- 远端 `origin/main` 与 tag 存在；`gh release view v1.1.1` 正文只有版本更新内容、5 个资产齐全；
- 下载资产与本地文件 SHA-256 一致；远端 `manifest.json` 的 `version` 为 `1.1.1`。

## 8. 需要你拍板

- [x] 版本号 **1.1.1**（patch；用户已明确要求推送 + 发布，内部重构无行为变化）
- [x] Release 正文只写版本更新内容（沿用 1.1.0 的口径）

## 9. 实施记录

（发布完成后填写）
