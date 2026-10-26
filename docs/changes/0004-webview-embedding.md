---
status: done
created: 2026-10-26
approved: 2026-10-26     # 用户确认「就按 webview 方案改造」
scope: src/view, src/main.ts, src/service, src/shared, styles.css, docs
issue: 用 Electron <webview> 替换 iframe 承载 dsh，解决 0.2.1 SameSite=Strict 会话 cookie 在跨站 iframe 中不发送导致的 401
---

# 0004 用 Electron webview 承载 dsh 面板

> 状态：**已完成（2026-10-26）**，按方案 A 实施。用户已在 Obsidian 的「网页查看器」里手动验证
> 带 token 的 dsh URL 能正常打开，确认走 webview 路线；自动化验证已通过，面板内加载待最终人工确认。
> 前置：[0003](0003-dsh-version-selection-and-token-auth.md)（0.2.1 token 就绪信号与版本选择，已完成）。

## 1. 背景与问题

0003 已让插件从 stdout 拿到 dsh 0.2.1 的带 token URL，并把它交给 iframe。但实际在 Obsidian 面板里，
token URL 完成 303 登录跳转后仍然是 401：

- dsh 的会话 cookie 在 `packages/client/connection/src/browser-auth.ts`（dsh 仓库）里固定为
  `SameSite=Strict`，没有配置项；
- Obsidian 面板 iframe 的顶层是 `app://obsidian.md`，iframe 是 `http://127.0.0.1:<port>`，属于跨站；
- 跨站 iframe 的后续请求不会携带 `SameSite=Strict` cookie，于是 303 后立刻 401，
  页面只显示 `dsh web authentication required; reopen the URL printed by dsh web.`。

Chrome 实测（顶层 `http://localhost` + iframe `http://127.0.0.1`）：

| cookie 属性 | 303 之后 | 结果 |
|---|---|---|
| `SameSite=Strict` | GET `/` 不带 cookie | 401 |
| `SameSite=None; Secure` | GET `/` 带 cookie | 200（Chromium 接受 loopback 上的 Secure cookie） |

Obsidian 的「网页查看器」和 Canvas 网页卡片用的是 Electron `<webview>`（Chromium webviewTag），
不是 iframe；webview 的 guest 是独立顶层浏览上下文，因此 Strict cookie 正常。用户已手动验证：
在 Obsidian 里用网页查看器打开 dsh 的 token URL 可以正常进入 GUI。

## 2. 目标与非目标

- 目标：
  1. 面板优先用 `<webview>` 承载 dsh，使 0.2.1 的 token → cookie 登录链路成立；
  2. 与 Obsidian 核心 Web viewer 共用 `persist:vault-<appId>` 分区（`app.getWebviewPartition()`），
     不新开一套会话；
  3. 环境不支持 webview 时自动回退到现有 iframe，0.1.1 与既有行为不受影响；
  4. 维持 0003 的 0.2.1 地址、重载、状态条与命令语义不变。
- 非目标：
  - 不改 dsh 代码、不放宽 dsh 的 cookie 安全属性；
  - 不写本地反向代理；
  - 不新增「嵌入方式」设置项（自动选择 + 回退）；
  - 不做原生聊天 UI（M4）；
  - 不接管非本次拉起的 0.2.1 实例（token 仍拿不到）。

## 3. 方案

### 方案 A（推荐，已选）：webview 优先 + iframe 回退

**3.1 嵌入面抽象（新增 `src/view/surface.ts`）**

- 定义 `DshSurface`：`kind: 'webview' | 'iframe'`、`load(url)`、`reload(url?)`、`destroy()`；
- `createDshSurface(parent, url, partition)`：
  1. 用 `parent.ownerDocument.createElement('webview')` 探测（弹窗窗口必须用视图所在文档）；
  2. 若元素具备 `loadURL` / `reload` 方法，按 webview 创建：
     `allowpopups = true`、`partition = partition`（非空时）、`src = url`，然后挂到 `parent`；
  3. 否则创建 iframe，保持现有 `src` → 追加 → `reload` 先跳 `about:blank` 再回目标地址的行为。
