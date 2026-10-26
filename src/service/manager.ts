import { spawn, type ChildProcess } from 'child_process';
import { sleep } from '../shared/async';
import { logChild, logPlugin, logPluginError, logPluginWarn, redactToken } from '../shared/log';
import type { DshCommand, DshRuntimeInfo, Probe, ProbeResult } from '../shared/types';
import { buildSpawnEnv, inspectDshRuntime, resolveDshInstall } from './locator';
import { defaultProbe } from './probe';

/** dsh 服务配置（端口、profile、指定安装由设置页决定，运行期可能变化）。 */
export interface DshServiceConfig {
	port: number;
	profile: string;
	/** 指定使用的 dsh 安装路径；null = 自动按 locator 优先级。 */
	dshPath: string | null;
}

/** 启动 / 重启的结果：成功，或失败分类（由插件层翻译成 Notice 文案）。 */
export type DshServiceOutcome =
	| { ok: true; alreadyRunning: boolean }
	| {
			ok: false;
			reason: 'locator' | 'exited' | 'timeout' | 'occupied' | 'auth';
			exitCode?: number | null;
	  };

export interface DshServiceOptions {
	/** 每次拉起时读取最新配置（设置页可能刚改过端口 / profile / dsh 版本）。 */
	getConfig: () => DshServiceConfig;
	/** 子进程工作目录：当前 vault 的绝对路径。 */
	cwd: string;
	/** 状态文案回调（由插件写进状态条，保持本模块不依赖 Obsidian）。 */
	onStatus: (text: string) => void;
	/** 就绪探测；不传则用 fetch 兜底（只能判断「有东西在监听」）。 */
	probe?: Probe;
	/** 运行信息回调：实际使用的 dsh 路径 / 版本 / 其他版本安装（由插件层做可见提示）。 */
	onRuntime?: (info: DshRuntimeInfo) => void;
}

/** 等待端口就绪的轮询策略（40 × 500ms ≈ 20s）。 */
const READY_ATTEMPTS = 40;
const READY_INTERVAL_MS = 500;
/** 卸载时 SIGTERM 之后多久强杀。 */
const KILL_GRACE_MS = 2000;
/** 重启时等待旧进程退出的上限。 */
const STOP_TIMEOUT_MS = 3000;
/** stdout/stderr 行缓冲上限：URL 与日志都按整行处理，留余量防止跨 chunk 被截断。 */
const OUTPUT_BUFFER_LIMIT = 65536;
/** dsh 0.2.1+ 的就绪信号：`dsh web: <带 token 的 URL>`。 */
const WEB_URL_PATTERN = /dsh web: (https?:\/\/[^\s]+)/;

/**
 * dsh 服务的进程托管：探测 → 拉起 → 等待就绪 → 重启 / 停止。
 *
 * 纯 Node 逻辑，不 import Obsidian：状态文案走 onStatus 回调，探测实现走注入，
 * UI 归 view 层。就绪判定兼容两代 dsh：
 *  - 0.1.1：裸 URL 返回 200 + __ModuleLoader__（四态探测）；
 *  - 0.2.1+：裸 URL 需要 token，改从 stdout 的 `dsh web: <url>` 行拿就绪信号与承载面地址。
 *
 * 行为约束见 docs/changes/0001（稳定性）、0002（版本可见性）、0003（版本选择 + token）、0004（webview 承载）。
 */
export class DshServiceManager {
	private child: ChildProcess | null = null;
	private starting: Promise<DshServiceOutcome> | null = null;
	private readonly probe: Probe;
	/** 0.2.1+ 启动日志里的带 token URL；null 表示没有（0.1.1 或尚未就绪）。 */
	private webUrl: string | null = null;
	/** stdout / stderr 的行缓冲：抓到完整行后再做 token 打码与日志输出。 */
	private stdoutBuffer = '';
	private stderrBuffer = '';

	constructor(private readonly options: DshServiceOptions) {
		this.probe = options.probe ?? defaultProbe;
	}

