# 故障排查

先拿三样信息：状态栏文案、开发者控制台（`Cmd+Opt+I`）里 `[obsidian-dsh]` 与 `[dsh]` 日志、当前端口上到底有没有进程：

```bash
lsof -nP -iTCP:3081 -sTCP:LISTEN      # 端口是否被监听（把 3081 换成实际端口）
ps aux | grep -i "[d]sh --profile"   # 有没有 dsh 进程
```

## 状态栏「启动失败」+ Notice「无法定位 dsh 可执行文件」

插件在几个固定位置都没找到 dsh。

1. `which dsh`、`ls -l ~/.local/bin/dsh` 看是否可执行；
2. 都没有就做个链接或改用 node 直跑 `~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`；
3. 确认 Finder 启动的 Obsidian 也能看到这些目录（插件已前置 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`）。

## 状态栏「启动失败(退出码 N)」

进程起来了但立刻退出，看控制台 `[dsh]` 输出的最后几行：

| 错误特征 | 原因 | 处理 |
|---|---|---|
| `profile "xxx" does not exist` | settings.profile 指向不存在的 profile | 改回 `obsidian`，或创建该 profile |
| 语法/版本错误、`ERR_UNSUPPORTED...` | Node 版本不满足 dsh 要求（`^22.19` / `>=24`） | 装匹配版本，或在 PATH 前置对应 node |
| `EADDRINUSE` | 端口已被占用 | 换端口，或先结束占用进程 |
| 缺依赖 / 找不到模块 | dsh 安装不完整或 profile 的 bundles 缺失 | 重装 dsh / 检查 profile 的 `package.json` |
| `cordis.patch.yml must be a top-level YAML array of loader patch entries` | profile 的 patch 文件只有注释，没有顶层数组 | 在该文件末尾补一行 `[]`（保留原有注释），重启服务 |

## 每次都「启动失败(退出码 1)」且日志提到 cordis.patch.yml

dsh 要求 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 是**顶层 YAML 数组**。如果这个文件里只有注释
（比如手动删掉挂载行后没收尾），YAML 解析结果是 `null`，dsh 直接退出：

```
Error: dsh: overlay .../cordis.patch.yml must be a top-level YAML array of loader patch entries
```

修法：在该文件末尾补一行空数组，保留注释：

```yaml
# ...原有注释...
[]
```

> 2026-10-26：本机确实出现过这个状态（`~/.dsh/profiles/obsidian/cordis.patch.yml` 只有注释），
> 表现为插件怎么点都是「启动失败(退出码 1)」，与插件代码无关。已修复：补了 `[]`，
> 原文件备份在同目录的 `cordis.patch.yml.bak-<时间戳>`。
>
> 验证方式（绕过 Obsidian 直接跑服务）：服务能起说明 profile 合法；
> 注意 dsh 启动时会重写 profile 目录下的 `cordis.yml`，所以**在受限沙箱里跑会报 EPERM**，
> 那是沙箱限制，不是 profile 问题。

## 跑起来的 dsh 不是你以为的那份

插件优先用 `~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（存在时），其次才是 PATH 上的 `dsh`。
两者版本可能不同（例如全局安装 0.1.x、PATH 指向 0.2.x checkout），于是出现「日志里的报错在 checkout 里搜不到」。0.3.0 起插件只接受 0.2.x。

核对方式（M2-5 起不用再手动查）：

1. 控制台搜 `[obsidian-dsh] dsh 版本:` —— 启动后会打印**实际使用的路径与版本**；
2. 设置 → DSH in Obsidian →「运行环境」—— 显示当前 dsh 与其他版本安装；
3. 若存在版本不同的多份安装，控制台会有 `发现其他版本的 dsh` 警告，并弹一次 Notice。

处理：M2-5 起日志/设置页已经能看见实际版本；**0003 起可直接在设置页「dsh 版本」下拉切换**检测到的安装，
改完点「重启服务」即可，不需要再动安装顺序。若选到 0.1.x，插件会报「版本不支持」，见下面的「0.1.x 不再支持」。想手动对照可跑：

```bash
dsh --version
node -e "console.log(require(process.env.HOME+'/.local/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
```

> 若服务是上次遗留、本次没有重新拉起，插件无法确认它在用哪份二进制：日志会写「服务已在运行（非本次拉起）；插件将使用 dsh …」、
> 设置页标注「无法确认其版本」，点「重启服务」后才会变成确认的实际版本。