- webview 的 `reload(url?)` 用 `loadURL(currentUrl)` 而不是只改 `src`：服务后起、首次停在错误页时，
  即使地址相同也必须重新发起导航（对应 M2-1 的自愈语义）。
- 所有导航 Promise 的 rejection 都吞掉（用户快速重载/重启时 `ERR_ABORTED` 是正常的）；
  `destroy()` 从 DOM 移除元素。
- 只在这一处碰 iframe / webview；其他模块继续只依赖 `DshSurface`。

**3.2 组合根提供分区**

- `DshPanelHost` 增加 `readonly webviewPartition: string | null`；
- `main.ts` 增加 getter：调用 `this.app.getWebviewPartition?.()`（Obsidian 内部方法，核心 Web viewer/Canvas 同款），
  取不到或抛错时返回 `null`（webview 不设分区，使用默认会话，仍能登录，只是不与核心查看器共享 cookie）。
- 不调用 `create-browser-session` IPC：那是核心查看器配置广告拦截/权限用的，dsh 是本地页面，不需要；
  少一个 Electron 内部依赖。

**3.3 视图接线（`src/view/dsh-view.ts`）**

- `DshFrame` 换成 `DshSurface`；onOpen 创建，onClose `destroy()`；
- 服务就绪后继续用最新 `embedUrl` 调 `reload(url)`（0.2.1 每次重启 token 变化）；
- 回退到 iframe 且地址含 `token=` 时，弹一次兼容提示（说明 0.2.1 登录可能失败，建议升级 Obsidian 或改用 0.1.1），
  并在控制台写 `[obsidian-dsh]` 警告；webview 路径不提示。

**3.4 样式**

- `styles.css` 给 `.dsh-web-view webview` 补 `display: flex; width/height: 100%; border: none;`
  与背景色；iframe 规则保持不变。

### 方案 B（备选）：本地反向代理

插件在 127.0.0.1 起一个代理，服务端持有 dsh cookie 再转发（含 SSE/WebSocket/重定向）。
能彻底绕开 SameSite，但需要处理流式响应、Host/Origin、CSP 与端口生命周期，新增 ~250 行并引入
一套长期维护的转发层。当前有更小的 webview 路径，不选。

### 方案 C（备选）：dsh 侧 opt-in 放宽 cookie

把 loopback 上的会话 cookie 改为 `SameSite=None; Secure`（或专门的 embed 鉴权）。
改动小，但跨仓库、放宽 dsh 的安全默认值，且需要用户接受；本次先不动 dsh，不选。

### 方案 D（备选）：`@electron/remote` 改写 cookie / Set-Cookie

