---
status: done
created: 2026-10-27
approved: 2026-10-27     # 用户选定路径 A + 内边距对齐 12px + 允许按需微调气泡底色
scope: styles.css
issue: 原生聊天面板像白底卡片贴在右栏上；希望去掉外圈间隙与白底，和整个右栏融为一体
---

# 0019 原生聊天面板融入右栏（去掉白底卡片）

## 1. 背景与问题

- **现象**：右侧栏里的原生聊天是一块白底面板，四周露出侧栏背景：左右和顶部各约 12px，底部约 32px；看起来像“贴在侧栏上的卡片”，而不是右栏本身。
- **复现**：打开原生聊天面板（默认右栏），任意主题下都能看到面板与侧栏交界处的一圈背景。
- **实测根因**（CDP 读取当前窗口的计算样式）：
  - 承载聊天的是 Obsidian 的 `.view-content`（同时被加上 `.dsh-native-view`），其默认内边距为 `padding: 12px 12px 32px`；
  - `.dsh-native-app` 画了 `background: var(--background-primary)`（当前主题 `#ffffff`），于是内边距区域露出侧栏背景，白底区域形成“卡片”；
  - 对照右侧栏的「属性」视图：它同样有 12px 内边距，但自身背景透明，内容直接坐在侧栏背景上，所以没有卡片感。
