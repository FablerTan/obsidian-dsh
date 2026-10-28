import { useEffect, useMemo, useRef, useState } from 'react';
import type {
	NativePending,
	NativePendingApproval,
	NativePendingQuestion,
	NativeQuestionAnswer,
	NativeQuestionAnswerItem,
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

/** 与官方提问面板一致：把标签尾巴上的「(Recommended) / （推荐）」拆出来，单独渲染成「推荐」徽标。 */
function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
	const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
	if (!suffix.test(label)) return { label, recommended: false };
	return { label: label.replace(suffix, ''), recommended: true };
}

/** 单题作答草稿：翻页来回切换时保留，提交时再整批转换成 dsh 的 answers。 */
interface QuestionDraft {
	selected: string[];
	custom: string;
	skipped: boolean;
}

function emptyDraft(): QuestionDraft {
	return { selected: [], custom: '', skipped: false };
}

function isAnswered(draft: QuestionDraft): boolean {
	return draft.selected.length > 0 || draft.custom.trim() !== '';
}

function isCompleted(draft: QuestionDraft): boolean {
	return isAnswered(draft) || draft.skipped;
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
	const [index, setIndex] = useState(0);
	const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => emptyDraft()));
	const [error, setError] = useState<string | null>(null);
	const bodyRef = useRef<HTMLDivElement>(null);

	// 只有换了一批新提问才清空草稿：快照刷新会替换 pending 对象，不能按对象身份重置。
	useEffect(() => {
		setIndex(0);
		setDrafts((pending.questions ?? []).map(() => emptyDraft()));
		setError(null);
	}, [pending.key]);

	// 翻页时回到题目顶部：上一题滚到底后，新题不应从中段开始。
	useEffect(() => {
		if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
	}, [index]);

	const total = questions.length;
	const question: NativeQuestionItem | undefined = questions[index];
	const draft: QuestionDraft = drafts[index] ?? emptyDraft();
	const hasOptions = (question?.options?.length ?? 0) > 0;

	const patchDraft = (next: QuestionDraft): void => {
		setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
		setError(null);
	};

	const goTo = (next: number): void => {
		if (next < 0 || next >= total) return;
		setIndex(next);
		setError(null);
	};

	const choose = (label: string): void => {
		if (question === undefined) return;
		if (question.multiSelect === true) {
			const selected = draft.selected.includes(label)
				? draft.selected.filter((value) => value !== label)
				: [...draft.selected, label];
			patchDraft({ ...draft, selected, skipped: false });
			return;
		}
		// 单选：选中即替换自填答案，并像官方一样自动翻到下一题。
		patchDraft({ selected: [label], custom: '', skipped: false });
		if (index < total - 1) goTo(index + 1);
	};

	const editCustom = (value: string): void => {
		patchDraft({
			selected: question?.multiSelect === true ? draft.selected : [],
			custom: value,
			skipped: false,
		});
	};

	const submitDrafts = (values: QuestionDraft[]): void => {
		const missing = values.findIndex((item) => !isCompleted(item));
		if (missing >= 0) {
			setIndex(missing);
			setError('还有未回答的问题');
			return;
		}
		const answers: NativeQuestionAnswerItem[] = questions.map((item, itemIndex) => {
			const value = values[itemIndex] ?? emptyDraft();
			if (value.skipped) return { id: item.id, selected: [] };
			const custom = value.custom.trim();
			return {
				id: item.id,
				selected: custom === '' || item.multiSelect === true ? value.selected : [],
				...(custom === '' ? {} : { custom }),
			};
		});
		onAnswer({ answers });
	};

	const continueFlow = (): void => {
		if (!isAnswered(draft)) {
			setError('请先选择选项或填写答案');
			return;
		}
		if (index < total - 1) {
			goTo(index + 1);
			return;
		}
		submitDrafts(drafts);
	};

	const skipQuestion = (): void => {
		const nextDrafts = drafts.map((item, itemIndex) =>
			itemIndex === index ? { selected: [], custom: '', skipped: true } : item,
		);
		setDrafts(nextDrafts);
		if (index < total - 1) {
			setIndex(index + 1);
			setError(null);
			return;
		}
		submitDrafts(nextDrafts);
	};

	return (
		<div className="dsh-native-pending-card is-question">
			<div className="dsh-native-pending-head">
				<Icon name="help-circle" />
				<span>{pending.kind === 'plan-review' ? '计划审核' : '需要回答'}</span>
			</div>
			{total === 0 ? (
				<pre className="dsh-native-pending-reason">
					{pending.kind === 'plan-review'
						? '计划审核暂未在原生面板中支持，请切到 DSH 面板处理。'
						: JSON.stringify(pending, null, 2).slice(0, 4000)}
				</pre>
			) : question === undefined ? null : (
				<>
					<div className="dsh-native-question-head">
						{question.header !== undefined && question.header !== '' ? (
							<div className="dsh-native-question-eyebrow">{question.header}</div>
						) : null}
						<div className="dsh-native-question-text">{question.question}</div>
					</div>
					<div className="dsh-native-question-body" ref={bodyRef}>
						{question.detail !== undefined && question.detail !== '' ? (
							<div className="dsh-native-question-detail">{question.detail}</div>
						) : null}
						<div
							className="dsh-native-question-options"
							role={question.multiSelect === true ? 'group' : 'radiogroup'}
						>
							{(question.options ?? []).map((option, optionIndex) => {
								const display = parseRecommendedLabel(option.label);
								const active = draft.selected.includes(option.label);
								return (
									<button
										key={option.label}
										className={'dsh-native-option' + (active ? ' is-active' : '')}
										role={question.multiSelect === true ? 'checkbox' : 'radio'}
										aria-checked={active}
										aria-label={display.label}
										disabled={busy}
										onClick={() => choose(option.label)}
									>
										{question.multiSelect === true ? (
											<span
												className={
													'dsh-native-option-box' + (active ? ' is-checked' : '')
												}
												aria-hidden="true"
											>
												{active ? <Icon name="check" size={12} /> : null}
											</span>
										) : (
											<span className="dsh-native-option-number" aria-hidden="true">
												{optionIndex + 1}
											</span>
										)}
										<span className="dsh-native-option-copy">
											<span className="dsh-native-option-line">
												<span className="dsh-native-option-label">
													{display.label}
												</span>
												{display.recommended ? (
													<span className="dsh-native-option-badge">推荐</span>
												) : null}
												{option.description !== undefined &&
												option.description !== '' ? (
													<span className="dsh-native-option-detail">
														{option.description}
													</span>
												) : null}
											</span>
										</span>
									</button>
								);
							})}
							{hasOptions ? (
								<div
									className={
										'dsh-native-custom-row' +
										(draft.custom !== '' ? ' is-active' : '')
									}
								>
									{question.multiSelect === true ? (
										<span
											className={
												'dsh-native-option-box' +
												(draft.custom !== '' ? ' is-checked' : '')
											}
											aria-hidden="true"
										>
											{draft.custom !== '' ? <Icon name="check" size={12} /> : null}
										</span>
									) : (
										<span className="dsh-native-option-number" aria-hidden="true">
											<Icon name="pencil" size={12} />
										</span>
									)}
									<input
										className="dsh-native-question-custom"
										placeholder="输入你的答案"
										value={draft.custom}
										disabled={busy}
										onChange={(event) => editCustom(event.target.value)}
										onKeyDown={(event) => {
											if (
												event.key !== 'Enter' ||
												event.shiftKey ||
												event.nativeEvent.isComposing
											) {
												return;
											}
											event.preventDefault();
											continueFlow();
										}}
									/>
								</div>
							) : (
								<input
									className="dsh-native-question-custom is-block"
									placeholder="输入你的答案"
									value={draft.custom}
									disabled={busy}
									onChange={(event) => editCustom(event.target.value)}
									onKeyDown={(event) => {
										if (
											event.key !== 'Enter' ||
											event.shiftKey ||
											event.nativeEvent.isComposing
										) {
											return;
										}
										event.preventDefault();
										continueFlow();
									}}
								/>
							)}
						</div>
					</div>
					<footer className="dsh-native-question-footer">
						<div className="dsh-native-question-pager">
							<button
								type="button"
								className="dsh-native-icon-button"
								aria-label="上一题"
								title="上一题"
								disabled={index === 0 || busy}
								onClick={() => goTo(index - 1)}
							>
								<Icon name="chevron-left" size={14} />
							</button>
							<span className="dsh-native-question-progress">
								{index + 1}/{total}
							</span>
							<button
								type="button"
								className="dsh-native-icon-button"
								aria-label="下一题"
								title="下一题"
								disabled={index >= total - 1 || busy}
								onClick={() => goTo(index + 1)}
							>
								<Icon name="chevron-right" size={14} />
							</button>
						</div>
						{error !== null ? <span className="dsh-native-question-error">{error}</span> : null}
						<div className="dsh-native-question-actions">
							<button type="button" disabled={busy} onClick={skipQuestion}>
								跳过
							</button>
							<button
								type="button"
								className="mod-cta"
								disabled={busy}
								onClick={() => submitDrafts(drafts)}
							>
								提交
							</button>
						</div>
					</footer>
				</>
			)}
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
