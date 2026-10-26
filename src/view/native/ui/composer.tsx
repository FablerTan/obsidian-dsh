import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type {
	NativeModels,
	NativeNote,
	NativePermissions,
} from '../../../shared/native-types';
import { Icon } from './icon';

function modelLabel(models: NativeModels | null): string {
	const current = models?.current;
	if (models === null) return '模型';
	if (current === null || current === undefined) return '未配置模型';
	const groups = Array.isArray(models.groups) ? models.groups : [];
	for (const group of groups) {
		if (group.id !== current.provider) continue;
		for (const model of group.models) {
			if (model.id !== current.model) continue;
			const efforts = Array.isArray(model.reasoning?.efforts)
				? model.reasoning.efforts
				: [];
			const effort = efforts.find((entry) => entry.id === current.reasoningEffort);
			return effort === undefined ? model.name : model.name + ' · ' + effort.name;
		}
	}
	return current.model;
}

function permissionLabel(permissions: NativePermissions | null): string {
	if (permissions === null) return '权限';
	if (permissions.currentValue === 'custom') return '自定义权限';
	const options = Array.isArray(permissions.options) ? permissions.options : [];
	const option = options.find((entry) => entry.value === permissions.currentValue);
	return option?.name ?? permissions.currentValue;
}

export function Composer({
	note,
	noteDismissed,
	onDismissNote,
	onOpenNote,
	models,
	permissions,
	running,
	busy,
	ready,
	draft,
	onDraft,
	onSend,
	onStop,
	onModel,
	onPermission,
	onOpenSettings,
	pending,
}: {
	note: NativeNote | null;
	noteDismissed: boolean;
	onDismissNote: () => void;
	onOpenNote: () => void;
	models: NativeModels | null;
	permissions: NativePermissions | null;
	running: boolean;
	busy: boolean;
	ready: boolean;
	draft: string;
	onDraft: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	onModel: () => void;
	onPermission: () => void;
	onOpenSettings: () => void;
	pending: ReactNode;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const el = inputRef.current;
		if (el === null) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, 180) + 'px';
	}, [draft]);

	const canSend = ready && draft.trim() !== '' && !busy;
	const showNote = note !== null && !noteDismissed;
	const modelMissing = models !== null && models.groups.length === 0;
	const unroutable = models !== null && models.routable === false;

	return (
		<div className="dsh-native-composer">
			{pending}
			{modelMissing || unroutable ? (
				<div className="dsh-native-composer-warning">
					<Icon name="alert-triangle" />
					<span>{modelMissing ? '还没有配置模型' : '当前模型路由不可用'}</span>
					<button onClick={onOpenSettings}>打开 DSH 设置</button>
				</div>
			) : null}
			{showNote ? (
				<div className="dsh-native-note">
					<Icon name="file-text" />
					<span className="dsh-native-note-label">当前笔记</span>
					<button className="dsh-native-note-name" onClick={onOpenNote}>
						{note.name}
					</button>
					<button
						className="dsh-native-note-remove"
						title="本次不引用当前笔记"
						onClick={onDismissNote}
					>
						<Icon name="x" />
					</button>
				</div>
			) : null}
			<div className="dsh-native-input-shell">
				<textarea
					ref={inputRef}
					className="dsh-native-input"
					rows={1}
					placeholder={ready ? '给 DSH 发消息…（Enter 发送，Shift+Enter 换行）' : '选择一个会话后开始'}
					value={draft}
					disabled={!ready}
					onChange={(event) => onDraft(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === 'Enter' &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							if (canSend) onSend();
						}
					}}
				/>
				<div className="dsh-native-composer-bar">
					<div className="dsh-native-composer-left">
						<button
							className="dsh-native-chip"
							disabled={!ready}
							onClick={onModel}
							title="选择模型"
						>
							<Icon name="cpu" />
							<span>{modelLabel(models)}</span>
							<Icon name="chevron-down" />
						</button>
						{permissions !== null ? (
							<button
								className="dsh-native-chip"
								disabled={!ready}
								onClick={onPermission}
								title="切换权限"
							>
								<Icon name="shield" />
								<span>{permissionLabel(permissions)}</span>
								<Icon name="chevron-down" />
							</button>
						) : null}
					</div>
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
	);
}
