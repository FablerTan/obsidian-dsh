# 项目文档

本目录存放**需要长期维护、会随实现变化**的说明。根目录 [README.md](../README.md) 只保留快速开始与用户视角的介绍，细节都在这里。

| 文档 | 内容 |
|---|---|
| [roadmap.md](roadmap.md) | 路线图：主线「边用边改」+ 需求待办 / 历史里程碑 / 非目标 / 风险 |
| [changes/](changes/README.md) | **变更提案**：改代码前先写（含 ≥ 2 条实现路径），用户选路并批准后再执行（含模板与编号索引） |
| [architecture.md](architecture.md) | 架构：服务生命周期、profile 与端口、原生面板与隐藏 core、配置持久化 |
| [development.md](development.md) | 开发：环境、构建、安装到 vault、调试、代码结构与改动地图 |
| [install.md](install.md) | **安装指南（给 agent）**：前置条件 → dsh 0.2.x → obsidian profile → 模型接入 → 构建 → 装进 vault → 桥 → 验收 / 失败矩阵 / 回滚 |
| [obsidian-cdp.md](obsidian-cdp.md) | 开发期让 dsh 通过 CDP + MCP 操作 / 调试 Obsidian：启动、配置、常用操作、全流程与排障 |
| [troubleshooting.md](troubleshooting.md) | 故障排查：服务起不来、原生面板空白、端口冲突、PATH 问题 |
| [skills.md](skills.md) | `skills/` 目录约定与 obsidian-docs 文档检索技能 |

## 维护约定

- **需求先登记、路径先选**：用户提出的每个需求先在 [roadmap.md](roadmap.md)「需求待办」登一行，并在 [changes/](changes/README.md) 写带 ≥ 2 条实现路径的提案；**等你选定路径**后才批准执行（见 [AGENTS.md](../AGENTS.md) 规则 12、13）；纯文档改动不用。
- **给 agent 的入口**：新会话由 `project-guide` 技能按「roadmap（含需求待办）→ changes 状态 → 改动地图」的顺序读本目录，不靠通读源码；改文档时注意保持这个顺序里的信息准确（尤其是 roadmap 的超前/落后）。
- **行为变化必须同步文档**：端口/profile 默认值、命令 id、目录结构、构建步骤 —— 同时改对应文档与 [AGENTS.md](../AGENTS.md)。
- **路线图只在一处维护**：状态与里程碑只写在 [roadmap.md](roadmap.md)，README 不再重复清单。
- **链接用相对路径**：GitHub 与 Obsidian 都能直接点开。
- **不写会过期的细节**：优先描述职责、约定与判断依据，具体行号与实现细节以源码为准。
