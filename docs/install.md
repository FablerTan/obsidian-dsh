# 安装指南（给 agent）

一份**照着执行就能装好**的指南：从零到「状态栏 `DSH: 运行中` + 原生聊天面板可用」。
读者是 AI agent 或照做的人；每步都有可直接复制的命令、可点选的 GUI 操作与**成功判据**。

- **两条路线，先选一条**：
  - **A 只装插件产物**（推荐普通用户）：不拿源码、不装 Node 构建工具链，从 GitHub Release 下载 `main.js` / `manifest.json` / `styles.css` 放进 vault 插件目录即可。
  - **B 源码构建**（开发 / 改代码）：clone 仓库 → `npm ci` → `npm run build` → 符号链接进 vault。
- **平台**：macOS + zsh（Windows / Linux 未验证）；插件 `isDesktopOnly: true`，**移动端不可用**。
- **只管安装**：开发环境、构建细节、手动回归见 [development.md](development.md)；出问题先看第 11 节，再查 [troubleshooting.md](troubleshooting.md)。
- **事实来源**：默认值取自 `src/settings/schema.ts` 的 `DEFAULT_SETTINGS`，清单取自 `manifest.json`，进程与可执行文件解析取自 `src/service/`；文档与代码冲突时以代码为准。
- **本机已核对**（2026-10-28）：插件 1.0.0、桥 0.5.0（API v8）、dsh 0.2.1-rc.3、Obsidian 1.14.4。

> **铁律**：任何一步的成功判据不满足，就停下按第 11 节处理；**不要**跳过、不要靠换端口掩盖、不要手改产物。

## 0. 先选路线

| | **A 只装插件产物** | **B 源码构建** |
|---|---|---|
| 适合谁 | 只想用插件 | 要改代码 / 跟最新提交 |
| 需要 Git / Node 构建工具链 | **不需要** | 需要（Node ≥ 20、npm） |
| 插件文件从哪来 | GitHub Release 里的构建产物 | 仓库里 `npm run build` 生成 |
| 桥从哪来 | Release 里的 `dsh-obsidian-bridge.zip` | 仓库 `packages/dsh-obsidian-bridge/` |
| 落位方式 | 三个文件直接放进 `<vault>/.obsidian/plugins/dsh-native-chat/` | 符号链接（或复制产物） |
| 更新插件 | 重新下载覆盖文件 | `git pull` + `npm run build` |
| 需要仓库全部代码 | **不需要** | 需要 |

两条路线**共同的部分**：dsh 0.2.x、`obsidian` profile、模型接入、桥、在 Obsidian 里启用、验收。
下文每节都标了适用范围；**没标的对两条路线都一样**。

## 1. 变量

先把变量改成实际路径，后面所有命令都假定它们已生效（新开终端要重新设）：

```bash
export VAULT="$HOME/path/to/vault"                 # 目标 vault（建议用测试库，不要用主力库）
export PLUGIN_DIR="$VAULT/.obsidian/plugins/dsh-native-chat"
export DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"       # 与 dsh 一致：环境变量优先，否则 ~/.dsh
export PROFILE="$DSH_HOME_DIR/profiles/obsidian"
export PORT=3081                                   # 默认端口；data.json 改过就以实际值为准

export VERSION="v1.0.0"                            # 仅 A：要装的插件版本（= Release tag）
export BRIDGE_DIR="$HOME/.local/share/dsh-native-chat/bridge-$VERSION"   # 仅 A：桥解压位置
export REPO="$HOME/path/to/obsidian-dsh"           # 仅 B：仓库 checkout
```

> 自定义 `DSH_HOME` 的情况：Obsidian 从 Finder 启动时读不到 shell 环境，插件会退回 `~/.dsh`。要么让 Obsidian 进程也能看到该变量，要么别改。

## 2. 前置条件

| 项 | A | B | 要求 | 验证 |
|---|---|---|---|---|
| macOS | 必需 | 必需 | 桌面端（Windows / Linux 未验证） | `uname -s`（期望 `Darwin`） |
| Obsidian | 必需 | 必需 | ≥ 1.7.2、桌面端、带 `webviewTag`（1.14.4 已验证） | `defaults read /Applications/Obsidian.app/Contents/Info.plist CFBundleShortVersionString` |
| dsh | 必需 | 必需 | **0.2.x** 且可执行；0.1.x 会被判「版本不支持」 | `dsh --version` |
| pnpm | 必需 | 必需 | `dsh plugin` 把参数转发给 pnpm，缺了报 `pnpm was not found` | `pnpm -v` |
| Node.js | 必需（dsh 以 node 运行） | 必需（构建 + 运行） | 构建 ≥ 20；运行 dsh 需满足它的 `engines.node`（以实际安装的 `package.json` 为准） | `node -v` |
| npm | 不需要 | 必需 | 构建用，只装 devDependencies | `npm -v` |
| curl / unzip | 必需 | 不需要 | macOS 自带，用于下载与解压 | `which curl unzip` |
| Git | 不需要 | 必需 | 用于 clone 仓库 | `git --version` |
| 端口 | 必需 | 必需 | `$PORT` 空闲（默认 3081，避开 web profile 的 3080） | `lsof -nP -iTCP:"$PORT" -sTCP:LISTEN`（无输出 = 空闲） |