- **选择器细节**：只写 `.dsh-native-view { padding: 0 }` 不生效（Obsidian 的 `.view-content` 规则更具体）；实测 `.workspace-leaf-content .view-content.dsh-native-view` 可以覆盖。
- 本需求是「边用边改」流程下的第一个 UI 需求，登记为 [R-2](../roadmap.md#需求待办)。

## 2. 目标与非目标

- 目标：
  1. 聊天区域不再呈白色卡片，四周不再出现“背景框”；
  2. 聊天表面与右栏使用同一背景（含半透明 / vibrancy 主题），观感接近「属性」视图；
  3. 只改视觉层，不改 DOM 结构、交互、数据桥。
- 非目标：
  - 不重做聊天 UI，不动消息排版、工具卡信息密度、输入卡片的设计语言（0013 / 0014 / 0016 的成果保留）；
  - 不替换 Obsidian 的侧栏 / 标签页结构；
  - 不做“原生面板也能放进主编辑区”之类的新布局能力。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | **全出血 + 透明底**：`.workspace-leaf-content .view-content.dsh-native-view { padding: 0 0 32px; overflow: hidden; }` + `.dsh-native-app { background: transparent; }`；header / composer 与时间线文字边界对齐（最终 27px） | [styles.css](../../styles.css) 约 6–10 行 | 聊天完全贴住右栏边缘、露出侧栏的半透明背景；气泡 / 工具卡 / 输入卡在新底色上的对比度可能变化，需要在真机看 light / dark | **推荐**：最接近“完全融入整个右栏” |
| B | **只透明化**：`.dsh-native-app { background: transparent; }`，保留 `.view-content` 的 12px 内边距 | `styles.css` 1 行 | 卡片感消失（留白与侧栏同色），但 header 下边框、输入区仍从 12px 处开始，不是真正的“填满” | 最保守、风险最低 |
| C | **全出血 + 保留白底**：只覆盖 `.view-content` 的 padding 为 0，`.dsh-native-app` 仍是 `--background-primary` | `styles.css` 1–2 行 | 聊天变成一整列白色，确实没有卡片了；但与侧栏 / 属性面板的底色仍不同，可能只是从“卡片”变成“白色侧栏” | 最小改动，但观感不如 A 融入 |

### 推荐 A 的理由

- 用户目标是“面板完全融入整个右栏，类似属性面板”，A 同时解决**外圈间隙**和**白底差异**；
- 改动只在 CSS，不动 React / 数据桥，回滚成本低；
- 与 Obsidian 侧栏的原生表现一致：背景透明、内容自己控制内边距（时间线已有 12px，输入区已有 8px）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [styles.css](../../styles.css) | 新增/覆盖 `.workspace-leaf-content .view-content.dsh-native-view`：`padding: 0; overflow: hidden`；`.dsh-native-app` 背景改 `transparent`；按选路结果决定是否微调 `.dsh-native-header` / `.dsh-native-composer` 的左右内边距与气泡底色 |
| 其他文件 | 不改（无 TS / 构建 / 版本变化） |

## 5. 行为变化

- 纯视觉：聊天表面从“白底卡片 + 12px 外圈”变为“右栏的一部分”；
- 无 DOM 变化，无命令 / 快捷键 / 数据行为变化；
- 滚动仍由时间线内部负责，`.view-content` 不再承担滚动。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 透明底在部分主题（尤其深色 / 非半透明）下与气泡、工具卡对比度不足 | 可读性下降 | 只回退 `.dsh-native-app` 的背景声明；或按第 8 节微调气泡底色 |
| `.view-content` 的 padding 覆盖依赖 Obsidian 的类名 | 升级后失效，卡片感回归 | 保留选择器注释；升级后回归一次，必要时补选择器 |
| 全出血后 header / 输入区贴边 | 观感偏挤 | 同步调整 header / composer 左右 padding（A 的可选项） |
| 弹窗 / popout 窗口下布局不同 | 局部错位 | 在 popout 里手动回归；只回退相关 padding 覆盖 |

回滚：本次只改 `styles.css`，`git checkout styles.css` 即可；无版本号 / 产物 / 数据迁移。

## 7. 验证

- [x] `npm run check` 通过（CSS 不参与构建，`main.js` 与源码仍一致）；
- [x] 重新加载插件后，CDP 读取 `.dsh-native-view` 的 `padding === "0px"`、`overflow === "hidden"`、`.dsh-native-app` 的 `background-color === "rgba(0, 0, 0, 0)"`；
- [x] header 计算样式 `padding: 4px 27px`、composer `padding: 6px 27px 10px`；时间线 `scrollbar-gutter: stable both-edges`，文字左右边界均为 27px；
- [x] composer 底部 `909px` < 状态栏顶部 `910px`，底部按钮不再被状态栏遮挡；
- [x] light 主题 CDP 截图：聊天区贴住右栏四边，无白边 / 无内圈边框；
- [ ] dark / 半透明主题、窄侧栏、popout 窗口待真机顺手确认（CSS 变量透明，预期一致）；
- [x] 打开既有会话、滚动、输入区布局无异常（纯 CSS 改动，未重跑发送 / 流式链路）。

## 8. 需要你拍板

- [x] **选哪条实现路径**：A（全出血 + 透明）。
- [x] header 与输入区的左右内边距统一到 12px（与时间线对齐）。
- [x] 若透明底让用户气泡 / 工具卡对比度不足，允许只微调这些底色。

## 8.1 变更记录

- 2026-10-27：用户确认路径 **A**；补充两项决定——header / composer 左右内边距与内容对齐；允许在必要时微调气泡 / 工具卡底色。实施范围不变（仍只改 `styles.css`）。
- 2026-10-27（首版后按用户反馈修正）：
  1. 底部状态栏会盖住输入区按钮 → `.view-content` 底部补回 32px（Obsidian 原本的内边距）给固定状态栏让位；
  2. 文字左边界太贴侧栏（左侧 12px、右侧含滚动条 27px）→ 时间线加 `scrollbar-gutter: stable both-edges`，header / composer 同步到 27px，左右边界一致。

## 9. 实施记录

- **2026-10-27 实施（路径 A）**，只改 [styles.css](../../styles.css)：
  - 新增 `.workspace-leaf-content .view-content.dsh-native-view { padding: 0 0 32px; overflow: hidden; }`，覆盖 Obsidian `.view-content` 的左右 12px 内边距，同时保留底部 32px 给固定状态栏让位；
  - `.dsh-native-app` 背景由 `var(--background-primary)` 改为 `transparent`，让右栏（含 vibrancy）背景直接透上来；
  - `.dsh-native-timeline` 加 `scrollbar-gutter: stable both-edges`（左右各 12px padding + 15px 滚动条槽 = 27px）；
  - `.dsh-native-header` 内边距 `4px 6px` → `4px 27px`；`.dsh-native-composer` `6px 8px 10px` → `6px 27px 10px`，与时间线文字边界对齐。
- **验证**：`npm run check` 通过；重载插件后 CDP 计算样式为 `padding: 0px 0px 32px` / `overflow: hidden` / app 背景 `rgba(0,0,0,0)`；时间线文字左右边界均为 27px；composer 底部 909px、状态栏顶部 910px；打开「简短测试确认」会话截图确认四边贴齐、无白色卡片、按钮不被遮挡；状态栏 `DSH: 运行中`。
- **与提案的偏差**：无。未额外改气泡底色——用户气泡仍是 `--background-secondary` + 边框，与改动前「secondary on primary」的对比强度基本一致；若真机在半透明主题下觉得发平，再按第 8 节授权微调。
- **遗留人工确认**：dark / 半透明主题与 popout 窗口的观感（纯 CSS 变量，预期一致）。
