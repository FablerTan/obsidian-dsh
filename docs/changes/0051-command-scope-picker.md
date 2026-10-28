---
status: done             # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮明确指定「命令的白名单和黑名单要加选取按钮」
scope: src/settings, src/view
issue: 命令范围的白名单 / 黑名单缺「选取」按钮：从当前会话的 dsh 命令目录取候选，点选填入添加栏
---

# 0051 命令范围的「选取」按钮（候选来自原生面板桥）

> 对应路线图 [R-34](../roadmap.md#需求待办)。用户原话：「命令的白名单和黑名单怎么没加选取按钮」。
> 按 [AGENTS.md](../../AGENTS.md) 规则 12 例外（用户当轮明确指定要改的具体项）直接执行，并补提案记录。
> 0050 落地时命令范围**没有**「选取」按钮（设置页拿不到 dsh 命令目录）；本提案补上。

## 1. 背景与问题

0050 给「/」菜单加了命令范围（三档 + 白 / 黑名单），但添加栏没有「选取」按钮：技能范围的候选来自本地技能目录（0038），而 dsh 命令目录只能通过隐藏 core webview 里的桥（`commands()`）拿到，设置页默认没有这条通道。结果只能手输命令名，容易写错。

## 2. 目标与非目标

### 目标

- 命令范围卡片的添加栏出现「选取」按钮，点击弹出可搜索候选：当前会话的 dsh 命令名（`compact` / `feedback` / `goal` / `permission` / `plan`；`/export` 因原生面板不支持下载已隐藏）。
- 候选来自**原生聊天面板的桥**（面板打开且已订阅会话时可用）；设置页与面板可能在不同窗口，经 `SettingsHost.getCommandCandidates()` → `DshNativeChatView.listCommandNames()` → `bridge.commands()` 取。
- 点候选只回填输入框并聚焦（与 0038 的 A1 交互一致），仍需「添加」/ 回车提交；已在名单里的条目不出现；面板未打开 / 未连接时提示手动输入。
- 只在命令范围卡片出现；@ / 技能范围的「选取」行为不变。

### 非目标

- 不做 dsh 侧 RPC / 新桥方法；不改 `commands()` 的返回结构。
- 不把命令范围候选做成静态内置列表（命令按会话 / 预设变化，静态表会过期）。
- 不改变命令范围的匹配语义（仍是精确匹配）与菜单过滤行为。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐，本次落地）** | 设置页经宿主拿候选：`SettingsHost.getCommandCandidates()`（`main.ts`）→ `findNativeChat(app)` → 视图新增 `listCommandNames()` → 桥 `commands()`（复用 0050 的 `filterUnsupportedCommands` 隐藏 export）→ `scope-candidates.ts` 新增 `listCommandCandidates()`（归一化 / 去重 / 排除已有，精确匹配）；`chat.ts` 给命令卡片传 `pickKind: 'command'` + `pick`，`ScopePickerModal` 增加命令的占位 / 图标 / 类型文案 | settings + view 约 5 文件；无桥改动 | 候选永远与当前会话一致；设置页不需要自己懂 dsh RPC。限制：面板未打开 / 未订阅会话时只能拿到空数组，回退手动输入（提示里写明） | **推荐**：复用 0038 的选取交互与 0050 的桥能力，改动小、语义正确 |
| B | 内置静态命令表（compact / feedback / goal / permission / plan）作为候选 | `scope-candidates.ts` + `chat.ts` 文案 | 不依赖面板；但命令按会话 / 预设 / 插件变化，静态表必然过期（0.2.x 已出现 export 之类差异），且与「透传 dsh 自身目录」的目标冲突 | 不推荐 |
| C | 维持 0050 的无「选取」、只手动输入 | 不新增代码 | 零成本；但用户已明确要按钮，手输易错 | 不推荐 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/settings/context.ts](../../src/settings/context.ts) | `SettingsHost` 增加 `getCommandCandidates(): Promise<string[]>` |
| [src/main.ts](../../src/main.ts) | 实现 `getCommandCandidates`：`findNativeChat(this.app)` → `view.listCommandNames()`；面板未打开返回空数组 |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) | 新增 `listCommandNames()`：桥未就绪 / 未订阅时返回空；成功后用 `filterUnsupportedCommands` 过滤并取 name |
| [src/settings/scope-candidates.ts](../../src/settings/scope-candidates.ts) | `ScopeCandidate.kind` 增加 `'command'`；新增 `listCommandCandidates(names, existing)`（`normalizeCommandName` + 去重 + 精确排除已有 + 字典序） |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 命令范围卡片传 `pickKind: 'command'` / `pick`；`ScopePanelOptions.pickKind` 联合类型加 `'command'`；「选取」tooltip / 加载提示 / 候选弹窗占位、空态、图标与类型标签适配命令；白 / 黑名单 `pickEmpty` 文案改为「需要先打开原生聊天面板」 |
| [docs/changes/0050-dsh-command-passthrough.md](0050-dsh-command-passthrough.md) | 追加「0051 补充」说明 |
| 本文件 + [docs/changes/README.md](README.md) + [docs/roadmap.md](../roadmap.md) | 登记 R-34 / 0051 与索引 |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点表 / 配置说明 / 文件职责表 / 改动地图 / 回归清单补「命令范围选取」 |

不改桥、不改 dsh 服务、不改 `/export` 策略、不 bump 版本号。

