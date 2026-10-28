import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
	NativeCommand,
	NativeContextUsage,
	NativeModels,
	NativeNote,
	NativePermissions,
	NativeSkill,
} from '../../../shared/native-types';
import {
	activeMentionToken,
	completeMention,
	formatMention,
	listMentionCandidates,
	mentionsQuery,
	MENTION_LIMIT,
	type MentionEntry,
	type MentionToken,
} from '../mention';
import {
	activeSlashToken,
	formatCommandReference,
	formatSkillReference,
	slashCommandItems,
	slashSkillItems,
	type SlashItem,
	type SlashToken,
} from '../slash';
import {
	filterSlashCommands,
	filterUnsupportedCommands,
	hideCommandNamedSkills,
	leadingCommandLine,
} from '../command-scope';
import { filterSlashSkills } from '../skill-scope';
import type { CommandScope, SkillScope } from '../../../settings/schema';
import { ContextRing } from './context-meter';
import { Icon } from './icon';
import { MentionMenu, type MentionItem } from './mention-menu';
import { modelChip, WhaleMark } from './model-brand';
import { PermissionIcon } from './permission-icon';
import { RunStatus } from './run-status';
import { SlashMenu } from './slash-menu';

const INPUT_MIN_HEIGHT = 72;
const INPUT_MAX_HEIGHT = 240;

const NOTE_LABEL = '当前笔记';
const FILE_SECTION = '文件与文件夹';

function permissionTitle(permissions: NativePermissions | null): string {
	if (permissions === null) return '权限';
	const options = Array.isArray(permissions.options) ? permissions.options : [];
	const option = options.find((entry) => entry.value === permissions.currentValue);
	const name = option?.name ?? permissions.currentValue;
	return option?.description ? name + ' — ' + option.description : name;
}

