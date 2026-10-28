import { spawn, type ChildProcess } from 'child_process';
import { sleep } from '../shared/async';
import { logChild, logPlugin, logPluginError, logPluginWarn, redactToken } from '../shared/log';
import type { DshCommand, DshRuntimeInfo, Probe, ProbeResult } from '../shared/types';
import { buildSpawnEnv, inspectDshRuntime, resolveDshInstall } from './locator';
import {
	listPortListenerPids,
	looksLikeDshCommand,
	readProcessCommand,
	terminateProcesses,
	type PortListener,
} from './port-dsh';

/** dsh 服务配置（端口、profile、指定安装由设置页决定，运行期可能变化）。 */
interface DshServiceConfig {
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
			reason: 'locator' | 'exited' | 'timeout' | 'occupied' | 'auth' | 'unsupported';
			exitCode?: number | null;
	  };

/**
 * 「结束后台 dsh」的结果：成功（含是否结束了本次拉起的子进程、结束了哪些 PID），
 * 或失败分类（foreign = 端口上是别的程序；unidentified = 列不出 / 认不出监听者；
 * timeout = 已发信号但端口仍被占用）。
 */
export type DshStopOutcome =
	| { ok: true; stoppedOwn: boolean; pids: number[] }
	| {
			ok: false;
			reason: 'foreign' | 'unidentified' | 'timeout';
			stoppedOwn: boolean;
			pids: number[];
			stuck?: number[];
	  };

interface DshServiceOptions {
	/** 每次拉起时读取最新配置（设置页可能刚改过端口 / profile / dsh 版本）。 */
	getConfig: () => DshServiceConfig;
	/** 子进程工作目录：当前 vault 的绝对路径。 */
	cwd: string;
	/** 状态文案回调（由插件写进状态条，保持本模块不依赖 Obsidian）。 */
	onStatus: (text: string) => void;
	/** 可信探测（由插件注入 Obsidian requestUrl 实现），用于 spawn 前的四态判定。 */
	probe: Probe;
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
/** 「结束后台 dsh」成功后等待端口释放的上限。 */
const PORT_RELEASE_MS = 3000;
/** 停掉自拉子进程后额外的端口释放宽限（系统回收监听套接字可能比进程退出慢一拍）。 */
const OWN_RELEASE_GRACE_MS = 1500;
/** 轮询端口是否已释放的间隔。 */
const PORT_POLL_INTERVAL_MS = 150;
/** stdout/stderr 行缓冲上限：URL 与日志都按整行处理，留余量防止跨 chunk 被截断。 */
const OUTPUT_BUFFER_LIMIT = 65536;
/** dsh 0.2.x 的就绪信号：`dsh web: <带 token 的 URL>`。 */
const WEB_URL_PATTERN = /dsh web: (https?:\/\/[^\s]+)/;

/** 日志里展示监听进程：pid（命令行）。 */
function describeListeners(listeners: readonly PortListener[]): string {
	return listeners
		.map(
			(listener) =>
				String(listener.pid) +
				(listener.command === null ? '（命令行不可读）' : '（' + listener.command + '）'),
		)
		.join('、');
}

/**
 * dsh 服务的进程托管：探测 → 拉起 → 等待就绪 → 重启 / 停止。
 *
 * 纯 Node 逻辑，不 import Obsidian：状态文案走 onStatus 回调，探测实现走注入，
 * UI 归 view 层。只支持 dsh 0.2.x：裸 URL 需要 token，就绪信号与承载面地址都来自
 * stdout 的 `dsh web: <url>` 行。
 *
 * 行为约束见 docs/changes/0001（稳定性）、0002（版本可见性）、0003（版本选择 + token）、
 * 0004（webview 承载）、0007（移除 0.1.1 / iframe 兼容）。
 */
export class DshServiceManager {
	private child: ChildProcess | null = null;
	private starting: Promise<DshServiceOutcome> | null = null;
	private readonly probe: Probe;
	/** 0.2.x 启动日志里的带 token URL；null 表示尚未就绪（或没有可用实例）。 */
	private webUrl: string | null = null;
	/** stdout / stderr 的行缓冲：抓到完整行后再做 token 打码与日志输出。 */
	private stdoutBuffer = '';
	private stderrBuffer = '';

	constructor(private readonly options: DshServiceOptions) {
		this.probe = options.probe;
	}

	/** 服务地址（不带 token，用于探测与展示）。 */
	get url(): string {
		return 'http://127.0.0.1:' + String(this.options.getConfig().port);
	}

	/** 承载面地址：0.2.x 带 token（首次登录后浏览器用 cookie）；未就绪时回退裸 url。 */
	get embedUrl(): string {
		return this.webUrl ?? this.url;
	}

	/** 四态探测：可访问的 dsh / 需要 token 的 dsh / 端口被占用 / 没有服务。 */
	check(): Promise<ProbeResult> {
		return this.probe(this.url);
	}

