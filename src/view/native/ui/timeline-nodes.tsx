import type { App } from 'obsidian';
import type { NativeChatNode } from '../../../shared/native-types';
import { asRecord, textOfContent } from './chat-node-data';
import { Icon } from './icon';
import { MarkdownText } from './markdown-text';
import { parseQuote } from '../quote';
import { QuoteCard } from './quote-card';
import { oneLine } from './tool-row';

/**
 * 时间线里非过程类节点：用户消息、正文、上下文 / 命令 / 压缩 / 错误提示。
 * 思考与工具调用由 timeline-process.tsx 折叠成过程行，这里不再单独渲染。
 */

function UserMessage({
	app,
	label,
	content,
	sourcePath,
}: {
	app: App;
	label: string;
	content: unknown;
	sourcePath: string;
}) {
	const text = textOfContent(content);
	// 0058：引用块单独渲染成微信式引用卡，正文仍走 Markdown；拆不出来按原文渲染。
	const parsed = parseQuote(text);
	const body = parsed === null ? text : parsed.body;
	return (
		<div className="dsh-native-message is-user">
			<div className="dsh-native-message-label">{label}</div>
			<div className="dsh-native-bubble">
				{parsed !== null ? (
					<QuoteCard
						app={app}
						quote={parsed.quote}
						truncatedTotal={parsed.truncatedTotal}
					/>
				) : null}
				{body !== '' ? (
					<MarkdownText app={app} text={body} sourcePath={sourcePath} />
				) : parsed === null ? (
					<span className="dsh-native-muted">[非文本消息]</span>
				) : null}
			</div>
		</div>
	);
}

export function AssistantText({
	app,
	text,
	streaming = false,
	sourcePath,
}: {
	app: App;
	text: string;
	/** 流式进行中：纯文本快通道（不整段重排 Markdown），收尾后由正式节点接管为 Markdown。 */
	streaming?: boolean;
	sourcePath: string;
}) {
	return (
		<div className="dsh-native-message is-assistant">
			{streaming ? (
				<div className="dsh-native-live-text">{text}</div>
			) : (
				<MarkdownText app={app} text={text} sourcePath={sourcePath} />
			)}
		</div>
	);
}

/**
 * 队友消息（0035）：dsh 的 team-message 在 Lead 历史里是 context 节点，
 * 默认会渲染成「上下文注入」JSON；这里换成带发送者的消息卡，避免误读成用户自己的话。
 */
function TeamMessage({
	app,
	source,
	content,
	sourcePath,
}: {
	app: App;
	source: Record<string, unknown>;
	content: unknown;
	sourcePath: string;
}) {
	const sender =
		typeof source.senderName === 'string' && source.senderName !== ''
			? source.senderName
			: '队友';
	const text = textOfContent(content);
	return (
		<div className="dsh-native-message is-team">
			<div className="dsh-native-message-label dsh-native-team-message-label">
				<Icon name="users" size={12} />
				<span>队友 {sender}</span>
			</div>
			<div className="dsh-native-bubble">
				{text === '' ? (
					<span className="dsh-native-muted">[非文本消息]</span>
				) : (
					<MarkdownText app={app} text={text} sourcePath={sourcePath} />
				)}
			</div>
		</div>
	);
}

/** 子会话 id 很长，卡片上只留可辨认的一段。 */
function shortSessionId(id: string): string {
	return id.length > 20 ? id.slice(0, 19) + '…' : id;
}

/**
 * 子任务状态更新（0041）：dsh 的 subagent-settled 在父会话历史里也是 context 节点，
 * source = { kind, form: 'notice', summary, senderSessionId }；默认会渲染成「上下文注入」JSON。
 * 这里换成带子智能体标签的卡片：summary 是「子代理结束 / 为什么结束」的一行说明，正文是它的收尾消息。
 */
