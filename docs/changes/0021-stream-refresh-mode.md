---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: packages/dsh-obsidian-bridge, src/settings, src/view/native, docs
issue: 流式输出看着一跳一跳：桥端 50ms 合并 + 每次全量 Markdown 重渲染；需要「出字即刷新」并能在设置里切换
---

# 0021 流式刷新节奏可调（逐字 / 每帧 / 平衡 / 省电）

> 对应路线图 [R-4](../roadmap.md#需求待办)。本提案只做调研与路径对比，**选路前不改代码**。

## 1. 背景与问题

### 现象

原生面板里 Assistant 正文是流式的，但看起来「卡卡的」：文字成块跳出来，而不是顺滑地逐字增长；
回复越长越明显，偶尔还会整段重排一下。

### 实测数据（2026-10-27，本机同 vault 会话日志）

- 模型：`deepseek/deepseek-v4.1-flash`（obsidian profile 与桌面端一致，reasoningEffort: high）。
- 按 `assistant/message.usage.outputTokens / 流式时长（首 chunk → 末 chunk）` 统计 67 个步骤：
  **中位 213 tok/s**（P10 155、P90 308）；可见正文约 **188 字符/秒**。
- 结论：**不是模型太慢**，是显示侧被限流 + 每次刷新太贵。

### 根因（代码定位）

1. **桥端硬性 50ms 合并**：`packages/dsh-obsidian-bridge/lib/client.js:170` 的 `LIVE_FLUSH_MS = 50`，
   `markLive()`（同文件 204-215）把高频 chunk 合并成最多 **20 次/秒** 的 `liveRevision` 递增。
   原生端再快也只能每 50ms 拿到一次文本 → 每次补约 9 个字符，视觉上就是「一跳一跳」。
2. **每次刷新都全量重渲染 Markdown**：`src/view/native/ui/markdown-text.tsx:39-54` 的 effect 依赖 `text`，
   每次 live 更新都会 `el.replaceChildren()` 并整段 `MarkdownRenderer.render()`（含 `component.unload()` 重建）。
   文本越长越慢，实际刷新率会掉到 20Hz 以下，于是越写越卡。
3. **每次刷新都全量传 live blocks**：`livePacket()`（client.js:229-237）把已累积的全文随每个包传回，
   IPC + JSON 序列化成本随消息长度线性增长（20 次/秒 × 全文）。
4. 次要：poll 循环在结构变化时会先 `await refreshSnapshot()`（`native-chat-root.tsx:170-173`，
   内含 snapshot + permissions 两次 IPC），期间 live 更新被延后。

### 影响

纯阅读场景可接受，但「边看边想」时节奏感差；用户明确希望能「出字就刷新」，并且可以在设置里自由切换。

## 2. 目标与非目标

- 目标：
  - 新增设置项，能在 **逐字（每 chunk）/ 每帧（16ms）/ 平衡（50ms，现状）/ 省电（100ms）** 之间切换；
  - 默认改为 **每帧**，让长回复也顺滑；
  - 设置改动在面板打开时即时生效，不需要重开面板；
  - 旧版桥（仍带 50ms 合并）时仍可用，只是刷新上限约 13Hz，不报错。
- 非目标：
  - 不改模型 / provider 的 chunk 粒度，不改 dsh 侧协议；
  - 不做打字机动画、不做虚拟滚动；
  - 不改变消息最终形态（settle 后仍是同一份 Markdown）。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | ① 桥端 flush 可配：`client.js` 把常量改成 `let liveFlushMs = 50` + 新方法 `setLiveFlush(ms)`（0 = 每个 chunk 立即 bump）；② 宿主 `core-bridge.ts` 加同名调用；③ `native-chat-root.tsx` 用 `requestAnimationFrame` 合帧（同一帧多个包只取最后一个再 `setLive`），切换设置时调用桥方法；④ `settings/schema.ts` + `tab.ts` 加四档下拉，默认 `frame` | 1 个桥方法 + 1 个设置项 + 宿侧合帧，约 80~120 行 | 需要 relink 桥并重启服务才生效；逐字档下 IPC 约 150~300 次/秒、且仍是全量 Markdown 重渲染，**长回复可能更吃 CPU**；「平衡/省电」档可兜底 | 改动小、可快速验证；先解决 20Hz 上限。若逐字档在长回复下仍卡，再用 B 的渲染改造 |
| **B（目标态）** | A 的全部 + 流式期间正文走**纯文本快通道**：`AssistantText` 在 `running` 时用 `white-space: pre-wrap` 的纯文本节点增量更新，settle 后再切回一次 `MarkdownText`（`timeline-nodes.tsx` / `markdown-text.tsx` 新增 streaming 分支） | A + 新增 streaming 组件与样式，约 150~200 行 | 流式期间**列表 / 代码块 / 链接不排版**，收尾瞬间会有一次「从纯文本切成排版」的视觉跳变；实现与回滚都比 A 大 | 手感最好、长文本不退化；如果「顺滑」优先于「流式中途的排版」，选它 |
| **C（最小）** | 只加设置项 + 宿主侧合帧/丢弃（`native-chat-root.tsx` 里 rAF 合并），**不动桥** | 1 个设置项 + 宿侧 ~30 行 | 桥端仍是 50ms 合并，**最快只能 20Hz**；「逐字」档实际退化为「平衡」，达不到「出字即刷新」；无需 relink/重启 | 只能降频省电，不能解决核心诉求；只在「完全不想重启服务」时选 |

**推荐 A**：它能兑现「设置里自由切换 / 出字即刷新」的核心诉求，改动集中在桥的一个方法和宿侧合帧，
验证成本低；长回复若仍卡，再按 B 增量做渲染快通道（两者可叠加，不冲突）。

> **最终实现（2026-10-27）**：用户选 B 后实测发现桥端定时器在离屏 webview 里不可靠，
> 改为「桥每个 chunk 立即通知 + 宿侧 rAF/间隔节流」，详见 §9；上表的 A/B 保留了当时的调研对比。

## 4. 改动清单（最终实现）

| 文件 | 改动 |
|---|---|
| `packages/dsh-obsidian-bridge/lib/client.js` | 删除 live 的定时合并，`assistant/live-chunk` 到达即 `bumpLive()`（每个 chunk 一次唤醒） |
| `packages/dsh-obsidian-bridge/README.md` | 说明「桥即时通知 + 宿侧按帧合帧」 |
| `src/settings/schema.ts` | `streamRefresh: 'chunk' \| 'frame' \| 'balanced' \| 'relaxed'`，默认 `'frame'`；导出 `streamRefreshMs(mode)` |
| `src/settings/tab.ts` | 「流式刷新」下拉（逐字 / 每帧 16ms / 平衡 50ms / 省电 100ms）+ 说明文案 |
| `src/view/panel-host.ts` | 增加 `getStreamRefresh(): StreamRefreshMode`（不把 Plugin 实例漏进 view） |
| `src/view/native/native-chat-view.tsx` | 把 host 的设置读取透传给 `NativeChatRoot` |
| `src/view/native/ui/native-chat-root.tsx` | live 包只存 ref，按 `requestAnimationFrame` 渲染；按设置里的最小间隔跳帧 |
| `src/view/native/ui/timeline-model.ts` | `TextItem.streaming`：live 合成节点的正文标记为流式 |
| `src/view/native/ui/timeline-nodes.tsx` | `AssistantText` 流式期间走纯文本快通道，settle 后回到 `MarkdownText` |
| `src/view/native/ui/timeline.tsx` | 把 `streaming` 透传给正文组件 |
| `styles.css` | `.dsh-native-live-text`（`white-space: pre-wrap` + 换行） |
| `docs/development.md` | 改动地图补「流式刷新」一行 |
| `docs/architecture.md` | 数据流补 live 合帧与纯文本快通道 |

## 5. 行为变化

- 设置页新增「流式刷新」四档，默认 **每帧（16ms）**；面板打开时切换即时生效。
- 流式期间正文以**纯文本**逐 chunk 增长（不再每帧重排整段 Markdown），收尾后一次性排版。
- 逐字 / 每帧档：桥对每个 chunk 立即唤醒，宿主按 rAF 渲染（上限 60Hz）；平衡 50ms、省电 100ms 按间隔跳帧。
- 旧版桥：设置仍可切，但仍有 50ms 合并，刷新上限约 13Hz，不报错。
- 消息内容、工具卡、审批、停止、会话切换行为不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 逐 chunk 唤醒的 IPC / 序列化压力 | 长回复时调用频繁 | 实测 27~38 包/秒；最坏把桥恢复为 50ms 合并，或默认改回 `balanced` |
| 流式期间 Markdown 语法不排版 | 代码块 / 列表 / 链接收尾才成型 | 切回「平衡 / 省电」也不恢复；如需中途排版要另做增量 Markdown（未采纳） |
| 桥改动未生效 | 设置看似切换但刷新仍约 13Hz | 桥的 `client.js` 走 HMR；不生效时重启 DSH 服务 |
| 设置改动破坏既有默认值 | 老用户观感变化 | `mergeSettings` 已回填默认；随时可切回「平衡」 |

## 7. 验证

自动化：

```bash
npm run build
npm run check
```

手动 / CDP（Obsidian 内，已执行）：

1. 设置页出现「流式刷新」四档，默认「每帧」；
2. 发一条长回复：流式正文纯文本增长，收尾后 Markdown 成型；
3. 宿主窗口 60fps、无 longtask；
4. 四档切换后设置写入 `data.json`。

验收标准：

- 四档都能选且即时生效（设置值写入 `data.json`）✅
- 流式期间按帧刷新、无整段重排 ✅（实测 571 帧 / 9.5s，0 longtask）
- 收尾后正文与流式末态一致 ✅（191 / 224 字两轮对比）
- 旧桥不报错、不丢消息 ✅（不使用新 API，仍走 `nextEvent`）
- `npm run check` 通过，`main.js` 与源码一致 ✅

## 8. 需要你拍板

- [x] 选哪条实现路径：**B**（2026-10-27）
- [x] 默认档位：**每帧（16ms）**（2026-10-27）
- [x] 逐字档不做「CPU 空闲才全速」的自动降级（保持可预期）

## 9. 实施记录（2026-10-27）

用户选定 **B（流式纯文本快通道）+ 默认每帧**，按此实施。

### 实际改动

- **桥**（`packages/dsh-obsidian-bridge/lib/client.js`）：删除 live 的 16/50ms 定时合并，
  `assistant/live-chunk` 到达即 `bumpLive()`，每个 chunk 都唤醒原生端。
- **宿主**（`native-chat-root.tsx`）：live 包只写入 ref，用 `requestAnimationFrame` 每帧最多渲染一次；
  「平衡 / 省电」按设置里的最小间隔跳帧。
- **渲染**：流式期间正文用 `.dsh-native-live-text` 纯文本（`white-space: pre-wrap`），
  settle 后由正式节点一次性 Markdown 排版。
- **设置**：`streamRefresh`（默认 `frame`）+ 设置页「流式刷新」四档；面板打开期间切换即时生效
  （每次轮询读取 host 设置，无需重开面板）。

### 与提案的偏差（已记录，不改变用户可见行为）

原计划的 `setLiveFlush(ms)` 桥端可配方案被放弃：实测离屏 core webview 里的
`setTimeout(16ms)` 会被 Chromium 拖到 **~75ms** 才触发，桥端合批把刷新率压到 **13Hz**；
而宿侧 rAF 稳定在 60fps。因此改为「桥即时通知 + 宿侧按档合帧」，桥 API 不新增方法。
四个档位、默认值、纯文本快通道均与提案一致。

### 验证（Obsidian 1.14.5 + dsh 0.2.1-rc.3 + 本仓库 0.4.1，CDP 实测）

- 桥侧 live 包：61 包 / 1.6s（约 38/s，中位间隔 11ms）；正文包约 27/s、每包约 5 字。
- 宿主 60fps：571 帧 / 9.5s（中位 17ms），**0 个 longtask**；流式正文按帧增长，无整段重排。
- 收尾：live 纯文本被正式节点替换，Markdown 正文与流式末态一致（191 / 224 字的两次对比）。
- 设置页「流式刷新」四档可选，值为 `frame`；切换后设置写入 `data.json`。
- 短回复（单 chunk）与长回复（440 字）均正常；Obsidian 控制台无新增错误。
- `npm run build` / `npm run check` 通过；`main.js` 已重新生成。

### 注意事项

- 旧版桥（未更新 `client.js`）仍可用，但仍有 50ms 合并，刷新上限约 13Hz；不需要降级提示。
- 流式期间不渲染 Markdown 语法（代码块 / 列表 / 链接在收尾后成型），这是 B 路径的预期取舍。
