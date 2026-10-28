/**
 * 输入框 `/` 命令菜单的纯逻辑（不 import obsidian）：
 * token 检测、命令表、过滤排序、菜单行模型。
 *
 * 规则对齐 dsh 的斜杠菜单（0.2.x）：
 * - `/` 只在**行首**（行首空白之后也算）生效：宿主命令必须独占一行的开头，
 *   所以 `路径/1`、`http://` 这类词内斜杠不会触发菜单；
 * - 查询只允许非空白字符，键入空格后菜单收起（进入参数区）；
 * - 本地命令（/new）、dsh 命令、技能在**同一个列表**里按「本地 → 命令 → 技能」分组显示（不设二级菜单）；
 * - 名字匹配沿用 @ 菜单的打分习惯：完全一致 > 前缀 > 包含 > 子序列。
 *
 * 0050 起命令组不再写死：`slashCommandItems` 接收当前会话的 dsh 命令目录
 * （桥 `commands()`），本地只保留 `/new`（dsh 目录里没有新建会话）。
 */

import type { NativeCommand, NativeSkill } from '../../shared/native-types';

/** 光标处正在输入的 `/` token。 */
export interface SlashToken {
	/** `/` 的起始偏移（执行时替换 [start, end)）。 */
	start: number;
	/** 光标偏移。 */
	end: number;
	/** `/` 之后的查询文本。 */
	query: string;
}

/** 插件本地的命令（dsh 命令目录里没有的宿主动作）。 */
export interface SlashCommandSpec {
	name: 'new';
	/** 中文标签（与命令名并排显示）。 */
	label: string;
	description: string;
	icon: string;
}

export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
	{
		name: 'new',
		label: '新建对话',
		description: '新建一个会话并切换过去',
		icon: 'plus',
	},
];

/** 技能的菜单分组标题。 */
export const SKILL_SECTION = '技能';

/** 菜单的一行：本地命令、dsh 命令或技能。 */
export interface SlashItem {
	key: string;
	kind: 'local' | 'command' | 'skill';
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

/** 六个 first-party 命令的中文标签与说明；未知 / 第三方命令回退 dsh 的英文 description。 */
const COMMAND_COPY: Record<string, { label: string; description: string }> = {
	compact: { label: '压缩', description: '压缩当前会话的历史，释放上下文' },
	export: { label: '导出', description: '导出会话日志（原生面板暂不支持）' },
	feedback: { label: '反馈', description: '记录对本会话的反馈' },
	goal: { label: '目标', description: '查看或设置长期任务的目标' },
	permission: { label: '权限', description: '切换权限预设' },
	plan: { label: '计划', description: '切换计划模式' },
};

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

/** 本地命令 + dsh 命令（同一个命令分组，本地 /new 始终在最前）。 */
export function slashCommandItems(
	commands: readonly NativeCommand[],
	query: string,
): SlashItem[] {
	const local = rank(SLASH_COMMANDS, (command) => command.name, query).map((command) => ({
		key: 'local:' + command.name,
		kind: 'local' as const,
		name: command.name,
		label: command.label,
		description: command.description,
		icon: command.icon,
		disabled: false,
		section: '',
	}));
	const host = rank(commands, (command) => command.name, query).map((command) => {
		const copy = COMMAND_COPY[command.name];
		return {
			key: 'command:' + command.name,
			kind: 'command' as const,
			name: command.name,
			label: copy?.label ?? '',
			description: copy?.description ?? command.description,
			icon: 'terminal',
			disabled: false,
			section: '',
		};
	});
	return [...local, ...host];
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

/** 选中 dsh 命令后写进草稿的文本：`/name `（尾空格，继续补参数；发送时走 executeCommand）。 */
export function formatCommandReference(name: string): string {
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
