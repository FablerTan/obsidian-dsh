import { Setting, SuggestModal, TFolder, setIcon, type App } from 'obsidian';
import type { SettingsRenderContext } from '../context';
import {
	MAX_QUOTE_EXCERPT_LIMIT,
	MIN_QUOTE_EXCERPT_LIMIT,
	normalizeCommandName,
	normalizeScopeName,
	normalizeScopePath,
	quoteExcerptLimitOf,
	runStatusPlacementOf,
	type ScopeMode,
	type StreamRefreshMode,
} from '../schema';
import {
	listCommandCandidates,
	listPathCandidates,
	listSkillCandidates,
	type ScopeCandidate,
	type ScopePathEntry,
} from '../scope-candidates';
import { errorText } from '../../shared/errors';

/**
 * 聊天模块：流式刷新（0021）+「@」引用范围（0030）+「/」技能范围（0037）
 * + 名单「选取」（0038）+「/」命令范围（0050）。
 */
export function renderChatSection(containerEl: HTMLElement, context: SettingsRenderContext): void {
	renderQuoteExcerptLimit(containerEl, context);
	renderRunStatusPlacement(containerEl, context);
	renderStreamRefresh(containerEl, context);
	renderMentionScope(containerEl, context);
	renderSkillScope(containerEl, context);
	renderCommandScope(containerEl, context);
}

/** 选区引用摘录上限（0058）：默认 2000 字，超出截断，行号范围仍完整。 */
function renderQuoteExcerptLimit(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('选区引用摘录上限')
		.setDesc(
			'在编辑区选中文字后发送，消息会带上「笔记路径 + 选中原文」的引用块；这里限制摘录最多多少字（默认 2000，范围 ' +
				MIN_QUOTE_EXCERPT_LIMIT +
				'–' +
				MAX_QUOTE_EXCERPT_LIMIT +
				'）。超出部分截断，行号范围仍完整；改动后下一次发送生效。',
		)
		.addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.min = String(MIN_QUOTE_EXCERPT_LIMIT);
			text.inputEl.max = String(MAX_QUOTE_EXCERPT_LIMIT);
			text.inputEl.step = '100';
			text
				.setPlaceholder(String(quoteExcerptLimitOf(host.settings.quoteExcerptLimit)))
				.setValue(String(quoteExcerptLimitOf(host.settings.quoteExcerptLimit)))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					if (parsed < MIN_QUOTE_EXCERPT_LIMIT || parsed > MAX_QUOTE_EXCERPT_LIMIT) return;
					host.settings.quoteExcerptLimit = parsed;
					await host.saveSettings();
				});
		});
}

/** 运行提示位置（0048）：输入框上方（默认）/ 消息流最下方。 */
function renderRunStatusPlacement(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('运行提示位置')
		.setDesc(
			'dsh 同款「深度求索中，用时 …」显示在哪：输入框上方（默认），或消息流最下方（随对话滚动，dsh 原生位置）。运行中的面板切换后即时生效。',
		)
		.addDropdown((dropdown) => {
			dropdown
				.addOption('composer', '输入框上方（默认）')
				.addOption('flow', '输出最下方（随对话滚动）')
				.setValue(runStatusPlacementOf(host.settings.runStatusPlacement))
				.onChange(async (value) => {
					host.settings.runStatusPlacement = runStatusPlacementOf(value);
					await host.saveSettings();
				});
		});
}

/** 流式正文的刷新节奏。 */
function renderStreamRefresh(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('流式刷新')
		.setDesc(
			'Assistant 正文的刷新节奏：逐字最跟手（需要新版桥），平衡为旧版行为，省电最省 CPU。切换后立即生效。',
		)
		.addDropdown((dropdown) => {
			dropdown
				.addOption('chunk', '逐字（每个 chunk）')
				.addOption('frame', '每帧 16ms（默认）')
				.addOption('balanced', '平衡 50ms')
				.addOption('relaxed', '省电 100ms')
				.setValue(host.settings.streamRefresh)
				.onChange(async (value) => {
					host.settings.streamRefresh = value as StreamRefreshMode;
					await host.saveSettings();
				});
		});
}

