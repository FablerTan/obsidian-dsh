---
status: done
created: 2026-10-26
approved: 2026-10-26
done: 2026-10-26
scope: src/main.ts, src/view, src/shared, src/settings, styles.css, docs
issue: 去掉可见的官方 DSH webview 面板，只保留 Obsidian 原生聊天面板；原生面板继续使用隐藏的官方 core webview
---

# 0008 只保留原生聊天面板（删除官方 webview 面板）

> 用户 2026-10-26 确认：按方案 A 做，并**删除官方面板**（不保留调试入口）。

## 1. 背景与问题

0006 落地后，插件同时有两个入口：

- `dsh-web`：可见的 Electron `<webview>` 面板，显示完整 DSH Web GUI；
- `dsh-native-chat`：Obsidian 原生 React 面板，内部放一个离屏的官方 core webview，通过
  `executeJavaScript` 调用 `dsh-obsidian-bridge` v2 取数据。

用户希望只保留原生面板：不要再看到官方 Web GUI 面板，也不要让 dsh 被其它 Obsidian
webview 复用登录态。调研结论：

- 可见的 `dsh-web` 视图可以删除；
- **隐藏的 core webview 不能删除**：原生面板的 ChatSnapshot、发送/停止、审批/提问、模型/权限
  都来自这个页面。dsh 0.2.x 没有公开的 headless / stdio 客户端通道；零 webview 等于重写
  DSH 客户端核心，不在本次范围；
- dsh 0.2.x 没有客户端白名单；只能做到 loopback + 每次启动 token（裸 URL 401）。

## 2. 目标与非目标

### 目标

1. 删除可见的 `dsh-web` 面板、ribbon/命令/状态栏入口与 `bridge.ts` v1 调用；
2. 原生面板成为唯一正常入口，新建会话与设置页“桥接状态”都走原生视图的隐藏 core；
3. 隐藏 core 使用插件专用 webview 分区，不再与核心 Web viewer / Canvas 共用 cookie；
4. 升级时把已打开的旧 `dsh-web` leaf 迁移到原生面板；
5. 保留原生面板的模型/权限/审批/提问/当前笔记等既有能力。

### 非目标

- 不做零 webview（需要重写 DSH 客户端核心，依赖未公开 API）；
- 不做 dsh 服务端“只允许本面板”的硬隔离（需要 dsh 上游支持）；
- 不在原生面板里重做 DSH 设置页；模型/凭据仍通过 obsidian profile 配置；
- 不清理 `packages/dsh-obsidian-bridge` 的 v1 布局方法（本次只停止调用，避免 dsh 侧重装）；
- 不做附件 / slash / queue-steer / plan-review / 专用工具卡等 0006 未覆盖能力。

## 3. 方案

### 方案 A（采用）

1. **删除可见面板**
   - 删 `src/view/dsh-view.ts`、`src/view/bridge.ts`；
   - `src/main.ts` 不再注册 `VIEW_TYPE_DSH`，不再有“打开官方 DSH 面板”的 command/ribbon/状态栏入口；
   - `src/view/open.ts` 只保留 `openNativeChat()`，并提供 `findNativeChat()`。
2. **原生视图接管**
   - `DshPanelHost` 抽到 `src/view/panel-host.ts`，只保留原生视图需要的
     `embedUrl / webviewPartition / isRunning / ensureStarted / restartService`；
   - `DshNativeChatView` 暴露 `createSession()`（供“新建 DSH 会话”命令调用）与
     `probeBridge()`（供设置页“桥接状态”）；React 根通过 `onActions` 把
     `createSession` 注册给视图；
   - 原生视图的“打开 DSH 面板”回退按钮改为“重试 / 重启服务”；模型缺失时的
     “打开 DSH 设置”改为“配置说明”Notice（指向 obsidian profile 的
     `cordis.patch.yml` 与 docs/development.md）。
3. **隔离**
   - `DshPanelHost.webviewPartition` 固定为插件专用分区 `persist:dsh-obsidian`，
     不再调用 `app.getWebviewPartition()`；
   - 这样核心 Web viewer / Canvas 的 `persist:vault-*` 不会复用 dsh 的登录 cookie。
4. **迁移**
   - `onload` 的 `onLayoutReady` 里扫描 `leaf.getViewState().type === 'dsh-web'`，
     改为 `dsh-native-chat`；失败则 detach；
   - `VIEW_TYPE_DSH` 改名为 `LEGACY_VIEW_TYPE_DSH`，只用于迁移。

### 方案 B（不采用）

保留可见 `dsh-web` 作为设置/调试入口。用户已明确要求删除官方面板，不保留入口。

### 方案 C（不采用）

