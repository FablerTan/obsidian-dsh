import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { NativeGoal } from '../../../shared/native-types';

/**
 * 输入框上方的目标条（0052）：对齐 dsh 官方 GoalBar —— 目标图标 + 阶段标签 +
 * 单行目标正文 + 图标动作（暂停 / 恢复 / 编辑 / 清除）。
 *
 * 组件只做展示与交互，数据与操作全部走 props：目标来自桥 v8 的 `goal` 投影，
 * `pending` / `error` 由根组件持有，`onAction` 负责调桥。目标的创建在
 * `/goal` 命令里（不在本组件），complete 的目标不渲染。编辑态复用官方
 * InlineEditor 的口径：textarea 随内容长高（最多 6 行），Enter 保存、
 * Shift+Enter 换行、Escape 取消、IME 组合输入不触发保存。
 */

export interface GoalBarProps {
	goal: NativeGoal;
	pending: boolean;
	error: string | null;
	onAction: (action: 'edit' | 'pause' | 'resume' | 'clear', value?: string) => void;
}

interface IconProps {
	width?: number;
	height?: number;
}

/* 以下图标取自 dsh 官方 ui-primitives 的 ICON_ARTWORK（artwork.ts），
   viewBox / 路径数据原样保留，尺寸由调用方给（动作与目标图标都是 14）。 */

function GoalOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5" />
			<path d="M11.5 8C11.5001 8.69227 11.2948 9.36901 10.9102 9.94463C10.5257 10.5202 9.97901 10.9689 9.33944 11.2338C8.69986 11.4987 7.99609 11.5681 7.31712 11.433C6.63816 11.2979 6.01449 10.9645 5.52501 10.475C5.03548 9.98552 4.70209 9.36185 4.56702 8.68289C4.43195 8.00392 4.50127 7.30015 4.76619 6.66057C5.03112 6.021 5.47976 5.47436 6.05538 5.08978C6.631 4.70519 7.30774 4.49995 8.00001 4.5" />
			<path d="M8.00024 7.99976L11.2 4.80005" />
			<path d="M12.4719 5.62245C12.4246 5.66972 12.3569 5.69025 12.2913 5.67715L10.7814 5.37555C10.7022 5.35972 10.6402 5.29781 10.6244 5.2186L10.3228 3.70866C10.3097 3.6431 10.3302 3.57533 10.3775 3.52806L12.1826 1.723C12.2863 1.61929 12.4627 1.65879 12.5122 1.79684L12.9271 2.95225C12.9472 3.00847 12.9915 3.05272 13.0477 3.07291L14.2031 3.48774C14.3412 3.5373 14.3807 3.71368 14.277 3.81739L12.4719 5.62245Z" />
		</svg>
	);
}

function PauseOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" />
			<path d="M6.5 5V11" />
			<path d="M9.5 5V11" />
		</svg>
	);
}

function PlayOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" />
			<path d="M10.3329 7.91346C10.3996 7.95195 10.3996 8.04818 10.3329 8.08667L6.78304 10.1362C6.71638 10.1747 6.63304 10.1266 6.63304 10.0496L6.63304 5.95055C6.63304 5.87357 6.71638 5.82546 6.78304 5.86395L10.3329 7.91346Z" />
		</svg>
	);
}

function EditOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path
				d="M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z"
				fill="currentColor"
				stroke="none"
			/>
			<path d="M7.7849 8.23878L13.888 2.13574" />
		</svg>
	);
}

function TrashOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1.28149 3.88831H14.7187" />
			<path d="M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833" />
			<path d="M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831" />
			<path d="M6.44946 6.98926V11.1238" />
			<path d="M9.55054 6.98926V11.1238" />
		</svg>
	);
}

function CheckOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" />
		</svg>
	);
}

function CloseOutlineIcon({ width = 14, height = 14 }: IconProps) {
	return (
		<svg
			width={width}
			height={height}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.2}
			aria-hidden="true"
			focusable="false"
		>
			<path d="M2.5 2.5L13.5 13.5" />
			<path d="M13.5 2.5L2.5 13.5" />
		</svg>
	);
}

/** 条上标签：与官方一致，active 但进程内未 armed 也按「已暂停」显示。 */
function goalLabel(goal: NativeGoal): string {
	if (goal.phase === 'paused') return '已暂停的目标';
	if (goal.phase === 'blocked') return '受阻的目标';
	return goal.activation === 'disarmed' ? '已暂停的目标' : '进行中的目标';
}

