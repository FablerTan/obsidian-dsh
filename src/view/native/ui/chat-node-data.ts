import type { NativeChatNode } from '../../../shared/native-types';

/** DSH chat 节点的防御式读取：原生桥传过来的是 unknown，字段可能缺失。 */

export type ProcessCategory =
	| 'code'
	| 'commands'
	| 'read'
	| 'readImage'
	| 'write'
	| 'edit'
	| 'search'
	| 'webSearch'
	| 'webFetch'
	| 'subagents'
	| 'plan'
	| 'questions'
	| 'team'
	| 'agentControl'
	| 'tools';

export interface ThinkingEntry {
	type: 'thinking';
	key: string;
	text: string;
}

export interface ToolCallEntry {
	type: 'tool';
	/** React key；同一 callId 的块与节点共用，保证展开状态不丢。 */
	key: string;
	callId: string;
	name: string;
	argsRaw: string;
	content: string;
	settled: boolean;
	isError: boolean;
	error: string | null;
	category: ProcessCategory;
	subCalls: ToolCallEntry[];
}

export type ProcessEntry = ThinkingEntry | ToolCallEntry;

const TOOL_CATEGORIES: Record<string, ProcessCategory> = {
	run_code: 'code',
	code: 'code',
	bash: 'commands',
	terminal: 'commands',
	shell: 'commands',
	exec: 'commands',
	read: 'read',
	read_file: 'read',
	read_image: 'readImage',
	write: 'write',
	write_file: 'write',
	edit: 'edit',
	apply_patch: 'edit',
	grep: 'search',
	glob: 'search',
	search: 'search',
	web_search: 'webSearch',
	web_fetch: 'webFetch',
	subagent: 'subagents',
	subagent_fork: 'subagents',
	task: 'subagents',
	update_plan: 'plan',
	plan: 'plan',
	ask_user_question: 'questions',
	spawn_teammate: 'team',
	wait_agent: 'team',
	// 子智能体控制工具在团队与非团队场景都会出现，与 team 分开，避免过程行误说「协调团队」。
	send_message: 'agentControl',
	list_agents: 'agentControl',
	interrupt_agent: 'agentControl',
	team_task_create: 'team',
	team_task_list: 'team',
	team_task_get: 'team',
	team_task_update: 'team',
};

function categoryOfTool(name: string): ProcessCategory {
	return TOOL_CATEGORIES[name] ?? 'tools';
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function blockText(block: Record<string, unknown>): string {
	return str(block.text);
}

export function textOfContent(content: unknown): string {
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const raw of content) {
		const block = asRecord(raw);
		if (typeof block.text === 'string') parts.push(block.text);
		else if (block.type === 'image') parts.push('[图片]');
	}
	return parts.join('\n');
}

export function toolFromRoot(root: Record<string, unknown>, key: string): ToolCallEntry {
	const call = asRecord(root.call);
	const name = str(call.name) || str(root.name) || '工具';
	const callId = str(root.callId) || key;
	const errorRecord = asRecord(root.error);
	const isError = root.isError === true || (root.error !== null && root.error !== undefined);
	const error = isError
		? [str(errorRecord.name), str(errorRecord.code)].filter((part) => part !== '').join(': ') ||
			'工具执行失败'
		: null;
	const subCalls = Array.isArray(root.subCalls)
		? root.subCalls.map((child, index) => toolFromRoot(asRecord(child), callId + ':sub:' + index))
		: [];
	return {
		type: 'tool',
		key: 'tool:' + callId,
		callId,
		name,
		argsRaw: str(call.argsRaw) || str(root.argsRaw),
		content: textOfContent(root.content),
		settled: root.kind === 'tool-result',
		isError,
		error,
		category: categoryOfTool(name),
		subCalls,
	};
}

export function toolFromBlock(block: Record<string, unknown>, nodeKey: string): ToolCallEntry {
	const name = str(block.name) || '工具';
	const callId = str(block.callId) || nodeKey;
	return {
		type: 'tool',
		key: 'tool:' + callId,
		callId,
		name,
		argsRaw: str(block.argsRaw),
		content: '',
		settled: false,
		isError: false,
		error: null,
		category: categoryOfTool(name),
		subCalls: [],
	};
}

/** assistant-step 的 blocks；声明的 blocks 为空时退回 finalNode.blocks。 */
export function blocksOf(node: NativeChatNode): {
	blocks: Record<string, unknown>[];
	declared: Record<string, unknown>[];
	fallback: Record<string, unknown>[];
} {
	const data = asRecord(node.data);
	const finalNode = asRecord(data.finalNode);
	const declared = Array.isArray(data.blocks) ? data.blocks.map(asRecord) : [];
	const fallback = Array.isArray(finalNode.blocks) ? finalNode.blocks.map(asRecord) : [];
	return { blocks: declared.length > 0 ? declared : fallback, declared, fallback };
}