## 5. 行为变化

- 设置 →「聊天」→「命令范围」选白名单 / 黑名单后，添加栏行首出现「选取」（与 @ / 技能同款）。
- 点击「选取」：原生聊天面板打开且已订阅会话时，弹出可搜索候选（`compact` / `feedback` / `goal` / `permission` / `plan`；`/export` 不列），点选只填入输入框，仍需「添加」/ 回车；已在名单里的条目不再出现。
- 面板未打开 / 桥不可用 / 还没订阅会话：候选为空，提示「需要先打开原生聊天面板读取当前会话命令目录」并可直接手输。
- @ / 技能范围的「选取」行为不变；命令范围过滤语义不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 设置窗口与原生面板不在同一窗口 | 宿主方法能否找到面板取决于 `findNativeChat(app)`；找不到时返回空数组 | 已实测跨窗口可用；失败时手动输入兜底 |
| 面板打开了但未选中会话（桥未订阅） | `commands()` 抛错 → 空候选 | 视图 catch 返回空；提示文案写明 |
| 候选包含 `/export` | 加进名单却永远不会显示 | 视图侧复用 `filterUnsupportedCommands` 过滤 |
| 命令目录随预设变化 | 候选与菜单可能和上次不同 | 每次点「选取」现取；不做缓存 |
| 设置窗口被关 / 切 tab 时异步返回 | 写进已失效面板 | 沿用 `isStale()` 与 `isConnected` 检查 |

回滚：删掉命令卡片的 `pickKind` / `pick` 与 `getCommandCandidates` 链路即可回到 0050 的手动输入（其余功能不受影响）。

## 7. 验证

自动化：

```
npm run build   # tsc + esbuild
npm run check   # 版本 / 依赖 / 类型 / main.js 与源码一致
```

纯函数冒烟（`scope-candidates.ts`）：

- `listCommandCandidates`：归一化 / 去重 / 排序；非法名（`a.b`、`a/b`、空、中文）丢弃；已有条目精确排除、不误伤前缀（`goal` 不排除 `goal-x`）；空输入。
- 技能候选仍按 `-` 前缀覆盖（回归 `listSkillCandidates`）。

手动（CDP / 人工）：

1. 打开原生聊天并选中一个会话 → 设置 → 聊天 → 命令范围 → 白名单：添加栏行首有「选取」；点击弹出候选 5 条（export 不列），类型标「命令」。
2. 点 `goal` → 输入框填入 `goal` 且弹窗关闭；「添加」后标题「白名单（1）」、列表出现 `goal`。
3. 关闭原生聊天面板后再点「选取」→ 提示「需要先打开原生聊天面板…」，仍可手动输入。
4. 黑名单同款；@ / 技能范围的「选取」仍正常。
5. 测试后还原为「不启用」，`data.json` 里 `commandScope: "off"` / 两个空数组。

**验收标准**：命令范围有「选取」且候选来自当前会话命令目录；点选只回填不提交；面板关闭时手动输入兜底；无控制台错误；build/check 通过。

## 8. 需要你拍板（已按用户明确指定执行）

- [x] 加「选取」按钮（2026-10-28）
- [x] 候选来源：原生面板桥的 `commands()`（面板未打开时手动输入兜底）（2026-10-28）
- [x] 不把 export 列入候选（2026-10-28）

## 9. 实施记录

**落地（2026-10-28，路径 A）**：

| 文件 | 实际改动 |
|---|---|
| [src/settings/context.ts](../../src/settings/context.ts) | `getCommandCandidates()` 加入 `SettingsHost` |
| [src/main.ts](../../src/main.ts) | `getCommandCandidates` → `findNativeChat` → `view.listCommandNames()` |
| [src/view/native/native-chat-view.tsx](../../src/view/native/native-chat-view.tsx) | 新增 `listCommandNames()`（桥未就绪 / 抛错 → 空；成功后 `filterUnsupportedCommands`） |
| [src/settings/scope-candidates.ts](../../src/settings/scope-candidates.ts) | `ScopeCandidate.kind` 加 `'command'`；新增 `listCommandCandidates` |
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 命令卡片接「选取」；tooltip / 加载提示 / 弹窗占位 / 空态 / 图标 / 类型标签 / pickEmpty 文案适配 |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点表 / 配置说明 / 文件职责 / 改动地图 / 回归清单（69、70） |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-34 / 0051 登记与收尾 |

**验证结果**：

- `npm run build` 通过（main.js 314.8kb）；`npm run check` 全通过。
- 纯函数冒烟 **7 项全过**（`listCommandCandidates` 归一化 / 去重 / 非法名 / 精确排除已有 / 不误伤前缀 / 空输入 + `listSkillCandidates` 回归）。
- CDP 实测（Obsidian 1.14.5，dsh 0.2.1-rc.3，ptc 预设，面板与设置分属两个窗口）：命令范围切白名单后出现「选取」，tooltip 正确；点击弹出 5 条候选（compact / feedback / goal / permission / plan，类型「命令」，export 已过滤）；点 `goal` 只回填输入框，点「添加」后存为 `goal`、标题「白名单（1）」；测试后已还原 `commandScope: "off"` / 空名单并核对 `data.json`。
- 未实测：面板关闭时的空候选提示（代码路径为 catch/空数组 + 文案，未在 UI 里真点一次）。

**与提案的偏差**：无。
