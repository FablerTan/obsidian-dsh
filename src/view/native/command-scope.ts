/**
 * `/` 菜单命令行范围与降级过滤（0050，纯函数，不 import obsidian）。
 *
 * 规则与技能范围（0037）同款，但命令名是**扁平命名空间**（dsh 命令名
 * `^[a-z][a-z0-9_-]*$`，没有 `-` 子项层级），所以条目按名字**精确匹配**：
 * - 白名单：只保留命中条目的命令；白名单为空时命令行全部隐藏；
 * - 黑名单：去掉命中条目的命令；黑名单为空时不过滤；
 * - 范围只作用于 `/` 菜单里**显示**的命令行；命令目录读取与 executeCommand 执行不变。
 *
 * 另外两个与 dsh 语义相关的纯函数：
 * - `filterUnsupportedCommands`：`/export` 经桥执行不会真的下载（下载由 dsh Web 客户端的
 *   command/executed 监听触发，桥直连 remote 不会经过它），初版从菜单隐藏；
 * - `hideCommandNamedSkills`：同名时宿主命令优先（dsh 官方裁决），菜单里隐藏同名技能行，
 *   避免「点了技能行、回车却执行命令」。
 */
import type { CommandScope } from '../../settings/schema';
import type { NativeCommand, NativeSkill } from '../../shared/native-types';

/** 原生面板暂不支持的命令（见提案 0050 的风险表：/export 只返回 requested，不落文件）。 */
const NATIVE_UNSUPPORTED_COMMANDS: readonly string[] = ['export'];

/** 命令名是否命中条目（精确匹配，大小写不敏感）。 */
function matchesAny(entries: readonly string[], name: string): boolean {
	const needle = name.toLowerCase();
	return entries.some((entry) => entry === needle);
}

/** 从命令目录里去掉原生面板暂不支持的命令（不受范围影响，白名单也加不回来）。 */
export function filterUnsupportedCommands(commands: readonly NativeCommand[]): NativeCommand[] {
	return commands.filter((command) => !NATIVE_UNSUPPORTED_COMMANDS.includes(command.name));
}

/** 按设置裁剪 `/` 菜单里的命令行；不启用时原样返回。 */
export function filterSlashCommands(
	commands: readonly NativeCommand[],
	scope: CommandScope,
): NativeCommand[] {
	if (scope.mode === 'off') return [...commands];
	if (scope.mode === 'whitelist') {
		// 合并设置时已归一化；这里再兜一次手改 data.json / 旧版本值的情况。
		const allow = normalizeEntries(scope.allow);
		if (allow.length === 0) return [];
		return commands.filter((command) => matchesAny(allow, command.name));
	}
	// 未知模式兜底为「不过滤」，与 mergeSettings 回落 off 的方向一致。
	if (scope.mode !== 'blacklist') return [...commands];
	const deny = normalizeEntries(scope.deny);
	if (deny.length === 0) return [...commands];
	return commands.filter((command) => !matchesAny(deny, command.name));
}

/** 隐藏与命令同名的技能行（命令优先，与 dsh 官方裁决一致）。 */
export function hideCommandNamedSkills(
	skills: readonly NativeSkill[],
	commands: readonly NativeCommand[],
): NativeSkill[] {
	if (commands.length === 0 || skills.length === 0) return [...skills];
	const names = new Set(commands.map((command) => command.name.toLowerCase()));
	return skills.filter((skill) => !names.has(skill.name.toLowerCase()));
}

/** 草稿开头是否是一条已知命令；是则返回命令名与完整命令行（已 trim）。 */
export function leadingCommandLine(
	draft: string,
	commands: readonly NativeCommand[],
): { name: string; line: string } | null {
	if (commands.length === 0) return null;
	const line = draft.trim();
	const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line);
	if (match === null) return null;
	const name = match[1] ?? '';
	if (!commands.some((command) => command.name === name)) return null;
	return { name, line };
}

/** 兜底归一化：与 normalizeCommandNames 的规则保持一致，但只接受字符串数组。 */
function normalizeEntries(values: readonly string[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim().toLowerCase();
		if (normalized === '' || !/^[a-z][a-z0-9_-]*$/u.test(normalized)) continue;
		if (!result.includes(normalized)) result.push(normalized);
	}
	return result;
}