export function GoalBar({ goal, pending, error, onAction }: GoalBarProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState('');
	const editorRef = useRef<HTMLTextAreaElement>(null);

	// 目标身份一变（外部清除 / 完成 / 换成别一个目标）就丢弃本地编辑态：
	// 否则残留的草稿按 Enter 会写到新目标上。
	useEffect(() => {
		setEditing(false);
		setDraft('');
	}, [goal.id]);

	// 编辑框随内容长高；6 行上限交给 CSS 的 max-height，再往上在框内滚动。
	// ResizeObserver 覆盖「宽度变化 → 重新折行」的情况（与官方 InlineEditor 同口径）。
	useLayoutEffect(() => {
		const node = editorRef.current;
		if (node === null) return;
		const fit = (): void => {
			node.style.height = 'auto';
			node.style.height = node.scrollHeight + 'px';
		};
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(node);
		return () => {
			observer.disconnect();
		};
	}, [editing, draft]);

	if (goal.phase === 'complete') return null;

	const label = goalLabel(goal);
	const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined;
	const canPause = goal.phase === 'active' && goal.activation === 'armed';
	const canResume =
		goal.phase === 'paused' || (goal.phase === 'active' && goal.activation === 'disarmed');

	const save = (): void => {
		const trimmed = draft.trim();
		if (trimmed === '' || pending) return;
		onAction('edit', trimmed);
		setEditing(false);
	};

	const startEdit = (): void => {
		setDraft(goal.objective);
		setEditing(true);
	};

	const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === 'Escape') {
			event.preventDefault();
			setEditing(false);
			return;
		}
		// 部分引擎在组合输入时不置 isComposing，只给 legacy keyCode 229。
		const composing =
			event.nativeEvent.isComposing || Reflect.get(event.nativeEvent, 'keyCode') === 229;
		if (event.key !== 'Enter' || event.shiftKey || composing) return;
		event.preventDefault();
		save();
	};

	const actions = editing ? (
		<div className="dsh-native-goal-actions">
			<button
				type="button"
				className="dsh-native-goal-action"
				title="保存目标"
				aria-label="保存目标"
				disabled={pending || draft.trim() === ''}
				onClick={save}
			>
				<CheckOutlineIcon />
			</button>
			<button
				type="button"
				className="dsh-native-goal-action"
				title="取消编辑"
				aria-label="取消编辑"
				disabled={pending}
				onClick={() => setEditing(false)}
			>
				<CloseOutlineIcon />
			</button>
		</div>
	) : (
		<div className="dsh-native-goal-actions">
			{canPause ? (
				<button
					type="button"
					className="dsh-native-goal-action"
					title="暂停目标"
					aria-label="暂停目标"
					disabled={pending}
					onClick={() => onAction('pause')}
				>
					<PauseOutlineIcon />
				</button>
			) : null}
			{canResume ? (
				<button
					type="button"
					className="dsh-native-goal-action"
					title="恢复目标"
					aria-label="恢复目标"
					disabled={pending}
					onClick={() => onAction('resume')}
				>
					<PlayOutlineIcon />
				</button>
			) : null}
			<button
				type="button"
				className="dsh-native-goal-action"
				title="编辑目标"
				aria-label="编辑目标"
				disabled={pending}
				onClick={startEdit}
			>
				<EditOutlineIcon />
			</button>
			<button
				type="button"
				className="dsh-native-goal-action"
				title="清除目标"
				aria-label="清除目标"
				disabled={pending}
				onClick={() => onAction('clear')}
			>
				<TrashOutlineIcon />
			</button>
		</div>
	);

	return (
		<div className="dsh-native-goal" data-dsh-goal-bar="true">
			<div
				className={'dsh-native-goal-strip' + (editing ? ' is-editing' : '')}
				title={title}
			>
				{editing ? (
					<textarea
						ref={editorRef}
						className="dsh-native-goal-editor"
						rows={1}
						autoFocus
						aria-label="目标正文"
						value={draft}
						onChange={(event) => setDraft(event.currentTarget.value)}
						onKeyDown={onEditorKeyDown}
					/>
				) : (
					<>
						<span className="dsh-native-goal-glyph" aria-hidden="true">
							<GoalOutlineIcon />
						</span>
						<span className="dsh-native-goal-label">{label}</span>
						<span className="dsh-native-goal-objective">{goal.objective}</span>
					</>
				)}
				{error !== null ? (
					<span className="dsh-native-goal-error" role="alert">
						{error}
					</span>
				) : null}
				{actions}
			</div>
		</div>
	);
}
