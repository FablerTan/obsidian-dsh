import { execFile, type ExecFileException } from 'child_process';
import { sleep } from '../shared/async';
import { logPluginWarn } from '../shared/log';

/**
 * 端口监听进程的探测与终止（纯 Node，不 import Obsidian）。
 *
 * 用途：设置页「结束后台 dsh」。Obsidian 崩溃 / 重载后，上一轮拉起的 dsh 可能还占着
 * 配置端口（裸 URL 探测为 auth，插件无法接管）。这里只提供最小原语：
 * 「谁在监听端口」→「这个 pid 的命令行是什么」→「它是不是 dsh」→「结束它」。
 * 是否应该结束由 manager 判定（foreign 一律拒绝），本模块不做决策。
 */

/** 一条端口监听记录：pid + 命令行（读不到时为 null）。 */
export interface PortListener {
	pid: number;
	command: string | null;
}

/** 探测命令的超时：按钮点击需要快速反馈，超时按「没看到监听者」处理。 */
const PROBE_TIMEOUT_MS = 3000;
/** 终止进程的轮询间隔。 */
const POLL_INTERVAL_MS = 100;
/** SIGKILL 之后仍等待的时间。 */
const KILL_WAIT_MS = 1000;
/** 工具输出的缓冲上限。 */
const MAX_BUFFER = 1024 * 1024;

/**
 * 可执行文件候选：Obsidian 从 Finder/Dock 启动时 PATH 可能是精简的，
 * 只靠 lsof / ps 这种裸名字会 ENOENT，所以先试绝对路径再退回 PATH。
 */
const LSOF_CANDIDATES = ['/usr/sbin/lsof', '/usr/bin/lsof', '/sbin/lsof', 'lsof'];
const SS_CANDIDATES = ['ss', '/usr/sbin/ss', '/sbin/ss', '/usr/bin/ss'];
const PS_CANDIDATES = ['/bin/ps', '/usr/bin/ps', 'ps'];
const PGREP_CANDIDATES = ['/usr/bin/pgrep', '/bin/pgrep', 'pgrep'];

/** 一次外部命令的结果（不抛异常，失败信息都在字段里）。 */
interface CommandResult {
	/** 退出码为 0。 */
	ok: boolean;
	/** 数字退出码；被信号杀掉 / 启动失败时为 null。 */
	code: number | null;
	stdout: string;
	stderr: string;
	/** 启动失败的系统错误码（ENOENT = 可执行文件不存在）。 */
	errorCode: string | null;
}

/** 起一个外部命令并收敛结果；超时 / 不存在都通过字段表达，不 reject。 */
function execText(
	cmd: string,
	args: readonly string[],
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<CommandResult> {
	return new Promise((resolve) => {
		try {
			execFile(
				cmd,
				[...args],
				{ timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true },
				(error, stdout, stderr) => {
					const failure: ExecFileException | null = error;
					const rawCode: unknown = failure?.code;
					resolve({
						ok: error === null,
						code: typeof rawCode === 'number' ? rawCode : null,
						stdout: String(stdout ?? ''),
						stderr: String(stderr ?? ''),
						errorCode: typeof rawCode === 'string' ? rawCode : null,
					});
				},
			);
		} catch (error) {
			resolve({ ok: false, code: null, stdout: '', stderr: '', errorCode: errorCodeOf(error) });
		}
	});
}

/** 依次尝试候选可执行文件：第一个不是 ENOENT 的结果就是答案（都没有则 null）。 */
async function runTool(
	candidates: readonly string[],
	args: readonly string[],
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<CommandResult | null> {
	for (const candidate of candidates) {
		const result = await execText(candidate, args, timeoutMs);
		if (result.errorCode !== 'ENOENT') return result;
	}
	return null;
}

/** 系统错误码（ENOENT / ESRCH / EPERM 等）。 */
function errorCodeOf(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? code : null;
}

/** 错误文案（日志用）。 */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isValidPid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0;
}

function isValidPort(port: number): boolean {
	return Number.isInteger(port) && port > 0 && port <= 65535;
}

/** 命令失败时写一条警告（拿到 stderr 就展示它，否则展示错误码 / 退出码）。 */
function warnIfFailed(result: CommandResult, tool: string): void {
	const stderr = result.stderr.trim();
	const detail =
		stderr !== ''
			? stderr
			: (result.errorCode ?? (result.code === null ? '超时' : '退出码 ' + String(result.code)));
	logPluginWarn(tool + ' 探测失败: ' + detail);
}

/** 解析 lsof -t 输出（纯 pid 行）。 */
function parsePidLines(text: string): number[] {
	const pids = new Set<number>();
	for (const line of text.split('\n')) {
		const value = line.trim();
		if (!/^\d+$/.test(value)) continue;
		const pid = Number(value);
		if (isValidPid(pid)) pids.add(pid);
	}
	return [...pids];
}

/**
 * 解析 ss -ltnp 输出：本地地址列以 :port 结尾的行，取进程列里的 pid=NNN。
 * （按列而不是整行匹配，避免把对端端口 / 其他列误当成命中。）
 */
function parseSsPids(text: string, port: number): number[] {
	const suffix = ':' + String(port);
	const pids = new Set<number>();
	for (const line of text.split('\n')) {
		if (!line.includes(suffix)) continue;
		const fields = line.trim().split(/\s+/);
		const local = fields[3];
		if (local === undefined || !local.endsWith(suffix)) continue;
		for (const match of line.matchAll(/pid=(\d+)/g)) {
			const raw = match[1];
			if (raw === undefined) continue;
			const pid = Number(raw);
			if (isValidPid(pid)) pids.add(pid);
		}
	}
	return [...pids];
}

/**
 * 解析 Windows netstat -ano -p tcp 输出：
 * 状态列为 LISTENING、本地地址列以 :port 结尾，取最后一列 PID。
 */
function parseNetstatPids(text: string, port: number): number[] {
	const suffix = ':' + String(port);
	const pids = new Set<number>();
	for (const line of text.split('\n')) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 5) continue;
		if ((fields[0] ?? '').toUpperCase() !== 'TCP') continue;
		if ((fields[3] ?? '').toUpperCase() !== 'LISTENING') continue;
		const local = fields[1];
		if (local === undefined || !local.endsWith(suffix)) continue;
		const raw = fields[fields.length - 1];
		if (raw === undefined || !/^\d+$/.test(raw)) continue;
		const pid = Number(raw);
		if (isValidPid(pid)) pids.add(pid);
	}
	return [...pids];
}