function SubagentSettledMessage({
	app,
	source,
	content,
	sourcePath,
}: {
	app: App;
	source: Record<string, unknown>;
	content: unknown;
	sourcePath: string;
}) {
	const sender =
		typeof source.senderName === 'string' && source.senderName !== ''
			? source.senderName
			: typeof source.senderSessionId === 'string' && source.senderSessionId !== ''
				? shortSessionId(source.senderSessionId)
				: '子智能体';
	const summary = typeof source.summary === 'string' ? source.summary.trim() : '';
	const text = textOfContent(content);
	// notice 的 summary 同时是正文首行；已经在正文里时不再重复显示。
	const showSummary = summary !== '' && text !== '' && !text.includes(summary);
	const body = text === '' ? summary : text;
	return (
		<div className="dsh-native-message is-team is-subagent">
			<div className="dsh-native-message-label dsh-native-team-message-label">
				<Icon name="bot" size={12} />
				<span>子任务状态更新 · {sender}</span>
			</div>
			{showSummary ? <div className="dsh-native-muted">{summary}</div> : null}
			<div className="dsh-native-bubble">
				{body === '' ? (
					<span className="dsh-native-muted">[非文本消息]</span>
				) : (
					<MarkdownText app={app} text={body} sourcePath={sourcePath} />
				)}
			</div>
		</div>
	);
}

