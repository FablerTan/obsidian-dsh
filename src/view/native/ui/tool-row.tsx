import { useState } from 'react';
import type { ProcessCategory, ToolCallEntry } from './chat-node-data';
import { Icon } from './icon';

/** 单个工具调用：默认一行（图标 + 名称 + 参数摘要 + 状态），点击展开参数与结果。 */

const TOOL_TITLES: Record<ProcessCategory, string> = {
	code: '代码',
	commands: '运行命令',
	read: '读取',
	readImage: '查看图片',
	write: '写入',
	edit: '修改',
	search: '搜索',
	webSearch: '网页搜索',
	webFetch: '访问网页',
	subagents: '子智能体',
	plan: '更新计划',
	questions: '提问',
	team: '团队',
	tools: '工具',
};

const TOOL_ICONS: Record<ProcessCategory, string> = {
	code: 'code',
	commands: 'terminal',
	read: 'file-text',
	readImage: 'image',
	write: 'file-plus',
	edit: 'pencil',
	search: 'search',
	webSearch: 'globe',
	webFetch: 'link',
	subagents: 'bot',
	plan: 'list-checks',
	questions: 'help-circle',
	team: 'users',
	tools: 'wrench',
};

const TOOL_ACTIVITY: Record<ProcessCategory, string> = {
	code: '运行代码',
	commands: '运行命令',
	read: '读取文件',
	readImage: '查看图片',
	write: '写入文件',
	edit: '修改文件',
	search: '搜索代码',
	webSearch: '搜索网页',
	webFetch: '访问网页',
	subagents: '协调子智能体',
	plan: '更新计划',
	questions: '向你提问',
	team: '协调团队',
	tools: '调用工具',
};

const TOOL_PAST: Record<ProcessCategory, string> = {
	code: '运行了代码',
	commands: '执行了命令',
	read: '读取了文件',
	readImage: '查看了图片',
	write: '写入了文件',
	edit: '修改了文件',
	search: '搜索了代码',
	webSearch: '搜索了网页',
	webFetch: '访问了网页',
	subagents: '协调了子智能体',
	plan: '更新了计划',
	questions: '向你提问了',
	team: '协调了团队',
	tools: '调用了工具',
};

/** 团队工具的逐工具标题（与 dsh Web 的 tool.title.* 对齐）；未知时退回类目标题。 */
const TEAM_TOOL_TITLES: Record<string, string> = {
	spawn_teammate: '创建队友',
	send_message: '发送消息',
	list_agents: '查看子智能体',
	wait_agent: '等待子智能体',
	interrupt_agent: '中断智能体',
	team_task_create: '创建团队任务',
	team_task_list: '查看团队任务',
	team_task_get: '读取团队任务',
	team_task_update: '更新团队任务',
};

export function toolTitle(tool: ToolCallEntry): string {
	const title = TOOL_TITLES[tool.category];
	if (tool.category === 'team') return TEAM_TOOL_TITLES[tool.name] ?? title;
	return tool.category === 'tools' ? tool.name || title : title;
}

export function toolIcon(category: ProcessCategory): string {
	return TOOL_ICONS[category];
}

export function toolActivity(category: ProcessCategory): string {
	return TOOL_ACTIVITY[category];
}

export function toolPast(category: ProcessCategory): string {
	return TOOL_PAST[category];
}

export function oneLine(text: string, max = 110): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function argsOf(tool: ToolCallEntry): Record<string, unknown> {
	const raw = tool.argsRaw.trim();
	if (raw === '') return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed !== null && typeof parsed === 'object'
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function pick(args: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === 'string' && value.trim() !== '') return value;
	}
	return '';
}

export function toolSummary(tool: ToolCallEntry): string {
	const args = argsOf(tool);
	let summary = '';
	switch (tool.category) {
		case 'code':
			summary = pick(args, ['description']) || pick(args, ['code']);
			break;
		case 'commands':
			summary = pick(args, ['description']) || pick(args, ['command']);
			break;
		case 'read':
		case 'readImage':
		case 'write':
		case 'edit':
			summary = pick(args, ['description']) || pick(args, ['file_path', 'path']);
			break;
		case 'search':
			summary = pick(args, ['pattern', 'query']);
			break;
		case 'webSearch':
			summary = pick(args, ['query']);
			break;
		case 'webFetch':
			summary = pick(args, ['url']);
			break;
		case 'subagents':
			summary = pick(args, ['description', 'prompt']);
			break;
		case 'plan':
			summary = pick(args, ['explanation', 'plan']);
			break;
		case 'team': {
			if (tool.name === 'wait_agent') {
				summary = '等待团队变化';
				break;
			}
			const target = pick(args, ['target', 'name', 'subject', 'task_id']);
			const detail = pick(args, ['message', 'description', 'prompt']);
			summary = target === '' ? detail : detail === '' ? target : target + ' · ' + detail;
			break;
		}
		default:
			summary = pick(args, ['description', 'command', 'path', 'file_path', 'query', 'url']);
	}
	return oneLine(summary);
}

export function prettyJson(raw: string): string {
	const text = raw.trim();
	if (text === '') return '';
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return raw;
	}
}

export function ToolRow({ tool, depth = 0 }: { tool: ToolCallEntry; depth?: number }) {
	const [open, setOpen] = useState(false);
	const summary = toolSummary(tool);
	const status = tool.isError ? '失败' : tool.settled ? '' : '运行中';
	const icon = tool.isError ? 'x-circle' : tool.settled ? 'check-circle' : 'loader';
	const error = tool.error;
	return (
		<div
			className={
				'dsh-native-tool' +
				(tool.isError ? ' is-error' : '') +
				(depth > 0 ? ' is-sub' : '')
			}
		>
			<button
				className="dsh-native-tool-head"
				title={tool.name}
				onClick={() => setOpen((value) => !value)}
			>
				<Icon name={icon} size={14} />
				<span className="dsh-native-tool-name">{toolTitle(tool)}</span>
				{summary === '' ? (
					<span className="dsh-native-tool-summary" />
				) : (
					<span className="dsh-native-tool-summary">{summary}</span>
				)}
				{status === '' ? null : <span className="dsh-native-tool-status">{status}</span>}
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
			</button>
			{open ? (
				<div className="dsh-native-tool-body">
					{tool.argsRaw.trim() === '' ? null : (
						<>
							<div className="dsh-native-tool-label">参数</div>
							<pre>{prettyJson(tool.argsRaw)}</pre>
						</>
					)}
					{tool.settled ? (
						<>
							<div className="dsh-native-tool-label">
								结果{tool.isError ? '（错误）' : ''}
							</div>
							<pre>{tool.content === '' ? '（空结果）' : tool.content}</pre>
						</>
					) : null}
					{error === null ? null : <div className="dsh-native-tool-error">{error}</div>}
				</div>
			) : null}
			{depth < 3
				? tool.subCalls.map((child) => (
						<ToolRow key={child.key} tool={child} depth={depth + 1} />
					))
				: null}
		</div>
	);
}