```bash
node -v && pnpm -v
dsh --version                                                # 期望 0.2.x
defaults read /Applications/Obsidian.app/Contents/Info.plist CFBundleShortVersionString
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN                          # 期望无输出
which curl unzip                                             # 仅 A
```

**成功判据**：`node -v` ≥ v20、`pnpm -v` 有版本、`dsh --version` 匹配 `^0\.2\.`、Obsidian ≥ 1.7.2、端口无监听；A 路线另外要 `curl`、`unzip` 可用。

## 3. 安装 dsh 0.2.x

先看现状（幂等，可重复执行）：

```bash
dsh --version
ls -l "$HOME/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js" "$HOME/.local/bin/dsh" 2>/dev/null
```

**情况 A：已经能跑 0.2.x** → 记下它的真实路径，跳到第 4 节。

**情况 B：用 npm 装到 `~/.local`**（命中插件解析的第 1 顺位，不依赖 shell PATH）：

```bash
npm install -g --prefix "$HOME/.local" @deepseek-ai/dsh@0.2
"$HOME/.local/bin/dsh" --version          # 期望 0.2.x
```

**情况 C：已有 0.2.x checkout**（如 `$HOME/path/to/deepseek-harness`）→ 做符号链接（命中第 3 顺位）：

```bash
export DSH_CHECKOUT="$HOME/path/to/deepseek-harness"    # 换成你的 checkout
ln -sfn "$DSH_CHECKOUT/apps/cli/lib/bin.js" "$HOME/.local/bin/dsh"
"$HOME/.local/bin/dsh" --version          # 期望 0.2.x
```

**成功判据**：`dsh --version`（或 `"$HOME/.local/bin/dsh" --version`）输出 `0.2.x`。

> **解析顺序（关键）**：插件的 `resolveDshInstall()` 依次尝试
> ① `node` + `~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`
> → ② PATH 上的 `dsh`
> → ③ `~/.local/bin/dsh`、`/opt/homebrew/bin/dsh`、`/usr/local/bin/dsh`。
> **①存在就优先**，所以机器上残留的 0.1.x 全局安装会盖住新的 0.2.x —— 装完必须在第 9 节核对控制台 `[dsh-native-chat] dsh 版本:`，必要时在设置页「dsh 版本」显式选中 0.2.x 的条目（写入 `data.json` 的 `dshPath`）再「重启服务」。
> 另外 `node` 必须能被 Obsidian 的进程环境找到：插件先试 `~/.local/bin/node`、`/opt/homebrew/bin/node`、`/usr/local/bin/node`，都没有才用裸 `node`。用 nvm 时建议补一条 `ln -sfn "$(command -v node)" "$HOME/.local/bin/node"`。

## 4. 确认 / 创建 obsidian profile

目标：`$PROFILE/package.json` 的 `dsh.profile.bundles` 同时包含 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`。

```bash
cat "$PROFILE/package.json" 2>/dev/null || echo "profile 不存在"
```

**情况 A：已存在** → 只检查 `bundles` 是否含这两个官方 bundle；**不要**为了补字段重跑创建命令（见下），确需重建时先问用户。

**情况 B：不存在** → 从官方 `web` 模板创建（`--dump-config` 只打印组合结果、不启动服务）：

```bash
dsh --profile obsidian --from-default-profile web --dump-config >/dev/null
cat "$PROFILE/package.json"
```

**成功判据**：

- `bundles` 为 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]`；
- 目录里有 `cordis.patch.yml`（顶层是 YAML 数组 `[]`）与 `pnpm-workspace.yaml`；
- 组合结果能识别 web-app：

```bash
dsh --profile obsidian --dump-config | grep -c "patched by @deepseek-ai/dsh-web-app"   # 期望 ≥ 1
```

> **不要**用 `dsh plugin --profile obsidian add ...` 首次建 profile：未初始化时它只写入 `DEFAULT_PROFILE_BUNDLES`（仅 `@deepseek-ai/dsh-base`），**缺 `dsh-web-app`**，隐藏 core 加载不出 Web GUI。
> **不要**用 `dsh plugin` / pnpm 安装 `@deepseek-ai/dsh-web-app`：官方 bundle 随 dsh 安装提供，注册表上的 `0.0.1-rc.1` 与 0.2.x 不兼容，会被 dsh 直接拒装（实测）。
> `--from-default-profile` 会**替换**同名 profile（删依赖与用户 patch），只用于「不存在」或用户确认重建。

## 5. 模型接入（与桌面端一致）

目标：原生面板底部显示 `DeepSeek V4.1 Flash (latest) · High`，发送不报 `Authentication Fails`。
`obsidian` profile 的模型配置是独立的：base 默认走 `deepseek-official`，那条线路的 key 往往不可用。

先查现状：

```bash
grep -n -E "llm-pi-ai|agent-default-model|llm-deepseek|command-code" "$PROFILE/cordis.patch.yml"
grep -c "COMMAND_CODE_API_KEY" "$DSH_HOME_DIR/.credentials.yaml"     # 期望 ≥ 1；不要打印文件内容
```

