/**
 * 输入框 @ 引用菜单的纯逻辑（不 import obsidian）：
 * token 检测、dsh 同款候选排序、插入文本格式化。
 *
 * 规则对齐 dsh 的 `@` 补全（0.2.x）：
 * - `@` 只在草稿开头或空白之后生效，词内（邮箱）不触发；
 * - `@"…` 支持含空格路径，允许未闭合引号（选目录后继续展开）；
 * - 空查询 / 带 `/` 的查询只列该目录的直接子项，其余走全量模糊排序；
 * - 最多 20 条，排除 `.git` / `node_modules`，点开头的段默认隐藏。
 */

export type MentionKind = 'file' | 'directory';

/** vault 里可引用的一个条目（文件或文件夹）。 */
export interface MentionEntry {
	path: string;
	kind: MentionKind;
}

/** 光标处正在输入的 `@` token。 */
export interface MentionToken {
	/** `@` 的起始偏移（选中时替换 [start, end)）。 */
	start: number;
	/** 光标偏移。 */
	end: number;
	/** `@` 或 `@"` 之后的查询文本。 */
	query: string;
	/** 用户是否已经输入了 `@"`（选中后保持引号）。 */
	quoted: boolean;
}

/** 一次最多展示的候选数（与 dsh 的 maxResults 一致）。 */
export const MENTION_LIMIT = 20;

