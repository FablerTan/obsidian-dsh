# Obsidian 插件开发速查（给编程 agent）

> **怎么用**：① 按小节读要点，先确认该用哪个 API；② 需要精确签名 / 示例时，点该节末尾「原文」里的官方页面；③ 本文件只给结论，不复制原文。
> **索引与检索**：全站 1319 页索引在 `skills/obsidian-docs/data/index-dev.json`（`pages[]`，每条含 `path` / `title` / `section` / `slug` / `url` / `headings`）；检索脚本 `skills/obsidian-docs/scripts/obsdocs.mjs` 提供 `list / find / get / url / sync`，先 `find` 定位页面，再 `get` 取正文。
> **链接规则**：一律 `https://docs.obsidian.md/` + 索引中的页面路径（索引自带的 `url` 字段用 `+` 表示空格，本文统一写成 `%20`，两者等价）。本文所有链接都已对索引逐条核对，没有编造页面。
> **版本基准**：文档快照覆盖到 Obsidian 1.13.x API；本项目 `manifest.json` 的 `minAppVersion` 是 `1.4.0`，文档里标 `1.5.7+ / 1.7.2+ / 1.10.0+ / 1.13.0+` 的 API 用前先确认目标版本（见 §8、文末「已知缺口」）。

## 1. 插件骨架与生命周期

