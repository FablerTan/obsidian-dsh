/**
 * 日志约定（便于在 Obsidian 开发者控制台里过滤）：
 *  - [dsh-native-chat] 插件自身的生命周期（警告走 console.warn）
 *  - [dsh]          dsh 子进程的 stdout / stderr
 */

/** 插件侧普通日志。 */
export function logPlugin(message: string): void {
	console.debug('[dsh-native-chat] ' + message);
}

/** 插件侧警告日志（不阻断流程，但需要用户注意，如 dsh 版本冲突）。 */
export function logPluginWarn(message: string): void {
	console.warn('[dsh-native-chat] ' + message);
}

/** 插件侧错误日志。 */
export function logPluginError(message: string, error?: unknown): void {
	if (error === undefined) console.error('[dsh-native-chat] ' + message);
	else console.error('[dsh-native-chat] ' + message, error);
}

/**
 * 打码 URL 里的会话 token（dsh 0.2.x 会打印带 token 的启动 URL）。
 * 只在展示/日志层使用，token 本身仍保留在内存里供承载面首次登录。
 */
export function redactToken(text: string): string {
	return text.replace(/([?&]token=)[^&\s]+/g, '$1***');
}

/** 转发子进程输出（stderr 保持为 error 级别，便于控制台高亮）。 */
export function logChild(stream: 'stdout' | 'stderr', chunk: string): void {
	const text = '[dsh] ' + redactToken(chunk.trimEnd());
	if (stream === 'stderr') console.error(text);
	else console.debug(text);
}
