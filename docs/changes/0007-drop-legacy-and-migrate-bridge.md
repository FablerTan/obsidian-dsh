---
status: done
created: 2026-10-26
approved: 2026-10-26
scope: src/service, src/view, src/shared, src/settings/tab.ts, src/main.ts, styles.css, scripts/check.mjs, packages/dsh-obsidian-bridge, docs, manifest.json / package.json / versions.json
issue: 只支持 dsh 0.2.x：移除 0.1.1 与 iframe 兼容路径，并把 dsh-obsidian-bridge 插件迁入本仓库
---

# 0007 只支持 dsh 0.2.x：移除旧兼容 + bridge 插件迁入

> 状态：**approved（2026-10-26）**。依据用户当轮明确指令：只做 0.2.x、旧版不管、删掉现有兼容代码、
> 把 dsh-obsidian-bridge 迁入本仓库并合并原生数据桥。按 [AGENTS.md](../../AGENTS.md) 规则 12 的例外直接实施。

## 1. 背景与问题

当前代码同时兼容两代 dsh：

- 0.1.1：裸 URL 返回 200 + `__ModuleLoader__`，靠四态探测判就绪；
- 0.2.1+：裸 URL 返回 401，靠 stdout 的 `dsh web: <token-url>` 判就绪。

同时面板在 webview 不可用时回退 iframe。但 0.2.1+ 的 `SameSite=Strict` cookie 在跨站 iframe 里
必然 401，回退路径实际不可用；0.1.1 也不再维护。两套兼容分支让 manager / surface / bridge /
设置页都多出无效状态，原生聊天（[0006](0006-native-chat-panel.md)）也不需要它们。

另外，dsh 侧 `dsh-obsidian-bridge` 一直在外部仓库维护；0006 已确定把原生 core API 合并进该插件，
继续留在外部仓库会让“Obsidian 插件 + 它的 dsh 侧插件”跨仓库修改。

## 2. 目标与非目标

### 目标

1. 只支持 dsh 0.2.x：就绪只认 stdout 的 `dsh web:` 行；
2. 面板只支持 Electron `<webview>`；不可用时明确报错，不再回退 iframe；
3. 删除 `src/service/probe.ts`（fetch 兜底探测）与所有 iframe 分支；
4. 把 `dsh-obsidian-bridge` 迁入本仓库 `packages/dsh-obsidian-bridge/`；
5. 0006 的 native core API 直接加到这个插件（v2），不再新建第二个插件；
6. 同步文档、版本号与提交前检查。

### 非目标

- 不实现 0006 的 Phase 0 桥（本次只做迁移与合并的结构准备）；
- 不改 dsh 服务协议、不接管 root、不做原生 UI；
- 不保留 0.1.1 的探测 / 回退 / 提示分支；
- 不删除外部仓库里的旧副本（本机沙箱只允许写本仓库，用户可自行清理）。

## 3. 方案

### 3.1 只支持 0.2.x

- `manager`：
  - spawn 前仍做四态探测，用于区分「端口被别人占用（foreign）」「遗留实例需要 token（auth）」；
  - `running`（裸 URL 能直接打开）不再视为可用，而是报新失败原因 `unsupported`（0.1.x 或不带鉴权的实例）；
  - 就绪只等 stdout 的 `dsh web: <url>`，删掉就绪循环里的 200 探测与 auth/foreign 过渡分支；
  - `isReachable()` 只认「本次拉起且已拿到 token URL」；
  - `probe` 改为必填，删除 `service/probe.ts`；可信探测仍由 `shared/host.ts` 注入。
- `surface`：只创建 `<webview>`；不可用时返回 `null`，由 view 显示错误并提示，不再创建 iframe。
- `bridge` / 设置页 / 类型：删除 `iframe` 错误原因与状态。
- 版本升到 **0.3.0**，旧的 0.1.1 + iframe 行为不再保证。

### 3.2 插件迁入与合并

- 新目录 `packages/dsh-obsidian-bridge/`，保持独立包（`package.json` / `cordis.patch.yml` / `lib/`），
  不被 esbuild 打进 `main.js`；由 `dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge` 安装。
- 现有 v1 API（ping / configure / newSession / enforceSingleColumn / state）保持不变；
- 0006 的 native core API 作为 v2 能力加在同一个插件的 `lib/client.js`，全局对象仍用
  `window.__DSH_OBSIDIAN_BRIDGE__`（不新增 `__DSH_OBSIDIAN_CORE__`）。
- 外部仓库旧路径的副本不自动删除；本仓库文档改为新路径，旧 profile link 需要重新 add。

### 3.3 备选（未选）

