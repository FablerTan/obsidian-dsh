import type { App } from 'obsidian';
import type { NativeChatNode } from '../../../shared/native-types';
import { asRecord, textOfContent } from './chat-node-data';
import { Icon } from './icon';
import { MarkdownText } from './markdown-text';

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
	return (
		<div className="dsh-native-message is-user">
			<div className="dsh-native-message-label">{label}</div>
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

function ContextCard({ node }: { node: NativeChatNode }) {
	const data = asRecord(node.data);
	return (
		<details className="dsh-native-context">
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
		<details className="dsh-native-context">
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

function UnknownNode({ node }: { node: NativeChatNode }) {
	return (
		<details className="dsh-native-context">
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
			return <ContextCard node={node} />;
		}
		case 'command':
			return <CommandRow node={node} />;
		case 'compaction':
			return <CompactionCard node={node} />;
		case 'manual-compaction':
			return <ManualCompactionRow node={node} />;
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
