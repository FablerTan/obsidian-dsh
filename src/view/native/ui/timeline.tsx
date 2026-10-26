import { Component, MarkdownRenderer, type App } from 'obsidian';
import { useEffect, useRef, useState } from 'react';
import type { NativeChatNode, NativeChatSnapshot } from '../../../shared/native-types';
import { Icon } from './icon';

interface ContentBlock {
	type?: string;
	text?: string;
}

interface AssistantBlock {
	kind?: string;
	text?: string;
	name?: string;
	argsRaw?: string;
	callId?: string;
	block?: unknown;
}

interface ToolRoot {
	kind?: string;
	callId?: string;
	name?: string;
	argsRaw?: string;
	call?: { name?: string; argsRaw?: string } | null;
	content?: ContentBlock[];
	isError?: boolean;
	error?: { name?: string; code?: string } | null;
	subCalls?: ToolRoot[];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function textOfContent(content: unknown): string {
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (typeof block.text === 'string') parts.push(block.text);
		else if (block.type === 'image') parts.push('[图片]');
	}
	return parts.join('\n');
}

function prettyJson(raw: string): string {
	const text = raw.trim();
	if (text === '') return '';
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return raw;
	}
}

function MarkdownText({
	app,
	text,
	sourcePath,
}: {
	app: App;
	text: string;
	sourcePath: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el === null) return;
		el.replaceChildren();
		const component = new Component();
		let cancelled = false;
		void MarkdownRenderer.render(app, text, el, sourcePath, component).catch(() => {
			if (!cancelled) el.setText(text);
		});
		return () => {
			cancelled = true;
			component.unload();
			el.replaceChildren();
		};
	}, [app, sourcePath, text]);
	return <div ref={ref} className="dsh-native-markdown markdown-rendered" />;
}

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
				{text === '' ? <span className="dsh-native-muted">[非文本消息]</span> : <MarkdownText app={app} text={text} sourcePath={sourcePath} />}
			</div>
		</div>
	);
}

function Reasoning({ text, running }: { text: string; running: boolean }) {
	return (
		<details className="dsh-native-reasoning" open={running ? true : undefined}>
			<summary>
				<Icon name="brain" />
				<span>思考</span>
				{running ? <span className="dsh-native-muted"> · 进行中</span> : null}
			</summary>
			<div className="dsh-native-reasoning-body">{text}</div>
		</details>
	);
}

function ToolCard({ root, depth = 0 }: { root: ToolRoot; depth?: number }) {
	const [open, setOpen] = useState(false);
	const settled = root.kind === 'tool-result';
	const name = root.call?.name ?? root.name ?? '工具';
	const argsRaw = root.call?.argsRaw ?? root.argsRaw ?? '';
	const isError = root.isError === true || (settled && root.error !== null && root.error !== undefined);
	const resultText = settled ? textOfContent(root.content) : '';
	const status = isError ? '失败' : settled ? '完成' : '运行中';
	return (
		<div className={'dsh-native-tool' + (isError ? ' is-error' : '')}>
			<button className="dsh-native-tool-head" onClick={() => setOpen((value) => !value)}>
				<Icon name={isError ? 'x-circle' : settled ? 'check-circle' : 'loader'} />
				<span className="dsh-native-tool-name">{name}</span>
				<span className="dsh-native-tool-status">{status}</span>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} />
			</button>
			{open ? (
				<div className="dsh-native-tool-body">
					{argsRaw !== '' ? (
						<>
							<div className="dsh-native-tool-label">参数</div>
							<pre>{prettyJson(argsRaw)}</pre>
						</>
					) : null}
					{settled ? (
						<>
							<div className="dsh-native-tool-label">
								结果{isError ? '（错误）' : ''}
							</div>
							<pre>{resultText === '' ? '（空结果）' : resultText}</pre>
						</>
					) : null}
					{root.error ? (
						<div className="dsh-native-tool-error">
							{root.error.name}: {root.error.code}
						</div>
					) : null}
					{root.callId ? (
						<div className="dsh-native-tool-meta">call: {root.callId}</div>
					) : null}
				</div>
			) : null}
			{depth < 3 && Array.isArray(root.subCalls)
				? root.subCalls.map((child, index) => (
						<ToolCard key={String(child.callId ?? index)} root={child} depth={depth + 1} />
					))
				: null}
		</div>
	);
}

