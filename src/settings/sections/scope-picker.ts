import { SuggestModal, TFolder, setIcon, type App } from 'obsidian';
import type { ScopeCandidate, ScopePathEntry } from '../scope-candidates';

/**
 * 范围名单「选取」候选项：vault 路径快照 + 搜索弹窗（0038），供三张范围卡片共用。
 * 卡片与名单面板在 chat-scope.ts。
 */

/** vault 里的文件 / 文件夹快照（与 @ 菜单同源）。 */
export function vaultPathEntries(app: App): ScopePathEntry[] {
	return app.vault
		.getAllLoadedFiles()
		// 根文件夹（path 为 "/"）不能加进名单，归一化时也会被拒。
		.filter((file) => file.path !== '' && file.path !== '/')
		.map((file) => ({
			path: file.path,
			kind: file instanceof TFolder ? 'directory' : 'file',
		}));
}

/** 「选取」候选弹窗：搜索 + 点击 / Enter 选中，选中后只回填输入框（0038）。 */
export class ScopePickerModal extends SuggestModal<ScopeCandidate> {
	private readonly items: readonly ScopeCandidate[];
	private readonly onChoose: (value: string) => void;

	constructor(
		app: App,
		items: readonly ScopeCandidate[],
		kind: 'path' | 'skill' | 'command',
		onChoose: (value: string) => void,
	) {
		super(app);
		this.items = items;
		this.onChoose = onChoose;
		this.limit = 50;
		this.setPlaceholder(
			kind === 'path'
				? '搜索 vault 路径…'
				: kind === 'skill'
					? '搜索技能名（来自本地技能目录）…'
					: '搜索命令名（来自当前会话的 dsh 命令目录）…',
		);
		this.emptyStateText =
			kind === 'path' ? '没有匹配的路径' : kind === 'skill' ? '没有匹配的技能名' : '没有匹配的命令名';
	}

	getSuggestions(query: string): ScopeCandidate[] {
		const needle = query.trim().toLowerCase();
		if (needle === '') return [...this.items];
		const scored: { item: ScopeCandidate; score: number }[] = [];
		for (const item of this.items) {
			const value = item.value.toLowerCase();
			const score =
				value === needle ? 0 : value.startsWith(needle) ? 1 : value.includes(needle) ? 2 : -1;
			if (score >= 0) scored.push({ item, score });
		}
		scored.sort((left, right) => left.score - right.score);
		return scored.map((entry) => entry.item);
	}

	renderSuggestion(item: ScopeCandidate, el: HTMLElement): void {
		el.addClass('dsh-settings-scope-suggestion');
		const iconEl = el.createDiv({ cls: 'dsh-settings-scope-suggestion-icon' });
		setIcon(
			iconEl,
			item.kind === 'directory'
				? 'folder'
				: item.kind === 'file'
					? 'file-text'
					: item.kind === 'command'
						? 'terminal'
						: 'sparkles',
		);
		el.createDiv({ cls: 'dsh-settings-scope-suggestion-value', text: item.value });
		el.createDiv({
			cls: 'dsh-settings-scope-suggestion-kind',
			text:
				item.kind === 'directory'
					? '文件夹'
					: item.kind === 'file'
						? '文件'
						: item.kind === 'command'
							? '命令'
							: '技能',
		});
	}

	onChooseSuggestion(item: ScopeCandidate): void {
		this.onChoose(item.value);
	}
}
