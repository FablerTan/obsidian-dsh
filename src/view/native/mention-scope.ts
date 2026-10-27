/**
 * @ 菜单的候选范围过滤（0030，纯函数，不 import obsidian）。
 *
 * 设置页可选「不启用 / 白名单 / 黑名单」，规则：
 * - 每个条目是 vault 相对路径，可以是文件夹（含子目录）或单个文件，两者都用前缀规则匹配；
 * - 白名单：只保留落在条目里（或条目本身）的候选；同时保留条目的祖先文件夹，
 *   这样从根目录也能逐级下钻到白名单里的深层文件夹；
 * - 黑名单：去掉落在条目里（或条目本身）的候选，祖先文件夹保留（还能浏览兄弟目录）；
 * - 范围只作用于「文件与文件夹」候选；「当前笔记」首行由菜单自己维护，始终可选。
 */
import { normalizeScopePaths, type MentionScope } from '../../settings/schema';
import type { MentionEntry } from './mention';

/** 路径本身，或它所在的文件夹，是否落在 scopePath 里（文件 / 文件夹同一条规则）。 */
function covers(scopePath: string, path: string): boolean {
	return path === scopePath || path.startsWith(scopePath + '/');
}

function insideAny(scopePaths: readonly string[], path: string): boolean {
	return scopePaths.some((scopePath) => covers(scopePath, path));
}

/** 白名单条目的祖先文件夹：让菜单能从根目录逐级下钻到深层白名单。 */
function ancestorDirectories(paths: readonly string[]): Set<string> {
	const result = new Set<string>();
	for (const path of paths) {
		const segments = path.split('/');
		segments.pop();
		let current = '';
		for (const segment of segments) {
			current = current === '' ? segment : current + '/' + segment;
			result.add(current);
		}
	}
	return result;
}

/** 按设置裁剪 @ 菜单的 vault 快照；不启用时原样返回。 */
export function filterMentionEntries(
	entries: readonly MentionEntry[],
	scope: MentionScope,
): MentionEntry[] {
	if (scope.mode === 'off') return [...entries];
	if (scope.mode === 'whitelist') {
		// 合并设置时已归一化；这里再兜一次手改 data.json / 旧版本值的情况。
		const allow = normalizeScopePaths(scope.allow);
		if (allow.length === 0) return [];
		const ancestors = ancestorDirectories(allow);
		return entries.filter(
			(entry) =>
				insideAny(allow, entry.path) ||
				(entry.kind === 'directory' && ancestors.has(entry.path)),
		);
	}
	// 未知模式兜底为「不过滤」，与 mergeSettings 回落 off 的方向一致。
	if (scope.mode !== 'blacklist') return [...entries];
	const deny = normalizeScopePaths(scope.deny);
	if (deny.length === 0) return [...entries];
	return entries.filter((entry) => !insideAny(deny, entry.path));
}