依赖 Obsidian 内部启用 remote 的时机与 `webRequest` 单监听器限制，容易覆盖核心行为，脆弱，不选。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/surface.ts` | 新增：`DshSurface` + `createDshSurface()`（webview 优先、iframe 回退、重载/销毁） |
| `src/view/frame.ts` | 删除（职责并入 surface.ts；无其他引用） |
| `src/view/dsh-view.ts` | `DshPanelHost.webviewPartition`；使用 `DshSurface`；回退兼容提示；注释与命名同步 |
| `src/main.ts` | 实现 `webviewPartition` getter（`app.getWebviewPartition?.()`） |
| `styles.css` | webview 填满面板的样式 |
| `AGENTS.md` | `src/view/` 目录说明由 frame 改为 surface |
| `docs/architecture.md` | 全景图、关注点表、分层图、视图章节改为 webview/iframe 双路径与 SameSite 说明 |
| `docs/development.md` | 改动地图、手动回归补 0.2.1 webview 验证 |
| `docs/troubleshooting.md` | 新增「0.2.1 面板仍 401 / webview 回退」排查 |
| `docs/roadmap.md` | M2 后续补 webview 落地记录、最后更新时间 |
| `docs/changes/README.md` | 索引加 0004 |
| `skills/project-guide/SKILL.md` | 目录地图与查询地图里的 frame → surface |
| `README.md` | 嵌入方式由 iframe 改为 webview（回退 iframe）的相关描述 |

不改：`manifest.json` / `package.json` / `versions.json`（不升版本）、service 层、settings 层。

## 5. 行为变化

- 面板默认用 `<webview>` 承载 dsh，0.2.1 的 token 登录可完成（不再 401）；0.1.1 行为不变。
- 面板结构与 banner 不变；命令 id、Notice 文案（除新增的兼容提示）、状态条文案、时序参数不变。
- 控制台新增一行面板承载方式日志（webview / iframe fallback），便于排查。
- 仅当 webview 不可用且地址带 token 时，多一次兼容提示 Notice。
- webview 分区与核心 Web viewer 一致（`persist:vault-<appId>`）；拿不到分区时退回默认会话，仍可用。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 / 缓解 |
|---|---|---|
| `<webview>` 不是 Obsidian 公开插件 API（但核心自用，webviewTag 已开） | 未来 Obsidian 收紧策略时面板打不开 | 自动回退 iframe；回退时明确提示；代码集中在 surface.ts，便于替换 |
| `app.getWebviewPartition()` 是内部方法 | 未来签名变化 | 可选调用 + try/catch，取不到用默认会话，不阻塞 |
| webview guest 被 Obsidian 强制 sandbox | dsh 前端某些能力（如下载/弹窗）受限 | 设置 `allowpopups`；本地页面常规功能应不受影响，手动回归覆盖 |
| 弹窗窗口（popout）的文档不同 | webview 创建在错误文档里 | 用 `parent.ownerDocument` 创建；手动拖到弹窗验证 |
| 删除 frame.ts 后残留引用 | 构建失败 | `grep` 全仓检查；构建 + tsc 把关 |
| 分区与核心查看器共享 cookie | 旧 dsh token cookie 残留 | token 每次进程变化，新的 token URL 会覆盖 cookie；不影响核心查看器其他站点 |

整体回滚：恢复 `src/view/frame.ts`、`dsh-view.ts` 的 iframe 接线、`main.ts` 的 getter 与样式即可；
无数据迁移，无设置变更。

## 7. 验证

自动化（不依赖 Obsidian）：

1. `npm run build` 通过；连续两次构建 `main.js` sha256 一致。
2. `src/view/surface.ts` 用 esbuild 打包到 /tmp，在 Node 里用假 DOM 冒烟：
   - 假 webview（有 `loadURL`/`reload`）→ `kind === 'webview'`；设置 `allowpopups`；
     `partition` 非空时写入；`load` 触发 `loadURL`；`reload()` 对当前地址重新 `loadURL`；`destroy` 移除元素；
   - 假元素没有 `loadURL` → `kind === 'iframe'`；初始 `src` 正确；
     `reload(url)` 先 `about:blank` 再目标地址；`destroy` 移除元素；
   - `partition` 为 `null` 时不写 `partition`。
3. `tsc -noEmit -skipLibCheck` 通过（含在 build 里）。

手动回归（Obsidian；当前 `data.json` 已指向 0.2.1）：

1. 重新加载插件 → 打开 DSH 面板 → GUI 正常显示，不再 401；控制台出现承载方式为 webview 的日志。
2. 命令「重启 DSH 服务」→ 重开面板 → 新 token 仍能登录。
3. 设置切到 0.1.1 → 重启服务 → 面板正常（webview 路径同样兼容）。
4. 切回「自动」/0.2.1 → 重启 → 面板正常。
5. 禁用插件 → 端口释放（`lsof` 无监听）。
6. 把面板标签拖到独立窗口（如可用）→ webview 仍在正确文档里加载。
7. 回退路径由自动化冒烟覆盖；真实环境若 webview 不可用，应看到一次兼容提示而非静默空白。

验收标准：0.2.1 面板在 Obsidian 中稳定显示 GUI（无 401），0.1.1 不回归，构建可复现。

## 8. 需要你拍板

用户 2026-10-26 已确认：

- [x] 采用 `<webview>` 替换 iframe，并保留 iframe 回退。
- [x] 不新增「嵌入方式」设置项，自动选择。
- [x] 回退到 iframe 且地址带 token 时，弹一次兼容提示。
- [x] 分区使用 `app.getWebviewPartition()`，取不到则不设分区（默认会话）。

## 9. 实施记录

**2026-10-26 实施完成**（方案 A）。

| 项 | 实际改动 | 验证 |
|---|---|---|
| 承载面 | 新增 `src/view/surface.ts`：`DshSurface`（kind / load / reload / destroy）+ `createDshSurface()`；webview 先查 `customElements.get('webview')`，`partition` / `src` 在挂载前设置；iframe 回退保持原 about:blank 重载 | 假 DOM 冒烟 5 组全过 |
| 视图 | `dsh-view.ts` 改用 `DshSurface`，`surfaceReady` + 就绪后按最新 `embedUrl` reload；回退且地址含 token 时一次兼容 Notice + 警告日志 | `npm run build` 通过 |
| 组合根 | `main.ts` 实现 `webviewPartition`（`app.getWebviewPartition?.()` + try/catch，取不到返回 null） | 类型检查通过 |
| 样式 | `styles.css` 增加 `.dsh-web-view webview` 填充规则；iframe 规则不动 | 构建通过 |
| 清理 | 删除 `src/view/frame.ts`（无其他引用）；manager / log / surface 注释同步为「承载面」 | 源码无 `DshFrame` / `view/frame` 残留引用（历史提案与重命名说明除外） |
| 文档 | AGENTS / README / architecture / development / troubleshooting / roadmap / docs README / changes 索引 / project-guide 技能 / obsdocs quickref 同步 | 术语与相对链接检查 |

验证结果：

- `npm run build` 通过；连续两次构建 `main.js` sha256 均为
  `7e3a5d33b4a518ffb5bf3336c6807ef23314ec6313dc5141e16ffce93b7284d9`（20941 B，可复现）。
- 承载面冒烟（esbuild 打包到 /tmp + 假 DOM）：
  - webview：`kind === 'webview'`、`allowpopups=true`、`partition` 写入、初始 `src` 正确；
    `load` / `reload` 触发 `loadURL`（reload 使用当前或新地址）；`destroy` 移除；
  - `partition=null`：不写分区，走默认会话；
  - `loadURL` 返回 rejected Promise：被吞掉，无 unhandledRejection；
  - 无 `webview` 自定义元素：回退 `iframe`，初始 `src`、`reload` about:blank → 目标、`destroy` 均正常；
  - `customElements` 注册表缺失（极端旧环境）：不抛错，直接回退 `iframe`。
- 构建产物中可见 `customElements.get("webview")` 与 webview 创建逻辑。

偏差与说明：

- 初版计划「挂载后再探测并设置 partition」；核对 Electron webview 的 session 在 attach 时创建后，改为先查
  `customElements.get('webview')`、再在挂载前设置 partition / src，与 Obsidian 核心 Web viewer / Canvas 的做法一致。
- 未调用 `create-browser-session` IPC（核心用于广告拦截 / 权限）；分区仍与核心查看器一致，dsh 是本地页面，无需额外会话配置。
- 回退提示只在「iframe + 地址含 token」时出现，不会打扰 0.1.1 用户。
- **待在 Obsidian 内人工确认**：0.2.1 webview 面板加载、重启后 token 更新、0.1.1 回归、弹窗窗口。

