import type { NativeChatLive, NativeChatNode } from '../../../shared/native-types';
import {
	asRecord,
	blocksOf,
	blockText,
	type ProcessCategory,
	type ProcessEntry,
	type ToolCallEntry,
	str,
	num,
	toolFromBlock,
	toolFromRoot,
} from './chat-node-data';

/**
 * 时间线折叠模型：把一轮里零散的 assistant-step / tool-call 节点收进“过程行”。
 *
 * DSH Web 的渲染逻辑是：思考与工具调用属于同一段过程，默认只显示一行摘要，
 * 点击才展开细节；收尾时还会把已经物化过的节点标成 hidden（withdrawn）。
 * 这里不依赖 visibility 跳过过程成员，避免收尾后工具结果整段消失。
 *
 * 0036：正文是过程的分界线 —— 同一轮里正文前后的思考 / 工具调用各自成一条过程行；
 * 没有正文分隔的连续步骤仍合成一段（不按 step 逐行拆）。
 */

type ProcessStatus = 'running' | 'settled' | 'aborted' | 'error';

export interface ProcessGroupItem {
	type: 'process';
	key: string;
	turn: number | null;
	status: ProcessStatus;
	entries: ProcessEntry[];
	/** 只保留出现过的工具类别（按出现顺序），用于一行摘要。 */
	counts: ProcessCategory[];
	startTime: number | null;
	endTime: number | null;
}

interface TextItem {
	type: 'text';
	key: string;
	text: string;
	/** 还在流式增长的正文（live 合成节点）：走纯文本快通道，settle 后再 Markdown 排版。 */
	streaming?: boolean;
}

interface NodeItem {
	type: 'node';
	node: NativeChatNode;
}

type TimelineItem = ProcessGroupItem | TextItem | NodeItem;

function addTool(group: ProcessGroupItem, incoming: ToolCallEntry): void {
	const existing = group.entries.find(
		(entry): entry is ToolCallEntry => entry.type === 'tool' && entry.callId === incoming.callId,
	);
	if (existing === undefined) {
		group.entries.push(incoming);
		return;
	}
	existing.name = incoming.name || existing.name;
	existing.argsRaw = incoming.argsRaw || existing.argsRaw;
	existing.content = incoming.content || existing.content;
	existing.settled = existing.settled || incoming.settled;
	existing.isError = existing.isError || incoming.isError;
	existing.error = incoming.error ?? existing.error;
	existing.category = incoming.category;
	if (incoming.subCalls.length > 0) existing.subCalls = incoming.subCalls;
}

function collectCategories(group: ProcessGroupItem): void {
	const seen = new Set<ProcessCategory>();
	const visit = (tool: ToolCallEntry): void => {
		seen.add(tool.category);
		for (const child of tool.subCalls) visit(child);
	};
	for (const entry of group.entries) {
		if (entry.type === 'tool') visit(entry);
	}
	group.counts = [...seen];
}

function processStatusOf(closingStatus: string): ProcessStatus {
	if (closingStatus === 'error') return 'error';
	if (
		closingStatus === 'aborted' ||
		closingStatus === 'interrupted' ||
		closingStatus === 'cancelled'
	) {
		return 'aborted';
	}
	return 'settled';
}

/**
 * 把桥 v3 的 live tail 变成一条运行中的 assistant-step 节点。
 *
 * 不用新渲染分支：合成节点与正式节点同形，直接复用思考 / 正文 / 工具块的折叠逻辑。
 * 同一 turn/step 已有 settled 节点时跳过（settle 与 live 同帧的短暂重叠），
 * live 轮次落后于已加载的最后一轮时也跳过，避免文本落到旧轮次后面。
 */
