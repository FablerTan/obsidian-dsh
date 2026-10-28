import type { App } from 'obsidian';
import { jumpToQuote } from '../editor-selection';
import { quoteLineLabel, type SelectionQuote } from '../quote';
import { Icon } from './icon';

/**
 * 微信式引用卡（0058）：用户消息里的选区引用不参与 Markdown 渲染，
 * 整卡可点击 / 可键盘激活；点击回到原笔记并选中高亮。
 */
export function QuoteCard({
	app,
	quote,
	truncatedTotal,
}: {
	app: App;
	quote: SelectionQuote;
	/** 摘录被截断时的原始字数（来自 parseQuote）；未截断不传。 */
	truncatedTotal?: number;
}) {
	const open = (): void => {
		void jumpToQuote(app, quote);
	};
	const title =
		quote.path +
		' · ' +
		quoteLineLabel(quote) +
		(truncatedTotal === undefined ? '' : '（摘录已截断，共 ' + truncatedTotal + ' 字）');
	return (
		<div
			className="dsh-native-quote-card"
			role="button"
			tabIndex={0}
			title={title}
			onClick={(event) => {
				event.stopPropagation();
				open();
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				event.stopPropagation();
				open();
			}}
		>
			<div className="dsh-native-quote-card-head">
				<Icon name="quote" size={13} />
				<span className="dsh-native-quote-card-name">{quote.name}</span>
				<span className="dsh-native-quote-card-range">{quoteLineLabel(quote)}</span>
			</div>
			<div className="dsh-native-quote-card-excerpt">{quote.text}</div>
		</div>
	);
}
