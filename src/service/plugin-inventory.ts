import { execFile } from 'child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
	DshCommand,
	DshPluginBundle,
	DshPluginInventory,
	DshPluginRow,
	DshPluginRowState,
} from '../shared/types';
import { buildSpawnEnv, probeDshVersion } from './locator';

/**
 * dsh 插件清单（0031）。
 *
 * 数据来源是 `dsh --profile <profile> --dump-config` 的**组合结果**：它把
 * profile 的 bundle 叠加（dsh-base → dsh-web-app → 第三方 bundle → 用户 patch）算好后
 * 打印成 YAML，我们只做「按 `# ==` 分段 + 按缩进取顶层条目」的最小解析，
 * 不在插件里复刻 dsh 的组合逻辑（避免与 dsh 版本漂移）。
 *
 * 注意：dump-config 会重写 profile 的 `cordis.yml`（内容恒为 `[]`，dsh 每次启动也这么写），
 * 因此要求 `$DSH_HOME/profiles/<profile>` 可写 —— 桌面端 Obsidian 本来就有写权限。
 */

/** dump-config 超时：实测 0.3–1s，留足余量但不让设置页卡住。 */
const DUMP_TIMEOUT_MS = 15000;
/** 组合结果约 45KB（≈196 行），上限给足。 */
const DUMP_MAX_BUFFER = 16 * 1024 * 1024;
/** 清单缓存：切 tab / 重绘时复用，避免每次都 spawn；写操作后会主动失效。 */
const CACHE_TTL_MS = 15000;

export interface PluginInventoryOptions {
	/** 实际使用的 dsh 启动方式（与 service/locator 解析结果一致）。 */
	command: DshCommand;
	profile: string;
	/** spawn 的 cwd（dump-config 不依赖它，传 vault 保持与服务启动一致）。 */
	cwd: string;
	/** 跳过缓存（「重新读取」与写完复验用）。 */
	refresh?: boolean;
}

interface CacheEntry {
	key: string;
	at: number;
	value: DshPluginInventory;
}

let cache: CacheEntry | null = null;

/** 清空清单缓存（启停成功 / 重启服务后调用）。 */
export function clearPluginInventoryCache(): void {
	cache = null;
}

/** `$DSH_HOME`：与 dsh 一致，环境变量优先，否则 `~/.dsh`。 */
export function resolveDshHome(): string {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
	return path.join(os.homedir(), '.dsh');
}

/** profile 目录：`$DSH_HOME/profiles/<profile>`。 */
export function profileDirOf(profile: string, dshHome: string = resolveDshHome()): string {
	return path.join(dshHome, 'profiles', profile);
}

/** 用户层 patch 文件：`$DSH_HOME/profiles/<profile>/cordis.patch.yml`。 */
export function profilePatchPath(profile: string, dshHome: string = resolveDshHome()): string {
	return path.join(profileDirOf(profile, dshHome), 'cordis.patch.yml');
}

/** 读取并解析当前 profile 的组合插件清单（带 15s 缓存）。 */
export async function readPluginInventory(options: PluginInventoryOptions): Promise<DshPluginInventory> {
	const profileDir = profileDirOf(options.profile);
	const patchPath = path.join(profileDir, 'cordis.patch.yml');
	const key = [
		options.command.cmd,
		options.command.prefix.join(' '),
		profileDir,
		// patch 被外部改动时（用户手改 / 另一个窗口），缓存要失效。
		String(safeMtime(patchPath)),
	].join('\u0000');
	if (options.refresh !== true && cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
		return cache.value;
	}

	const [dump, version] = await Promise.all([runDumpConfig(options), probeDshVersion(options.command)]);
	const bundles: DshPluginBundle[] = parsePluginDump(dump, patchPath).map((parsed) => ({
		name: parsed.name,
		version: readBundleVersion(parsed.name, profileDir, options.command),
		rows: parsed.rows,
	}));
	const value: DshPluginInventory = {
		profile: options.profile,
		profileDir,
		patchPath,
		dshVersion: version,
		bundles,
		readAt: Date.now(),
	};
	cache = { key, at: Date.now(), value };
	return value;
}

/** patch 文件的 mtime（不存在为 0）；用于让缓存感知外部改动。 */
function safeMtime(file: string): number {
	try {
		return existsSync(file) ? Math.trunc(statSync(file).mtimeMs) : 0;
	} catch {
		return 0;
	}
}

