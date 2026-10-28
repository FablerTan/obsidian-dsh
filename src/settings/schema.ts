/** 流式刷新节奏（0021）：逐字 / 每帧 / 平衡 / 省电。 */
export type StreamRefreshMode = 'chunk' | 'frame' | 'balanced' | 'relaxed';

/** 各档对应的合并间隔（ms）；0 = 每个 chunk 立即唤醒原生端。 */
const STREAM_REFRESH_MS: Record<StreamRefreshMode, number> = {
	chunk: 0,
	frame: 16,
	balanced: 50,
	relaxed: 100,
};

export function streamRefreshMs(mode: StreamRefreshMode): number {
	return STREAM_REFRESH_MS[mode] ?? STREAM_REFRESH_MS.frame;
}

/** 选区引用摘录上限（0058）：默认 2000 字，设置页可调。 */
const DEFAULT_QUOTE_EXCERPT_LIMIT = 2000;
export const MIN_QUOTE_EXCERPT_LIMIT = 100;
export const MAX_QUOTE_EXCERPT_LIMIT = 20000;

/** 摘录上限归一化：非数字回落默认值，越界夹到区间内，取整。 */
export function quoteExcerptLimitOf(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_QUOTE_EXCERPT_LIMIT;
	}
	const rounded = Math.round(value);
	if (rounded < MIN_QUOTE_EXCERPT_LIMIT) return MIN_QUOTE_EXCERPT_LIMIT;
	if (rounded > MAX_QUOTE_EXCERPT_LIMIT) return MAX_QUOTE_EXCERPT_LIMIT;
	return rounded;
}

/** 运行提示（0047）的位置（0048）：输入框上方 / 消息流最下方。 */
export type RunStatusPlacement = 'composer' | 'flow';

/** 位置值校验：非法 / 旧值一律回落「输入框上方」（0048）。 */
export function runStatusPlacementOf(value: unknown): RunStatusPlacement {
	return value === 'flow' ? 'flow' : 'composer';
}

/** 输入框候选范围模式（0030 @ 路径、0037 / 技能名）：不启用 / 白名单 / 黑名单。 */
export type ScopeMode = 'off' | 'whitelist' | 'blacklist';

/** @ 菜单检索范围：白名单只检索列出的路径，黑名单排除列出的路径（文件 / 文件夹同一套前缀规则）。 */
export interface MentionScope {
	mode: ScopeMode;
	/** 白名单：文件夹（含子目录）或单个文件，vault 相对路径。 */
	allow: readonly string[];
	/** 黑名单：文件夹（含子目录）或单个文件，vault 相对路径。 */
	deny: readonly string[];
}

/**
 * 「/」菜单技能行范围（0037）：按技能名过滤，只影响菜单里出现哪些技能行，
 * 不改变技能加载、技能目录读取与 `/name` 插入 / 执行。
 */
export interface SkillScope {
	mode: ScopeMode;
	/** 白名单：技能名或其前缀（office 覆盖 office 本身与 office-* 子项）。 */
	allow: readonly string[];
	/** 黑名单：技能名或其前缀（同上）。 */
	deny: readonly string[];
}

/**
 * 「/」菜单命令行范围（0050）：按 dsh 命令名过滤，只影响菜单里出现哪些命令行，
 * 不改变命令目录读取（commands()）与 executeCommand 执行。
 */
export interface CommandScope {
	mode: ScopeMode;
	/** 白名单：命令名精确匹配（命令是扁平命名空间，没有子项）。 */
	allow: readonly string[];
	/** 黑名单：命令名精确匹配。 */
	deny: readonly string[];
}

/**
 * 范围路径归一化：去首尾空白与斜杠、反斜杠转正斜杠。
 * 拒绝空串、`.` / `..` 段与空段（`a//b`），避免匹配到 vault 之外或歧义路径。
 */
export function normalizeScopePath(value: string): string | null {
	const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
	if (normalized === '') return null;
	const segments = normalized.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
	return normalized;
}

/** 合并保存的路径列表：归一化、去重、丢掉非法项（旧设置 / 手改 data.json 也能吃下）。 */
export function normalizeScopePaths(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const path = normalizeScopePath(item);
		if (path !== null && !result.includes(path)) result.push(path);
	}
	return result;
}

/**
 * 技能名归一化（0037）：去首尾空白并转小写。
 * 只接受小写字母、数字、点、下划线、连字符（技能名约定）；
 * 空串、含 `/` / 空白等非法字符（如误填 vault 路径）返回 null。
 */
export function normalizeScopeName(value: string): string | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === '' || !/^[a-z0-9._-]+$/u.test(normalized)) return null;
	return normalized;
}

/**
 * 命令名归一化（0050）：去首尾空白并转小写。
 * 只接受 dsh 的命令名规则 `^[a-z][a-z0-9_-]*$`（见 dsh-commands 的 COMMAND_NAME）；
 * 空串、含 `/` / 点号 / 空白等非法字符返回 null。
 */
