---
status: done            # draft | approved | done | rejected
created: 2026-10-26
approved: 2026-10-26    # 用户 2026-10-26 指示「继续 M2.5」，按 AGENTS.md 规则 12 的例外视为已批准
scope: src/service, src/shared, src/settings, src/main.ts
issue: M2-5 locator 会静默优先使用过期的全局安装，日志看不出实际用的是哪份 dsh
---

# 0002 M2-5：locator 版本可见性

> 状态：**已批准（2026-10-26）**。用户当轮明确要求继续 M2.5，按 [AGENTS.md](../../AGENTS.md) 规则 12
> 的例外「用户当轮已明确指定要改的具体项」直接实施；如对下文的取舍有异议可回退重做。

## 1. 背景与问题

[roadmap](../roadmap.md#m2-稳定性优先) 的 M2-5 是 M2 唯一遗留项：

- [src/service/locator.ts](../../src/service/locator.ts) 的解析顺序是
  **node + `~/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js` → PATH `dsh` → 绝对路径候选**。
  只要全局安装的 `bin.js` 存在，它就永远优先命中，PATH 上更新的开发 checkout 不会被考虑。
- 本机实测：全局安装 `0.1.1-rc.2`，`~/.local/bin/dsh` 是指向开发 checkout 的符号链接（`0.2.1-alpha.2`）。
  插件启动后实际跑的是 0.1.1-rc.2，但日志只有一行 `spawning node .../bin.js ...`，
  **版本号完全不可见**，排查时容易把 checkout 里不存在的报错误当成 checkout 的 bug。
- 影响：问题定位慢、升级后误以为插件没生效；[troubleshooting](../troubleshooting.md) 目前只能让人手动
  `cat package.json` + `dsh --version` 去对。

## 2. 目标与非目标

- 目标（即 roadmap 的验收标准）：
  1. 启动日志里打印**实际使用的 dsh 路径与版本**；
  2. 存在多份版本不同的 dsh 时给出**可见提示**（而不是静默用旧版）；
  3. 不改变解析顺序、不改变现有状态条文案与启动时序（版本探测在后台，不阻塞 spawn）。
- 非目标：
  - 不自动改选「最新版本」、不新增「手动指定 dsh 路径」设置（改动大且容易引入不可预期的行为，
    留给后续按需提案）；
  - 不探测「已在运行、但非本次拉起」的实例版本（插件无法可靠得知它用的哪份二进制，设置页会明确说明）；
  - 不引入任何运行时依赖。

## 3. 方案

### 方案 A（推荐，已实施）

1. **locator 提供可复用的探测能力**（纯 Node，仍不依赖 Obsidian）：
   - `listDshCandidates()`：按现有优先级列出所有可用安装，按 `realpath` 去重
     （PATH 上的 `dsh` 与 `~/.local/bin/dsh` 是同一份时只算一份），每条带展示路径；
   - `probeDshVersion(command)`：`execFile(cmd, [...prefix, '--version'])`，3s 超时，
     从 stdout/stderr 提取 `x.y.z[-pre]`；失败返回 `null`，**绝不抛错、不影响启动**；
   - `inspectDshRuntime(usedCommand)`：返回实际使用的安装 + 版本不同的其他安装（others）。
   - `resolveDshCommand()` 改为复用 `listDshCandidates()` 的第一项，**解析顺序与结果保持原样**。
2. **manager**：spawn 成功后异步调用 `inspectDshRuntime()`（不 await，不拖慢启动），
   写两行日志 —— `dsh 版本: 0.1.1-rc.2（.../bin.js）`；有冲突时再写一条警告日志
   （新增 `logPluginWarn`，`console.warn` 级别）；通过新增的 `onRuntime` 回调把结果交给插件层。
3. **插件层（main.ts）**：保存运行信息；版本冲突时**每次插件加载只弹一次 Notice**
   （列出当前版本与其他版本，指向设置页）；设置页新增「运行环境」小节，
   显示实际路径 + 版本 / 其他版本安装，便于 Notice 消失后复查。

### 方案 B（备选，不选）

自动选「版本最高」的那份。版本号不代表兼容性（开发 checkout 可能是半成品），
且解析结果会随机器状态漂移，排查更困难。

### 方案 C（备选，不选）

只改日志、不做 UI 提示。完全满足「日志可见」但不满足「版本冲突可见提示」，
用户不开控制台仍然不知道用的是旧版。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 新增 `DshCommand`（从 locator 迁入，避免 settings 反向依赖 service）、`DshInstall`、`DshRuntimeInfo` |
| `src/service/locator.ts` | 新增 `listDshCandidates()` / `probeDshVersion()` / `inspectDshRuntime()`；`resolveDshCommand()` 复用候选列表（行为不变） |
| `src/service/manager.ts` | spawn 后异步探测版本：写路径/版本日志 + 冲突警告，新增 `onRuntime` 回调 |
| `src/main.ts` | 保存 `DshRuntimeInfo`；冲突时一次性 Notice；实现 `getRuntimeInfo()` 给设置页 |
| `src/settings/tab.ts` | `SettingsHost` 增加 `getRuntimeInfo()`；新增「运行环境」小节 |
| `src/shared/log.ts` | 新增 `logPluginWarn()` |
| `docs/changes/README.md`、`docs/changes/0002-...` | 登记提案 + 实施记录 |
| `docs/roadmap.md`、`architecture.md`、`development.md`、`troubleshooting.md`、`README.md` | 标记 M2-5 完成、补版本探测与提示的说明，并修正 README 里写反的解析顺序 |

## 5. 行为变化

- 启动日志新增（值取本机实测示例）：
  `[obsidian-dsh] dsh 版本: 0.1.1-rc.2（/Users/.../.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js）`
  以及存在其他版本时的警告日志。
- 存在版本不同的多份安装时：插件加载/重启服务后弹**一次** Notice，提示当前版本与其他版本，
  并指向设置页「运行环境」。
- 设置页新增「运行环境」：显示实际路径与版本、其他版本安装。
- 解析顺序、spawn 参数、状态条文案、就绪等待时序**均不变**；版本探测在后台，
  不增加启动耗时（`--version` 实测约 50ms）。

## 6. 风险与回滚

| 风险 | 影响 | 回滚方式 |
|---|---|---|
| `--version` 在某个安装上挂住 | 版本信息为「未知」，日志少一行；有 3s 超时，不阻塞启动 | 回调与探测都在后台；停用该安装或调大/调小超时 |
| 每次启动多一次 Notice | 有冲突的机器每次加载都会看到提示 | 提示只在冲突时出现；不想要可改 main.ts 一处 |
| 后台探测抛出未处理异常 | 控制台报错 | 探测内部全部 try/catch + `null` 返回，manager 再包一层 try/catch |
| 运行中的实例无法确认版本 | 日志/设置页标为「未确认」，只展示插件解析结果 | 点「重启服务」即可转为确认（`confirmed: true`） |

## 7. 验证

自动化：

```bash
npm run build        # tsc + esbuild 必须无错误
# service 层冒烟：打包 locator 后直接看解析结果/版本/冲突
./node_modules/.bin/esbuild src/service/locator.ts --bundle --platform=node --format=esm --outfile=/tmp/locator-m25.mjs
node -e "import('/tmp/locator-m25.mjs').then(async (m) => { const used = m.resolveDshCommand(); console.log(used, m.listDshCandidates(), await m.inspectDshRuntime(used)); })"
```

验收标准（本机应看到）：

1. `resolveDshCommand()` 仍返回 `{ cmd: 'node', prefix: [.../bin.js] }`（顺序未变）；
2. `inspectDshRuntime()` 的 `used.version = 0.1.1-rc.2`，`others` 含 `0.2.1-alpha.2`（/`~/.local/bin/dsh`）；
3. 用 `HOME=/tmp/fakehome` + 伪造两份不同版本的安装，能分别复现「有冲突」与「无冲突（others 为空）」；
4. Obsidian 里重新加载插件 → 控制台出现 `dsh 版本: ...` 与冲突警告 → 弹出一次 Notice →
   设置页「运行环境」显示路径/版本；重启服务后不重复弹 Notice；
5. 无冲突时（临时移除旧安装）不弹 Notice、设置页只显示当前 dsh。

## 8. 需要你拍板

- [x] 是否继续 M2-5：用户 2026-10-26 明确「继续 M2.5」，按规则 12 例外视为已批准。
- [ ] 本次选择「保持解析顺序 + 可见提示」，未自动改用 PATH 上的新版本；如果你希望插件直接优先用
      PATH 上的 `dsh`（或增加「手动指定 dsh 路径」设置），需要另起提案调整。
- [ ] 冲突提示采用「每次插件加载弹一次 Notice + 设置页常驻」，如果你更希望只写日志/设置页，
      可以去掉 Notice（改 `main.ts` 一处）。

## 9. 实施记录

**2026-10-26 实施完成**（方案 A）。

| 项 | 实际改动 | 验证 |
| --- | --- | --- |
| locator | `shared/types.ts` 新增 `DshCommand` / `DshInstall` / `DshRuntimeInfo`；`locator.ts` 新增 `listDshCandidates()`（realpath 去重）、`probeDshVersion()`（`execFile` + 3s 超时 + 失败返回 `null`）、`inspectDshRuntime()`；`resolveDshCommand()` 改为复用候选列表首项，解析结果不变 | 本机实测：used = 0.1.1-rc.2（全局 bin.js），others = 0.2.1-alpha.2（~/.local/bin/dsh） |
| manager | spawn 成功后 `void reportRuntime()` 后台探测（不 await）；日志 `dsh 版本: …` + 冲突警告；新增 `onRuntime` 回调 | 不阻塞启动；`tsc` 通过 |
| 插件层 | main 保存运行信息、冲突时弹一次 Notice（10s）；设置页新增「运行环境」；`shared/log.ts` 新增 `logPluginWarn()` | `npm run build` 通过，新字符串已进产物 |
| 文档 | roadmap / architecture / development / troubleshooting / README 同步；修正 README 里写反的解析顺序 | 相对链接与锚点自查通过 |

验证结果：

- `npm run build` 通过（tsc + esbuild）；`main.js` 连续两次构建 sha256 一致（可复现）。
- locator 冒烟（本机）：`resolveDshCommand()` 仍返回 `{ cmd: '/opt/homebrew/bin/node', prefix: ['.../bin.js'] }`（解析顺序未变）；
  `inspectDshRuntime()` 的 `used.version = 0.1.1-rc.2`、`others` 含 `0.2.1-alpha.2`（`~/.local/bin/dsh`）。
- 伪造 HOME 三场景：两份不同版本（9.9.9 vs 1.2.3）→ `others` 一条；只有一份（2.0.0）→ `others` 为空；
  `--version` 失败 → `version = null`、`others` 为空（不误报冲突）。
- **待在 Obsidian 里人工确认**：Notice 文案/时机、设置页「运行环境」渲染、重启服务后不重复弹 Notice。

偏差与说明：

- 版本探测**不缓存**（每次 spawn 都探测，约 50ms/份、后台执行）：避免用户升级 dsh 后仍显示旧版本。
- 未自动改用「更新」的安装，也未新增手动路径设置 —— 保持解析顺序（按提案非目标，另起提案才动）。
- **实施中补充**：服务已在运行（非本次拉起）时也做同样的后台探测，但以 `confirmed: false` 标记，
  日志写「服务已在运行…插件将使用 dsh …」、设置页注明「无法确认其版本；插件解析结果：…」，
  Notice 用「插件将使用」而不是「当前使用」。这不违反非目标（不探测运行中实例），只是让遗留实例场景下
  版本信息也不至于完全不可见；点「重启服务」后转为 `confirmed: true`。
  `confirmed` 的判定用「本 manager 的 child 是否存活」：自己 spawn 的进程再次被 `start()` 命中时仍算确认，
  只有遗留 / 手动启动（child 为 null）才标未确认（独立验证发现并已修正）。
- 独立验证（verifier）结论：构建可复现、真实/伪造 HOME 冒烟、分层与文案回归、文档一致性均通过；
  其指出的 `confirmed` 语义问题、architecture 目录树「纯函数」注释、README 末尾换行、AGENTS 解析顺序
  均已在本记录写定前修正并重新构建。

可选后续（未做，不在本次范围）：

- 若希望插件直接优先 PATH 上的 dsh，或支持「手动指定 dsh 路径」设置，另起提案。
- 无任何 dsh 安装时，`listDshCandidates()` 仍会加入占位 `{ cmd: 'dsh' }`，`resolveDshCommand()` 因此不为 null，
  manager 的「无法定位」分支不可达，实际会 spawn ENOENT 并等满 20s 报「启动超时」——改动前即如此
  （原实现也无条件返回 `{ cmd: 'dsh' }`），不是本次回归；建议后续单独清理：仅 `findOnPath` 命中时才加入。