/** 白名单 / 黑名单共用的文案（@ 填路径、/ 填技能名）。 */
interface ScopeText {
	title: string;
	empty: string;
	addPlaceholder: string;
	hint: string;
	invalid: string;
	/** 点「选取」但没有候选时的说明。 */
	pickEmpty: string;
}

const MENTION_WHITELIST_TEXT: ScopeText = {
	title: '白名单',
	empty: '还没有路径：@ 菜单只保留「当前笔记」。',
	addPlaceholder: '添加白名单：文件夹或文件路径，如 日记/2026',
	hint: '白名单支持文件夹（含子目录）或单个文件；留空时 @ 菜单只保留「当前笔记」。',
	invalid: '路径无效：请填 vault 相对路径（如 日记/2026）；首尾的 / 会自动去掉，路径里不能有 ..',
	pickEmpty: '没有可选取的路径（可能都已加入名单）；可直接输入路径添加。',
};
const MENTION_BLACKLIST_TEXT: ScopeText = {
	title: '黑名单',
	empty: '还没有路径：@ 菜单检索整个 vault。',
	addPlaceholder: '添加黑名单：文件夹或文件路径，如 模板',
	hint: '黑名单支持文件夹（含子目录）或单个文件。',
	invalid: '路径无效：请填 vault 相对路径（如 模板）；首尾的 / 会自动去掉，路径里不能有 ..',
	pickEmpty: '没有可选取的路径（可能都已加入名单）；可直接输入路径添加。',
};

const SKILL_WHITELIST_TEXT: ScopeText = {
	title: '白名单',
	empty: '还没有技能名：/ 菜单里的技能行全部隐藏。',
	addPlaceholder: '添加白名单：技能名或前缀，如 office',
	hint: '写技能名即可；写 office 会同时匹配 office-docx 这类 office-* 子项。留空时 / 菜单不显示技能行。',
	invalid: '技能名无效：只能用小写字母、数字、点、下划线、连字符（如 office）。',
	pickEmpty: '没有可选取的技能名（本地技能目录为空，或都已加入名单）；可直接输入技能名添加。',
};
const SKILL_BLACKLIST_TEXT: ScopeText = {
	title: '黑名单',
	empty: '还没有技能名：/ 菜单显示全部技能。',
	addPlaceholder: '添加黑名单：技能名或前缀，如 office',
	hint: '写技能名即可；写 office 会同时排除 office-docx 这类 office-* 子项。',
	invalid: '技能名无效：只能用小写字母、数字、点、下划线、连字符（如 office）。',
	pickEmpty: '没有可选取的技能名（本地技能目录为空，或都已加入名单）；可直接输入技能名添加。',
};

const COMMAND_WHITELIST_TEXT: ScopeText = {
	title: '白名单',
	empty: '还没有命令名：/ 菜单里的 dsh 命令行全部隐藏。',
	addPlaceholder: '添加白名单：命令名，如 compact',
	hint: '写 dsh 命令名即可（精确匹配，如 compact / goal / permission）；留空时 / 菜单不显示 dsh 命令行。',
	invalid: '命令名无效：只能以小写字母开头，可含数字、下划线、连字符（如 compact、goal）。',
	pickEmpty: '没有可选取的命令名（需要先打开原生聊天面板读取当前会话命令目录，或都已加入名单）；可直接输入命令名添加。',
};
const COMMAND_BLACKLIST_TEXT: ScopeText = {
	title: '黑名单',
	empty: '还没有命令名：/ 菜单显示全部 dsh 命令。',
	addPlaceholder: '添加黑名单：命令名，如 goal',
	hint: '写 dsh 命令名即可（精确匹配）；例如添加 goal 后 /goal 不再出现在菜单里。',
	invalid: '命令名无效：只能以小写字母开头，可含数字、下划线、连字符（如 compact、goal）。',
	pickEmpty: '没有可选取的命令名（需要先打开原生聊天面板读取当前会话命令目录，或都已加入名单）；可直接输入命令名添加。',
};