export function normalizeCommandName(value: string): string | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === '' || !/^[a-z][a-z0-9_-]*$/u.test(normalized)) return null;
	return normalized;
}

/** 合并保存的命令名列表：归一化、去重、丢掉非法项（0050）。 */
export function normalizeCommandNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const name = normalizeCommandName(item);
		if (name !== null && !result.includes(name)) result.push(name);
	}
	return result;
}

/** 合并保存的技能名列表：归一化、去重、丢掉非法项（0037）。 */
export function normalizeScopeNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const name = normalizeScopeName(item);
		if (name !== null && !result.includes(name)) result.push(name);
	}
	return result;
}

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
	/** 流式正文的刷新节奏（0021，默认每帧）。 */
	streamRefresh: StreamRefreshMode;
	/** 运行提示（0047）显示在哪（0048，默认输入框上方）。 */
	runStatusPlacement: RunStatusPlacement;
	/** 「@」引用范围模式（0030，默认不启用）。 */
	mentionScope: ScopeMode;
	/** 白名单路径（vault 相对路径：文件夹含子目录 / 单个文件）。 */
	mentionWhitelist: string[];
	/** 黑名单路径（vault 相对路径：文件夹含子目录 / 单个文件）。 */
	mentionBlacklist: string[];
	/** 「/」技能范围模式（0037，默认不启用）：只影响 / 菜单里的技能行。 */
	skillScope: ScopeMode;
	/** 白名单技能名（0037；条目是名字前缀，office 覆盖 office-*）。 */
	skillWhitelist: string[];
	/** 黑名单技能名（0037；条目是名字前缀，office 覆盖 office-*）。 */
	skillBlacklist: string[];
	/** 「/」命令范围模式（0050，默认不启用）：只影响 / 菜单里的 dsh 命令行。 */
	commandScope: ScopeMode;
	/** 白名单命令名（0050；精确匹配，dsh 命令名规则）。 */
	commandWhitelist: string[];
	/** 黑名单命令名（0050；精确匹配）。 */
	commandBlacklist: string[];
	/** 编辑器选区引用的摘录上限（0058，默认 2000 字）。 */
	quoteExcerptLimit: number;
}

export const DEFAULT_SETTINGS: DshPluginSettings = {
	port: 3081,
	profile: 'obsidian',
	autoStart: true,
	dshPath: null,
	streamRefresh: 'frame',
	runStatusPlacement: 'composer',
	mentionScope: 'off',
	mentionWhitelist: [],
	mentionBlacklist: [],
	skillScope: 'off',
	skillWhitelist: [],
	skillBlacklist: [],
	commandScope: 'off',
	commandWhitelist: [],
	commandBlacklist: [],
	quoteExcerptLimit: DEFAULT_QUOTE_EXCERPT_LIMIT,
};

/** 合并已保存的设置与默认值（缺失 / 旧版本字段自动回落到默认）。 */
export function mergeSettings(saved: unknown): DshPluginSettings {
	const merged = Object.assign({}, DEFAULT_SETTINGS, (saved ?? {}) as Partial<DshPluginSettings>);
	if (!Object.prototype.hasOwnProperty.call(STREAM_REFRESH_MS, merged.streamRefresh)) {
		merged.streamRefresh = DEFAULT_SETTINGS.streamRefresh;
	}
	// 未知模式一律回落默认值（手改 data.json / 旧版本值也能吃下）。
	merged.mentionScope = scopeModeOf(merged.mentionScope, DEFAULT_SETTINGS.mentionScope);
	merged.skillScope = scopeModeOf(merged.skillScope, DEFAULT_SETTINGS.skillScope);
	merged.commandScope = scopeModeOf(merged.commandScope, DEFAULT_SETTINGS.commandScope);
	// 归一化同时复制数组：避免合并结果与 DEFAULT_SETTINGS 共享同一个可变数组。
	merged.mentionWhitelist = normalizeScopePaths(merged.mentionWhitelist);
	merged.mentionBlacklist = normalizeScopePaths(merged.mentionBlacklist);
	merged.skillWhitelist = normalizeScopeNames(merged.skillWhitelist);
	merged.skillBlacklist = normalizeScopeNames(merged.skillBlacklist);
	merged.commandWhitelist = normalizeCommandNames(merged.commandWhitelist);
	merged.commandBlacklist = normalizeCommandNames(merged.commandBlacklist);
	merged.runStatusPlacement = runStatusPlacementOf(merged.runStatusPlacement);
	merged.quoteExcerptLimit = quoteExcerptLimitOf(merged.quoteExcerptLimit);
	return merged;
}

/** 三档范围模式校验：非法值回落 fallback（0030 / 0037 共用）。 */
function scopeModeOf(value: unknown, fallback: ScopeMode): ScopeMode {
	return value === 'off' || value === 'whitelist' || value === 'blacklist' ? value : fallback;
}

/** 端口是否落在合法区间（设置页输入校验）。 */
export function isValidPort(port: number): boolean {
	return Number.isFinite(port) && port > 0 && port < 65536;
}
