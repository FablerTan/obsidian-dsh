import {
	DEEPSEEK_WHALE_PATH,
	DEEPSEEK_WHALE_VIEWBOX,
} from '../../../shared/brand';
import type {
	NativeModel,
	NativeModelEffort,
	NativeModelGroup,
	NativeModels,
} from '../../../shared/native-types';

/**
 * 模型在聊天栏里的品牌显示。
 *
 * 品牌注册表把「图标 + 标签」与具体厂商解耦：新增厂商时往 `MODEL_BRANDS` 加一条
 * （`match` 命中、`mark` 指定图标、`render` 决定文字）即可，composer 不需要改。
 */

type ModelMark = 'whale' | null;

interface ModelBrand {
	/** 命中后显示的品牌标记；null 表示用通用模型图标。 */
	mark: ModelMark;
	match: (context: { provider: string; providerName: string; model: NativeModel }) => boolean;
	render: (model: NativeModel, effort: NativeModelEffort | null) => string;
}

/** DeepSeek 官方鲸鱼（路径与 viewBox 见 shared/brand.ts）。 */
export function WhaleMark({ height = 14 }: { height?: number }) {
	const width = (height * 56.24) / 41.36;
	return (
		<svg
			className="dsh-native-whale"
			width={width}
			height={height}
			viewBox={DEEPSEEK_WHALE_VIEWBOX}
			aria-hidden="true"
			focusable="false"
		>
			<path d={DEEPSEEK_WHALE_PATH} fill="#4D6BFE" fillRule="nonzero" />
		</svg>
	);
}

const BRANDS: ModelBrand[] = [
	{
		mark: 'whale',
		match: ({ provider, providerName, model }) =>
			/deepseek/i.test([provider, providerName, model.id, model.name].join(' ')),
		// DeepSeek 只显示鲸鱼 + 思考层级；没设层级时只显示鲸鱼。
		render: (_model, effort) => (effort === null ? '' : effort.name),
	},
];

/** 通用品牌：名称 · 层级（无层级时只有名称）。 */
const DEFAULT_BRAND: ModelBrand = {
	mark: null,
	match: () => true,
	render: (model, effort) => (effort === null ? model.name : model.name + ' · ' + effort.name),
};

function resolveModelBrand(context: {
	provider: string;
	providerName: string;
	model: NativeModel;
}): ModelBrand {
	return BRANDS.find((brand) => brand.match(context)) ?? DEFAULT_BRAND;
}

interface ModelChip {
	mark: ModelMark;
	text: string;
	title: string;
}

/** composer 里模型 chip 的显示内容；完整名称放 title，窄栏只显示必要信息。 */
export function modelChip(models: NativeModels | null): ModelChip {
	if (models === null) return { mark: null, text: '模型', title: '模型列表加载中' };
	const current = models.current;
	if (current === null) return { mark: null, text: '未配置模型', title: '未配置模型' };
	const groups = Array.isArray(models.groups) ? models.groups : [];
	const group: NativeModelGroup | undefined = groups.find(
		(entry) => entry.id === current.provider,
	);
	const model = group?.models.find((entry) => entry.id === current.model);
	if (group === undefined || model === undefined) {
		return { mark: null, text: current.model, title: current.model };
	}
	const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : [];
	const effort =
		efforts.find((entry) => entry.id === current.reasoningEffort) ??
		efforts.find((entry) => entry.id === model.reasoning?.defaultEffort) ??
		null;
	const brand = resolveModelBrand({ provider: group.id, providerName: group.name, model });
	return {
		mark: brand.mark,
		text: brand.render(model, effort),
		title: effort === null ? model.name : model.name + ' · ' + effort.name,
	};
}