已经对齐（`llm-pi-ai` + `agent-default-model` + `llm-deepseek` 禁用）→ 跳到第 6 节。
否则**先备份再追加**（改用户配置前先确认；文件里已有 `llm-pi-ai` 条目时**不要**追加第二条，改为合并 `providers` 或停下来问用户）：

```bash
cp "$PROFILE/cordis.patch.yml" "$PROFILE/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M%S)"
# 若文件只有注释（解析成 null），先补一行 [] 再追加，否则会变成多文档 YAML 解析失败
cat >> "$PROFILE/cordis.patch.yml" <<'YAML'
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
YAML
```

**成功判据**：

```bash
dsh --profile obsidian --dump-config | grep -c -E "command-code|deepseek-v4.1-flash"   # 期望 ≥ 2
tail -n +1 "$PROFILE/cordis.patch.yml" | head -3                                      # 顶层仍是数组（- id: ...）
```

重启服务（第 9 节）后：模型菜单出现该模型、底部标签为 `DeepSeek V4.1 Flash (latest) · High`、发送不报 `Authentication Fails`。

> 凭据在 `$DSH_HOME_DIR/.credentials.yaml` 的 refs 里，**各 profile 共享**，不需要复制密钥；**不要改凭据**，缺 `COMMAND_CODE_API_KEY` 时停下问用户。
> patch 的 `config` 是**整体替换**而非合并：重复写同一个 `id` 会覆盖整段配置。`llm-deepseek` 的 `disabled: true` 只是隐藏内置 DeepSeek API 密钥线路，凭据本身保留。

## 6. 拿到插件文件

两条路线二选一：**6A** 直接下载构建产物（不碰源码），**6B** 从源码构建。

### 6A 下载构建产物（不需要仓库）

插件在 Obsidian 里只需要三个文件：`main.js`、`manifest.json`、`styles.css`（`versions.json` 可选，便于核对版本）。
它们由维护者用 `npm run build` 构建并挂在 GitHub Release 上。

```bash
export BASE="https://github.com/FablerTan/obsidian-dsh/releases/download/$VERSION"

# 安全护栏：目标已存在且是符号链接 → 说明这是 B 路线的源码安装，不要往仓库里写文件
if [ -L "$PLUGIN_DIR" ]; then
  echo "注意：$PLUGIN_DIR 是指向仓库的符号链接（源码安装），请走 6B 更新，不要用 6A 覆盖"; exit 1
fi

mkdir -p "$PLUGIN_DIR"
for f in main.js manifest.json styles.css versions.json; do
  curl -fL --retry 3 --retry-delay 2 "$BASE/$f" -o "$PLUGIN_DIR/$f"
done
ls -l "$PLUGIN_DIR"
grep -m1 "version" "$PLUGIN_DIR/manifest.json"     # 期望 "1.0.0"
```

**成功判据**：

- 三个文件都存在且非空（`main.js` 约 330 KB，`styles.css` 约 70 KB）；
- `manifest.json` 里 `"id": "dsh-native-chat"`、`"version": "1.0.0"`、`"isDesktopOnly": true`；
- `PLUGIN_DIR` 就是 `<vault>/.obsidian/plugins/dsh-native-chat`（目录名与插件 id 一致，避免多版本混淆）。

> 不想用 Release 时，可用同版本的 tag 直接取文件（等价的兜底）：
> `curl -fL "https://raw.githubusercontent.com/FablerTan/obsidian-dsh/$VERSION/main.js" -o "$PLUGIN_DIR/main.js"`（`manifest.json` / `styles.css` 同理）。
> **不要**把 `src/`、`node_modules/`、`package.json` 拷进插件目录：Obsidian 只认产物，多拷东西只会让升级/排障混乱。
> `data.json` **不用手工创建**：插件首次启用后会自己写。

### 6B 源码构建

```bash
git clone https://github.com/FablerTan/obsidian-dsh.git "$REPO"   # 已有 checkout 可跳过
cd "$REPO"
npm ci            # 按 package-lock 装 devDependencies；postinstall 会幂等安装 pre-commit 钩子
npm run build     # tsc -noEmit -skipLibCheck + esbuild → 重新生成 main.js
npm run check     # 版本三处一致 / 无运行时依赖 / 类型 / main.js 与源码一致
```

**成功判据**：三条命令退出码均为 0；`main.js` 的修改时间变新；`npm run check` 无报错。

装进 vault（开发期推荐符号链接，改代码 / 重新构建后「重新加载插件」即生效）：

```bash
mkdir -p "$VAULT/.obsidian/plugins"
# 安全护栏：目标已存在且不是符号链接 → 停下来问用户，不要覆盖别人的插件副本
if [ -e "$PLUGIN_DIR" ] && [ ! -L "$PLUGIN_DIR" ]; then
  echo "已存在真实目录：$PLUGIN_DIR —— 停下来问用户"; exit 1
fi
ln -sfn "$REPO" "$PLUGIN_DIR"
ls -ld "$PLUGIN_DIR"                    # 期望：… -> $REPO
ls "$PLUGIN_DIR/main.js" "$PLUGIN_DIR/manifest.json" "$PLUGIN_DIR/styles.css"
```