/** 跑 `dsh --profile <profile> --dump-config`，返回组合后的 YAML 文本。 */
function runDumpConfig(options: PluginInventoryOptions): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const args = [...options.command.prefix, '--profile', options.profile, '--dump-config'];
		try {
			execFile(
				options.command.cmd,
				args,
				{
					cwd: options.cwd,
					timeout: DUMP_TIMEOUT_MS,
					env: buildSpawnEnv(options.command.env),
					maxBuffer: DUMP_MAX_BUFFER,
				},
				(error, stdout, stderr) => {
					if (error !== null) {
						const tail = (stderr !== '' ? stderr : stdout).trim().split('\n').slice(-3).join(' ');
						reject(new Error('读取 dsh 插件清单失败：' + (tail === '' ? error.message : tail)));
						return;
					}
					resolve(stdout);
				},
			);
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

/** 解析结果里的一个 bundle 段。 */
export interface ParsedPluginBundle {
	name: string;
	rows: DshPluginRow[];
}

/**
 * 解析 dump-config 输出（纯函数，可单独冒烟）。
 *
 * - `# == <bundle>` / `# == <bundle>, patched by <layer>` 标记每段来源；
 * - 只取顶层条目（行首 `- id:`），config 里的嵌套 preset 行、`group: true` 的分组行都不是插件；
 * - 同一 id 在后续层再次出现时按「原地覆盖」处理：沿用原 bundle 与顺序，只更新状态与来源标记。
 */
export function parsePluginDump(text: string, userPatchPath: string): ParsedPluginBundle[] {
	const bundles = new Map<string, DshPluginRow[]>();
	const rowsById = new Map<string, DshPluginRow>();
	let bundleName: string | null = null;
	let patchedBy: string | null = null;
	let current: DshPluginRow | null = null;

	for (const line of text.split('\n')) {
		if (line.startsWith('# == ')) {
			const header = line.slice(5).trim();
			const marker = ', patched by ';
			const at = header.indexOf(marker);
			bundleName = at === -1 ? header : header.slice(0, at).trim();
			patchedBy = at === -1 ? null : header.slice(at + marker.length).trim();
			current = null;
			continue;
		}
		if (bundleName === null) continue;

		const item = /^- id: (.+)$/.exec(line);
		if (item !== null) {
			const id = (item[1] ?? '').trim();
			if (id === '') continue;
			const existing = rowsById.get(id);
			if (existing !== undefined) {
				current = existing;
				if (isUserPatch(patchedBy, userPatchPath)) existing.fromUserPatch = true;
			} else {
				current = {
					id,
					name: id,
					state: 'on',
					fromUserPatch: isUserPatch(patchedBy, userPatchPath),
				};
				rowsById.set(id, current);
				const rows = bundles.get(bundleName);
				if (rows === undefined) bundles.set(bundleName, [current]);
				else rows.push(current);
			}
			continue;
		}
		if (current === null) continue;

		// 只认顶层条目的直接字段（缩进 2）；config 里的嵌套内容缩进 ≥ 4，不参与解析。
		const field = /^ {2}([A-Za-z]+):(.*)$/.exec(line);
		if (field === null) continue;
		const key = field[1] ?? '';
		const value = (field[2] ?? '').trim();
		if (key === 'name' && value !== '') {
			current.name = unquoteYaml(value);
		} else if (key === 'disabled') {
			current.state = parseDisabled(value);
		}
	}

	const result: ParsedPluginBundle[] = [];
	for (const [name, rows] of bundles) {
		// 分组行（cordis:group）只承载子行，不是可启停的插件；与 dsh 的 inventory 口径一致。
		const plugins = rows.filter((row) => row.name !== 'cordis:group');
		result.push({ name, rows: plugins });
	}
	return result;
}

/** `disabled` 字段值 → 三态；`!!js` 表达式由 dsh 按运行环境求值，插件端只展示。 */
function parseDisabled(value: string): DshPluginRowState {
	if (value.startsWith('!!js')) return 'conditional';
	return value === 'true' ? 'off' : 'on';
}

/** 去掉 YAML 标量的引号（单引号会转义成两个单引号）。 */
function unquoteYaml(value: string): string {
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replaceAll("''", "'");
	}
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
	return value;
}

/** 这一段是否来自 profile 的用户层 patch（启停的写入目标）。 */
function isUserPatch(patchedBy: string | null, userPatchPath: string): boolean {
	if (patchedBy === null) return false;
	if (patchedBy === userPatchPath) return true;
	try {
		const a = realpathSync(path.resolve(patchedBy));
		const b = realpathSync(path.resolve(userPatchPath));
		return a === b;
	} catch {
		return path.resolve(patchedBy) === path.resolve(userPatchPath);
	}
}

/** 从 package.json 读 bundle 版本：profile 自己的 node_modules → dsh 安装的 node_modules（按父级逐层找）。 */
function readBundleVersion(name: string, profileDir: string, command: DshCommand): string | null {
	for (const root of versionRoots(profileDir, command)) {
		const manifest = path.join(root, 'node_modules', name, 'package.json');
		try {
			const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
			if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version;
		} catch {
			// 这一层找不到就试下一层
		}
	}
	return null;
}

/** 版本查找的根目录：profile 目录 + dsh 可执行文件往上 6 层。 */
function versionRoots(profileDir: string, command: DshCommand): string[] {
	const roots = [profileDir];
	const base = command.prefix[0] ?? command.cmd;
	let dir = path.dirname(resolveExecutable(base));
	for (let index = 0; index < 6; index += 1) {
		roots.push(dir);
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return roots;
}

/** 把启动命令解析成真实文件路径：绝对路径 / 相对路径 / PATH 上的裸命令名。 */
export function resolveExecutable(value: string): string {
	if (path.isAbsolute(value)) return canonicalPath(value);
	if (value.includes(path.sep)) return canonicalPath(path.resolve(value));
	const pathValue = buildSpawnEnv().PATH;
	if (typeof pathValue === 'string') {
		for (const entry of pathValue.split(path.delimiter)) {
			if (entry === '') continue;
			const candidate = path.join(entry, value);
			if (existsSync(candidate)) return canonicalPath(candidate);
		}
	}
	return canonicalPath(value);
}

/**
 * dsh 安装（app 包）的 package.json 候选，用于解析 `node_modules` 里的包：
 * 与 dsh 自己的 `resolveBundleDir` 一致，优先安装锚点，其次 profile 目录。
 */
export function installAnchors(command: DshCommand, profileDir: string): string[] {
	const anchors: string[] = [];
	const executable = resolveExecutable(command.prefix[0] ?? command.cmd);
	let dir = path.dirname(executable);
	for (let index = 0; index < 4; index += 1) {
		anchors.push(path.join(dir, 'package.json'));
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	anchors.push(path.join(profileDir, 'package.json'));
	return anchors;
}

/** realpath 失败时退回原路径（文件可能不存在）。 */
function canonicalPath(file: string): string {
	try {
		return realpathSync(file);
	} catch {
		return path.resolve(file);
	}
}
