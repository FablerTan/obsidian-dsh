import { useState } from 'react';
import type { ProcessEntry, ThinkingEntry } from './chat-node-data';
import { Icon } from './icon';
import type { ProcessGroupItem } from './timeline-model';
import { oneLine, ToolRow, toolActivity, toolIcon, toolPast, toolSummary } from './tool-row';

/**
 * 一轮的过程行：默认只有一行（思考 / 工具调用的实时摘要），点击展开完整过程。
 * 收尾后工具调用仍然保留在展开层里，不随 turn-tail 消失。
 */

function firstLine(text: string): string {
	const line = text
		.split('\n')
		.map((part) => part.trim())
		.find((part) => part !== '');
	return oneLine(line ?? '', 90);
}

function pastSummary(group: ProcessGroupItem): string {
	const labels = group.counts.slice(0, 3).map(toolPast);
	if (labels.length === 0) return '';
	const text = labels.join('，');
	return group.counts.length > 3 ? text + '等' : text;
}

function durationText(group: ProcessGroupItem): string {
	if (group.startTime === null || group.endTime === null) return '';
	const seconds = Math.round((group.endTime - group.startTime) / 1000);
	return seconds >= 1 ? seconds + ' 秒' : '';
}

function liveLine(group: ProcessGroupItem): { icon: string; label: string; detail: string } {
	const last = group.entries[group.entries.length - 1];
	if (last === undefined) return { icon: 'brain', label: '思考中', detail: '' };
	if (last.type === 'tool' && !last.settled) {
		return {
			icon: toolIcon(last.category),
			label: toolActivity(last.category),
			detail: toolSummary(last),
		};
	}
	if (last.type === 'thinking') {
		return { icon: 'brain', label: '思考', detail: firstLine(last.text) };
	}
	const thinking = [...group.entries]
		.reverse()
		.find((entry): entry is ThinkingEntry => entry.type === 'thinking');
	return {
		icon: 'brain',
		label: '思考中',
		detail: thinking === undefined ? '' : firstLine(thinking.text),
	};
}

function settledLine(group: ProcessGroupItem): { icon: string; label: string; detail: string } {
	if (group.status === 'aborted') {
		return { icon: 'square', label: '已停止', detail: pastSummary(group) };
	}
	if (group.status === 'error') {
		return { icon: 'alert-triangle', label: '执行出错', detail: pastSummary(group) };
	}
	if (group.counts.length === 0) {
		const hasThinking = group.entries.some((entry) => entry.type === 'thinking');
		return { icon: 'brain', label: hasThinking ? '已思考' : '已完成', detail: '' };
	}
	return { icon: toolIcon(group.counts[0] ?? 'tools'), label: pastSummary(group), detail: '' };
}

function ThinkingRow({ entry }: { entry: ThinkingEntry }) {
	const [open, setOpen] = useState(false);
	const preview = firstLine(entry.text);
	return (
		<div className="dsh-native-think">
			<button className="dsh-native-think-head" onClick={() => setOpen((value) => !value)}>
				<Icon name="brain" size={13} />
				<span className="dsh-native-think-label">思考</span>
				{open ? null : <span className="dsh-native-think-preview">{preview}</span>}
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
			</button>
			{open ? <div className="dsh-native-think-body">{entry.text}</div> : null}
		</div>
	);
}

export function ProcessGroupView({ group }: { group: ProcessGroupItem }) {
	const [open, setOpen] = useState(false);
	const running = group.status === 'running';
	const line = running ? liveLine(group) : settledLine(group);
	const duration = running ? '' : durationText(group);
	return (
		<div
			className={
				'dsh-native-process' +
				(running ? ' is-running' : '') +
				(group.status === 'error' ? ' is-error' : '')
			}
			data-turn={group.turn ?? undefined}
		>
			<button
				className="dsh-native-process-head"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Icon name={line.icon} size={14} />
				<span className="dsh-native-process-label">{line.label}</span>
				{line.detail === '' ? (
					<span className="dsh-native-process-detail" />
				) : (
					<span className="dsh-native-process-detail" title={line.detail}>
						{line.detail}
					</span>
				)}
				{running ? <span className="dsh-native-process-pulse" aria-hidden="true" /> : null}
				{duration === '' ? null : (
					<span className="dsh-native-process-meta">用时 {duration}</span>
				)}
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
			</button>
			{open ? (
				<div className="dsh-native-process-body">
					{group.entries.map((entry: ProcessEntry) =>
						entry.type === 'thinking' ? (
							<ThinkingRow key={entry.key} entry={entry} />
						) : (
							<ToolRow key={entry.key} tool={entry} />
						),
					)}
				</div>
			) : null}
		</div>
	);
}
