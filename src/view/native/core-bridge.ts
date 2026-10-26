import { sleep } from '../../shared/async';
import {
	NativeBridgeError,
	type NativeChatSnapshot,
	type NativeEvent,
	type NativeModels,
	type NativeModelSelection,
	type NativePending,
	type NativePermissions,
	type NativeQuestionAnswer,
	type NativeSessionList,
	type NativeSessionSummary,
} from '../../shared/native-types';

/**
 * 与隐藏 DSH core webview 里的 `dsh-obsidian-bridge` v2 通信。
 *
 * 通道是 `<webview>.executeJavaScript()`：脚本在 guest 页面里执行，返回 JSON。
 * 这里只负责调用、等待就绪、长轮询与错误归因；不持有 DOM，也不 import main.ts。
 */

interface BridgeReply<T> {
	__dshNative?: boolean;
	version?: number;
	value?: T;
	error?: string;
}

const CALL_TIMEOUT_MS = 15000;
const POLL_TIMEOUT_MS = 20000;

/** 生成在 guest 页面里执行的调用脚本。 */
function callSource(method: string, args: unknown[]): string {
	return (
		'(async () => {\n' +
		'  const bridge = window.__DSH_OBSIDIAN_BRIDGE__;\n' +
		'  if (!bridge) return { __dshNative: false };\n' +
		'  try {\n' +
		'    const value = await bridge[' +
		JSON.stringify(method) +
		'](...' +
		JSON.stringify(args) +
		');\n' +
		'    return { __dshNative: true, version: bridge.version, value };\n' +
		'  } catch (error) {\n' +
		'    return { __dshNative: true, version: bridge.version, error: String((error && error.message) || error) };\n' +
		'  }\n' +
		'})()'
	);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new NativeBridgeError('timeout', label + ' 超时（' + String(ms) + 'ms）'));
		}, ms);
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

export class NativeCoreBridge {
	constructor(private readonly run: <T>(code: string) => Promise<T>) {}

	/** 等页面加载出 bridge v2；页面未加载完时 executeJavaScript 会失败，直接重试。 */
	async waitReady(timeoutMs = 20000): Promise<number> {
		const deadline = Date.now() + timeoutMs;
		let last: unknown;
		while (Date.now() < deadline) {
			try {
				const pong = await this.invoke<{ version: number; methods?: string[] }>(
					'ping',
					[],
					3000,
				);
				if (pong.version >= 2) {
					const methods = pong.value?.methods;
					if (!Array.isArray(methods) || !methods.includes('models')) {
						throw new NativeBridgeError(
							'version',
							'桥版本过旧（缺少模型/权限方法），请更新 dsh-obsidian-bridge 并重启 DSH 服务',
						);
					}
					return pong.version;
				}
				throw new NativeBridgeError(
					'version',
					'桥版本过旧（' + String(pong.version) + '，需要 v2）',
				);
			} catch (error) {
				if (error instanceof NativeBridgeError && error.reason === 'version') throw error;
				last = error;
			}
			await sleep(300);
		}
		if (last instanceof Error) throw last;
		throw new NativeBridgeError('timeout', '等待 DSH 页面桥超时');
	}

	async listSessions(): Promise<NativeSessionList> {
		return this.call<NativeSessionList>('listSessions');
	}

	async createSession(cwd?: string): Promise<{ ok: boolean; sessionId: string }> {
		return this.call('createSession', [cwd]);
	}

	async subscribe(sessionId: string): Promise<{ ok: boolean; sessionId: string; revision: number }> {
		return this.call('subscribe', [sessionId]);
	}

	async unsubscribe(): Promise<{ ok: boolean }> {
		return this.call('unsubscribe');
	}

	async snapshot(): Promise<NativeChatSnapshot> {
		return this.call<NativeChatSnapshot>('snapshot');
	}

	async diagnose(): Promise<unknown> {
		return this.call('diagnose');
	}

	/** 长轮询：有 revision 变化立即返回；超时返回 changed=false。 */
	async nextEvent(cursor: number, timeoutMs = POLL_TIMEOUT_MS): Promise<NativeEvent> {
		return this.call<NativeEvent>('nextEvent', [cursor, timeoutMs], timeoutMs + 5000);
	}

	async send(text: string): Promise<{ ok: boolean }> {
		return this.call('send', [text]);
	}

	async cancel(): Promise<{ ok: boolean }> {
		return this.call('cancel');
	}

	async loadOlder(): Promise<{ ok: boolean }> {
		return this.call('loadOlder');
	}

	async models(): Promise<NativeModels> {
		return this.call<NativeModels>('models');
	}

	async selectModel(
		selection: NativeModelSelection,
	): Promise<{ ok: boolean; selected: NativeModelSelection }> {
		return this.call('selectModel', [selection]);
	}

	async permissions(): Promise<NativePermissions | null> {
		return this.call<NativePermissions | null>('permissions');
	}

	async setPermission(preset: string): Promise<{ ok: boolean }> {
		return this.call('setPermission', [preset]);
	}

	async renameSession(title: string): Promise<{ ok: boolean; title: string }> {
		return this.call('renameSession', [title]);
	}

	async approvalAnswer(decision: 'allowed-once' | 'rejected'): Promise<{ ok: boolean }> {
		return this.call('approvalAnswer', [decision]);
	}

	async questionAnswer(answer: NativeQuestionAnswer): Promise<{ ok: boolean }> {
		return this.call('questionAnswer', [answer]);
	}

	private async call<T>(method: string, args: unknown[] = [], timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
		const reply = await this.invoke<T>(method, args, timeoutMs);
		if (reply.version < 2) {
			throw new NativeBridgeError('version', 'dsh-obsidian-bridge 版本过旧（需要 v2）');
		}
		return reply.value;
	}

	private async invoke<T>(
		method: string,
		args: unknown[],
		timeoutMs: number,
	): Promise<{ version: number; value: T }> {
		let reply: BridgeReply<T>;
		try {
			reply = await withTimeout(
				this.run<BridgeReply<T>>(callSource(method, args)),
				timeoutMs,
				method,
			);
		} catch (error) {
			if (error instanceof NativeBridgeError) throw error;
			throw new NativeBridgeError(
				'call-failed',
				error instanceof Error ? error.message : String(error),
			);
		}
		if (reply?.__dshNative !== true) {
			throw new NativeBridgeError('missing', '页面里没有 dsh-obsidian-bridge');
		}
		const version = typeof reply.version === 'number' ? reply.version : 0;
		if (version < 1) throw new NativeBridgeError('version', 'obsidian-bridge 版本信息缺失');
		if (reply.error !== undefined) throw new NativeBridgeError('call-failed', reply.error);
		return { version, value: reply.value as T };
	}
}

/** 把桥错误翻译成可执行提示。 */
export function describeNativeBridgeError(error: unknown): string {
	if (!(error instanceof NativeBridgeError)) {
		return error instanceof Error ? error.message : String(error);
	}
	switch (error.reason) {
		case 'missing':
			return '页面里没有 dsh-obsidian-bridge；请更新/安装 bridge 插件并重启 DSH 服务';
		case 'version':
			return 'dsh-obsidian-bridge 版本过旧（需要模型/权限方法），请更新并重启 DSH 服务';
		case 'timeout':
			return 'DSH 页面响应超时，请重开原生面板';
		case 'not-subscribed':
			return '还没有订阅会话，请先选择并打开一个会话';
		default:
			return '原生桥调用失败：' + error.message;
	}
}

export type { NativePending, NativeSessionSummary };
