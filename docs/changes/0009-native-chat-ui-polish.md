---
status: done
created: 2026-10-26
approved: 2026-10-26
done: 2026-10-26
scope: src/view/native, src/shared/host.ts, styles.css, docs
issue: 原生聊天栏 5 项体验问题：会话未按 vault 过滤 / 浮层固定左上角 / 权限图标无区分 / 模型菜单扁平 / 模型名过长
---

# 0009 原生聊天栏打磨（会话过滤 / 浮层锚定 / 权限图标 / 模型二级菜单 / DeepSeek 标签）

> 用户 2026-10-26 确认按方案 A 执行，并回答第 8 节问题（见文末「已确认的决定」）。本文件已按确认结果更新。

## 1. 背景与问题

聊天栏（`src/view/native/`）可用，但有 5 个集中影响日常使用的问题：

1. **会话混入其他项目**
   `native-chat-root.tsx` 的 `boot()` / `refreshSessions()` 直接渲染 `bridge.listSessions()` 的全量结果。
   dsh profile（`obsidian`）是全局的，桥返回的是 profile 下**所有 cwd** 的会话；桌面端或其他 vault 的会话也会出现在
   会话选择器与「最近会话」里，和「这个 vault 的聊天」语义不符。
   桥的返回已含 `cwd`（`packages/dsh-obsidian-bridge/lib/client.js` 的 `listSessions()`），插件侧即可过滤。

2. **模型 / 权限浮层出现在固定位置**
   `styles.css`：

   ```css
   .dsh-native-menu.is-bottom { left: 8px; bottom: 132px; }
   .dsh-native-menu.is-top    { top: 44px; right: 8px; }
   ```

   `MenuShell`（`ui/menus.tsx`）不接收锚点，浮层位置与点击的按钮无关：点模型 / 权限 chip 总是弹在面板左下方，
   视线要跳。`SessionMenu`（更多）同理。

3. **权限图标不区分权限**
   `composer.tsx` 的权限 chip 固定用 `shield` 图标，旁边是权限名称文本；`read-only` / `workspace-write` /
   `danger-full-access` 看起来一样，必须读文字才知道当前权限。

4. **模型菜单是一层平铺**
   `ModelGroupRows` 把每个模型和它的思考层级（efforts）全部铺在一列里，层级越多菜单越长；
   无法「先选模型、再选层级」两级操作。

5. **模型名称过长、识别度低**
   chip 显示 `model.name + ' · ' + effort.name`，实际是
   「DeepSeek V4.1 Flash (latest) · High」这类长串，窄栏里被省略号截断；
   用户希望 DeepSeek 一眼认出来（鲸鱼 logo + 思考层级）。

## 2. 目标与非目标

### 目标

1. 会话选择器、「最近会话」、以及面板内会话列表**只显示 cwd 在 vault 内（含子目录）的会话**；
2. 模型 / 权限 / 更多浮层**贴着触发按钮出现**，面板边缘自动内收，空间不足时翻转方向；
3. 权限 chip **只保留图标**，四种权限（read-only / workspace-write / danger-full-access / custom）图标可区分；
4. 模型菜单改为**两级**：一级模型列表，悬停模型时右侧弹出思考层级菜单；
5. DeepSeek 模型 chip 显示**鲸鱼 logo + 思考层级**（完整名称放 tooltip），其他模型保持「名称 · 层级」，并留出品牌扩展接口。

### 非目标

- 不改 `packages/dsh-obsidian-bridge`：`cwd`、`models`（含 `efforts` / `defaultEffort`）、`permissions` 数据已够用，
  不需要重装桥或重启服务；会话过滤放在插件侧；
- 不做品牌资源目录 / 打包图片，鲸鱼用内联 SVG（跟随主题色）；
- 不改发送、停止、审批 / 提问、重命名、当前笔记等既有逻辑；
- 不新增设置项（不提供「显示所有会话」开关；若以后需要另起提案）；
- 不做移动端适配（插件 `isDesktopOnly`）。

## 3. 方案

### 方案 A（推荐）

#### A1. 会话只显示当前 vault 的项目（含子目录）

- `src/shared/host.ts` 新增纯函数：

  ```ts
  export function projectPathWithin(cwd: string | null, vault: string): boolean;
  ```

  规则：null / 空串 → false；两端先 `path.resolve`，再用 `fs.realpathSync.native` 做一次 try/catch 兜底
  （符号链接 vault）；比较时按平台大小写规则（win32 折叠），`cwd === vault` 或 `cwd` 以 `vault + 分隔符` 开头都算命中。
