/**
 * 设置页白 / 黑名单「选取」按钮的候选构造（0038，纯函数，不 import obsidian）。
 *
 * 三处候选来源：
 * - @ 引用范围：vault 里的文件与文件夹（调用方用 `app.vault.getAllLoadedFiles()` 取快照）；
 * - 「/」技能范围：本地技能目录里的技能名（`service/skill-catalog.ts` 扫描）；
 * - 「/」命令范围（0051）：原生面板的桥返回的当前会话 dsh 命令名（面板未打开时为空）。
 *
 * 规则与名单写入后的匹配语义保持一致：
 * - 路径按前缀覆盖（条目 `日记` 覆盖 `日记/2026`），技能名按 `-` 前缀覆盖（`office` 覆盖 `office-docx`）；
 * - 已在名单里的条目、以及被名单条目覆盖的冗余候选不再列出；
 * - 点开头的隐藏段与 `.git` / `node_modules` 不列（与 @ 菜单的默认可见性一致）。
 */

import { normalizeCommandName } from './schema';

type ScopePathKind = 'file' | 'directory';

/** vault 里可加入名单的一个条目。 */
export interface ScopePathEntry {
	/** vault 相对路径（文件或文件夹，不带结尾斜杠）。 */
	path: string;
	kind: ScopePathKind;
}

/** 弹窗里的一个候选：@ 用文件 / 文件夹，/ 用技能名或 dsh 命令名。 */
export interface ScopeCandidate {
	value: string;
	kind: ScopePathKind | 'skill' | 'command';
}

/** 与 @ 菜单一致的系统目录（避免把内部目录加进名单）。 */
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules']);

/** 路径条目是否覆盖候选（文件 / 文件夹同一条前缀规则）。 */
function pathCovers(entry: string, path: string): boolean {
	return path === entry || path.startsWith(entry + '/');
}

/** 技能名条目是否覆盖候选（条目本身或 `-` 前缀子项）。 */
function skillCovers(entry: string, name: string): boolean {
	return name === entry || name.startsWith(entry + '-');
}

/** 命令名条目是否覆盖候选（命令是扁平命名空间，精确匹配）。 */
function commandCovers(entry: string, name: string): boolean {
	return name === entry;
}

/** 隐藏段 /.git / node_modules 一律不列。 */
function isHiddenPath(path: string): boolean {
	return path
		.split('/')
		.some((segment) => segment.startsWith('.') || EXCLUDED_DIRECTORIES.has(segment));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 构造 @ 引用范围的候选：排除隐藏路径、名单里已有的条目、被名单条目覆盖的冗余项；
 * 文件夹排在文件前面，同类按路径字典序。
 */
export function listPathCandidates(
	entries: readonly ScopePathEntry[],
	existing: readonly string[],
): ScopePathEntry[] {
	const result: ScopePathEntry[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		// 排除空路径与 vault 根（Obsidian 的根文件夹 path 是 "/"）。
		if (entry.path === '' || entry.path === '/' || seen.has(entry.path)) continue;
		if (isHiddenPath(entry.path)) continue;
		if (existing.some((value) => pathCovers(value, entry.path))) continue;
		seen.add(entry.path);
		result.push(entry);
	}
	result.sort(
		(left, right) =>
			(left.kind === 'directory' ? 0 : 1) - (right.kind === 'directory' ? 0 : 1) ||
			compareText(left.path, right.path),
	);
	return result;
}

/**
 * 构造「/」技能范围的候选：名字归一化（strip + 小写）、去重、排除名单里已有的与
 * 被名单条目前缀覆盖的冗余项，按名字字典序。
 */
export function listSkillCandidates(
	names: readonly string[],
	existing: readonly string[],
): string[] {
	const result: string[] = [];
	for (const name of names) {
		const value = name.trim().toLowerCase();
		if (value === '' || result.includes(value)) continue;
		if (existing.some((entry) => skillCovers(entry, value))) continue;
		result.push(value);
	}
	result.sort(compareText);
	return result;
}

/**
 * 构造「/」命令范围的候选（0051）：命令名归一化（dsh 规则）、去重、
 * 排除名单里已有条目（精确匹配）与非法值，按名字字典序。
 */
export function listCommandCandidates(
	names: readonly string[],
	existing: readonly string[],
): string[] {
	const result: string[] = [];
	for (const name of names) {
		const value = normalizeCommandName(name);
		if (value === null || result.includes(value)) continue;
		if (existing.some((entry) => commandCovers(entry, value))) continue;
		result.push(value);
	}
	result.sort(compareText);
	return result;
}