- 保留 iframe 回退：0.2.x 下不可登录，只是多一条死路径；
- 保留 0.1.1：需要继续维护探测、token 差异与双版本回归，与「只做 0.2.x」冲突；
- 插件继续留在外部仓库：跨仓库改 0006 的桥不方便。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/service/manager.ts` | 删 0.1.1 就绪探测；只等 stdout URL；新增 `unsupported`；`probe` 必填；`isReachable` 只认 token URL |
| `src/service/probe.ts` | 删除（fetch 兜底不再需要） |
| `src/view/surface.ts` | 只保留 webview；不可用返回 `null`；删除 iframe 与 `DshSurfaceKind` |
| `src/view/dsh-view.ts` | 承载面为 null 时明确报错；删除 iframe 兼容提示；`surfaceKind` 只含 webview |
| `src/view/bridge.ts` | 删除 `iframe` 错误原因与映射 |
| `src/shared/types.ts` | `DshBridgeState` 删除 `iframe`；探测注释改为 0.2.x 语义 |
| `src/settings/tab.ts` | 删除 iframe 文案；桥安装命令改新路径 |
| `src/main.ts` | `unsupported` Notice；注释去掉 iframe |
| `styles.css` | 删除 iframe 规则 |
| `scripts/check.mjs` | 增加 `packages/dsh-obsidian-bridge` 清单与 `node --check` |
| `packages/dsh-obsidian-bridge/` | 从外部仓库迁入（不含 `.git`），README 改为本仓库路径与合并说明 |
| `manifest.json` / `package.json` / `versions.json` | 版本 0.3.0 三处一致 |
| `AGENTS.md` / `README.md` / `docs/*` / `skills/project-guide` | 同步 0.2.x-only、webview-only、插件新路径 |
| `docs/changes/0006-native-chat-panel.md` | 合并方案落到 `dsh-obsidian-bridge` v2，删除 native-core 独立插件 |

## 5. 行为变化

- dsh 0.1.x / 不带 token 鉴权的实例不再被接受：状态条「版本不支持」，提示结束后重启；
- webview 不可用时面板直接报错，不再出现 iframe 空白页；
- 桥的安装路径变为本仓库 `packages/dsh-obsidian-bridge`；旧 profile link 需重新 add；
- 其余命令、状态栏、设置项、连接流程不变。

## 6. 风险与回滚

| 风险 | 影响 | 回滚 |
|---|---|---|
| 用户机器上仍有 0.1.x 在跑 | 插件拒绝启动，提示版本不支持 | 升级到 0.2.x；或回退本提案代码 |
| 插件迁移后 profile link 失效 | 页面桥缺失、新建会话报「未检测到桥」 | 重新 `dsh plugin add link:<新路径>` 并重启服务 |
| 删除 iframe 后极旧 Obsidian（< 1.4）不可用 | 面板无法承载 | 本插件 `minAppVersion` 已是 1.4.0；升级 Obsidian |
| 0.2.x 未启用 token 的实例被拒绝 | 少数自建实例不能用 | 保持默认 token 鉴权；或后续单独评估 |

回滚：恢复 `src/service/probe.ts`、surface 的 iframe 分支与 bridge 的 `iframe` 原因；版本回到 0.2.0；
插件目录可整体移回外部仓库。

## 7. 验证

- `npm run build` / `npm run check` 通过（check 含插件 JS 语法与清单）；
- 手动回归（Obsidian）：
  1. 0.2.x 启动 → 状态条「运行中」→ 面板 webview 正常加载；
  2. 端口上放一个 0.1.x 或裸 200 页面 → 状态条「版本不支持」+ Notice，不 spawn；
  3. webview 不可用的环境 → 面板显示错误提示，不出现 iframe；
  4. 插件迁入后重新 add → 新建会话 / 单栏仍正常；
  5. 现有命令、状态栏、设置页无回归。

## 8. 需要你拍板

- [x] 只做 0.2.x、删除 0.1.1 与 iframe 兼容（用户 2026-10-26 明确要求）；
- [x] bridge 插件迁入本仓库并与 native core 合并（用户 2026-10-26 明确要求）。

## 9. 实施记录

2026-10-26 实施完成：

- `manager`：就绪只等 stdout `dsh web:`；新增 `unsupported`（裸 200 / 0.1.x）；`probe` 必填；删除 `service/probe.ts`。
- `surface` / `dsh-view` / `bridge`：只保留 Electron webview；不可用返回 `null` 并显示错误；删除 `iframe` 错误原因与兼容提示。
- `settings/tab.ts` / `main.ts` / `shared/types.ts` / `styles.css`：删除 iframe 文案与样式；新增「版本不支持」Notice。
- `packages/dsh-obsidian-bridge/`：从外部仓库迁入（不含 `.git`），README 与安装路径改为本仓库；v1 API 不变，v2 留给 0006。
- `scripts/check.mjs`：增加插件清单与 `node --check`；版本升到 0.3.0（三处一致）。
- 验证：`npm run build`、`npm run check` 通过。
- **待人工确认**：Obsidian 内 0.2.x 面板加载、0.1.x 被拒绝、新 link 路径生效、单栏 / 新建会话无回归。
