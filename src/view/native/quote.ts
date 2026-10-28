/**
 * 编辑器选区引用（0058）：消息文本里内联引用块的编解码。
 *
 * 发送时把选区写成一段引用块（模型可读、随消息落库、刷新/重启/其它客户端都还在）：
 *
 *   > 引用自 [[日记/2026-10-28|2026-10-28]] · 第 5 行 0–81 字
 *   > 选中的第一行
 *   > 选中的第二行
 *
 *   用户的问题
 *
 * 面板在 UserMessage 里用 parseQuote 拆出来，换成微信式引用卡（QuoteCard）；
 * 拆不出来（旧消息 / 用户自己写的 blockquote / 其它客户端发的）按普通 Markdown 渲染。
 *
 * 纯函数，不 import obsidian，可单独冒烟。
 */

export interface QuotePoint {
	/** 0-based 行号（与 Obsidian EditorPosition / CM6 一致）。 */
	line: number;
	/** 0-based 行内字符位置。 */
	ch: number;
}

export interface SelectionQuote {
	/** vault 相对路径。 */
	path: string;
	/** 笔记名（不含扩展名）。 */
	name: string;
	from: QuotePoint;
	to: QuotePoint;
	/** 选中原文（未截断）。 */
	text: string;
	/** 捕获时间（只用于 UI 去重，不写进消息）。 */
	capturedAt?: number;
}

interface QuoteExcerpt {
	text: string;
	truncated: boolean;
	total: number;
}

interface ParsedQuote {
	quote: SelectionQuote;
	/** 引用块之后的用户正文（原样，已去掉引用块与分隔空行）。 */
	body: string;
	/** 摘录被截断时的原始字数；未截断为 undefined。 */
	truncatedTotal?: number;
}

const META_PREFIX = '> 引用自 [[';
const META_SEP = ']] · ';
const TRUNCATED_LINE = /^…（已截断，共 (\d+) 字）$/u;
/** 会破坏 wiki 链接语法的字符（路径 / 文件名里出现时退回纯笔记名）。 */
const LINK_UNSAFE = /[[\]|\n\r]/u;

/** 「第 5 行」/「第 5–7 行」。 */
export function quoteLineLabel(quote: SelectionQuote): string {
	const from = quote.from.line + 1;
	const to = quote.to.line + 1;
	return from === to ? '第 ' + from + ' 行' : '第 ' + from + '–' + to + ' 行';
}

/** 选区指纹：用户点了「不引用」之后，同一选区不再自动带回。 */
export function quoteKey(quote: SelectionQuote): string {
	return [
		quote.path,
		quote.from.line,
		quote.from.ch,
		quote.to.line,
		quote.to.ch,
		quote.text.length,
	].join('|');
}

/** 摘录（预览 / 发送共用）：超上限时截断，截断标记由 formatQuote 写进引用块。 */
export function quoteExcerpt(quote: SelectionQuote, limit: number): QuoteExcerpt {
	const total = quote.text.length;
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : total;
	if (total <= safeLimit) return { text: quote.text, truncated: false, total };
	return { text: quote.text.slice(0, safeLimit), truncated: true, total };
}

function linkTargetOf(quote: SelectionQuote): string {
	// 方括号 / 竖线会破坏 wiki 链接：含这些字符时只写笔记名，跳转走按名回退。
	const name = quote.name.replaceAll('|', '／').replaceAll(']', '）');
	if (LINK_UNSAFE.test(quote.path) || LINK_UNSAFE.test(quote.name)) return name;
	return quote.path + '|' + name;
}

/** 生成引用块（不含正文；调用方在它后面补两个换行 + 用户正文）。 */
export function formatQuote(quote: SelectionQuote, limit: number): string {
	const excerpt = quoteExcerpt(quote, limit);
	const columns = quote.from.ch + '–' + quote.to.ch + ' 字';
	const meta = META_PREFIX + linkTargetOf(quote) + META_SEP + quoteLineLabel(quote) + ' ' + columns;
	const lines = excerpt.text.split('\n').map((line) => (line === '' ? '>' : '> ' + line));
	if (excerpt.truncated) {
		lines.push('> …（已截断，共 ' + excerpt.total + ' 字）');
	}
	return [meta, ...lines].join('\n');
}

/** 拆出引用块与正文；不是引用块 / 结构不合法 → null（调用方按普通 Markdown 渲染）。 */
export function parseQuote(text: string): ParsedQuote | null {
	const lines = text.split('\n');
	const first = lines[0] ?? '';
	if (!first.startsWith(META_PREFIX)) return null;
	const close = first.indexOf(META_SEP);
	if (close === -1) return null;
	const target = first.slice(META_PREFIX.length, close);
	const tail = first.slice(close + META_SEP.length);
	const range = parseRangeTail(tail);
	if (target === '' || range === null) return null;
	const { from, to } = range;
	if (from.line > to.line || (from.line === to.line && from.ch > to.ch)) return null;
	const bar = target.lastIndexOf('|');
	const path = bar >= 0 ? target.slice(0, bar) : target;
	const rawName = bar >= 0 ? target.slice(bar + 1) : target.slice(target.lastIndexOf('/') + 1);
	const name = rawName.replace(/\.md$/u, '');
	if (path === '' || name === '') return null;

	const excerptLines: string[] = [];
	let truncatedTotal: number | undefined;
	let index = 1;
	for (; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!line.startsWith('>')) break;
		const content = line === '>' ? '' : line.startsWith('> ') ? line.slice(2) : line.slice(1);
		const truncated = TRUNCATED_LINE.exec(content);
		if (truncated !== null) {
			const total = Number.parseInt(truncated[1] ?? '', 10);
			if (Number.isFinite(total)) truncatedTotal = total;
			continue;
		}
		excerptLines.push(content);
	}
	if (excerptLines.length === 0) return null;
	// 引用块与正文之间固定一个空行；没有正文时也允许（自己发给自己看）。
	if (index < lines.length && (lines[index] ?? '') === '') index += 1;
	const body = lines.slice(index).join('\n');
	return {
		quote: { path, name, from, to, text: excerptLines.join('\n') },
		body,
		...(truncatedTotal === undefined ? {} : { truncatedTotal }),
	};
}

function parseRangeTail(tail: string): { from: QuotePoint; to: QuotePoint } | null {
	const single = /^第 (\d+) 行 (\d+)–(\d+) 字$/u.exec(tail);
	if (single !== null) {
		const line = Number.parseInt(single[1] ?? '', 10) - 1;
		const fromCh = Number.parseInt(single[2] ?? '', 10);
		const toCh = Number.parseInt(single[3] ?? '', 10);
		if (line < 0 || fromCh < 0 || toCh < fromCh) return null;
		return { from: { line, ch: fromCh }, to: { line, ch: toCh } };
	}
	const range = /^第 (\d+)–(\d+) 行 (\d+)–(\d+) 字$/u.exec(tail);
	if (range === null) return null;
	const fromLine = Number.parseInt(range[1] ?? '', 10) - 1;
	const toLine = Number.parseInt(range[2] ?? '', 10) - 1;
	const fromCh = Number.parseInt(range[3] ?? '', 10);
	const toCh = Number.parseInt(range[4] ?? '', 10);
	if (fromLine < 0 || toLine < fromLine || fromCh < 0 || toCh < 0) return null;
	return { from: { line: fromLine, ch: fromCh }, to: { line: toLine, ch: toCh } };
}
