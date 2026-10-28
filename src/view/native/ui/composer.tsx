import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeCommand, NativeSkill } from '../../../shared/native-types';
import {
	activeMentionToken,
	completeMention,
	type MentionEntry,
	type MentionToken,
} from '../mention';
import { activeSlashToken, type SlashItem, type SlashToken } from '../slash';
import { filterUnsupportedCommands, leadingCommandLine } from '../command-scope';
import type { CommandScope, SkillScope } from '../../../settings/schema';
import {
	ComposerBar,
	ComposerNotices,
	ComposerReadOnlyNotice,
} from './composer-accessories';
import {
	activateSlashItem,
	buildMentionItems,
	buildSlashView,
	ComposerMenuLayer,
	handleMenuKeyDown,
} from './composer-mentions';
import type { ComposerProps } from './composer-props';
import type { MentionItem } from './mention-menu';
import { QuotePreview } from './quote-preview';
import { RunStatus } from './run-status';

const INPUT_MIN_HEIGHT = 72;
const INPUT_MAX_HEIGHT = 240;

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
	quote,
	quoteLimit,
	onCaptureQuote,
	onOpenQuote,
	onClearQuote,
}: ComposerProps) {
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
	const slashView = useMemo(
		() =>
			buildSlashView({
				slash, draft, commands, skills, commandsAvailable, showCommands,
				commandsLoading, commandsError, skillsLoading, skillsError, skillScope, commandScope,
			}),
		[slash, draft, commands, skills, commandsAvailable, showCommands, commandsLoading, commandsError, skillsLoading, skillsError, skillScope, commandScope],
	);
	const slashOpen = slashView.open;

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

	const activateSlash = (item: SlashItem): void =>
		activateSlashItem(item, replaceSlash, onNewSession);

	const canSend = ready && draft.trim() !== '' && !busy;
	const modelMissing = models !== null && models.groups.length === 0;
	const unroutable = models !== null && models.routable === false;

	return (
		<div className="dsh-native-composer" onMouseDownCapture={onCaptureQuote}>
			{/* 0054：目标条固定在运行提示下方、紧贴输入卡片——运行提示每轮开关时目标条不会被顶动。 */}
			{showRunStatus ? <RunStatus running={running} startedAt={runStartedAt} /> : null}
			{goalBar}
			{pending}
			<ComposerNotices
				compacting={compacting}
				modelMissing={modelMissing}
				unroutable={unroutable}
				onExplainSettings={onExplainSettings}
			/>
			{readOnly !== null ? (
				<ComposerReadOnlyNotice readOnly={readOnly} running={running} busy={busy} onStop={onStop} />
			) : (
				<div className="dsh-native-input-wrap">
					<ComposerMenuLayer
						slashOpen={slashOpen}
						slashItems={slashView.items}
						slashActive={slashActive}
						commandNote={slashView.commandNote}
						skillNote={slashView.skillNote}
						onSlashActive={setSlashActive}
						onSlashPick={activateSlash}
						menuOpen={menuOpen}
						items={items}
						active={active}
						onActive={setActive}
						onPick={(item) => pick(item, 'pick')}
						onDrill={(item) => pick(item, 'drill')}
					/>
					{quote !== null ? (
						<QuotePreview
							quote={quote}
							limit={quoteLimit}
							onOpen={onOpenQuote}
							onClear={onClearQuote}
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
							onFocus={onCaptureQuote}
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
								if (
									handleMenuKeyDown(event, {
										slashOpen,
										slashItems: slashView.items,
										slashActive,
										onSlashActive: setSlashActive,
										activateSlash,
										menuOpen,
										items,
										active,
										onActive: setActive,
										pick,
										close,
									})
								) {
									return;
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
						<ComposerBar
							ready={ready}
							models={models}
							permissions={permissions}
							context={context}
							contextOpen={contextOpen}
							onContext={onContext}
							onModel={onModel}
							onPermission={onPermission}
							running={running}
							busy={busy}
							canSend={canSend}
							onSend={onSend}
							onStop={onStop}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
