/**
 * YAML 标量的最小读取（不引入 YAML 依赖）。
 *
 * 组合结果（dsh --dump-config）与用户层 cordis.patch.yml 都可能把 id / name
 * 写成带引号的标量；插件端只做展示与匹配，因此只保留「去引号」这一半。
 */

/** 去掉 YAML 标量的引号（单引号会转义成两个单引号）。 */
export function unquoteYaml(value: string): string {
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replaceAll("''", "'");
	}
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
	return value;
}
