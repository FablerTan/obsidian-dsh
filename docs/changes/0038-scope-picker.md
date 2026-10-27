---
status: done             # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27      # 用户选路：A + A1 + B1 + C1，接受本地技能目录扫描
scope: src/settings, src/service, styles.css
issue: 设置页 @ 引用范围 / 「/」技能范围的白名单与黑名单添加栏：在「添加」按钮左侧加「选取」按钮，自动列出符合条件的候选（vault 路径 / 技能名），点选后填入添加栏
---

# 0038 白 / 黑名单添加栏的「选取」按钮（候选自动获取 + 点选填入）

> 对应路线图 [R-21](../roadmap.md#需求待办)。用户原话：「在设置的黑名单和白名单的添加按你左侧添加一个选取的按你，会自动获取符合条件的内容进行点击输入」（「按你」按上下文即「按钮」）。

## 1. 背景与问题

### 现状

设置 →「聊天」tab 里有两组范围设置：**「@」引用范围**（R-13，[0030](0030-mention-scope.md)）与**「/」技能范围**（R-20，[0037](0037-skill-slash-scope.md)）。选中「白名单」或「黑名单」后，下方展开添加栏：一个文本输入框 +「添加」按钮（[src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) 的 `renderScopePanel`），只能**手写**：

- @ 范围：vault 相对路径（文件或文件夹，如 `日记/2026`）；
- / 范围：技能名或前缀（如 `office`，覆盖 `office-docx` 等）。

路径 / 名字记错时，只能在提交后从提示行看到「路径无效」或「已经在列表里」，然后回去翻左侧文件列表 / 技能目录再抄一遍。深层文件夹、`office-*` 这类带前缀的技能名尤其别扭。

### 需求（用户原话拆解）

1. 设置页白名单 / 黑名单的添加栏，在「添加」按钮左侧加一个**「选取」按钮**。
2. 点「选取」后**自动获取符合条件的候选内容**。
3. 候选可**点击输入**（落到添加栏的输入框里，再提交）。

### 影响范围

只改设置页「聊天」tab 的添加栏与它的候选来源；不改设置数据结构、不改 @ / `/` 菜单的过滤规则、不改桥、不需要重启 dsh 服务。

## 2. 目标与非目标

### 目标

- @ 范围与 / 范围的添加栏（白 / 黑共 4 处）各加一个「选取」按钮，位置见第 8 节拍板项。
- 点击后弹出**可搜索**的候选列表：
  - @：vault 里的文件夹与文件（沿用 @ 菜单的排除规则：`.git` / `node_modules` / 点开头的段默认不列）；
  - /：本机技能目录里的技能名。
- 候选里**不再列出**已在当前名单中的条目，也排除已被名单条目覆盖的冗余项（例：名单已有 `日记` 时，`日记/2026` 对白 / 黑名单都是冗余；名单已有 `office` 时 `office-docx` 冗余）。
- 点候选 → 填入输入框并聚焦；「添加」与回车提交、校验、错误提示全部沿用现有逻辑。
- 没有候选 / 读取失败时给出可读提示；手写输入始终可用（不破坏现状）。

### 非目标

- 不直接写设置、不跳过现有校验与保存流程（除非第 8 节选「直接加入」）。
- 不改名单数据结构与匹配语义；不改 @ / `/` 菜单过滤；不新增设置项。
- 不改桥 `packages/dsh-obsidian-bridge`，不重启 dsh 服务。
- 不做多选 / 批量导入 / 从左侧文件列表拖入 / 列表内二次筛选面板。
- 不调整设置页 tab 结构，不引入运行时依赖。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

先拆两层：**候选数据源**与**交互形态**。

### 3.1 候选数据源

- **@ 路径**：设置页已有 `context.app`，可直接 `app.vault.getAllLoadedFiles()`（与 @ 菜单同源，见 [native-chat-root.tsx](../../src/view/native/ui/native-chat-root.tsx)），**不需要桥**。
- **/ 技能名**：现状唯一现成来源是桥 v5 的 `skills()`（[core-bridge.ts](../../src/view/native/core-bridge.ts)），但它依赖**原生面板 + 隐藏 core + 已订阅会话**；打开设置页时面板不一定在。
  备选是**本地扫描 dsh 的技能根目录**（与 `dsh-skill-filesystem` 一致：vault 的 `.dsh/skills`、`.agents/skills`，`$DSH_HOME/skills`、`~/.agents/skills`；目录项取 `SKILL.md` 的 frontmatter `name`，单文件取 `*.md` 文件名）。[src/service/plugin-inventory.ts](../../src/service/plugin-inventory.ts) 已有 `resolveDshHome()` 可复用。

### 3.2 交互形态（3 条路径）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 「选取」按钮 → Obsidian 原生 `SuggestModal`（搜索框 + 键盘上下 + Enter / 点击选中 + Esc 关闭）。选中后**只填入输入框并聚焦**，不直接提交。@ 候选由 `chat.ts` 用 `app.vault.getAllLoadedFiles()` 构造，/ 候选走新增的 `host.getSkillCandidates()`；排除逻辑放进新增纯函数 `src/settings/scope-candidates.ts`。/ 的数据源用新增 `src/service/skill-catalog.ts` 扫描本地技能根目录（frontmatter `name`，15s 缓存，参考 `plugin-inventory.ts` 的写法） | settings 3 处 + service 1 个新文件 + `context.ts` / `main.ts` 各一个方法 + `styles.css` 少量；约 200~260 行 | 新增一个 service 文件与一个纯函数；`SuggestModal` 是官方 API，搜索 / 键盘 / 点击 / 样式开箱即用；技能候选是本地目录的**近似值**，插件 / 预设注入的技能可能不在列表里（手写输入仍可用，弹窗里标注来源） | **推荐**：面板关着也能用，候选可搜索、可键盘操作；vault 大时也不卡（过滤在弹窗内做） |
| B | 交互同 A，但 / 的数据源直接复用桥：`main.ts` 的 `getSkillCandidates()` 里 `findNativeChat(app)` → 视图暴露 `listSkills()`（转调 React 根组件的 `loadSkills`）；面板没开 / 会话未就绪时返回空并提示「打开聊天面板后可用」 | settings + view + `main.ts`，**不新增 service 文件**；约 120~160 行 | 少一个 fs 扫描文件，但**设置页是否可用取决于聊天面板是否打开**——而配置名单往往正是面板关着的时候；还要在 view 里加一个跨 React 边界的取数方法，破坏面更大 | 不推荐：把可用性绑到面板生命周期上，与「设置页随时可配」冲突 |
| C | 不用浮层：添加栏下方**常驻**一段候选列表（搜索框 + 前 N 条 + 「显示更多」），点条目填入输入框 | 只改 `settings/sections/chat.ts` + `styles.css`；约 150 行 | 没有浮层 / modal 代码，但设置页被拉长；vault 有几千条时渲染与滚动要自己管；白 / 黑 × @ / / 共 4 处各挂一段列表，页面很吵 | 不推荐：交互密度不如弹窗，维护成本反而更高 |

**推荐 A**：@ 完全复用现有来源，/ 用本地技能目录扫描，**都不依赖聊天面板**；`SuggestModal` 正是 Obsidian 里「从已有条目里选一个」的标准做法（带搜索的候选弹窗），键盘 / 点击 / Esc / 主题样式全部由官方实现，自己只需要提供候选与「选中后做什么」。

## 4. 改动清单（按推荐 A 预估）

| 文件 | 改动 |
|---|---|
| [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts) | 添加栏加「选取」按钮（位置见拍板项）；点击按当前模式构造候选并打开 `SuggestModal`；点候选后 `inputEl.value = 候选` 并 `focus()`；候选为空 / 读取失败的提示行；样式类 `.dsh-settings-scope-pick` |
| `src/settings/scope-candidates.ts`（新增，纯函数） | `listScopeCandidates(entries, existing, kind)`：排除隐藏段 / `.git` / `node_modules`、已在名单中的条目、被名单条目覆盖的冗余项；技能名用同一套前缀覆盖规则 |
| [src/settings/context.ts](../../src/settings/context.ts) | `SettingsHost` 增加 `getSkillCandidates(): Promise<string[]>`（拿不到返回空数组，不抛） |
| [src/main.ts](../../src/main.ts) | 实现 `getSkillCandidates()`：转调 `service/skill-catalog.ts` |
| `src/service/skill-catalog.ts`（新增） | 扫描 vault `.dsh/skills`、`.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`；目录取 `SKILL.md` frontmatter `name`，单文件取文件名；去重排序；15s 缓存（复用 `resolveDshHome`） |
| [styles.css](../../styles.css) | 「选取」按钮样式：复用 `.dsh-settings-scope-button` 的尺寸 / 主题变量，只加 `.dsh-settings-scope-pick` 的少量差异 |
| [docs/architecture.md](../architecture.md) / [docs/development.md](../development.md) | 关注点表 / 文件职责表 / 改动地图 / 回归清单 |
| [docs/roadmap.md](../roadmap.md) / [docs/changes/README.md](README.md) | R-21 状态、本提案索引 |

不改：`packages/`、桥协议、`main.js`（产物由 `npm run build` 生成）、设置数据结构。

## 5. 行为变化

- 4 处添加栏（@ 白 / 黑、/ 白 / 黑）各出现一个「选取」按钮；手写输入与「添加」完全不变。
- 点「选取」：@ 弹出 vault 文件夹 + 文件列表（可搜索）；/ 弹出技能名列表（可搜索）；已加入或被覆盖的条目不再出现；没有可选项时说明原因。
- 点候选：填入输入框并聚焦，不自动提交（若拍板项选「直接加入」，则等同于点「添加」）。
- 数据源不可用（技能目录为空 / 扫描失败）：按钮仍可点，提示行说明「没有可选取的技能名，可手动输入」；不影响已有名单与现有提交逻辑。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 本地技能目录与 dsh 会话可见技能不完全一致（插件 / 预设注入的技能不在文件系统里） | 候选可能少几项 | 列表仅作辅助，手写输入保留；弹窗里注明「来自本地技能目录」 |
| vault 很大时 `getAllLoadedFiles()` 构造候选有一次性开销 | 只在点「选取」时发生，不随每次渲染 | 若明显卡顿，改为只列文件夹，文件名搜索在弹窗内做 |
| 技能根目录随 dsh 版本变化 | 候选失效 | 扫描失败返回空 + 提示，不影响手写；根目录抽成常量便于后续维护 |
| 新增 service 文件依赖 Node `fs` | 移动端本就不可用（`isDesktopOnly: true`） | — |

回滚：移除「选取」按钮与新增文件即可；设置数据与已有名单不受影响。

## 7. 验证

- `npm run build` / `npm run check` 通过，`main.js` 重新生成。
- 纯函数冒烟（node 直接跑，参考 0036 / 0037）：`scope-candidates` 覆盖「已有条目 / 被覆盖条目 / 隐藏段 / 空候选 / 前缀覆盖」用例。
- service 冒烟：`skill-catalog` 对本机根目录返回与 `.dsh/skills` 一致的技能名（`project-guide`、`obsidian-docs`）。
- CDP / 手动：设置 → 聊天 → @ 白名单点「选取」，搜索「日记」，点条目 → 输入框填入并可「添加」；已被 `日记` 覆盖的子路径不再列出；/ 黑名单点「选取」能列出本机技能名；聊天面板关闭时 / 的「选取」仍可用；名单为空时提示正确。
- 验收：4 个添加栏都能打开候选、点选后输入框有值、后续提交行为与改动前一致；原有手写路径无回归。

## 8. 需要你拍板（已定）

- [x] **实现路径**：A —— `SuggestModal` 候选弹窗，@ 用 vault 快照、/ 用本地技能目录扫描。
- [x] **按钮位置**：A1 —— 行首 `[选取][输入框][添加]`。
- [x] **点候选后**：B1 —— 只填入输入框并聚焦，仍需「添加」/ 回车提交。
- [x] **@ 候选范围**：C1 —— 文件夹 + 文件（隐藏段 / `.git` / `node_modules` 不列）。
- [x] **/ 候选来源**：接受本地技能目录扫描（插件 / 预设注入的技能可能不在列表里，手写输入保留）。

## 9. 实施记录

**落地（2026-10-27）**：按用户选路 **A + A1 + B1 + C1** 实现，接受「本地技能目录扫描」作为 / 候选来源。

- 新增 [src/settings/scope-candidates.ts](../../src/settings/scope-candidates.ts)：`listPathCandidates` / `listSkillCandidates`（排除隐藏段 / `.git` / `node_modules`、名单里已有条目、被名单条目覆盖的冗余项；文件夹排前）。
- 新增 [src/service/skill-catalog.ts](../../src/service/skill-catalog.ts)：扫描 `.dsh/skills`、`.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`，目录取 `SKILL.md` frontmatter `name`、单文件取 `*.md`，跟随符号链接，15s 缓存，失败返回空。
- [src/settings/sections/chat.ts](../../src/settings/sections/chat.ts)：添加栏行首 `[选取][输入框][添加]`；点「选取」按当前模式现取候选并用 `SuggestModal` 打开（可搜索）；点候选只回填输入框并聚焦（B1），提交仍走「添加」/ 回车；候选为空 / 读取失败时在提示行说明；`context.isStale()` + `isConnected` 兜住切 tab / 重载。
- [src/settings/context.ts](../../src/settings/context.ts) / [src/main.ts](../../src/main.ts)：`SettingsHost.getSkillCandidates()` → `listLocalSkillNames(vaultPath)`。
- [styles.css](../../styles.css)：`.dsh-settings-scope-pick`（行首按钮图标对齐）与 `.dsh-settings-scope-suggestion*`（弹窗候选行）。
- 文档：[architecture.md](../architecture.md) 关注点 / 持久化说明、[development.md](../development.md) 文件职责 / 改动地图 / 回归第 35 条。

**与提案的偏差**：实施中发现 vault 根文件夹的 `path` 是 `/`（不是空串），第一版会把根目录列为候选（归一化后必然被拒）。已在 `vaultPathEntries()` 与 `listPathCandidates()` 两处显式排除 `/`，并补进纯函数冒烟。

**验证**：

- `npm run build` / `npm run check` 通过，`main.js` 重新生成且与源码一致。
- 纯函数冒烟（esbuild 打包后 node 跑，5 组断言）：已有条目隐藏自身与子项、深层白名单保留祖先文件夹、隐藏段 / `.git` / `node_modules` 不列、技能名前缀覆盖（`office` 覆盖 `office-docx`）与大小写归一、空名单全列。
- service 冒烟：`listLocalSkillNames(<vault>)` 返回测试 vault `.dsh/skills` 下的 6 个技能名；仓库 vault 返回 `obsidian-docs`、`project-guide`。
- CDP 实测（Obsidian 1.14.5，设置窗口）：聊天 tab 两个范围块各出现「选取」，行序 `[选取][输入框][添加]`；@ 弹窗 18 条候选、无根 `/`，搜索「日记」得到 4 条，点选后输入框填 `日记` 并聚焦、弹窗关闭；/ 弹窗 6 条技能名（来自测试 vault 的 `.dsh/skills`），点选后回填；名单已含全部技能时再点「选取」不弹窗、提示「没有可选取的技能名…」；黑名单含 `模板` 时候选不含 `模板` 与其子项；测试后设置已恢复原值（`data.json` 与测试前一致）。
