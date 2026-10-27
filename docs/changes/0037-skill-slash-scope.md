---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户当轮已明确指定「@ 同款机制」，按 AGENTS.md 规则 12 例外视为已批准
scope: src/settings, src/view
issue: 「/」菜单的技能行缺检索范围控制：设置页「聊天」tab 三档（不启用 / 白名单 / 黑名单），选中后展开添加栏；只过滤技能行，不影响技能加载
---

# 0037 「/」菜单的技能范围（白名单 / 黑名单）

> 对应路线图 [R-20](../roadmap.md#需求待办)。用户当轮已明确指定要改的具体项（「给 skills 的 / 命令也加一个 @ 的同款白名单和黑名单机制，这个只影响 / 命令的出现，不真实影响 skill 的加载」），按 [AGENTS.md](../../AGENTS.md) 规则 12 例外视为已批准，直接执行。

## 1. 背景与问题

### 现状

输入框 `/` 菜单（R-8，[0025](0025-slash-commands.md)）已经提供 `/new`、`/compact` 与「技能」分组的技能行：`composer.tsx` 在打开菜单时拉一次技能目录（桥 v5 的 `skills()`），交给 `slash.ts` 做过滤 / 排序，选中后插入 `/技能名 `、由宿主执行命令。
但菜单里的技能行固定列出当前 profile / vault 可见的**全部**技能，无法按使用习惯裁剪；技能多时找一个常用技能要翻很久，体验也落后于 @ 菜单——@ 那边的范围功能（R-13，[0030](0030-mention-scope.md)）已经落地，可以直接对齐。

### 需求（用户原话拆解）

1. 给 skills 的 `/` 命令也加 **@ 同款**的白名单 / 黑名单机制，能自由设置 `/` 菜单里技能的显示范围。
2. 设置里加一个 `/` 功能的设置，三个选项：**不启用 / 白名单 / 黑名单**（默认不启用）。
3. 选中**白名单**后下方展开「添加白名单」栏；**黑名单同理**；**不启用时不显示栏**。
4. 该范围**只影响 `/` 菜单里技能行的出现**，不真实影响 skill 的加载、技能目录读取与 `/name` 的执行。

### 影响范围

只影响 `/` 菜单「技能」分组要显示哪些行；`new` / `compact` 命令行、技能目录（`skills()` 桥方法返回的内容）、技能加载与执行、`/name` 插入、@ 菜单、消息渲染、桥与 dsh 服务都不受影响。

## 2. 目标与非目标

### 目标

- 设置页「聊天」tab 在「「@」引用范围」之后新增「「/」技能范围」下拉，三档：**不启用 / 白名单 / 黑名单**，默认**不启用**（`skillScope: 'off'`，两个列表默认空数组）。
- 非「不启用」时，在该设置项下方展开添加栏（与 @ 范围同款）：标题「白名单（N）」/「黑名单（N）」、已有条目列表（每条可移除）、输入框 +「添加」按钮、一行提示；「不启用」时不渲染添加栏。
- 条目是**技能名**，归一化 = 去首尾空白 + 转小写；只接受小写字母 / 数字 / 点 / 下划线 / 连字符，拒绝空串与含 `/` 等非法字符；读取时去重。
- 匹配规则与 @ 的文件夹语义同款：条目 `office` 覆盖技能 `office` 本身与所有 `office-*` 子项（`name === entry` 或 `name.startsWith(entry + '-')`）。
- **白名单**：只保留命中条目的技能行；白名单为空时技能行全部隐藏（命令 `new` / `compact` 不受影响）。**黑名单**：隐藏命中条目的技能行，空黑名单不过滤；未知模式兜底不过滤。
- 过滤后技能行全被挡掉、且原本有技能时，菜单显示说明行：**技能行已按「/」技能范围过滤：当前没有可显示技能**；原有的「当前会话没有可用技能」「正在读取技能列表…」等说明行不变。
- 生效时机：`composer.tsx` 每次打开 `/` 菜单时快照一次 `getSkillScope()`（`main.ts` 从 settings 组装，`panel-host.ts` 暴露给 view），技能目录返回后在渲染前套用过滤；改完设置**下一次打开 `/` 菜单**即生效，无需重启插件 / 服务。
- 设置类型泛化：`MentionScopeMode` → `ScopeMode`（`off` / `whitelist` / `blacklist`），@ 与 `/` 共用；新增 `SkillScope` 接口（与 `MentionScope` 同形）。

### 非目标

- 不改桥 `packages/dsh-obsidian-bridge`，不新增桥方法，不需要重启 dsh 服务。
- 不改技能目录 / 加载 / 执行链路：`bridge.skills()` 原样返回；只过滤菜单显示，技能本身照常可用。
- 不合并 @ 与 `/` 的名单（路径与技能名语义不同，需要分别控制）。
- 不做 glob / 正则 / 前端搜索式范围；匹配只按技能名（条目本身 + `-` 前缀子项）。
- 不做二级菜单 / 分组折叠；不新增 CSS 类（复用 `dsh-settings-scope-*`）；不 bump 版本号。
- 不影响 `@` 菜单、消息渲染、模型 / 权限 / 上下文占用。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）** | Obsidian 侧设置 + 纯函数在**打开 `/` 菜单拉技能目录后**过滤：`settings/schema.ts` 把 `MentionScopeMode` 泛化为 `ScopeMode`、新增 `SkillScope` 与 `skillScope` / `skillWhitelist` / `skillBlacklist` 默认值 + 技能名归一化；`settings/sections/chat.ts` 复用 @ 的 scope 面板渲染三档与添加栏；`panel-host.ts` 加 `getSkillScope()`（`main.ts` 从 settings 组装）；`native-chat-view.tsx` / `native-chat-root.tsx` 透传；新增 `view/native/skill-scope.ts` 的 `filterSlashSkills(skills, scope)`；`composer.tsx` 打开菜单时快照范围、技能目录返回后套用，过滤为空时显示说明行 | settings + view + docs，约 8 个源文件；新增纯函数约 40 行 | 纯显示层，桥零改动、无需重启；条目按技能名匹配，与 @ 的路径语义相互独立；风险是过滤后为空时的可解释性（用说明行兜底）与设置读取时点（每次打开菜单读一次） | **推荐**：改动面最小、可独立冒烟、回滚只需把模式切回「不启用」；用户当轮已明确指定「@ 同款机制」，按 0030 的路径 A 落地，无需再等选路 |
| B | 桥侧过滤：把范围交给 dsh 客户端插件，在 `skills()` 返回前裁剪，原生端只渲染结果 | `packages/dsh-obsidian-bridge/lib/client.js`（VERSION +1）+ `core-bridge.ts` + `composer.tsx` + 重新 link + 重启服务 | 改完必须升桥版本 / relink / 重启服务；在桥里裁剪等于改变 `skills()` 返回的技能目录本身（之后任何消费方都只看得到过滤后的目录），与需求「只影响菜单出现、不影响技能加载 / 目录」的边界相悖；每次改设置还要重启服务 | 不推荐：本次需求是宿侧显示偏好，桥零改动即可满足；0030 已因同类原因否掉 dsh 侧候选 |
| C | 与 @ 共用一份名单：复用 `mentionScope` / `mentionWhitelist` / `mentionBlacklist`，一项设置在两个菜单间连带生效 | `settings/schema.ts`（不新增字段）+ `mention-scope.ts` 改造 + `composer.tsx` | 字段更少，但语义被耦合：@ 条目是 vault 相对路径、`/` 条目是技能名，同一列表无法同时表达；`模板` 与 `office` 会互相误伤；用户要的是「给 skills 也加一个 @ 同款机制」，即两份可独立配置的名单 | 不推荐：语义冲突、无法分别控制两个菜单 |

**推荐 A**：范围是**宿主侧菜单的显示偏好**，与 dsh / 桥无关；过滤放在「打开 `/` 菜单取技能目录」这一步，正好复用 0025 已有的取数时机，命令提交、技能加载、`/name` 插入与排序一行都不用改。用户当轮已明确指定「同款机制」，按 0030 的路径 A 直接落地。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/settings/schema.ts](../../src/settings/schema.ts) | `MentionScopeMode` 泛化为 `ScopeMode`（`off` / `whitelist` / `blacklist`，@ 与 `/` 共用）；新增 `SkillScope` 接口（与 `MentionScope` 同形：`mode` / `allow` / `deny`）；新增 `normalizeScopeName` / `normalizeScopeNames`（去首尾空白 + 转小写，只接受小写字母 / 数字 / 点 / 下划线 / 连字符，拒绝空串与含 `/` 等非法字符，读取时去重）；`DshPluginSettings` 加 `skillScope` / `skillWhitelist` / `skillBlacklist`；`DEFAULT_SETTINGS` 默认 `off` + 空数组；`mergeSettings` 非法模式回落 `off`、两个数组读取时归一化 |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 「聊天」tab 在「「@」引用范围」之后新增「「/」技能范围」下拉（不启用 / 白名单 / 黑名单）；非「不启用」时渲染同款添加栏（标题带条数、条目可移除、输入框 +「添加」/ 回车、提示行）；复用 `dsh-settings-scope-*` 样式，不新增 CSS 类 |
| [src/view/native/skill-scope.ts](../../src/view/native/skill-scope.ts)（新增） | `filterSlashSkills(skills, scope)` 纯函数：`off` 原样返回；白名单只留命中条目（空白名单返回空）；黑名单排除命中条目；未知模式兜底不过滤；匹配规则固定为 `name === entry \|\| name.startsWith(entry + '-')` |
| [src/view/panel-host.ts](../../src/view/panel-host.ts) | `DshPanelHost` 增加 `getSkillScope(): SkillScope`（不把插件实例漏进 view） |
| [src/main.ts](../../src/main.ts) | 实现 `getSkillScope()`：从 settings 组装 `{ mode, allow, deny }` |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) | 把 `getSkillScope` 透传给 `NativeChatRoot` |
| [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 把 `getSkillScope` 接到输入框 / 打开 `/` 菜单的取数路径 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 每次打开 `/` 菜单拉技能目录后读一次 `getSkillScope()` 并套 `filterSlashSkills()`；过滤后技能行全空且原本有技能时显示说明行「技能行已按「/」技能范围过滤：当前没有可显示技能」；`/name` 插入与命令提交不变 |
| [docs/changes/0037-skill-slash-scope.md](0037-skill-slash-scope.md) | 本提案 |
| [docs/changes/README.md](README.md) | 索引登记 |
| [docs/roadmap.md](../roadmap.md) | 「需求待办」加 R-20 行 |
| [docs/architecture.md](../architecture.md) | 关注点表 + 配置持久化表 + `/` 菜单技能行过滤链路 |
| [docs/development.md](../development.md) | 文件职责表 + 改动地图 + 回归清单（54–56） |

不改 `src/service/`、`src/shared/`、`packages/`、`styles.css`、`main.js`（产物由 `npm run build` 生成）。

## 5. 行为变化

- 设置页「聊天」tab 在「「@」引用范围」之后出现「「/」技能范围」，默认 **不启用**；不启用时 `/` 菜单与改动前完全一致，且**不渲染**添加栏。
- 选「白名单」→ 下方展开「白名单（N）」栏；添加 `office` 后 `/` 菜单「技能」分组只剩 `office` 与 `office-*` 技能行，其余技能行消失；白名单为空时技能行全部隐藏，`/new`、`/compact` 与原有说明行照常。
- 选「黑名单」→ 下方展开「黑名单（N）」栏；添加 `office` 后 `office` 与 `office-*` 技能行不再出现，其它技能照常；空黑名单不过滤。
- 过滤后技能行全被挡掉、且原本有技能时，菜单显示说明行「技能行已按「/」技能范围过滤：当前没有可显示技能」；原有的「当前会话没有可用技能」「正在读取技能列表…」等说明行不变。
- 添加栏：标题带当前条数；已有条目可逐个移除（条数同步）；输入框 +「添加」（回车等效）；重复条目提示已在列表里，非法名（空 / 含 `/` / 空格等）被拒绝；输入自动去首尾空白并转小写后落盘。
- `office` 覆盖 `office` 与所有 `office-*`（与 @ 的文件夹前缀语义同款）；不提供精确匹配模式。
- **生效时机**：设置改动后，下一次打开 `/` 菜单即按新范围出技能行，无需重启插件 / 服务；已打开的菜单不中途刷新。
- 技能目录（`skills()`）、技能加载 / 执行、`/name` 插入、`@` 菜单、消息渲染、桥与 dsh 服务行为不变；`new` / `compact` 命令行始终显示。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 前缀匹配覆盖面超出预期（`office` 命中 `office-*`） | 想只保留 `office` 时子项也会出现 | 这是与 @ 文件夹一致的前缀语义；需要更精确时把条目写成完整技能名（如 `office-docx`）；切回「不启用」恢复 |
| 名单写错把技能行全挡掉 | 菜单里没有技能可选 | 过滤为空时显示说明行；切回「不启用」立即恢复，名单内容保留 |
| @ 与 `/` 的名单混淆（路径 vs 技能名） | 误把路径填进技能名单，什么也匹配不到 | 两份名单独立存放、添加栏各自校验；非法技能名直接拒绝 |
| 旧设置 / 手改 `data.json` 的非法值 | 菜单技能行异常或设置页报错 | `mergeSettings` 非法模式回落 `off`、非法技能名丢弃（读取时归一化） |
| 设置读取时点（每次打开菜单） | 已打开的菜单不刷新 | 下一次打开即生效（与 0030 一致），文档写明 |
| 显示过滤被误解为「技能被禁用」 | 用户以为技能加载也被限制 | 说明行文案 + 文档写明「只影响菜单出现，不影响加载」；回滚切「不启用」 |

整体回滚：范围只是显示层偏好，删除过滤调用 / 把 `skillScope` 固定为 `'off'` 即恢复改动前的全量技能行；设置值留在 `data.json` 不影响其它功能。

## 7. 验证

自动化（代码侧由 Lead 执行）：

```
npm run build   # tsc -noEmit -skipLibCheck + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

纯函数冒烟（`skill-scope.ts` 不 import obsidian，可单独打包）：

```
./node_modules/.bin/esbuild src/view/native/skill-scope.ts --bundle --platform=node --format=esm --outfile=/tmp/skill-scope.mjs
```

用例：`off` 原样返回；白名单命中条目本身与前缀子项（`office` → `office` / `office-docx` / `office-xlsx`，不误伤 `officex`）；空白名单返回空；黑名单排除条目本身与子项、保留其它技能；未知模式兜底不过滤；技能名归一化（去首尾空白 / 转小写、拒绝空串 / 含 `/` / 空格等非法名、读取时去重）。

手动回归（Obsidian 内，CDP 或人工）：

1. 设置页 →「聊天」tab：默认「不启用」，`/` 菜单技能行与改动前一致，且看不到添加栏。
2. 选「白名单」→ 出现「白名单（N）」添加栏；添加 `office` → 菜单「技能」分组只剩 `office` 与 `office-*`；白名单为空 → 技能行全隐藏，`/new`、`/compact` 仍在。
3. 选「黑名单」→ 出现「黑名单（N）」添加栏；添加 `office` → `office` 与 `office-*` 不再出现，其它技能照常。
4. 添加栏：移除条目计数同步、重复 / 非法名被拒绝、大小写自动归一化；改设置后不重载插件，下一次打开 `/` 菜单即生效；重载插件后设置保留；`/name` 插入与技能调用不受影响。
5. 过滤为空说明行；@ 菜单、消息短链 / 文件夹 chip、`skills()` 目录无变化。

**验收标准**：

- 三档都能选、默认「不启用」，且「不启用」时添加栏不渲染、`/` 菜单技能行不变；
- 白名单 / 黑名单的实际技能行与上述规则一致（条目本身 + `-` 前缀子项、空白名单全隐藏、空黑名单不过滤、未知模式不过滤）；
- 技能行全被挡掉时显示说明行，`new` / `compact` 与原有说明行不变；
- 设置改动无需重启，下一次打开 `/` 菜单即生效；
- `skills()` 目录、`/name` 插入、技能加载 / 执行、`@` 菜单、桥与 dsh 服务无行为变化；
- `npm run build` / `npm run check` 通过，`main.js` 与源码一致。

## 8. 拍板结果

- [x] 实现路径：**A**（Obsidian 侧设置 + 纯函数在打开 `/` 菜单取技能目录后过滤，不动桥、不重启服务）（2026-10-27）
- [x] 三档与默认值：**不启用 / 白名单 / 黑名单**，默认 **不启用**（2026-10-27）
- [x] 条目语义：技能名；`office` 覆盖 `office` 与所有 `office-*`（2026-10-27）
- [x] 生效时机：下一次打开 `/` 菜单，无需重启（2026-10-27）
- [x] 范围只作用于 `/` 菜单技能行，不影响技能目录 / 加载 / 执行、`/name` 插入、@ 菜单与桥（2026-10-27）
- [x] `MentionScopeMode` 泛化为 `ScopeMode`，@ 与 `/` 共用类型但名单独立（2026-10-27）

## 9. 实施记录

**落地（2026-10-27，路径 A）**：只在 Obsidian 侧加设置 + 纯函数过滤，桥 / dsh 服务 / 技能加载链路零改动；过滤只作用于 `/` 菜单里「技能」分组要显示的行。

| 文件 | 实际改动 |
|---|---|
| [src/settings/schema.ts](../../src/settings/schema.ts) | `MentionScopeMode` 泛化为 `ScopeMode`；新增 `SkillScope`；新增 `normalizeScopeName` / `normalizeScopeNames`（trim + 小写，只接受 `[a-z0-9._-]`，去重）；`DshPluginSettings` 加 `skillScope` / `skillWhitelist` / `skillBlacklist` 与默认值；`mergeSettings` 用 `scopeModeOf()` 统一校验 @ / `/` 两处模式，技能名单读取时归一化 |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 把 @ 的作用范围面板抽成通用 `renderScopePanel`（文案 / 值列表 / 归一化 / 可选缺失校验）；新增「「/」技能范围」三档下拉与同款添加栏（复用 `dsh-settings-scope-*`，未新增 CSS） |
| [src/view/native/skill-scope.ts](../../src/view/native/skill-scope.ts)（新增） | `filterSlashSkills(skills, scope)`：off 原样返回副本；白名单只留命中（空白名单返回空）；黑名单排除命中；未知模式不过滤；匹配 `name === entry \|\| name.startsWith(entry + '-')`，大小写不敏感 |
| [src/view/panel-host.ts](../../src/view/panel-host.ts) | `DshPanelHost` 增加 `getSkillScope(): SkillScope` |
| [src/main.ts](../../src/main.ts) | 实现 `getSkillScope()`（从 settings 组装 `{ mode, allow, deny }`） |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) / [src/view/native/ui/native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx) | 透传 `getSkillScope` 到输入栏 |
| [src/view/native/ui/composer.tsx](../../src/view/native/ui/composer.tsx) | 打开 `/` 菜单时快照一次范围（`skillScope` state）；`scopedSkills` 只用于菜单渲染；技能行全被挡掉且原本有技能时显示说明行「技能行已按「/」技能范围过滤：当前没有可显示技能」；`loadSkills()` 的结果、`/name` 插入与命令提交不变 |

**验证结果**：

- `npm run build` 通过（tsc + esbuild，main.js 282.8kb）；`npm run check` 全通过（版本三处一致 / 无运行时依赖 / tsc / bridge 清单 / main.js 与源码构建一致）。
- 纯函数冒烟 **28 项全过**（esbuild 把 `skill-scope.ts` + `schema.ts` 打包到 /tmp 后直接调用）：off 原样返回且不共享数组；白名单命中条目本身与 `-` 子项、不误伤 `officex`；空白名单 / 无命中返回空；非法条目被忽略；黑名单排除条目与子项、空黑名单不过滤；未知模式兜底；大小写 / 首尾空格归一化；`normalizeScopeName` 拒绝空串 / 斜杠 / 空格 / 中文；`mergeSettings` 非法模式回落 off、名单去重小写、旧设置缺字段回落、不共享默认数组。
- **CDP 实测**（Obsidian 1.14.5，dsh 0.2.1-rc.3，隐藏 core 桥 v6，端口 3088，重载插件后）：
  - 设置页「聊天」：新设置项默认「不启用」且不渲染添加栏；切「白名单」出现「白名单（0）」与空提示；输入 ` OBSIDIAN ` 添加 → 存为 `obsidian`、标题「白名单（1）」；非法 `a/b` 被拒绝并显示错误提示；移除后回「白名单（0）」；切回「不启用」添加栏消失。
  - `/` 菜单（该 vault 技能目录：defuddle / json-canvas / knap / obsidian-bases / obsidian-cli / obsidian-markdown）：不启用 = `/new`、`/compact` + 6 行全列；白名单 `obsidian` = 3 个 `obsidian-*`；白名单空 / 无命中 = 仅命令 + 说明行；黑名单 `obsidian` = defuddle / json-canvas / knap；空黑名单 = 6 行；大写 ` OBSIDIAN ` 等价小写。
  - 技能目录未受影响：过滤生效时 `bridge.skills()` 仍返回全部 6 个；点技能行插入 `/obsidian-bases ` 且菜单关闭。
  - 插件 console 无本改动相关报错；测试后设置已还原为「不启用」。
- 未做：真 IME / 视觉人工确认（本改动不涉及输入法；设置面板样式复用的 `dsh-settings-scope-*` 已在 CDP 里核对标题 / 空提示 / 错误提示）。

**与提案的偏差**：

- 过滤时点：`composer.tsx` 在**打开菜单**时快照 `getSkillScope()`（早于异步拉技能目录），渲染时再过滤；效果与提案「拉技能目录后读设置」一致，且避免异步返回时才读设置导致同一份菜单口径不一致。
- 设置面板复用：`chat.ts` 的 `renderScopePanel` 改为通用参数（文案 / 值 / 归一化 / 可选缺失校验）；技能名没有 vault 存在性来源，所以不显示「路径不存在」标记。
- 技能名不做存在性校验（与 @ 的路径不同），只做格式归一化；填了不存在的名字不报错，只是匹配不到。
