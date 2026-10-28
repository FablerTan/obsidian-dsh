import type { NativeChatNode, NativeChatSnapshot } from '../../../shared/native-types';
import { asRecord, blocksOf, str } from './chat-node-data';

/**
 * 0046：识别「本轮已结束，但最后一条 assistant 消息只有思考」的静默结束。
 *
 * dsh 侧的模型适配器只在「零内容块」时才把一个 stop 判成可重试的 EMPTY_RESPONSE；
 * 只带 reasoning 的响应会被当成正常完成，轮次就停在没有正文/工具调用的地方。
 * 这里不改 dsh，只在原生面板做兜底：命中时给一行提示 + 重试按钮。
 */

export interface SilentTurnEnd {
	turn: number;
}

/** 该轮是否已正常收尾（中止 / 中断的轮次没有 closing，错误轮次另有错误条）。 */
function settledClosing(tail: NativeChatNode): boolean {
	const closing = asRecord(asRecord(tail.data).closing);
	if (Object.keys(closing).length === 0) return false;
	const status = str(closing.status);
	return status === '' || status === 'settled' || status === 'completed';
}

/** 最后一条 assistant 消息里有没有“看得见”的产出（正文或工具调用）。 */
function hasVisibleOutput(step: NativeChatNode): boolean {
	const { blocks } = blocksOf(step);
	return blocks.some((block) => {
		if (block.kind === 'tool-call') return true;
		return block.kind === 'text' && str(block.text).trim() !== '';
	});
}

/**
 * 判断当前快照是否处于“静默结束”：最新一轮已结束、有正常 closing、没有待处理交互，
 * 且该轮最后一个 assistant-step 只有思考、没有正文/工具调用。
 */
export function detectSilentTurnEnd(snapshot: NativeChatSnapshot): SilentTurnEnd | null {
	if (asRecord(snapshot.session).running === true) return null;
	if (snapshot.pending !== null && snapshot.pending !== undefined) return null;
	const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
	if (nodes.length === 0) return null;

	let turn: number | null = null;
	for (const node of nodes) {
		if (node.turn === null) continue;
		if (turn === null || node.turn > turn) turn = node.turn;
	}
	if (turn === null) return null;

	const turnNodes = nodes.filter((node) => node.turn === turn);
	const tail = turnNodes.find((node) => node.kind === 'turn-tail');
	if (tail === undefined || !settledClosing(tail)) return null;

	let lastStep: NativeChatNode | null = null;
	for (const node of turnNodes) {
		if (node.kind !== 'assistant-step') continue;
		if (lastStep === null || (node.step ?? -1) >= (lastStep.step ?? -1)) lastStep = node;
	}
	if (lastStep === null || hasVisibleOutput(lastStep)) return null;

	return { turn };
}
