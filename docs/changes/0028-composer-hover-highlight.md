---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户选路径 A
scope: styles.css
issue: 输入框整卡的鼠标悬停高亮在浅色主题下不可见（hover 底色 token 与卡片底色同值）
---

# 0028 输入框悬停高亮在浅色主题下不可见

## 1. 背景与问题

用户反馈：「输入框的鼠标预选的高亮怎么没了」。

CDP 实测（Obsidian 1.14.5，系统浅色主题，默认主题无 cssTheme，面板处于
[0019](0019-native-panel-fullbleed.md) / [0026](0026-composer-wider.md) 之后的状态）：

- `@` / `/` 下拉菜单的鼠标行高亮**正常**：鼠标移到某行后该行拿到 `is-active`，计算背景 `oklch(0 0 none / 0.067)`（= `--background-modifier-hover`）；
- 输入框里鼠标拖选文字的选区也正常（`--text-selection` 有值）；
- **只有输入框整卡的悬停高亮不可见**：未聚焦时把鼠标移到输入卡片上，`.dsh-native-input-shell` 的计算背景仍是 `rgb(255, 255, 255)`，与悬停前完全相同。

根因（来自 Obsidian `app.css` 的变量链）：

| 层级 | 定义 |
|---|---|
| `body` | `--background-modifier-form-field-hover: var(--background-modifier-form-field)` |
| `body` | `--background-modifier-form-field: var(--color-base-00)` |
| `body` | `--background-primary: var(--color-base-00)`（卡片自己的底色） |
| `.theme-dark` | `--background-modifier-form-field: var(--color-base-25)`（比 primary 亮一档） |

所以 [0013](0013-native-chat-compact-ui.md) 选的 `--background-modifier-form-field-hover` **只在深色主题下有对比**（当时验证记录里的 `rgb(46,46,46)` 就是深色值）；浅色主题下它等于 `#ffffff`，与卡片的 `--background-primary` 完全相同 → 悬停高亮等于没写。

[styles.css](../../styles.css) 里只有 `.dsh-native-input-shell:hover:not(:focus-within)` 这一处用 `--background-modifier-form-field-hover`，其余 hover 全部用 `--background-modifier-hover`，所以只有输入卡片中招。

## 2. 目标与非目标

- 目标：浅色 / 深色主题下，鼠标悬停**未聚焦**的输入卡片时都能看到整卡高亮（与 0013 的「整块高亮」语义一致）；聚焦后仍只保留强调色边框、不加底色。
- 非目标：
  - 不改输入框尺寸 / 圆角 / 边框 / 阴影（[0026](0026-composer-wider.md) 的加宽保持）；
  - 不改 `@` / `/` 菜单、chip、发送按钮等其它 hover（已实测正常）；
  - 不改 `composer.tsx` 等 TS/TSX（纯 CSS）。

## 3. 实现路径调研（≥ 2 条，先问用户选哪条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| A（推荐） | [styles.css](../../styles.css) 的 `.dsh-native-input-shell:hover:not(:focus-within)` 把 hover 底色从 `var(--background-modifier-form-field-hover)` 换成 `var(--background-modifier-hover)` | 1 行 CSS + 注释 | 浅色 = 黑 6.7% 叠加、深色 = 白 6.7% 叠加，两主题都与卡片底色有差；语义与过程行 / 菜单行 hover 统一（[0020](0020-process-row-background-swap.md)）。缺点：深色下比原来的 form-field-hover 浅一档；半透明主题下叠加随壁纸（0020 已接受同类风险） | **推荐**：最小改动、跟随主题变量、两主题都可辨 |
| B | 保留现有底色，叠加可见描边：`box-shadow: inset 0 0 0 1px var(--background-modifier-border-hover)` | 1 行 CSS | 不改变底色语义；但 hover 出现描边容易被误读成「聚焦态」（聚焦本来就是 accent 描边），且只加内描边在浅色下对比很弱，通常还得再调边框色 | 不推荐：视觉语义冲突 |
| C | 换反差方向：卡片默认用 `--background-secondary`（浅色 #f6f6f6），hover 用 `--background-primary`（浮起） | 2 行 CSS | 两主题都有对比；但会改掉 0019/0026 已定稿的卡片默认外观（白卡片 + 边框 + 阴影），等于重做输入区视觉，需重新调边框 / 阴影并重拍截图 | 不推荐：超出「恢复 hover 高亮」的范围 |
| D | 自造恒可见色：`color-mix(in srgb, var(--text-normal) 6%, transparent)` | 1 行 CSS | 不依赖 form-field token，两主题都能算出差值；但绕过主题 token，少数主题下可能偏色，后续主题适配要自己维护 | 备选：A 在某个主题下仍不可辨时再用 |

> 写完这一段就**停下来问用户选哪条**，不要默认选 A 直接开工。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [styles.css](../../styles.css) | `.dsh-native-input-shell:hover:not(:focus-within)` 的 `background` 按选定路径替换（A 为 `var(--background-modifier-hover)`），并把注释补成「浅色 / 深色主题都可辨」的原因 |

## 5. 行为变化