/**
 * 列出监听指定端口的进程 PID（POSIX: lsof，缺 lsof 的 Linux 回退 ss；Windows: netstat）。
 * 任何探测失败都返回 []（不抛）：调用方会把「列不出来」当成无法识别处理。
 */
export async function listPortListenerPids(port: number): Promise<number[]> {
	if (!isValidPort(port)) {
		logPluginWarn('端口号无效: ' + String(port));
		return [];
	}
	try {
		if (process.platform === 'win32') {
			const result = await runTool(['netstat'], ['-ano', '-p', 'tcp']);
			if (result === null || !result.ok) {
				if (result !== null) warnIfFailed(result, 'netstat');
				return [];
			}
			return parseNetstatPids(result.stdout, port);
		}
		const lsof = await runTool(LSOF_CANDIDATES, [
			'-nP',
			'-iTCP:' + String(port),
			'-sTCP:LISTEN',
			'-t',
		]);
		if (lsof !== null) {
			if (lsof.ok) return parsePidLines(lsof.stdout);
			// lsof 退出码 1 = 没有匹配的监听者（正常的空结果），不算错误。
			if (lsof.code !== 1) warnIfFailed(lsof, 'lsof');
			return [];
		}
		const ss = await runTool(SS_CANDIDATES, ['-ltnp']);
		if (ss === null) {
			logPluginWarn('找不到 lsof / ss，无法探测端口 ' + String(port) + ' 的监听进程');
			return [];
		}
		if (!ss.ok) {
			warnIfFailed(ss, 'ss');
			return [];
		}
		return parseSsPids(ss.stdout, port);
	} catch (error) {
		logPluginWarn('探测端口 ' + String(port) + ' 的监听进程失败: ' + describeError(error));
		return [];
	}
}

/**
 * 用 pgrep 读命令行（ps 不可用时的兜底）：逐行匹配「<pid> <完整命令行>」。
 * 只接受行首就是这个 pid 的行，避免 pid 出现在别人的参数里时误匹配。
 */
async function readCommandViaPgrep(pid: number): Promise<string | null> {
	// macOS: -l 打印 pid + 名字、-a 把自身与祖先进程也纳入匹配（否则读不到调用者自己）、
	// -f 匹配完整命令行；procps 的 -a 是「打印完整命令行」，效果相同。
	const listArgs = ['-laf', '.'];
	const result = await runTool(PGREP_CANDIDATES, listArgs);
	if (result === null || !result.ok) return null;
	const prefix = String(pid) + ' ';
	for (const line of result.stdout.split('\n')) {
		if (!line.startsWith(prefix)) continue;
		const command = line.slice(prefix.length).trim();
		if (command !== '') return command;
	}
	return null;
}

