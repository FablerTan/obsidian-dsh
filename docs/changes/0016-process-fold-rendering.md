---
status: done
created: 2026-10-27
approved: 2026-10-27
scope: src/view/native/ui, styles.css
issue: 原生聊天消息渲染对齐 DSH Web：思考 / 工具调用默认一行、点击展开；修收尾后工具内容消失
---

# 0016 原生消息渲染：思考与工具调用折叠成一行

> 用户当轮已明确指定改动项（AGENTS.md 规则 12 的例外），直接实施；本文件是事后记录。

## 1. 背景与问题

原生面板目前把一轮里的节点逐个平铺：

- `turn-process` 节点落到 `UnknownNode`，显示成一张写着“turn-process”的原始 JSON 卡；
- 每个 `assistant-step` 的“思考”单独一块，每个 `tool-call` 再单独一张卡，一轮 5 个工具就有 10 行；
- 收尾后工具卡可能整段消失：`NodeView` 对所有 `visibility: hidden` 节点直接 `return null`，
  而 DSH 在回合收尾时会把已物化的 `tool-call` 节点标成 hidden（withdrawn）；同时
  `AssistantMessage` 只渲染 text / reasoning，不渲染 assistant-step 里的 tool-call 块，于是工具内容没有兜底来源。

DSH Web 的做法（用本机 3088 构建的 DOM / bundle 观察）：一轮的思考与工具调用属于同一条 process group，
默认只显示一行摘要（运行中显示实时活动，收尾后显示“已完成 / 运行了代码…”），点击才展开思考与工具行。

## 2. 目标与非目标

- 目标：
  - 思考 + 工具调用默认折叠成一行，实时显示当前活动；点击展开完整过程；
  - 收尾后工具调用内容仍在，不因节点 visibility 或 turn-tail 消失；
  - 工具行也按 DSH Web 风格收敛：名称 + 参数摘要 + 状态一行，点击看参数 / 结果；
  - 顺带去掉 “turn-process” 原始 JSON 卡。
- 非目标：不改桥协议、不改 dsh 侧插件、不做虚拟滚动、不恢复官方面板。

## 3. 方案

新增一个纯函数折叠模型 + 三个小 UI 组件：

- `timeline-model.ts`：按 turn 把 `turn-process` / `assistant-step` 的 reasoning、tool-call 块 /
  `tool-call` 节点收进 `ProcessGroupItem`；**过程成员不按 visibility 过滤**（hidden 的 tool-call 仍保留，
  这是收尾后内容消失的根因修复）；同一 callId 的块与节点合并，节点提供结果。
- `timeline-process.tsx`：过程行（一行摘要 + 展开体）、思考行（预览 + 展开全文）。
- `tool-row.tsx`：工具行（图标 / 名称 / 参数摘要 / 状态 / 展开体 / 嵌套 subCalls）。
- `chat-node-data.ts`：节点字段的防御式读取与工具映射。
- `timeline.tsx` 用模型产出渲染项；`timeline-nodes.tsx` 只保留用户消息、正文、上下文 / 命令 / 错误等非过程节点。

备选（未选）：直接改桥，把 DSH 的 process group 数据透传给前端。桥目前只暴露 chat nodes，
新增 group 协议会扩大桥 v2 契约；先用现有节点做折叠，信息足够。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/view/native/ui/timeline-model.ts` | 新增：按 turn 折叠 process 的纯函数模型、状态 / 用时 / 类别统计 |
| `src/view/native/ui/chat-node-data.ts` | 新增：节点读取、content / 工具字段解析、工具类别映射 |
| `src/view/native/ui/timeline-process.tsx` | 新增：过程行 + 思考行（默认折叠） |
| `src/view/native/ui/tool-row.tsx` | 新增：工具行（参数摘要、状态、展开体、subCalls） |
| `src/view/native/ui/timeline.tsx` | 改为渲染模型产出的 process / text / node 项 |
| `src/view/native/ui/timeline-nodes.tsx` | 移除思考 / 工具卡 / assistant-step 渲染，保留其余节点；新增 `AssistantText` |
| `styles.css` | 过程行、思考行、工具行样式；删掉旧的 reasoning / typing / tool-meta 样式 |

## 5. 行为变化

- 一轮的思考与工具调用默认只有一行：
  - 运行中：思考中 / 运行代码 / 运行命令 + 实时摘要 + 脉冲点；
  - 收尾：运行了代码，执行了命令，读取了文件（最多 3 类 + “等”）+ 用时；
  - 停止：已停止；出错：执行出错。
- 点击过程行展开：思考行（预览一行，点击看全文）、工具行（点击看参数 / 结果）、嵌套 subCalls。
- 工具调用结果在收尾后仍可展开查看；不再依赖节点 visibility。
- 助手正文（含工具调用前后的说明）仍按原顺序渲染：步骤先说话再调用工具时，正文在过程行之前。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| 折叠模型对节点顺序假设过强 | 少见的 text / tool 交错步骤顺序不完美 | 回滚到逐节点渲染；或按实际快照补充模型用例 |
| hidden 节点保留过多 | 理论上可能展示被 withdrawn 的内部工具 | 只在 `tool-call` 上忽略 visibility；其他节点保持原过滤 |
| 旧会话缺少 turn-tail closing | 停止 / 中断的回合按“已停止”显示 | 若历史数据 closing 缺失但并非中断，改回“已完成” |

无数据 / 桥协议变更，回滚只需还原上述文件与 `styles.css`。

## 7. 验证

- `npm run build`、`npm run check` 通过。
- 纯函数冒烟（esbuild 到 /tmp）：user → 前置正文 → process → 正文；hidden tool-call 仍进入 process；
  settled / aborted 状态、类别统计、用时正确。
- CDP（Obsidian 1.14.5 + dsh 0.2.1-rc.3，本机 3088）：
  - 历史多工具会话：默认一行“运行了代码，执行了命令”，用时 14 秒；展开后 3 个 run_code + 3 个 bash 子调用；
  - 实时回合：思考中 → 思考 + 思考首行 → 收尾“运行了代码，执行了命令，读取了文件 / 用时 4 秒”；
    展开状态与工具参数在收尾后保持；
  - 停止回合：显示“已停止 / 用时 2 秒”；
  - 隐藏节点回归：在隐藏 core 里把 tool-call 节点 visibility 临时改为 hidden 后重新订阅，
    面板仍渲染 6 个工具行（说明收尾后不再消失）。

## 8. 需要你拍板

无（用户已指定目标；剩余为视觉细节，可继续微调）。

## 9. 实施记录

2026-10-27 实施：

- 新增 `timeline-model.ts` / `chat-node-data.ts` / `timeline-process.tsx` / `tool-row.tsx`；
- `timeline.tsx` 改用折叠模型；`timeline-nodes.tsx` 移除旧思考 / 工具渲染；
- `styles.css` 增加过程 / 思考 / 工具行样式，删除旧 `.dsh-native-reasoning` / typing / tool-meta；
- 验证：build + check 通过；模型冒烟通过；CDP 实时 / 历史 / 停止 / hidden 节点回归通过。
