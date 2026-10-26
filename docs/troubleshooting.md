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

## 面板提示「不支持 webview」/ 仍 401

dsh 0.2.x 的会话 cookie 是 `SameSite=Strict`，只有 webview 的独立顶层能携带；跨站 iframe 在 303 后不会带 cookie，
所以面板必须走 webview，**没有 iframe 回退**（0007）。先看控制台：

- 正常：`[obsidian-dsh] 面板承载方式: webview（persist:vault-…）`；
- 异常：`[obsidian-dsh] 当前环境不支持 webview，DSH 面板无法承载`，面板显示错误并弹一次 Notice。

处理：升级 Obsidian（当前 1.14.4 主窗口已开启 webviewTag，核心 Web viewer / Canvas 自用）；
没有 webviewTag 的旧版本无法使用本插件。

若控制台显示 webview 正常但页面仍 401：确认地址是插件自己拉起的实例（遗留实例拿不到 token，
见上一节「需手动结束」），并重开面板让新 token 生效。

## 状态栏「启动超时」

20s 内端口没就绪。首次启动、Cordis 树挂载慢、或某插件初始化卡住都会这样。

1. 在 vault 目录手动跑同一条命令看真实输出；
2. 若手动能起、插件不行，多半是环境差异（PATH、node 版本、cwd）—— 对比 `env`；
3. 先看日志确认是慢还是卡死，再决定是调大等待还是修依赖。

## 面板空白 / 显示 Chromium 错误页

服务刚被拉起时承载面（webview）可能已停在错误页。自 M2-1 起，只要**尚未成功加载过**，服务就绪后会自动重载一次；若仍空白，通常是已经连上过、随后端口或服务变了（0.2.x 下还包括 token 随重启失效），需要重开面板（或改端口/版本后点「重启服务」再重开）。

1. **关掉面板再打开**（最简单有效）；
2. 确认 banner 里的 URL 端口与 `data.json` 一致；
3. `curl -I http://127.0.0.1:<port>` 看服务是否真的响应。

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

- 端口 / profile 只在**拉起进程**时读取，改完必须点「重启服务」。
- 面板里已加载的承载面不会自己换 URL，需要重开面板。
- 若 `data.json` 被外部工具覆盖/删除，设置会回到默认值（开发期它在仓库根目录）。

## 新建 DSH 会话提示「未检测到 dsh-obsidian-bridge」

功能区/命令的新建会话依赖 dsh 侧客户端桥，不是插件内置逻辑。

1. 确认 profile 已安装：`cat ~/.dsh/profiles/obsidian/package.json` 的 `dsh.profile.bundles` 里应有 `dsh-obsidian-bridge`；
2. 没有就装：`dsh plugin --profile obsidian add link:<repo>/packages/dsh-obsidian-bridge`（旧外部路径先 remove）；
3. **重启 DSH 服务**（插件设置 → 重启服务），再重开面板（旧页面不会自己换 bundle）；
4. 设置页「桥接状态」点「重新检测」应显示「已连接（v2）」。

## 单栏模式没生效（左栏仍有 56px / 右栏还在）

单栏由 `dsh-obsidian-bridge` 强制：

- 它用 CSS 把 frame 的左右 grid 轨道归零并隐藏两列——**Web 构建里收起左栏只会留 56px 轨道**，
  只调 `toggleSidebar()` 不够；
- 右栏由 `ctx.sidebarRight.toggleExpanded()` 关，每 500ms 复查一次，手动展开会被收回；
- 检查顺序：桥是否已连接 → 页面是否 0.2.x（0.1.x 已不支持）→ 重开面板。
- 想临时恢复侧栏：从 profile 移除桥并重启服务（Obsidian 侧没有开关，按需求常开）。

## GUI 显示正常但布局错乱 / 侧边栏行为异常

这类表现来自外部客户端插件（`dsh-ui-obsidian-layout`）：

- 它靠 CSS Modules 哈希类名（`pI_x6G_*`）定位元素，**dsh 升级后哈希变化会失效**；
- client 半身改完走 HMR；host 半身（`lib/index.js`）改完要「重启服务」；
- 详情与实现要点见根 [README](../README.md) 的「dsh 侧依赖」一节。

## 隧道 / 公网访问被拒

dsh 默认只信任 loopback Host。通过樱花等隧道暴露时，在 dsh 侧加 `--trusted-host`。

## 移动端没有入口

插件是 `isDesktopOnly: true`（依赖 `child_process`），移动端不可安装，属预期行为。

## 原生聊天（实验）打不开 / 桥未连接

原生聊天需要一个**隐藏的官方 DSH webview** 和 bridge **v2**：

1. 确认 profile 已 link 到本仓库新路径，并重启 DSH 服务；
2. 设置页「桥接状态」应显示「已连接（v2）」；显示 v1 说明还在用旧 bridge；
3. 状态「桥版本过旧」→ 更新 `packages/dsh-obsidian-bridge` 后重启服务；
4. 状态一直停在「正在连接 DSH…」→ 看控制台 webview 是否加载、端口是否被另一个 0.2.x 实例占用；
5. 模型菜单显示「没有可用模型」→ 这是 DSH profile 侧没有可用 provider，不是桥的问题；
   见下面「模型菜单是空的 / 模型和桌面端不一致」。
6. 「模型 / 权限 / 更多」三个按钮点了没反应 → 现在用插件自绘浮层（不再用 Obsidian 原生 `Menu`）。
   先确认插件已重新加载（`main.js` 与 `styles.css` 同时更新）；仍不出现就看控制台有没有
   `[obsidian-dsh]` 报错，必要时「重新加载插件」。
7. 原生视图和官方 webview 面板**同时开**会各连一个 DSH 客户端；尽量只开一个。

### 发送提示 `session/writer-held`

DSH 的会话是单写者：同一会话不能同时被两个客户端（例如桌面端、官方面板、另一个 Obsidian 窗口）持有。
Phase 0 的隐藏客户端如果订阅了正在别处使用的会话，`session.prompt` 会返回
`session/writer-held: session "..." is already owned by an active write handle`。

处理：点「＋」新建会话让这个客户端自己创建并持有会话；或先关闭占用该会话的客户端/回合再重试。
这不是桥的 bug，原生 UI 会替代官方面板，正常只有一个写者。

审批 / 提问固定在输入框上方；审批卡片「允许一次 / 拒绝」直接提交，提问卡片选选项或填自定义答案后
「提交答案」。plan-review 暂未在原生面板完整支持，可切到官方 DSH 面板处理。

### 模型报 `Authentication Fails` / 模型和桌面端不一致

原生面板与官方面板共用同一个 dsh 进程，模型走的是 **obsidian profile 自己的配置**。
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

## 仍然不行

按顺序采集证据再定位：状态栏文案 → 控制台 `[obsidian-dsh]` 日志 → 手动跑 dsh 的输出 → 端口/进程状态。多数问题在前两步就能定性。
