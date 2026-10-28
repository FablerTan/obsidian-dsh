import { useEffect, useState } from 'react';

/**
 * 输入框上方的运行提示（0047）：dsh 同款的一行「鲸鱼尾 + 深度求索中，用时 N秒 ···」。
 *
 * 结构与文案对齐 dsh 的 RunningStatus（`dsh-client-ui-chat`）：
 * - 可见文案 = `深度求索中，用时 {duration} ···`，`duration` 用 dsh 的 `formatRunDuration` 口径；
 * - 每秒刷新一次（dsh 的 `LIVE_RUN_CLOCK_INTERVAL_MS = 1000`）；
 * - 屏幕阅读器只播报一次「深度求索中」，不逐秒念时间。
 *
 * 计时起点是「本组件看到 running 变 true」的时刻：面板开着跑的一轮是准的；
 * 中途打开面板会从 0 开始（桥 v7 的快照不带本轮开始时间，取更准的起点要走桥 v8）。
 */

const RUN_CLOCK_INTERVAL_MS = 1000;

/** dsh RunningWhaleTail 的静态 SVG 路径（dsh-client-ui-chat 的 REST_PATH，16×16）。 */
const RUN_WHALE_PATH =
	'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 ' +
	'12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 ' +
	'14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 ' +
	'4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 ' +
	'3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 ' +
	'6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 ' +
	'4.926 13.742';

/**
 * 与 dsh `formatRunDuration` 同口径的时长文案：不足 1 秒按 1 秒算；
 * 秒恒定出现，分 / 小时只在进位时出现，且不加前导零（`1秒` / `1分5秒` / `1小时2分3秒`）。
 */
export function formatRunDuration(elapsedMs: number): string {
	const total = Math.max(1, Math.floor(elapsedMs / RUN_CLOCK_INTERVAL_MS));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	const seconds = total % 60;
	let text = seconds + '秒';
	if (total >= 60) text = minutes + '分' + text;
	if (hours > 0) text = hours + '小时' + text;
	return text;
}

export function RunStatus({
	running,
	startedAt,
	variant = 'composer',
}: {
	running: boolean;
	/** 本轮开始时间；由根组件持有，切换显示位置（组件重挂载）时计时连续。 */
	startedAt: number | null;
	/** 0048：composer = 输入框上方（默认）；flow = 消息流最下方。 */
	variant?: 'composer' | 'flow';
}) {
	const [now, setNow] = useState<number>(() => Date.now());

	useEffect(() => {
		if (!running || startedAt === null) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), RUN_CLOCK_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [running, startedAt]);

	if (!running || startedAt === null) return null;

	const label = '深度求索中，用时 ' + formatRunDuration(Math.max(0, now - startedAt)) + ' ···';

	return (
		<div
			className={
				'dsh-native-run-status' + (variant === 'flow' ? ' is-flow' : '')
			}
			data-dsh-running="true"
		>
			<span className="dsh-native-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				深度求索中
			</span>
			<span className="dsh-native-run-content">
				<span className="dsh-native-run-whale" aria-hidden="true">
					<svg width="100%" height="100%" viewBox="0 0 16 16" fill="none" focusable="false">
						<path d={RUN_WHALE_PATH} stroke="currentColor" strokeWidth={1} />
					</svg>
				</span>
				{/* dsh TextShimmer 结构：正文常显 + 一层同文案的高光副本，由渐变动画蒙版扫过（0049）。 */}
				<span className="dsh-native-run-text">
					<span className="dsh-native-run-text-content">
						<span className="dsh-native-run-text-glyph">{label}</span>
					</span>
					<span className="dsh-native-run-text-decoration" aria-hidden="true">
						<span className="dsh-native-run-text-sweep">
							<span className="dsh-native-run-text-content dsh-native-run-text-highlight">
								<span className="dsh-native-run-text-glyph">{label}</span>
							</span>
						</span>
					</span>
				</span>
			</span>
		</div>
	);
}
