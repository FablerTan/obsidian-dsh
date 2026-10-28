import { Notice, TFolder, type App } from 'obsidian';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
	NativeChatLive,
	NativeChatSnapshot,
	NativeContextUsage,
	NativeGoal,
	NativeModelSelection,
	NativeModels,
	NativeNote,
	NativePending,
	NativePermissions,
	NativeQuestionAnswer,
	NativeSessionSummary,
	NativeSubagentAddress,
	NativeSubagentEntry,
	NativeSubagentList,
	NativeTeamProjection,
} from '../../../shared/native-types';
import { sleep } from '../../../shared/async';
import { errorText } from '../../../shared/errors';
import { projectPathWithin, vaultPath } from '../../../shared/host';
import {
	streamRefreshMs,
	type CommandScope,
	type MentionScope,
	type RunStatusPlacement,
	type SkillScope,
	type StreamRefreshMode,
} from '../../../settings/schema';
import { NativeBridgeError } from '../../../shared/native-types';
import type { NativeCoreBridge } from '../core-bridge';
import { describeNativeBridgeError } from '../core-bridge';
import type { MentionEntry } from '../mention';
import { filterMentionEntries } from '../mention-scope';
import type { NoteTracker } from '../note-tracker';
import {
	captureSelectionQuote,
	jumpToQuote,
	observeEditorSelection,
} from '../editor-selection';
import { formatQuote, quoteKey, type SelectionQuote } from '../quote';
import { Composer } from './composer';
import { ContextDetails } from './context-meter';
import { GoalBar } from './goal-bar';
import { Icon } from './icon';
import { ModelMenu } from './model-menu';
import { PermissionMenu } from './permission-menu';
import { RenameSessionModal, SessionMenu } from './session-menu';
import { PendingCard } from './pending';
import { SessionPicker } from './session-picker';
import { SubagentPanel } from './subagent-panel';
import { TeamPanel } from './team-panel';
import { RunStatus } from './run-status';
import { Timeline } from './timeline';
import { detectSilentTurnEnd } from './turn-end';
import { TurnEndHint } from './turn-end-hint';

type Phase = 'booting' | 'ready' | 'error';

const NEW_SESSION_TITLE = '新会话';

const SUBAGENT_MODE_TEXT: Record<'one-shot' | 'continuable' | 'unknown', string> = {
	continuable: '可继续',
	'one-shot': '一次性',
	unknown: '未知类型',
};

/**
 * 0052：目标条的渲染数据是否与上一份相同。
 * 快照每次刷新都会重渲染整棵面板，目标条没必要跟着重挂；数据没变就复用旧对象。
 */
function sameGoal(left: NativeGoal | null, right: NativeGoal | null): boolean {
	if (left === null || right === null) return left === right;
	return (
		left.id === right.id &&
		left.revision === right.revision &&
		left.objective === right.objective &&
		left.phase === right.phase &&
		left.activation === right.activation &&
		(left.blockedReason?.code ?? null) === (right.blockedReason?.code ?? null) &&
		(left.blockedReason?.message ?? null) === (right.blockedReason?.message ?? null)
	);
}

/**
 * DSH 会用工作目录名（或空串）给还没有标题的新会话兜底；展示时统一换成「新会话」。
 * 0033 起这里只做展示兜底：新建会话时不要 rename，否则标题会被 DSH 当成用户固定标题，
 * 首消息 / 随对话的自动标题就再也不会更新。
 */
function sessionTitle(session: NativeSessionSummary): string {
	const parts = (session.cwd ?? '').split(/[\\/]/).filter((part) => part !== '');
	const folder = parts.length > 0 ? parts[parts.length - 1] : null;
	const placeholder =
		session.blank === true &&
		(session.title === '' || (folder !== null && session.title === folder));
	return placeholder ? NEW_SESSION_TITLE : session.title;
}

export interface NativeChatRootProps {
	app: App;
	bridge: NativeCoreBridge;
	noteTracker: NoteTracker;
	ensureReady: () => Promise<void>;
	/** 模型/凭据不在插件里配置，给出 obsidian profile 的说明。 */
	onExplainSettings: () => void;
	/** 原生面板错误页的重启服务按钮。 */
	onRestartService: () => Promise<void>;
	/** 设置页的流式刷新节奏（0021）；每次轮询读取，切换后即时生效。 */
	getStreamRefresh: () => StreamRefreshMode;
	/** 设置页的运行提示位置（0048）；每次渲染读取，运行中切换即时生效。 */
	getRunStatusPlacement: () => RunStatusPlacement;
	/** 设置页的「@」引用范围（0030）；每次打开菜单时读取。 */
	getMentionScope: () => MentionScope;
	/** 设置页的「/」技能范围（0037）；每次打开 / 菜单时读取，只影响菜单显示。 */
	getSkillScope: () => SkillScope;
	/** 设置页的「/」命令范围（0050）；每次打开 / 菜单时读取，只影响菜单显示。 */
	getCommandScope: () => CommandScope;
	/** 设置页的选区引用摘录上限（0058）；发送 / 预览时读取。 */
	getQuoteExcerptLimit: () => number;
}