const QUOTED_TOKEN = /(?:^|\s)(@"([^"]*))$/u;
const PLAIN_TOKEN = /(?:^|\s)(@([^\s]*))$/u;
/** 与 dsh 的 excludedDirectories 一致。 */
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules']);
/** 编辑器语法无法安全表示的路径（控制字符 / 引号）。 */
const UNSAFE_PATH = /[\u0000-\u001f\u007f-\u009f"]/u;

/** 取光标前当前行的 `@` token；不在 token 里返回 null。 */
export function activeMentionToken(draft: string, caret: number): MentionToken | null {
	const position = Math.max(0, Math.min(caret, draft.length));
	const lineStart = position === 0 ? 0 : draft.lastIndexOf('\n', position - 1) + 1;
	const line = draft.slice(lineStart, position);
	const quoted = QUOTED_TOKEN.exec(line);
	if (quoted !== null && quoted[1] !== undefined && quoted[2] !== undefined) {
		return {
			start: position - quoted[1].length,
			end: position,
			query: quoted[2],
			quoted: true,
		};
	}
	const plain = PLAIN_TOKEN.exec(line);
	if (plain === null || plain[1] === undefined || plain[2] === undefined) return null;
	return {
		start: position - plain[1].length,
		end: position,
		query: plain[2],
		quoted: false,
	};
}

/** 目录直列 / 全量模糊，返回最多 limit 条候选。 */
export function listMentionCandidates(
	entries: readonly MentionEntry[],
	query: string,
	limit: number = MENTION_LIMIT,
): MentionEntry[] {
	const normalized = query.replaceAll('\\', '/');
	const slash = normalized.lastIndexOf('/');
	if (normalized === '' || slash >= 0) {
		const directory = slash < 0 ? '' : normalized.slice(0, slash + 1);
		const fragment = slash < 0 ? '' : normalized.slice(slash + 1);
		return listDirectory(entries, directory, fragment, limit);
	}
	const visible = entries.filter(
		(entry) =>
			!pathHasExcludedSegment(entry.path) && visibleForGlobalQuery(entry.path, normalized),
	);
	return rankCandidates(visible, normalized, limit);
}

/** 路径本身是否匹配查询（用于「当前笔记」行是否显示）。 */
export function mentionsQuery(path: string, query: string): boolean {
	if (query === '') return true;
	return scoreCandidate({ path, kind: 'file' }, query) !== undefined;
}

/**
 * 选中后写进草稿的文本：`@path` / `@"path"` / 目录 `@"path/`（引号保持打开）。
 * 目录保留未闭合引号是为了 Tab 下钻后继续在引号内写子路径。
 */
export function formatMention(entry: MentionEntry, preserveQuote = false): string | null {
	const path = entry.kind === 'directory' ? entry.path + '/' : entry.path;
	if (UNSAFE_PATH.test(path)) return null;
	const quoted = preserveQuote || /\s/u.test(path);
	if (!quoted) return '@' + path;
	if (entry.kind === 'directory') return '@"' + path;
	return '@"' + path + '"';
}

/**
 * 目录作为**最终引用**采纳时（Enter），把下钻语义故意留空的右引号补上，
 * 否则 `@"my folder/` 不是一条完整的引用文本。
 */
export function completeMention(mention: string): string {
	if (!mention.startsWith('@"') || mention.endsWith('"')) return mention;
	return mention + '"';
}

function listDirectory(
	entries: readonly MentionEntry[],
	directory: string,
	fragment: string,
	limit: number,
): MentionEntry[] {
	if (pathHasExcludedSegment(directory)) return [];
	const candidates: MentionEntry[] = [];
	for (const entry of entries) {
		let name: string;
		if (directory === '') {
			if (entry.path.includes('/')) continue;
			name = entry.path;
		} else {
			if (!entry.path.startsWith(directory)) continue;
			const rest = entry.path.slice(directory.length);
			if (rest === '' || rest.includes('/')) continue;
			name = rest;
		}
		if (name.startsWith('.') && !fragment.startsWith('.')) continue;
		if (entry.kind === 'directory' && EXCLUDED_DIRECTORIES.has(name)) continue;
		candidates.push(entry);
	}
	return rankCandidates(candidates, fragment, limit);
}

function pathHasExcludedSegment(path: string): boolean {
	return path.split('/').some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

function visibleForGlobalQuery(path: string, query: string): boolean {
	if (query.startsWith('.') || query.includes('/.')) return true;
	return !path.split('/').some((segment) => segment.startsWith('.'));
}

interface ScoredEntry {
	entry: MentionEntry;
	score: number;
}

function rankCandidates(
	candidates: readonly MentionEntry[],
	query: string,
	limit: number,
): MentionEntry[] {
	const ranked: ScoredEntry[] = [];
	for (const candidate of candidates) {
		const score = scoreCandidate(candidate, query);
		if (score !== undefined) ranked.push({ entry: candidate, score });
	}
	ranked.sort(
		(left, right) =>
			right.score - left.score ||
			kindRank(left.entry.kind) - kindRank(right.entry.kind) ||
			(query === '' ? 0 : left.entry.path.length - right.entry.path.length) ||
			compareText(left.entry.path, right.entry.path),
	);
	return ranked.slice(0, limit).map((item) => item.entry);
}

function scoreCandidate(candidate: MentionEntry, query: string): number | undefined {
	if (query === '') return 0;
	const path = candidate.path.toLowerCase();
	const name = path.slice(path.lastIndexOf('/') + 1);
	const needle = query.toLowerCase();
	const directoryBonus = candidate.kind === 'directory' ? 25 : 0;
	if (name === needle) return 1000 + directoryBonus;
	if (name.startsWith(needle)) return 900 + directoryBonus;
	if (name.includes(needle)) return 700 + directoryBonus;
	if (path.includes(needle)) return 500 + directoryBonus;
	const subsequence = subsequenceScore(path, needle);
	return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus;
}

function subsequenceScore(target: string, query: string): number | undefined {
	let targetIndex = 0;
	let gap = 0;
	for (const character of query) {
		const found = target.indexOf(character, targetIndex);
		if (found < 0) return undefined;
		gap += found - targetIndex;
		targetIndex = found + 1;
	}
	return Math.max(0, 100 - gap);
}

function kindRank(kind: MentionKind): number {
	return kind === 'directory' ? 0 : 1;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
