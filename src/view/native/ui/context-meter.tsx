import type {
	NativeContextBreakdown,
	NativeContextUsage,
} from '../../../shared/native-types';
import { MenuShell } from './menu-shell';

/**
 * 输入栏的上下文占用指示：圆环本身不显示数字，点击后在圆环上方展开只读详情。
 *
 * 数据来自桥 v4 的 `context()`（会话投影 `contextPressure` / `contextBreakdown`）；
 * 没有分子或窗口时画灰色空环，而不是用 0% 冒充数据。
 */

interface ContextOccupancy {
	percent: number;
	usedTokens: number;
	contextWindow: number;
}

/** 官方口径：优先下一次请求的估算压力，没有时退回最近一次请求压力。 */
function contextOccupancy(context: NativeContextUsage | null): ContextOccupancy | null {
	const pressure = context?.pressure;
	if (pressure === null || pressure === undefined) return null;
	const used = pressure.projectedTokens ?? pressure.pressureTokens;
	const window = pressure.contextWindow;
	if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return null;
	if (typeof window !== 'number' || !Number.isFinite(window) || window <= 0) return null;
	return {
		percent: Math.min(100, Math.round((used / window) * 100)),
		usedTokens: used,
		contextWindow: window,
	};
}

/** 紧凑 token 数：1234 → 1.2K，1_234_567 → 1.2M。 */
function formatTokenCount(value: number): string {
	const scaled = (candidate: number): string =>
		candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
	if (value < 1_000) return String(Math.round(value));
	if (value < 1_000_000) return scaled(value / 1_000) + 'K';
	return scaled(value / 1_000_000) + 'M';
}

function validBreakdown(
	breakdown: NativeContextBreakdown | null | undefined,
): NativeContextBreakdown | null {
	if (breakdown === null || breakdown === undefined) return null;
	const values = [breakdown.systemTokens, breakdown.toolsTokens, breakdown.messageTokens];
	if (!values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
		return null;
	}
	return breakdown;
}

const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ContextRing({
	context,
	expanded,
	onClick,
}: {
	context: NativeContextUsage | null;
	expanded: boolean;
	onClick: (anchor: DOMRect) => void;
}) {
	const occupancy = contextOccupancy(context);
	const title =
		occupancy === null ? '还没有上下文占用数据' : '上下文已用 ' + String(occupancy.percent) + '%';
	return (
		<button
			className={'dsh-native-context' + (occupancy === null ? ' is-empty' : '')}
			title={title}
			aria-label={title + '，点击查看详情'}
			aria-haspopup="dialog"
			aria-expanded={expanded}
			onClick={(event) => onClick(event.currentTarget.getBoundingClientRect())}
		>
			<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
				<circle className="dsh-native-context-track" cx="7" cy="7" r={RING_RADIUS} />
				{occupancy !== null && occupancy.percent > 0 ? (
					<circle
						className="dsh-native-context-fill"
						cx="7"
						cy="7"
						r={RING_RADIUS}
						strokeDasharray={
							String((RING_CIRCUMFERENCE * occupancy.percent) / 100) +
							' ' +
							String(RING_CIRCUMFERENCE)
						}
						transform="rotate(-90 7 7)"
					/>
				) : null}
			</svg>
		</button>
	);
}

const ROWS = [
	{ key: 'systemTokens', label: '系统提示', className: 'is-system' },
	{ key: 'toolsTokens', label: '工具', className: 'is-tools' },
	{ key: 'messageTokens', label: '消息', className: 'is-messages' },
] as const;

export function ContextDetails({
	context,
	anchor,
	onClose,
}: {
	context: NativeContextUsage | null;
	anchor: DOMRect;
	onClose: () => void;
}) {
	const occupancy = contextOccupancy(context);
	const breakdown = validBreakdown(context?.breakdown);
	const breakdownTotal =
		breakdown === null
			? 0
			: breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
	const parts =
		occupancy === null
			? []
			: breakdown === null || breakdownTotal === 0
				? [{ className: 'is-total', width: occupancy.percent }]
				: ROWS.map((row) => ({
						className: row.className,
						width: (occupancy.percent * breakdown[row.key]) / breakdownTotal,
					}));
	const segments = parts.filter((part) => part.width > 0);

	return (
		<MenuShell
			anchor={{ rect: anchor, side: 'above' }}
			className="dsh-native-context-panel"
			onClose={onClose}
		>
			{occupancy === null ? (
				<>
					<div className="dsh-native-context-header">
						<span className="dsh-native-context-headline">上下文占用</span>
					</div>
					<div className="dsh-native-context-empty">
						还没有上下文占用数据；发送一条消息并收到回复后显示。
					</div>
				</>
			) : (
				<>
					<div className="dsh-native-context-header">
						<span className="dsh-native-context-headline">上下文已用</span>
						<span className="dsh-native-context-percent">{occupancy.percent}%</span>
						<span className="dsh-native-context-figures">
							{'~' +
								formatTokenCount(occupancy.usedTokens) +
								' / ' +
								formatTokenCount(occupancy.contextWindow)}
						</span>
					</div>
					<div className="dsh-native-context-bar" aria-hidden="true">
						{segments.map((segment) => (
							<div
								key={segment.className}
								className={'dsh-native-context-segment ' + segment.className}
								style={{ width: String(segment.width) + '%' }}
							/>
						))}
					</div>
					{breakdown !== null ? (
						<dl className="dsh-native-context-rows">
							{ROWS.map((row) => (
								<div key={row.key} className="dsh-native-context-row">
									<dt>
										<span
											className={'dsh-native-context-swatch ' + row.className}
											aria-hidden="true"
										/>
										{row.label}
									</dt>
									<dd>{'~' + formatTokenCount(breakdown[row.key])}</dd>
								</div>
							))}
						</dl>
					) : null}
					<div className="dsh-native-context-note">
						下一次请求的估算占用；「~」表示含启发式修正。
					</div>
				</>
			)}
		</MenuShell>
	);
}