- `native-chat-root.tsx`：
  - `const vault = vaultPath(app)`（已有 `createSession` 在用同一路径）；
  - `refreshSessions()` 内 `list.sessions.filter((s) => projectPathWithin(s.cwd, vault))`；
  - `boot()` 复用 `refreshSessions()`（含其 10 次空列表重试），保证启动、刷新、新建会话后口径一致；
  - 选择器、「最近会话」、标题回退都读这份过滤后的 `sessions`，无需各自再过滤。
- 新建会话仍传 `vaultPath(app)`，所以新建的会话天然在列表里。

#### A2. 浮层锚定到触发按钮

- `MenuShell` 增加 `anchor: DOMRect` 与 `placement: 'above' | 'below'`，改为 `position: fixed`：
  - `above`：`bottom = innerHeight - anchor.top + 6px`（composer 在底部，向上展开，不需要先量高度）；
  - `below`：`top = anchor.bottom + 4px`；
  - 水平：先按 `left = anchor.left`，`useLayoutEffect` 量到自身宽度后 clamp 到 `[8, innerWidth - width - 8]`；
  - 垂直溢出时交换 `above` / `below`。
- `composer.tsx` 的 chip `onClick={(event) => onMenu('model', event.currentTarget.getBoundingClientRect())}`；
  `native-chat-root.tsx` 把 `menu` state 扩为 `{ kind: 'model' | 'permission' | 'more'; anchor: DOMRect } | null`，
  鼠标点击时记录（键盘触发时 `event.currentTarget` 同样可用）。
- 「更多」（header 右上）用 `below`，锚到 `more-horizontal` 按钮。
- 删除 `.dsh-native-menu.is-bottom` / `.is-top` 的写死坐标（类名保留给尺寸 / 动画，不再负责定位）。
- backdrop 仍是 `position: fixed; inset: 0`，层级不变。

#### A3. 权限图标

- 新增 `src/view/native/ui/permission-icon.tsx`：`permissionVisual(value)` → `{ icon, tone }`：

  | 权限值 | 图标（lucide 名） | 色调 | 含义 |
  |---|---|---|---|
  | `read-only` | `eye` | `var(--text-muted)` | 只看不改 |
  | `workspace-write` | `square-pen` | `var(--text-normal)` | 仅工作区可写 |
  | `danger-full-access` | `shield-alert` | `var(--text-error)` | 无审批完全访问 |
  | `custom` | `sliders-horizontal` | `var(--text-muted)` | 未匹配预设 |
  | 其他 / 未知 | `shield` | `var(--text-muted)` | 兜底 |

- `composer.tsx`：权限 chip 只渲染图标（16px），去掉名称文本与 `chevron-down`（用户确认：不保留小箭头）；
  `title` 与 `aria-label` 填 `名称 — 描述`（例如「Workspace Write — Write inside the workspace…」），
  悬停可读、无障碍不丢信息。
- `PermissionMenu` 每行左侧加同款图标（名称与勾选保留），用于对照图标含义。

#### A4. 模型两级菜单

- 一级（`ModelMenu`）：
  - 只列模型行：`模型名` + 右侧 `chevron-right`（仅当该模型有 `reasoning.efforts`；这是二级菜单指示符，
    用户说的「去掉小箭头」指 composer 里的 chip 箭头，不包含它）；
  - 当前模型行：左侧勾选 + 右侧小字显示当前层级（如 `High`）；
  - provider 分组标题仅在有 >1 个 group 时显示（保持现有规则）；
  - 「刷新模型列表」「模型配置说明」保持在底部。
- 二级（层级菜单）：
  - 悬停（`onMouseEnter`）/ 键盘聚焦有层级的模型 → 打开；`onMouseLeave` 延迟 120ms 关闭，
    鼠标穿过间隙进入二级时不闪烁；
  - 定位 `fixed`：默认 `left = 一级右边缘 + 4px`、`top = 行 top`；右侧越界翻到一级左侧；垂直 clamp；
  - 行内容：层级名 + 描述（`title`）+ 当前层级勾选；点击 → `selectModel({ provider, model, reasoningEffort })` 并关闭全部浮层；
  - 点击有层级的模型行只展开二级（不改当前模型）；点击无层级模型直接选中；`Escape` / backdrop 关闭。
- 一级与二级包在同一个 wrapper 里（`pointer-events: none` 的定位容器 + 两个 `pointer-events: auto` 面板），
  避免穿层时误关闭。

#### A5. 模型 chip 标签

- 新增 `src/view/native/ui/model-brand.tsx`：
  - `WhaleMark`（内联 SVG，`fill="currentColor"`，16px，无外部资源）；
  - `ModelBrand` 注册表（`match` / `mark` / `render`）：DeepSeek 一条，其他模型落到 `DEFAULT_BRAND`；
    **后续接新品牌只需往注册表加一条，不改 composer**。
