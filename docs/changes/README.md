# 变更提案（改代码前必须写）

本目录存放**代码改动前**的提案。硬规则见 [AGENTS.md](../../AGENTS.md) 第 12 条：

> 任何功能添加、BUG 修复或会改变运行行为的代码改动，**先在这里写提案 → 用户确认（status: approved）→ 才动代码**。

## 命名与索引

文件名 `NNNN-<kebab-slug>.md`，四位编号递增，**不复用、不删除**（被否也保留，状态改 rejected）。

| 编号 | 提案 | 状态 |
|---|---|---|
| [0001](0001-m2-stability-fixes.md) | M2 稳定性：iframe 自愈 / 重启竞态 / 可信探测 / 版本一致 | ✅ 已完成 |
| [0002](0002-m2-locator-version-visibility.md) | M2-5：locator 版本可见性（实际路径/版本日志 + 冲突提示） | ✅ 已完成 |
| [0003](0003-dsh-version-selection-and-token-auth.md) | dsh 版本选择 + 0.2.1 token 鉴权支持（删除 0.1.1 的前置） | ✅ 已完成 |
| [0004](0004-webview-embedding.md) | 用 Electron `<webview>` 替换 iframe（解决 0.2.1 SameSite=Strict cookie 401） | ✅ 已完成（待人工确认） |
| [0005](0005-obsidian-native-surfaces.md) | 用 Obsidian ribbon/命令 + dsh 桥收敛 DSH 左栏（新建会话 / 单栏常开 / 只用 vault 项目） | 🚧 已实施，待人工确认 |
| [0006](0006-native-chat-panel.md) | 原生聊天面板：官方 DSH core + Obsidian 原生 UI（方案 A；桥合并进 dsh-obsidian-bridge v2） | ✅ 已完成（CDP 回归通过，视觉/IME 待人工确认） |
| [0007](0007-drop-legacy-and-migrate-bridge.md) | 只支持 dsh 0.2.x：移除 0.1.1 / iframe 兼容 + bridge 插件迁入本仓库 | ✅ 已完成（待人工确认） |

## 状态机

```text
draft（待批准） ──► approved（已批准，执行中） ──► done（已实施并验证）
       │
       └──► rejected（用户否掉，附理由）
```

- 状态写在文件 frontmatter 的 `status`，并在本表同步。
- 批准后开工前填 `approved` 日期；实施完填「实施记录」并改 `done`。
- 批准后如果方案有实质变化：追加「变更记录」、状态退回 `draft` 重新确认。

## 起稿

复制 [template.md](template.md)。必填小节：背景与问题、目标与非目标、方案（含备选）、改动清单（文件级）、
行为变化、风险与回滚、验证方式、**需要你拍板的问题**。

## 不需要提案的改动

- 只改文档 / 注释 / 格式；
- 用户当轮已明确指定要改的具体项（视为已批准，可直接做，建议在会话或本目录留一句记录）；
- 单纯重建产物（`npm run build`，不改源码）。

## 写作要求

- 说清楚「改哪个文件、改什么行为、怎么验证、失败怎么退」；
- 有备选方案就给对比并标明推荐哪个；
- 不确定的点单独列进「需要你拍板」，不要混在正文里；
- 提案就是评审材料，不要写成实现笔记。