	/** 服务地址（不带 token，用于探测与展示）。 */
	get url(): string {
		return 'http://127.0.0.1:' + String(this.options.getConfig().port);
	}

	/** 承载面地址：0.2.1+ 带 token（首次登录后浏览器用 cookie），其余等同 url。 */
	get embedUrl(): string {
		return this.webUrl ?? this.url;
	}

	/** 四态探测：可访问的 dsh / 需要 token 的 dsh / 端口被占用 / 没有服务。 */
	check(): Promise<ProbeResult> {
		return this.probe(this.url);
	}

	/** 端口上是否已经有可用的 dsh（面板用来决定是否显示已连接）。 */
	async isReachable(): Promise<boolean> {
		if (this.webUrl !== null && this.child !== null) return true;
		return (await this.check()) === 'running';
	}

	/** 确保服务在跑：已监听则什么都不做，否则拉起；并发调用复用同一个 Promise。 */
	start(): Promise<DshServiceOutcome> {
		if (this.starting === null) {
			this.starting = this.doStart().finally(() => {
				this.starting = null;
			});
		}
		return this.starting;
	}

	/** 重启：停掉自启进程并**等它真正退出**，再重新拉起（避免 EADDRINUSE / 误判已就绪）。 */
	async restart(): Promise<DshServiceOutcome> {
		await this.stopAndWait(STOP_TIMEOUT_MS);
		return this.start();
	}

	/** 停止插件自启的进程（插件卸载时用，不等待）；用户手动启动的实例不动。 */
	stop(): void {
		const child = this.child;
		if (child === null) return;
		this.child = null;
		this.webUrl = null;
		this.stdoutBuffer = '';
		this.stderrBuffer = '';
		child.kill('SIGTERM');
		// 兜底：2 秒后仍存活则强杀
		setTimeout(() => {
			if (!child.killed) child.kill('SIGKILL');
		}, KILL_GRACE_MS);
	}

	/** 停止并等待退出（重启用）：SIGTERM → 超时 SIGKILL → 返回是否已退出。 */
	async stopAndWait(timeoutMs = STOP_TIMEOUT_MS): Promise<boolean> {
		const child = this.child;
		if (child === null) return true;
		this.child = null;
		this.webUrl = null;
		this.stdoutBuffer = '';
		this.stderrBuffer = '';
		const exited = this.waitExit(child, timeoutMs);
		child.kill('SIGTERM');
		if (await exited) return true;
		logPlugin('dsh 未在 ' + String(timeoutMs) + 'ms 内退出，改用 SIGKILL');
		child.kill('SIGKILL');
		return this.waitExit(child, 1000);
	}

