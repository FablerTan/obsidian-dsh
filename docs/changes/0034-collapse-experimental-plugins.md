---
status: done            # draft | approved | done | rejected
created: 2026-10-27
approved: 2026-10-27    # 用户当轮明确指定「实验性插件默认收起，点击才展开」，按 AGENTS.md 规则 12 例外视为已批准
scope: src/settings, styles.css, docs
issue: 「插件」tab 的「可选 / 实验性插件」整块常驻展开、占满首屏，希望默认收起，点标题才展开
---

# 0034 可选 / 实验性插件默认收起

> 对应路线图 [R-17](../roadmap.md#需求待办)。改的是 [0032](0032-optional-bundles.md) 落地的顶部卡片。

## 1. 背景与问题

0032 把官方「可选 / 实验性插件」做成「插件」tab 顶部的常驻卡片：标题一行 + 14 行开关全部铺开。
进入 tab 后首屏几乎被这块占满，下面的 bundle 组合清单要往下滚才能看到；而实验性插件多数时候只是偶尔看一眼，
常驻展开反而把主视图（组件行启停）挤走。

## 2. 目标与非目标

### 目标

- 「可选 / 实验性插件」卡片**默认收起**：只显示标题 + 统计（共 N 个 / 已启用 M 个）。
- **点击标题展开**列表（再点收起）；键盘 Enter / 空格同样可切换。
- 展开 / 收起交互与下方 bundle 分组的折叠头一致（箭头图标、hover 底色、focus 环、aria-expanded）。
- 收起时按钮与统计仍可见，用户知道这里有多少个、启用了几个。

### 非目标

- 不改变启用 / 停用的写入链（仍是 service/plugin-bundles.ts + 重启服务生效）。
- 不改默认展开策略之外的筛选、分组、排序。
- 不记忆到设置（不跨会话记住展开状态）；也不需要「全部展开」按钮。

## 3. 实现路径调研（≥ 2 条）

| 路径 | 做法 / 关键代码位置 | 改动面 | 代价与风险 | 结论 |
|---|---|---|---|---|
| **A（推荐）复用 bundle 折叠头** | [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts) 的 renderCatalog()：把 .dsh-settings-plugins-bundle-head.is-static 换成可交互头（setIcon 箭头 / role=button / tabindex / aria-expanded / onclick / onkeydown），闭包里加 catalogOpen 布尔量，收起时 return 不渲染 rows 与 on-demand 提示；[styles.css](../../styles.css) 删掉只服务静态头的 .is-static 两条规则 | 1 个 section 文件 + 2 条 CSS，约 25 行 | 与现有 bundle 头共用同一套样式与交互，视觉 / 无障碍口径统一；renderCatalog() 会因开关写库重绘，状态放闭包即不会被打回收起。风险：几乎为零（纯 UI 条件渲染） | **推荐** |
| B 用原生 details / summary 折叠 | 卡片改成原生 details 元素，open 不设即默认收起 | 1 个文件 | 少写 JS；但样式与现有 .bundle-head 不一致（原生 summary 箭头、focus / hover 表现都不同），要额外覆盖 CSS 才能对齐，反而更绕 | 不推荐：一致性成本高于省下的几行 |
| C 持久化展开状态到设置 | DEFAULT_SETTINGS 加 pluginsCatalogOpen，写 data.json | schema + context + section | 跨会话记住上次状态，但「默认收起」的诉求本身只要默认值；为一个纯 UI 偏好新增设置项会扩散默认值来源（AGENTS 规则 3） | 不推荐：超出需求 |

**推荐 A**：用户要的就是「默认收起、点击展开」，复用已有折叠头最省且交互一致性最好，不引入新设置项。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| [src/settings/sections/plugins.ts](../../src/settings/sections/plugins.ts) | catalogOpen 闭包状态（默认 false）；renderCatalog() 头部改为可交互（chevron 箭头、role=button / tabindex / aria-expanded、点击与 Enter/空格切换）；收起时不渲染 rows 与「需先安装」提示 |
| [styles.css](../../styles.css) | 删除只服务静态头的 .dsh-settings-plugins-bundle-head.is-static 及其 hover 覆盖（新头复用可点击样式）；注释标注 0034 |
| [main.js](../../main.js) | npm run build 重新生成 |

## 5. 行为变化

- 进入「插件」tab 时，顶部「可选 / 实验性插件」只显示标题与「共 N 个 · 已启用 M 个」，列表收起。
- 点标题（或聚焦后 Enter / 空格）展开列表，再点收起；箭头随状态切换。
- 展开时启用 / 停用开关仍可用；写库触发的重绘保持当前展开状态，不会自动收起。
- 收起时不显示「另有需要先安装的插件」提示（随列表一起折叠）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 用户找不到实验性插件开关 | 需要多点一下才能展开 | 标题行常驻且带箭头 + 数量统计；如需恢复常驻展开，把 catalogOpen 初始值改 true（单行） |
| 重绘丢失展开状态 | 开关一按列表就收起 | 状态在闭包里、renderCatalog() 只重绘 DOM，不重建闭包；已按此实现 |

## 7. 验证

自动化：

    npm run build    # tsc + esbuild 通过
    npm run check    # 版本 / 依赖 / 类型 / main.js 与源码构建一致

手动（Obsidian 内设置 → DSH in Obsidian → 插件）：

1. 打开 tab：「可选 / 实验性插件」默认收起，只看到标题 + 统计，箭头朝右；
2. 点标题展开，箭头朝下，14 行开关出现；再点收起；
3. 展开状态下切一个开关 → 写入成功 / 失败提示照旧，列表仍保持展开；
4. 键盘 Tab 聚焦标题、Enter / 空格能展开收起，focus 环可见。

验收标准：默认渲染的 DOM 里该卡片不含 .dsh-settings-plugins-rows；点击后出现；aria-expanded 随状态在 true/false 间切换。

## 8. 需要你拍板

- [x] 实现路径：用户当轮已指定「默认收起、点击展开」，按规则 12 例外直接执行 A。
- [ ] 是否需要跨会话记住展开状态（本提案不做；要的话单开需求）。

## 9. 实施记录

- 2026-10-27：renderCatalog() 头部改为可交互折叠头（复用 .dsh-settings-plugins-bundle-head + chevron 箭头 + aria-expanded），
  catalogOpen 默认 false；收起时跳过 rows 与 on-demand 提示渲染；删除 .is-static 两条 CSS。
  npm run build（tsc + esbuild）与 npm run check 通过；main.js 已重新生成。
  与提案无偏差。
- 2026-10-27（CDP 实测，Obsidian 1.14.5 / 开发 vault）：重载插件后打开设置 → DSH in Obsidian → 插件，
  默认态 `.dsh-settings-plugins-optional` 高度 51px、无 `.dsh-settings-plugins-rows`、`aria-expanded=false`、箭头为 chevron-right；
  点标题后高度 963px、14 行开关、`aria-expanded=true`、箭头 chevron-down；再点回到 51px / 0 行。
  键盘可聚焦（`role=button` / `tabindex=0`）。
