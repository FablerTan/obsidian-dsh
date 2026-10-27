---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: packages/dsh-obsidian-bridge, src/view/native, styles.css, docs
issue: 发送按钮左侧缺一个「当前上下文占用」指示：只显示圆环，点击圆环看详情
---

# 0022 输入栏上下文占用圆环

> 对应路线图 [R-5](../roadmap.md#需求待办)。本提案记录调研、选路与实施结果。

## 1. 背景与问题

原生聊天面板的输入栏目前只有左侧的模型 / 权限 chip 和右侧的发送（停止）按钮，没有任何「这次请求会占多少上下文」的提示。
官方 DSH Web 的 composer 下方有一个上下文计量器（圆环 + 百分比，点开是占用构成），数据来自会话投影：

- `contextPressure`：最近一次请求的 prompt 压力（`pressureTokens`）、按当前 surface 推算的下一次请求占用（`projectedTokens`）、最近一条路由的容量（`contextWindow`）；
- `contextBreakdown`：下一次请求的启发式构成（`systemTokens` / `toolsTokens` / `messageTokens`）。

本机事实核对（dsh 0.2.1-rc.3，本 vault 的真实会话日志）：

- `packages/bundle/base/package.json` 已包含 `@deepseek-ai/dsh-token-meter`，所以 obsidian profile（`dsh-base`）里这两个投影是注册过的；
- 会话日志里存在 `request/context`（`provider: command-code`、`model: deepseek/deepseek-v4.1-flash`、`contextWindow: 1000000`）与 `assistant/message.usage`，即分子 / 分母都有真实来源，**不需要按字符数猜**；
- 桥已经在用会话投影读数据：`packages/dsh-obsidian-bridge/lib/client.js` 的 `permissions()` 走 `sessionFace().projections.faceOf('permissions')`，同样的方式可以读 `contextPressure` / `contextBreakdown`。

当前 UI 侧没有任何对应字段：`src/shared/native-types.ts` 的 `NativeChatSnapshot` 只带消息节点与 pending；
`src/view/native/ui/native-chat-root.tsx` 轮询刷新的是 snapshot + permissions；`composer.tsx` 右端只有发送按钮。

## 2. 目标与非目标

- 目标：
  - 在**发送 / 停止按钮左侧**增加一个上下文占用按钮，**只显示一个圆环**（不显示百分比文字）；
  - 圆环按当前占用着色填充，hover 有 `上下文已用 X%` 的提示；
  - **点击圆环**弹出详情：占用百分比、`~已用 / 窗口` token 数、system / tools / messages 的构成条与图例（数据缺失时降级为只显示百分比与 token 数）；
  - 会话内自动更新，不需要重开面板；切换会话 / 新建会话后跟随当前会话；
  - 旧版桥（没有该能力）时显示灰色空环，不报错、不影响发送。
- 非目标：
  - 不做「压缩上下文 / 清理历史」按钮或命令，点击详情只读；
  - 不展示计费金额、累计 token 账单或每轮 usage 历史；
  - 不改官方隐藏 core 的 UI，不改 dsh 的投影定义；
  - 不做按字符数 / 消息条数自行估算的「近似占用」（见路径 C 的取舍）。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 桥新增 `context()` 方法：订阅会话时读 `contextPressure` / `contextBreakdown` 两个投影快照并返回；原生端新增一个独立调用，把结果交给 composer 的圆环与详情浮层 | 桥 1 个方法 + 投影订阅；`core-bridge.ts` 1 个调用；`native-types.ts` 3 个 DTO；root 1 个 state；新增 `context-meter.tsx`；`composer.tsx` 右侧分组；`styles.css` 一组类；桥需重新 link + 重启服务 | 多一次 `executeJavaScript` 往返（每次结构变化刷新一次，量级远小于 snapshot）；桥 API 面 +1；投影缺失时要能降级 | 与现有 `permissions()` / `models()` 的取数方式一致，snapshot 契约不膨胀；**推荐** |
| **B** | 不新增方法，把 `context` 字段直接并入 `snapshot()` 返回；原生端从 `snapshot.context` 读取，其余 UI 相同 | 桥 `snapshot()` +1 个字段 + 投影订阅；原生端只改 `NativeChatSnapshot` 与 root；无 `core-bridge` 新方法 | 少一次 IPC；但每次快照都多带一小段数据，且圆环新鲜度与结构 revision 绑定；旧桥没有该字段时按 undefined 显示灰色空环 | 少一次调用，实现略简单；但把「独立投影」塞进已经很大的快照，契约变宽，**次选** |
| **C（最小，不推荐）** | 完全不动桥：用 `snapshot.nodes` 的文本长度按固定密度估算 token，窗口数从 `models()` 的模型元数据里取（拿不到就不显示） | 只改原生端 2~3 个文件，无需 relink / 重启 | 数字与官方圆环不一致（CJK、工具 schema、压缩都会偏），且 `models()` 目前不保证透出 `contextWindow`；无法给出可信的 system/tools/messages 构成 | 只适合「完全不想重启服务」的临时方案，容易让用户误判上下文，**不推荐** |

**推荐 A**：占用数据本来就是独立投影，单独取数可以按需刷新、缺失时干净降级；也避免把 `snapshot()` 这个已经承担消息节点的大对象继续加宽。
A 与 B 的 UI 部分完全相同，选 B 只是省掉一次调用，不改变功能。

### 3.1 数据形状与百分比口径（与官方一致）

桥返回（字段都可能缺失）：

```ts
interface NativeContextUsage {
  pressure: {
    pressureTokens?: number;
    projectedTokens?: number;
    contextWindow?: number;
  } | null;
  breakdown: {
    systemTokens: number;
    toolsTokens: number;
    messageTokens: number;
  } | null;
}
```

展示口径与官方 `contextOccupancy` 相同：

```ts
const used = pressure.projectedTokens ?? pressure.pressureTokens;
const percent = Math.min(100, Math.round(used / pressure.contextWindow * 100));
```

- 优先 `projectedTokens`（已按 surface 变化修正），没有时退回 `pressureTokens`；
- 只有分子或只有窗口时显示**灰色空环**（不画填充，也不用 0% 冒充数据）；
- 详情里的 token 数前缀 `~`：`projectedTokens` 里含启发式修正，不是账单数字。

### 3.2 关键实现点（以 A 为例）

1. **桥**（`packages/dsh-obsidian-bridge/lib/client.js`）
   - `VERSION` 3 → 4；`ping().methods` 增加 `'context'`，原生端据此判断是否支持（旧桥不返回 → 灰色空环）。
   - 新增 `context()`：要求已订阅；用 `sessionFace().projections?.faceOf?.('contextPressure')` / `('contextBreakdown')` 取 `getSnapshot?.()`，只保留有限数字字段，异常时返回 `{ pressure: null, breakdown: null }` 而不是抛错。
   - 在 `subscribe()` 的 `unsubs` 中订阅这两个 face 并 `bump()`，保证 `nextEvent` 能在用量 / 构成变化时唤醒原生端（face 不存在时跳过）。
2. **原生契约**（`src/shared/native-types.ts`）：新增 `NativeContextUsage`；`NativeBridgeErrorReason` 不变。
3. **桥客户端**（`src/view/native/core-bridge.ts`）：`supportsContext()`（来自 ping methods）+ `context(): Promise<NativeContextUsage>`。
4. **状态**（`src/view/native/ui/native-chat-root.tsx`）：新增 `context` state；在 `refreshSnapshot()` 里（或 `attachSession` / `send` / `stop` 后）拉一次；失败不进入错误条，只把 `context` 置空（显示灰色空环）；把 `context` 与 `onContext: (rect) => toggleMenu('context', rect)` 传给 `Composer`。
5. **输入栏**（`src/view/native/ui/composer.tsx`）：右端改成 `.dsh-native-composer-right`，内部依次是圆环按钮、发送 / 停止按钮；圆环用 14px SVG（2px stroke，`stroke-dasharray` 按百分比），无文字；`title` 与 `aria-label` 给百分比；点击把 `getBoundingClientRect()` 交给 root 打开详情。
6. **详情**（新文件 `src/view/native/ui/context-meter.tsx`）：复用 `MenuShell`（`side: 'above'`）渲染只读面板——标题行、`~` token 数、堆叠占比条、三行图例；数据缺失时只显示标题与 token 数。
7. **样式**（`styles.css`）：圆环 track / fill 用 `var(--text-faint)` / `var(--text-muted)`；三类构成用 Obsidian 主题色变量（如 `--color-blue` / `--color-purple` / `--color-green`）；面板复用 `.dsh-native-menu` 的底色、边框、阴影，不硬编码颜色与尺寸。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | `context()` + 投影订阅 + `VERSION=4` / ping methods |
| `packages/dsh-obsidian-bridge/README.md` | 方法表补 `context` 与返回字段 |
| `src/shared/native-types.ts` | `NativeContextUsage`（pressure / breakdown） |
| `src/view/native/core-bridge.ts` | `supportsContext()` + `context()` |
| `src/view/native/ui/native-chat-root.tsx` | 拉取 context、传给 Composer、增加 `context` 浮层分支 |
| `src/view/native/ui/composer.tsx` | 右端分组：圆环按钮 + 发送 / 停止 |
| `src/view/native/ui/context-meter.tsx`（新） | 圆环 + 详情面板（只读） |
| `styles.css` | 圆环、详情面板、构成条与图例 |
| `docs/development.md` | 改动地图补「上下文占用」一行 |
| `docs/architecture.md` | 原生数据流补 context 投影 |
| `docs/roadmap.md` | R-5 状态推进 |

> 选 B 时：去掉 `core-bridge` 新方法，`snapshot()` 增加 `context` 字段，root 从 `snapshot.context` 读取；其余文件相同。
> 选 C 时：只改 `native-types` / `composer` / `context-meter` / `styles.css` / 文档，且不保证数值准确。

## 5. 行为变化

- 输入栏右下、发送按钮左侧出现一个 14px 圆环；**圆环本身没有数字**，hover 提示 `上下文已用 12%`。
- 点击圆环，在圆环上方弹出只读详情：`上下文已用 12%`、`~120K / 1M`、system / tools / messages 构成条与图例。
- 收到首条 assistant 回复（provider 报 usage）后圆环显示填充；新会话、尚未请求过、旧桥或投影缺失时显示**灰色空环**，不用 0% 冒充数据。
- 切换会话 / 新建会话 / 发送 / 停止后圆环跟随当前会话；空环可点击，详情里说明还没有数据，不阻塞发送。
- 点击面板外或 Esc 关闭；面板打开时不影响输入框与发送。
- 不改变模型 / 权限 / 会话菜单、发送内容、流式刷新与任何消息渲染。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| dsh 升级后投影 key / 字段变化 | 圆环无填充或详情缺字段 | 取数做字段校验，缺字段就降级为空环；不改 dsh 侧 |
| 桥新增方法未生效（未 relink / 未重启） | 圆环一直为空环 | 按提示重新 link `packages/dsh-obsidian-bridge` 并「重启 DSH 服务」；旧桥仍可正常聊天 |
| 额外 IPC 调用拖慢流式 | 结构变化时多一次往返 | 实测；若明显，改走 B（并入 snapshot）即可去掉这次调用 |
| `projectedTokens` 是启发式修正 | 数字与账单不完全一致 | 详情加 `~` 前缀，并注明是「下一次请求的估算占用」 |
| 浮层在 popout / 窄栏越界 | 详情被裁切 | 复用 `MenuShell` 的视口 clamp 与上下翻转；必要时面板宽度用 `min(300px, ...)` |
| 高占用时颜色误导 | 用户以为出错 | 本提案不按阈值变色（保持中性色），避免新增语义 |

回滚：删掉桥方法、UI 圆环与浮层即可；桥的投影订阅随方法一起移除，不影响既有 snapshot / permissions。

## 7. 验证

自动化：

```bash
npm run build
npm run check
node --check packages/dsh-obsidian-bridge/lib/client.js
```

手动 / CDP（Obsidian 内）：

1. 重新 link bridge 并重启服务，打开原生面板；有 usage 后圆环显示填充，无数据时显示灰色空环；
2. 对照官方 DSH Web 的上下文计量器 / 会话日志里的 `contextWindow` 与 usage，检查百分比与 `~已用 / 窗口`；
3. 点击圆环：面板在圆环上方展开，显示三行构成；点外部 / Esc 关闭；
4. 新建会话：圆环显示灰色空环；发送首条并收到回复后出现填充；
5. 切换会话：圆环跟随，不残留上一个会话的数字；
6. 圆环 hover 提示、键盘 Tab 聚焦与 `aria-expanded` 正常；流式中面板不闪烁、不阻塞输入。

验收标准：

- 圆环紧贴发送按钮左侧，无百分比文字，直径 14px（±1px），垂直居中；
- 百分比等于 `Math.min(100, Math.round((projectedTokens ?? pressureTokens) / contextWindow * 100))`；
- 无 usage / 无窗口 / 旧桥时显示灰色空环，点击详情给出说明，不抛错、不弹 Notice；
- 点击才出详情，详情含百分比、`~used / window`、system/tools/messages 三行（数据存在时）；
- 旧版桥（v3）下面板正常聊天，圆环为灰色空环，控制台无新增错误；
- `npm run check` 通过，`main.js` 与源码一致；桥重新 link 后「桥接状态」显示 v4 / 连接正常。

## 8. 需要你拍板

- [x] 选哪条实现路径：**A（桥新增 `context()`）**（2026-10-27）
- [x] 详情内容：**完整版**（百分比 + `~` 已用/窗口 + system/tools/messages 构成）（2026-10-27）
- [x] 没有上下文数据时（新会话、旧桥）：**显示灰色空环**（2026-10-27）
- [x] 圆环旁**不要**百分比数字，只有 hover 提示（2026-10-27）

## 9. 实施记录（2026-10-27）

用户选定 **A（桥新增 context()）**、**完整版详情**、**没有数据时显示灰色空环**、**圆环旁不要数字**，按此实施。

### 实际改动

- **桥**（`packages/dsh-obsidian-bridge/lib/client.js`）：`VERSION` 3 → 4；`ping().methods` 增加 `context`；
  新增 `context()` 读取 `contextPressure` / `contextBreakdown` 投影并做数字校验；
  `subscribe()` 订阅两个投影 face，变化时 `bump()`，让原生端在收到回复后自动刷新。
- **原生契约**（`src/shared/native-types.ts`）：新增 `NativeContextPressure` / `NativeContextBreakdown` / `NativeContextUsage`。
- **桥客户端**（`src/view/native/core-bridge.ts`）：`supportsContext()` + `context()`。
- **状态**（`src/view/native/ui/native-chat-root.tsx`）：新增 `context` state；`attachSession` 先置空再拉取，
  `refreshSnapshot` 后并行刷新；切换会话时按 session id + 请求序号丢弃过期结果；失败只显示空环，不进入错误条。
- **输入栏**（`src/view/native/ui/composer.tsx`）：右端改成 `.dsh-native-composer-right`，圆环紧贴发送 / 停止按钮左侧。
- **圆环与详情**（新文件 `src/view/native/ui/context-meter.tsx`）：14px SVG 圆环（无数字）、
  官方口径百分比、`~` 已用 / 窗口、system / tools / messages 构成条与图例；复用 `MenuShell` 的锚定、背板与 Esc 关闭。
- **样式**（`styles.css`）：圆环 track / fill、空环、详情面板、构成条与图例；颜色全部用 Obsidian 主题变量。
- **文档**：桥 README、`docs/architecture.md`、`docs/development.md`（改动地图 + 手动回归第 12、37 条）、
  `README.md` / `AGENTS.md` 的桥版本描述。

### 与提案的偏差

- 无实质偏差。补充一点实现细节：投影 face 通过 active 绑定的 `sessionFace()` 获取（而不是 adapter 返回的 `binding`），
  与既有的 `permissions()` 取数来源保持一致。
- 插件版本保持 **0.4.1**，桥 `package.json` 仍为 0.3.0（API `VERSION=4`）；本次通过 dsh HMR 生效，
  正式安装仍需重新 link 并「重启 DSH 服务」。

### 验证（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 桥 v4）

- `npm run build` / `npm run check` / `node --check packages/dsh-obsidian-bridge/lib/client.js` 全部通过，
  `main.js` 已重新生成。
- CDP 实测：
  - 设置页桥接探测：`connected`，`version: 4`；
  - 打开「简短测试确认」会话：圆环 title 为 `上下文已用 2%`；圆环按钮 24×24（内部 SVG 14×14），
    发送按钮 30×30，两者间距 6px，垂直居中；
  - 点击圆环：详情显示 `2%`、`~18.9K / 1M`、`系统提示 ~10.1K` / `工具 ~628` / `消息 ~6.7K`，点背板关闭；
  - 发送「上下文圆环回归：请只回复 OK，不要调用工具。」并收到 `OK` 后，详情更新为
    `~19.3K / 1M`、`消息 ~6.9K`，说明会话内自动刷新生效；
  - 临时把桥 `context()` 替换为返回 null：圆环变为 `.is-empty`、track 为灰色 `--text-faint`、无填充；
    点击详情显示「还没有上下文占用数据；发送一条消息并收到回复后显示。」；
  - 控制台无新增错误。
- 未单独实测旧 v3 桥：`supportsContext()` 为 false 时与上面的 null 分支相同，均显示灰色空环。

### 后续人工确认

- 旧 v3 桥 / 全新会话在真实设备上的空环观感；
- 高占用（>80%）时圆环与详情条的视觉效果。