	private async doStart(): Promise<DshServiceOutcome> {
		// 已由本 manager 拉起且仍在运行：直接复用。
		// （0.2.1 的裸 URL 探测返回 auth，不能用来判断自己的子进程。）
		if (this.webUrl !== null && this.child !== null) {
			this.options.onStatus('运行中');
			return { ok: true, alreadyRunning: true };
		}
		const config = this.options.getConfig();
		const before = await this.check();
		if (before === 'running') {
			this.options.onStatus('运行中');
			// 服务已在运行（可能是上次会话遗留）：无法确认它用的哪份二进制，
			// 但可以把插件的解析结果标为「未确认」交给插件层展示，避免版本信息完全不可见。
			const resolved = resolveDshInstall(config.dshPath);
			if (resolved !== null) {
				void this.reportRuntime(resolved.install.command, this.child !== null, resolved.fallback);
			}
			return { ok: true, alreadyRunning: true };
		}
		if (before === 'auth') {
			// 0.2.1+ 的 token 是进程内生成的，插件无法接管非本次拉起的实例。
			this.options.onStatus('需手动结束');
			logPluginWarn(
				'端口 ' +
					String(config.port) +
					' 上是需要 token 的 dsh（非本次拉起），插件无法接管；请手动结束该进程后重启服务',
			);
			return { ok: false, reason: 'auth' };
		}
		if (before === 'foreign') {
			this.options.onStatus('端口被占用');
			return { ok: false, reason: 'occupied' };
		}
		const resolved = resolveDshInstall(config.dshPath);
		if (resolved === null || !this.spawnChild(resolved.install.command)) {
			this.options.onStatus('启动失败');
			return { ok: false, reason: 'locator' };
		}
		if (resolved.fallback) {
			logPluginWarn('设置里指定的 dsh 未检测到，回退到自动解析: ' + resolved.install.path);
		}
		// 版本探测放后台：不拖慢启动，结果通过 onRuntime 交给插件层做可见提示。
		void this.reportRuntime(resolved.install.command, true, resolved.fallback);
		// 若子进程提前退出（如 PATH 缺 node），立刻报错而不是干等满 20s。
		const exited = new Promise<number | null>((resolve) => {
			const child = this.child;
			if (child === null) {
				resolve(null);
				return;
			}
			child.once('exit', (code) => resolve(code));
		});
		for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
			// 0.2.1+：stdout 的 URL 行就是就绪信号（同时提供带 token 的承载面地址）。
			if (this.webUrl !== null) {
				this.options.onStatus('运行中');
				return { ok: true, alreadyRunning: false };
			}
			const now = await this.check();
			if (now === 'running') {
				this.options.onStatus('运行中');
				return { ok: true, alreadyRunning: false };
			}
			// auth / foreign：自己刚拉起的 0.2.1 在打印 URL 前，裸 URL 可能先 401（auth），
			// 前端 fallback 注册前甚至短暂 404（foreign）；两者都继续等。
			// 端口真的被别人占用时，子进程会因 EADDRINUSE 退出，由下面的 exit race 收敛；
			// 预检查阶段（spawn 前）的 foreign 仍然立刻报「端口被占用」。
			const code = await Promise.race([exited, sleep(READY_INTERVAL_MS).then(() => null)]);
			if (code !== null) {
				this.options.onStatus('启动失败(退出码 ' + String(code) + ')');
				return { ok: false, reason: 'exited', exitCode: code };
			}
		}
		this.options.onStatus('启动超时');
		// 超时后不要留一个没人管的子进程：能杀就杀掉，下次启动重新拉起。
		if (this.child !== null) this.stop();
		return { ok: false, reason: 'timeout' };
	}

	/** 用 child_process 拉起 dsh：cwd = vault，参数 = --profile / --port / --no-open。 */
	private spawnChild(resolved: DshCommand): boolean {
		const config = this.options.getConfig();
		this.webUrl = null;
		this.stdoutBuffer = '';
		this.stderrBuffer = '';
		const args = [
			...resolved.prefix,
			'--profile',
			config.profile,
			'--port',
			String(config.port),
			// 面板就在 Obsidian 里，别让 dsh 额外弹出系统浏览器标签（dsh 默认会 open）。
			'--no-open',
		];
		logPlugin('spawning ' + resolved.cmd + ' ' + args.join(' ') + ' in ' + this.options.cwd);

		let child: ChildProcess;
		try {
			child = spawn(resolved.cmd, args, {
				cwd: this.options.cwd,
				// Obsidian 从 Finder/Dock 启动时 PATH 是精简的（无 ~/.local/bin），
				// 这里把常见 bin 目录前置注入，保证 dsh 的 shebang（#!/usr/bin/env node）
				// 和 dsh 内部的子进程都能找到 node / pnpm 等工具。
				env: buildSpawnEnv(),
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			logPluginError('spawn failed', error);
			return false;
		}
		this.child = child;
		// 两类输出都先按完整行缓冲：
		//  - 抓 URL 需要整行（token 可能跨 chunk）；
		//  - token 打码也只在整行上可靠（否则 `token=` 与值被拆到两个 chunk 会漏打码）。
		child.stdout?.on('data', (data: unknown) => {
			this.stdoutBuffer += String(data);
			this.drainOutput('stdout');
		});
		child.stderr?.on('data', (data: unknown) => {
			this.stderrBuffer += String(data);
			this.drainOutput('stderr');
		});
		child.on('exit', (code) => {
			this.flushOutput();
			logPlugin('dsh exited with code ' + String(code));
			this.webUrl = null;
			if (this.child === child) this.child = null;
		});
		child.on('error', (error) => {
			logPluginError('dsh process error', error);
			this.options.onStatus('进程错误');
		});
		return true;
	}

	/** 把行缓冲里已经完整的行全部处理掉（抓 URL + 打码后转发日志）。 */
	private drainOutput(stream: 'stdout' | 'stderr'): void {
		const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
		let buffer = this[key];
		for (;;) {
			const newline = buffer.indexOf('\n');
			if (newline < 0) break;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			this.onOutputLine(stream, line);
		}
		// 防止没有换行的超长输出无限增长；URL 行自带换行，不受影响。
		if (buffer.length > OUTPUT_BUFFER_LIMIT) buffer = buffer.slice(-OUTPUT_BUFFER_LIMIT);
		this[key] = buffer;
	}

	/** 处理一行子进程输出：stdout 先尝试抓就绪 URL，再带打码转发日志。 */
	private onOutputLine(stream: 'stdout' | 'stderr', line: string): void {
		if (stream === 'stdout') this.captureWebUrlLine(line);
		logChild(stream, line);
	}

	/** 进程退出 / 停止前把没有换行的残余输出也发出去（同样经过打码）。 */
	private flushOutput(): void {
		if (this.stdoutBuffer !== '') {
			this.onOutputLine('stdout', this.stdoutBuffer);
			this.stdoutBuffer = '';
		}
		if (this.stderrBuffer !== '') {
			this.onOutputLine('stderr', this.stderrBuffer);
			this.stderrBuffer = '';
		}
	}

	/**
	 * 从一整行 stdout 里解析 0.2.1+ 的 `dsh web: <url>` 就绪信号。
	 *
	 * 必须等整行到齐再匹配：URL 行可能在 `?token=` 前后被拆成两个 chunk，
	 * 提前匹配会拿到截断的地址（丢 token），面板登录就会失败。
	 */
	private captureWebUrlLine(line: string): void {
		if (this.webUrl !== null) return;
		const match = line.match(WEB_URL_PATTERN);
		if (match === null) return;
		const url = match[1];
		if (url === undefined) return;
		this.webUrl = url;
		logPlugin('dsh 就绪信号: ' + redactToken(url));
	}

	/**
	 * 探测实际使用的 dsh 版本与其他版本的安装：写日志并通过 onRuntime 通知插件层。
	 * 失败只影响提示（服务照常运行），这里再兜一层防止回调 / 探测异常打断启动流程。
	 */
	private async reportRuntime(used: DshCommand, confirmed: boolean, fallback = false): Promise<void> {
		try {
			const info = await inspectDshRuntime(used, confirmed);
			const version = info.used.version ?? '未知';
			if (confirmed) {
				logPlugin('dsh 版本: ' + version + '（' + info.used.path + '）');
			} else {
				logPlugin(
					'服务已在运行（非本次拉起）；插件将使用 dsh ' + version + '（' + info.used.path + '）',
				);
			}
			if (info.others.length > 0) {
				logPluginWarn(
					'发现其他版本的 dsh: ' +
						info.others
							.map((install) => (install.version ?? '未知') + '（' + install.path + '）')
							.join('、') +
						'；可在设置页「dsh 版本」切换',
				);
			}
			this.options.onRuntime?.({ ...info, fallback });
		} catch (error) {
			logPluginError('dsh 版本探测失败', error);
		}
	}

	/** 等子进程退出；超时返回 false。 */
	private waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
		if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
		return new Promise((resolve) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.off('exit', onExit);
				resolve(false);
			}, timeoutMs);
			const onExit = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(true);
			};
			child.once('exit', onExit);
		});
	}
}
