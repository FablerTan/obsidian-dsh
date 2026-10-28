---
status: draft
created: 2026-10-27
approved:
scope: src/view, src/main.ts, src/shared, packages/dsh-obsidian-bridge, styles.css, docs
issue: 把 dsh 侧栏插件入口迁移到 Obsidian，并在中栏打开可交互的 dsh 插件面板页面
---

# 0044 把 dsh 插件入口迁移到 Obsidian：中栏渲染插件面板

> 对应路线图 [R-27](../roadmap.md#需求待办)。用户 2026-10-27 提出：dsh 插件用官方接口在左侧栏加的「插件 / 自动化任务 / 第三方入口」，能不能把入口搬到 Obsidian 插件上，点击后在中栏打开一个页面渲染该插件页面。

## 1. 背景与问题

dsh Web GUI 的「全局面板」由客户端插件注册：

- 左侧栏入口：`sidebar.panellist` list；
- 中栏页面：`main` keyed slot 的同名 id；
- 选中：`ctx.layout.selectPanel(id)`（`null` 回到对话）。

官方自带「插件」（id `plugins`）、「自动化任务」（id `schedules`）；第三方插件也可以注册自己的入口和页面。用户截图里的「更多」不是面板，只是 `ui-entry-customization` 的菜单。

0008 之后，Obsidian 侧只有右栏原生聊天 + 隐藏 core，没有可见 Web GUI，因此这些入口和页面在 Obsidian 里完全不可达。用户的诉求不是「用 Obsidian 原生 UI 重写插件功能」，而是：

1. 入口出现在 Obsidian（ribbon / 命令 / 菜单）；
2. 点击在中栏打开页面；
3. 页面里渲染的仍然是 dsh 插件自己的页面（可交互）。

相关历史：[0008](0008-native-only-surface.md)（只保留原生面板）、[0031](0031-plugin-management-tab.md)（设置页插件清单，只读/启停）、[0032](0032-optional-bundles.md)（官方可选 bundle 启停）。

## 2. 调研结论（先给答案）

**可以实现，关键链路已经用临时 POC 跑通。**

### 2.1 页面能渲染

- dsh 0.2.x 的登录 cookie（`dsh-auth-*`，HttpOnly + SameSite=Strict）存在 webview 分区里；插件专用分区是 `persist:dsh-obsidian`（[main.ts](src/main.ts#L158)）。
- **POC（临时，未改仓库代码）**：在 Obsidian 主渲染进程里动态建第二个 `<webview partition="persist:dsh-obsidian" src="http://127.0.0.1:3088/">`，不做 token 登录，直接 `dom-ready`；页面加载出完整 Web GUI。
- 同一个 POC 里点击侧栏 `[aria-label="插件"]` 后，插件页完整渲染：出现「已安装插件 / 添加插件 / 内置插件配置 / 实验性插件 / 发现」。
- 证明：**同一分区下第二个 webview 可以共享登录态**，不需要重新登录；页面可交互。

### 2.2 入口能搬运

dsh 没有「面板 URL」或「面板深链」：`selectPanel` 是内存选中态，刷新即回到会话页。官方接口是客户端服务：

| 能力 | 官方接口 | 说明 |
|---|---|---|
| 枚举入口 | `ctx.slots.entriesOfSlot('sidebar.panellist')` | 每项有 `id` / `order` / `label`（label 可能是字符串或 thunk） |
| 枚举页面 | `ctx.slots.entries('main')` | `options.key` 是面板 id，可与入口 id 对齐 |
| 选中面板 | `ctx.layout.selectPanel(id)` | 未注册的 id 会抛错；`null` 回到对话 |
| 当前面板 | `ctx.layout.panelInfo` | 可订阅/读取 `activePanelId` |

所以「迁移入口」= 在 Obsidian 侧维护一份面板清单，点击后用「可见 webview」打开页面，再调用 `ctx.layout.selectPanel(id)`（桥 v8）；桥不可用时用 DOM 点击兜底。

### 2.3 限制与事实

- 面板选中态是内存态，**没有 URL 可深链**；刷新后要重新选中。
- 打开的是**完整 Web GUI**（左栏 + 中栏面板 + 右栏）；要「只显示插件页面」需要在页面里裁剪外壳。
- POC 初步验证了裁剪：把 frame 的 `grid-template-columns` 改成 `0 minmax(0,1fr) 0` 并隐藏 sidebar 列可行；但直接 `display:none` 会让 grid 自动放置把中栏挤到 0 宽（实测 `centerW=0`），需要显式 `grid-column` / 保留占位。因此「仅面板」是**脆弱增强**，不建议作为 v1 默认。
- 「更多」不是面板，不能作为页面渲染；只能复制它的动作（浏览插件 / 创建插件）。
- 第三方插件的页面/表单由插件自己的 client 半身渲染；我们只做承载，不重写。

## 3. 目标与非目标

### 目标

- Obsidian 里能看到 dsh 全局面板入口（至少：插件、自动化任务、已安装插件的面板）。
- 点击入口 → 在中栏新 leaf 打开可见 webview，渲染该面板页面（按钮/表单/滚动/复制可用）。
- 服务重启 / 端口或 token 变化后，页面能恢复同一面板。
- 不改变原生聊天面板的行为；两个视图可同时存在。

### 非目标

- 不把插件页面用 Obsidian 原生 React 重写（按插件逐个对接，0031 的路线只适合官方插件清单）。
- v1 不迁移设置页 / 右侧栏 tab / 会话视图 /「更多」菜单，只做全局面板。
- 不在 Obsidian 里做 dsh 插件安装/卸载 UI（仍走 `dsh plugin` / 设置页现有 tab）。
- 不恢复 0008 之前的「可见官方聊天面板」；中栏只承载插件页。
- 不做移动端。

## 4. 实现路径调研

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）桥 v8 + 中栏 webview + 原生入口** | 桥 v8：`panels()` / `openPanel(id)` / `activePanel()`，用 `ctx.slots` + `ctx.layout`；Obsidian 新增 `DshPluginPanelView`（中栏 ItemView + 现有 `createDshSurface` webview）；ribbon/命令 + 原生选择器；服务重启时 view 重载并恢复面板 | 桥 + `src/view` + `src/main.ts` + `src/shared` + `styles.css`，约 500~800 行 | 需要 relink 桥 + 重启服务；依赖 dsh 0.2.x 的 client 侧服务；页面默认是完整 GUI | **推荐**：入口枚举/选中走官方 API，第三方面板也能出现；可退回 DOM 点击 |
| B 纯宿主 DOM 驱动（不改桥） | 中栏 webview 里 `executeJavaScript` 枚举 `[aria-label]` 侧栏按钮、按 label 点击；入口清单来自 DOM 快照 | 仅 `src/view`，约 300 行 | 本地化 / DOM 结构一变就坏；拿不到稳定 id 与 active 状态；第三方 label 重复时不可靠 | 可做 POC / 兜底，不建议作为主路径 |
| C 原生重绘 | 用插件的宿主侧 remote/service（如 `pluginManager`）取数据，在 Obsidian React 里重建页面 | 每个插件一套 UI | 第三方页面/表单无法通用重写；只适合官方几个页面；工作量大 | 不推荐；0031 已是官方清单的特例 |
| D 上游加「面板页」路由/API | 让 dsh 提供 `/?panel=plugins` 或独立面板 URL / 外部宿主 API，中栏 webview 直接打开只含面板的页面 | dsh 上游 | 最干净（无 DOM 裁剪、无桥内部 API），但依赖外部仓库排期 | 长期最优；可作为跟进/上游提案，不作为本期唯一依赖 |

**推荐 A**：把「入口枚举 + 面板选中」放在官方 client API 上，页面承载复用现有 [surface.ts](src/view/surface.ts)；第三方注册的面板也能自动出现。B 仅作桥不可用时的兜底。
**A 的可选增强**：页面加载后注入「只显示面板」的裁剪（隐藏 sidebar / 右栏 / 底栏）。POC 表明可行但要处理 grid 显式定位；建议做成设置项，默认完整 GUI，避免默认走脆弱路径。

## 5. 改动清单（按 A）

| 文件 | 改动 |
|---|---|
| [packages/dsh-obsidian-bridge/lib/client.js](packages/dsh-obsidian-bridge/lib/client.js) | v8：`panels()`（枚举 `sidebar.panellist`，过滤有 `main` 面板的 id，解析 label/order）、`openPanel(id)`（`ctx.layout.selectPanel(id)`）、`activePanel()`；`ctx.inject` 增加 `slots` / `layout`；`VERSION` 7→8 |
| [packages/dsh-obsidian-bridge/package.json](packages/dsh-obsidian-bridge/package.json) | 版本 0.5.0 → 0.6.0；README 补 v8 说明 |
| [src/shared/constants.ts](src/shared/constants.ts) | 新增 `VIEW_TYPE_PLUGIN_PANEL = 'dsh-plugin-panel'` |
| [src/view/plugin-panel-view.ts](src/view/plugin-panel-view.ts)（新增） | `ItemView`：中栏 leaf；`createDshSurface` 建 webview；原生工具条（面板下拉 / 刷新 / 回到聊天）；`panels()` / `openPanel()` 就绪重试；服务重启重载；销毁 webview |
| [src/view/open.ts](src/view/open.ts) | `openPluginPanel(panelId?)`：已有 leaf 则 reveal + setState，否则新中栏 leaf |
| [src/view/panel-host.ts](src/view/panel-host.ts) | 暴露新 view 所需宿主能力（复用 `embedUrl` / `webviewPartition`；增加服务重启广播） |
| [src/main.ts](src/main.ts) | 注册新 view；ribbon + 命令「DSH 插件面板…」；面板选择 Modal；`restartService()` 后通知已开 view 重载并恢复面板 |
| [src/view/native/core-bridge.ts](src/view/native/core-bridge.ts) | 可选：透传 `panels()` / `openPanel()`，供命令清单缓存（也可让 view 自己拉） |
| [styles.css](styles.css) | 工具条、空态、选择器样式（Obsidian 主题变量） |
| [docs/architecture.md](docs/architecture.md) / [docs/development.md](docs/development.md) | 新视图与桥 v8 的链路说明、手动回归 |

## 6. 行为变化

- 新增 ribbon 图标 / 命令「DSH 插件面板…」；打开后可选择「插件 / 自动化任务 / 第三方面板」，在中栏打开对应页面。
- 页面是完整 dsh Web GUI（或设置项切换成仅面板）；可正常点击、输入、滚动。
- 关闭 leaf 即销毁 webview；服务重启后已开页面自动重载并恢复同一面板。
- 原生聊天面板、隐藏 core、现有设置页不变。

## 7. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 桥 v8 依赖 client 侧服务（slots / layout） | dsh 升级后不兼容；桥加载失败 | 桥版本化；`panels/openPanel` 失败时回退 DOM 点击；仍只支持 0.2.x |
| 可见 webview 回归（与 0008 方向冲突） | 用户觉得「又打开了网页」 | 只在中栏、只承载插件页；命令可选；不替换原生聊天 |
| 仅面板裁剪脆弱 | sidebar 隐藏后中栏 0 宽 / 布局错位 | 默认完整 GUI；裁剪放设置里；出问题关掉 |
| 两个 webview 各自连 host | 资源占用；会话 writer 冲突？ | 全局面板不选会话；同时只保留一个面板 leaf；关闭即销毁 |
| 服务重启 / token 变化 | 页面 401 | view 监听重启，按新 `embedUrl` 重载；带 token 兜底 |
| 第三方页面依赖设置页 / 路由 | 打不开或空白 | v1 只保证全局面板；失败给可读错误 +「在浏览器打开」 |
| 安全：可见页面可导航 / 弹窗 | 钓鱼 / 外链 | webview 禁 popup、拦截 `will-navigate` 只允许本机 dsh origin；不改 token 日志策略 |

## 8. 验证

- `npm run build` / `npm run check` 通过；`node --check packages/dsh-obsidian-bridge/lib/client.js`；relink 桥 + 重启服务。
- CDP / 手动：
  1. 命令打开中栏面板 → 出现 webview → 选择「插件」→ 页面出现「已安装插件 / 添加插件」；
  2. 切「自动化任务」→ 内容正确；再切回；
  3. 装一个带 `sidebar.panellist` 的第三方插件 → 选择器出现并打开；
  4. 服务重启后页面恢复同一面板；
  5. 关闭 leaf 后 webview 销毁；原生聊天发送 / 流式零回归；
  6. popout 窗口、缩放、键盘焦点、Escape 行为。
- 验收标准：入口可见、点击 1s 内出现页面、页面可交互、重启后恢复、原生聊天零回归。

## 9. 需要你拍板

- [ ] 路径：**A（推荐）** / B / D / A+B 兜底？
- [ ] 入口形态：一个「DSH 插件面板…」+ 选择器（推荐，简单） / 每个面板一个命令 / 每个面板一个 ribbon 图标？
- [ ] 页面范围：完整 Web GUI（推荐 v1） / 仅面板（CSS/DOM 裁剪，需接受脆弱性） / 先完整、后续再裁剪？
- [ ] 是否接受「中栏出现可见 webview」这一与 0008「原生 only」的局部偏离（仅插件页，不替换聊天）？
- [ ] v1 只做全局面板（`sidebar.panellist` / `main`）？设置页 / 右侧栏 tab / 会话视图 /「更多」菜单先不做？
- [ ] 面板清单发现时机：只在原生聊天打开时缓存（简单） / 另建后台隐藏 webview 常驻枚举（重） / 打开中栏后再枚举（推荐 v1）？
- [ ] 页面里的写操作（安装插件、改配置）是否允许？webview 默认可交互；如需只读要额外拦截。

## 10. 实施记录

（批准后填写）
