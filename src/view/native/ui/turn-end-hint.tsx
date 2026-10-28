import { Icon } from './icon';

/** 静默结束提示条：一句话说明 + 重试按钮（重试 = 发送「继续」让模型接着完成本轮）。 */
export function TurnEndHint({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
	return (
		<div className="dsh-native-turn-end-hint" role="status">
			<Icon name="alert-circle" size={12} />
			<span>本轮模型只返回了思考，没有正文或工具调用。</span>
			<button
				type="button"
				className="dsh-native-turn-end-retry"
				title="重试本轮：发送「继续」，让模型接着完成"
				disabled={busy}
				onClick={onRetry}
			>
				重试
			</button>
		</div>
	);
}
