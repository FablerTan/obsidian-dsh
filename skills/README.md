# skills/ — 给 agent 的技能目录

每个子目录是一个技能，入口文件固定为 `<技能>/SKILL.md`（YAML frontmatter 至少包含 `name`、
`description`，可选 `whenToUse`；`name` 只允许小写字母、数字与连字符）。

| 技能 | 用途 |
|---|---|
| [obsidian-docs](obsidian-docs/SKILL.md) | 检索 Obsidian 官方文档：中文帮助 / 英文帮助 / 开发者文档（含 TypeScript API），离线索引 + 在线抓正文 |
| [project-guide](project-guide/SKILL.md) | 冷启动 + 结构指南：新会话查文档进入状态（不重读源码）、文件落位决策表、分层依赖、拆分判据与验收清单 |

## 接入 DSH

DSH 从项目根下的 `.dsh/skills/`（以及 `~/.dsh/skills/`、`~/.agents/skills/`）发现技能。本项目用
符号链接把真实目录挂进去，避免复制：

```bash
.dsh/skills/<技能名> -> ../../skills/<技能名>
```

新增技能时：建 `skills/<技能名>/SKILL.md`，再 `ln -sfn ../../skills/<技能名> .dsh/skills/<技能名>`。
技能的 `resourceBase` 会指向 `.dsh/skills/<技能名>`，所以技能内部互相引用的相对路径照常可用；
文档正文、缓存等大文件放技能自己的 `data/` 下（缓存已 gitignore）。
