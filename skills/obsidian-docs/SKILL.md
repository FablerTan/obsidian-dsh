---
name: obsidian-docs
description: 检索 Obsidian 官方文档：中文帮助（obsidian.md/zh/help）、英文帮助（obsidian.md/help）、开发者文档（docs.obsidian.md，含 TypeScript API 272 个类）。离线目录索引 + 在线抓取正文，中文优先、必要时回退英文。
whenToUse: 需要回答 Obsidian 的功能/设置/Markdown 语法/同步/Publish/Bases/插件使用问题，或开发、调试、审查 Obsidian 插件（Plugin 生命周期、ItemView、Vault/文件 API、Workspace、命令、设置、样式、构建发布、API 签名）时。
---

# Obsidian 文档检索

本技能把 Obsidian 的三套官方文档做成了**可检索的本地索引 + 按需抓取的正文**。不要凭记忆编造 Obsidian API 或设置项，先查再答。

## 数据源

| 站点 | 语言 | 页数 | 规范 URL 前缀 | 用途 |
|---|---|---|---|---|
| 中文帮助 | 中文 | 179 | `https://obsidian.md/zh/help/<slug>` | **默认首选**：用户使用类问题 |
| 英文帮助 | English | 179 | `https://obsidian.md/help/<slug>` | 中文缺页、术语对不上、需要原文措辞时 |
| 开发者文档 | English | 1319 | `https://docs.obsidian.md/<路径>` | 插件/主题开发：指南 55 页 + TypeScript API 1195 页 + CSS 变量 63 页 |

三者都是 Obsidian Publish 站点，脚本依赖其两个稳定接口（换站点/重建索引时才需要关心）：
`https://publish-01.obsidian.md/cache/<uid>`（全站文件树 + frontmatter/headings）与 `https://publish-01.obsidian.md/access/<uid>/<路径>.md`（正文 Markdown）。

## 目录结构

```
skills/obsidian-docs/
├─ SKILL.md                    ← 本文件：流程与规则
├─ references/
│   ├─ help-zh.md              ← 中文帮助目录（179 页，按官方导航顺序，含链接与路径）
│   ├─ help-en.md              ← 英文帮助目录
│   ├─ dev-docs.md             ← 开发者文档目录（指南分组 + 272 个 API 类字母表 + CSS 变量）
│   └─ dev-quickref.md         ← 插件开发速查（生命周期/视图/Vault/命令/发布/常用 API 链接）
├─ data/
│   ├─ index-help-zh.json      ← 机器可读索引（标题/路径/slug/URL/别名/小标题）
│   ├─ index-help-en.json
│   ├─ index-dev.json
│   └─ cache/                  ← 抓过的正文缓存（TTL 7 天，可随时删）
└─ scripts/obsdocs.mjs         ← 检索 CLI（零依赖，Node ≥ 20）
```

所有命令都在**本技能目录**或项目根执行（脚本按自身位置定位数据）：

```bash
node skills/obsidian-docs/scripts/obsdocs.mjs <命令>
```

## 三个核心命令

| 命令 | 用途 | 例子 |
|---|---|---|
| `find <关键词> [--lang zh\|en\|dev] [--limit N] [--json]` | 搜**标题/路径/别名/小标题**，返回 URL + 可直接 get 的路径 | `find 属性 --lang zh`、`find registerView --lang dev` |
| `get <路径\|标题\|URL> [--lang auto\|zh\|en\|dev] [--raw] [--refresh]` | 抓页面正文（Markdown，已去 frontmatter）+ 来源/小节 | `get 编辑与格式化/属性`、`get Reference/TypeScript API/Plugin/registerView --lang dev` |
| `url <路径\|标题>` | 只取规范 URL（引用来源时用） | `url 快速入门/创建仓库` → `https://obsidian.md/zh/help/vault` |

辅助：`list [--lang] [--section <章节>]` 浏览目录；`sync` 重建索引。

## 推荐检索流程

1. **先 `find`**：中英文关键词都试（中文站保留英文术语，如「Bases」「Publish」「沙盒仓库」）。
2. **再 `get`**：用 find 打印出的路径取正文；命中多个时用 `--lang` 或更精确的路径收敛。
3. **正文里的相对链接**是 Publish 站内链接（链接目标通常只有类名，没有目录），需要时按「目录/文件名」规则换算成索引路径再 `get`。
4. **开发类问题**：先看 `references/dev-quickref.md` 拿骨架与链接，再 `get` 具体页面确认签名/版本。
5. **回答里给出规范 URL**（`url` 命令的输出），让用户能自己打开原文。

## 语言回退规则

- 默认查**中文帮助**；以下情况改用英文或开发者文档：
  - 中文站没有对应页（`find` 只有 `[help-en]` 命中）；
  - 中文措辞模糊、需要确认原文/版本差异；
  - 涉及 API、manifest 字段、CLI、构建发布——**开发者文档只有英文**，以它为准。
- `--lang auto`（默认）按 zh → en → dev 顺序找，返回第一条；跨语言结果会标 `[help-zh]` / `[help-en]` / `[dev]`。

## 正文抓取与缓存

- 首次 `get` 会联网抓取，落在 `data/cache/<站点>/<路径>`；7 天内复用，`--refresh` 强制刷新。
- 目标页面 404 / 网络不可达时，脚本会报错而不是返回空内容——此时换关键词重新 `find`，或直接用 `url` 给出的链接让用户自查。
- 无网络时：`references/` 与 `data/index-*.json` 仍可离线检索（目录、标题、URL、小标题），只是取不到正文。
- 缓存可安全删除：`rm -rf data/cache`。

## 索引维护

文档站更新后重建索引（会重抓三个 cache 并重写 `references/help-*.md`、`references/dev-docs.md`）：

```bash
node skills/obsidian-docs/scripts/obsdocs.mjs sync            # 全部
node skills/obsidian-docs/scripts/obsdocs.mjs sync --lang dev # 只更新开发者文档
node skills/obsidian-docs/scripts/obsdocs.mjs sync --from /tmp/obsdocs  # 离线：用现成的 *-cache.json/-options.json
```

索引里记录了生成时间与页数；页数出现明显变化（如 dev 不再是 1319）说明上游改版，值得复核 `scripts/obsdocs.mjs` 里的分页假设。

## 已知边界

- 三者是 Publish 站点的内部 JSON/接口，Obsidian 改版可能失效；失效时回退到直接抓 HTML 或按 README 里的站点结构手改脚本。
- 站点 URL 用 `+` 表示空格（`docs.obsidian.md/Plugins/Getting+started/Build+a+plugin`），脚本已处理；手写 URL 时注意。
- 本技能只覆盖**官方文档**；社区插件/主题目录（community.obsidian.md）内容不在索引内。
- 若 `web_fetch` 工具在本机因 DNS/SSRF 策略被拒（解析到非公网地址），改用脚本或 `curl`。