/** 范围面板的渲染参数：条目归一化 +（可选）缺失标记 + 缓存候选来源。 */
interface ScopePanelOptions {
	text: ScopeText;
	/** 列表本身（设置对象里的数组，增删直接改它）。 */
	values: string[];
	/** 输入归一化；非法返回 null。 */
	normalize: (raw: string) => string | null;
	/** 可选：条目不存在时置灰并标注（@ 的 vault 路径用；技能名没有可校验的来源）。 */
	missing?: (value: string) => boolean;
	/** 「选取」按钮的候选来源：@ = vault 路径，/ = 本地技能目录 / dsh 命令目录；不传则不渲染「选取」。 */
	pickKind?: 'path' | 'skill' | 'command';
	/** 现取候选（已排除名单里已有 / 被覆盖的条目；失败时抛错由面板兜底）。 */
	pick?: () => Promise<ScopeCandidate[]>;
}

/** 范围设置卡片的渲染参数（0039）：徽标 + 标题 + 模式下拉 + 说明，启用时再挂名单详情。 */
interface ScopeCardOptions {
	/** 卡片头的字符徽标：@ 或 /（一眼看出名单归属）。 */
	glyph: string;
	title: string;
	desc: string;
	mode: ScopeMode;
	onChange: (mode: ScopeMode) => Promise<void>;
}

/**
 * 画一张范围设置卡片：卡片头（徽标 / 标题 / 三档下拉）+ 说明行。
 * 「不启用」时返回 null（不渲染详情）；否则返回卡片 body，由调用方挂名单面板。
 */
function renderScopeCard(containerEl: HTMLElement, options: ScopeCardOptions): HTMLElement | null {
	const cardEl = containerEl.createDiv({ cls: 'dsh-settings-scope-card' });
	const headerEl = cardEl.createDiv({ cls: 'dsh-settings-scope-card-header' });
	const badgeEl = headerEl.createDiv({ cls: 'dsh-settings-scope-badge', text: options.glyph });
	badgeEl.setAttr('aria-hidden', 'true');
	headerEl.createDiv({ cls: 'dsh-settings-scope-card-title', text: options.title });
	const selectEl = headerEl.createEl('select', { cls: 'dropdown dsh-settings-scope-mode' });
	selectEl.setAttr('aria-label', options.title + '模式');
	for (const option of [
		{ value: 'off', label: '不启用' },
		{ value: 'whitelist', label: '白名单' },
		{ value: 'blacklist', label: '黑名单' },
	]) {
		selectEl.createEl('option', { text: option.label, value: option.value });
	}
	selectEl.value = options.mode;
	selectEl.onchange = () => {
		void options.onChange(selectEl.value as ScopeMode);
	};
	cardEl.createDiv({ cls: 'dsh-settings-scope-card-desc', text: options.desc });
	if (options.mode === 'off') return null;
	return cardEl.createDiv({ cls: 'dsh-settings-scope-card-body' });
}

/** 「@」引用范围：一张卡片（标题 + 模式）内挂白名单 / 黑名单详情（0030）+ 选取按钮（0038、0039）。 */
function renderMentionScope(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;
	const mode = host.settings.mentionScope;
	const bodyEl = renderScopeCard(containerEl, {
		glyph: '@',
		title: '引用范围',
		desc: '限制输入框 @ 菜单可检索的项目：白名单只列列出的路径，黑名单排除列出的路径；「当前笔记」始终保留。',
		mode,
		onChange: async (next) => {
			host.settings.mentionScope = next;
			await host.saveSettings();
			// 必须重绘：白名单 / 黑名单的详情只在选中时出现。
			context.refresh();
		},
	});
	if (bodyEl === null) return;
	const isWhitelist = mode === 'whitelist';
	const values = isWhitelist ? host.settings.mentionWhitelist : host.settings.mentionBlacklist;
	renderScopePanel(bodyEl, context, {
		text: isWhitelist ? MENTION_WHITELIST_TEXT : MENTION_BLACKLIST_TEXT,
		values,
		normalize: normalizeScopePath,
		missing: (path) => context.app.vault.getAbstractFileByPath(path) === null,
		pickKind: 'path',
		pick: async () =>
			listPathCandidates(vaultPathEntries(context.app), values).map((entry) => ({
				value: entry.path,
				kind: entry.kind,
			})),
	});
}

