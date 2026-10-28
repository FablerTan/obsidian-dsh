/**
 * 就绪探测的四态结果。
 *
 * - running: 端口上是可直接访问的 dsh 页面（0.1.x 或未启用 token 鉴权；本插件只支持 0.2.x，会判为不兼容）
 * - auth:    端口上是 dsh，但需要浏览器会话 token（0.2.x），裸 URL 打不开
 * - foreign: 端口被别的程序占用（能连上，但不是 dsh）
 * - down:    没有服务在监听
 */
export type ProbeResult = 'running' | 'auth' | 'foreign' | 'down';

/** 探测函数：给定服务 URL，返回四态结果。 */
export type Probe = (url: string) => Promise<ProbeResult>;

/**
 * dsh 的启动方式：可执行文件 + 需要前置的参数。
 * node + bin.js 时为 `{ cmd: 'node', prefix: ['.../bin.js'] }`；直接执行时为 `{ cmd: 'dsh', prefix: [] }`。
 *
 * 放在 shared 而不是 service/locator：manager（service）与设置页（settings）都要用，
 * 而 settings 按分层只能依赖 shared。
 */
export interface DshCommand {
	cmd: string;
	prefix: string[];
	/**
	 * 额外注入的子进程环境变量（只作用于这次启动 / 探测）。
	 * 桌面 App 内置的 dsh 需要 ELECTRON_RUN_AS_NODE=1 才能把 App 的 Electron 当 node 跑。
	 */
	env?: Record<string, string>;
}

/** 一份可用的 dsh 安装：启动方式 + 展示路径 + 版本（探测失败为 null）。 */
export interface DshInstall {
	command: DshCommand;
	/** 展示给用户看的路径（node + bin.js 显示 bin.js；PATH 上的 dsh 显示解析出的绝对路径）。 */
	path: string;
	version: string | null;
}

/**
 * 实际使用的 dsh 运行信息：由 locator 解析 + 版本探测得到，供启动日志、
 * 设置页「运行环境」与版本冲突提示使用。
 */
export interface DshRuntimeInfo {
	used: DshInstall;
	/** 版本与 used 不同的其他安装（used.version 未知时为空数组，避免误报）。 */
	others: DshInstall[];
	/**
	 * true  = 本次 spawn 实际使用，路径/版本可信；
	 * false = 服务已在运行（非本次拉起），used 只是插件的解析结果，无法确认运行中实例的版本。
	 */
	confirmed: boolean;
	/** true = 设置里指定的 dsh 没有检测到，已回退到自动解析。 */
	fallback?: boolean;
}

/** DSH 页面里 obsidian-bridge 的探测结果（设置页展示）。 */
type DshBridgeState = 'connected' | 'panel-closed' | 'missing' | 'error';

export interface DshBridgeStatus {
	state: DshBridgeState;
	version?: number;
	message?: string;
}

/** dsh 侧插件组件行的状态：启用 / 停用 / 由 dsh 按运行环境决定（`!!js` 条件）。 */
export type DshPluginRowState = 'on' | 'off' | 'conditional';

/** 组合后的一个插件组件行（来自 `dsh --profile <p> --dump-config`）。 */
export interface DshPluginRow {
	/** 组合条目的 id（profile patch 里的 `- id:`）。 */
	id: string;
	/** Loader 导入的模块名（如 `@deepseek-ai/dsh-session`）。 */
	name: string;
	state: DshPluginRowState;
	/** 该行最后一次声明来自 profile 的用户层 patch（设置页可以在那里启停）。 */
	fromUserPatch: boolean;
}

/** 一个 bundle（profile 的 `dsh.profile.bundles` 项）及其组件行。 */
export interface DshPluginBundle {
	name: string;
	/** 包版本；解析不到（例如内置包不在可读的 node_modules 里）为 null。 */
	version: string | null;
	rows: DshPluginRow[];
}

/** 一个「可选 / 实验性」bundle（随 dsh 安装提供、默认未启用，0032）。 */
export interface DshOptionalBundle {
	name: string;
	/** 中文标题（locale/zh.json 的 meta.title，缺失时用短包名）。 */
	title: string;
	description: string;
	version: string | null;
	/** dsh 官方标记的实验性插件。 */
	experimental: boolean;
	/** 已写进 profile 的 `dsh.profile.bundles`。 */
	enabled: boolean;
	/** 这份安装里能解析到包（false 时不能直接启用，通常是安装不完整）。 */
	available: boolean;
}

/** 「可选 / 实验性插件」目录（设置页「插件」tab，0032）。 */
export interface DshOptionalCatalog {
	/** 目录来源包（@deepseek-ai/dsh-official-bundles）的目录；读不到为 null。 */
	source: string | null;
	bundles: DshOptionalBundle[];
	/** 需要先 `dsh plugin add` 才能启用的按需插件。 */
	onDemand: string[];
	/** 目录不可用时的说明。 */
	message?: string;
}

/**
 * 服务操作结果（0056）：设置页就地反馈与命令面板 Notice 共用。
 *
 * 文案在组合根（main.ts）由 manager 的 outcome 翻译，UI 只负责展示，
 * 避免「设置页 + main + 命令面板」各弹一遍 Notice。
 */
export interface DshActionResult {
	ok: boolean;
	/** 一行结果文案（成功时含端口与耗时；失败时描述原因）。 */
	message: string;
	/** 失败时的下一步建议（例如「先点结束后台 dsh」），成功时省略。 */
	hint?: string;
	/** 从发起到出结果的实际耗时（毫秒）。 */
	elapsedMs: number;
}

/** 「结束后台 dsh」的结果（0056）。 */
export interface DshStopResult {
	ok: boolean;
	message: string;
	hint?: string;
	/** 被结束的端口监听进程 PID（不含插件自己拉起的子进程）。 */
	pids: number[];
	/** 插件自己拉起的子进程是否也被结束。 */
	stoppedOwn: boolean;
}

/** profile 的组合插件清单（设置页「插件」tab 展示，0031）。 */
export interface DshPluginInventory {
	profile: string;
	/** profile 目录：`$DSH_HOME/profiles/<profile>`。 */
	profileDir: string;
	/** 用户层 patch 文件（启停写入的目标）。 */
	patchPath: string;
	/** 实际使用的 dsh 版本（探测失败为 null）。 */
	dshVersion: string | null;
	bundles: DshPluginBundle[];
	/** 读取时间戳（缓存展示用）。 */
	readAt: number;
}

