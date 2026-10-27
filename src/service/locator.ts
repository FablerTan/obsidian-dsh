import { execFile } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DshCommand, DshInstall, DshRuntimeInfo } from '../shared/types';

/** 版本探测超时：`--version` 实测约 50ms，留足余量但不拖慢启动（探测在后台）。 */
const VERSION_TIMEOUT_MS = 3000;
/** 从 `--version` 输出里提取版本号（如 `0.2.1-alpha.2`）。 */
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
/** 全局 npm 安装的 bin.js：用 node 直跑，绕开 shebang 与 PATH。 */
const GLOBAL_BIN_JS = path.join(os.homedir(), '.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js');
/** node 候选（Obsidian 从 Finder/Dock 启动时 PATH 可能不完整）。 */
const NODE_PATHS = [path.join(os.homedir(), '.local/bin/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node'];
/** 找不到 PATH 上的 dsh 时仍保留的占位启动方式（保持历史 spawn 行为）。 */
export const PATH_DSH_PLACEHOLDER = 'dsh (PATH)';
/** dsh 绝对路径候选（按优先级）。 */
const ABSOLUTE_DSH_PATHS = [
	path.join(os.homedir(), '.local/bin/dsh'),
	'/opt/homebrew/bin/dsh',
	'/usr/local/bin/dsh',
];

/** 第一个存在的 node；都没有则交给 PATH（返回 'node'，与原有兜底一致）。 */
function findNode(): string {
	for (const candidate of NODE_PATHS) {
		if (existsSync(candidate)) return candidate;
	}
	return 'node';
}

/** 按注入后的 PATH 查找可执行文件（与 spawn 时实际使用的 PATH 一致）。 */
function findOnPath(binary: string): string | null {
	const pathValue = buildSpawnEnv().PATH;
	if (typeof pathValue !== 'string') return null;
	for (const dir of pathValue.split(path.delimiter)) {
		if (dir === '') continue;
		const candidate = path.join(dir, binary);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** realpath 失败时退回原路径（文件可能不存在）。 */
function canonicalPath(file: string): string {
	try {
		return realpathSync(file);
	} catch {
		return file;
	}
}

/** 启动方式的展示路径：node + bin.js 显示 bin.js，其余显示可执行文件本身。 */
function displayPath(command: DshCommand): string {
	const [script] = command.prefix;
	return script ?? command.cmd;
}

/**
 * 按优先级列出所有可用的 dsh 安装（去重后按解析顺序）：
 * 1. node + 全局 bin.js（绕开 shebang，PATH 不可用时也能起）；
 * 2. PATH 上的 `dsh`（插件会前置 ~/.local/bin 等目录后再查找）；
 * 3. `~/.local/bin/dsh`、`/opt/homebrew/bin/dsh`、`/usr/local/bin/dsh`。
 *
 * 同一份安装可能被多个候选命中（PATH 上的 dsh 往往就是 ~/.local/bin/dsh 的符号链接），
 * 按 realpath 去重，保留优先级最高的那条。版本字段由 probeDshVersion() 填充。
 */
export function listDshCandidates(): DshInstall[] {
	const installs: DshInstall[] = [];
	const seen = new Set<string>();
	const add = (command: DshCommand, shownPath: string): void => {
		const key =
			command.prefix.length > 0 ? canonicalPath(command.prefix[0] ?? command.cmd) : canonicalPath(shownPath);
		if (seen.has(key)) return;
		seen.add(key);
		installs.push({ command, path: shownPath, version: null });
	};

	if (existsSync(GLOBAL_BIN_JS)) add({ cmd: findNode(), prefix: [GLOBAL_BIN_JS] }, GLOBAL_BIN_JS);
	add({ cmd: 'dsh', prefix: [] }, findOnPath('dsh') ?? PATH_DSH_PLACEHOLDER);
	for (const candidate of ABSOLUTE_DSH_PATHS) {
		if (existsSync(candidate)) add({ cmd: candidate, prefix: [] }, candidate);
	}
	return installs;
}

/** 解析结果：选中的安装 + 是否因为指定路径未命中而回退到自动解析。 */
export interface ResolvedDshInstall {
	install: DshInstall;
	fallback: boolean;
}

/** 指定路径是否指向这份安装（兼容展示路径、启动命令、realpath 三种写法）。 */
function matchesPath(install: DshInstall, target: string): boolean {
	if (install.path === target || install.command.cmd === target) return true;
	return canonicalPath(install.path) === canonicalPath(target);
}

/**
 * 解析要使用的 dsh 安装。
 *
 * - `preferredPath` 为 null：自动，取 locator 候选列表的第一项（顺序与历史行为一致）；
 * - 指定了路径：在候选里精确匹配（展示路径 / 启动命令 / realpath）；未命中则回退自动，
 *   并通过 `fallback` 告知调用方（插件层会提示「已回退」）。
 */
export function resolveDshInstall(preferredPath: string | null = null): ResolvedDshInstall | null {
	const installs = listDshCandidates();
	const [first] = installs;
	if (first === undefined) return null;
	if (preferredPath === null || preferredPath === '') return { install: first, fallback: false };
	const preferred = installs.find((install) => matchesPath(install, preferredPath));
	return preferred === undefined
		? { install: first, fallback: true }
		: { install: preferred, fallback: false };
}

/** 探测某个启动方式的 dsh 版本；失败（找不到 / 超时 / 输出不含版本号）返回 null，不抛错。 */
export function probeDshVersion(command: DshCommand): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		try {
			execFile(
				command.cmd,
				[...command.prefix, '--version'],
				{ timeout: VERSION_TIMEOUT_MS, env: buildSpawnEnv(), maxBuffer: 1024 * 1024 },
				(error, stdout, stderr) => {
					if (error) {
						resolve(null);
						return;
					}
					const match = (stdout + ' ' + stderr).match(VERSION_PATTERN);
					resolve(match === null ? null : (match[0] ?? null));
				},
			);
		} catch {
			resolve(null);
		}
	});
}

