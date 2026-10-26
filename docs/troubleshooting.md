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
两者版本可能不同（本机分别是 0.1.1-rc.2 与 0.2.1-alpha.2），于是出现「日志里的报错在 checkout 里搜不到」。

核对方式（M2-5 起不用再手动查）：

1. 控制台搜 `[obsidian-dsh] dsh 版本:` —— 启动后会打印**实际使用的路径与版本**；
2. 设置 → DSH in Obsidian →「运行环境」—— 显示当前 dsh 与其他版本安装；
3. 若存在版本不同的多份安装，控制台会有 `发现其他版本的 dsh` 警告，并弹一次 Notice。

处理：M2-5 起日志/设置页已经能看见实际版本；**0003 起可直接在设置页「dsh 版本」下拉切换**检测到的安装，
改完点「重启服务」即可，不需要再动安装顺序。若想彻底去掉旧版，见下面的「删除 0.1.1」。想手动对照可跑：

```bash
dsh --version
node -e "console.log(require(process.env.HOME+'/.local/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
```

> 若服务是上次遗留、本次没有重新拉起，插件无法确认它在用哪份二进制：日志会写「服务已在运行（非本次拉起）；插件将使用 dsh …」、
> 设置页标注「无法确认其版本」，点「重启服务」后才会变成确认的实际版本。

## 状态条「需手动结束」/ Notice「端口上的 dsh 需要 token」

dsh 0.2.1+ 的 Web UI 需要浏览器会话 token（启动时打印 `dsh web: http://…/?token=…`，裸 URL 返回 401）。
插件能接管**自己拉起**的 0.2.1（从 stdout 读就绪 URL），但拿不到**别的进程**的 token：

- 典型场景：上次 Obsidian 崩溃/强退，遗留的 0.2.1 还占着端口 → 插件探测到 `auth`、状态条「需手动结束」；
- 处理：`pkill -f "dsh --profile obsidian"` 结束遗留实例 → 点「重启服务」；
- 不要用「换个端口」绕，遗留实例会继续占着旧端口。

## 使用 0.2.1 / 切换 dsh 版本

1. 设置 → DSH in Obsidian →「dsh 版本」，选「自动（按优先级）」或某个检测到的安装（显示版本 + 路径）；
2. 点「重启服务」生效；设置页「运行环境」显示当前实际使用的路径/版本；
3. 0.2.1 的承载面地址带 token，只用于首次登录，随后走 cookie；重启服务后 token 会变，
   已打开的面板若空白/401 → 关掉面板再打开；
4. 显式选择某个版本后，启动时不再弹「发现其他版本」的 Notice（仍会写日志，可在「运行环境」查看）。

### 删除 0.1.1（验证 0.2.1 可用后）

```bash
# 先确认插件已经能通过设置页选择 0.2.1 并正常出面板
mv ~/.local/lib/node_modules/@deepseek-ai/dsh \
   ~/.local/lib/node_modules/@deepseek-ai/dsh.bak-0.1.1
```

然后「重启服务」：自动模式会解析到 PATH 上的 `dsh`（0.2.1）。确认无误后可删除备份
（`rm -rf ~/.local/lib/node_modules/@deepseek-ai/dsh.bak-0.1.1`）；要回滚就把备份改回原名。

## 0.2.1 面板仍 401 / 提示「不支持 webview」

dsh 0.2.1+ 的会话 cookie 是 `SameSite=Strict`，只有 webview 的独立顶层能携带；跨站 iframe 在 303 后不会带 cookie，
所以 0.2.1 面板必须走 webview。先看控制台：

- 正常：`[obsidian-dsh] 面板承载方式: webview（persist:vault-…）`；
- 异常：`[obsidian-dsh] 当前环境不支持 webview，面板回退到 iframe`，同时面板会弹一次兼容提示。

回退时处理：

1. 升级 Obsidian（当前 1.14.4 主窗口已开启 webviewTag，核心 Web viewer / Canvas 自用）；
2. 或临时在设置 →「dsh 版本」改用 0.1.1；
3. 改完重开面板（或「重启服务」后再重开）。

若控制台显示 webview 正常但页面仍 401：确认地址是插件自己拉起的实例（遗留实例拿不到 token，
见上一节「需手动结束」），并重开面板让新 token 生效。

## 状态栏「启动超时」