function ContextCard({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	return (
		<details className="dsh-native-context-card">
			<summary>
				<Icon name="layers" />
				<span>上下文注入</span>
			</summary>
			<pre>{JSON.stringify(data, null, 2).slice(0, 6000)}</pre>
		</details>
	);
}

function CommandRow({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	const name = typeof data.name === 'string' ? data.name : 'command';
	const args = typeof data.args === 'string' ? data.args : '';
	const outcome = asRecord(data.outcome);
	const state = outcome.kind === 'error' ? '失败' : outcome.kind === 'success' ? '完成' : '运行中';
	return (
		<div className={'dsh-native-command' + (outcome.kind === 'error' ? ' is-error' : '')}>
			<Icon name="terminal" />
			<span className="dsh-native-command-name">/{name}</span>
			{args !== '' ? <span className="dsh-native-muted">{args}</span> : null}
			<span className="dsh-native-command-state">{state}</span>
			{typeof outcome.text === 'string' && outcome.text !== '' ? (
				<div className="dsh-native-command-text">{outcome.text}</div>
			) : null}
		</div>
	);
}

function CompactionCard({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	return (
		<details className="dsh-native-context-card">
			<summary>
				<Icon name="archive" />
				<span>上下文已压缩</span>
			</summary>
			<pre>{JSON.stringify(data, null, 2).slice(0, 6000)}</pre>
		</details>
	);
}

/**
 * 手动压缩（`/compact`）的宿主节点：data = { command, compaction }。
 * 命令本身有 name / outcome，压到东西时 compaction 带条目数与 token 数。
 */
function ManualCompactionRow({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	const command = asRecord(data.command);
	const name = typeof command.name === 'string' ? command.name : 'compact';
	const outcome = asRecord(command.outcome);
	const state = outcome.kind === 'error' ? '失败' : outcome.kind === 'success' ? '完成' : '运行中';
	// 条目数 / token 数由宿主写进 outcome.text（"Compacted N history items…"），这里不重复统计。
	return (
		<div className={'dsh-native-command' + (outcome.kind === 'error' ? ' is-error' : '')}>
			<Icon name="archive" />
			<span className="dsh-native-command-name">/{name}</span>
			<span className="dsh-native-command-state">{state}</span>
			{typeof outcome.text === 'string' && outcome.text !== '' ? (
				<div className="dsh-native-command-text">{outcome.text}</div>
			) : null}
		</div>
	);
}

/**
 * 提问答案记录（question-reply）：dsh 在历史里写一条 { time, callId, outcome, questions[], answers[] }。
 * 以前落进 UnknownNode，把整段 JSON 平铺成一块；这里换成「一行摘要 + 展开看每题问与答」。
 */
function QuestionReplyCard({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	const questions = Array.isArray(data.questions) ? data.questions.map(asRecord) : [];
	const answers = Array.isArray(data.answers) ? data.answers.map(asRecord) : [];
	const outcome = typeof data.outcome === 'string' ? data.outcome : '';
	const state =
		outcome === 'answered' ? '已回答' : outcome === 'cancelled' ? '已取消' : '已结束';
	const rows = answers.map((answer) => {
		const id = typeof answer.id === 'string' ? answer.id : '';
		const question = questions.find((item) => item.id === id) ?? {};
		const selected = Array.isArray(answer.selected)
			? answer.selected.filter((value): value is string => typeof value === 'string')
			: [];
		const custom = typeof answer.custom === 'string' ? answer.custom.trim() : '';
		const value = custom !== '' ? custom : selected.join('、');
		return {
			id,
			header: typeof question.header === 'string' ? question.header : '',
			question: typeof question.question === 'string' ? question.question : '',
			value,
			empty: value === '',
		};
	});
	const preview = rows
		.filter((row) => !row.empty)
		.map((row) => row.value)
		.join(' · ');
	return (
		<details className="dsh-native-answer">
			<summary>
				<Icon name="help-circle" size={14} />
				<span>{state}</span>
				<span className="dsh-native-answer-preview">
					{rows.length} 题{preview === '' ? '' : ' · ' + oneLine(preview, 60)}
				</span>
			</summary>
			<ul className="dsh-native-answer-list">
				{rows.map((row) => (
					<li key={row.id}>
						<span className="dsh-native-answer-question">
							{row.header === '' ? row.question : row.header + ' · ' + row.question}
						</span>
						<span
							className={
								'dsh-native-answer-value' + (row.empty ? ' is-empty' : '')
							}
						>
							{row.empty ? '跳过' : row.value}
						</span>
					</li>
				))}
			</ul>
		</details>
	);
}

function UnknownNode({ node }: { node: NativeChatNode }) {
	return (
		<details className="dsh-native-context-card">
			<summary>
				<Icon name="box" />
				<span>{node.kind}</span>
			</summary>
			<pre>{JSON.stringify(node.data, null, 2).slice(0, 6000)}</pre>
		</details>
	);
}

export function NodeView({
	app,
	node,
	sourcePath,
}: {
	app: App;
	node: NativeChatNode;
	sourcePath: string;
}) {
	if (node.visibility === 'hidden') return null;
	const data = asRecord(node.data);
	switch (node.kind) {
		case 'user':
			return <UserMessage app={app} label="你" content={data.content} sourcePath={sourcePath} />;
		case 'steering':
			return <UserMessage app={app} label="追加" content={data.content} sourcePath={sourcePath} />;
		case 'context': {
			const source = asRecord(data.source);
			if (source.kind === 'team-message') {
				return (
					<TeamMessage
						app={app}
						source={source}
						content={data.content}
						sourcePath={sourcePath}
					/>
				);
			}
			if (source.kind === 'subagent-settled') {
				return (
					<SubagentSettledMessage
						app={app}
						source={source}
						content={data.content}
						sourcePath={sourcePath}
					/>
				);
			}
			return <ContextCard node={node} />;
		}
		case 'command':
			return <CommandRow node={node} />;
		case 'compaction':
			return <CompactionCard node={node} />;
		case 'manual-compaction':
			return <ManualCompactionRow node={node} />;
		case 'question-reply':
			return <QuestionReplyCard node={node} />;
		case 'turn-error':
			return (
				<div className="dsh-native-error-card">
					<Icon name="alert-triangle" />
					<div>
						<div>{typeof data.message === 'string' ? data.message : '本轮执行失败'}</div>
						{typeof data.code === 'string' ? (
							<div className="dsh-native-muted">{data.code}</div>
						) : null}
					</div>
				</div>
			);
		case 'turn-max-tokens':
			return (
				<div className="dsh-native-notice-card">
					<Icon name="alert-circle" />
					<span>本轮输出达到 token 上限</span>
				</div>
			);
		case 'model-retry':
			return (
				<div className="dsh-native-notice-card">
					<Icon name="refresh-cw" />
					<span>模型重试</span>
				</div>
			);
		case 'assistant-step':
		case 'tool-call':
		case 'turn-process':
		case 'turn-tail':
			return null;
		default:
			return <UnknownNode node={node} />;
	}
}