- `composer.tsx` 的 `modelLabel` 换成 `modelChip(models)`：

  ```ts
  { mark: 'whale' | null; text: string; title: string }
  ```

  - DeepSeek 判定：`group.id` / `group.name` / `model.id` / `model.name` 任一含 `deepseek`（忽略大小写）；
  - DeepSeek：`mark: 'whale'`，`text` = 生效思考层级名（`current.reasoningEffort` 命中的 `effort.name`，
    否则 `reasoning.defaultEffort` 命中的名称；都没有则**只显示鲸鱼**，`text` 为空）；
  - 其他模型：`mark: null`，`text` 保持 `名称 · 层级`（无层级则只有名称），走 `DEFAULT_BRAND`；
  - `title` 始终是完整的 `名称 · 层级`（含 provider），便于悬停确认；
  - chip 的 `max-width` 从 46% 放宽（权限 chip 变成图标后空出空间），图标 + 文本单行省略，不撑破栏宽；
  - 模型 chip 与权限 chip 都不再显示 `chevron-down`（用户确认）。

#### A6. 版本与文档

- 行为变化 → 版本升到 **0.4.1**（manifest / package.json / versions.json 三处一致，追加 `"0.4.1": "1.4.0"`）。
- `docs/changes/README.md` 索引补 0009；实施后更新本提案「实施记录」、`docs/roadmap.md`
  （M4 补一行 UI 打磨 + 时间戳）与 `docs/development.md` 的改动地图（如新增文件）。

### 方案 B（备选，不采用）

- **浮层定位用 Obsidian `Menu.showAtPosition`**：`menus.tsx` 顶部已记录，右栏视图里菜单不会挂到 document
  （`isConnected=false`），无法保证可见，故不用。
- **二级菜单纯 CSS `row:hover .submenu`**：实现简单，但窄栏右侧空间不足时无法翻转、键盘可达性差，
  与「贴着按钮 / 边缘内收」的目标冲突，故不用。