20s 内端口没就绪。首次启动、Cordis 树挂载慢、或某插件初始化卡住都会这样。

1. 在 vault 目录手动跑同一条命令看真实输出；
2. 若手动能起、插件不行，多半是环境差异（PATH、node 版本、cwd）—— 对比 `env`；
3. 先看日志确认是慢还是卡死，再决定是调大等待还是修依赖。

## 面板空白 / 显示 Chromium 错误页

服务刚被拉起时承载面（webview / iframe）可能已停在错误页。自 M2-1 起，只要**尚未成功加载过**，服务就绪后会自动重载一次；若仍空白，通常是已经连上过、随后端口或服务变了（0.2.1 下还包括 token 随重启失效），需要重开面板（或改端口/版本后点「重启服务」再重开）。

1. **关掉面板再打开**（最简单有效）；
2. 确认 banner 里的 URL 端口与 `data.json` 一致；
3. `curl -I http://127.0.0.1:<port>` 看服务是否真的响应。

## 状态条「端口被占用」/ Notice「端口已被其他程序占用」

插件用 Obsidian `requestUrl` 探测目标端口：能连上但**不是 dsh**（正文里没有 `__ModuleLoader__` 标记）或状态码非 200，就判定为「端口被占用」，并且**不会**去 spawn 第二个进程。

1. `lsof -nP -iTCP:<port> -sTCP:LISTEN` 看占用者；
2. 若是别的程序 → 插件设置里换端口 → 点「重启服务」；
3. 若是之前遗留的 dsh（探测无法确认归属）→ `pkill -f "dsh --profile obsidian"` 清掉，再「重启服务」。

## 端口冲突 / 起了两个 dsh

1. `lsof -nP -iTCP:<port>` 找出占用者；手动起的实例插件不会杀（设计如此）；
   - **插件重载 / Obsidian 崩溃**后，旧 dsh 可能变成孤儿继续占用端口（父进程已消失）。此时插件会探测到「运行中」并直接复用，
     不再重复拉起 —— 功能正常，但那个进程不受插件管理。需要清掉就手动结束它（`kill <pid>` 或 `pkill -f "dsh --profile obsidian"`）。
2. 结束多余进程，或在设置里改端口后点「重启服务」；
3. 文档默认端口是 **3081**，但 `data.json` 里可能是你改过的值（比如 3082）——**以 data.json 为准**。

## 改了设置但行为没变

- 端口 / profile 只在**拉起进程**时读取，改完必须点「重启服务」。
- 面板里已加载的承载面不会自己换 URL，需要重开面板。
- 若 `data.json` 被外部工具覆盖/删除，设置会回到默认值（开发期它在仓库根目录）。

## 新建 DSH 会话提示「未检测到 dsh-obsidian-bridge」

功能区/命令的新建会话依赖 dsh 侧客户端桥，不是插件内置逻辑。

1. 确认 profile 已安装：`cat ~/.dsh/profiles/obsidian/package.json` 的 `dsh.profile.bundles` 里应有 `dsh-obsidian-bridge`；
2. 没有就装：`dsh plugin --profile obsidian add link:/Users/fabler/dsh/dsh-plugin/self-made/dsh-obsidian-bridge`；
3. **重启 DSH 服务**（插件设置 → 重启服务），再重开面板（旧页面不会自己换 bundle）；
4. 设置页「桥接状态」点「重新检测」应显示「已连接（v1）」。

若承载面是 iframe（控制台有 `面板回退到 iframe`），桥不可用，只能先恢复 webview。

## 单栏模式没生效（左栏仍有 56px / 右栏还在）

单栏由 `dsh-obsidian-bridge` 强制：

- 它用 CSS 把 frame 的左右 grid 轨道归零并隐藏两列——**Web 构建里收起左栏只会留 56px 轨道**，
  只调 `toggleSidebar()` 不够；
- 右栏由 `ctx.sidebarRight.toggleExpanded()` 关，每 500ms 复查一次，手动展开会被收回；
- 检查顺序：桥是否已连接 → 页面是否 0.2.x（0.1.x 没有 `data-rightbar-col`，CSS 不匹配）→ 重开面板。
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

## 仍然不行

按顺序采集证据再定位：状态栏文案 → 控制台 `[obsidian-dsh]` 日志 → 手动跑 dsh 的输出 → 端口/进程状态。多数问题在前两步就能定性。
