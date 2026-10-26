# skills/ — 给 agent 的技能目录

`skills/` 存放**供 AI agent 使用的技能**（可复用的任务说明 + 脚本 + 数据），与 [docs/](README.md) 里的"给人看的项目文档"分开。

## 目录约定

```
skills/
├─ README.md                 # 本目录的约定（新增/接入方式）
└─ <技能名>/
   ├─ SKILL.md               # 入口：YAML frontmatter + 正文说明
   ├─ scripts/               # 可选：可执行脚本
   ├─ references/            # 可选：给 agent 读的参考/目录
   └─ data/                  # 可选：索引、缓存（大文件、可重建）
```

`SKILL.md` 的 frontmatter 至少要有 `name` 与 `description`，推荐加 `whenToUse`：

```yaml
---
name: obsidian-docs            # 只允许小写字母、数字、连字符
description: 一句话说明这个技能能做什么
whenToUse: 什么情况下应该加载它（写成给 agent 的判断条件）
---
```

正文写给 agent 看：**何时用、怎么用、边界在哪**，不要重复项目文档。

## 现有技能

| 技能 | 用途 | 关键入口 |
|---|---|---|
| `obsidian-docs` | 检索 Obsidian 三套官方文档（中文帮助 / 英文帮助 / 开发者文档）：离线索引 + 在线抓正文，中文优先、必要时回退英文 | [SKILL.md](../skills/obsidian-docs/SKILL.md) · [obsdocs.mjs](../skills/obsidian-docs/scripts/obsdocs.mjs) |
| `project-guide` | 冷启动 + 结构指南：新会话按顺序查文档了解现状（不重读源码）、新文件落位决策表、分层依赖、拆分判据、验收清单 | [SKILL.md](../skills/project-guide/SKILL.md) |

常用命令（在项目根执行）：

```bash
node skills/obsidian-docs/scripts/obsdocs.mjs find 属性 --lang zh     # 搜目录
node skills/obsidian-docs/scripts/obsdocs.mjs get 编辑与格式化/属性    # 取正文
node skills/obsidian-docs/scripts/obsdocs.mjs sync                    # 文档站更新后重建索引
```

## 接入 DSH

DSH 从若干目录发现技能，优先级从高到低（本项目只用到第一条）：

1. `<项目根>/.dsh/skills/`
2. `<项目根>/.agents/skills/`
3. `$DSH_HOME/skills/`
4. `~/.agents/skills/`
5. dsh 内置技能

本项目用**符号链接**把真实目录挂进第一条，避免维护两份：

```bash
.dsh/skills/<技能名> -> ../../skills/<技能名>
```

已接入：`.dsh/skills/obsidian-docs -> ../../skills/obsidian-docs`、`.dsh/skills/project-guide -> ../../skills/project-guide`。加载后技能的 `resourceBase` 指向 `.dsh/skills/<技能名>`，所以技能内部互相引用的相对路径照常可用。

> 项目根由 DSH 向上查找 `.git` 决定；本仓库已 `git init`（2026-10-26），项目根就是本目录，链接继续有效。

## 新增一个技能

1. 建 `skills/<技能名>/SKILL.md`（frontmatter 的 `name` 与目录名一致）。
2. `ln -sfn ../../skills/<技能名> .dsh/skills/<技能名>`。
3. 重新加载会话/插件后，技能会出现在 catalog 里（工作区内的改动会被自动发现）。

## 维护

- **索引/数据要可重建**：`data/` 下的东西应该能由脚本重新生成，不要提交不可复现的产物。
- **缓存不要入库**：`skills/obsidian-docs/data/cache/` 已有 `.gitignore`，删除后会自动重新抓取。
- **体积**：当前 `skills/` 约 900KB（索引 JSON 为主），新增技能时注意别把整站正文塞进仓库。
- **上游变化**：文档站是 Obsidian Publish，接口偶有变动；重建索引失败时先看 `sync` 的报错，再改脚本而不是手改索引。
- 技能的版本/变更说明写在技能自己的 SKILL.md 末尾，不需要单独 CHANGELOG。
