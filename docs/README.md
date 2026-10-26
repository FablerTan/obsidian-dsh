# 项目文档

本目录存放**需要长期维护、会随实现变化**的说明。根目录 [README.md](../README.md) 只保留快速开始与用户视角的介绍，细节都在这里。

| 文档 | 内容 |
|---|---|
| [roadmap.md](roadmap.md) | 路线图：已完成 / 下一步（含验收标准）/ 非目标 / 风险 |
| [changes/](changes/README.md) | **变更提案**：改代码前先写，用户批准后再执行（含模板与编号索引） |
| [architecture.md](architecture.md) | 架构：服务生命周期、profile 与端口、视图与承载面（webview）、配置持久化 |
| [development.md](development.md) | 开发：环境、构建、安装到 vault、调试、代码结构与改动地图 |
| [obsidian-cdp.md](obsidian-cdp.md) | 开发期让 dsh 通过 CDP + MCP 操作 / 调试 Obsidian：启动、配置、常用操作、全流程与排障 |
| [troubleshooting.md](troubleshooting.md) | 故障排查：服务起不来、面板空白、端口冲突、PATH 问题 |
| [skills.md](skills.md) | `skills/` 目录约定与 obsidian-docs 文档检索技能 |

## 维护约定

- **改代码先提案**：功能添加、BUG 修复、会影响行为或目录结构的代码改动，都先在 [changes/](changes/README.md) 写提案等你批准（见 [AGENTS.md](../AGENTS.md) 规则 12）；纯文档改动不用。
- **给 agent 的入口**：新会话由 `project-guide` 技能按「roadmap → changes 状态 → 改动地图」的顺序读本目录，不靠通读源码；改文档时注意保持这个顺序里的信息准确（尤其是 roadmap 的超前/落后）。
- **行为变化必须同步文档**：端口/profile 默认值、命令 id、目录结构、构建步骤 —— 同时改对应文档与 [AGENTS.md](../AGENTS.md)。
- **路线图只在一处维护**：状态与里程碑只写在 [roadmap.md](roadmap.md)，README 不再重复清单。
- **链接用相对路径**：GitHub 与 Obsidian 都能直接点开。
- **不写会过期的细节**：优先描述职责、约定与判断依据，具体行号与实现细节以源码为准。
