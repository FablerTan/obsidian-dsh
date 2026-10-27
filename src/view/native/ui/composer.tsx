import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
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
	formatSkillReference,
	slashCommandItems,
	slashSkillItems,
	type SlashItem,
	type SlashToken,
} from '../slash';
import { filterSlashSkills } from '../skill-scope';
import type { SkillScope } from '../../../settings/schema';
import { ContextRing } from './context-meter';
import { Icon } from './icon';
import { MentionMenu, type MentionItem } from './mention-menu';
import { modelChip, WhaleMark } from './model-brand';
import { PermissionIcon } from './permission-icon';
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
	currentNote,
	listEntries,
	models,
	permissions,
	context,
	contextOpen,
	onContext,
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
	onNewSession,
	onCompact,
	loadSkills,
	getSkillScope,
	pending,
}: {
	currentNote: NativeNote | null;
	/** 打开菜单时取一次 vault 快照；按键过滤只在这份快照上跑。 */
	listEntries: () => MentionEntry[];
	models: NativeModels | null;
	permissions: NativePermissions | null;
	context: NativeContextUsage | null;
	contextOpen: boolean;
	onContext: (anchor: DOMRect) => void;
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
	/** 桥 v5 是否可用：compact / skills 依赖它的命令与技能目录。 */
	commandsAvailable: boolean;
	/** "/new"：新建会话并切换（复用根组件的 createSession）。 */
	onNewSession: () => void;
	/** "/compact"：提交宿主压缩命令；错误由根组件报出。 */
	onCompact: () => Promise<void>;
	/** 取当前会话的技能目录（失败时抛错，菜单里显示原因）；打开 "/" 菜单时拉一次。 */
	loadSkills: () => Promise<NativeSkill[]>;
	/** 设置页的「/」技能范围（0037）；打开菜单时读一次，只过滤菜单里的技能行。 */
	getSkillScope: () => SkillScope;
	pending: ReactNode;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const entriesRef = useRef<MentionEntry[] | null>(null);
	/** 选中替换期间屏蔽 select/blur 等事件带回来的旧光标，避免菜单被旧 token 重新打开。 */
	const suppressRef = useRef(false);
	const [token, setToken] = useState<MentionToken | null>(null);
	const [active, setActive] = useState(0);
	/** `/` 命令菜单：token、高亮与技能快照（命令 + 技能同一个列表）。 */
	const [slash, setSlash] = useState<SlashToken | null>(null);
	const [slashActive, setSlashActive] = useState(0);
	const [skills, setSkills] = useState<NativeSkill[] | null>(null);
	const [skillsLoading, setSkillsLoading] = useState(false);
	const [skillsError, setSkillsError] = useState<string | null>(null);
	/** 打开菜单时快照的范围设置；null = 还没快照（不过滤）。技能目录本身仍原样保存。 */
	const [skillScope, setSkillScope] = useState<SkillScope | null>(null);
	const [compacting, setCompacting] = useState(false);

	useEffect(() => {
		const el = inputRef.current;
		if (el === null) return;
		el.style.height = 'auto';
		el.style.height =
			Math.max(INPUT_MIN_HEIGHT, Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)) + 'px';
	}, [draft]);

	const items = useMemo<MentionItem[]>(
		() => (token === null ? [] : buildMentionItems(token, currentNote, entriesRef.current ?? [])),
		[token, currentNote],
	);
	const menuOpen = token !== null && items.length > 0;
	/** 菜单里显示的技能行：按「/」技能范围过滤（0037），只影响显示，不改 loadSkills 的结果。 */
	const scopedSkills = useMemo<NativeSkill[] | null>(() => {
		if (skills === null || skillScope === null) return skills;
		return filterSlashSkills(skills, skillScope);
	}, [skills, skillScope]);
	const slashItems = useMemo<SlashItem[]>(() => {
		if (slash === null) return [];
		const commands = slashCommandItems(slash.query, commandsAvailable);
		if (scopedSkills === null) return commands;
		return [...commands, ...slashSkillItems(scopedSkills, slash.query)];
	}, [slash, scopedSkills, commandsAvailable]);
	/** 技能分组拿不到内容时的说明行：加载中 / 读取失败 / 没有技能 / 桥太旧。 */
	const slashNote = useMemo<string | null>(() => {
		if (slash === null) return null;
		if (!commandsAvailable) return '技能列表需要更新 dsh-obsidian-bridge 并重启 DSH 服务';
		if (skillsLoading) return '正在读取技能列表…';
		if (skillsError !== null) return '读取技能列表失败：' + skillsError;
		if (skills !== null && skills.length === 0) return '当前会话没有可用技能';
		if (skills !== null && scopedSkills !== null && scopedSkills.length === 0) {
			return '技能行已按「/」技能范围过滤：当前没有可显示技能';
		}
		return null;
	}, [slash, commandsAvailable, skillsLoading, skillsError, skills, scopedSkills]);
	const slashOpen = slash !== null && (slashItems.length > 0 || slashNote !== null);

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
			if (slash === null) setSkillScope(getSkillScope());
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
		window.requestAnimationFrame(() => {
			const el = inputRef.current;
			el?.focus();
			el?.setSelectionRange(caret, caret);
			suppressRef.current = false;
		});
	};

	/** `/compact`：先收起菜单、清掉 token，再让根组件提交宿主命令；期间输入框上方显示进度。 */
	const runCompact = (): void => {
		if (compacting) return;
		replaceSlash('');
		setCompacting(true);
		void (async () => {
			try {
				await onCompact();
			} finally {
				setCompacting(false);
			}
		})();
	};

	const activateSlash = (item: SlashItem): void => {
		if (item.disabled) return;
		if (item.kind === 'skill') {
			replaceSlash(formatSkillReference(item.name));
			return;
		}
		if (item.name === 'new') {
			replaceSlash('');
			onNewSession();
			return;
		}
		if (item.name === 'compact') runCompact();
	};

	const chip = modelChip(models);
	const canSend = ready && draft.trim() !== '' && !busy;
	const modelMissing = models !== null && models.groups.length === 0;
	const unroutable = models !== null && models.routable === false;

	return (
		<div className="dsh-native-composer">
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
			<div className="dsh-native-input-wrap">
				{slashOpen ? (
					<SlashMenu
						items={slashItems}
						active={slashActive}
						note={slashNote}
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
		</div>
	);
}
