import { quoteExcerpt, quoteLineLabel, type SelectionQuote } from '../quote';
import { Icon } from './icon';

/**
 * 输入框上方的引用预览条（0058）：发送前告诉用户这次会带哪段文字。
 * 点击主区域与点消息里的引用卡一致（跳回笔记并选中高亮，0060）；× 只取消本次引用。
 */
export function QuotePreview({
	quote,
	limit,
	onOpen,
	onClear,
}: {
	quote: SelectionQuote;
	/** 设置页的摘录上限（0058）。 */
	limit: number;
	/** 跳回笔记并选中原选区（与引用卡同一行为）。 */
	onOpen: () => void;
	onClear: () => void;
}) {
	const excerpt = quoteExcerpt(quote, limit);
	const preview = excerpt.text.replace(/\s+/gu, ' ').trim();
	return (
		<div className="dsh-native-quote-preview">
			<button
				type="button"
				className="dsh-native-quote-preview-main"
				title={'跳转到 ' + quote.path + ' · ' + quoteLineLabel(quote)}
				aria-label={'跳转到 ' + quote.name + ' · ' + quoteLineLabel(quote)}
				onClick={onOpen}
			>
				<span className="dsh-native-quote-preview-icon">
					<Icon name="quote" size={13} />
				</span>
				<span className="dsh-native-quote-preview-label">
					引用 {quote.name} · {quoteLineLabel(quote)}
				</span>
				<span className="dsh-native-quote-preview-text" title={quote.text}>
					{preview === '' ? '（空）' : preview}
				</span>
			</button>
			<button
				className="dsh-native-quote-preview-close"
				type="button"
				title="这次不引用这段文字"
				aria-label="这次不引用这段文字"
				onClick={onClear}
			>
				<Icon name="x" size={12} />
			</button>
		</div>
	);
}
