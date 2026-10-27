import { TFolder, type App } from 'obsidian';

/**
 * 在左侧文件列表里展开并选中一个文件夹。
 *
 * Obsidian 没有公开的「定位文件夹」API；这里用文件列表视图的内部能力
 * （`fileItems` / `tree.selectItem` / `revealInFolder`），全部按存在性调用，
 * 拿不到视图时退回公开命令 `file-explorer:open`。
 */

interface ExplorerFolderItem {
	setCollapsed?: (collapsed: boolean) => void;
	parent?: ExplorerFolderItem | null;
	selfEl?: HTMLElement;
}

interface ExplorerView {
	fileItems?: Record<string, ExplorerFolderItem>;
	tree?: { selectItem?: (item: ExplorerFolderItem) => void };
	revealInFolder?: (folder: TFolder) => void;
}

interface ExpandableSidedock {
	expand?: () => void;
}

/** 返回是否把动作交给了文件列表（视图缺失时会先打开它再重试一次）。 */
export function revealFolderInExplorer(app: App, path: string): boolean {
	const folder = app.vault.getAbstractFileByPath(path);
	if (!(folder instanceof TFolder)) return false;
	(app.workspace.leftSplit as unknown as ExpandableSidedock | undefined)?.expand?.();
	const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
	if (leaf === undefined) {
		// App.commands 不在官方 typings 里（运行时存在），按公开命令 id 打开文件列表。
		const commands = (
			app as unknown as { commands?: { executeCommandById?: (id: string) => unknown } }
		).commands;
		commands?.executeCommandById?.('file-explorer:open');
		window.setTimeout(() => {
			const opened = app.workspace.getLeavesOfType('file-explorer')[0];
			if (opened !== undefined) revealInView(opened.view, folder);
		}, 60);
		return true;
	}
	revealInView(leaf.view, folder);
	return true;
}

function revealInView(view: unknown, folder: TFolder): void {
	const explorer = view as ExplorerView;
	const item = explorer.fileItems?.[folder.path];
	// 只展开自己没有意义：祖先还折叠时它仍然不可见。
	let cursor: ExplorerFolderItem | null | undefined = item;
	while (cursor !== undefined && cursor !== null) {
		cursor.setCollapsed?.(false);
		cursor = cursor.parent;
	}
	if (typeof explorer.revealInFolder === 'function') {
		explorer.revealInFolder(folder);
	}
	if (item === undefined) return;
	if (typeof explorer.tree?.selectItem === 'function') {
		explorer.tree.selectItem(item);
	} else {
		item.selfEl?.scrollIntoView({ block: 'nearest' });
	}
}
