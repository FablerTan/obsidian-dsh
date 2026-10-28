import { MarkdownView, Notice, TFile, type App, type EditorPosition } from 'obsidian';
import { errorText } from '../../shared/errors';
import { quoteKey, type QuotePoint, type SelectionQuote } from './quote';

/**
 * 主编辑区选区 ↔ 聊天引用（0058）的 Obsidian 依赖部分。
 *
 * - captureSelectionQuote：点右栏输入框前 / 发送时读「最后一次活跃的 Markdown 编辑器」的选区。
 *   面板获得焦点后 workspace.activeEditor 会变成 null，但官方 getMostRecentLeaf() 在侧栏活跃时
 *   仍指向主区 leaf；失焦的 MarkdownView 里 editor.getSelection() 也仍然有效。
 * - jumpToQuote：点击引用卡时打开 / 切到笔记，定位并选中原范围，聚焦（原生选区高亮可见）。
 */
export function captureSelectionQuote(app: App): SelectionQuote | null {
	try {
		const leaf = app.workspace.getMostRecentLeaf();
		const view = leaf?.view;
		if (!(view instanceof MarkdownView)) return null;
		// 阅读模式没有源码选区；live preview 的 getMode() 也是 source。
		if (view.getMode() !== 'source') return null;
		const file = view.file;
		if (file === null) return null;
		const editor = view.editor;
		const text = editor.getSelection();
		if (text === '') return null;
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		if (from.line > to.line || (from.line === to.line && from.ch > to.ch)) return null;
		return {
			path: file.path,
			name: file.basename,
			from: { line: from.line, ch: from.ch },
			to: { line: to.line, ch: to.ch },
			text,
			capturedAt: Date.now(),
		};
	} catch {
		return null;
	}
}

/**
 * 实时跟踪编辑区选区（0058 追补 / 0059）：选区一变就回调，右栏预览不必等用户点输入框。
 * 文档级 `selectionchange` 只在选区真的变化时触发；workspace 事件覆盖切笔记 / 切叶子。
 * 80ms 防抖：拖选过程中只取最后一次，避免每像素重渲染。
 */
export function observeEditorSelection(
	app: App,
	listener: (quote: SelectionQuote | null) => void,
): () => void {
	let timer: number | null = null;
	let lastKey: string | null = null;
	const emit = (): void => {
		timer = null;
		const quote = captureSelectionQuote(app);
		const key = quote === null ? null : quoteKey(quote);
		if (key === lastKey) return;
		lastKey = key;
		listener(quote);
	};
	const schedule = (): void => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(emit, 80);
	};
	document.addEventListener('selectionchange', schedule);
	const refs = [
		app.workspace.on('active-leaf-change', schedule),
		app.workspace.on('file-open', schedule),
	];
	emit();
	return () => {
		document.removeEventListener('selectionchange', schedule);
		for (const ref of refs) app.workspace.offref(ref);
		if (timer !== null) window.clearTimeout(timer);
	};
}

export async function jumpToQuote(app: App, quote: SelectionQuote): Promise<void> {
	const file = resolveQuoteFile(app, quote);
	if (file === null) {
		new Notice('DSH：引用指向的笔记不存在 — ' + quote.path);
		return;
	}
	try {
		const leaf = findOpenLeaf(app, file) ?? (await openQuoteLeaf(app, file));
		if (leaf === null) {
			new Notice('DSH：打开引用笔记失败 — ' + quote.path);
			return;
		}
		await app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			new Notice('DSH：引用笔记不是 Markdown 视图');
			return;
		}
		if (view.getMode() !== 'source') {
			// 阅读模式没有编辑器选区：切回源码模式再定位；失败也不影响打开笔记。
			try {
				await view.setState({ ...view.getState(), mode: 'source' }, { history: false });
			} catch {
				// 只影响能否高亮
			}
		}
		const editor = view.editor;
		const range = locateRange(editor, quote);
		editor.setSelection(range.from, range.to);
		editor.scrollIntoView({ from: range.from, to: range.to }, true);
		editor.focus();
	} catch (error) {
		new Notice('DSH：跳转引用失败 — ' + errorText(error));
	}
}

function resolveQuoteFile(app: App, quote: SelectionQuote): TFile | null {
	const direct = app.vault.getAbstractFileByPath(quote.path);
	if (direct instanceof TFile && direct.extension === 'md') return direct;
	const byLink = app.metadataCache.getFirstLinkpathDest(quote.path, '');
	if (byLink instanceof TFile) return byLink;
	return app.vault.getMarkdownFiles().find((file) => file.basename === quote.name) ?? null;
}

function findOpenLeaf(app: App, file: TFile) {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) return leaf;
	}
	return null;
}

/** 复用 internal-link 的既有打开方式：主区新标签，聊天面板留在右栏。 */
async function openQuoteLeaf(app: App, file: TFile) {
	await app.workspace.openLinkText(file.path, '', true);
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const leaf = findOpenLeaf(app, file);
		if (leaf !== null) return leaf;
		await new Promise((resolve) => window.setTimeout(resolve, 50));
	}
	return null;
}

function clampPoint(editor: { lineCount(): number; getLine(line: number): string }, point: QuotePoint): EditorPosition {
	const maxLine = Math.max(0, editor.lineCount() - 1);
	const line = Math.min(Math.max(0, point.line), maxLine);
	const content = editor.getLine(line) ?? '';
	return { line, ch: Math.min(Math.max(0, point.ch), content.length) };
}

function locateRange(
	editor: {
		lineCount(): number;
		getLine(line: number): string;
		getValue(): string;
		posToOffset(pos: EditorPosition): number;
		offsetToPos(offset: number): EditorPosition;
	},
	quote: SelectionQuote,
): { from: EditorPosition; to: EditorPosition } {
	const from = clampPoint(editor, quote.from);
	const to = clampPoint(editor, quote.to);
	const exact =
		from.line === quote.from.line &&
		from.ch === quote.from.ch &&
		to.line === quote.to.line &&
		to.ch === quote.to.ch;
	if (exact) return { from, to };
	// 笔记后来被编辑导致行号漂移：按摘录第一段非空文字找回去。
	const needle = quote.text
		.split('\n')
		.map((line) => line.trim())
		.find((line) => line !== '') ?? '';
	if (needle !== '') {
		const lineCount = editor.lineCount();
		for (let line = 0; line < lineCount; line += 1) {
			const content = editor.getLine(line) ?? '';
			const index = content.indexOf(needle);
			if (index < 0) continue;
			const start = { line, ch: index };
			return { from: start, to: pointAtOffset(editor, editor.posToOffset(start) + quote.text.length) };
		}
	}
	return { from, to };
}

function pointAtOffset(
	editor: { getValue(): string; offsetToPos(offset: number): EditorPosition },
	offset: number,
): EditorPosition {
	try {
		const clamped = Math.max(0, Math.min(offset, editor.getValue().length));
		const pos = editor.offsetToPos(clamped);
		return { line: pos.line, ch: pos.ch };
	} catch {
		return { line: 0, ch: 0 };
	}
}