**manifest.json 必填字段**（[Manifest 参考](https://docs.obsidian.md/Reference/Manifest)）

| 字段 | 类型 | 要点 |
| --- | --- | --- |
| `id` | string | 仅小写字母 + 连字符；不能以 `plugin` 结尾、不能含 `obsidian`；**本地开发时插件目录名必须等于 id**，否则 `onExternalSettingsChange` 之类不触发 |
| `name` | string | 显示名；不要含 "Obsidian"，不要用核心功能名 |
| `version` | string | 必须 semver `x.y.z`，且与 GitHub release 的 tag 一致 |
| `minAppVersion` | string | 用户 app 低于它时，Obsidian 会去读 `versions.json` 找兼容版本 |
| `isDesktopOnly` | boolean | 用了 Node / Electron API 就必须 `true`（本项目就是 `true`） |
| `description` | string | 插件必填（主题没有）；保持一句话 |
| `author` | string | 插件和主题都必填 |

可选 `authorUrl`、`fundingUrl`（字符串或 `{ "名称": "URL" }`）；改完 `manifest.json` **必须重启 Obsidian**；`loadData/saveData` 写的是插件目录里的 `data.json`。

**main.ts 最小骨架**（[Anatomy of a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Anatomy%20of%20a%20plugin)）

```ts
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  async onload() { /* 注册命令/视图/事件/设置页；this.app 已可用 */ }
  onunload() { /* 只释放非 register* 资源 */ }
}
```

**onload / onunload 要点**
- `onload()` 可 async；顺序建议 `await loadSettings()` → `addSettingTab` → `addCommand` / `registerView` → `registerEvent`。
- `onunload()`：走 `register*` / `addCommand` / `addSettingTab` / `registerView` 的资源由 `Component` 自动清理，自建连接 / worker / 第三方库需手写释放；**不要**在这里 `detach` 自己加的 leaf（官方 guideline 禁止），打开视图用 `onUserEnable()`（1.7.2+）。

**onload 内常用注册方法**

- `addCommand({ id, name, callback })` → 命令面板 / 热键入口（id 自动加插件前缀）。
- `addRibbonIcon(icon: string, title: string, cb: (evt) => void): HTMLElement` → 左侧 ribbon 图标。
- `addStatusBarItem(): HTMLElement` → 状态栏块（移动端不生效）。
- `addSettingTab(new MySettingTab(this.app, this))` → 设置页。
- `registerView(type: string, viewCreator: (leaf) => View)` → 自定义视图。
- `registerEvent(eventRef)` / `registerInterval(id)` / `registerDomEvent(el, type, cb)` / `register(cb)` → 卸载时自动清理。
- `registerMarkdownPostProcessor(fn)` / `registerMarkdownCodeBlockProcessor(lang, fn)` → 阅读视图后处理。

**插件目录结构**（`<vault>/.obsidian/plugins/<id>/`）
- `manifest.json`（手写）、`main.js`（**构建产物**，Obsidian 从这里加载）、`styles.css`（可选，自动加载）、`data.json`（`loadData/saveData` 写入）、`versions.json`（发布用，见 §7）。

**原文**
[Manifest](https://docs.obsidian.md/Reference/Manifest) · [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin) · [Anatomy of a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Anatomy%20of%20a%20plugin) · [Development workflow](https://docs.obsidian.md/Plugins/Getting%20started/Development%20workflow) · [Plugin API](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin) · [onload](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin/onload) · [registerView](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin/registerView) · [Manage plugin lifecycle](https://docs.obsidian.md/Plugins/Guides/Manage%20plugin%20lifecycle)

## 2. 视图与 UI

**ItemView 子类**（[Views 指南](https://docs.obsidian.md/Plugins/User%20interface/Views)）
- 必须实现抽象方法 `getViewType()`（唯一字符串，抽成常量 `VIEW_TYPE_xxx`）与 `getDisplayText()`；`getIcon()` 可选（1.1.0+，等价于设置 `view.icon`）。
- `onOpen()` / `onClose()` 是 protected async 生命周期方法；内容渲染进 `this.contentEl`（`onOpen` 里先 `containerEl.empty()`）。
- 静态侧栏视图设 `this.navigation = false`，会打开文件 / 可导航的视图设 `true`。
- 页签菜单用 `onPaneMenu(menu, source)`；视图头部动作 `addAction(icon, title, callback)`（1.1.0+）。

**注册与激活（照抄这段流程）**

```ts
const VIEW_TYPE = 'my-view';
this.registerView(VIEW_TYPE, (leaf) => new MyView(leaf)); // onload 中

const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
let leaf = leaves[0] ?? this.app.workspace.getRightLeaf(false);
if (leaf) {
  await leaf.setViewState({ type: VIEW_TYPE, active: true });
  this.app.workspace.revealLeaf(leaf); // 侧栏折叠时必须 reveal
}
```

**WorkspaceLeaf 常用**
- `setViewState(state, eState?)` / `getViewState()`：切换 / 读取 leaf 承载的 view type。
- `openFile(file, state?)` / `open(view)` / `detach()` / `setPinned()` / `togglePinned()` / `setGroup(id)`（linked views）。
- `isDeferred()` / `loadIfDeferred()`：延迟加载视图。

**清理规则**
- Obsidian 可能多次调用 view factory，**绝不要在插件里缓存 view 实例**；要实例时用 `getLeavesOfType(VIEW_TYPE).forEach(leaf => leaf.view instanceof MyView && ...)`。
- 插件添加的 leaf 在禁用插件后仍然存在；移除用 `leaf.detach()` 或 `workspace.detachLeavesOfType(VIEW_TYPE)`（不要放在 `onunload` 里，见 §1）。
- 视图 / 组件内创建的 event、interval 用 view 自己的 `registerEvent/registerInterval`，随 view 卸载自动清理。

**弹窗与组件**
- `Modal`：`new MyModal(app).open()`，内容放 `this.contentEl`；新版有 `setTitle()` / `setContent()` / `setCloseCallback()`（1.10.0+）；`onOpen()` / `onClose()` 里手动建 DOM 仍可用。
- `SuggestModal<T>`：`getSuggestions(query)` / `renderSuggestion(item, el)` / `onChooseSuggestion(item, evt)`；输入框建议用 `AbstractInputSuggest`。
- `Menu`：`menu.addItem(i => i.setTitle().setIcon().onClick())` + `showAtMouseEvent(evt)` / `showAtPosition({x,y})`。
- 图标：`setIcon(el, 'name')`、`addIcon(name, '<path .../>')`（0-100 viewBox）；内置图标见 lucide.dev（仅 ≤ v0.446.0）。
- Markdown 渲染进自定义 DOM：`MarkdownRenderer.render(app, md, el, sourcePath, component)`，**必须传一个会被卸载的 Component**，否则泄漏。

**原文**
[Views](https://docs.obsidian.md/Plugins/User%20interface/Views) · [Workspace 指南](https://docs.obsidian.md/Plugins/User%20interface/Workspace) · [Modals](https://docs.obsidian.md/Plugins/User%20interface/Modals) · [Context menus](https://docs.obsidian.md/Plugins/User%20interface/Context%20menus) · [HTML elements](https://docs.obsidian.md/Plugins/User%20interface/HTML%20elements) · [Icons](https://docs.obsidian.md/Plugins/User%20interface/Icons) · [ItemView](https://docs.obsidian.md/Reference/TypeScript%20API/ItemView) · [View](https://docs.obsidian.md/Reference/TypeScript%20API/View) · [WorkspaceLeaf](https://docs.obsidian.md/Reference/TypeScript%20API/WorkspaceLeaf) · [setViewState](https://docs.obsidian.md/Reference/TypeScript%20API/WorkspaceLeaf/setViewState) · [getRightLeaf](https://docs.obsidian.md/Reference/TypeScript%20API/Workspace/getRightLeaf) · [revealLeaf](https://docs.obsidian.md/Reference/TypeScript%20API/Workspace/revealLeaf) · [detach](https://docs.obsidian.md/Reference/TypeScript%20API/WorkspaceLeaf/detach)

## 3. Vault / 文件 API

**读**：`cachedRead(file)` 只用于展示（走缓存）；`read(file)` 用于「读-改-写回」（避免拿到陈旧副本）。
**写**：`modify(file, data)` 整体覆盖；`process(file, (data) => newData)` 原子读改写——**改已存在文件优先用 process**。需要异步处理时：`cachedRead` → 异步加工 → 在 `process` 回调里比对 data 是否仍一致，不一致就放弃或重试。
**建 / 删 / 移**：`create(path, data)`、`createFolder(path)`、`append(file, data)`、`createBinary` / `modifyBinary` / `readBinary`、`delete(file)`（不可恢复）、`trash(file, system)`（进系统回收站或 vault 内 `.trash`）、`rename(file, newPath)`、`copy(file, newPath)`。
**查**：`getAbstractFileByPath(path)`（返回 `TAbstractFile`，必须 `instanceof TFile / TFolder` 判断）、`getFileByPath`、`getFolderByPath`、`getMarkdownFiles()`、`getFiles()`、`getAllLoadedFiles()`、`getRoot()`、`recurseChildren(root, cb)`。**禁止** `getFiles().find(f => f.path === p)`（大 vault 很慢）。
**对象模型**：`TAbstractFile { path, name, parent, vault }`；`TFile { basename, extension, stat { mtime, ctime, size } }`；`TFolder { children, isRoot }`。
**事件**（`app.vault.on(...)`，一律 `this.registerEvent(...)`）：`create(file)`、`modify(file)`、`delete(file)`、`rename(file, oldPath)`。
**metadataCache**（`app.metadataCache`）：`getFileCache(file)` → `CachedMetadata`（`frontmatter`、`frontmatterPosition`、`headings`、`links`、`embeds`、`tags`、`sections`、`blocks`、`listItems`、`referenceLinks`）；另有 `getCache(path)`、`getFirstLinkpathDest(linkpath, sourcePath)`、`fileToLinktext()`、`resolvedLinks` / `unresolvedLinks`。事件：`changed`（索引完成，**rename 不触发**）、`deleted`、`resolve`、`resolved`。
**frontmatter**：读 `getFileCache(file)?.frontmatter`；改一律 `app.fileManager.processFrontMatter(file, fm => { fm.x = 1 })`（原子、格式统一），不要手撕 YAML。
**adapter**（`app.vault.adapter`，`DataAdapter`）：`exists / read / write / append / process / list / stat / mkdir / rename / copy / remove / rmdir / getResourcePath / getName`，参数是 **normalizedPath**。隐藏目录（`.obsidian/` 等）Vault API 看不到，**只能走 adapter**。
**桌面专属**：`app.vault.adapter as FileSystemAdapter` → `getBasePath()` 取 vault 绝对路径，`getFullPath(normalizedPath)` 取任意文件绝对路径；移动端是 `CapacitorAdapter`（没有 getBasePath）。
**路径**：所有用户输入 / 拼接的路径先 `normalizePath(path)`（统一斜杠、去首尾斜杠、NBSP→空格、Unicode normalize）；路径一律 vault 相对、`/` 分隔、无前导斜杠。
**取舍**：Vault API 串行 + 带缓存，优先于 adapter；写当前活动文件用 `Editor`（保留光标 / 选区 / 折叠），`Vault.modify` 只用于后台文件。

**原文**
[Vault 指南](https://docs.obsidian.md/Plugins/Vault) · [Vault API](https://docs.obsidian.md/Reference/TypeScript%20API/Vault) · [process](https://docs.obsidian.md/Reference/TypeScript%20API/Vault/process) · [getAbstractFileByPath](https://docs.obsidian.md/Reference/TypeScript%20API/Vault/getAbstractFileByPath) · [adapter](https://docs.obsidian.md/Reference/TypeScript%20API/Vault/adapter) · [TFile](https://docs.obsidian.md/Reference/TypeScript%20API/TFile) · [TFolder](https://docs.obsidian.md/Reference/TypeScript%20API/TFolder) · [TAbstractFile](https://docs.obsidian.md/Reference/TypeScript%20API/TAbstractFile) · [DataAdapter](https://docs.obsidian.md/Reference/TypeScript%20API/DataAdapter) · [FileSystemAdapter](https://docs.obsidian.md/Reference/TypeScript%20API/FileSystemAdapter) · [getBasePath](https://docs.obsidian.md/Reference/TypeScript%20API/FileSystemAdapter/getBasePath) · [MetadataCache](https://docs.obsidian.md/Reference/TypeScript%20API/MetadataCache) · [CachedMetadata](https://docs.obsidian.md/Reference/TypeScript%20API/CachedMetadata) · [FileManager](https://docs.obsidian.md/Reference/TypeScript%20API/FileManager) · [processFrontMatter](https://docs.obsidian.md/Reference/TypeScript%20API/FileManager/processFrontMatter) · [normalizePath](https://docs.obsidian.md/Reference/TypeScript%20API/normalizePath)

## 4. 工作区、命令与设置

**Workspace 事件**（`app.workspace.on(...)` + `registerEvent`）：`file-open`、`active-leaf-change`、`layout-change`、`resize`、`css-change`、`file-menu`、`files-menu`、`editor-menu`、`editor-change`、`editor-paste`、`editor-drop`、`quick-preview`、`window-open`、`window-close`、`quit`。
- 等布局就位再动手：`app.workspace.onLayoutReady(cb)`。
- 拿活动文件 / 视图：`getActiveFile()`、`getActiveViewOfType(MarkdownView)`、`activeEditor`；**不要**依赖 `workspace.activeLeaf`（guideline 明确反对）。
- leaf 获取：`getLeaf(true)`（root 新 leaf）、`getLeftLeaf(split)`、`getRightLeaf(split)`、`createLeafInParent(parent, index)`、`getLeafById(id)`。
- 窗口：`openPopoutLeaf()`、`moveLeafToPopout(leaf, size)`（弹窗窗口内的 DOM 引用要注意 `win` / `doc`）。

**命令**
- `this.addCommand({ id, name, callback })`：id 会被插件 id 自动前缀，**不要**自己再写插件 id。
- `checkCallback(checking: boolean) => boolean`：返回 `false` 表示命令不可用；`checking === true` 只做预检，`false` 才执行；两次调用之间可能过了很久，**两次都要重新校验前提条件**。
- `editorCallback(editor, ctx: MarkdownView | MarkdownFileInfo)` / `editorCheckCallback(checking, editor, ctx)`：仅在有活动编辑器时出现在命令面板。
- `hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'A' }]`：`Mod` = Ctrl(Windows/Linux) / Cmd(macOS)；字母键用大写（小写会与非拉丁键盘布局冲突）；**面向他人发布的插件不要设默认热键**。
- 其它字段：`icon`、`repeatable`、`mobileOnly`；动态注册用 `removeCommand(id)`（1.7.2+）。

**设置（两种写法，本项目 minAppVersion < 1.13 只能用第二种）**
- 存储：`await this.loadData()` / `await this.saveData(obj)` → 插件目录 `data.json`；默认值 `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`。
- **声明式（1.13.0+）**：`PluginSettingTab.getSettingDefinitions()` 返回定义数组，`control: { type: 'toggle' | 'text' | 'textarea' | 'number' | 'slider' | 'dropdown' | 'file' | 'folder' | 'color', key: 'settingsKey' }`，Obsidian 自动读值、写回并 `saveData()`；支持 `visible` / `disabled` / `validate`、`render`（需自行 saveData）、`type: 'group' | 'list' | 'page'`。
- **命令式（legacy，官方仍长期支持）**：`display()` 里 `containerEl.empty()`，再 `new Setting(containerEl).setName(...).setDesc(...).addToggle(t => t.setValue(v).onChange(async x => { ...; await this.saveSettings(); }))`。
- `Setting` 常用：`setName / setDesc / setHeading / setClass / setTooltip / setDisabled`；`addToggle / addText / addTextArea / addDropdown / addSlider / addButton / addExtraButton / addColorPicker / addMomentFormat / addSearch / addProgressBar / addComponent`；分组用 `SettingGroup`。
- 注册一次即可：`this.addSettingTab(new MySettingTab(this.app, this))`，放在 `onload`、数据加载之后。

**原文**
[Workspace 指南](https://docs.obsidian.md/Plugins/User%20interface/Workspace) · [Commands](https://docs.obsidian.md/Plugins/User%20interface/Commands) · [Settings](https://docs.obsidian.md/Plugins/User%20interface/Settings) · [Events](https://docs.obsidian.md/Plugins/Events) · [Migrate to declarative settings](https://docs.obsidian.md/Plugins/Guides/Migrate%20to%20declarative%20settings) · [Workspace API](https://docs.obsidian.md/Reference/TypeScript%20API/Workspace) · [onLayoutReady](https://docs.obsidian.md/Reference/TypeScript%20API/Workspace/onLayoutReady) · [Command](https://docs.obsidian.md/Reference/TypeScript%20API/Command) · [checkCallback](https://docs.obsidian.md/Reference/TypeScript%20API/Command/checkCallback) · [hotkeys](https://docs.obsidian.md/Reference/TypeScript%20API/Command/hotkeys) · [PluginSettingTab](https://docs.obsidian.md/Reference/TypeScript%20API/PluginSettingTab) · [Setting](https://docs.obsidian.md/Reference/TypeScript%20API/Setting) · [addSettingTab](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin/addSettingTab) · [loadData](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin/loadData) · [saveData](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin/saveData)

## 5. 样式、主题与移动端

**样式**
- `styles.css` 放插件根目录，Obsidian 自动加载，无需 import。
- 建元素用 cls：`containerEl.createDiv({ cls: 'my-class' })`；样式写进 `styles.css`。**不要**写 `el.style.color = 'white'`（guideline 禁止硬编码样式，主题无法覆盖）。
- 用 Obsidian 的 CSS 变量保证与任何主题兼容：`var(--background-primary / --background-secondary / --background-modifier-border)`、`var(--text-normal / --text-muted / --text-faint / --text-error / --text-success)`、`var(--interactive-accent / --interactive-hover)`、`var(--font-*)`、`var(--radius-*)`、`var(--size-4-*)`（间距）、`var(--icon-size / --icon-size-m)`。
- 条件类名：`el.toggleClass('is-error', ok)`。
- 主题 / 片段（CSS snippets）= 覆盖变量：`.theme-dark { --background-primary: #18004f; }`、`.theme-light { ... }`。
- 组件级变量按组件查表：Button / Modal / Tabs / Text input / Toggle / Prompt 等见 CSS variables 索引。

**移动端**
- `isDesktopOnly: true` 的插件在移动端不可安装（本项目如此：需要用 Node / child_process 拉起 dsh 服务）。
- 移动端**没有** Node.js 与 Electron API；任何 `require('fs')`、`child_process`、`electron` 调用会直接崩。判平台用 `Platform`：`isDesktop / isMobile / isDesktopApp / isMobileApp / isIosApp / isAndroidApp / isPhone / isTablet / isMacOS / isWin / isLinux / isSafari`。
- 桌面模拟移动端：开发者工具控制台执行 `app.emulateMobile(true)`（关闭用 `false`）。
- 其它移动端限制：`addStatusBarItem()` 不生效；正则 lookbehind 仅 iOS 16.4+；`Command.mobileOnly` / `isDesktopOnly` 控制入口可见性。

**原文**
[About styling](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling) · [CSS variables](https://docs.obsidian.md/Reference/CSS%20variables/CSS%20variables) · [Colors](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors) · [Spacing](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Spacing) · [Typography](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Typography) · [Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development) · [Platform](https://docs.obsidian.md/Reference/TypeScript%20API/Platform) · [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin%20guidelines)

## 6. 外部资源与网络

**requestUrl（插件里请求第三方 API 的唯一正解）**
- 文档原文：`requestUrl()` *"Similar to fetch(), request a URL using HTTP/HTTPS, **without any CORS restrictions**."*（[requestUrl](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl)）
- 签名：`requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise`；请求参数见 [RequestUrlParam](https://docs.obsidian.md/Reference/TypeScript%20API/RequestUrlParam)（`url / method / headers / body / contentType / throw`）。
- 响应：[RequestUrlResponse](https://docs.obsidian.md/Reference/TypeScript%20API/RequestUrlResponse) 提供 `status / headers / text / json / arrayBuffer`（读 body 的方法，选一个用；超时 / 非 2xx 用 `throw: true` 让 Promise reject）。
- 不要 import `node:http` / `node:https`：移动端没有，且桌面端也绕不过 Obsidian 自己的策略。

**fetch 的坑**
- `fetch` 走 Chromium 的 CORS 检查：目标站点没有 `Access-Control-Allow-Origin` 就会失败；桌面端和移动端都一样受限。
- 结论：跨域请求一律 `requestUrl`，只在同源（自带页面 / 本地资源）时才考虑 `fetch`。

**跨域嵌入（iframe / webview）**
- Obsidian 开发者文档**没有**专门页面讲 CORS / iframe 嵌入（见文末「已知缺口」）；以下是工程经验，非文档结论：
  - 目标站点可通过响应头 `X-Frame-Options` 或 CSP `frame-ancestors` 拒绝被嵌入，这种情况换 `requestUrl` 也无解，只能改为在新窗口打开或做代理。
  - 嵌入本地服务（如本项目 `http://127.0.0.1:3081`）通常没有上述限制。Electron 下 `webview` 标签依赖 `webviewTag`；
    Obsidian 主窗口已开启，核心 Web viewer / Canvas 网页卡片也用它。若目标页面用 `SameSite=Strict` cookie，
    跨站 iframe 不会携带 cookie，需用 `webview`（本项目 0004 的做法），无 webviewTag 时回退 iframe。
  - 跨源 iframe 内部 DOM 不可访问（同源策略），通信只能 `postMessage`。

**密钥 / 令牌**
- 用 `app.secretStorage`（`getSecret / setSecret / listSecrets`）而不是把 token 写进 `data.json`；设置页可用 `SecretComponent`。

**原文**
[requestUrl](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl) · [RequestUrlParam](https://docs.obsidian.md/Reference/TypeScript%20API/RequestUrlParam) · [RequestUrlResponse](https://docs.obsidian.md/Reference/TypeScript%20API/RequestUrlResponse) · [SecretStorage](https://docs.obsidian.md/Reference/TypeScript%20API/SecretStorage) · [Store secrets](https://docs.obsidian.md/Plugins/Guides/Store%20secrets)

## 7. 构建与发布

**esbuild 模板要点**（本项目 `esbuild.config.mjs` 与此一致）
- `entryPoints: ['src/main.ts']`、`bundle: true`、`format: 'cjs'`、`target: 'es2021'`、`outfile: 'main.js'`。
- `external` 必须包含：`obsidian`、`electron`、`@codemirror/*`、`@lezer/*`、`...builtinModules`；`obsidian` 包只是类型 / 运行时替身，**不能**打进产物。
- 开发：`esbuild.context(...)` + `context.watch()`（改源码自动重建）；生产：`context.rebuild()` + `minify` + 关 sourcemap。
- `package.json` 的 `main: main.js` 指向产物；`npm run dev` / `npm run build` 两个脚本足够。

**tsconfig 关键项**（对照本项目）
- `module: ESNext`、`target: ES2021`、`moduleResolution: node`、`lib: ["ES2021","DOM"]`。
- `strict`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`isolatedModules`、`skipLibCheck`、`forceConsistentCasingInFileNames`、`include: ["src/**/*.ts"]`。
- `noEmit: true`（类型检查交给 `tsc -noEmit -skipLibCheck`，打包交给 esbuild）。

**产物与本地加载**
- 只产出 `main.js`；`manifest.json` / `styles.css` 手写。Obsidian 从 `<vault>/.obsidian/plugins/<id>/` 直接读这三个文件。
- 本地测试：拷到该目录 → 设置 → 社区插件 → 启用；改源码后「禁用再启用」或装 Hot-Reload 插件。

**versions.json**
- 结构：`{ "<插件版本>": "<minAppVersion>" }`。只有**改动 minAppVersion** 时才需要追加条目，不用列每个版本。
- 当用户 app 版本低于清单里的 `minAppVersion` 时，Obsidian 用 `versions.json` 找该 app 版本能装的最新插件版本。

**GitHub Release**
- tag 必须等于 `manifest.json` 的 `version`；release 附件：`main.js` + `manifest.json` + `styles.css`（可选）。
- 官方 workflow：`.github/workflows/release.yml`，push tag 触发，`gh release create "$tag" --title="$tag" --draft main.js manifest.json styles.css`，并可用 `actions/attest` 生成构建溯源（提交社区目录时建议有）。
- 仓库 Settings → Actions → Workflow permissions 需要 Read and write。

**提交社区目录**
- 去 [community.obsidian.md](https://community.obsidian.md) 提交；仓库根目录需要 `README.md`、`LICENSE`、`manifest.json`，并已有 release。
- 遵守 [提交要求](https://docs.obsidian.md/Community%20directory/Submission%20requirements%20for%20plugins)（`minAppVersion` 合理、Node / Electron 只能桌面端、命令 id 不带插件 id）。

**原文**
[Release with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release%20your%20plugin%20with%20GitHub%20Actions) · [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) · [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin%20guidelines) · [versions.json](https://docs.obsidian.md/Reference/Versions) · [Manifest](https://docs.obsidian.md/Reference/Manifest) · [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)

## 8. 常用 API 入口速查

| 类 / 接口 | 一句话用途 | 文档 |
| --- | --- | --- |
| `Plugin` | 插件基类：onload/onunload + 全部 add*/register* 方法 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Plugin) |
| `PluginManifest` | manifest.json 的类型（id/version/minAppVersion/isDesktopOnly…） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/PluginManifest) |
| `App` | 全局入口：vault / workspace / metadataCache / fileManager / secretStorage | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/App) |
| `Component` | 生命周期基类：registerEvent/registerInterval/registerDomEvent/addChild | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Component) |
| `Events` | 事件机制基类：on/off/offref/trigger（vault、workspace 都继承它） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Events) |
| `Vault` | 文件 / 文件夹高层 API（读、写、创建、删除、重命名、事件） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Vault) |
| `TFile` | 文件对象：path/basename/extension/stat | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/TFile) |
| `TFolder` | 文件夹对象：children/isRoot | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/TFolder) |
| `TAbstractFile` | 文件 / 文件夹的父类型，需 instanceof 判断 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/TAbstractFile) |
| `DataAdapter` | 底层文件系统接口（含隐藏目录、normalizedPath 参数） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/DataAdapter) |
| `FileSystemAdapter` | 桌面端 adapter：getBasePath() 拿 vault 绝对路径 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/FileSystemAdapter) |
| `CapacitorAdapter` | 移动端 adapter（无 getBasePath） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/CapacitorAdapter) |
| `MetadataCache` | 解析后的元数据索引（links/frontmatter/tags），带 changed/resolved 事件 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/MetadataCache) |
| `CachedMetadata` | 单个文件的解析结果：frontmatter/headings/links/sections/blocks… | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/CachedMetadata) |
| `FileManager` | 面向 UI 的文件操作：processFrontMatter/renameFile/trashFile | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/FileManager) |
| `Workspace` | 工作区树：leaf 获取 / 事件 / 布局 / onLayoutReady | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Workspace) |
| `WorkspaceLeaf` | 承载视图的叶子：setViewState/getViewState/openFile/detach | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/WorkspaceLeaf) |
| `View` | 视图基类：getViewType/getDisplayText/getIcon/onOpen/onClose | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/View) |
| `ItemView` | 自定义面板基类，提供 contentEl | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/ItemView) |
| `TextFileView` | 读写文本文件的自定义视图基类（getViewData/setViewData/onLoadFile） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/TextFileView) |
| `MarkdownView` | 当前 Markdown 视图：editor / file | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/MarkdownView) |
| `Editor` | 编辑器抽象：getSelection/replaceSelection/transaction/processLines | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Editor) |
| `Setting` | 设置行构造器：setName/setDesc/addToggle/addButton… | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Setting) |
| `PluginSettingTab` | 设置页基类：display()（legacy）/ getSettingDefinitions()（1.13+） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/PluginSettingTab) |
| `Modal` | 模态框基类：open/close/onOpen/onClose/titleEl/contentEl | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Modal) |
| `Notice` | 右上角提示条 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Notice) |
| `Menu` | 右键菜单：addItem/showAtMouseEvent/showAtPosition | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Menu) |
| `MarkdownRenderer` | 把 Markdown 字符串渲染进 DOM（必须传 Component） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/MarkdownRenderer) |
| `requestUrl` | 无 CORS 限制的 HTTP 请求函数 | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/requestUrl) |
| `Platform` | 平台判定常量（isDesktop/isMobileApp/isMacOS…） | [链接](https://docs.obsidian.md/Reference/TypeScript%20API/Platform) |

**另见**：[Command](https://docs.obsidian.md/Reference/TypeScript%20API/Command) · [Scope](https://docs.obsidian.md/Reference/TypeScript%20API/Scope) · [SecretStorage](https://docs.obsidian.md/Reference/TypeScript%20API/SecretStorage) · [SettingGroup](https://docs.obsidian.md/Reference/TypeScript%20API/SettingGroup) · [SuggestModal](https://docs.obsidian.md/Reference/TypeScript%20API/SuggestModal) · [normalizePath](https://docs.obsidian.md/Reference/TypeScript%20API/normalizePath) · [类型索引 index](https://docs.obsidian.md/Reference/TypeScript%20API/index) · [CSS 变量总表](https://docs.obsidian.md/Reference/CSS%20variables/CSS%20variables)

## 已知缺口

- 开发者文档**没有** CORS / iframe 嵌入 / CSP 的专门页面；§6 里 requestUrl 无 CORS 限制是文档原文，iframe 与 X-Frame-Options 相关结论属工程经验（已标注「非文档结论」）。
- Plugin.onunload 没有独立 API 页（在 Component/onunload），View.contentEl 也没有独立页（在 ItemView/contentEl），本文按实际存在的页面链接。
- Workspace/on('...')、Vault/on('...') 这类事件页路径含引号和括号，直接写进 Markdown 链接会被括号截断，本文统一链到类页面、事件名写在正文里。
- 设置页文档已改为「声明式 getSettingDefinitions()（1.13.0+）」为主、display() 标 legacy，两者混在同一页，没有独立的声明式参考页；本项目 minAppVersion: 1.4.0，实现时应继续用 display()。
- Modal 参考页已是 setTitle()/setContent()/setCloseCallback()（1.10.0+）版本，而界面指南的部分示例仍在构造函数里建 DOM，两种写法都能跑，按目标版本选。
- 未覆盖：Bases（1.10+）、CLI handler、CodeMirror 6 编辑器扩展细节、Obsidian Publish 主题，本插件的场景用不到。
