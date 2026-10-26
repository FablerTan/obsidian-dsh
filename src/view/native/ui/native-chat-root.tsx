import { Notice, type App } from 'obsidian';
import { useEffect, useRef, useState } from 'react';
import type {
	NativeChatSnapshot,
	NativeModelSelection,
	NativeModels,
	NativeNote,
	NativePending,
	NativePermissions,
	NativeQuestionAnswer,
	NativeSessionSummary,
} from '../../../shared/native-types';
import { sleep } from '../../../shared/async';
import { vaultPath } from '../../../shared/host';
import type { NativeCoreBridge } from '../core-bridge';
import { describeNativeBridgeError } from '../core-bridge';
import type { NoteTracker } from '../note-tracker';
import { Composer } from './composer';
import { Icon } from './icon';
import {
	ModelMenu,
	PermissionMenu,
	RenameSessionModal,
	SessionMenu,
} from './menus';
import { PendingCard } from './pending';
import { SessionPicker } from './session-picker';
import { Timeline } from './timeline';

type Phase = 'booting' | 'ready' | 'error';

function mention(path: string): string {
	return /[\s"']/.test(path) ? '@"' + path + '"' : '@' + path;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface NativeChatRootProps {
	app: App;
	bridge: NativeCoreBridge;
	noteTracker: NoteTracker;
	ensureReady: () => Promise<void>;
	openDshPanel: () => void;
}

export function NativeChatRoot({
	app,
	bridge,
	noteTracker,
	ensureReady,
	openDshPanel,
}: NativeChatRootProps) {
	const [phase, setPhase] = useState<Phase>('booting');
	const [bootError, setBootError] = useState<string | null>(null);
	const [sessions, setSessions] = useState<NativeSessionSummary[]>([]);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<NativeChatSnapshot | null>(null);
	const [models, setModels] = useState<NativeModels | null>(null);
	const [permissions, setPermissions] = useState<NativePermissions | null>(null);
	const [note, setNote] = useState<NativeNote | null>(noteTracker.getSnapshot());
	const [noteDismissed, setNoteDismissed] = useState(false);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [menu, setMenu] = useState<'model' | 'permission' | 'more' | null>(null);

	const mountedRef = useRef(true);
	const tokenRef = useRef(0);
	const cursorRef = useRef(0);
	const sessionIdRef = useRef<string | null>(null);

	useEffect(() => {
		mountedRef.current = true;
		const unsubscribe = noteTracker.subscribe(() => {
			setNote(noteTracker.getSnapshot());
		});
		return () => {
			mountedRef.current = false;
			tokenRef.current += 1;
			unsubscribe();
		};
	}, [noteTracker]);

	useEffect(() => {
		setNoteDismissed(false);
	}, [note?.path]);

	const refreshSessions = async (): Promise<void> => {
		const list = await bridge.listSessions();
		if (mountedRef.current) setSessions(list.sessions);
	};

	const refreshSnapshot = async (): Promise<void> => {
		const next = await bridge.snapshot();
		if (!mountedRef.current || next.sessionId !== sessionIdRef.current) return;
		cursorRef.current = next.revision;
		setSnapshot(next);
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

	const poll = (token: number): void => {
		void (async () => {
			while (mountedRef.current && token === tokenRef.current) {
				try {
					const event = await bridge.nextEvent(cursorRef.current, 20000);
					if (!mountedRef.current || token !== tokenRef.current) return;
					if (event.changed) {
						cursorRef.current = event.cursor;
						await refreshSnapshot();
					}
				} catch (pollError) {
					if (!mountedRef.current || token !== tokenRef.current) return;
					setError('事件通道中断：' + describeNativeBridgeError(pollError));
					await sleep(1200);
				}
			}
		})();
	};

	const attachSession = async (id: string): Promise<void> => {
		await bridge.subscribe(id);
		const next = await bridge.snapshot();
		if (!mountedRef.current) return;
		const token = ++tokenRef.current;
		sessionIdRef.current = id;
		cursorRef.current = next.revision;
		setSessionId(id);
		setSnapshot(next);
		setPickerOpen(false);
		setMenu(null);
		setError(null);
		await Promise.all([loadModels(), loadPermissions()]);
		poll(token);
	};

	const boot = async (): Promise<void> => {
		setPhase('booting');
		setBootError(null);
		try {
			await ensureReady();
			// 服务刚重启时会话列表可能还没同步完，短暂重试，避免空状态误显示「还没有会话」。
			let list = await bridge.listSessions();
			for (let attempt = 0; attempt < 10 && list.sessions.length === 0; attempt += 1) {
				await sleep(300);
				list = await bridge.listSessions();
			}
			if (!mountedRef.current) return;
			setSessions(list.sessions);
			setPhase('ready');
		} catch (bootFailure) {
			if (!mountedRef.current) return;
			setBootError(describeNativeBridgeError(bootFailure));
			setPhase('error');
		}
	};

	useEffect(() => {
		void boot();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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

	const createSession = async (): Promise<void> => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const created = await bridge.createSession(vaultPath(app));
			await refreshSessions();
			await attachSession(created.sessionId);
		} catch (failure) {
			if (mountedRef.current) setError('新建会话失败：' + describeNativeBridgeError(failure));
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	};

	const send = async (): Promise<void> => {
		const text = draft.trim();
		if (text === '' || sessionId === null) return;
		const content = note !== null && !noteDismissed ? mention(note.path) + '\n' + text : text;
		setBusy(true);
		setError(null);
		try {
			await bridge.send(content);
			if (!mountedRef.current) return;
			setDraft('');
			await refreshSnapshot();
		} catch (failure) {
			if (!mountedRef.current) return;
			const message = messageOf(failure);
			setError('发送失败：' + describeNativeBridgeError(failure));
			if (message.includes('writer-held')) {
				new Notice(
					'这个会话正被另一个客户端占用（例如官方面板或桌面端）。请新建会话，或换一个空闲会话。',
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

	const openNote = (): void => {
		if (note === null) return;
		void app.workspace.openLinkText(note.path, '', false);
	};

	const current = sessions.find((entry) => entry.id === sessionId) ?? null;
	const title = snapshot?.title ?? current?.title ?? '选择会话';
	const running = snapshot?.session.running === true;
	const ready = phase === 'ready' && sessionId !== null;
	const pending: NativePending | null = snapshot?.pending ?? null;
	const agentError =
		snapshot !== null && typeof snapshot.session.lastAgentError === 'string'
			? snapshot.session.lastAgentError
			: null;

	return (
		<div className="dsh-native-app">
			<header className="dsh-native-header">
				<button className="dsh-native-title" onClick={() => setPickerOpen((value) => !value)}>
					<span>{title}</span>
					<Icon name="chevron-down" />
				</button>
				{running ? <span className="dsh-native-running-dot" title="运行中" /> : null}
				<span className="dsh-native-spacer" />
				<button className="dsh-native-icon-button" title="新建会话" onClick={() => void createSession()}>
					<Icon name="plus" />
				</button>
				<button
					className="dsh-native-icon-button"
					title="更多"
					onClick={() => setMenu((value) => (value === 'more' ? null : 'more'))}
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
						<button onClick={openDshPanel}>打开 DSH 面板</button>
					</div>
				</div>
			) : sessionId === null ? (
				<div className="dsh-native-empty">
					<Icon name="message-square" size={28} />
					<h2>开始一个 DSH 会话</h2>
					<p>当前笔记会自动作为上下文引用，不会把正文塞进消息。</p>
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
							sourcePath={note?.path ?? ''}
							loadingOlder={loadingOlder}
							onLoadOlder={() => void loadOlder()}
						/>
					) : (
						<div className="dsh-native-status-screen">加载会话…</div>
					)}
					<Composer
						note={note}
						noteDismissed={noteDismissed}
						onDismissNote={() => setNoteDismissed(true)}
						onOpenNote={openNote}
						models={models}
						permissions={permissions}
						running={running}
						busy={busy}
						ready={ready}
						draft={draft}
						onDraft={setDraft}
						onSend={() => void send()}
						onStop={() => void stop()}
						onModel={() => setMenu((value) => (value === 'model' ? null : 'model'))}
						onPermission={() => {
							if (permissions === null) return;
							setMenu((value) => (value === 'permission' ? null : 'permission'));
						}}
						onOpenSettings={openDshPanel}
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
			{menu === 'model' ? (
				<ModelMenu
					models={models}
					onSelect={(selection) => void selectModel(selection)}
					onRefresh={() => void loadModels()}
					onOpenSettings={openDshPanel}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu === 'permission' && permissions !== null ? (
				<PermissionMenu
					app={app}
					permissions={permissions}
					onSelect={(preset) => void setPermission(preset)}
					onClose={() => setMenu(null)}
				/>
			) : null}
			{menu === 'more' ? (
				<SessionMenu
					hasSession={sessionId !== null}
					onNew={() => void createSession()}
					onRename={rename}
					onRefresh={() => void refreshSessions()}
					onClose={() => setMenu(null)}
				/>
			) : null}
		</div>
	);
}