不想用符号链接（只在本机用、不开发）时，改为复制三件套：

```bash
mkdir -p "$PLUGIN_DIR"
cp "$REPO/main.js" "$REPO/manifest.json" "$REPO/styles.css" "$PLUGIN_DIR"/
cp "$REPO/versions.json" "$PLUGIN_DIR"/          # 可选
```

**成功判据**：`ls -ld` 指向仓库（符号链接）或三件套存在（复制）；`manifest.json` 里 `id=dsh-native-chat`、`name=DSH Native Chat`、`minAppVersion=1.7.2`、`isDesktopOnly=true`。

> **符号链接安装时，插件目录就是本仓库**：Obsidian 会把运行时设置写到 `$REPO/data.json`（开发期它出现在仓库根）。这是**运行时数据**，不要当源码改、不要提交。
> 默认值来自 `DEFAULT_SETTINGS`：端口 `3081`、profile `obsidian`、`autoStart: true`、`dshPath: null`、流式刷新 `frame`。
> 若 `data.json` 里端口被改过（例如 3088），**以它为准**，把本文的 `$PORT` 换成实际值。

## 7. 安装 dsh 侧桥 dsh-obsidian-bridge

桥是 dsh 侧的客户端插件（本仓库 `packages/dsh-obsidian-bridge/`，API v8），负责给原生面板提供会话 / 流式 / 上下文 / 命令 / 团队 / 子智能体 / 目标条数据。**装插件不装桥，面板会提示「未检测到 dsh-obsidian-bridge」**。

### 7A 从 Release 解压（配合 6A）

```bash
mkdir -p "$BRIDGE_DIR"
curl -fL --retry 3 "$BASE/dsh-obsidian-bridge.zip" -o /tmp/dsh-obsidian-bridge.zip
unzip -oq /tmp/dsh-obsidian-bridge.zip -d "$BRIDGE_DIR"
grep -m1 "name" "$BRIDGE_DIR/package.json"        # 期望 "dsh-obsidian-bridge"
dsh plugin --profile obsidian add "link:$BRIDGE_DIR"
```

### 7B 从仓库 link（配合 6B）

```bash
cd "$REPO"
dsh plugin --profile obsidian add "link:$REPO/packages/dsh-obsidian-bridge"
```

**共同成功判据**（两条路线都一样）：

```bash
node -e "const p=require(process.argv[1]);console.log(JSON.stringify({bundles:p.dsh.profile.bundles,deps:p.dependencies},null,2))" "$PROFILE/package.json"
ls -l "$PROFILE/node_modules/dsh-obsidian-bridge"     # 期望指向 BRIDGE_DIR 或仓库里的 packages/…
dsh --profile obsidian --dump-config | grep -x "# == dsh-obsidian-bridge"   # 有输出
```

- `bundles` 里出现 `dsh-obsidian-bridge`，`dependencies` 里是 `link:` 绝对路径；
- 组合结果里有桥的 bundle 分组；
- **装完还没生效**：必须在设置页点「重启服务」（第 9 节）。

> 若 profile 之前 link 的是别的路径（旧外部仓库、旧版本解压目录），先 `dsh plugin --profile obsidian remove dsh-obsidian-bridge` 再 `add`，否则 link 指向不存在的目录。
> `dsh plugin` 依赖 pnpm（第 2 节）。它**会初始化不存在的 profile**（只带 dsh-base），所以第 4 节必须在前。
> 以后改 `packages/dsh-obsidian-bridge/lib/client.js` 由 HMR 自动生效；改它的 `package.json` / `cordis.patch.yml` 需要「重启服务」。

## 8. 在 Obsidian 内启用插件（需要人操作 GUI）

这一步必须在 Obsidian 里点，**不要**手改 `community-plugins.json` / `app.json` 代做（除非用户明确要求且 Obsidian 已退出）。

1. 启动 / 重启 Obsidian，打开目标 vault（`$VAULT`）。
2. 设置 → **第三方插件** → 已安装 → 找到 **DSH Native Chat** → 打开开关（首次需先关闭受限模式 / Restricted mode）。
3. 列表里没有它：确认 `$PLUGIN_DIR/manifest.json` 存在，然后重开设置页或重启 Obsidian。

**成功判据**（全部满足）：

- 设置页左侧出现 **DSH Native Chat**，顶部 5 个 tab：服务 / dsh 版本 / 聊天 / 集成 / 插件；
- 状态栏出现 `DSH: …`（初始占位；`autoStart` 默认 true，随后会拉起服务）；
- 命令面板（`Cmd+P`）能搜到 **打开 DeepSeek Harness** 与 **重启 DSH 服务**（命令 id：`dsh-native-chat:open-dsh-view`、`dsh-native-chat:restart-dsh-service`）；
- 左侧功能区出现 DSH 鲸鱼图标（提示「打开 DeepSeek Harness」）。

## 9. 首次打开与重启服务

**首次打开**：点状态栏 `DSH:` / 鲸鱼图标 / 命令面板「打开 DeepSeek Harness」→ 右栏出现原生聊天面板。`autoStart` 为 true 时 Obsidian 启动就会拉起服务，打开面板也会触发一次 `ensureStarted`。