## 状态条「需手动结束」/ Notice「端口上的 dsh 需要 token」

dsh 0.2.x 的 Web UI 需要浏览器会话 token（启动时打印 `dsh web: http://…/?token=…`，裸 URL 返回 401）。
插件能接管**自己拉起**的 0.2.x（从 stdout 读就绪 URL），但拿不到**别的进程**的 token：

- 典型场景：上次 Obsidian 崩溃/强退，遗留的 0.2.x 还占着端口 → 插件探测到 `auth`、状态条「需手动结束」；
- 处理：`pkill -f "dsh --profile obsidian"` 结束遗留实例 → 点「重启服务」；
- 不要用「换个端口」绕，遗留实例会继续占着旧端口。

## 使用 0.2.x / 切换 dsh 版本

1. 设置 → DSH in Obsidian →「dsh 版本」，选「自动（按优先级）」或某个检测到的安装（显示版本 + 路径）；
2. 点「重启服务」生效；设置页「运行环境」显示当前实际使用的路径/版本；
3. 0.2.x 的承载面地址带 token，只用于首次登录，随后走 cookie；重启服务后 token 会变，
   已打开的面板若空白/401 → 关掉面板再打开；
4. 显式选择某个版本后，启动时不再弹「发现其他版本」的 Notice（仍会写日志，可在「运行环境」查看）。

### 0.1.x 不再支持

0.3.0 起插件只接受 0.2.x：端口上如果是 0.1.x（裸 URL 返回 200 + `__ModuleLoader__`），
状态条会显示「版本不支持」并拒绝拉起新进程。处理：

```bash
pkill -f "dsh --profile obsidian"   # 结束遗留实例
```

然后在设置页选择一份 0.2.x 安装，点「重启服务」。旧的 0.1.1 全局安装可以删除或改名备份。

## 原生聊天提示「不支持 webview」/ 仍 401

dsh 0.2.x 的会话 cookie 是 `SameSite=Strict`，只有 webview 的独立顶层能携带；跨站 iframe 在 303 后不会带 cookie，
所以原生面板的**隐藏 core** 必须走 webview，**没有 iframe 回退**（0007 / 0008）。先看控制台：

- 正常：`[obsidian-dsh] 面板承载方式: webview（persist:dsh-obsidian）`；
- 异常：`[obsidian-dsh] 当前环境不支持 webview，DSH 面板无法承载`，原生视图显示错误并弹一次 Notice。

处理：升级 Obsidian（当前 1.14.4 主窗口已开启 webviewTag，核心 Web viewer / Canvas 自用）；
没有 webviewTag 的旧版本无法使用本插件。

若控制台显示 webview 正常但页面仍 401：确认是插件自己拉起的实例（遗留实例拿不到 token，
见上一节「需手动结束」），并关闭/重开原生面板让新 token 生效。

## 状态栏「启动超时」

20s 内端口没就绪。首次启动、Cordis 树挂载慢、或某插件初始化卡住都会这样。

1. 在 vault 目录手动跑同一条命令看真实输出；
2. 若手动能起、插件不行，多半是环境差异（PATH、node 版本、cwd）—— 对比 `env`；
3. 先看日志确认是慢还是卡死，再决定是调大等待还是修依赖。

## 原生面板空白 / 一直「正在连接 DSH…」

服务刚被拉起时隐藏 core 可能停在错误页。`ensureReady()` 会在服务就绪后自动重载一次；
命令「重启 DSH 服务」成功后，主进程还会调用 `reloadAfterRestart()` 用新 token 重载隐藏 core。
若仍空白：

1. **关掉原生面板再打开**（最简单有效）；
2. 确认设置里的端口与 `data.json` 一致（界面不再展示服务 URL）；
3. `curl -I http://127.0.0.1:<port>` 看服务是否真的响应；
4. 设置页点「重启服务」后再打开面板。

## 状态条「端口被占用」/ Notice「端口已被其他程序占用」

插件用 Obsidian `requestUrl` 探测目标端口：能连上但**不是 dsh**（正文里没有 `__ModuleLoader__` 标记）或状态码非 200/401，判定为「端口被占用」；0.1.x 那种裸 200 的 dsh 页面会判定为「版本不支持」，同样**不会** spawn 第二个进程。

