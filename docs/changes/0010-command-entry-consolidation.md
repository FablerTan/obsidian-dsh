---
status: done
created: 2026-10-26
approved: 2026-10-26   # 用户在对话中明确指定改动项，按规则 12 例外直接执行
scope: src/main.ts, src/view/native, docs
issue: 功能区与命令面板各只保留一个「打开 DeepSeek Harness」，删掉重复的新建会话入口与随之失效的 actions 通道
---

# 0010 入口收敛：功能区 / 命令面板各只留一个打开入口

## 1. 背景与问题

0008 起原生面板是唯一入口，但入口有重复：

- 功能区 2 个按钮：打开面板、新建会话；
- 命令面板 3 条：打开面板、新建会话、重启服务；
- 面板内已有「＋ / 空态按钮 / 会话选择器」新建会话。

用户要求功能区与命令面板各自只保留一个「打开 DeepSeek Harness」。

## 2. 目标与非目标

- 目标：功能区 1 个按钮；命令面板保留「打开 DeepSeek Harness」+「重启 DSH 服务」。
- 非目标：不动状态栏（兼作状态显示，点击也打开面板）；不改命令 id（保用户快捷键）；不改面板内新建会话 UI。

## 3. 方案

1. 删 ribbon `message-square`「新建 DSH 会话」与命令 `new-dsh-session`；
2. 删 `main.newDshSession()`（唯一调用方是上面两个入口）；
3. 顺次删因第 2 步失去调用方的 actions 通道：`DshNativeChatView.createSession()` → `NativeChatActions`（`controller.ts`）→ `onActions` / `actionsRef` / `waitActions` / `handleActions`；
4. 面板内 React 本地的 `createSession` 保留（＋ / 空态 / 选择器仍用它）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/main.ts` | 删 ribbon「新建 DSH 会话」、命令 `new-dsh-session`、私有 `newDshSession()`、未用的 `describeNativeBridgeError` import |
| `src/view/native/native-chat-view.tsx` | 删 `createSession` / `handleActions` / `waitActions` / actions 字段与 `onActions` 传参 |
| `src/view/native/ui/native-chat-root.tsx` | 删 `onActions` prop、`actionsRef`、注册 `useEffect`、`NativeChatActions` import |
| `src/view/native/controller.ts` | 删除（内容只剩接口定义） |
| README / docs / AGENTS / skills | 入口说明、命令清单、改动地图、回归条目、文件数同步 |

## 5. 行为变化

- 功能区只剩 1 个鲸鱼按钮；命令面板只剩 `open-dsh-view` 与 `restart-dsh-service`。
- **命令 id `obsidian-dsh:new-dsh-session` 消失**：绑过快捷键的用户会失效，需改用面板内入口。
- 新建会话能力不变（面板内 ＋ / 空态 / 会话选择器），cwd 仍是 vault。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 用户依赖 `new-dsh-session` 快捷键 | 快捷键静默失效 | 恢复 main.ts 中的命令与 `newDshSession()`（`git revert` 本提案提交） |
| 以后需要主进程驱动面板动作 | 需重建 actions 通道 | 同上；当前无此需求 |

## 7. 验证

- 自动化：`npm run build`（tsc + esbuild）、`npm run check` 全绿。
- 手动：重载插件 → 功能区 1 个按钮；命令面板只剩 2 条；面板内新建会话仍可用。

## 8. 需要你拍板

- [x] 保留「重启 DSH 服务」命令（不连它一起删）——已确认。
- [x] 同步删掉 actions 通道（死代码）——已确认。

## 9. 实施记录

2026-10-26 执行：

- `src/main.ts`：删 ribbon / 命令 / `newDshSession()` / `describeNativeBridgeError` import；
- `native-chat-view.tsx`：删 `createSession`、`handleActions`、`waitActions`、`actions` / `actionsPromise` / `resolveActions` 字段与 `onActions` 传参；
- `native-chat-root.tsx`：删 `onActions` prop、`actionsRef` 及其注册 `useEffect`、`NativeChatActions` import；
- 删除 `src/view/native/controller.ts`；
- 文档：README 入口段、development 改动地图 / 回归 16、34、obsidian-cdp 命令清单、troubleshooting 措辞、architecture 关注点表与目录树。

验证：`npm run build` 通过（main.js 207.8kb）；`npm run check` 全绿。人工 UI 回归未做（需重载插件确认命令列表）。
