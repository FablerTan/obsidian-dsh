import { useEffect, useMemo, useState } from 'react';
import type {
	NativePending,
	NativePendingApproval,
	NativePendingQuestion,
	NativeQuestionAnswer,
	NativeQuestionItem,
} from '../../../shared/native-types';
import { Icon } from './icon';

function reasonText(approval: NativePendingApproval): string {
	if (approval.reason !== null && approval.reason !== '') return approval.reason;
	if (approval.displayReason === null || approval.displayReason === undefined) return '';
	if (typeof approval.displayReason === 'string') return approval.displayReason;
	return JSON.stringify(approval.displayReason, null, 2);
}

function ApprovalCard({
	approval,
	busy,
	onAnswer,
}: {
	approval: NativePendingApproval;
	busy: boolean;
	onAnswer: (decision: 'allowed-once' | 'rejected') => void;
}) {
	return (
		<div className="dsh-native-pending-card">
			<div className="dsh-native-pending-head">
				<Icon name="shield-alert" />
				<span>需要审批</span>
				<span className="dsh-native-pending-tool">{approval.toolName}</span>
			</div>
			{reasonText(approval) !== '' ? (
				<pre className="dsh-native-pending-reason">{reasonText(approval)}</pre>
			) : null}
			<div className="dsh-native-pending-actions">
				<button
					className="mod-cta"
					disabled={busy || approval.answerable === false}
					onClick={() => onAnswer('allowed-once')}
				>
					允许一次
				</button>
				<button
					disabled={busy || approval.answerable === false}
					onClick={() => onAnswer('rejected')}
				>
					拒绝
				</button>
			</div>
		</div>
	);
}

function QuestionCard({
	pending,
	busy,
	onAnswer,
}: {
	pending: NativePendingQuestion;
	busy: boolean;
	onAnswer: (answer: NativeQuestionAnswer) => void;
}) {
	const questions = useMemo(() => pending.questions ?? [], [pending.questions]);
	const [selected, setSelected] = useState<Record<string, string[]>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});

	useEffect(() => {
		setSelected({});
		setCustom({});
	}, [pending.key]);

	const toggle = (question: NativeQuestionItem, label: string): void => {
		setSelected((current) => {
			const previous = current[question.id] ?? [];
			if (question.multiSelect === true) {
				return {
					...current,
					[question.id]: previous.includes(label)
						? previous.filter((value) => value !== label)
						: [...previous, label],
				};
			}
			return { ...current, [question.id]: [label] };
		});
	};

	const submit = (): void => {
		const answers = questions.map((question) => {
			const picked = selected[question.id] ?? [];
			const customText = (custom[question.id] ?? '').trim();
			return {
				id: question.id,
				selected: picked,
				...(customText === '' ? {} : { custom: customText }),
			};
		});
		onAnswer({ answers });
	};

	return (
		<div className="dsh-native-pending-card">
			<div className="dsh-native-pending-head">
				<Icon name="help-circle" />
				<span>{pending.kind === 'plan-review' ? '计划审核' : '需要回答'}</span>
			</div>
			{questions.length === 0 ? (
				<pre className="dsh-native-pending-reason">
					{pending.kind === 'plan-review'
						? '计划审核暂未在原生面板中支持，请切到 DSH 面板处理。'
						: JSON.stringify(pending, null, 2).slice(0, 4000)}
				</pre>
			) : (
				questions.map((question) => (
					<div key={question.id} className="dsh-native-question">
						{question.header !== undefined && question.header !== '' ? (
							<div className="dsh-native-question-header">{question.header}</div>
						) : null}
						<div className="dsh-native-question-text">{question.question}</div>
						{question.detail !== undefined && question.detail !== '' ? (
							<div className="dsh-native-question-detail">{question.detail}</div>
						) : null}
						<div className="dsh-native-question-options">
							{(question.options ?? []).map((option) => {
								const active = (selected[question.id] ?? []).includes(option.label);
								return (
									<button
										key={option.label}
										className={'dsh-native-option' + (active ? ' is-active' : '')}
										onClick={() => toggle(question, option.label)}
									>
										<span className="dsh-native-option-label">{option.label}</span>
										{option.description !== undefined && option.description !== '' ? (
											<span className="dsh-native-option-detail">
												{option.description}
											</span>
										) : null}
									</button>
								);
							})}
						</div>
						<input
							className="dsh-native-question-custom"
							placeholder="自定义答案（可选）"
							value={custom[question.id] ?? ''}
							onChange={(event) =>
								setCustom((current) => ({
									...current,
									[question.id]: event.target.value,
								}))
							}
						/>
					</div>
				))
			)}
			{questions.length > 0 ? (
				<div className="dsh-native-pending-actions">
					<button className="mod-cta" disabled={busy} onClick={submit}>
						提交答案
					</button>
				</div>
			) : null}
		</div>
	);
}

export function PendingCard({
	pending,
	busy,
	onApproval,
	onQuestion,
}: {
	pending: NativePending;
	busy: boolean;
	onApproval: (decision: 'allowed-once' | 'rejected') => void;
	onQuestion: (answer: NativeQuestionAnswer) => void;
}) {
	if (pending.kind === 'approval') {
		return (
			<ApprovalCard
				approval={pending as NativePendingApproval}
				busy={busy}
				onAnswer={onApproval}
			/>
		);
	}
	if (pending.kind === 'question' || pending.kind === 'plan-review') {
		return (
			<QuestionCard
				pending={pending as NativePendingQuestion}
				busy={busy}
				onAnswer={onQuestion}
			/>
		);
	}
	return (
		<div className="dsh-native-pending-card">
			<div className="dsh-native-pending-head">
				<Icon name="help-circle" />
				<span>待处理交互</span>
			</div>
			<pre className="dsh-native-pending-reason">
				{JSON.stringify(pending, null, 2).slice(0, 4000)}
			</pre>
		</div>
	);
}