1. `lsof -nP -iTCP:<port> -sTCP:LISTEN` 看占用者；
2. 若是别的程序 → 插件设置里换端口 → 点「重启服务」；
3. 若是之前遗留的 dsh（探测无法确认归属）→ `pkill -f "dsh --profile obsidian"` 清掉，再「重启服务」。

## 端口冲突 / 起了两个 dsh

1. `lsof -nP -iTCP:<port>` 找出占用者；手动起的实例插件不会杀（设计如此）；
   - **插件重载 / Obsidian 崩溃**后，旧 dsh 可能变成孤儿继续占用端口（父进程已消失）。0.2.x 遗留实例会探测为 `auth`，
     插件显示「需手动结束」、不会复用；清掉它（`kill <pid>` 或 `pkill -f "dsh --profile obsidian"`）后重启服务。
2. 结束多余进程，或在设置里改端口后点「重启服务」；
3. 文档默认端口是 **3081**，但 `data.json` 里可能是你改过的值（比如 3082）——**以 data.json 为准**。

## 改了设置但行为没变

- 端口 / profile 只在**拉起进程**时读取，改完必须点「重启服务」；重启成功后已打开的原生面板会自动重载。
- 原生面板不会自己换端口；若没有自动重载，关闭再打开。
- 若 `data.json` 被外部工具覆盖/删除，设置会回到默认值（开发期它在仓库根目录）。

## 新建 DSH 会话提示「未检测到 dsh-obsidian-bridge」

面板内的新建会话（右上 ＋ / 空态按钮 / 会话选择器）依赖 dsh 侧客户端桥，不是插件内置逻辑。

1. 确认 profile 已安装：`cat ~/.dsh/profiles/obsidian/package.json` 的 `dsh.profile.bundles` 里应有 `dsh-obsidian-bridge`；
2. 没有就装：`dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge`（旧外部路径先 remove）；
3. **重启 DSH 服务**（插件设置 → 重启服务），再重开面板（旧页面不会自己换 bundle）；
4. 设置页「桥接状态」点「重新检测」应显示「已连接（v6）」。

## 回复不是流式（运行中不出现正文 / 思考）

0017 起桥 v3 直接订阅会话事件流（`liveStream`），流式不再依赖隐藏 core 的 rAF。若仍看不到增量：

1. 设置页「桥接状态」应显示「已连接（v6）」；仍是 v2 / 「版本过旧」→ profile 里 link 的还是旧 bridge：
   `dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge`，然后**重启 DSH 服务**；
2. 面板顶部若出现“dsh-obsidian-bridge 需要更新……”的 Notice，同第 1 条处理（旧桥会软降级，不流式但不报错）；
3. 隐藏 core 被 Chromium 节流只影响官方节点（正文 / 思考的 live 已由事件流提供），
   但如果连用户消息 / 工具卡也不更新，先看「事件通道中断」与端口占用；
4. 停止 / 切换会话后仍残留半截文本 → 记录 bridge 版本与复现步骤，按 0017 的回滚方式退回整段出现。

## 单栏 / 官方 GUI 设置已移除

0008 删除了可见官方面板；`dsh-obsidian-bridge` v1 的单栏 / 工作区代码已随 0011 从包里删除，插件只走原生数据桥（当前 v6：快照 / liveStream / context / 命令技能目录 / team）；
Obsidian 里不再需要恢复侧栏或调整官方 GUI 布局。`dsh-ui-obsidian-layout` 等外部客户端插件
只会影响隐藏 core，正常使用时看不到。

## 隧道 / 公网访问被拒

dsh 默认只信任 loopback Host。通过樱花等隧道暴露时，在 dsh 侧加 `--trusted-host`。

## 移动端没有入口

插件是 `isDesktopOnly: true`（依赖 `child_process`），移动端不可安装，属预期行为。

## 原生聊天打不开 / 桥未连接

原生聊天是唯一入口，内部需要一个**隐藏的官方 DSH webview** 和 bridge **v2+（流式需要 v3）**：

1. 确认 profile 已 link 到本仓库新路径，并重启 DSH 服务；
2. 设置页「桥接状态」应显示「已连接（v6）」；显示「版本过旧」说明 profile 里 link 的还是旧 bridge；
3. 状态「桥版本过旧」→ 更新 `packages/dsh-obsidian-bridge` 后重启服务；
4. 状态一直停在「正在连接 DSH…」→ 看控制台隐藏 core 是否加载、端口是否被另一个 0.2.x 实例占用；
   命令「重启 DSH 服务」后会自动重载；