/** 当前笔记排第一，其余按 dsh 的规则排序；当前笔记不在文件分组里重复出现。 */
function buildMentionItems(
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

export function Composer({
	readOnly,
	currentNote,
	listEntries,
	models,
	permissions,
	context,
	contextOpen,
	onContext,
	showRunStatus,
	runStartedAt,
	running,
	busy,
	ready,
	draft,
	onDraft,
	onSend,
	onStop,
	onModel,
	onPermission,
	onExplainSettings,
	commandsAvailable,
	showCommands,
	onNewSession,
	loadCommands,
	onRunCommand,
	loadSkills,
	getSkillScope,
	getCommandScope,
	pending,
	goalBar,
}: {
	/** 非 null = 只读（一次性 / 类型未知 / 父会话不可用的子会话）：不显示输入框，只保留停止。 */
	readOnly: string | null;
	currentNote: NativeNote | null;
	/** 打开菜单时取一次 vault 快照；按键过滤只在这份快照上跑。 */
	listEntries: () => MentionEntry[];
	models: NativeModels | null;
	permissions: NativePermissions | null;
	context: NativeContextUsage | null;
	contextOpen: boolean;
	onContext: (anchor: DOMRect) => void;
	/** 0048：运行提示是否显示在输入框上方（false = 放在消息流最下方）。 */
	showRunStatus: boolean;
	/** 0047：本轮开始时间（根组件持有，切换显示位置时计时不归零）。 */
	runStartedAt: number | null;
	running: boolean;
	busy: boolean;
	ready: boolean;
	draft: string;
	onDraft: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	onModel: (anchor: DOMRect) => void;
	onPermission: (anchor: DOMRect) => void;
	onExplainSettings: () => void;
	/** 桥 v5 是否可用：命令 / 技能目录依赖它。 */
	commandsAvailable: boolean;
	/** 0050：当前会话是否显示 dsh 命令组（子会话跟随官方隐藏）。 */
	showCommands: boolean;
	/** "/new"：新建会话并切换（复用根组件的 createSession）。 */
	onNewSession: () => void;
	/** 取当前会话的 dsh 命令目录（失败时抛错，菜单里显示原因）；打开 "/" 菜单时刷新。 */
	loadCommands: () => Promise<NativeCommand[]>;
	/** 执行一条 dsh 命令行（根组件走 bridge.executeCommand）；错误由根组件报出。 */
	onRunCommand: (line: string) => Promise<void>;
	/** 取当前会话的技能目录（失败时抛错，菜单里显示原因）；打开 "/" 菜单时拉一次。 */
	loadSkills: () => Promise<NativeSkill[]>;
	/** 设置页的「/」技能范围（0037）；打开菜单时读一次，只过滤菜单里的技能行。 */
	getSkillScope: () => SkillScope;
	/** 设置页的「/」命令范围（0050）；打开菜单时读一次，只过滤菜单里的命令行。 */
	getCommandScope: () => CommandScope;
	pending: ReactNode;
	/** 0052：输入框上方的目标条（有目标时由根组件传入，无目标为 null）。 */
	goalBar: ReactNode;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const entriesRef = useRef<MentionEntry[] | null>(null);
	/** 选中替换期间屏蔽 select/blur 等事件带回来的旧光标，避免菜单被旧 token 重新打开。 */
	const suppressRef = useRef(false);
	const [token, setToken] = useState<MentionToken | null>(null);
	const [active, setActive] = useState(0);
	/** `/` 命令菜单：token、高亮、命令 / 技能快照（同一个列表）。 */
	const [slash, setSlash] = useState<SlashToken | null>(null);
	const [slashActive, setSlashActive] = useState(0);
	const [skills, setSkills] = useState<NativeSkill[] | null>(null);
	const [skillsLoading, setSkillsLoading] = useState(false);
	const [skillsError, setSkillsError] = useState<string | null>(null);
	const [commands, setCommands] = useState<NativeCommand[] | null>(null);
	const [commandsLoading, setCommandsLoading] = useState(false);
	const [commandsError, setCommandsError] = useState<string | null>(null);
	/** 打开菜单时快照的范围设置；null = 还没快照（不过滤）。目录本身仍原样保存。 */
	const [skillScope, setSkillScope] = useState<SkillScope | null>(null);
	const [commandScope, setCommandScope] = useState<CommandScope | null>(null);
	const [compacting, setCompacting] = useState(false);

	useEffect(() => {
		const el = inputRef.current;
		if (el === null) return;
		el.style.removeProperty('height');
		el.style.height =
			Math.max(INPUT_MIN_HEIGHT, Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)) + 'px';
	}, [draft]);

	const items = useMemo<MentionItem[]>(
		() => (token === null ? [] : buildMentionItems(token, currentNote, entriesRef.current ?? [])),
		[token, currentNote],
	);
	const menuOpen = token !== null && items.length > 0;
	/** 菜单里显示的技能行：技能范围（0037）+ 与命令同名时隐藏（0050，命令优先）。 */
	const scopedSkills = useMemo<NativeSkill[] | null>(() => {
		if (skills === null || skillScope === null) return skills;
		return filterSlashSkills(skills, skillScope);
	}, [skills, skillScope]);
	const visibleSkills = useMemo<NativeSkill[] | null>(() => {
		if (scopedSkills === null) return null;
		if (commands === null) return scopedSkills;
		return hideCommandNamedSkills(scopedSkills, commands);
	}, [scopedSkills, commands]);
	/** 菜单里显示的命令行：命令范围（0050）只影响显示；原生不支持的命令已在读取时去掉。 */
	const scopedCommands = useMemo<NativeCommand[]>(() => {
		if (!showCommands || commands === null) return [];
		if (commandScope === null) return commands;
		return filterSlashCommands(commands, commandScope);
	}, [commands, commandScope, showCommands]);
	/** 命令组只在草稿开头（leading）显示，与 dsh 官方触发范围一致。 */
	const slashLeading = useMemo<boolean>(() => {
		if (slash === null) return false;
		return draft.slice(0, slash.start).trim() === '';
	}, [draft, slash]);
	const slashItems = useMemo<SlashItem[]>(() => {
		if (slash === null) return [];
		const commandItems = slashLeading ? slashCommandItems(scopedCommands, slash.query) : [];
		const skillItems =
			visibleSkills === null ? [] : slashSkillItems(visibleSkills, slash.query);
		return [...commandItems, ...skillItems];
	}, [slash, slashLeading, scopedCommands, visibleSkills]);
	/** 命令组拿不到内容时的说明行：桥太旧 / 加载中 / 失败 / 没有命令 / 全被范围过滤。 */
	const commandNote = useMemo<string | null>(() => {
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
	}, [
		slash,
		showCommands,
		slashLeading,
		commandsAvailable,
		commandsLoading,
		commandsError,
		commands,
		scopedCommands,
		commandScope,
	]);
	/** 技能分组拿不到内容时的说明行：加载中 / 读取失败 / 没有技能 / 桥太旧 / 同名隐藏。 */
	const skillNote = useMemo<string | null>(() => {
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
	}, [
		slash,
		commandsAvailable,
		skillsLoading,
		skillsError,
		skills,
		scopedSkills,
		visibleSkills,
	]);
	const slashOpen =
		slash !== null && (slashItems.length > 0 || commandNote !== null || skillNote !== null);

	/** 打开 `/` 菜单时拉一次技能目录：每次重新打开都重取（技能会随插件 / 预设变化）。 */
	const ensureSkills = (): void => {
		if (!commandsAvailable || skillsLoading || skills !== null || skillsError !== null) return;
		setSkillsLoading(true);
		void (async () => {
			try {
				const list = await loadSkills();
				setSkills(list);
			} catch (failure) {
				setSkillsError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setSkillsLoading(false);
			}
		})();
	};

	/** 拉一次命令目录（菜单打开时刷新；目录按会话 / 预设变化；失败保留上一次结果）。 */
	const refreshCommands = (): void => {
		if (!commandsAvailable || !showCommands || commandsLoading) return;
		setCommandsLoading(true);
		setCommandsError(null);
		void (async () => {
			try {
				const list = await loadCommands();
				setCommands(filterUnsupportedCommands(list));
			} catch (failure) {
				setCommandsError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setCommandsLoading(false);
			}
		})();
	};

	useEffect(() => {
		refreshCommands();
		// 只按能力 / 可见性预取；菜单每次打开还会再刷新一次（目录随会话 / 预设变化）。
	}, [commandsAvailable, showCommands]);

	useEffect(() => {
		setActive(0);
	}, [token?.start, token?.query]);

	useEffect(() => {
		setSlashActive(0);
	}, [slash?.start, slash?.query]);

	const sync = (value: string, caret: number): void => {
		if (suppressRef.current || !ready) {
			setToken(null);
			setSlash(null);
			return;
		}
		const nextSlash = activeSlashToken(value, caret);
		if (nextSlash !== null) {
			// `/` 与 `@` 互斥：同一行同时出现时，以光标所在的 token 为准。
			entriesRef.current = null;
			setToken(null);
			// 每次重新打开菜单才快照范围设置（菜单开着时改设置，下一次打开生效）。
			if (slash === null) {
				setSkillScope(getSkillScope());
				setCommandScope(getCommandScope());
				refreshCommands();
			}
			setSlash(nextSlash);
			ensureSkills();
			return;
		}
		if (slash !== null) {
			setSlash(null);
			setSkills(null);
			setSkillsError(null);
			setSkillsLoading(false);
			setSkillScope(null);
			setCommandScope(null);
		}
		const next = activeMentionToken(value, caret);
		if (next === null) {
			entriesRef.current = null;
			setToken(null);
			return;
		}
		if (entriesRef.current === null) entriesRef.current = listEntries();
		setToken(next);
	};

	const close = (): void => {
		entriesRef.current = null;
		setToken(null);
		setSlash(null);
		setSkillScope(null);
		setCommandScope(null);
	};

	/**
	 * 用选中项替换 [token.start, token.end)。
	 * Enter / 鼠标点行 = 采纳（目录也当最终引用，补空格并关菜单）；
	 * Tab / 行内箭头 = 下钻（目录保留结尾斜杠和打开引号，菜单继续展开）。
	 */
	const pick = (item: MentionItem, mode: 'pick' | 'drill'): void => {
		if (token === null) return;
		const drill = mode === 'drill' && item.kind === 'directory';
		const mention =
			item.kind === 'directory' && !drill ? completeMention(item.mention) : item.mention;
		const el = inputRef.current;
		const after = draft.slice(token.end);
		const gap = drill ? '' : after.length === 0 || after[0] !== ' ' ? ' ' : '';
		const inserted = mention + gap;
		const next = draft.slice(0, token.start) + inserted + after;
		const caret = token.start + inserted.length;
		suppressRef.current = true;
		onDraft(next);
		setToken(null);
		if (!drill) entriesRef.current = null;
		window.requestAnimationFrame(() => {
			el?.focus();
			el?.setSelectionRange(caret, caret);
			suppressRef.current = false;
			if (drill) sync(next, caret);
		});
	};

	/**
	 * 用 `text` 替换当前 `/` token（执行命令时传空串 = 把 "/xxx" 从草稿里删掉）。
	 * 与 @ 菜单一样在 rAF 里恢复焦点与光标，并在此期间屏蔽 select/blur 回灌。
	 */
	const replaceSlash = (text: string): void => {
		if (slash === null) return;
		const caret = slash.start + text.length;
		const next = draft.slice(0, slash.start) + text + draft.slice(slash.end);
		suppressRef.current = true;
		onDraft(next);
		setSlash(null);
		setSkills(null);
		setSkillsError(null);
		setSkillsLoading(false);
		setSkillScope(null);
		setCommandScope(null);
		window.requestAnimationFrame(() => {
			const el = inputRef.current;
			el?.focus();
			el?.setSelectionRange(caret, caret);
			suppressRef.current = false;
		});
	};

	/** 提交一条 dsh 命令行：/compact 期间在输入框上方显示进度（沿用 0025 的过程提示）。 */
	const submitCommand = (line: string): void => {
		const compact = /^\/compact(?=$|[\t\n\r ])/u.test(line);
		if (compact) setCompacting(true);
		void (async () => {
			try {
				await onRunCommand(line);
			} finally {
				if (compact) setCompacting(false);
			}
		})();
	};

	const activateSlash = (item: SlashItem): void => {
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
	};

	const chip = modelChip(models);
	const canSend = ready && draft.trim() !== '' && !busy;
	const modelMissing = models !== null && models.groups.length === 0;
	const unroutable = models !== null && models.routable === false;

	return (
		<div className="dsh-native-composer">
			{/* 0054：目标条固定在运行提示下方、紧贴输入卡片——运行提示每轮开关时目标条不会被顶动。 */}
			{showRunStatus ? <RunStatus running={running} startedAt={runStartedAt} /> : null}
			{goalBar}
			{pending}
			{compacting ? (
				<div className="dsh-native-composer-notice" role="status">
					<Icon name="loader" />
					<span>正在压缩会话历史…</span>
				</div>
			) : null}
			{modelMissing || unroutable ? (
				<div className="dsh-native-composer-warning">
					<Icon name="alert-triangle" />
					<span>{modelMissing ? '还没有配置模型' : '当前模型路由不可用'}</span>
					<button onClick={onExplainSettings}>配置说明</button>
				</div>
			) : null}
			{readOnly !== null ? (
				<div className="dsh-native-composer-readonly" role="status">
					<Icon name="info" size={14} />
					<span>{readOnly}</span>
					{running ? (
						<button
							className="dsh-native-send is-stop"
							disabled={busy}
							onClick={onStop}
							title="停止"
						>
							<Icon name="square" />
						</button>
					) : null}
				</div>
			) : (
				<div className="dsh-native-input-wrap">
				{slashOpen ? (
					<SlashMenu
						items={slashItems}
						active={slashActive}
						commandNote={commandNote}
						skillNote={skillNote}
						onActive={setSlashActive}
						onPick={activateSlash}
					/>
				) : null}
				{menuOpen ? (
					<MentionMenu
						items={items}
						active={active}
						onActive={setActive}
						onPick={(item) => pick(item, 'pick')}
						onDrill={(item) => pick(item, 'drill')}
					/>
				) : null}
				<div className="dsh-native-input-shell">
					<textarea
						ref={inputRef}
						className="dsh-native-input"
						rows={1}
						placeholder={
							ready
								? '给 DSH 发消息…（/ 命令，@ 引用文件，Enter 发送）'
								: '选择一个会话后开始'
						}
						value={draft}
						disabled={!ready}
						onChange={(event) => {
							onDraft(event.target.value);
							sync(event.target.value, event.target.selectionStart);
						}}
						onClick={(event) => sync(event.currentTarget.value, event.currentTarget.selectionStart)}
						onKeyUp={(event) => {
							if (
								event.key.startsWith('Arrow') ||
								event.key === 'Home' ||
								event.key === 'End'
							) {
								sync(event.currentTarget.value, event.currentTarget.selectionStart);
							}
						}}
						onBlur={close}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (slashOpen) {
								if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
									event.preventDefault();
									const size = slashItems.length;
									if (size > 0) {
										setSlashActive((value) =>
											event.key === 'ArrowDown'
												? (value + 1) % size
												: (value - 1 + size) % size,
										);
									}
									return;
								}
								if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
									event.preventDefault();
									const index = Math.min(slashActive, Math.max(0, slashItems.length - 1));
									const item = slashItems[index];
									if (item !== undefined) activateSlash(item);
									return;
								}
								if (event.key === 'Escape') {
									event.preventDefault();
									close();
									return;
								}
							}
							if (menuOpen) {
								if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
									event.preventDefault();
									const size = items.length;
									setActive((value) =>
										event.key === 'ArrowDown'
											? (value + 1) % size
											: (value - 1 + size) % size,
									);
									return;
								}
								if (event.key === 'Tab') {
									event.preventDefault();
									const item = items[active] ?? items[0];
									if (item !== undefined) pick(item, 'drill');
									return;
								}
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									const item = items[active] ?? items[0];
									if (item !== undefined) pick(item, 'pick');
									return;
								}
								if (event.key === 'Escape') {
									event.preventDefault();
									close();
									return;
								}
							}
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault();
								// 0050：草稿开头是当前命令目录里的命令 → 交给 dsh 执行，而不是当普通消息发送。
								const known = commands === null ? null : leadingCommandLine(draft, commands);
								if (known !== null && ready && !busy) {
									onDraft('');
									setSlash(null);
									setToken(null);
									submitCommand(known.line);
									return;
								}
								if (canSend) onSend();
							}
						}}
					/>
					<div className="dsh-native-composer-bar">
						<div className="dsh-native-composer-left">
							<button
								className="dsh-native-chip is-model"
								disabled={!ready}
								onClick={(event) => onModel(event.currentTarget.getBoundingClientRect())}
								title={chip.title}
								aria-label={'选择模型：' + chip.title}
							>
								{chip.mark === 'whale' ? <WhaleMark height={14} /> : <Icon name="cpu" />}
								{chip.text === '' ? null : <span>{chip.text}</span>}
							</button>
							{permissions !== null ? (
								<button
									className="dsh-native-chip is-permission"
									disabled={!ready}
									onClick={(event) =>
										onPermission(event.currentTarget.getBoundingClientRect())
									}
									title={permissionTitle(permissions)}
									aria-label={'切换权限：' + permissionTitle(permissions)}
								>
									<PermissionIcon value={permissions.currentValue} />
								</button>
							) : null}
						</div>
						<div className="dsh-native-composer-right">
							<ContextRing
								context={context}
								expanded={contextOpen}
								onClick={onContext}
							/>
							{running ? (
								<button
									className="dsh-native-send is-stop"
									disabled={busy}
									onClick={onStop}
									title="停止"
								>
									<Icon name="square" />
								</button>
							) : (
								<button
									className="dsh-native-send"
									disabled={!canSend}
									onClick={onSend}
									title="发送"
								>
									<Icon name="send" />
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
			)}
		</div>
	);
}
