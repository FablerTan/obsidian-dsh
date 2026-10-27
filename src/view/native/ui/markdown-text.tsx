import { Component, MarkdownRenderer, TFile, TFolder, type App } from 'obsidian';
import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { revealFolderInExplorer } from '../folder-reveal';
import { applyNoteLinks, type NoteLinkTarget } from '../note-links';

function resolveReference(app: App, path: string): NoteLinkTarget | null {
	// 文件夹引用以结尾斜杠标记（与 dsh 的 @ 语法一致）。
	if (path.endsWith('/')) {
		const clean = path.replace(/\/+$/, '');
		if (clean === '') return null;
		const folder = app.vault.getAbstractFileByPath(clean);
		if (!(folder instanceof TFolder)) return null;
		return { kind: 'folder', name: folder.name, path: folder.path };
	}
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) || file.extension !== 'md') return null;
	return { kind: 'file', name: file.basename };
}

/** 点击 / 键盘激活文件夹 chip：在左侧文件列表里展开并选中。 */
function activateFolderRef(app: App, target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const chip = target.closest('.dsh-folder-ref');
	if (!(chip instanceof HTMLElement)) return false;
	const path = chip.dataset.dshFolder;
	if (path === undefined || path === '') return false;
	revealFolderInExplorer(app, path);
	return true;
}

/** 面板不是 MarkdownView，Obsidian 不会替我们处理 `a.internal-link` 的点击，这里自己接。 */
function openInternalLink(
	app: App,
	sourcePath: string,
	event: ReactMouseEvent<HTMLDivElement>,
): void {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return;
	const anchor = target.closest('a');
	if (!(anchor instanceof HTMLAnchorElement) || !anchor.classList.contains('internal-link')) return;
	const href = anchor.dataset.href ?? anchor.getAttribute('href') ?? '';
	if (href === '') return;
	event.preventDefault();
	// 第三参 true：主区新标签，聊天面板留在右栏。
	void app.workspace.openLinkText(href, sourcePath, true);
}

export function MarkdownText({
	app,
	text,
	sourcePath,
}: {
	app: App;
	text: string;
	sourcePath: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el === null) return;
		el.replaceChildren();
		const component = new Component();
		let cancelled = false;
		const markdown = applyNoteLinks(text, (path) => resolveReference(app, path));
		void MarkdownRenderer.render(app, markdown, el, sourcePath, component).catch(() => {
			if (!cancelled) el.setText(markdown);
		});
		return () => {
			cancelled = true;
			component.unload();
			el.replaceChildren();
		};
	}, [app, sourcePath, text]);
	return (
		<div
			ref={ref}
			className="dsh-native-markdown markdown-rendered"
			onClick={(event) => {
				if (activateFolderRef(app, event.target)) {
					event.preventDefault();
					return;
				}
				openInternalLink(app, sourcePath, event);
			}}
			onAuxClick={(event) => {
				if (event.button === 1) openInternalLink(app, sourcePath, event);
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				if (activateFolderRef(app, event.target)) {
					event.preventDefault();
					event.stopPropagation();
				}
			}}
		/>
	);
}
