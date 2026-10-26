/**
 * 就绪探测的四态结果。
 *
 * - running: 端口上是可直接访问的 dsh（能识别出 dsh 页面）
 * - auth:    端口上是 dsh，但需要浏览器会话 token（0.2.1+），裸 URL 打不开
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
export type DshBridgeState = 'connected' | 'panel-closed' | 'iframe' | 'missing' | 'error';

export interface DshBridgeStatus {
	state: DshBridgeState;
	version?: number;
	message?: string;
}