function withLiveNode(nodes: NativeChatNode[], live: NativeChatLive | null): NativeChatNode[] {
	if (live === null || live.blocks.length === 0) return nodes;
	let settled = false;
	for (const node of nodes) {
		if (node.kind !== 'assistant-step' || node.turn !== live.turn || node.step !== live.step) continue;
		const data = asRecord(node.data);
		if (data.status === 'settled' || (data.finalNode !== null && data.finalNode !== undefined)) {
			settled = true;
		}
	}
	// 正式节点已经收尾：live 让位，避免重复。
	if (settled) return nodes;
	let lastTurn: number | null = null;
	for (const node of nodes) {
		if (node.turn !== null && (lastTurn === null || node.turn > lastTurn)) lastTurn = node.turn;
	}
	if (lastTurn !== null && live.turn < lastTurn) return nodes;
	// 官方 UI 在 rAF 里也可能短暂物化同一 step 的 running 节点（离屏 2~3 帧/秒）；
	// 那时它比 live 旧，保留两份会重复正文。running 期间以 live 为唯一来源。
	const filtered = nodes.filter(
		(node) =>
			!(
				node.kind === 'assistant-step' &&
				node.turn === live.turn &&
				node.step === live.step
			),
	);
	const key = 'live:' + live.turn + ':' + live.step;
	return [
		...filtered,
		{
			key,
			id: key,
			kind: 'assistant-step',
			anchorSeq: Number.MAX_SAFE_INTEGER,
			turn: live.turn,
			step: live.step,
			visibility: 'visible',
			data: {
				status: 'running',
				turn: live.turn,
				step: live.step,
				time: Date.now(),
				blocks: live.blocks,
			},
		},
	];
}

