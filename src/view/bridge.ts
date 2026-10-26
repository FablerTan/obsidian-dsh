import type { App } from 'obsidian';
import { VIEW_TYPE_DSH } from '../shared/constants';
import type { DshBridgeState, DshBridgeStatus } from '../shared/types';
import type { DshWebView } from './dsh-view';

/**
 * 与 DSH 页面里的 `dsh-obsidian-bridge` 通信。
 *
 * 通道是 Electron `<webview>.executeJavaScript()`：脚本在 guest 页面里执行，
 * 返回 JSON 可序列化的结果。桥只存在于 webview 承载；iframe 回退时明确拒绝。
 * 这里不 import main.ts，只依赖 App 与 DshWebView 的窄方法。
 */

export type DshBridgeErrorReason =
	| 'panel-closed'
	| 'iframe'
	| 'missing'
	| 'version'
	| 'timeout'
	| 'call-failed';

export class DshBridgeError extends Error {
	constructor(
		readonly reason: DshBridgeErrorReason,
		message: string,
	) {
		super(message);
		this.name = 'DshBridgeError';
	}
}

interface BridgeReply<T> {
	__dshBridge?: boolean;
	version?: number;
	value?: T;
	error?: string;
}

const PING_TIMEOUT_MS = 4000;
const CALL_TIMEOUT_MS = 10000;

/** 取当前 DSH 面板视图；没有或不是 DshWebView 时返回 null。 */
function findDshView(app: App): DshWebView | null {
	const leaf = app.workspace.getLeavesOfType(VIEW_TYPE_DSH)[0];
	const view = leaf?.view as DshWebView | undefined;
	if (view === undefined || typeof view.runScript !== 'function') return null;
	return view;
}

/** 生成在 guest 页面里执行的调用脚本。 */
function callSource(method: string, args: unknown[]): string {
	return `(async () => {
		const bridge = window.__DSH_OBSIDIAN_BRIDGE__;
		if (!bridge) return { __dshBridge: false };
		try {
			const value = await bridge[${JSON.stringify(method)}](...${JSON.stringify(args)});
			return { __dshBridge: true, version: bridge.version, value };
		} catch (error) {
			return { __dshBridge: true, version: bridge.version, error: String((error && error.message) || error) };
		}
	})()`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new DshBridgeError('timeout', message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function normalizeVersion(version: unknown): number | undefined {
	return typeof version === 'number' && Number.isFinite(version) ? version : undefined;
}

/** 调用桥方法；失败时抛出带原因的 DshBridgeError。 */
export async function callDshBridge<T>(
	app: App,
	method: string,
	args: unknown[] = [],
	timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
	const view = findDshView(app);
	if (view === null) throw new DshBridgeError('panel-closed', 'DSH 面板未打开');
	if (view.surfaceKind === 'iframe') {
		throw new DshBridgeError('iframe', '当前承载方式为 iframe，无法访问 DSH 页面');
	}
	if (view.surfaceKind === null) throw new DshBridgeError('panel-closed', 'DSH 面板尚未加载');

	let reply: BridgeReply<T>;
	try {
		reply = await withTimeout(
			view.runScript<BridgeReply<T>>(callSource(method, args)),
			timeoutMs,
			'DSH 页面响应超时',
		);
	} catch (error) {
		if (error instanceof DshBridgeError) throw error;
		throw new DshBridgeError('call-failed', error instanceof Error ? error.message : String(error));
	}

	if (reply?.__dshBridge !== true) {
		throw new DshBridgeError('missing', 'DSH 页面里没有 obsidian-bridge');
	}
	const version = normalizeVersion(reply.version);
	if (version === undefined || version < 1) {
		throw new DshBridgeError('version', 'obsidian-bridge 版本不兼容');
	}
	if (reply.error !== undefined) throw new DshBridgeError('call-failed', reply.error);
	return reply.value as T;
}

/** 等桥就绪；面板刚打开时 webview 可能还没加载完。 */
export async function waitForDshBridge(app: App, timeoutMs = 15000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	// 页面里确实没有桥时不必等满 15s；给加载中的页面留几秒余量。
	let missingSince: number | null = null;
	while (Date.now() < deadline) {
		try {
			const pong = await callDshBridge<{ version: number }>(app, 'ping', [], PING_TIMEOUT_MS);
			const version = normalizeVersion(pong?.version);
			if (version !== undefined) return version;
			throw new DshBridgeError('version', 'obsidian-bridge 未返回版本');
		} catch (error) {
			lastError = error;
			// iframe 不可能恢复，立即停止等待。
			if (error instanceof DshBridgeError && error.reason === 'iframe') throw error;
			if (
				error instanceof DshBridgeError &&
				(error.reason === 'missing' || error.reason === 'version')
			) {
				missingSince ??= Date.now();
				if (Date.now() - missingSince > 4000) throw error;
			} else {
				missingSince = null;
			}
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
	}
	if (lastError instanceof DshBridgeError) throw lastError;
	throw new DshBridgeError('timeout', '等待 DSH 页面桥超时');
}

/** 设置页用：探测桥状态，不抛错。 */
export async function probeDshBridge(app: App): Promise<DshBridgeStatus> {
	try {
		const pong = await callDshBridge<{ version: number }>(app, 'ping', [], PING_TIMEOUT_MS);
		return { state: 'connected', version: normalizeVersion(pong?.version) };
	} catch (error) {
		if (error instanceof DshBridgeError) {
			const state: DshBridgeState =
				error.reason === 'panel-closed'
					? 'panel-closed'
					: error.reason === 'iframe'
						? 'iframe'
						: error.reason === 'missing' || error.reason === 'version'
							? 'missing'
							: 'error';
			return { state, message: error.message };
		}
		return { state: 'error', message: error instanceof Error ? error.message : String(error) };
	}
}

/** 把桥错误翻译成可执行的用户提示。 */
export function describeDshBridgeError(error: unknown): string {
	if (!(error instanceof DshBridgeError)) {
		return error instanceof Error ? error.message : String(error);
	}
	switch (error.reason) {
		case 'panel-closed':
			return 'DSH 面板还没打开，请重试';
		case 'iframe':
			return '当前承载方式为 iframe，无法新建会话；请确认 webview 可用后重开面板';
		case 'missing':
			return '未检测到 dsh-obsidian-bridge；请安装该 dsh 插件、重启 DSH 服务并重开面板';
		case 'version':
			return 'dsh-obsidian-bridge 版本不兼容，请更新插件';
		case 'timeout':
			return 'DSH 页面响应超时，请重开面板后重试';
		default:
			return 'DSH 桥调用失败：' + error.message;
	}
}