export function NativeChatRoot({
	app,
	bridge,
	noteTracker,
	ensureReady,
	onExplainSettings,
	onRestartService,
	getStreamRefresh,
	getRunStatusPlacement,
	getMentionScope,
	getSkillScope,
	getCommandScope,
	getQuoteExcerptLimit,
}: NativeChatRootProps) {
	const [phase, setPhase] = useState<Phase>('booting');
	const [bootError, setBootError] = useState<string | null>(null);
	const [sessions, setSessions] = useState<NativeSessionSummary[]>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<NativeChatSnapshot | null>(null);
	const [live, setLive] = useState<NativeChatLive | null>(null);
	const [liveTick, setLiveTick] = useState(0);
	const [models, setModels] = useState<NativeModels | null>(null);
	const [permissions, setPermissions] = useState<NativePermissions | null>(null);
	const [note, setNote] = useState<NativeNote | null>(noteTracker.getSnapshot());
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** 0046：已点过「重试」的静默结束轮次，避免提示条在被点到后立刻重现。 */
	const [dismissedSilentTurn, setDismissedSilentTurn] = useState<number | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [menu, setMenu] = useState<{
		kind: 'model' | 'permission' | 'more' | 'context' | 'team' | 'subagents';
		anchor: DOMRect;
	} | null>(null);
	const [context, setContext] = useState<NativeContextUsage | null>(null);
	const [team, setTeam] = useState<NativeTeamProjection | null>(null);
	const [subagents, setSubagents] = useState<NativeSubagentList | null>(null);
	/** 0052：当前会话目标（dsh goal 投影）；无目标 / 旧桥为 null。 */
	const [goal, setGoal] = useState<NativeGoal | null>(null);
	/** 目标操作（暂停 / 恢复 / 编辑 / 清除）进行中：按钮置灰，避免重复 CAS。 */
	const [goalPending, setGoalPending] = useState(false);
	/** 目标操作的错误文案：显示在目标条里，下一次操作 / 切换会话时清空。 */
	const [goalError, setGoalError] = useState<string | null>(null);
	/** 0058：点输入框时捕获的选区引用（预览条显示，发送时前置到消息文本）。 */
	const [pendingQuote, setPendingQuote] = useState<SelectionQuote | null>(null);

	const mountedRef = useRef(true);
	const tokenRef = useRef(0);
	const cursorRef = useRef(0);
	const liveCursorRef = useRef(-1);
	const liveNoticeRef = useRef(false);
	const sessionIdRef = useRef<string | null>(null);
	/** 上一次快照里的标题：DSH 侧标题变化时用它触发会话列表重读（0033）。 */
	const titleRef = useRef<string | null>(null);
	/** 上下文请求序号：同一会话的并发请求只接受最新一次结果。 */
	const contextRequestRef = useRef(0);
	/** 团队投影请求序号（0035），与上下文同样的「只接受最新一次」策略。 */
	const teamRequestRef = useRef(0);
	/** 子智能体目录请求序号（0041），与团队同样的「只接受最新一次」策略。 */
	const subagentRequestRef = useRef(0);
	/** 目标投影请求序号（0052），与上下文同样的「只接受最新一次」策略。 */
	const goalRequestRef = useRef(0);
	/** 0058：用户点 × 明确不引用的选区指纹；同一选区不再自动带回。 */
	const dismissedQuoteRef = useRef<string | null>(null);
	/** 同一帧内的多个 live 包只保留最后一个。 */
	const pendingLiveRef = useRef<NativeChatLive | null>(null);
	const liveRafRef = useRef<number | null>(null);
	/** 上一次真正渲染 live 的时间（ms），用于「平衡 / 省电」档的最小间隔。 */
	const lastLiveRenderRef = useRef(0);

	useEffect(() => {
		mountedRef.current = true;
		const unsubscribe = noteTracker.subscribe(() => {
			setNote(noteTracker.getSnapshot());
		});
		return () => {
			mountedRef.current = false;
			tokenRef.current += 1;
			if (liveRafRef.current !== null) {
				window.cancelAnimationFrame(liveRafRef.current);
				liveRafRef.current = null;
			}
			pendingLiveRef.current = null;
			unsubscribe();
		};
	}, [noteTracker]);

	const refreshSessions = async (): Promise<void> => {
		const list = await bridge.listSessions();
		const vault = vaultPath(app);
		if (mountedRef.current) {
			setSessions(
				list.sessions
					.filter((entry) => entry.origin !== 'subagent')
					.filter((entry) => projectPathWithin(entry.cwd, vault))
					.map((entry) => ({ ...entry, title: sessionTitle(entry) })),
			);
		}
	};

	const refreshContext = async (id: string): Promise<void> => {
		if (!bridge.supportsContext()) {
			if (mountedRef.current && id === sessionIdRef.current) setContext(null);
			return;
		}
		const request = ++contextRequestRef.current;
		try {
			const next = await bridge.context();
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === contextRequestRef.current
			) {
				setContext(next);
			}
		} catch {
			// 占用只是辅助信息：失败时显示灰色空环，不阻塞消息流。
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === contextRequestRef.current
			) {
				setContext(null);
			}
		}
	};

	const refreshTeam = async (id: string): Promise<void> => {
		if (!bridge.supportsTeam()) {
			if (mountedRef.current && id === sessionIdRef.current) setTeam(null);
			return;
		}
		const request = ++teamRequestRef.current;
		try {
			const next = await bridge.team();
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === teamRequestRef.current
			) {
				setTeam(next);
			}
		} catch {
			// 团队只是辅助信息：投影缺失 / 旧桥时隐藏入口，不阻塞消息流。
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === teamRequestRef.current
			) {
				setTeam(null);
			}
		}
	};

	const refreshSubagents = async (id: string): Promise<void> => {
		if (!bridge.supportsSubagents()) {
			if (mountedRef.current && id === sessionIdRef.current) setSubagents(null);
			return;
		}
		const request = ++subagentRequestRef.current;
		try {
			const next = await bridge.subagents();
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === subagentRequestRef.current
			) {
				setSubagents(next);
			}
		} catch {
			// 子智能体只是辅助信息：目录缺失 / 旧桥时隐藏入口，不阻塞消息流。
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === subagentRequestRef.current
			) {
				setSubagents(null);
			}
		}
	};

	/** 0052：读当前会话目标（dsh goal 投影）；旧桥 / 无目标时清空目标条。 */
	const refreshGoal = async (id: string): Promise<void> => {
		if (!bridge.supportsGoal()) {
			if (mountedRef.current && id === sessionIdRef.current) setGoal(null);
			return;
		}
		const request = ++goalRequestRef.current;
		try {
			const next = await bridge.goal();
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === goalRequestRef.current
			) {
				// 索引相同就复用旧对象：快照每次刷新都会重渲染，目标条不必跟着重挂。
				setGoal((previous) => (sameGoal(previous, next) ? previous : next));
			}
		} catch {
			// 目标只是辅助信息：投影缺失 / 旧桥时隐藏目标条，不阻塞消息流。
			if (
				mountedRef.current &&
				id === sessionIdRef.current &&
				request === goalRequestRef.current
			) {
				setGoal(null);
			}
		}
	};

	const refreshSnapshot = async (): Promise<void> => {
		const next = await bridge.snapshot();
		if (!mountedRef.current || next.sessionId !== sessionIdRef.current) return;
		cursorRef.current = next.revision;
		const previousTitle = titleRef.current;
		titleRef.current = next.title;
		setSnapshot(next);
		// DSH 侧标题（首消息 fallback / 标题 provider / 随对话更新）变了：列表立即跟随，不用手动刷新。
		if (previousTitle !== null && previousTitle !== next.title) void refreshSessions();
		void refreshContext(next.sessionId);
		void refreshTeam(next.sessionId);
		void refreshSubagents(next.sessionId);
		void refreshGoal(next.sessionId);
		try {
			const nextPermissions = await bridge.permissions();
			if (mountedRef.current && next.sessionId === sessionIdRef.current) {
				setPermissions(nextPermissions);
			}
		} catch {
			// 权限投影不可用时不阻塞消息流
		}
	};

	const loadModels = async (): Promise<void> => {
		try {
			const next = await bridge.models();
			if (mountedRef.current) setModels(next);
		} catch (loadError) {
			if (!mountedRef.current) return;
			setModels(null);
			setError('模型列表加载失败：' + describeNativeBridgeError(loadError));
		}
	};

	const loadPermissions = async (): Promise<void> => {
		try {
			const next = await bridge.permissions();
			if (mountedRef.current) setPermissions(next);
		} catch {
			if (mountedRef.current) setPermissions(null);
		}
	};

	/**
	 * 同一帧内的多个 live 包只渲染一次（0021）：桥端每个 chunk 立即通知，
	 * 这里按设置里的最小间隔合帧——屏幕帧率就是「逐字 / 每帧」两档的上限。
	 */
	const scheduleLive = (next: NativeChatLive | null): void => {
		pendingLiveRef.current = next;
		if (liveRafRef.current !== null) return;
		liveRafRef.current = window.requestAnimationFrame((now) => {
			liveRafRef.current = null;
			if (!mountedRef.current) return;
			const gap = streamRefreshMs(getStreamRefresh());
			if (gap > 0 && now - lastLiveRenderRef.current < gap - 1) {
				scheduleLive(pendingLiveRef.current);
				return;
			}
			lastLiveRenderRef.current = now;
			setLive(pendingLiveRef.current);
			setLiveTick((value) => value + 1);
		});
	};

	const clearLiveNow = (): void => {
		if (liveRafRef.current !== null) {
			window.cancelAnimationFrame(liveRafRef.current);
			liveRafRef.current = null;
		}
		pendingLiveRef.current = null;
		lastLiveRenderRef.current = 0;
	};

	const poll = (token: number): void => {
		void (async () => {
			while (mountedRef.current && token === tokenRef.current) {
				try {
					const event = await bridge.nextEvent(
						cursorRef.current,
						20000,
						liveCursorRef.current,
					);
					if (!mountedRef.current || token !== tokenRef.current) return;
					if (event.changed) {
						cursorRef.current = event.cursor;
						await refreshSnapshot();
					}
					// 桥 v3：live 游标独立于结构 revision；旧桥没有 liveCursor，直接跳过。
					if (
						event.liveCursor !== undefined &&
						event.liveCursor !== liveCursorRef.current
					) {
						liveCursorRef.current = event.liveCursor;
						scheduleLive(event.live ?? null);
					}
				} catch (pollError) {
					if (!mountedRef.current || token !== tokenRef.current) return;
					if (pollError instanceof NativeBridgeError && pollError.reason === 'not-subscribed') {
						// 切换会话时桥侧会先 cleanup（active 短暂为 null）；这是正常过渡，静默重试，
						// 否则会在标题栏下方闪出一条假错误。
						await sleep(300);
						continue;
					}
					setError('事件通道中断：' + describeNativeBridgeError(pollError));
					await sleep(1200);
				}
			}
		})();
	};

	const attachSession = async (target: string | NativeSubagentAddress): Promise<void> => {
		const id = typeof target === 'string' ? target : target.childSessionId;
		await bridge.subscribe(target);
		const next = await bridge.snapshot();
		if (!mountedRef.current) return;
		const token = ++tokenRef.current;
		sessionIdRef.current = id;
		cursorRef.current = next.revision;
		liveCursorRef.current = -1;
		clearLiveNow();
		setLive(null);
		setLiveTick(0);
		setSessionId(id);
		titleRef.current = next.title;
		setSnapshot(next);
		contextRequestRef.current += 1;
		teamRequestRef.current += 1;
		subagentRequestRef.current += 1;
		goalRequestRef.current += 1;
		setContext(null);
		setTeam(null);
		setSubagents(null);
		setGoal(null);
		setGoalError(null);
		setPickerOpen(false);
		setMenu(null);
		setError(null);
		setDismissedSilentTurn(null);
		// 子会话没有独立的模型目录：拿到模型列表失败会把错误条钉在面板上，所以子会话不请求。
		if (next.subagent == null) {
			await Promise.all([loadModels(), loadPermissions()]);
		} else {
			setModels(null);
			void loadPermissions();
		}
		void refreshContext(id);
		void refreshTeam(id);
		void refreshSubagents(id);
		void refreshGoal(id);
		poll(token);
	};

	const boot = async (): Promise<void> => {
		setPhase('booting');
		setBootError(null);
		try {
			await ensureReady();
			if (!bridge.supportsLiveStream() && !liveNoticeRef.current) {
				liveNoticeRef.current = true;
				new Notice(
					'dsh-obsidian-bridge 需要更新：重新 link 并重启 DSH 服务后，Assistant 输出才会流式显示。',
					15000,
				);
			}

			// 服务刚重启时会话列表可能还没同步完，短暂重试，避免空状态误显示「还没有会话」。
			let list = await bridge.listSessions();
			for (let attempt = 0; attempt < 10 && list.sessions.length === 0; attempt += 1) {
				await sleep(300);
				list = await bridge.listSessions();
			}
			if (!mountedRef.current) return;
			const vault = vaultPath(app);
			setSessions(
				list.sessions
					.filter((entry) => entry.origin !== 'subagent')
					.filter((entry) => projectPathWithin(entry.cwd, vault))
					.map((entry) => ({ ...entry, title: sessionTitle(entry) })),
			);
			setPhase('ready');
		} catch (bootFailure) {
			if (!mountedRef.current) return;
			setBootError(describeNativeBridgeError(bootFailure));
			setPhase('error');
		}
	};

	useEffect(() => {
		void boot();
		// 只在挂载时启动一次（boot 内部用 mountedRef 丢弃卸载后的结果）。
	}, []);

	const restartThenBoot = async (): Promise<void> => {
		await onRestartService();
		await boot();
	};

	const toggleMenu = (
		kind: 'model' | 'permission' | 'more' | 'context' | 'team' | 'subagents',
		anchor: DOMRect,
	): void => {
		setMenu((value) => (value?.kind === kind ? null : { kind, anchor }));
	};

	const openSession = async (id: string): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await attachSession(id);
		} catch (failure) {
			if (mountedRef.current) setError('打开会话失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	/** 打开子会话：把目录里的 mode 一起带过去，桥按 SubagentAddress retain。 */
	const openSubagent = async (entry: NativeSubagentEntry): Promise<void> => {
		if (busy || subagents === null) return;
		setBusy(true);
		setError(null);
		const target: NativeSubagentAddress = {
			parentSessionId: subagents.rootSessionId,
			childSessionId: entry.id,
			mode: entry.mode,
		};
		try {
			await attachSession(target);
		} catch (failure) {
			if (mountedRef.current) {
				setError('打开子智能体会话失败：' + describeNativeBridgeError(failure));
			}
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	/** 从子会话返回父会话。 */
	const backToParent = async (): Promise<void> => {
		const info = snapshot?.subagent ?? null;
		if (info === null) return;
		await openSession(info.address.parentSessionId);
	};

	const createSession = async (): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		setError(null);
		try {
			const created = await bridge.createSession(vaultPath(app));
			// 不再 rename「新会话」：显式重命名会被 DSH 当成用户固定标题，自动标题从此不再更新（0033）。
			// 未发消息的空白会话由 sessionTitle() 统一展示成「新会话」。
			await refreshSessions();
			await attachSession(created.sessionId);
			if (mountedRef.current) setPhase('ready');
			return true;
		} catch (failure) {
			if (mountedRef.current) setError('新建会话失败：' + describeNativeBridgeError(failure));
			return false;
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	/**
	 * 0058：选区快照 → 预览状态。`null` 或「用户点过 × 的同一选区」不显示；
	 * 选区变化时清掉旧的 dismissed，让新选区能正常出现。
	 */
	const applyQuote = useCallback((next: SelectionQuote | null): void => {
		if (next === null) {
			dismissedQuoteRef.current = null;
			setPendingQuote((prev) => (prev === null ? prev : null));
			return;
		}
		const key = quoteKey(next);
		if (dismissedQuoteRef.current === key) {
			setPendingQuote((prev) => (prev === null ? prev : null));
			return;
		}
		dismissedQuoteRef.current = null;
		setPendingQuote((prev) => (prev !== null && quoteKey(prev) === key ? prev : next));
	}, []);

	// 0059：编辑区选区一变就同步预览（不必先点输入框）；失焦后编辑器选区仍在，点面板不会清掉。
	useEffect(() => observeEditorSelection(app, applyQuote), [app, applyQuote]);

	/** 0058：点输入卡 / 输入框获得焦点前再抓一次（实时监听的兜底）。 */
	const captureQuote = (): void => {
		applyQuote(captureSelectionQuote(app));
	};

	/** 0058：点 × 只对「当前选区」生效；下次选区变了还会重新带上。 */
	const clearQuote = (): void => {
		if (pendingQuote !== null) dismissedQuoteRef.current = quoteKey(pendingQuote);
		setPendingQuote(null);
	};

	const send = async (): Promise<void> => {
		const text = draft.trim();
		if (text === '' || sessionId === null) return;
		// 0058：选区引用随消息文本发送；草稿是 / 命令时不加（dsh 命令判定要求单个 text block 且以 / 开头）。
		const quote = pendingQuote !== null && !text.startsWith('/') ? pendingQuote : null;
		setBusy(true);
		setError(null);
		try {
			const payload =
				quote === null ? text : formatQuote(quote, getQuoteExcerptLimit()) + '\n\n' + text;
			await bridge.send(payload);
			if (!mountedRef.current) return;
			setDraft('');
			if (quote !== null) {
				// R2：不自动把焦点切回编辑区；同一选区也不在下一轮自动重复引用。
				dismissedQuoteRef.current = quoteKey(quote);
				setPendingQuote(null);
			}
			await refreshSnapshot();
		} catch (failure) {
			if (!mountedRef.current) return;
			const message = errorText(failure);
			setError('发送失败：' + describeNativeBridgeError(failure));
			if (message.includes('writer-held')) {
				new Notice(
					'这个会话正被另一个客户端占用（例如桌面端或另一个 Obsidian 窗口）。请新建会话，或换一个空闲会话。',
					15000,
				);
			} else {
				new Notice('DSH 发送失败：' + describeNativeBridgeError(failure), 12000);
			}
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const stop = async (): Promise<void> => {
		if (busy) return;
		setBusy(true);
		try {
			await bridge.cancel();
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) setError('停止失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	/** "/" 菜单里的 dsh 命令：结果由时间线节点呈现，失败进错误条（0050 起也用于手敲命令）。 */
	const runCommand = async (line: string): Promise<void> => {
		setError(null);
		try {
			const execution = await bridge.executeCommand(line);
			if (!execution.matched) {
				setError('未知命令：' + line + '（当前会话的组合里没有注册它）');
				return;
			}
			if (execution.result.kind === 'error') {
				setError(line + ' 执行失败：' + (execution.result.text ?? '未知原因'));
			}
		} catch (failure) {
			setError('命令执行失败：' + describeNativeBridgeError(failure));
		}
	};

	/** 0052：目标操作（暂停 / 恢复 / 编辑 / 清除）：结果回填目标条，失败也在条内显示。 */
	const goalAction = async (
		action: 'edit' | 'pause' | 'resume' | 'clear',
		value?: string,
	): Promise<void> => {
		if (goalPending) return;
		setGoalPending(true);
		setGoalError(null);
		try {
			const result = await bridge.goalAction(action, value);
			if (!result.ok) {
				if (mountedRef.current) setGoalError(result.error?.message ?? '目标操作失败');
				return;
			}
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) {
				setGoalError('目标操作失败：' + describeNativeBridgeError(failure));
			}
		} finally {
			if (mountedRef.current) setGoalPending(false);
		}
	};

	const loadOlder = async (): Promise<void> => {
		if (loadingOlder) return;
		setLoadingOlder(true);
		try {
			await bridge.loadOlder();
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) setError('加载历史失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setLoadingOlder(false);
		}
	};

	const selectModel = async (selection: NativeModelSelection): Promise<void> => {
		if (selection.provider === '' || selection.model === '') return;
		setBusy(true);
		try {
			await bridge.selectModel(selection);
			await loadModels();
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) new Notice('切换模型失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const setPermission = async (preset: string): Promise<void> => {
		setBusy(true);
		try {
			await bridge.setPermission(preset);
			await loadPermissions();
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) new Notice('切换权限失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const answerApproval = async (decision: 'allowed-once' | 'rejected'): Promise<void> => {
		setBusy(true);
		try {
			await bridge.approvalAnswer(decision);
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) new Notice('审批失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const answerQuestion = async (answer: NativeQuestionAnswer): Promise<void> => {
		setBusy(true);
		try {
			await bridge.questionAnswer(answer);
			await refreshSnapshot();
		} catch (failure) {
			if (mountedRef.current) new Notice('提交答案失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const rename = (): void => {
		if (sessionId === null) return;
		const title = snapshot?.title ?? '新会话';
		new RenameSessionModal(app, title, (nextTitle) => {
			void (async () => {
				try {
					await bridge.renameSession(nextTitle);
					await refreshSessions();
					await refreshSnapshot();
				} catch (failure) {
					new Notice('重命名失败：' + describeNativeBridgeError(failure));
				}
			})();
		}).open();
	};

	/** @ 菜单的候选来源：vault 当前快照，打开菜单时取一次，并按设置裁剪范围（0030）。 */
	const listMentionEntries = (): MentionEntry[] => {
		const entries: MentionEntry[] = app.vault
			.getAllLoadedFiles()
			.filter((entry) => entry.path !== '/' && entry.path !== '')
			.map((entry) => ({
				path: entry.path,
				kind: entry instanceof TFolder ? 'directory' : 'file',
			}));
		return filterMentionEntries(entries, getMentionScope());
	};

	const current = sessions.find((entry) => entry.id === sessionId) ?? null;
	// 快照标题也要走一遍占位映射：DSH 对还没有标题的新会话会返回 cwd 目录名（0033）。
	const title = ((): string => {
		if (snapshot !== null) {
			const base: NativeSessionSummary = current ?? {
				id: snapshot.sessionId,
				title: snapshot.title,
				cwd: null,
				running: false,
				blank: false,
				updatedAt: null,
			};
			return sessionTitle({ ...base, title: snapshot.title });
		}
		return current?.title ?? '选择会话';
	})();
	const running = snapshot?.session.running === true;
	/** 0047 / 0048：本轮开始时间放在根组件，切换显示位置（组件重挂载）时计时不归零。 */
	const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
	useEffect(() => {
		setRunStartedAt((prev) => (running ? (prev ?? Date.now()) : null));
	}, [running, sessionId]);

	/**
	 * 0048：运行提示放在输入框上方还是消息流最下方。
	 * 设置页没有「设置变更」事件，而工具调用期间快照可能很久不刷新；运行中每 500ms 对一次，
	 * 切换后最多半秒生效（空闲时下一次运行读取最新值）。
	 */
	const [runStatusPlacement, setRunStatusPlacement] = useState<RunStatusPlacement>(() =>
		getRunStatusPlacement(),
	);
	const placementGetterRef = useRef(getRunStatusPlacement);
	placementGetterRef.current = getRunStatusPlacement;
	useEffect(() => {
		const sync = (): void => {
			const next = placementGetterRef.current();
			setRunStatusPlacement((prev) => (prev === next ? prev : next));
		};
		sync();
		if (!running) return;
		const timer = window.setInterval(sync, 500);
		return () => window.clearInterval(timer);
	}, [running]);
	/** 当前会话是子会话时的地址元数据（桥 v7；旧桥 / 普通会话为 null）。 */
	const subagent = snapshot?.subagent ?? null;
	/** 子会话 composer 的只读原因：一次性 / 类型未知 / 父会话不可用。 */
	const readOnlyReason = ((): string | null => {
		if (subagent === null) return null;
		if (subagent.address.mode === 'one-shot') return '一次性子智能体：只能查看，不能继续发消息。';
		if (subagent.address.mode === 'unknown') return '无法确认子智能体的类型：只能查看。';
		if (subagent.parentAvailable === false) {
			return running ? '父会话暂不可用：可以停止，但不能发消息。' : '父会话不可用：只能查看。';
		}
		return null;
	})();
	/** 0046：本轮静默结束（只有思考、没有正文/工具调用）时给一行重试提示。 */
	const silentTurnEnd = snapshot === null ? null : detectSilentTurnEnd(snapshot);
	const showTurnEndHint =
		silentTurnEnd !== null &&
		readOnlyReason === null &&
		dismissedSilentTurn !== silentTurnEnd.turn;

	/** 0046：重试 = 发「继续」让模型接着完成本轮；失败时把提示条放回来。 */
	const retrySilentTurn = async (): Promise<void> => {
		if (busy || sessionId === null || silentTurnEnd === null) return;
		setDismissedSilentTurn(silentTurnEnd.turn);
		setBusy(true);
		setError(null);
		try {
			await bridge.send('继续');
			if (!mountedRef.current) return;
			await refreshSnapshot();
		} catch (failure) {
			if (!mountedRef.current) return;
			setDismissedSilentTurn(null);
			setError('重试失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	/** 目录里的团队队友会话 id（团队投影可用时才有）：列表里给这些行加「团队」徽标。 */
	const teammateIds = new Set(
		(team?.members ?? []).filter((member) => member.role === 'teammate').map((member) => member.id),
	);
	const subagentParentId = subagent?.address.parentSessionId ?? null;
	const subagentParentTitle =
		subagentParentId === null
			? ''
			: (sessions.find((entry) => entry.id === subagentParentId)?.title ?? subagentParentId);
	const subagentLabel =
		subagents?.entries.find((entry) => entry.id === sessionId)?.label ?? title;
	const subagentRunning =
		subagents?.entries.filter((entry) => entry.running).length ?? 0;
	const subagentAttn =
		subagents?.entries.some((entry) => entry.pendingInteraction || entry.unread) ?? false;
	const ready = phase === 'ready' && sessionId !== null;
	const pending: NativePending | null = snapshot?.pending ?? null;
	const agentError =
		snapshot !== null && typeof snapshot.session.lastAgentError === 'string'
			? snapshot.session.lastAgentError
			: null;

	/**
	 * 0058：点面板空白处不抢编辑区焦点。消息正文 / 输入框 / 可交互元素保持默认行为，
	 * 否则会破坏文本选择、复制与输入。
	 */
	const handleBlankMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (
			target.closest(
				'.dsh-native-timeline, .dsh-native-composer, input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"]',
			) !== null
		) {
			return;
		}
		event.preventDefault();
	};

	return (
		<div className="dsh-native-app" onMouseDownCapture={handleBlankMouseDown}>
			<header className="dsh-native-header">
				<button className="dsh-native-title" onClick={() => setPickerOpen((value) => !value)}>
					<span>{title}</span>
					<Icon name="chevron-down" />
				</button>
				{subagent === null && team !== null ? (
					<button
						className={
							'dsh-native-icon-button dsh-native-team-trigger' +
							(team.members.some((member) => member.pendingInteraction)
								? ' has-pending'
								: '')
						}
						title="智能体团队"
						aria-label="智能体团队"
						aria-haspopup="dialog"
						aria-expanded={menu?.kind === 'team'}
						onClick={(event) =>
							toggleMenu('team', event.currentTarget.getBoundingClientRect())
						}
					>
						<Icon name="users" />
					</button>
				) : null}
				{subagent === null && subagents !== null && subagents.entries.length > 0 ? (
					<button
						className={
							'dsh-native-icon-button dsh-native-subagent-trigger' +
							(subagentAttn ? ' has-pending' : '')
						}
						title={
							'子智能体（' +
							subagents.entries.length +
							' 个' +
							(subagentRunning > 0 ? '，' + subagentRunning + ' 个运行中' : '') +
							'）'
						}
						aria-label="子智能体"
						aria-haspopup="dialog"
						aria-expanded={menu?.kind === 'subagents'}
						onClick={(event) =>
							toggleMenu('subagents', event.currentTarget.getBoundingClientRect())
						}
					>
						<Icon name="bot" />
						{subagentRunning > 0 ? (
							<span className="dsh-native-subagent-count">{subagentRunning}</span>
						) : null}
					</button>
				) : null}
				{running ? <span className="dsh-native-running-dot" title="运行中" /> : null}
				<span className="dsh-native-spacer" />
				<button className="dsh-native-icon-button" title="新建会话" onClick={() => void createSession()}>
					<Icon name="plus" />
				</button>
				<button
					className="dsh-native-icon-button"
					title="更多"
					onClick={(event) =>
						toggleMenu('more', event.currentTarget.getBoundingClientRect())
					}
				>
					<Icon name="more-horizontal" />
				</button>
				{pickerOpen ? (
					<SessionPicker
						sessions={sessions}
						currentId={sessionId}
						onSelect={(id) => void openSession(id)}
						onCreate={() => void createSession()}
						onClose={() => setPickerOpen(false)}
					/>
				) : null}
			</header>

			{subagent === null ? null : (
				<div className="dsh-native-subagent-breadcrumb">
					<button
						className="dsh-native-subagent-back"
						title="返回父会话"
						onClick={() => void backToParent()}
					>
						<Icon name="arrow-left" size={12} />
						<span>{subagentParentTitle}</span>
					</button>
					<Icon name="chevron-right" size={12} />
					<span className="dsh-native-subagent-current" title={subagentLabel}>
						{subagentLabel}
					</span>
					<span className="dsh-native-subagent-mode-label">
						{SUBAGENT_MODE_TEXT[subagent.address.mode]}
					</span>
				</div>
			)}

			{error !== null ? (
				<div className="dsh-native-error-banner">
					<Icon name="alert-triangle" />
					<span>{error}</span>
					<button onClick={() => setError(null)}>
						<Icon name="x" />
					</button>
				</div>
			) : null}
			{agentError !== null ? (
				<div className="dsh-native-error-banner">
					<Icon name="alert-circle" />
					<span>会话错误：{agentError}</span>
				</div>
			) : null}

			{phase === 'booting' ? (
				<div className="dsh-native-status-screen">正在连接 DSH…</div>
			) : phase === 'error' ? (
				<div className="dsh-native-status-screen">
					<Icon name="plug-zap" />
					<div>{bootError}</div>
					<div className="dsh-native-status-actions">
						<button className="mod-cta" onClick={() => void boot()}>
							重试
						</button>
						<button onClick={() => void restartThenBoot()}>重启服务</button>
					</div>
				</div>
			) : sessionId === null ? (
				<div className="dsh-native-empty">
					<Icon name="message-square" size={28} />
					<h2>开始一个 DSH 会话</h2>
					<p>输入 @ 可引用当前笔记或项目文件；引用只带路径，不会把正文塞进消息。</p>
					<button className="mod-cta" onClick={() => void createSession()}>
						新建会话
					</button>
					{sessions.length > 0 ? (
						<div className="dsh-native-empty-recent">
							<div className="dsh-native-empty-recent-title">最近会话</div>
							{sessions
								.filter((entry) => entry.blank !== true)
								.slice(0, 6)
								.map((entry) => (
									<button key={entry.id} onClick={() => void openSession(entry.id)}>
										<span>{entry.title}</span>
										{entry.running ? <span>●</span> : null}
									</button>
								))}
						</div>
					) : null}
				</div>
			) : (
				<>
					{snapshot !== null ? (
						<Timeline
							app={app}
							snapshot={snapshot}
							live={live}
							liveTick={liveTick}
							sourcePath={note?.path ?? ''}
							loadingOlder={loadingOlder}
							onLoadOlder={() => void loadOlder()}
							runningStatus={
								runStatusPlacement === 'flow' ? (
									<RunStatus running={running} startedAt={runStartedAt} variant="flow" />
								) : null
							}
						/>
					) : (
						<div className="dsh-native-status-screen">加载会话…</div>
					)}
					{showTurnEndHint ? (
						<TurnEndHint busy={busy} onRetry={() => void retrySilentTurn()} />
					) : null}
					<Composer
						readOnly={readOnlyReason}
						currentNote={note}
						listEntries={listMentionEntries}
						models={models}
						permissions={permissions}
						context={context}
						contextOpen={menu?.kind === 'context'}
						onContext={(anchor) => toggleMenu('context', anchor)}
						showRunStatus={runStatusPlacement === 'composer'}
						runStartedAt={runStartedAt}
						running={running}
						busy={busy}
						ready={ready}
						draft={draft}
						onDraft={setDraft}
						onSend={() => void send()}
						onStop={() => void stop()}
						onModel={(anchor) => toggleMenu('model', anchor)}
						onPermission={(anchor) => {
							if (permissions === null) return;
							toggleMenu('permission', anchor);
						}}
						onExplainSettings={onExplainSettings}
						commandsAvailable={bridge.supportsCommands()}
						showCommands={(snapshot?.subagent ?? null) === null}
						onNewSession={() => void createSession()}
						loadCommands={() => bridge.commands()}
						onRunCommand={(line) => runCommand(line)}
						loadSkills={() => bridge.skills()}
						getSkillScope={getSkillScope}
						getCommandScope={getCommandScope}
						goalBar={
							goal !== null ? (
								<GoalBar
									goal={goal}
									pending={goalPending}
									error={goalError}
									onAction={(action, value) => void goalAction(action, value)}
								/>
							) : null
						}
						quote={pendingQuote}
						quoteLimit={getQuoteExcerptLimit()}
						onCaptureQuote={captureQuote}
						onOpenQuote={() => {
							if (pendingQuote !== null) void jumpToQuote(app, pendingQuote);
						}}
						onClearQuote={clearQuote}
						pending={
							pending !== null ? (
								<PendingCard
									pending={pending}
									busy={busy}
									onApproval={(decision) => void answerApproval(decision)}
									onQuestion={(answer) => void answerQuestion(answer)}
								/>
							) : null
						}
					/>
				</>
			)}
			{menu?.kind === 'model' ? (
				<ModelMenu
					models={models}
					anchor={{ rect: menu.anchor, side: 'above' }}
					onSelect={(selection) => void selectModel(selection)}
					onRefresh={() => void loadModels()}
					onExplainSettings={onExplainSettings}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu?.kind === 'permission' && permissions !== null ? (
				<PermissionMenu
					app={app}
					anchor={{ rect: menu.anchor, side: 'above' }}
					permissions={permissions}
					onSelect={(preset) => void setPermission(preset)}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu?.kind === 'context' ? (
				<ContextDetails
					context={context}
					anchor={menu.anchor}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu?.kind === 'team' && team !== null ? (
				<TeamPanel
					team={team}
					anchor={menu.anchor}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu?.kind === 'subagents' && subagents !== null ? (
				<SubagentPanel
					list={subagents}
					teammateIds={teammateIds}
					anchor={menu.anchor}
					onOpen={(entry) => void openSubagent(entry)}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu?.kind === 'more' ? (
				<SessionMenu
					hasSession={sessionId !== null}
					anchor={{ rect: menu.anchor, side: 'below' }}
					onNew={() => void createSession()}
					onRename={rename}
					onRefresh={() => void refreshSessions()}
					onClose={() => setMenu(null)}
				/>
			) : null}
		</div>
	);
}