/**
 * 解析「实际使用的 dsh」并探测版本：返回启动方式、展示路径、版本，以及版本不同的其他安装。
 *
 * 供 manager 写启动日志、插件层做可见提示（版本冲突时不再静默用旧版）。
 * 探测失败只影响提示内容，不影响服务启动。
 */
export async function inspectDshRuntime(
	usedCommand: DshCommand,
	confirmed = true,
): Promise<DshRuntimeInfo> {
	const installs = listDshCandidates();
	const versions = await Promise.all(installs.map((install) => probeDshVersion(install.command)));
	const resolved: DshInstall[] = installs.map((install, index) => ({
		...install,
		version: versions[index] ?? null,
	}));
	const used =
		resolved.find(
			(install) =>
				install.command.cmd === usedCommand.cmd &&
				install.command.prefix.join(' ') === usedCommand.prefix.join(' '),
		) ?? {
			command: usedCommand,
			path: displayPath(usedCommand),
			version: await probeDshVersion(usedCommand),
		};
	// used.version 未知时不做比较，避免把「探测失败」误报成「版本冲突」。
	const others = resolved.filter(
		(install) =>
			install !== used && used.version !== null && install.version !== null && install.version !== used.version,
	);
	return { used, others, confirmed };
}

/**
 * 构建子进程环境：继承现有 env，并把常见 bin 目录前置到 PATH。
 * Obsidian 从 Finder/Dock 启动时 PATH 是精简的，需要兜底 node / pnpm 等工具。
 */
export function buildSpawnEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...(process.env ?? {}) };
	const extraPath = [
		path.join(os.homedir(), '.local/bin'),
		'/opt/homebrew/bin',
		'/usr/local/bin',
	].filter((dir) => existsSync(dir));
	const existingPath = typeof env.PATH === 'string' ? env.PATH : '';
	env.PATH = [...extraPath, existingPath].filter(Boolean).join(':');
	return env;
}