零 webview：在插件内直接实现 DSH 客户端协议。需要重写会话装配、投影、审批、模型目录，
且依赖 dsh 内部结构；风险和工期都不可接受。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/dsh-view.ts` | 删除 |
| `src/view/bridge.ts` | 删除 |
| `src/view/panel-host.ts` | 新增：原生面板所需宿主接口 |
| `src/view/native/controller.ts` | 新增：React 根注册给视图的 actions |
| `src/view/native/native-chat-view.tsx` | 接管 createSession / probeBridge / restartService；去掉 openDshPanel |
| `src/view/native/core-bridge.ts` | 增加 `probe()`，`waitReady()` 复用 |
| `src/view/native/ui/native-chat-root.tsx` | 注册 actions；错误页改“重试 / 重启服务”；模型提示改“配置说明” |
| `src/view/native/ui/composer.tsx` / `menus.tsx` | “打开 DSH 设置”改为“配置说明” |
| `src/view/open.ts` | 删除 openDshPanel，新增 findNativeChat |
| `src/main.ts` | 删除官方视图/入口；新建会话走原生；桥状态走原生；专用分区；旧 leaf 迁移 |
| `src/shared/constants.ts` | 删除 VIEW_TYPE_DSH，新增 LEGACY_VIEW_TYPE_DSH |
| `src/settings/tab.ts` | 文案改为原生面板；删除“单栏模式”设置项 |
| `src/view/surface.ts` | 更新分区/承载面注释 |
| `styles.css` | 删除 `.dsh-web-*` 样式 |
| `docs/*`、`README.md`、`AGENTS.md` | 同步“只保留原生面板”的现状与回归清单 |
| `docs/changes/README.md` | 登记 0008 |

## 5. 行为变化

- 默认入口从“DSH Web GUI 面板”变为“Obsidian 原生聊天面板”；ribbon/命令/状态栏点击都打开原生面板；
- 删除命令“打开原生 DSH 聊天（实验）”（与默认入口重复）与命令“打开 DSH 面板”的官方视图语义；
- “新建 DSH 会话”仍会自动起服务、打开原生面板并在库目录新建会话；
- 设置页“桥接状态”检测原生面板的隐藏 core；原生面板未打开时显示未打开；
- 模型/凭据配置不再能通过官方 DSH 设置页进入；改为 Notice 指引编辑 obsidian profile；
- 旧的可见面板不再存在；升级时已打开的旧 leaf 自动迁移到原生面板；
- 隐藏 core 仍会加载完整官方页面（离屏），这是原生面板的数据源。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 旧 `dsh-web` leaf 迁移失败 | 升级后出现空面板 | 迁移失败时 detach；用户重新打开原生面板 |
| 专用分区导致首次加载需重新 token 登录 | 首次打开稍慢 | 改回共享分区（不推荐，会复用 cookie） |
| 删除官方面板后无法进入 DSH 设置页 | 模型/凭据配置只能改 profile 文件 | 文档给出 `cordis.patch.yml` 指引；必要时恢复官方视图（回滚 0008） |
| 原生面板仍有 0006 未覆盖能力 | 附件 / slash / plan-review 等不可用 | 使用桌面 DSH 或回滚 0008 |
| 新建会话 controller 尚未就绪 | 命令偶发失败 | `waitActions` 超时并提示重试；保留面板内“＋”按钮 |
| 关闭原生视图后隐藏 core 销毁 | 重开需重新加载 | 与现有行为一致；服务不随之停止 |

回滚：恢复 `dsh-view.ts` / `bridge.ts` / `VIEW_TYPE_DSH` 与官方入口，恢复共享分区；
本次改动不涉及 dsh 侧插件与 Host 协议，回滚只动 Obsidian 插件。

## 7. 验证

### 自动化

- `npm run build` 通过（tsc + esbuild）；
- `npm run check` 通过（版本 / 依赖 / 类型 / main.js 与源码一致 / bridge 清单）；
- `node --check packages/dsh-obsidian-bridge/lib/client.js` 由 check 覆盖。

### 手动回归

1. 重新加载插件 → 状态栏 `DSH: 运行中`；
2. ribbon / 命令 / 状态栏只打开原生面板，不再出现官方 Web GUI 面板；
3. “新建 DSH 会话” → 服务就绪 → 原生面板打开并进入新会话；
4. 原生面板发送 / 流式 / 停止 / 审批 / 提问 / 模型 / 权限 / 当前笔记无回归；
5. 设置页“桥接状态”在原生面板打开时显示 connected（v2），关闭时显示未打开；
6. 旧版已打开的 `dsh-web` leaf 升级后变为原生面板或关闭；
7. 关闭插件 → 端口释放；
8. 从原生面板打开 DSH Web 的路径不存在；模型配置说明 Notice 可读。

### 验收标准

- 可见的官方 webview 面板与所有入口消失；
- 原生面板可完成 0006 Phase 1 的手动验收项；
- `npm run build` / `npm run check` 通过；
- `docs/` 中不再把官方 webview 面板写成默认入口。

## 8. 需要你拍板

- [x] 方案：A（去可见 webview，保留隐藏 core）。
- [x] 官方面板：删除，不保留调试入口。
- [x] 模型配置：不在原生面板重做设置页，用 Notice 指向 obsidian profile。
- [x] 是否接受“隐藏 core 仍是 webview”这一硬限制（已说明，按 A 执行）。

## 9. 实施记录

### 代码（2026-10-26）

- 删除 `src/view/dsh-view.ts` / `src/view/bridge.ts` 与 `VIEW_TYPE_DSH` 注册；删除全部官方面板入口。
- 新增 `src/view/panel-host.ts`（`DshPanelHost`）与 `src/view/native/controller.ts`（`NativeChatActions`）。
- `DshNativeChatView`：
  - 增加 `createSession()`（等待 `onOpen` 与 React actions 就绪后调用）；
  - 增加 `probeBridge()`（设置页桥接状态）；
  - 增加 `reloadAfterRestart()`（命令重启后重载隐藏 core）；
  - 错误页改为「重试 / 重启服务」；模型缺失提示改为「配置说明」Notice。
- `main.ts`：
  - 只注册 `dsh-native-chat`；ribbon / 命令 / 状态栏 / “新建会话”都走原生面板；
  - 命令 id `open-dsh-view` 保留，显示名改为「打开 DSH 聊天」；删除重复的 `open-native-chat`；
  - `webviewPartition` 改为插件专用 `persist:dsh-obsidian`；
  - `onLayoutReady` 把旧 `dsh-web` leaf 迁移为原生视图，失败则 detach；
  - 设置页「桥接状态」改为探测原生视图的隐藏 core。
- `core-bridge.ts` 增加 `probe()`；`NativeChatRoot` 注册 actions、错误页重启后重新 boot、模型配置提示改名。
- `createSession` 返回布尔结果：面板忙或桥调用失败时，命令入口不再误报「已新建会话」。
- 删除 `.dsh-web-*` 样式；设置页删除「单栏模式」项。
- 版本升到 **0.4.0**（manifest / package / versions.json 三处一致）。

### 验证（2026-10-26）

- `npm run build`：通过（`main.js` 约 200KB）。
- `npm run check`：通过（版本三处一致、无运行时依赖、tsc、main.js 与源码构建一致、bridge 清单/语法）。
- **真实 Obsidian CDP 回归（1.14.4 / dsh 0.2.1-rc.3 / 端口 3082）**：
  1. 重载插件 → 命令只剩 `open-dsh-view` / `new-dsh-session` / `restart-dsh-service`，无 `open-native-chat`；
  2. 原生视图 `dsh-native-chat` 存在，`probeBridge()` 返回 `{ state: "connected", version: 2 }`，无 `dsh-web` leaf；
  3. 隐藏 core 的 `partition` = `persist:dsh-obsidian`，当前 URL 与 `src` 都不含 token；
  4. 设置页显示「聊天由 Obsidian 原生面板承载」，桥接状态「已连接（v2）」，无「单栏模式」项；
  5. 关闭原生视图 → 桥状态 `panel-closed`；命令打开 → 恢复 `connected`；
  6. 命令「重启 DSH 服务」→ 子进程 PID 变化、状态栏「DSH: 运行中」、原生面板自动重载并恢复；
  7. 「新建 DSH 会话」在面板关闭时执行 → 自动打开原生面板、创建会话、输入框可用；
  8. 发送「只回复 OK」→ 用户消息立即出现，流式/工具卡/最终「OK」正常，当前笔记引用 `未命名.md`；
  9. 旧 `dsh-web` leaf + 原生 leaf → 重载后只保留一个原生视图，旧 leaf 被关闭；
  10. 只有旧 `dsh-web` leaf → 重载后自动打开一个原生视图；
  11. 两个原生 leaf → 1.5s 内去重为当前激活的一个。
- **未覆盖**：真 IME、审批/提问在本次改动后的回归、多窗口 popout 浮层、深色主题视觉。
  审批/提问代码未改动，0006 的 CDP 回归仍可参考。

### 与提案的偏差

- 专用分区使用 `persist:dsh-obsidian`（持久化）而不是内存分区：优先避免每次打开都重新登录；
  它仍与核心 Web viewer / Canvas 的 `persist:vault-*` 隔离。若需要更严格的“关闭即清登录态”，
  后续可改成无 `persist:` 前缀的内存分区。
- 删除官方面板后，模型/凭据没有插件内设置入口；按提案用 Notice 指向 obsidian profile。
- 旧 leaf 迁移不是原地 `setViewState`：实际做法是 detach 旧 leaf，再在没有原生视图时调用 `openNativeChat()`；
  并在 onLayoutReady 后 1.5s 去重原生 leaf（Obsidian 恢复布局可能晚于 onload）。
- bridge v1 布局方法未从 `packages/` 删除，只是不再调用（避免 dsh 侧重装与额外回归）。