/**
 * 读取进程的完整命令行（POSIX: ps，ps 不可用时回退 pgrep；Windows: powershell Get-CimInstance）。
 * 读不到（进程已退出 / 权限不足 / 平台命令缺失）返回 null。
 */
export async function readProcessCommand(pid: number): Promise<string | null> {
	if (!isValidPid(pid)) return null;
	try {
		if (process.platform === 'win32') {
			// 用 execFile 直接传参（不经过 shell），双引号会原样传给 -Filter。
			const script =
				'(Get-CimInstance Win32_Process -Filter "ProcessId=' + String(pid) + '").CommandLine';
			const result = await runTool(['powershell.exe'], [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				script,
			]);
			if (result === null || !result.ok) return null;
			const command = result.stdout.trim();
			return command === '' ? null : command;
		}
		const result = await runTool(PS_CANDIDATES, ['-o', 'command=', '-p', String(pid)]);
		// ps 在进程不存在时会非 0 退出且无 stdout；有输出就按命令行处理。
		const command = result?.ok === true ? result.stdout.trim() : '';
		if (command !== '') return command;
		// 受限环境（如沙箱拒绝执行 setuid 的 /bin/ps）或没有 ps 时，用 pgrep 兜底：
		// 它能给出同样的「pid + 完整命令行」，判定依据不降级。
		return readCommandViaPgrep(pid);
	} catch {
		return null;
	}
}

/** 端口上每个监听进程的命令行（读不到的 command 为 null）。 */
export async function listPortListeners(port: number): Promise<PortListener[]> {
	const pids = await listPortListenerPids(port);
	const listeners: PortListener[] = [];
	for (const pid of pids) {
		listeners.push({ pid, command: await readProcessCommand(pid) });
	}
	return listeners;
}

/**
 * 命令行是否是 dsh 的启动形态（判定「能不能安全结束」的唯一依据）。
 *
 * 必须同时满足：含 dsh（大小写不敏感）+ 某个启动形态标记。仅文件名里带 dsh 的
 * 随便什么进程（如 /tmp/fake-dsh-server.mjs）不算，避免误杀。
 */
export function looksLikeDshCommand(command: string | null): boolean {
	if (command === null) return false;
	const text = command.toLowerCase();
	if (!text.includes('dsh')) return false;
	return (
		text.includes('--profile') ||
		text.includes('dsh web') ||
		text.includes('@deepseek-ai/dsh') ||
		text.includes('bin.js')
	);
}

/** 进程是否还活着（EPERM = 存在但没权限发信号，仍算存活）。 */
export function isProcessAlive(pid: number): boolean {
	if (!isValidPid(pid)) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCodeOf(error) === 'EPERM';
	}
}

/** 给单个进程发信号：ESRCH（已退出）忽略，其余失败记警告（EPERM 等）。 */
function sendSignal(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(pid, signal);
	} catch (error) {
		if (errorCodeOf(error) === 'ESRCH') return;
		logPluginWarn(
			'向进程 ' +
				String(pid) +
				' 发送 ' +
				signal +
				' 失败: ' +
				(errorCodeOf(error) ?? describeError(error)),
		);
	}
}

/** 等这批 PID 全部退出；超时返回 false。 */
async function waitForExit(pids: readonly number[], timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + Math.max(0, timeoutMs);
	for (;;) {
		if (!pids.some(isProcessAlive)) return true;
		if (Date.now() >= deadline) return false;
		await sleep(POLL_INTERVAL_MS);
	}
}

/**
 * 结束一批进程：SIGTERM → 每 100ms 轮询 → 超时 SIGKILL → 再等最多 1s。
 * 返回**仍存活**的 PID（空数组 = 全部已结束）。绝不向插件自身进程发信号。
 */
export async function terminateProcesses(
	pids: readonly number[],
	timeoutMs = 3000,
): Promise<number[]> {
	const requested = [...new Set(pids.filter(isValidPid))];
	if (requested.length === 0) return [];
	if (requested.includes(process.pid)) {
		logPluginWarn('拒绝向插件自身进程发送信号: ' + String(process.pid));
	}
	const targets = requested.filter((pid) => pid !== process.pid && isProcessAlive(pid));
	if (targets.length > 0) {
		for (const pid of targets) sendSignal(pid, 'SIGTERM');
		if (!(await waitForExit(targets, timeoutMs))) {
			const stubborn = targets.filter(isProcessAlive);
			if (stubborn.length > 0) {
				logPluginWarn(
					'进程 ' + stubborn.map(String).join(', ') + ' 未响应 SIGTERM，改用 SIGKILL',
				);
				for (const pid of stubborn) sendSignal(pid, 'SIGKILL');
				await waitForExit(stubborn, KILL_WAIT_MS);
			}
		}
	}
	return requested.filter(isProcessAlive);
}