	/** 本次拉起的 0.2.x 实例是否已就绪（面板用来决定是否显示已连接）。 */
	async isReachable(): Promise<boolean> {
		return this.webUrl !== null && this.child !== null;
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

	/**
	 * 结束后台 dsh：先停本次拉起的子进程，再处理占住配置端口的遗留 dsh 实例。
	 *
	 * 只用「端口探测 + 命令行核实」判定能否安全结束：
	 *  - 探测为 foreign（端口上是别的程序）→ 一律不动，返回 reason: 'foreign'；
	 *  - 列不出 / 认不出监听进程（无 lsof、命令行不可读、命令行不像 dsh）→ 'unidentified'；
	 *  - 发了 SIGTERM/SIGKILL 但端口仍被占用 → 'timeout'（附仍存活的 pid）。
	 * 命令执行异常一律收敛成 'unidentified'，不向调用方抛。成功后不自动重启。
	 */
	async stopBackground(): Promise<DshStopOutcome> {
		let stoppedOwn = this.child !== null;
		try {
			await this.stopAndWait(STOP_TIMEOUT_MS);
			// 旧 start 可能还在等就绪信号：等它收敛，避免刚结束又被它拉起 / 误判端口状态。
			const starting = this.starting;
			if (starting !== null) await starting.catch(() => undefined);
			// start 可能在 stopAndWait 之后才 spawn 出子进程，再收一次尾。
			if (this.child !== null) {
				stoppedOwn = true;
				await this.stopAndWait(STOP_TIMEOUT_MS);
			}
			const port = this.options.getConfig().port;
			const state = await this.check();
			if (state === 'down') {
				this.options.onStatus('已结束');
				return { ok: true, stoppedOwn, pids: [] };
			}
			if (state === 'foreign') {
				logPluginWarn(
					'端口 ' + String(port) + ' 被非 dsh 程序占用；「结束后台 dsh」不会结束它',
				);
				this.options.onStatus('端口被其他程序占用');
				return { ok: false, reason: 'foreign', stoppedOwn, pids: [] };
			}
			// auth / running：端口上是 dsh（0.2.x 的 token 实例或可直接访问的旧实例）。
			const pids = await listPortListenerPids(port);
			if (pids.length === 0) {
				logPluginWarn('端口 ' + String(port) + ' 上是 dsh，但列不出监听进程（缺少 lsof？）');
				this.options.onStatus('无法结束');
				return { ok: false, reason: 'unidentified', stoppedOwn, pids: [] };
			}
			const commands = await Promise.all(pids.map((pid) => readProcessCommand(pid)));
			const verified = pids.filter((_pid, index) => looksLikeDshCommand(commands[index] ?? null));
			if (verified.length === 0) {
				const listeners = pids.map((pid, index) => ({ pid, command: commands[index] ?? null }));
				logPluginWarn(
					'端口 ' +
						String(port) +
						' 上的监听进程不像 dsh，拒绝结束: ' +
						describeListeners(listeners),
				);
				this.options.onStatus('无法结束');
				return { ok: false, reason: 'unidentified', stoppedOwn, pids };
			}
			logPlugin('结束后台 dsh（pid ' + verified.map(String).join(', ') + '）');
			const stuck = await terminateProcesses(verified);
			// 刚结束自拉进程时，系统回收监听套接字可能比进程退出慢一拍：多给 1.5s 预算
			// （总预算 3s + 1.5s，端口一空就立即返回，不会白等）。
			const releaseBudget = PORT_RELEASE_MS + (stoppedOwn ? OWN_RELEASE_GRACE_MS : 0);
			if (await this.waitPortFree(port, releaseBudget)) {
				this.options.onStatus('已结束');
				logPlugin('端口 ' + String(port) + ' 已释放');
				return { ok: true, stoppedOwn, pids: verified };
			}
			logPluginWarn(
				'端口 ' +
					String(port) +
					' 仍被占用' +
					(stuck.length > 0 ? '（未退出的 pid ' + stuck.map(String).join(', ') + '）' : ''),
			);
			this.options.onStatus('结束超时');
			return { ok: false, reason: 'timeout', stoppedOwn, pids: verified, stuck };
		} catch (error) {
			logPluginWarn(
				'结束后台 dsh 失败: ' + (error instanceof Error ? error.message : String(error)),
			);
			this.options.onStatus('无法结束');
			return { ok: false, reason: 'unidentified', stoppedOwn, pids: [] };
		}
	}

	/** 等端口不再有人监听；超时返回 false。 */
	private async waitPortFree(port: number, timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			if ((await listPortListenerPids(port)).length === 0) return true;
			if (Date.now() >= deadline) return false;
			await sleep(PORT_POLL_INTERVAL_MS);
		}
	}

	private async doStart(): Promise<DshServiceOutcome> {
		// 已由本 manager 拉起且仍在运行：直接复用。
		// （0.2.x 的裸 URL 探测返回 auth，不能用来判断自己的子进程。）
		if (this.webUrl !== null && this.child !== null) {
			this.options.onStatus('运行中');
			return { ok: true, alreadyRunning: true };
		}
		const config = this.options.getConfig();
		const before = await this.check();
		if (before === 'running') {
			// 0.2.x 的裸 URL 需要 token（探测为 auth）；能直接 200 打开的多半是 0.1.x
			// 或不带鉴权的实例，本插件不再接受。
			this.options.onStatus('版本不支持');
			logPluginWarn(
				'端口 ' +
					String(config.port) +
					' 上是可直接访问的 dsh 页面（0.1.x 或未启用 token 鉴权）；本插件只支持 0.2.x，请结束后重启',
			);
			return { ok: false, reason: 'unsupported' };
		}
		if (before === 'auth') {
			// 0.2.x 的 token 是进程内生成的，插件无法接管非本次拉起的实例。
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
			// 0.2.x 的唯一就绪信号：stdout 的 `dsh web: <url>` 行（同时提供带 token 的承载面地址）。
			if (this.webUrl !== null) {
				this.options.onStatus('运行中');
				return { ok: true, alreadyRunning: false };
			}
			// 端口被别人占用时，子进程会因 EADDRINUSE 退出，由 exit race 收敛。
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
				env: buildSpawnEnv(resolved.env),
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
	 * 从一整行 stdout 里解析 0.2.x 的 `dsh web: <url>` 就绪信号。
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
