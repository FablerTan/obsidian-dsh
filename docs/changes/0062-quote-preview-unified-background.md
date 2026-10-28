---
status: done
created: 2026-10-28
approved: 2026-10-28
scope: styles.css
issue: 引用预览条浮着一层更亮的底（预览条 --background-secondary + 两个按钮的 Obsidian 默认底色），与下面的输入卡不协调，双引号图标也几乎贴着亮色底边
---

# 0062 引用预览条统一底色：去掉按钮默认底 + 图标留边

## 1. 背景与问题

右栏输入卡上方的引用预览条（0058 / 0060）实际渲染出三层颜色，看着不协调：

| 层 | 实际颜色（深色主题） | 来源 |
|---|---|---|
| 预览条 | --background-secondary #282828 | .dsh-native-quote-preview（0058 写了 secondary） |
| 条内两块「亮底」 | --interactive-normal #333333 | Obsidian 的 button:not(.clickable-icon) 基础样式（0,1,1）压过了组件里 background: transparent 的单类选择器（0,1,0） |
| 输入卡 | --background-primary #1C1C1C | .dsh-native-input-shell |

两个 button（主区域 + ×）因此各带一块 8px 圆角的亮底：主区域的亮底从图标一直铺到摘录，图标因为是第一个子元素、padding: 0，双引号左侧直接贴着亮底边缘（横向 0 间距）。同类问题 0020 已经踩过一次（过程行被按钮基础样式盖掉），当时的结论是「用更高优先级的选择器覆盖」。

## 2. 目标与非目标

- 目标：预览条整条只有一个底色，且与下面的输入卡同色（--background-primary）；条内不再出现第二层亮底；图标四周留出间距。
- 非目标：不改预览条的圆角 / 边框（与输入卡本来就不一样，不在这次要求里）；不改 0058 的引用卡（消息气泡里的那张卡本来就是 div，不受按钮样式影响）；不改任何交互 / 文案。

## 3. 实现路径调研

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| A（采用） | styles.css 里加一组 .dsh-native-app .dsh-native-quote-preview-main / -close（含 :hover / :active / :focus-visible）把 background / box-shadow / border 压成透明；预览条底色改 var(--background-primary)；横向 padding 8px → 10px 给图标留边 | styles.css 约 20 行（纯样式） | 低：只是提高选择器优先级，组件结构不动；需确认 hover / focus 态不反弹 | 采用（与 0020 同一套做法） |
| B | 直接给两处按钮写 background: transparent !important | styles.css 2 行 | 极低改动量，但 !important 会盖掉以后所有主题 / 子状态想加的样式，后续维护更差；本项目还没用过 !important | 不采用 |
| C | 把两个 button 换成 div role=button（像 .dsh-native-quote-card 一样） | quote-preview.tsx + 样式 | 要自己补键盘行为 / 焦点环，还要回归点击与 × 的互不干扰；为一个底色改结构不划算 | 不采用 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| styles.css | ① .dsh-native-quote-preview 背景 --background-secondary → --background-primary，横向 padding 8px → 10px；② 新增 .dsh-native-app .dsh-native-quote-preview-main / -close（默认 + hover / active / focus-visible）重置按钮基础底色，注释写清 Obsidian button:not(.clickable-icon) 的优先级问题 |

## 5. 行为变化

- 预览条与输入卡同色（#1C1C1C），条内不再有 #333 的亮色圆角块；× 也只剩图标本身。
- 双引号图标离预览条左边缘从 9px（1px 边框 + 8px padding）变为 11px（1px + 10px），且不再被亮底包住。
- 交互、文案、点击区域（主区域整条可点 / × 只取消本次引用）都不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 某些主题给 button:not(.clickable-icon) 用了 !important | 预览条里仍可能出现按钮底色 | 属于主题侧极端情况；需要时再按主题变量补一条覆盖 |
| 垂直 padding 未动（4px） | 亮底去掉后条高不变（按钮仍是 30px 高） | 无需回滚 |

回滚：还原 styles.css 这两处即可（无构建产物影响）。

## 7. 验证

- npm run check 通过（版本 / 清单 / 类型 / 产物一致）。
- 在运行中的 Obsidian（DigitalGarden，深色主题）里重载插件，选中笔记第 63 行文字触发预览条，用 CDP 读计算样式：
  - .dsh-native-quote-preview 背景 rgb(28, 28, 28)（= --background-primary），与 .dsh-native-input-shell 一致；
  - .dsh-native-quote-preview-main / -close 背景 rgba(0, 0, 0, 0)（= 没有第二层底色）；
  - 预览条 padding 4px 10px。
- 截图对比（改前 / 改后）：改前条内两块 #333 亮底、图标贴边；改后整条一个色、图标留边。

## 8. 需要你拍板

- [x] 用户当轮已明确指定：去掉亮一点的底色、改统一颜色、图标离底边远一点 → 视为批准，直接执行并记录。

## 9. 实施记录

- 2026-10-28：styles.css 已按路径 A 落地（背景统一为 --background-primary、按钮底色四种状态全压透明、横向 padding 10px）。重置规则声明在本节单类规则之后，避免同优先级时被后面的 .dsh-native-quote-preview-main 规则把背景打回默认。
- 验证：npm run check 通过；CDP 计算值与上面一致；深色主题下截图对比确认亮底消失、预览条与输入卡同色。
