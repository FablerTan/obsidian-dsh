/** 插件设置：独立 dsh 服务的端口、profile 与自动启动。 */
export interface DshPluginSettings {
	/** 独立服务端口（默认 3081，避开 web profile 的 3080）。 */
	port: number;
	/** 专用 profile 名。 */
	profile: string;
	/** 插件加载时自动拉起服务。 */
	autoStart: boolean;
	/** 指定使用的 dsh 安装路径；null = 自动按 locator 优先级（M2-5 的顺序）。 */
	dshPath: string | null;
}

export const DEFAULT_SETTINGS: DshPluginSettings = {
	port: 3081,
	profile: 'obsidian',
	autoStart: true,
	dshPath: null,
};

/** 端口 → 面板地址。改端口时只改这一处推导规则。 */
export function serviceUrl(port: number): string {
	return 'http://127.0.0.1:' + String(port);
}

/** 合并已保存的设置与默认值（缺失 / 旧版本字段自动回落到默认）。 */
export function mergeSettings(saved: unknown): DshPluginSettings {
	return Object.assign({}, DEFAULT_SETTINGS, (saved ?? {}) as Partial<DshPluginSettings>);
}

/** 端口是否落在合法区间（设置页输入校验）。 */
export function isValidPort(port: number): boolean {
	return Number.isFinite(port) && port > 0 && port < 65536;
}
