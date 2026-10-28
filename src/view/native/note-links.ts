/**
 * 消息正文里的引用渲染：
 * - `@vault/路径.md` / `@"含 空格.md"` → Obsidian 短链接（双链）；
 * - `@文件夹/` / `@"含 空格 的文件夹/"`（结尾斜杠）→ 可点击的文件夹 chip，
 *   点击在左侧文件列表里展开并选中该文件夹（处理在 MarkdownText）。
 *
 * 纯文本 → 文本（文件夹 chip 是内联 HTML，交给 MarkdownRenderer 渲染）。
 */

/** 文件引用：渲染成 `[[文件名]]`。 */
export interface FileLinkTarget {
	kind: 'file';
	/** 文件名（不含扩展名），短链接的目标与显示文字。 */
	name: string;
}

/** 文件夹引用：渲染成可点击的文件夹 chip。 */
export interface FolderLinkTarget {
	kind: 'folder';
	/** 文件夹名（最后一段），chip 的显示文字。 */
	name: string;
	/** vault 相对路径（不带结尾斜杠），点击时用它定位。 */
	path: string;
}

export type NoteLinkTarget = FileLinkTarget | FolderLinkTarget;

/** 会破坏 wiki 链接语法的字符。 */
const LINK_UNSAFE = /[[\]|#^\n\r]/;

export function noteLinkOf(name: string): string {
	return '[[' + name + ']]';
}

export function isLinkSafe(name: string): boolean {
	return name.trim() !== '' && !LINK_UNSAFE.test(name);
}

/** Obsidian 图标集里的 folder，内联进 chip；颜色由 CSS currentColor 决定。 */
const FOLDER_ICON =
	'<svg class="svg-icon dsh-folder-ref-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			default:
				return '&#39;';
		}
	});
}

/** 文件夹 chip 的内联 HTML；`data-dsh-folder` 存定位用的 vault 路径。 */
export function folderChipOf(target: FolderLinkTarget): string {
	const path = escapeHtml(target.path);
	return (
		'<span class="dsh-folder-ref" data-dsh-folder="' +
		path +
		'" title="' +
		path +
		'（点击在左侧文件列表展开）" role="button" tabindex="0">' +
		FOLDER_ICON +
		escapeHtml(target.name) +
		'/</span>'
	);
}

/**
 * 把正文里的 `@路径` / `@"含 空格 的路径"` 换成短链接或文件夹 chip。
 *
 * - 跳过围栏代码块与行内代码；
 * - 跳过已有 `[[…]]`，以及前面紧邻单词字符的 `@`（邮箱等）；
 * - `resolve` 返回 null（文件不存在 / 名字不安全）时保留原文本；
 * - 没有发生替换时返回原字符串，便于调用方做引用相等判断。
 */
export function applyNoteLinks(
	text: string,
	resolve: (path: string) => NoteLinkTarget | null,
): string {
	const lines = text.split('\n');
	let fence: string | null = null;
	let changed = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
		if (fence !== null) {
			if (marker !== null && marker[0] === fence[0] && marker.length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (marker !== null) {
			fence = marker;
			continue;
		}
		const replaced = replaceInline(line, resolve);
		if (replaced !== line) {
			lines[index] = replaced;
			changed = true;
		}
	}
	return changed ? lines.join('\n') : text;
}

const MENTION = /\[\[[^[\]\n]*\]\]|(^|[^\w@])@(?:"([^"\n]+)"|([^\s@]+))/g;
const TRAILING_CHAR = /[.,;:!?，。；：！？)\]】」》]/;

/** 先按整段解析；失败时在标点处截断，把 `，然后` 这类尾巴还给正文。 */
function resolveWithTrailing(
	token: string,
	resolve: (path: string) => NoteLinkTarget | null,
): { target: NoteLinkTarget; trailing: string } | null {
	const direct = resolve(token);
	if (direct !== null) return { target: direct, trailing: '' };
	for (let index = token.length - 1; index > 0; index -= 1) {
		const char = token[index];
		if (char === undefined || !TRAILING_CHAR.test(char)) continue;
		const target = resolve(token.slice(0, index));
		if (target !== null) return { target, trailing: token.slice(index) };
	}
	return null;
}

function replaceInline(
	line: string,
	resolve: (path: string) => NoteLinkTarget | null,
): string {
	let result = '';
	let index = 0;
	while (index < line.length) {
		const start = line.indexOf('`', index);
		if (start === -1) {
			result += replaceMentions(line.slice(index), resolve);
			break;
		}
		result += replaceMentions(line.slice(index, start), resolve);
		let run = 1;
		while (line[start + run] === '`') run += 1;
		const fence = '`'.repeat(run);
		const end = line.indexOf(fence, start + run);
		if (end === -1) {
			// 未闭合的行内代码按普通文本处理，避免吞掉后半行。
			result += line.slice(start);
			break;
		}
		result += line.slice(start, end + run);
		index = end + run;
	}
	return result;
}

function replaceMentions(
	line: string,
	resolve: (path: string) => NoteLinkTarget | null,
): string {
	return line.replace(
		MENTION,
		(match, prefix: string | undefined, quoted: string | undefined, plain: string | undefined) => {
			if (match.startsWith('[[')) return match;
			const token = quoted ?? plain ?? '';
			if (token === '' || token.includes('://')) return match;
			// 文件按完整 vault 路径命中；文件夹必须带结尾斜杠（与 dsh 语法一致）。
			const resolved = resolveWithTrailing(token, resolve);
			if (resolved === null) return match;
			const { target, trailing } = resolved;
			if (target.kind === 'folder') {
				return (prefix ?? '') + folderChipOf(target) + trailing;
			}
			if (!isLinkSafe(target.name)) return match;
			return (prefix ?? '') + noteLinkOf(target.name) + trailing;
		},
	);
}
