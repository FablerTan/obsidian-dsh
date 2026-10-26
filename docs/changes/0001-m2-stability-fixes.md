---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: src/service, src/view, manifest.json, package.json
issue: 修复 M2 稳定性四项：iframe 自愈、重启竞态、可信探测、版本一致
---

# 0001 M2 稳定性修复

> 状态：✅ **已完成（2026-10-26）**。按推荐方案（方案 A）实施：M2-1 iframe 自愈、M2-2 stopAndWait 重启、
> M2-3 注入 requestUrl 可信探测、M2-4 版本统一 0.2.0。M2-5（locator 版本提示）不纳入本次，另起提案。
> 后续变化（0004）：`src/view/frame.ts` 已删除并并入 `src/view/surface.ts`；M2-1 的承载面自愈行为保留（webview / iframe 双路径）。

## 1. 背景与问题

M2 的四项都是"能用但不稳"的问题，逐条可复现：

| 编号 | 现象 | 根因 |
|---|---|---|
| M2-1 | 面板先打开、服务后起 → iframe 停在 Chromium 错误页，必须关掉面板重开 | `onOpen` 先设 `iframe.src` 再拉起服务，之后只改 banner 文案，没有重新加载 |
| M2-2 | 连点「重启服务」有时失败（`EADDRINUSE`）或假成功 | `restart()` 发 `SIGTERM` 后固定等 1s 就重拉，不等旧进程真正退出 |
| M2-3 | 端口被别的程序占用时仍报「运行中」 | `fetch(mode:'no-cors')` 是 opaque 响应，任何监听都算成功 |
| M2-4 | 版本号与实际不一致 | `manifest.json` 0.2.0 而 `package.json` 0.1.0 |

## 2. 目标与非目标

- 目标：① 服务就绪后 iframe 自动出现 GUI；② 重启稳定且端口上始终只有一个 dsh；③ 探测能区分"是 dsh"与"端口被占"；④ 三处版本号一致。
- 非目标：不做 M3 的 postMessage 导出桥；不改 iframe 套壳架构；不动 dsh 侧 profile。

## 3. 方案

### M2-1 iframe 自愈 —— 方案 A（推荐）

- 给 [src/view/surface.ts](../../src/view/surface.ts)（0004 前为 `frame.ts` 的 `DshFrame`）增加 `reload()`（已有 `load(url)` 可复用）与内部 `hasLoaded` 标记。
- [src/view/dsh-view.ts](../../src/view/dsh-view.ts)：
  - `onOpen` 里 `await host.ensureStarted()` 成功且当前未连接 → `frame.reload()`；
  - `refreshStatus()` 探测成功时，若从未成功加载过则 reload 一次（之后不再 reload，避免打断用户操作）。
- 备选 B：改成"先确保服务再创建 iframe"。首屏白屏时间更长，且服务起不来时连 banner 都没有，不选。

### M2-2 重启竞态 —— 方案 A（推荐）

- [src/service/manager.ts](../../src/service/manager.ts)：把 `killChild()` 换成 `stopAndWait(timeoutMs = 3000)`：
  1. `SIGTERM`；
  2. 等 `exit` 事件，超时则 `SIGKILL` 并再等 ≤1s；
  3. 返回是否已退出。
- `restart()`：`await stopAndWait()` → `start()`（去掉固定 `sleep(1000)`）。
- 备选 B：保留 sleep 但加长到 3s。治标不治本，且重启更慢，不选。

### M2-3 可信探测 —— 方案 A（推荐，需要你拍板）

- 问题：`service/` 不能 import `obsidian`，而能读状态码/正文的 `requestUrl` 来自 Obsidian。
- 做法：把探测函数作为**依赖注入**进 `DshServiceManager`（构造参数 `probe: (url) => Promise<boolean>`）；默认实现仍是 `fetch`，由 [src/main.ts](../../src/main.ts) 注入基于 `requestUrl` 的实现（放 [src/shared/host.ts](../../src/shared/host.ts)）。
- 判定：HTTP 200 且响应正文包含 dsh 页面标识（如 `__ModuleLoader__`）→ 是 dsh；其他 → 明确报「端口被占用」而不是「运行中」。
- 备选 B：保留 no-cors，只在 UI 上提示"可能误判"。等于不修，不选。
- ⚠️ 需要你确认：接受引入 `requestUrl`（Obsidian 官方 API，minAppVersion 1.4.0 可用），还是坚持零 Obsidian 依赖只做"端口占用提示"？

### M2-4 版本一致 —— 方案 A