export function buildTimeline(
	nodes: NativeChatNode[],
	sessionRunning: boolean,
	live: NativeChatLive | null = null,
): TimelineItem[] {
	const items: TimelineItem[] = [];
	const source = withLiveNode(nodes, live);
	/** 每轮当前打开的过程段；正文 / turn-tail 会关闭它。 */
	const openGroups = new Map<number, ProcessGroupItem | null>();
	/** 每轮已创建的过程段序号：key 稳定，React 折叠状态不串。 */
	const segmentCounters = new Map<number, number>();
	/** callId → 工具项所在段：后到的 tool-call 结果节点要并回原段，而不是当前段。 */
	const toolGroups = new Map<string, ProcessGroupItem>();
	/** turn 缺失（理论上只有宽松节点）时的匿名段。 */
	let anonymous: ProcessGroupItem | null = null;
	let anonymousCount = 0;

	const createGroup = (turn: number | null): ProcessGroupItem => {
		const segment = turn === null ? 0 : (segmentCounters.get(turn) ?? 0);
		if (turn !== null) segmentCounters.set(turn, segment + 1);
		const group: ProcessGroupItem = {
			type: 'process',
			key:
				turn === null
					? 'process:anonymous:' + anonymousCount++
					: 'process:turn:' + turn + ':' + segment,
			turn,
			status: 'running',
			entries: [],
			counts: [],
			startTime: null,
			endTime: null,
		};
		items.push(group);
		return group;
	};

	/** 取本轮当前段；没有就新建（只在真的要放过程成员时调用）。 */
	const openGroup = (turn: number | null): ProcessGroupItem => {
		if (turn === null) {
			if (anonymous === null) anonymous = createGroup(null);
			return anonymous;
		}
		const current = openGroups.get(turn) ?? null;
		if (current !== null) return current;
		const group = createGroup(turn);
		openGroups.set(turn, group);
		return group;
	};

	const dropGroup = (group: ProcessGroupItem): void => {
		const index = items.indexOf(group);
		if (index >= 0) items.splice(index, 1);
	};

	/**
	 * 正文出现：结束本轮当前段。空占位段（turn-process 建的「思考中」）直接移除，
	 * 后续过程成员会新建下一段，正文因此落在两段之间。
	 */
	const closeSegment = (turn: number | null): void => {
		const group = turn === null ? anonymous : (openGroups.get(turn) ?? null);
		if (group === null) return;
		if (turn === null) anonymous = null;
		else openGroups.set(turn, null);
		if (group.entries.length === 0) {
			dropGroup(group);
			return;
		}
		group.status = 'settled';
	};

	const toolKey = (turn: number | null, callId: string): string =>
		(turn === null ? 'anonymous' : String(turn)) + ':' + callId;

	/** 写入一个工具项：同一 callId 的块与结果节点合并；结果节点晚到时并回原段。 */
	const addToolEntry = (node: NativeChatNode, tool: ToolCallEntry): ProcessGroupItem => {
		const key = toolKey(node.turn, tool.callId);
		const existing = toolGroups.get(key);
		if (existing !== undefined) {
			addTool(existing, tool);
			return existing;
		}
		const group = openGroup(node.turn);
		addTool(group, tool);
		toolGroups.set(key, group);
		return group;
	};

	for (const node of source) {
		if (node.kind === 'turn-process') {
			// 占位段：回合开始到首个过程成员 / 正文之前显示「思考中」。
			if (node.visibility !== 'hidden') openGroup(node.turn);
			continue;
		}

		if (node.kind === 'assistant-step') {
			const data = asRecord(node.data);
			const streaming = node.key.startsWith('live:');
			const { blocks, declared, fallback } = blocksOf(node);
			let textIndex = 0;
			let textParts: string[] = [];
			/** 本 step 时间记到它触及的每一段（0036：正文落在 step 中间时前后两段各计一次，口径 a）。 */
			const stepGroups = new Set<ProcessGroupItem>();
			const flushText = (): void => {
				if (textParts.length === 0) return;
				const text = textParts.join('\n\n');
				textParts = [];
				if (node.visibility === 'hidden') return;
				closeSegment(node.turn);
				items.push({
					type: 'text',
					key: node.key + ':text:' + textIndex++,
					text,
					streaming,
				});
			};
			for (const [blockIndex, block] of blocks.entries()) {
				if (block.kind === 'text') {
					const text = blockText(block);
					if (text !== '') textParts.push(text);
					continue;
				}
				if (block.kind !== 'reasoning' && block.kind !== 'tool-call') continue;
				flushText();
				if (block.kind === 'reasoning') {
					const group = openGroup(node.turn);
					stepGroups.add(group);
					const text = blockText(block);
					if (text.trim() !== '') {
						group.entries.push({
							type: 'thinking',
							key: node.key + ':thinking:' + blockIndex,
							text,
						});
					}
				} else {
					stepGroups.add(addToolEntry(node, toolFromBlock(block, node.key)));
				}
			}
			flushText();
			if (!declared.some((block) => block.kind === 'text')) {
				const fallbackText = fallback
					.filter((block) => block.kind === 'text' && blockText(block) !== '')
					.map(blockText);
				if (fallbackText.length > 0 && node.visibility !== 'hidden') {
					closeSegment(node.turn);
					items.push({
						type: 'text',
						key: node.key + ':text:fallback',
						text: fallbackText.join('\n\n'),
						streaming,
					});
				}
			}
			const timing = asRecord(data.timing);
			const finalTiming = asRecord(asRecord(data.finalNode).timing);
			const start = num(timing.stepStartTime) ?? num(finalTiming.stepStartTime);
			const end = num(timing.completedTime) ?? num(finalTiming.completedTime) ?? num(data.time);
			for (const group of stepGroups) {
				if (start !== null) {
					group.startTime = group.startTime === null ? start : Math.min(group.startTime, start);
				}
				if (end !== null) {
					group.endTime = group.endTime === null ? end : Math.max(group.endTime, end);
				}
			}
			continue;
		}

		if (node.kind === 'tool-call') {
			// 收尾时 DSH 可能把已物化的 tool-call 标成 hidden；过程组内一律保留。
			const root = asRecord(asRecord(node.data).root);
			addToolEntry(node, toolFromRoot(root, node.key));
			continue;
		}

		if (node.kind === 'turn-tail') {
			const data = asRecord(node.data);
			const closing = asRecord(data.closing);
			const group = node.turn === null ? anonymous : (openGroups.get(node.turn) ?? null);
			if (group !== null) {
				// 停止 / 中断的回合没有 closing（bridge 侧 branchUnavailable），按已停止展示。
				const closed = data.closing !== null && typeof data.closing === 'object';
				group.status = closed ? processStatusOf(str(closing.status)) : 'aborted';
				const timing = asRecord(closing.timing);
				const completed = num(timing.completedTime) ?? num(data.time);
				if (completed !== null) {
					group.endTime =
						group.endTime === null ? completed : Math.max(group.endTime, completed);
				}
				if (node.turn === null) anonymous = null;
				else openGroups.set(node.turn, null);
			}
			// 正文已经把最后一段关掉时没有打开段，本轮同样结束。
			continue;
		}

		items.push({ type: 'node', node });
		if (node.kind === 'user' || node.kind === 'steering') anonymous = null;
	}

	let lastTurn = -Infinity;
	for (const turn of segmentCounters.keys()) lastTurn = Math.max(lastTurn, turn);
	for (const item of items) {
		if (item.type !== 'process') continue;
		if (item.status === 'running') {
			const stale = item.turn !== null && item.turn < lastTurn;
			if (!sessionRunning || stale) item.status = 'settled';
		}
		collectCategories(item);
	}

	return items.filter(
		(item) => item.type !== 'process' || item.entries.length > 0 || item.status === 'running',
	);
}