**重启服务**（改端口 / profile / dsh 版本 / patch / 桥之后必须做）：设置 → DSH Native Chat →「服务」→ 点「重启」；或命令面板「重启 DSH 服务」。

**成功判据**（按顺序核对）：

1. 状态栏 `DSH: 运行中`。启动过程**没有**单独的「启动中」文案，会短暂停在 `DSH: …`；约 20s 未就绪会变「启动超时」。
2. 端口有监听且只有一个 dsh：
   ```bash
   lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
   pgrep -fl "dsh --profile obsidian"
   ```
3. 裸 URL 返回 **401**（0.2.x 需要浏览器 token，属正常；返回 200 反而说明不是 0.2.x）：
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/"
   ```
4. 控制台（`Cmd+Opt+I`）有 `[dsh-native-chat] dsh 版本: 0.2.x（<路径>）`、`[dsh-native-chat] 面板承载方式: webview（persist:dsh-obsidian）`；`[dsh]` 日志里 token 显示为 `token=***`（不应出现明文）。
5. 设置 →「服务」：端口 / Profile `obsidian` / 自动启动开；「dsh 版本」→「运行环境」显示当前路径与版本（与服务在跑时一致）。
6. 设置 →「集成」→「桥接状态」点「重新检测」→ `已连接（v8）`（需原生面板已打开）。
7. 面板出现会话列表或空态，右上 ＋ 能新建会话（cwd = vault）。
8. 重启服务后：Notice `DSH 服务已重启`，状态栏回到 `DSH: 运行中`，已打开的面板自动用新 token 重载（没重载就关掉面板再打开）。

## 10. 验收清单

| # | 项 | 通过判据 |
|---|---|---|
| 1 | 插件文件 | A：`$PLUGIN_DIR` 下 `main.js` / `manifest.json` / `styles.css` 齐全；B：符号链接指向仓库 |
| 2 | 服务状态 | 状态栏 `DSH: 运行中` |
| 3 | 进程与端口 | `lsof -nP -iTCP:$PORT -sTCP:LISTEN` 只有一条；裸 URL 返回 401 |
| 4 | dsh 版本 | 控制台 `[dsh-native-chat] dsh 版本: 0.2.x（…）` |
| 5 | 承载方式 | 控制台 `面板承载方式: webview（persist:dsh-obsidian）` |
| 6 | 桥 | 设置 →「集成」→ 桥接状态 `已连接（v8）` |
| 7 | 会话 | 面板能列会话 / 空态，＋ 新建后可直接输入；会话 cwd 是 vault |
| 8 | 流式 | 发送后用户消息立即出现，Assistant 正文 / 思考**流式**更新；停止有效 |
| 9 | 上下文占用 | 发送按钮左侧出现上下文占用圆环（hover 显示百分比） |
| 10 | 模型 | 底部标签 `DeepSeek V4.1 Flash (latest) · High`；发送不报 `Authentication Fails` |
| 11 | 权限 | 权限 chip 可用（三档兜底），`danger-full-access` 弹二次确认 |
| 12 | 重启 | 命令「重启 DSH 服务」→ Notice `DSH 服务已重启`，面板自动恢复 |
| 13 | 清理 | 禁用插件后自启进程退出（`lsof` 无输出）；用户手动起的实例不会被杀（预期） |
| 14 | 团队（可选） | 设置 → 插件 → 可选 / 实验性插件 → 启用「智能体团队」→ 重启服务 → 新会话标题右侧出现 users 图标；只读面板能看 roster / 任务板 |
| 15 | 仓库检查（仅 B） | `npm run check` 通过 |

## 11. 失败矩阵

先固定三件证据：**状态栏文案**、**控制台 `[dsh-native-chat]` / `[dsh]` 日志**、**端口与进程状态**。

```bash
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN      # 端口是否被监听
pgrep -fl "dsh --profile obsidian"       # 有没有 dsh 进程、端口是否对
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/"
```

| 现象（状态栏 / 控制台 / 终端） | 最可能原因 | 处理 | 参考 |
|---|---|---|---|
| A：`curl: (22) … 404` / 下载失败 | `VERSION` 写错、Release 未发布或资产改名 | 打开 Releases 页核对 tag 与资产名；或退回 tag 的 raw 地址（6A 兜底） | 本文 6A |
| A：启用后设置页没有「DSH Native Chat」 | 目录里缺 `manifest.json` / 目录名不对 / 受限模式没关 | 核对 `$PLUGIN_DIR` 三个文件；关闭 Restricted mode 后重开设置页 | 本文 6A / 8 |
| A：面板提示「未检测到 dsh-obsidian-bridge」 | 桥没装 / 装的是旧版本 / 装完没重启 | 按 7A 解压并 `link:` → 「重启服务」→ 打开面板 →「重新检测」 | 本文 7A |
| B：`npm ci` / `npm run build` 失败 | Node 版本不满足 / 依赖损坏 | 确认 `node -v`，删 `node_modules` 重装；不要手改产物 | [development](development.md#前置条件) |
| B：`npm run check` 报 main.js 与源码不一致 | 改了源码没重新构建 | `npm run build` 后重跑；禁止手改 `main.js` | [development](development.md#构建与产物) |
| `DSH: 启动失败` + Notice「无法定位 dsh 可执行文件」 | 四个候选位置都没有 dsh | 按第 3 节装 / 建链；或在设置页「dsh 版本」选检测到的安装 | [troubleshooting](troubleshooting.md#状态栏启动失败-notice无法定位-dsh-可执行文件) |
| `DSH: 启动失败(退出码 N)`，日志有 `profile "xxx" does not exist` | 设置里的 profile 名不存在 | 建 profile（第 4 节）或把 Profile 改回 `obsidian` | [troubleshooting](troubleshooting.md#状态栏启动失败退出码-n) |
| 同上，日志报 `cordis.patch.yml must be a top-level YAML array` | patch 文件只有注释、解析成 `null` | 在文件末尾补一行 `[]`，保留注释，再「重启服务」 | [troubleshooting](troubleshooting.md#每次都启动失败退出码-1且日志提到-cordispatchyml) |
| `DSH: 启动失败(退出码 N)`，日志有 `EADDRINUSE` / 缺依赖 / 找不到模块 | 端口被占 / dsh 安装不完整 / profile bundles 缺失 | 换端口或结束占用进程；重装 dsh；检查 profile 的 `package.json` | [troubleshooting](troubleshooting.md#状态栏启动失败退出码-n) |
| `DSH: 需手动结束` + Notice 要给 `pkill` | 端口上是**上次遗留**的 0.2.x（拿不到它的 token） | `pkill -f "dsh --profile obsidian"` 后点「重启服务」；不要靠换端口绕过 | [troubleshooting](troubleshooting.md#状态条需手动结束-notice端口上的-dsh-需要-token) |
| `DSH: 版本不支持` | 端口上是 0.1.x / 无 token 鉴权的实例 | 结束旧实例，在「dsh 版本」选 0.2.x 后重启 | [troubleshooting](troubleshooting.md#使用-02x--切换-dsh-版本) |
| `DSH: 端口被占用` | 端口上有别的程序（或无法确认归属的 dsh） | `lsof` 找占用者；换端口或结束它，再「重启服务」 | [troubleshooting](troubleshooting.md#状态条端口被占用-notice端口已被其他程序占用) |
| `DSH: 启动超时`（约 20s 未就绪） | 首次启动 / Cordis 挂载慢 / 某插件卡住 | 在 vault 里手动跑同一条命令看真实输出；不要盲目调大等待 | [troubleshooting](troubleshooting.md#状态栏启动超时) |
| 日志里的报错在「你以为的 dsh」里搜不到 | 实际用的是另一份安装（第 1 顺位旧版优先） | 核对控制台 `dsh 版本:` 与「运行环境」，在「dsh 版本」显式选中 0.2.x | [troubleshooting](troubleshooting.md#跑起来的-dsh-不是你以为的那份) |
| 面板空白 / 一直「正在连接 DSH…」 | 隐藏 core 停在错误页 / 旧 token | 关掉面板再打开；确认端口可 `curl`；设置页「重启服务」 | [troubleshooting](troubleshooting.md#原生面板空白--一直正在连接-dsh) |
| 面板提示「不支持 webview」 | Obsidian 内核没开 `webviewTag` | 升级 Obsidian（1.14.4 已验证），没有 iframe 回退 | [troubleshooting](troubleshooting.md#原生聊天提示不支持-webview-仍-401) |
| 设置页桥接状态「未检测到 dsh-obsidian-bridge」 | 桥没装 / 装完没重启 / 面板没打开 | 第 7 节重新 link → 「重启服务」→ 打开面板 →「重新检测」 | [troubleshooting](troubleshooting.md#新建-dsh-会话提示未检测到-dsh-obsidian-bridge) |
| 回复不流式（正文整段出现） | 桥版本过旧（< v3） | 重新 link 仓库里的桥并重启服务；桥接状态应为 v8 | [troubleshooting](troubleshooting.md#回复不是流式运行中不出现正文--思考) |
| 发送报 `Authentication Fails` / 模型与桌面端不一致 | profile 还在用 base 默认的 `deepseek-official` | 按第 5 节对齐 `llm-pi-ai` + `agent-default-model` + 禁用 `llm-deepseek`，重启 | [troubleshooting](troubleshooting.md#模型报-authentication-fails--模型和桌面端不一致) |
| 模型菜单是空的 | profile 没有可用 provider | 同上一行；原生 UI 不能填 API key | [troubleshooting](troubleshooting.md#模型菜单是空的--权限菜单只有三条) |
| 「插件」tab 读不出清单 / 启停没生效 | dsh 不可执行、profile 不存在或不可写；启停后没重启 | 先在「dsh 版本」确认 dsh，再检查目录权限；改动后「重启服务」 | [troubleshooting](troubleshooting.md#插件tab-读不出清单--启停没生效) |
| 改了端口 / profile / 版本但行为没变 | 这些只在**拉起进程**时读取 | 点「重启服务」；必要时关掉原生面板再打开 | [troubleshooting](troubleshooting.md#改了设置但行为没变) |
| 发送提示 `session/writer-held` | 同一会话被桌面端 / 另一窗口持有 | 面板内 ＋ 新建会话；或先结束占用方的回合 | [troubleshooting](troubleshooting.md#发送提示-sessionwriter-held) |
| 起了两个 dsh / 端口冲突 | 手动起的实例插件不会杀；重载后可能有孤儿 | 清掉多余进程或换端口；只清 `--profile obsidian` 的遗留实例 | [troubleshooting](troubleshooting.md#端口冲突--起了两个-dsh) |
| 启用「智能体团队」后没有入口 | bundle 没启用 / 没重启 / 桥 < v6 | 设置 → 插件 → 启用「智能体团队」→ 重启服务 → 重开面板 | [troubleshooting](troubleshooting.md#启用智能体团队后没有团队入口--面板是空的) |

## 12. 更新、卸载与回滚

### 更新插件

| 路线 | 操作 | 生效方式 |
|---|---|---|
| A | 改 `VERSION` 后重跑 6A（覆盖三个文件），桥同步重跑 7A（新目录 + `remove`/`add` 或直接 `add link:` 新路径） | 设置 → 第三方插件 → 关闭再打开插件；或重启 Obsidian |
| B | `cd "$REPO" && git pull && npm ci && npm run build` | Obsidian 里「重新加载插件」；改过 `manifest.json` 则重启 Obsidian |

> A 路线升级前先确认 `$PLUGIN_DIR` **不是**符号链接（6A 的护栏会自动拦）。覆盖前可先 `cp -a "$PLUGIN_DIR" "$PLUGIN_DIR.bak-$(date +%Y%m%d)"` 留档。

### 从 0.6.x 升级到 1.0.0（插件 id 变更）

1.0.0 起插件 id 从 `obsidian-dsh` 改为 `dsh-native-chat`（社区目录要求 id 不含 obsidian），**安装目录也要改成同名**，否则 Obsidian 会把旧目录当成另一个插件；命令 id（`dsh-native-chat:…`）与控制台前缀（`[dsh-native-chat]`）随之变化。

| 安装方式 | 操作 |
|---|---|
| B 符号链接 | 删旧链接再建新链接：`rm "$VAULT/.obsidian/plugins/obsidian-dsh"` → `ln -sfn "$REPO" "$PLUGIN_DIR"`（`$PLUGIN_DIR` 现在指向 `dsh-native-chat`）→ `npm run build` |
| A Release | 按 [6A](#6a-下载构建产物不需要仓库) 把 1.0.0 重新装进 `$PLUGIN_DIR`；先在 Obsidian 里禁用旧插件，再 `rm -rf` 旧目录（先确认它不是符号链接） |

- **设置不会自动迁移**：`data.json` 留在旧插件目录里；要保留端口 / profile / @ 与 / 范围等设置，先把旧目录的 `data.json` 复制到新目录再启用。符号链接安装的 `data.json` 在仓库根，不受影响。
- **桥不用重装**：`dsh-obsidian-bridge` 仍是 0.5.0 / API v8；重载插件后点「重启服务」即可，设置页「桥接状态」应为 `已连接（v8）`。
- 升级后核对：设置页左侧名称为 `DSH Native Chat`（设置页内容区不再重复插件名）、命令 id `dsh-native-chat:open-dsh-view` / `dsh-native-chat:restart-dsh-service`、控制台前缀 `[dsh-native-chat]`（info 日志走 `console.debug`，开发者工具需切到 Verbose 级别才可见）。

### 卸载与回滚

| 目标 | 操作 | 注意 |
|---|---|---|
| 停用插件 | 设置 → 第三方插件 → 关掉「DSH Native Chat」 | 自启进程会退出；端口释放见下 |
| 移除 vault 安装（符号链接） | `[ -L "$PLUGIN_DIR" ] && rm "$PLUGIN_DIR"` | **只删链接，不会删仓库**；不要用 `rm -rf` |
| 移除 vault 安装（真实目录，A 或复制） | `rm -rf "$PLUGIN_DIR"` | 先确认它**不是**符号链接 |
| 移除桥 | `dsh plugin --profile obsidian remove dsh-obsidian-bridge` → 「重启服务」 | `bundles` 会自动移除该项；A 路线可再删 `$BRIDGE_DIR` |
| 回滚 profile patch | `cp "$PROFILE"/cordis.patch.yml.bak-<时间戳> "$PROFILE/cordis.patch.yml"` → 「重启服务」 | 设置页写 patch 时也会生成 `.bak-<时间戳>` |
| 回滚模型接入 | 删除第 5 节追加的 `llm-pi-ai` / `agent-default-model` / `llm-deepseek` 条目，或恢复备份 | 同一 `id` 重复写会整体覆盖，恢复时注意别留半截 |
| 重置插件设置 | 删除 `data.json` 后「重新加载插件」 | 端口 / profile / 范围设置全部回到默认；**先问用户** |
| 删除整个 profile | `rm -rf "$PROFILE"` | 连同会话与配置一起删除；**先问用户** |
| 释放端口 | 退出 / 禁用插件后 `pkill -f "dsh --profile obsidian"` | 只清遗留实例；用户手动起的其他 dsh 不要动 |
| 回滚 dsh 版本 | 设置页「dsh 版本」改回「自动」或选另一份 →「重启服务」 | 插件只支持 0.2.x |
| 回滚插件代码（仅 B） | `git -C "$REPO" checkout -- <文件>` 后 `npm run build` | 不要用旧 `main.js` 配新源码 |

## 13. agent 执行约定

### 可以自动化（直接执行并自查）

- **A**：第 1 / 2 / 3 / 4 / 5 / 6A / 7A 步的全部命令——下载产物、校验 manifest、解压桥、`dsh plugin … add`、`--dump-config` 校验。全程不需要仓库与构建工具链。
- **B**：第 6B 步的 clone / `npm ci` / `build` / `check` / 符号链接；以及 `dsh plugin … add`。
- 验收里的机器可判定项：`lsof`、`curl`（401）、`pgrep`、`package.json` / `cordis.patch.yml` / `data.json` 的读取与比对。
- 读日志：终端命令与 dsh 自身输出可直接读；**Obsidian 的控制台需要人看**，或用 [obsidian-cdp.md](obsidian-cdp.md) 接 CDP 后代读。

### 需要人操作（Obsidian GUI）

- 启用 / 禁用插件、「重启服务」、「重新检测」、看状态栏与面板、发消息验收、启用可选 / 实验性 bundle。
- 重启 Obsidian 本体（改 `manifest.json` 后需要）。

### 必须停下来问用户（先别动手）

| 场景 | 原因 |
|---|---|
| 目标 profile 已存在且要重建（`--from-default-profile`） | 会删除该 profile 的依赖与用户 patch |
| `$PLUGIN_DIR` 已存在且**不是**符号链接（A 路线要覆盖时） | 会覆盖用户已有的插件副本 / 另一个仓库 |
| 要改 `$DSH_HOME_DIR/.credentials.yaml` | 里面是密钥；本指南不改凭据 |
| `cordis.patch.yml` 已有 `llm-pi-ai` 条目 | patch 的 `config` 整体替换，合并方式会影响其他模型线路 |
| 要改端口 | 默认 3081 是与 web profile（3080）并存的约定值，改动影响共存 |
| 服务正在跑、要进行「重启服务」 | 会中断进行中的回合 |
| 要安装 0.2.x 以外的 dsh / 往 profile 塞非 0.2.x 插件 | 插件与桥只支持 0.2.x |
| 要删 `data.json`、profile、会话或 vault 内文件 | 不可恢复 |

### 禁止动作

| 禁止 | 原因 |
|---|---|
| 手改 `main.js` | 构建产物；`npm run check` 会比对构建结果 |
| 把 `src/` / `node_modules/` / `package.json` 拷进插件目录 | 插件只用三件套产物，多余文件只会干扰升级与排障 |
| 手改 `$PROFILE/cordis.yml` | dsh 每次启动都重写为 `[]`，改了也会被覆盖 |
| 用 pnpm / `dsh plugin` 安装 `@deepseek-ai/dsh-web-app` | 官方 bundle 随 dsh 提供；注册表版本与 0.2.x 不兼容，会被拒装 |
| 往 profile 里加非 0.2.x 组件 | 桥依赖 0.2.x 的内部服务，会降级或起不来 |
| `pkill -f dsh` 或杀用户手动起的实例 | 插件只该管自己 spawn 的进程；只清 `--profile obsidian` 的遗留实例，且先 `pgrep -fl` 确认 |
| 用换端口绕过「需手动结束」 | 遗留实例仍占着旧端口，问题不会消失 |
| 对符号链接 `rm -rf` | 会删掉链接指向的真实内容；先用 `[ -L ]` 判断 |
| 改 / 删 / 提交 `data.json` | 运行时数据，不是源码 |
| 在主力 vault 里开发 | 官方建议单独测试库 |
| 连续重试同一条失败命令 | 先按第 11 节定位，再执行 |

### 失败后要带回的证据

状态栏文案 → 控制台 `[dsh-native-chat]` 与 `[dsh]` 最后 20 行 → `lsof` / `pgrep` 输出 → `dsh --version` 与实际路径 → 逐步执行的命令与返回码。
先修环境（dsh / profile / 端口 / 桥），**不要**为了绕过安装问题去改代码或换端口。

## 相关文档

| 需要什么 | 去哪 |
|---|---|
| 前置条件、构建、安装到 vault、调试、改动地图、手动回归 | [development.md](development.md) |
| 起不来 / 面板空白 / 端口冲突 / PATH / 模型报错 | [troubleshooting.md](troubleshooting.md) |
| 服务生命周期、进程解析与 PATH、webview 分区、配置持久化 | [architecture.md](architecture.md) |
| 桥的 API、激活方式、限制 | [packages/dsh-obsidian-bridge/README.md](../packages/dsh-obsidian-bridge/README.md) |
| 插件清单（id / 名称 / 版本 / minAppVersion） | [manifest.json](../manifest.json) |
| 目录约定、版本三处一致、禁止手改产物 | [AGENTS.md](../AGENTS.md) |
| 文档索引 | [docs/README.md](README.md) |
| 用户视角的快速开始 | [README.md](../README.md) |
