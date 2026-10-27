/**
 * `/` 菜单技能行的范围过滤（0037，纯函数，不 import obsidian）。
 *
 * 设置页可选「不启用 / 白名单 / 黑名单」，规则与 @ 的候选范围（0030）同款：
 * - 每个条目是技能名，按名字前缀匹配：条目 `office` 覆盖技能 `office` 本身与 `office-*` 子项；
 * - 白名单：只保留命中条目的技能；白名单为空时技能行全部隐藏（命令 new / compact 不受影响）；
 * - 黑名单：去掉命中条目的技能；黑名单为空时不过滤；
 * - 范围只作用于 `/` 菜单里**显示**的技能行；技能加载、技能目录读取与 `/name` 插入 / 执行都不变。
 */
import { normalizeScopeNames, type SkillScope } from '../../settings/schema';
import type { NativeSkill } from '../../shared/native-types';

/** 技能名是否落在某个条目里（条目本身，或 `-` 分隔的子项，与 @ 的文件夹语义对应）。 */
function covers(entry: string, name: string): boolean {
	return name === entry || name.startsWith(entry + '-');
}

function matchesAny(entries: readonly string[], name: string): boolean {
	const needle = name.toLowerCase();
	return entries.some((entry) => covers(entry, needle));
}

/** 按设置裁剪 `/` 菜单里的技能行；不启用时原样返回。 */
export function filterSlashSkills(
	skills: readonly NativeSkill[],
	scope: SkillScope,
): NativeSkill[] {
	if (scope.mode === 'off') return [...skills];
	if (scope.mode === 'whitelist') {
		// 合并设置时已归一化；这里再兜一次手改 data.json / 旧版本值的情况。
		const allow = normalizeScopeNames(scope.allow);
		if (allow.length === 0) return [];
		return skills.filter((skill) => matchesAny(allow, skill.name));
	}
	// 未知模式兜底为「不过滤」，与 mergeSettings 回落 off 的方向一致。
	if (scope.mode !== 'blacklist') return [...skills];
	const deny = normalizeScopeNames(scope.deny);
	if (deny.length === 0) return [...skills];
	return skills.filter((skill) => !matchesAny(deny, skill.name));
}