- **会话过滤放桥里**：需要重装 `packages/dsh-obsidian-bridge` 并重启服务，且会影响桌面端共用同一 profile 的会话语义，
  成本高、收益低，故不在本次。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/shared/host.ts` | 新增 `projectPathEquals()`（normalize / realpath 兜底） |
| `src/view/native/ui/native-chat-root.tsx` | 过滤本 vault 会话；`menu` state 带 anchor；透传给三个菜单 |
| `src/view/native/ui/menus.tsx` | `MenuShell` 改为 absolute（相对 `.dsh-native-app`）+ anchor 定位；`ModelMenu` 两级菜单；`PermissionMenu` 图标；`SessionMenu` 锚定 |
| `src/view/native/ui/composer.tsx` | 模型 chip 品牌标签；权限 chip 仅图标 + tooltip；点击时上报按钮 rect |
| `src/view/native/ui/model-brand.tsx`（新） | `WhaleMark` 内联 SVG + `ModelBrand` 注册表 |
| `src/view/native/ui/permission-icon.tsx`（新） | 权限 → 图标 / 色调映射，chip 与菜单共用 |
| `styles.css` | 浮层 fixed 定位与二级菜单、权限图标色、chip 尺寸 / 省略、删除写死坐标 |
| `manifest.json` / `package.json` / `versions.json` | 版本 0.4.1 |
| `docs/changes/README.md` / `docs/roadmap.md` / `docs/development.md` | 索引、状态、改动地图 |

## 5. 行为变化

- 会话选择器与「最近会话」**不再显示其他项目 / 其他 vault 的会话**（vault 子目录里的会话仍显示）；
  若当前打开的会话 cwd 不在 vault 内（历史遗留），下次刷新后它会从列表消失（会话本身未被删除）。
- 模型 / 权限 / 更多浮层出现在触发按钮旁，面板变窄或靠近边缘时自动内收 / 翻转。
- 权限 chip：只剩图标，颜色与形状可区分权限；悬停显示名称与描述；不再有下拉箭头。
- 模型菜单：先选模型、再选层级；无层级的模型仍一键选中。
- DeepSeek chip：🐳（内联 SVG）+ `High` 这类层级名；未设层级时只显示鲸鱼；
  完整「DeepSeek V4.1 Flash (latest) · High」在 tooltip 里。模型 chip 不再有下拉箭头。
- 发送 / 停止 / 审批 / 提问 / 重命名 / 当前笔记 / 新建会话：行为不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 路径比较误杀（符号链接 / 大小写 / 尾斜杠） | 本 vault 会话被过滤掉，面板看起来「没有会话」 | `projectPathEquals` 已做 normalize + realpath；若仍误判，临时改为 `startsWith(vault)`，或直接回退该 commit |
| fixed 浮层在 popout 窗口 / 缩放时偏移 | 浮层错位 | 定位基于 `getBoundingClientRect` + 视口 clamp；回归覆盖 popout；可回退到旧 `.is-bottom` 定位 |
| hover 二级菜单抖动 / 鼠标不可达 | 选层级困难 | 120ms 延迟 + 键盘聚焦；不可接受则改为「点击展开」 |
| DeepSeek 判定依赖名称 | 标签不走鲸鱼分支 | 只影响显示，不影响发送；可补 `provider` 白名单 |
| 版本号三处不一致 | `npm run check` 失败 | 按规则 2 同步三处 |

回滚：单 commit revert + `npm run build` 重新生成 `main.js` + 重载插件；桥未改动，**不需要重启 dsh 服务**。

## 7. 验证

自动化：

- `npm run build`（tsc + esbuild，必须无错误，`main.js` 重新生成）；
- `npm run check`（版本三处一致、无运行时依赖、类型、`main.js` 与源码一致、bridge 清单/语法）。

手动（Obsidian 重载插件后，按顺序）：

1. 会话过滤：在桌面端于**其他目录**创建一个会话 → 面板里看不到它；在本 vault 的**子目录**创建一个会话 → 能看到；
   本 vault 根目录会话正常显示、可打开；
2. 浮层位置：点模型 chip → 浮层底边在 chip 上方、左边与 chip 对齐；点权限 chip 同理；
   把右栏拖窄 → 浮层仍完整可见、不越界；点右上「更多」→ 浮层在按钮下方；
3. 权限图标：切换四种权限，chip 图标分别为 eye / square-pen / shield-alert（红）/ sliders-horizontal；
   chip 无文字，悬停 tooltip 有名称与描述；菜单里图标与名称一致；
4. 模型两级：悬停有层级的模型 → 右侧出现层级菜单并勾选当前层级；选择其他层级后 chip 更新、
   下一条消息按新层级发送；点击无层级的模型直接切换；
5. DeepSeek 标签：chip 显示鲸鱼 + 当前层级（如 High）；清掉层级后只剩鲸鱼；chip 无下拉箭头、不换行、
   不撑破栏宽；tooltip 是完整名称；非 DeepSeek 模型仍显示「名称 · 层级」；
6. 回归：新建会话、发送 / 停止、审批 / 提问卡片、重命名、当前笔记引用、浅色 / 深色主题下浮层对比度。

验收标准：1–5 全部符合 + 回归 6 无变化 + `npm run build` / `npm run check` 通过。

## 8. 已确认的决定（用户 2026-10-26）

- [x] **会话范围**：包含 vault 子目录（`cwd` 在 vault 内即显示），用 `projectPathWithin()` 判定。
- [x] **有层级的模型行**：点击只展开二级菜单，点层级才生效。
- [x] **非 DeepSeek 模型**：保留「名称 · 层级」；用 `ModelBrand` 注册表留扩展接口，后续加品牌不改 composer。
- [x] **DeepSeek 未设层级**：只显示鲸鱼（不带文字）。
- [x] **权限图标映射**：采用 eye / square-pen / shield-alert / sliders-horizontal；chip 去掉 `chevron-down`，
      模型 chip 的下拉箭头也一并去掉。

## 9. 实施记录（2026-10-26）

### 实际改动

- **会话过滤**：`src/shared/host.ts` 新增 `projectPathWithin(cwd, vault)`（resolve + realpath 兜底 + 平台大小写）；
  `native-chat-root.tsx` 的 `boot()` / `refreshSessions()` 统一过滤，选择器 / 最近会话 / 标题回退共用这份列表。
- **浮层锚定**：`menus.tsx` 的 `MenuShell` 改为接收按钮 `DOMRect`，用 absolute 定位在 `.dsh-native-app`
  （新增 `position: relative`）内，贴按钮展开并 clamp 到面板 8px 内边距；模型 / 权限向上，更多向下；
  空间不足自动换边、限高滚动。**偏差**：最初用 fixed + viewport 坐标，实测右栏包含块把浮层推到窗口外
  （left 2451 / innerWidth 1661），改为相对宿主容器计算。
- **权限图标**：新增 `permission-icon.tsx`（eye / square-pen / shield-alert / sliders-horizontal，未知回退 shield）；
  chip 只留图标、无文字无箭头，tooltip 与 aria-label 带名称 + 描述；权限菜单行用同一套图标。
- **模型两级**：`ModelMenu` 一级只列模型（provider 分组、当前项勾选 + 层级小字 + chevron-right）；
  悬停 / 聚焦 / 点击有层级的行打开二级浮层（与一级同级渲染，右侧放不下翻左侧，仍不行贴面板右缘）；
  点层级才 `selectModel`，无层级模型点击直接切换；二级菜单 132–220px。
- **模型标签**：新增 `model-brand.tsx`：`WhaleMark` 使用 **DeepSeek 官方鲸鱼 logo**（取自
  `deepseek-ai/DeepSeek-V2` 的 `figures/logo.svg`，只保留鲸鱼路径，官方品牌色 `#4D6BFE`，内联 SVG 不引外部资源）；
  `ModelBrand` 注册表（`match` / `mark` / `render`）+ `modelChip()`。DeepSeek 显示鲸鱼 + 生效层级
  （`current.reasoningEffort` → `defaultEffort`），无层级只显示鲸鱼；其他模型走 `DEFAULT_BRAND`（名称 · 层级），
  完整名称在 tooltip；后续接新品牌只改注册表。
