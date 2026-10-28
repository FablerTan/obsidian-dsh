import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { NativeCommand, NativeNote, NativeSkill } from '../../../shared/native-types';
import type { CommandScope, SkillScope } from '../../../settings/schema';
import {
	formatMention,
	listMentionCandidates,
	mentionsQuery,
	MENTION_LIMIT,
	type MentionEntry,
	type MentionToken,
} from '../mention';
import { filterSlashCommands, hideCommandNamedSkills } from '../command-scope';
import { filterSlashSkills } from '../skill-scope';
import {
	formatCommandReference,
	formatSkillReference,
	slashCommandItems,
	slashSkillItems,
	type SlashItem,
	type SlashToken,
} from '../slash';
import { MentionMenu, type MentionItem } from './mention-menu';
import { SlashMenu } from './slash-menu';

const NOTE_LABEL = '当前笔记';
const FILE_SECTION = '文件与文件夹';

/** 当前笔记排第一，其余按 dsh 的规则排序；当前笔记不在文件分组里重复出现。 */
export function buildMentionItems(
	token: MentionToken,
	note: NativeNote | null,
	entries: readonly MentionEntry[],
): MentionItem[] {
	const items: MentionItem[] = [];
	if (note !== null && mentionsQuery(note.path, token.query)) {
		const mention = formatMention({ path: note.path, kind: 'file' }, token.quoted);
		if (mention !== null) {
			items.push({
				key: 'note',
				kind: 'note',
				label: NOTE_LABEL,
				path: note.path,
				mention,
				// 当前笔记没有分组标题：第一行直接是「当前笔记」，避免标题与行名重复。
				section: '',
			});
		}
	}
	const limit = Math.max(1, MENTION_LIMIT - items.length);
	for (const entry of listMentionCandidates(entries, token.query, limit)) {
		if (note !== null && entry.path === note.path) continue;
		const mention = formatMention(entry, token.quoted);
		if (mention === null) continue;
		items.push({
			key: entry.path,
			kind: entry.kind,
			label: entry.path.slice(entry.path.lastIndexOf('/') + 1),
			path: entry.path,
			mention,
			section: FILE_SECTION,
		});
	}
	return items;
}

interface SlashView {
	items: SlashItem[];
	commandNote: string | null;
	skillNote: string | null;
	open: boolean;
}

interface SlashViewSource {
	slash: SlashToken | null;
	draft: string;
	commands: NativeCommand[] | null;
	skills: NativeSkill[] | null;
	commandsAvailable: boolean;
	showCommands: boolean;
	commandsLoading: boolean;
	commandsError: string | null;
	skillsLoading: boolean;
	skillsError: string | null;
	skillScope: SkillScope | null;
	commandScope: CommandScope | null;
}

/** 命令组拿不到内容时的说明行：桥太旧 / 加载中 / 失败 / 没有命令 / 全被范围过滤。 */
function commandNoteOf(
	source: SlashViewSource,
	slashLeading: boolean,
	scopedCommands: readonly NativeCommand[],
): string | null {
	const {
		slash,
		showCommands,
		commandsAvailable,
		commandsLoading,
		commandsError,
		commands,
		commandScope,
	} = source;
	if (slash === null || !showCommands || !slashLeading) return null;
	if (!commandsAvailable) return '命令列表需要更新 dsh-obsidian-bridge 并重启 DSH 服务';
	if (commandsLoading && commands === null) return '正在读取命令列表…';
	if (commandsError !== null) return '读取命令列表失败：' + commandsError;
	if (commands !== null && commands.length === 0) return '当前会话没有可用命令';
	if (scopedCommands.length === 0) {
		if (commandScope !== null && commandScope.mode !== 'off') {
			return '命令行已按「/」命令范围过滤：当前没有可显示命令';
		}
		return '当前会话没有可显示命令';
	}
	return null;
}

/** 技能分组拿不到内容时的说明行：加载中 / 读取失败 / 没有技能 / 桥太旧 / 同名隐藏。 */
function skillNoteOf(
	source: SlashViewSource,
	scopedSkills: NativeSkill[] | null,
	visibleSkills: NativeSkill[] | null,
): string | null {
	const { slash, commandsAvailable, skillsLoading, skillsError, skills } = source;
	if (slash === null) return null;
	if (!commandsAvailable) return '技能列表需要更新 dsh-obsidian-bridge 并重启 DSH 服务';
	if (skillsLoading) return '正在读取技能列表…';
	if (skillsError !== null) return '读取技能列表失败：' + skillsError;
	if (skills !== null && skills.length === 0) return '当前会话没有可用技能';
	if (scopedSkills !== null && scopedSkills.length === 0) {
		return '技能行已按「/」技能范围过滤：当前没有可显示技能';
	}
	if (visibleSkills !== null && visibleSkills.length === 0) {
		return '同名技能行已隐藏：dsh 命令优先';
	}
	return null;
}

