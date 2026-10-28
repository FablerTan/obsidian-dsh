---
status: done              # draft | approved | done | rejected
created: 2026-10-28
approved: 2026-10-28      # 用户当轮指出「方向反了 + 一卡一卡」，要求与 dsh 同款，按规则 12 例外直接修
scope: src/view/native/ui, styles.css
issue: 运行提示的文字微光方向反了（空白往右移，dsh 是高光往右移），且循环首尾有跳变，看起来一卡一卡
---

# 0049 运行提示的文字微光改为 dsh 的遮罩扫光

> 对应路线图 [R-32](../roadmap.md#需求待办)。修 [0047](0047-dsh-run-status.md) 里 shimmer 的实现。

## 1. 背景与问题

0047 的文字微光用的是 background-clip: text + background-position 位移动画（130% → -30%，2.6s linear）。实机反馈两个问题：

1. **方向反了**：背景位移（130% → -30%）等于把渐变往左拉，视觉上是「暗色 / 空白带」从右往左扫；dsh 官方是**高光带从左往右**扫过；
2. **一卡一卡**：background-position 每轮首尾是跳变的（渐变尺寸 220%，位置 130% 与 -30% 不连续），而且逐帧重绘文字背景，掉帧明显。

从 dsh 桌面端 app.asar 里抽出 TextShimmer（@deepseek-ai/dsh-ui-primitives，被 dsh-client-ui-chat 的 RunningStatus 使用）的实现，按官方结构重写：

- DOM：正文一层（data-shimmer-text / 直接渲染文案）+ decoration 绝对定位层，层里再放一份同文案副本；
- 扫光：sweep 用 mask-image: linear-gradient(105deg, transparent 0%, #000 40% 60%, transparent 100%)，transform: translateX(-100%)；highlight（副本）反向 translateX(100%)，抵消父层位移，让文字不动、只有蒙版扫过；
- 节奏：两者都是 1.5s steps(48, end) 0.3s infinite，keyframes 0% → 66.6667% 从 -100% 到 +100%，之后停到 100%（保持 0.5s 再进入下一轮）；
- 颜色：正文 --dsw-alias-label-deep-diving，扫光层 --dsw-alias-label-deep-diving-shimmer（浅色 = rgb(52,94,186) / rgb(36,61,128)；深色 = rgb(125,154,222) / rgb(138,188,254)）。

## 2. 目标与非目标

- 目标：与 dsh 官方一致的「高光从左往右扫」观感，循环平滑（末尾停顿 + steps(48) 的节奏一致），不改变运行提示的文案、位置（0048）、字号与颜色。
- 非目标：不改 0048 的位置设置；不动鲸鱼尾动效（0047 的 CSS 摆动）；不引入 dsh 的 APNG 资源。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（采用）** | 按 dsh TextShimmer 的结构重写：正文 + 绝对定位的高光副本 + 105° 蒙版扫光（transform 动画、steps(48)） | src/view/native/ui/run-status.tsx 的文案节点 + styles.css 的 .dsh-native-run-text-* | 低；和 dsh 同结构、同 keyframes；transform / mask 走合成层，比背景位移平滑 | **采用** |
| B | 保留 background-clip: text，把方向改成从右往左，换 steps(48) 缓动、调整背景尺寸消除循环跳变 | 只改 CSS | 低；但扫光带经过时仍会整段文字重绘，且「高光」会跟 dsh 的遮罩观感不同 | 否 |
| C | 用 SVG / canvas 自绘扫光 | 新组件 + 资源 | 高；为一个提示行不值 | 否 |

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| src/view/native/ui/run-status.tsx | 文案节点换成 dsh TextShimmer 结构：run-text（inline-grid）+ 正文 content / glyph + decoration（aria-hidden）里再放一份 sweep > content highlight > glyph |
| styles.css | 删掉 background-clip: text 方案与 dsh-native-run-shimmer 背景位移动画；新增 .dsh-native-run-text* 结构样式、两项 keyframes（sweep / highlight）、prefers-reduced-motion 隐藏 decoration |
| 文档 | 本提案、R-32、changes 索引、development 改动地图、0047 的实施记录补一句「扫光实现以 0049 为准」 |
| 版本 | 0.6.6 → 0.6.7 |

## 5. 行为变化

- 运行提示的文字：正文保持基色常显；一条较窄的高光带从左往右扫过（1.5s 一次 + 0.5s 停顿），与 dsh 官方一致；不再有循环跳变。
- 屏幕阅读器 / 复制选择不受影响：高光副本是 aria-hidden + pointer-events: none + user-select: none。
- prefers-reduced-motion: reduce：不渲染高光层，只留基色文字。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 副本与正文若有 1px 级差异，扫光时字会「抖」 | 观感问题 | 两者共用同一 flex 布局与字体，实测对齐；不对可给 decoration 加 inset 微调 |
| 不支持 mask-image 的极旧客户端 | 高光层整块显示成纯色，盖住文字 | 只在桌面 Electron（Chromium）运行；必要时加 @supports not (mask-image) 隐藏装饰层 |
| steps(48) 的节奏被误认为卡顿 | dsh 本身就是这个节奏 | 需要更顺滑可改 linear，但会与 dsh 不一致 |

## 7. 验证

自动化：npm run build / npm run check。

手动（Obsidian CDP，运行中采样）：

1. DOM 出现 .dsh-native-run-text-decoration、.dsh-native-run-text-sweep、.dsh-native-run-text-highlight；
2. 计算样式：sweep 的 animation-name = dsh-native-run-shimmer-sweep、1.5s steps(48) 0.3s infinite、mask-image = linear-gradient(105deg, transparent 0%, #000 40%, #000 60%, transparent 100%)；
3. 位移方向：间隔 450ms 两次采样，sweep 的 translateX 由 -60.96px → +60.96px（从左往右）；
4. 颜色：正文 rgb(52, 94, 186)、扫光层 rgb(36, 61, 128)（浅色主题）；
5. 复制文字只得到一份文案（装饰层不参与选择）。

## 8. 需要你拍板

- [x] 实现路径：用户当轮已指出方向与卡顿问题、要求 dsh 同款，按规则 12 例外直接按 A 修。
- [ ] 可选：是否把 steps(48) 换成更顺滑的缓动（会偏离 dsh 官方节奏）。

## 9. 实施记录

**实施（2026-10-28，路径 A）**

- run-status.tsx：文案改为「深度求索中，用时 N秒 ···」的 dsh TextShimmer 结构（正文 + decoration 里的高光副本；装饰层 aria-hidden）。
- styles.css：新增 .dsh-native-run-text / -content / -glyph / -decoration / -sweep / -highlight；删掉旧的 background-clip 方案与背景位移 keyframes；prefers-reduced-motion 下隐藏装饰层。
- 版本 0.6.6 → 0.6.7（manifest / package / versions 三处）。

**验证**

- npm run build / npm run check：通过（版本三处一致 / main.js 与源码一致）。
- CDP（重载插件 → 新建会话 → 发送会走工具的消息）：
  - 找到 .dsh-native-run-text-decoration（aria-hidden）与 sweep / highlight 两层的运行中动画；
  - sweep 计算样式：dsh-native-run-shimmer-sweep 1.5s steps(48) delay 0.3s、mask 为 105° 三段渐变；
  - 450ms 间隔两次采样 transform：translateX(-60.96px) → translateX(+60.96px)（左 → 右）；
  - 颜色：正文 rgb(52, 94, 186)、扫光 rgb(36, 61, 128)；Stop 后整行消失。