function AssistantMessage({
	app,
	node,
	sourcePath,
}: {
	app: App;
	node: NativeChatNode;
	sourcePath: string;
}) {
	const data = asRecord(node.data);
	const blocks = Array.isArray(data.blocks) ? (data.blocks as AssistantBlock[]) : [];
	const running = data.status === 'running';
	const visible = blocks.filter((block) => block?.kind === 'text' || block?.kind === 'reasoning');
	if (visible.length === 0 && !running) return null;
	return (
		<div className={'dsh-native-message is-assistant' + (running ? ' is-running' : '')}>
			{visible.map((block, index) => {
				if (block.kind === 'text' && typeof block.text === 'string') {
					return <MarkdownText key={index} app={app} text={block.text} sourcePath={sourcePath} />;
				}
				if (block.kind === 'reasoning' && typeof block.text === 'string') {
					return (
						<Reasoning
							key={index}
							text={block.text}
							running={running && index === visible.length - 1}
						/>
					);
				}
				return null;
			})}
			{visible.length === 0 && running ? (
				<div className="dsh-native-typing">
					<span />
					<span />
					<span />
				</div>
			) : null}
			{running ? <div className="dsh-native-streaming-dot" /> : null}
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

function NodeView({
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
			return (
				<UserMessage app={app} label="追加" content={data.content} sourcePath={sourcePath} />
			);
		case 'assistant-step':
			return <AssistantMessage app={app} node={node} sourcePath={sourcePath} />;
		case 'tool-call':
			return <ToolCard root={asRecord(data.root) as ToolRoot} />;
		case 'context':
			return <ContextCard node={node} />;
		case 'command':
			return <CommandRow node={node} />;
		case 'compaction':
			return <CompactionCard node={node} />;
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
		case 'turn-tail':
			return null;
		default:
			return <UnknownNode node={node} />;
	}
}

export function Timeline({
	app,
	snapshot,
	sourcePath,
	loadingOlder,
	onLoadOlder,
}: {
	app: App;
	snapshot: NativeChatSnapshot;
	sourcePath: string;
	loadingOlder: boolean;
	onLoadOlder: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [atBottom, setAtBottom] = useState(true);
	const hasMore = snapshot.session.hasMore === true;

	const scrollToBottom = (): void => {
		const el = scrollRef.current;
		if (el === null) return;
		el.scrollTop = el.scrollHeight;
		setAtBottom(true);
	};

	useEffect(() => {
		const el = scrollRef.current;
		if (el === null) return;
		if (atBottom) {
			el.scrollTop = el.scrollHeight;
		}
	}, [atBottom, snapshot.revision]);

	return (
		<div className="dsh-native-timeline-wrap">
			<div
				ref={scrollRef}
				className="dsh-native-timeline"
				onScroll={(event) => {
					const el = event.currentTarget;
					setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
				}}
			>
				{hasMore ? (
					<div className="dsh-native-load-older">
						<button disabled={loadingOlder} onClick={onLoadOlder}>
							{loadingOlder ? '加载中…' : '加载更早'}
						</button>
					</div>
				) : null}
				{snapshot.nodes.map((node) => (
					<NodeView
						key={node.key}
						app={app}
						node={node}
						sourcePath={sourcePath}
					/>
				))}
			</div>
			{!atBottom ? (
				<button className="dsh-native-jump-bottom" onClick={scrollToBottom}>
					<Icon name="arrow-down" />
					<span>回到底部</span>
				</button>
			) : null}
		</div>
	);
}