- 浅色主题：鼠标移到未聚焦的输入卡片上，整卡出现可见的浅灰叠加（此前完全无变化）。
- 深色主题：hover 底色由 form-field-hover 变成 `--background-modifier-hover`（比原来浅一档），仍可见。
- 聚焦后（`:focus-within`）：与现在一致，不加底色、只保留强调色边框。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 半透明主题下底色随壁纸明暗变化 | 个别主题对比过弱 | 改用路径 D 的 `color-mix` 固定叠加 |
| 深色主题 hover 比原来浅 | 视觉强度变弱 | 回退为 `--background-modifier-form-field-hover`（恢复现状） |
| 整体回滚 | — | `git checkout -- styles.css` 并 `npm run build` |

## 7. 验证

自动化：

- `npm run check` 通过（纯 CSS，`main.js` 不变，构建可复现）。

手动 / CDP（Obsidian 1.14.5，面板宽约 432px）：

1. 浅色主题、输入框未聚焦：鼠标移到输入卡片上，`.dsh-native-input-shell` 的计算 `background-color` 不再是 `rgb(255, 255, 255)`（A 预期为 `--background-modifier-hover` 的解析值），截图能看出整卡变灰；
2. 点入输入框（聚焦）后再悬停：底色回到 `--background-primary`，只剩 `--interactive-accent` 边框；
3. 切到深色主题重复 1、2，同样可辨；
4. 回归：`@` / `/` 菜单行 hover 仍是 `is-active` + 底色；chip / 发送按钮 / 过程行 hover 未变。

**验收标准**：上面 4 条都通过，且 `npm run check` 无报错。

## 8. 需要你拍板

- [x] 确认问题就是「输入框整卡的悬停高亮」（菜单行 hover 与文字选区经实测正常）。
- [x] 选哪条实现路径：**A**（用户 2026-10-27 回复「A」）。
- [x] hover 强度：用户反馈浅色下 6.7% 叠加「变暗」明显 → 浅色改为「描边 + 浮起阴影」，见第 10 节追补。

## 9. 实施记录

- 2026-10-27（用户选路径 A）：[styles.css](../../styles.css) 的 `.dsh-native-input-shell:hover:not(:focus-within)`
  底色由 `var(--background-modifier-form-field-hover)` 改为 `var(--background-modifier-hover)`，
  并在注释里写明「浅色主题下 form-field-hover 与卡片底色同值」的原因。
- 验证（Obsidian 1.14.5，CDP 实时面板；把改动后的 `styles.css` 热注入现有 `<style>` 后取样）：
  - 浅色主题、未聚焦 hover：`.dsh-native-input-shell` 计算背景 `oklch(0 0 none / 0.067)`（黑 6.7% 叠加），
    非 hover 为 `rgb(255, 255, 255)`；截图对比可见整卡变灰；
  - 聚焦后 hover：底色回到 `rgb(255, 255, 255)`、边框为 `rgb(152, 115, 247)`（`--interactive-accent`），
    即 0013 的「聚焦只留强调色边框」语义不变；失焦后 hover 高亮恢复；
  - 深色主题（临时切 body 主题类取样后还原）：`--background-modifier-hover` = `color-mix(in oklch, white 6.7%, transparent)`，
    卡片 `#1C1C1C`，hover 可辨；
  - 回归：`@` / `/` 菜单行 hover、chip、发送按钮、过程行 hover 均未变。
- `npm run check` 通过（版本三处一致 / 无运行时依赖 / tsc / bridge 清单与语法 / `main.js` 与源码一致）。
- 偏差：无（纯 CSS，1 行 + 注释）。生效方式：重载插件（CSS 随插件加载）。

## 10. 追补（2026-10-27，用户反馈「浅色主题下高亮怎么变暗了」）

- **现象**：A 方案在深色主题下是「变亮」，用户认可；浅色主题下 `--background-modifier-hover`（黑 6.7%）
  直接替换掉白底，卡片从 `#ffffff` 落到约 `#e4e4e4`，比面板底色 `#f6f6f6` 还暗，读起来像被按下 / 变灰，而不是高亮。
- **处理**：深色保持原样；浅色改为「不填色 + 描边加深 + 浮起阴影」——
  `background: var(--background-primary)`、`border-color: var(--background-modifier-border-hover)`、
  `box-shadow: var(--shadow-l)`（`.theme-light` 分支），并给 `.dsh-native-input-shell` 的 `transition` 补上 `box-shadow`。
- **验证**（Obsidian 1.14.5，CDP 实时面板，注入改后的 `styles.css` 后取样）：
  - 浅色、未聚焦 hover：`background rgb(255, 255, 255)`、边框 `rgb(218, 218, 218)`、阴影为 `--shadow-l`（卡片浮起，不变暗）；
  - 浅色、聚焦后 hover：底色白 + `--interactive-accent` 边框、阴影回到 `--shadow-s`（聚焦语义不变）；
  - 深色、未聚焦 hover：仍是 `color-mix(in oklch, white 6.7%, transparent)` 叠加（未改动）；
  - `npm run check` 通过。
- **未采用的备选**：浅色把叠加降到 3%（实测卡片 ≈ `#f4f4f4`，几乎与面板 `#f6f6f6` 同色，卡片会「融进背景」，
  失去悬浮感）；以及单纯叠内描边（对比太弱）。
- 生效方式：重载插件（CSS 随插件加载）。