export function buildSlashView(source: SlashViewSource): SlashView {
	const { slash, draft, commands, skills, showCommands, skillScope, commandScope } = source;
	/** 菜单里显示的技能行：技能范围（0037）+ 与命令同名时隐藏（0050，命令优先）。 */
	const scopedSkills =
		skills === null || skillScope === null ? skills : filterSlashSkills(skills, skillScope);
	const visibleSkills =
		scopedSkills === null
			? null
			: commands === null
				? scopedSkills
				: hideCommandNamedSkills(scopedSkills, commands);
	/** 菜单里显示的命令行：命令范围（0050）只影响显示；原生不支持的命令已在读取时去掉。 */
	const scopedCommands =
		!showCommands || commands === null
			? []
			: commandScope === null
				? commands
				: filterSlashCommands(commands, commandScope);
	/** 命令组只在草稿开头（leading）显示，与 dsh 官方触发范围一致。 */
	const slashLeading = slash === null ? false : draft.slice(0, slash.start).trim() === '';
	const items =
		slash === null
			? []
			: [
					...(slashLeading ? slashCommandItems(scopedCommands, slash.query) : []),
					...(visibleSkills === null ? [] : slashSkillItems(visibleSkills, slash.query)),
				];
	const commandNote = commandNoteOf(source, slashLeading, scopedCommands);
	const skillNote = skillNoteOf(source, scopedSkills, visibleSkills);
	return {
		items,
		commandNote,
		skillNote,
		open: slash !== null && (items.length > 0 || commandNote !== null || skillNote !== null),
	};
}

export function ComposerMenuLayer({
	slashOpen,
	slashItems,
	slashActive,
	commandNote,
	skillNote,
	onSlashActive,
	onSlashPick,
	menuOpen,
	items,
	active,
	onActive,
	onPick,
	onDrill,
}: {
	slashOpen: boolean;
	slashItems: SlashItem[];
	slashActive: number;
	commandNote: string | null;
	skillNote: string | null;
	onSlashActive: (index: number) => void;
	onSlashPick: (item: SlashItem) => void;
	menuOpen: boolean;
	items: MentionItem[];
	active: number;
	onActive: (index: number) => void;
	onPick: (item: MentionItem) => void;
	onDrill: (item: MentionItem) => void;
}) {
	return (
		<>
			{slashOpen ? (
				<SlashMenu
					items={slashItems}
					active={slashActive}
					commandNote={commandNote}
					skillNote={skillNote}
					onActive={onSlashActive}
					onPick={onSlashPick}
				/>
			) : null}
			{menuOpen ? (
				<MentionMenu
					items={items}
					active={active}
					onActive={onActive}
					onPick={onPick}
					onDrill={onDrill}
				/>
			) : null}
		</>
	);
}

export function activateSlashItem(
	item: SlashItem,
	replaceSlash: (text: string) => void,
	onNewSession: () => void,
): void {
	if (item.disabled) return;
	if (item.kind === 'skill') {
		replaceSlash(formatSkillReference(item.name));
		return;
	}
	if (item.kind === 'local') {
		replaceSlash('');
		onNewSession();
		return;
	}
	// dsh 命令：只写入草稿（可继续补参数），发送时由 Enter 分支走 executeCommand。
	replaceSlash(formatCommandReference(item.name));
}

interface MenuKeyboard {
	slashOpen: boolean;
	slashItems: readonly SlashItem[];
	slashActive: number;
	onSlashActive: (value: number | ((current: number) => number)) => void;
	activateSlash: (item: SlashItem) => void;
	menuOpen: boolean;
	items: readonly MentionItem[];
	active: number;
	onActive: (value: number | ((current: number) => number)) => void;
	pick: (item: MentionItem, mode: 'pick' | 'drill') => void;
	close: () => void;
}

export function handleMenuKeyDown(
	event: ReactKeyboardEvent<HTMLTextAreaElement>,
	menu: MenuKeyboard,
): boolean {
	if (menu.slashOpen) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const size = menu.slashItems.length;
			if (size > 0) {
				menu.onSlashActive((value) =>
					event.key === 'ArrowDown' ? (value + 1) % size : (value - 1 + size) % size,
				);
			}
			return true;
		}
		if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
			event.preventDefault();
			const index = Math.min(menu.slashActive, Math.max(0, menu.slashItems.length - 1));
			const item = menu.slashItems[index];
			if (item !== undefined) menu.activateSlash(item);
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			menu.close();
			return true;
		}
	}
	if (menu.menuOpen) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const size = menu.items.length;
			menu.onActive((value) =>
				event.key === 'ArrowDown' ? (value + 1) % size : (value - 1 + size) % size,
			);
			return true;
		}
		if (event.key === 'Tab') {
			event.preventDefault();
			const item = menu.items[menu.active] ?? menu.items[0];
			if (item !== undefined) menu.pick(item, 'drill');
			return true;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			const item = menu.items[menu.active] ?? menu.items[0];
			if (item !== undefined) menu.pick(item, 'pick');
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			menu.close();
			return true;
		}
	}
	return false;
}
