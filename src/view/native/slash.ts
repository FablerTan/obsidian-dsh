/**
 * 输入框 `/` 命令菜单的纯逻辑（不 import obsidian）：
 * token 检测、命令表、过滤排序、菜单行模型。
 *
 * 规则对齐 dsh 的斜杠菜单（0.2.x）：
 * - `/` 只在**行首**（行首空白之后也算）生效：宿主命令必须独占一行的开头，
 *   所以 `路径/1`、`http://` 这类词内斜杠不会触发菜单；
 * - 查询只允许非空白字符，键入空格后菜单收起（进入参数区）；
 * - 命令与技能在**同一个列表**里按「命令 → 技能」分组显示（不设二级菜单）；
 * - 名字匹配沿用 @ 菜单的打分习惯：完全一致 > 前缀 > 包含 > 子序列。
 */

import type { NativeSkill } from '../../shared/native-types';

/** 光标处正在输入的 `/` token。 */
export interface SlashToken {
	/** `/` 的起始偏移（执行时替换 [start, end)）。 */
	start: number;
	/** 光标偏移。 */
	end: number;
	/** `/` 之后的查询文本。 */
	query: string;
}

/** 菜单里的命令行（技能行由 slashSkillItems 生成）。 */
export interface SlashCommandSpec {
	name: 'new' | 'compact';
	/** 中文标签（与命令名并排显示）。 */
	label: string;
	description: string;
	icon: string;
	/** 是否依赖桥 v5 的命令目录。 */
	needsBridge: boolean;
}

export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
	{
		name: 'new',
		label: '新建对话',
		description: '新建一个会话并切换过去',
		icon: 'plus',
		needsBridge: false,
	},
	{
		name: 'compact',
		label: '压缩',
		description: '压缩当前会话的历史，释放上下文',
		icon: 'archive',
		needsBridge: true,
	},
];

/** 技能的菜单分组标题。 */
export const SKILL_SECTION = '技能';

/** 菜单的一行：命令或技能。 */
export interface SlashItem {
	key: string;
	kind: 'command' | 'skill';
	/** 显示的命令名 / 技能名（不带 `/`）。 */
	name: string;
	/** 命令行的中文标签；技能行为空。 */
	label: string;
	description: string;
	icon: string;
	/** 桥太旧 / 宿主没有该能力时的禁用态。 */
	disabled: boolean;
	/** 分组标题：命令行为空（不显示标题），技能行为「技能」。 */
	section: string;
}

/** 一次最多展示的行数（技能多的 profile 也不至于铺满屏幕）。 */
const SLASH_LIMIT = 40;

const BRIDGE_OUTDATED = '需要更新 dsh-obsidian-bridge 并重启 DSH 服务';

/** 取光标前当前行的 `/` token；不在命令 token 里返回 null。 */
export function activeSlashToken(draft: string, caret: number): SlashToken | null {
	const position = Math.max(0, Math.min(caret, draft.length));
	const lineStart = position === 0 ? 0 : draft.lastIndexOf('\n', position - 1) + 1;
	const line = draft.slice(lineStart, position);
	const match = /^(\s*)\/(\S*)$/u.exec(line);
	if (match === null) return null;
	const prefix = match[1] ?? '';
	const query = match[2] ?? '';
	// 查询里出现 `/` 说明用户在写路径，不是命令名。
	if (query.includes('/')) return null;
	return { start: lineStart + prefix.length, end: position, query };
}

/** 命令分组：new / compact，按查询过滤。 */
export function slashCommandItems(query: string, commandsAvailable: boolean): SlashItem[] {
	return rank(SLASH_COMMANDS, (command) => command.name, query).map((command) => {
		const disabled = command.needsBridge && !commandsAvailable;
		return {
			key: 'command:' + command.name,
			kind: 'command' as const,
			name: command.name,
			label: command.label,
			description: disabled ? BRIDGE_OUTDATED : command.description,
			icon: command.icon,
			disabled,
			section: '',
		};
	});
}

/** 技能分组：当前会话的人类可调用技能，紧跟命令之后同一个列表。 */
export function slashSkillItems(skills: readonly NativeSkill[], query: string): SlashItem[] {
	return rank(skills, (skill) => skill.name, query).map((skill) => ({
		key: 'skill:' + skill.name,
		kind: 'skill' as const,
		name: skill.name,
		label: '',
		description: skill.modelInvocable ? skill.description : '仅用户 · ' + skill.description,
		icon: 'sparkles',
		disabled: false,
		section: SKILL_SECTION,
	}));
}

/** 选中技能后写进草稿的文本：`/name `（尾空格，和 dsh 一致；宿主据此注入技能正文）。 */
export function formatSkillReference(name: string): string {
	return '/' + name + ' ';
}

/** 名字过滤 + 排序；空查询保持原始顺序。 */
function rank<T>(items: readonly T[], nameOf: (item: T) => string, query: string): T[] {
	if (query === '') return items.slice(0, SLASH_LIMIT);
	const needle = query.toLowerCase();
	const scored: Array<{ item: T; score: number; order: number }> = [];
	items.forEach((item, order) => {
		const score = matchScore(nameOf(item).toLowerCase(), needle);
		if (score !== undefined) scored.push({ item, score, order });
	});
	scored.sort((left, right) => right.score - left.score || left.order - right.order);
	return scored.slice(0, SLASH_LIMIT).map((entry) => entry.item);
}

function matchScore(name: string, needle: string): number | undefined {
	if (name === needle) return 1000;
	if (name.startsWith(needle)) return 900;
	if (name.includes(needle)) return 700;
	const subsequence = subsequenceScore(name, needle);
	return subsequence === undefined ? undefined : 300 + subsequence;
}

function subsequenceScore(name: string, needle: string): number | undefined {
	let index = 0;
	let gap = 0;
	for (const character of needle) {
		const found = name.indexOf(character, index);
		if (found < 0) return undefined;
		gap += found - index;
		index = found + 1;
	}
	return Math.max(0, 100 - gap);
}
