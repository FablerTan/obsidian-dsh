import type { App } from 'obsidian';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { NativeChatLive, NativeChatSnapshot } from '../../../shared/native-types';
import { Icon } from './icon';
import { buildTimeline } from './timeline-model';
import { AssistantText, NodeView } from './timeline-nodes';
import { ProcessGroupView } from './timeline-process';

/** 时间线外壳：滚动位置 / 回到底部 / 加载更早；节点折叠在 timeline-model.ts。 */
export function Timeline({
	app,
	snapshot,
	live,
	liveTick,
	sourcePath,
	loadingOlder,
	onLoadOlder,
	runningStatus,
}: {
	app: App;
	snapshot: NativeChatSnapshot;
	/** 桥 v3 的流式 tail；旧桥为 null。 */
	live: NativeChatLive | null;
	/** live 每次更新 +1，用于触发自动吸底（不依赖结构 revision）。 */
	liveTick: number;
	sourcePath: string;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	/** 0048：运行提示放在消息流最下方时由根组件传入（随内容滚动）。 */
	runningStatus?: ReactNode;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [atBottom, setAtBottom] = useState(true);
	const hasMore = snapshot.session.hasMore === true;
	const running = snapshot.session.running === true;
	const items = useMemo(
		() => buildTimeline(snapshot.nodes, running, live),
		[snapshot.nodes, running, live],
	);

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
	}, [atBottom, snapshot.revision, liveTick]);

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
				{items.map((item) => {
					const key = snapshot.sessionId + ':' + (item.type === 'node' ? item.node.key : item.key);
					if (item.type === 'process') {
						return <ProcessGroupView key={key} group={item} />;
					}
					if (item.type === 'text') {
						return (
							<AssistantText
								key={key}
								app={app}
								text={item.text}
								streaming={item.streaming === true}
								sourcePath={sourcePath}
							/>
						);
					}
					return (
						<NodeView key={key} app={app} node={item.node} sourcePath={sourcePath} />
					);
				})}
				{runningStatus}
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