5. 模型菜单显示「没有可用模型」→ 这是 DSH profile 侧没有可用 provider，不是桥的问题；
   点「配置说明」按提示编辑 `cordis.patch.yml`，见下面「模型菜单是空的 / 模型和桌面端不一致」。
6. 「模型 / 权限 / 更多」三个按钮点了没反应 → 现在用插件自绘浮层（不再用 Obsidian 原生 `Menu`）。
   先确认插件已重新加载（`main.js` 与 `styles.css` 同时更新）；仍不出现就看控制台有没有
   `[obsidian-dsh]` 报错，必要时「重新加载插件」。

### 发送提示 `session/writer-held`

DSH 的会话是单写者：同一会话不能同时被两个客户端（例如桌面端、另一个 Obsidian 窗口）持有。
Phase 0 的隐藏客户端如果订阅了正在别处使用的会话，`session.prompt` 会返回
`session/writer-held: session "..." is already owned by an active write handle`。

处理：点「＋」新建会话让这个客户端自己创建并持有会话；或先关闭占用该会话的客户端/回合再重试。
这不是桥的 bug；官方面板已删除，正常只有原生面板的隐藏客户端这一个写者。

审批 / 提问固定在输入框上方；审批卡片「允许一次 / 拒绝」直接提交，提问卡片选选项或填自定义答案后
「提交答案」。plan-review 暂未在原生面板完整支持；需要时请用桌面 DSH。

### 模型报 `Authentication Fails` / 模型和桌面端不一致

原生面板的隐藏 core 连接的是插件拉起的 dsh 进程，模型走的是 **obsidian profile 自己的配置**，与桌面端不是同一个进程。
官方面板删除后，provider / API key 只能在 profile 文件里配置，插件内没有设置表单。
如果桌面端能用、Obsidian 这边报 `Authentication Fails, Your api key: ****xxxx is invalid`，
说明 obsidian profile 还在用 base 默认的 `deepseek-official`（那条线路的 key 已失效或没配）。

把 obsidian profile 的 `cordis.patch.yml` 对齐桌面端（`$DSH_HOME/profiles/desktop/cordis.patch.yml`）：

```yaml
# ~/.dsh/profiles/obsidian/cordis.patch.yml（追加到顶层数组）
- id: llm-pi-ai
  config:
    providers:
      command-code:
        apiKeyEnv: COMMAND_CODE_API_KEY
        api: openai-responses
        baseURL: https://api.commandcode.ai/provider/v1
        models:
          - id: deepseek/deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash (latest)
            contextWindow: 1000000
            input: [text, image]
            reasoningEfforts: { off: null, low: low, high: high, max: max }
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: command-code
    model: deepseek/deepseek-v4.1-flash
    reasoningEffort: high
- id: llm-deepseek
  name: "@deepseek-ai/dsh-llm-deepseek-api-key"
  disabled: true
```

改完「重启 DSH 服务」。凭据在 `$DSH_HOME/.credentials.yaml` 的 refs 里，各 profile 共享，
不用重复填。原生模型菜单只负责**选择**已配置的 provider/model，不能填 key。

### 模型菜单是空的 / 权限菜单只有三条

- 空菜单：profile 没有可用 provider → 按上一节对齐桌面端配置。
- 权限菜单只有 Read Only / Workspace Write / Full access：0.2.x 的 `permissions` 会话投影只推
  `currentValue`，桥用内置预设兜底；切换仍由宿主 `/permission` 命令校验，返回 unknown preset
  会在错误条里显示。

## 「插件」tab 读不出清单 / 启停没生效

- **读不出清单**：tab 显示「读取失败：…」。插件是在宿侧跑 `dsh --profile <profile> --dump-config` 取**组合结果**再解析，
  常见原因：设置里选中的 dsh 不可执行（先在「dsh 版本」里确认）、profile 目录不存在、
  `$DSH_HOME/profiles/<profile>` 不可写。注意 dump 会重写该目录的 `cordis.yml`（内容恒为 `[]`，
  dsh 每次启动也这么写，**不要手改它**）。