- **chip 布局**：`.dsh-native-composer-left` 改 `flex: 1 1 auto; overflow: hidden`、chip `max-width: 100%`，
  修掉收缩容器导致 `High` 被截成 `Hi...` 的问题。
- 版本 **0.4.1**（manifest / package.json / versions.json 三处一致，追加 `"0.4.1": "1.4.0"`）。

### 验证

- `npm run build`：通过（`main.js` 约 209KB）。
- `npm run check`：通过（版本三处一致、无运行时依赖、tsc、main.js 与源码一致、bridge 清单/语法）。
- 真实 Obsidian CDP 回归（1.14.4 / 右栏 424px / vault `<dev-vault>`）：
  1. 会话过滤：桥返回 496 条、vault 内 38 条（含 23 条 blank）；选择器渲染 15 行 = 38 − 23，其他项目会话不出现；
  2. 模型 chip：官方鲸鱼 + `High`，宽约 60px，title 为 `DeepSeek V4.1 Flash (latest) · High`，无箭头；
  3. 模型菜单：`bottom = chip.top − 6`、`left = chip.left`；一级 5 行，选中行显示 ✓ 与 High；
     点当前行后二级出现在行右侧（`left = row.right + 4`）并勾选 High；
  4. 权限菜单：`bottom = chip.top − 6`；eye / square-pen（✓）/ shield-alert 与名称一致；chip 仅图标；
  5. 更多菜单：按钮下方（`top = button.bottom + 6`，右对齐面板内边距）；
  6. 浮层均 clamp 在 `.dsh-native-app` 内、不越界。
- **未覆盖**：真 IME、popout 窗口浮层、实际切换模型/权限后的发送（避免改动用户会话）、浅色主题截图。

### 补充（2026-10-26）：标签页 / ribbon 图标

- 新增 `src/shared/brand.ts`：`DEEPSEEK_WHALE_PATH` / `DEEPSEEK_WHALE_VIEWBOX` 与 `dshWhaleIconSvg()`
  （方形 viewBox 的单色 SVG，路径与模型 chip 共用）。
- `main.ts` 在 onload 用 `addIcon('dsh-whale', dshWhaleIconSvg())` 注册；ribbon「打开 DSH 聊天」改用 `dsh-whale`；
  `DshNativeChatView.getIcon()` 返回 `dsh-whale`。
- 单色版跟随主题（`currentColor`）：深色主题显示浅灰、浅色主题即黑色；实测标签页与 ribbon 均正常渲染（16px）。
- 显示名从「DSH 聊天」改为 **DeepSeek Harness**：标签页（`getDisplayText()`）、ribbon「打开 DeepSeek Harness」、
  命令「打开 DeepSeek Harness」（命令 id `open-dsh-view` 不变）、打开失败 Notice 同步；实测标签页 / ribbon / 命令名均已生效。
- `npm run build` / `npm run check` 通过。

### 与提案的偏差

- 鲸鱼图标改用 DeepSeek 官方 logo（用户中途要求），品牌色 `#4D6BFE` 内联在 SVG（品牌资产，非 UI 主题色）；
- 新增文件是 `model-brand.tsx`（鲸鱼 + 品牌注册表），不是原计划的 `brand-icon.tsx`；
- 浮层用 absolute 相对 `.dsh-native-app`，不是 fixed；
- 二级菜单与一级同级渲染（不是主面板子节点），窄栏下贴面板右缘；
- 会话选择器仍隐藏 blank 会话（既有行为），所以 15 行 < vault 内 38 条。