/** 「/」技能范围：一张卡片（标题 + 模式）内挂白名单 / 黑名单详情（0037）+ 选取按钮（0038、0039）。 */
function renderSkillScope(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;
	const mode = host.settings.skillScope;
	const bodyEl = renderScopeCard(containerEl, {
		glyph: '/',
		title: '技能范围',
		desc: '限制输入框 / 菜单里显示的技能行：白名单只显示列出的技能，黑名单隐藏列出的技能。只影响菜单显示，技能加载与调用不受影响。',
		mode,
		onChange: async (next) => {
			host.settings.skillScope = next;
			await host.saveSettings();
			context.refresh();
		},
	});
	if (bodyEl === null) return;
	const isWhitelist = mode === 'whitelist';
	const values = isWhitelist ? host.settings.skillWhitelist : host.settings.skillBlacklist;
	renderScopePanel(bodyEl, context, {
		text: isWhitelist ? SKILL_WHITELIST_TEXT : SKILL_BLACKLIST_TEXT,
		values,
		normalize: normalizeScopeName,
		pickKind: 'skill',
		pick: async () => {
			const names = await host.getSkillCandidates();
			const normalized = names
				.map((name) => normalizeScopeName(name))
				.filter((name): name is string => name !== null);
			return listSkillCandidates(normalized, values).map((name) => ({
				value: name,
				kind: 'skill' as const,
			}));
		},
	});
}

/** 「/」命令范围（0050）：dsh 命令名精确匹配；没有「选取」候选源，只能手动输入。 */
function renderCommandScope(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;
	const mode = host.settings.commandScope;
	const bodyEl = renderScopeCard(containerEl, {
		glyph: '⌘',
		title: '命令范围',
		desc: '限制输入框 / 菜单里显示的 dsh 命令（来自当前会话的命令目录）：白名单只显示列出的命令，黑名单隐藏列出的命令。只影响菜单显示，命令执行与技能加载 / 调用不受影响。',
		mode,
		onChange: async (next) => {
			host.settings.commandScope = next;
			await host.saveSettings();
			context.refresh();
		},
	});
	if (bodyEl === null) return;
	const isWhitelist = mode === 'whitelist';
	const values = isWhitelist ? host.settings.commandWhitelist : host.settings.commandBlacklist;
	renderScopePanel(bodyEl, context, {
		text: isWhitelist ? COMMAND_WHITELIST_TEXT : COMMAND_BLACKLIST_TEXT,
		values,
		normalize: normalizeCommandName,
		pickKind: 'command',
		pick: async () => {
			const names = await host.getCommandCandidates();
			const normalized = names
				.map((name) => normalizeCommandName(name))
				.filter((name): name is string => name !== null);
			return listCommandCandidates(normalized, values).map((name) => ({
				value: name,
				kind: 'command' as const,
			}));
		},
	});
}