- **启停没生效**：启停只写用户层 `cordis.patch.yml`（追加 / 修改 `disabled`），必须点「重启服务」才生效；
  行状态显示「由 dsh 决定」的 `!!js` 条件行不能在这里切换。
- **改错了想恢复**：每次写入前都会在同目录生成 `cordis.patch.yml.bak-<时间戳>`，把备份内容覆盖回
  `cordis.patch.yml` 再重启服务即可；写入后如果组合结果没按预期变化，插件会**自动回滚**并在设置页报错。
- **看不到官方面板里的「实验性插件」/ 点了没反应**：这批插件是 **optional bundle**（默认未写进 profile 的
  `dsh.profile.bundles`），所以不在组合结果里。0032 起在「插件」tab 顶部的「可选 / 实验性插件」卡片里列出并可启用：
  写入 profile 的 `package.json`（同目录生成 `package.json.bak-<时间戳>`），**必须重启服务**才真正加载。
  卡片**默认收起**（只显示「共 N 个 · 已启用 M 个」），点标题展开列表、再点收起（0034）；
  卡片显示「读取可选插件目录失败」时：确认设置里选中的 dsh 是 0.2.x 且安装里有
  `@deepseek-ai/dsh-official-bundles`；组件行清单与启停不受影响。
- **实验性插件启用后服务起不来**：把「插件」tab 里对应开关关掉再重启；或把 `package.json.bak-<时间戳>`
  覆盖回 `package.json` 后重启。实验性插件自身可能首次使用时才下载运行时（如语音输入的 SenseVoice）。

## 新会话标题一直是「新会话」/ 实验「随对话更新的标题」不生效

- 0033 起新建会话**不再** rename「新会话」：未发消息的空白会话只是 UI 占位；发消息后标题由 DSH 的标题服务接管。
- 发消息后仍不变：看会话日志（`~/.dsh/sessions/<cwd>/<id>/session.v*.jsonl.zstd`）里有没有 `session/title` 与
  `title-llm-request`。出现 `source.kind === "user"` 说明标题被显式重命名钉住（手动改名 / 旧版 0013 行为），
  DSH 对 user 标题不再自动修订，只有显式 refresh 能解钉；旧会话可手动改名，或按 0033 的非目标暂不处理。
- 「随对话更新的标题」需要：在「插件」tab 启用 → 点「重启服务」。它只替换 provider，**不会覆盖用户固定标题**。
- 面板列表不跟随：确认桥已重启（桥额外订阅了 `title` 投影）；设置页「桥接状态」应显示 v6+。

## 启用「智能体团队」后没有团队入口 / 面板是空的

0035 起原生面板支持 dsh 的 Agent Teams 插件（实验性 bundle `@deepseek-ai/dsh-experimental-agent-team-profile`，「插件」tab 里的「智能体团队」）：

1. 确认已启用：设置 → 插件 → 可选 / 实验性插件 → 打开「智能体团队」开关 → 点「重启服务」；只勾开关不重启不会生效。
2. 重启后重载插件（或重新打开面板）：团队入口只在**当前会话有 `agentTeam` 投影**时出现（标题右侧 users 图标）；空白新会话也会有一行 lead，属正常。
3. 设置页「桥接状态」应显示 **v6+**。桥版本低于 v6 时不显示团队入口，工具行与消息仍可用；更新 `packages/dsh-obsidian-bridge` 后重启服务。
4. 面板为空 / 一直「加载中」：看控制台 `[obsidian-dsh]` 与隐藏 core 的报错；确认 profile 里「智能体团队」patch 已生效（`dsh --profile obsidian --dump-config` 应出现 `agent-team` / `tool-agent-team` / `ui-agent-team`）。
5. **只读面板不能导航**：点成员不会打开其会话；队友等待授权时只能看到「等待授权」标记，处理请到 dsh 桌面端 / Web（需要面板内导航见提案 0035 的路径 C，尚未实现）。
6. 团队工具在过程行里显示中文标题（创建队友 / 发送消息 / 等待子智能体 / 团队任务 …）；如果只看到「运行代码」，说明当前会话预设走 PTC 模式，团队工具是在 `run_code` 里调用的，不是桥或渲染的问题。

## 仍然不行

按顺序采集证据再定位：状态栏文案 → 控制台 `[obsidian-dsh]` 日志 → 手动跑 dsh 的输出 → 端口/进程状态。多数问题在前两步就能定性。