- `manifest.json` 保持 0.2.0，把 `package.json` 改成 0.2.0（`versions.json` 已有 0.2.0 → 1.4.0，不动）。
- 顺带在 `docs/development.md` 与 AGENTS 强调：三处一致由构建后的检查确认。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/service/manager.ts` | 增加 `stopAndWait()`；`restart()` 改用它；接受注入的 `probe`；探测失败原因区分 |
| `src/service/probe.ts` | 保留 `fetch` 默认实现；新增"响应内容校验"版本（纯函数，接收 `fetch` 结果） |
| `src/shared/host.ts` | 新增基于 `requestUrl` 的探测实现，供 main 注入 |
| `src/view/frame.ts` | 增加 `reload()` 与 `hasLoaded` |
| `src/view/dsh-view.ts` | 就绪后 reload 一次；状态条区分「已连接 / 端口被占用」 |
| `src/main.ts` | 注入 probe 实现 |
| `package.json` | version 0.1.0 → 0.2.0 |
| `docs/*`、`AGENTS.md` | 同步行为变化（若探测文案有变） |

## 5. 行为变化

- 面板在服务就绪后**自动**出现 GUI（不再需要重开）。
- 「重启服务」更慢一点但稳定（最多多等 ~2–3s 的退出等待）。
- 端口被其他程序占用时，状态条显示「端口被占用」而不是「运行中」。
- 插件版本显示 0.2.0。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| `requestUrl` 在面板环境行为与 fetch 不同 | 探测误判 | 探测函数可注入，回退到 fetch 实现只需改 main 一行 |
| 自动 reload 打断正在输入的会话 | 用户操作被打断 | 只在"从未加载成功"时 reload 一次，已连接后不再 reload |
| 等待退出超时导致重启变慢 | 体感变慢 | 超时值可配置常量，必要时调小 |

## 7. 验证

- 自动：`npm run build`；service 层冒烟（esbuild 打包 manager 到 /tmp，用本地 http server 模拟占用端口与非 dsh 端口）。
- 手动：
  1. 关掉 dsh（`kill $(lsof -ti tcp:3082)`）→ 打开面板 → 服务自动起、GUI 自动出现（不需要重开面板）。
  2. 连点 5 次「重启服务」→ 每次成功，`lsof -nP -iTCP:3082` 始终只有一个监听。
  3. `python3 -m http.server 3082` 占端口 → 面板/状态条报「端口被占用」，不再显示「运行中」。
  4. 设置页显示版本 0.2.0（`manifest.json` 一致）。

## 8. 需要你拍板

- [ ] M2-3 是否接受引入 `requestUrl`（Obsidian API）来做可信探测？还是只保留"端口占用提示"？
- [ ] 四项一次做完，还是拆成 4 个独立提案分批验收（建议一次做完，改动互相独立、验证可一起跑）？
- [ ] 版本号统一到 **0.2.0** 是否可以（与 `versions.json` 一致），还是想直接跳到 0.2.1？
- [ ] 是否需要把 M2-5（locator 可能选到旧版全局安装）也并进这次？

## 9. 实施记录

**2026-10-26 实施完成**（方案 A 全部落地；M2-5 按约定不纳入）。

| 项 | 实际改动 | 验证 |
| --- | --- | --- |
| M2-1 | `view/frame.ts` 增加 `reload()`（about:blank → 原地址）；`view/dsh-view.ts` 记录 `frameReady`，服务就绪且尚未加载成功时重载一次 | 代码评审通过；**待在 Obsidian 里手动确认一次**（服务未起 → 打开面板 → 服务起后 GUI 自动出现） |
| M2-2 | `service/manager.ts` 新增 `stopAndWait(3000)`（等 exit，超时 SIGKILL 再等 1s）；`restart()` 改为「等退出 → 再 start」 | 实测 start 1035ms、restart 1043ms / 579ms；日志顺序为「旧进程 exited → 新进程 spawning」；无 EADDRINUSE；结束后 0 监听、无进程残留 |
| M2-3 | 三态类型放 `shared/types.ts`；`service/probe.ts` 保留 fetch 兜底；`shared/host.ts` 新增 `createDshProbe()`（requestUrl + `__ModuleLoader__` 校验，1.5s 竞速超时）；`main.ts` 注入 | 实测：普通 http server 占用端口 → `occupied` / 状态条「端口被占用」且不 spawn；伪造 dsh 页面 → running；真实 dsh → running |
| M2-4 | `package.json` 0.1.0 → 0.2.0 | manifest / package / versions.json 三处一致 |
| 附带 | spawn 参数增加 `--no-open`；`shared/constants.ts` 增加 `isDshPage()` | 日志不再出现 opening the default browser；服务照常 200 |

偏差与说明：

- 探测类型（`Probe`/`ProbeResult`）放在 `shared/types.ts` 而不是 `service/probe.ts`：否则 `shared/host.ts`（含 Obsidian 依赖）会反向依赖 `service/`，违反分层规则。
- `defaultProbe` 保留 fetch 版本（三态退化为二态），只用于脱离 Obsidian 的 service 层冒烟；插件运行时始终注入可信探测。
- 新增状态文案「端口被占用」，已同步 `docs/architecture.md` 与 `docs/troubleshooting.md`。

遗留：M2-5（locator 可能选到旧版全局安装）未做，另起提案。