/** 模式下方的作用范围块：标题 / 列表（空提示）/ 选取 + 添加栏 / 提示行。 */
function renderScopePanel(
	containerEl: HTMLElement,
	context: SettingsRenderContext,
	options: ScopePanelOptions,
): void {
	const { text, values } = options;
	const scopeEl = containerEl.createDiv({ cls: 'dsh-settings-scope' });
	scopeEl.createDiv({
		cls: 'dsh-settings-scope-title',
		text: text.title + '（' + String(values.length) + '）',
	});

	if (values.length === 0) {
		scopeEl.createDiv({ cls: 'dsh-settings-scope-empty', text: text.empty });
	} else {
		const listEl = scopeEl.createDiv({ cls: 'dsh-settings-scope-list' });
		for (const value of values) {
			renderScopeItem(listEl, value, options, context);
		}
	}

	// 0038：行首「选取」按钮 —— 自动获取符合条件的候选，点选后只回填输入框（不直接提交）。
	// 0050：命令范围没有现成候选源（dsh 命令目录只在面板打开时经桥可得），不传 pick 就不渲染按钮。
	const addEl = scopeEl.createDiv({ cls: 'dsh-settings-scope-add' });
	const pick = options.pick;
	const pickKind = options.pickKind;
	const pickEl =
		pick === undefined
			? null
			: addEl.createEl('button', { cls: 'dsh-settings-scope-button' });
	if (pickEl !== null && pickKind !== undefined) {
		pickEl.addClass('dsh-settings-scope-pick');
		pickEl.setAttr('type', 'button');
		pickEl.setAttr(
			'title',
			pickKind === 'path'
				? '从 vault 选取路径'
				: pickKind === 'skill'
					? '从本地技能目录选取技能名'
					: '从当前会话的 dsh 命令目录选取命令名（需原生聊天面板已打开）',
		);
		pickEl.setAttr('aria-label', pickEl.getAttr('title') ?? '选取');
		setIcon(pickEl, 'search');
		pickEl.createSpan({ cls: 'dsh-settings-scope-pick-label', text: '选取' });
	}

	const inputEl = addEl.createEl('input', { cls: 'dsh-settings-scope-input', type: 'text' });
	inputEl.placeholder = text.addPlaceholder;
	const addButtonEl = addEl.createEl('button', { cls: 'dsh-settings-scope-button', text: '添加' });
	addButtonEl.setAttr('type', 'button');

	const hintEl = scopeEl.createDiv({ cls: 'dsh-settings-scope-hint', text: text.hint });

	const resetHint = (): void => {
		hintEl.removeClass('is-error');
		hintEl.setText(text.hint);
	};

	const submit = async (): Promise<void> => {
		// 每次提交先把上一轮的错误状态清掉。
		resetHint();
		const value = options.normalize(inputEl.value);
		if (value === null) {
			hintEl.setText(text.invalid);
			hintEl.addClass('is-error');
			return;
		}
		if (options.values.includes(value)) {
			hintEl.setText('已经在列表里：' + value);
			hintEl.addClass('is-error');
			return;
		}
		options.values.push(value);
		await context.host.saveSettings();
		context.refresh();
	};

	addButtonEl.onclick = () => {
		void submit();
	};
	inputEl.onkeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submit();
	};

	/** 选中候选后回填：只写输入框并聚焦，提交仍走「添加」/ 回车（B1）。 */
	const fillInput = (value: string): void => {
		inputEl.value = value;
		resetHint();
		inputEl.focus();
		const end = inputEl.value.length;
		inputEl.setSelectionRange(end, end);
	};

	const openPicker = async (): Promise<void> => {
		if (pickEl === null || pick === undefined || pickKind === undefined) return;
		if (pickEl.disabled) return;
		pickEl.disabled = true;
		resetHint();
		if (pickKind === 'skill') hintEl.setText('正在读取本地技能目录…');
		if (pickKind === 'command') hintEl.setText('正在读取 dsh 命令目录…');
		try {
			const items = await pick();
			if (context.isStale() || !pickEl.isConnected) return;
			if (items.length === 0) {
				hintEl.setText(text.pickEmpty);
				return;
			}
			resetHint();
			new ScopePickerModal(context.app, items, pickKind, fillInput).open();
		} catch (error) {
			if (context.isStale() || !pickEl.isConnected) return;
			hintEl.setText('读取候选失败：' + errorText(error) + '；可直接输入。');
			hintEl.addClass('is-error');
		} finally {
			pickEl.disabled = false;
		}
	};

	if (pickEl !== null) {
		pickEl.onclick = () => {
			void openPicker();
		};
	}
}

/** 单条条目：值（路径不存在时置灰并标注）+ 移除按钮，@ 与 / 共用。 */
function renderScopeItem(
	listEl: HTMLElement,
	value: string,
	options: ScopePanelOptions,
	context: SettingsRenderContext,
): void {
	const itemEl = listEl.createDiv({ cls: 'dsh-settings-scope-item' });
	const valueEl = itemEl.createDiv({ cls: 'dsh-settings-scope-path', text: value });
	valueEl.setAttr('title', value);
	if (options.missing !== undefined && options.missing(value)) {
		valueEl.addClass('is-missing');
		itemEl.createDiv({ cls: 'dsh-settings-scope-missing', text: '路径不存在' });
	}
	const removeEl = itemEl.createEl('button', { cls: 'dsh-settings-scope-remove' });
	removeEl.setAttr('type', 'button');
	removeEl.setAttr('aria-label', '移除 ' + value);
	removeEl.setAttr('title', '移除 ' + value);
	setIcon(removeEl, 'x');
	removeEl.onclick = async () => {
		const index = options.values.indexOf(value);
		if (index !== -1) options.values.splice(index, 1);
		await context.host.saveSettings();
		context.refresh();
	};
}

/** vault 里的文件 / 文件夹快照（与 @ 菜单同源）。 */
function vaultPathEntries(app: App): ScopePathEntry[] {
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
class ScopePickerModal extends SuggestModal<ScopeCandidate> {
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
