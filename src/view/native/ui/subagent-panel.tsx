import type { NativeSubagentEntry, NativeSubagentList } from '../../../shared/native-types';
import { Icon } from './icon';
import { MenuShell } from './menu-shell';

/**
 * 只读子智能体浮层（0041 / 路径 C）：当前会话（或当前子会话的父会话）的 subagentCatalog。
 *
 * 与 dsh Web 的「子智能体计数」入口对齐：模式（可继续 / 一次性 / 未知）、运行 / 空闲、
 * 等待授权、完成未读、耗时、token 与模型；行可点开对应子会话。团队队友在目录里也会出现，
 * 用「团队」徽标标出，避免与团队面板看起来重复。深层嵌套（子代理的子代理）留给后续。
 */

const MODE_TEXT: Record<NativeSubagentEntry['mode'], string> = {
	continuable: '可继续',
	'one-shot': '一次性',
	unknown: '未知',
};

function durationText(ms: number): string {
	if (ms < 1000) return ms + 'ms';
	const seconds = ms / 1000;
	if (seconds < 60) return seconds < 10 ? seconds.toFixed(1) + 's' : Math.round(seconds) + 's';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return minutes + ' 分钟';
	return Math.round(minutes / 60) + ' 小时';
}

function tokensText(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1000 * 1000) return (tokens / 1000).toFixed(1) + 'k';
	return (tokens / (1000 * 1000)).toFixed(1) + 'm';
}

function statusText(entry: NativeSubagentEntry): string {
	if (entry.running) return '运行中';
	if (entry.unread) return '已完成（未读）';
	return '空闲';
}

function statusDotClass(entry: NativeSubagentEntry): string {
	if (entry.running) return 'is-running';
	if (entry.pendingInteraction) return 'is-pending';
	return 'is-idle';
}

function metaText(entry: NativeSubagentEntry): string {
	const parts: string[] = [statusText(entry)];
	if (entry.model !== null && entry.model !== '') parts.push('模型：' + entry.model);
	if (entry.totalTokens !== null) parts.push('token：' + tokensText(entry.totalTokens));
	if (entry.running && entry.activeSince !== null) {
		parts.push('已运行 ' + durationText(Math.max(0, Date.now() - entry.activeSince)));
	} else if (!entry.running && entry.settledMs !== null) {
		parts.push('耗时 ' + durationText(entry.settledMs));
	}
	return parts.join(' · ');
}

export function SubagentPanel({
	list,
	teammateIds,
	anchor,
	onOpen,
	onClose,
}: {
	list: NativeSubagentList;
	/** 团队队友的会话 id：目录里这些行加「团队」徽标。 */
	teammateIds: ReadonlySet<string>;
	anchor: DOMRect;
	onOpen: (entry: NativeSubagentEntry) => void;
	onClose: () => void;
}) {
	const running = list.entries.filter((entry) => entry.running).length;
	return (
		<MenuShell
			anchor={{ rect: anchor, side: 'below' }}
			className="dsh-native-subagent-panel"
			grow
			onClose={onClose}
		>
			<div className="dsh-native-subagent" role="dialog" aria-label="子智能体">
				<div className="dsh-native-subagent-header">
					<Icon name="bot" size={14} />
					<span className="dsh-native-subagent-headline">子智能体</span>
					<span className="dsh-native-subagent-counts">
						{list.entries.length} 个
						{running > 0 ? ' · ' + running + ' 个运行中' : ''}
					</span>
				</div>
				{list.entries.length === 0 ? (
					<div className="dsh-native-subagent-empty">
						当前会话还没有子智能体；模型使用 subagent / subagent_fork 委派后会出现。
					</div>
				) : (
					<div className="dsh-native-subagent-list">
						{list.entries.map((entry) => {
							const teammate = teammateIds.has(entry.id);
							return (
								<button
									key={entry.id}
									className={
										'dsh-native-subagent-row' +
										(entry.current ? ' is-current' : '') +
										(entry.pendingInteraction ? ' has-pending' : probeUnread(entry))
									}
									title={entry.title ?? entry.label}
									onClick={() => onOpen(entry)}
								>
									<span
										className={'dsh-native-subagent-dot ' + statusDotClass(entry)}
										aria-hidden="true"
									/>
									<span className="dsh-native-subagent-row-text">
										<span className="dsh-native-subagent-row-head">
											<span className="dsh-native-subagent-label">{entry.label}</span>
											{entry.current ? (
												<span className="dsh-native-subagent-badge is-current">当前</span>
											) : null}
											{teammate ? (
												<span className="dsh-native-subagent-badge is-team">团队</span>
											) : null}
											{entry.pendingInteraction ? (
												<span
													className="dsh-native-subagent-badge is-pending"
													title="该子智能体正在等待授权或回答问题；打开它的会话即可处理。"
												>
													等待授权
												</span>
											) : null}
											{entry.unread ? (
												<span className="dsh-native-subagent-badge is-unread">未读</span>
											) : null}
										</span>
										<span className="dsh-native-subagent-row-meta">
											<span className="dsh-native-subagent-mode">{MODE_TEXT[entry.mode]}</span>
											{metaText(entry)}
										</span>
									</span>
									<Icon name="chevron-right" size={12} />
								</button>
							);
						})}
					</div>
				)}
			</div>
		</MenuShell>
	);
}

function probeUnread(entry: NativeSubagentEntry): string {
	return entry.unread ? ' has-unread' : '';
}
