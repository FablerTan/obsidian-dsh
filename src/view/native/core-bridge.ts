import { sleep } from '../../shared/async';
import { errorText } from '../../shared/errors';
import {
	NativeBridgeError,
	type NativeChatSnapshot,
	type NativeCommand,
	type NativeCommandResult,
	type NativeContextUsage,
	type NativeEvent,
	type NativeGoal,
	type NativeGoalActionResult,
	type NativeModels,
	type NativeModelSelection,
	type NativePending,
	type NativePermissions,
	type NativeQuestionAnswer,
	type NativeSessionList,
	type NativeSessionSummary,
	type NativeSkill,
	type NativeSubagentAddress,
	type NativeSubagentList,
	type NativeTeamProjection,
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
	/** 桥 v3 能力：liveStream（会话事件流 → 流式正文）。 */
	private liveStream = false;
	/** 桥 v4 能力：context（contextPressure / contextBreakdown 投影）。 */
	private contextCapability = false;
	/** 桥 v5 能力：commands / skills / executeCommand（输入框 "/" 菜单）。 */
	private commandCapability = false;
	/** 桥 v6 能力：team（Agent Teams 投影，只读团队面板）。 */
	private teamCapability = false;
	/** 桥 v7 能力：subagents（子智能体目录 + addressed 订阅）。 */
	private subagentCapability = false;
	/** 桥 v8 能力：goal / goalAction（会话目标投影与目标操作）。 */
	private goalCapability = false;

	constructor(private readonly run: <T>(code: string) => Promise<T>) {}

	/** 探测页面里的 bridge 版本与能力；页面未加载完时会抛 missing/timeout。 */
	async probe(): Promise<{ version: number; methods: string[] }> {
		const pong = await this.invoke<{ version: number; methods?: string[] }>('ping', [], 4000);
		const methods = Array.isArray(pong.value?.methods) ? pong.value.methods : [];
		this.liveStream = methods.includes('liveStream');
		this.contextCapability = methods.includes('context');
		this.commandCapability =
			methods.includes('commands') &&
			methods.includes('skills') &&
			methods.includes('executeCommand');
		this.teamCapability = methods.includes('team');
		this.subagentCapability = methods.includes('subagents');
		this.goalCapability = methods.includes('goal') && methods.includes('goalAction');
		return {
			version: pong.version,
			methods,
		};
	}

	/** 桥是否支持 v3 的流式通道；不支持时面板退回整段出现。 */
	supportsLiveStream(): boolean {
		return this.liveStream;
	}

	/** 桥是否支持 v4 的上下文占用；不支持时显示灰色空环。 */
	supportsContext(): boolean {
		return this.contextCapability;
	}

	/** 桥是否支持 v5 的命令 / 技能目录；不支持时 "/" 菜单里的 compact、skills 置灰。 */
	supportsCommands(): boolean {
		return this.commandCapability;
	}

	/** 桥是否支持 v6 的团队投影；不支持时不显示团队入口。 */
	supportsTeam(): boolean {
		return this.teamCapability;
	}

	/** 桥是否支持 v7 的子智能体目录与 addressed 订阅；不支持时不显示子智能体入口。 */
	supportsSubagents(): boolean {
		return this.subagentCapability;
	}

	/** 桥是否支持 v8 的会话目标；不支持（旧桥未重启）时不显示目标条。 */
	supportsGoal(): boolean {
		return this.goalCapability;
	}

	/** 等页面加载出 bridge v2+；页面未加载完时 executeJavaScript 会失败，直接重试。 */
	async waitReady(timeoutMs = 20000): Promise<number> {
		const deadline = Date.now() + timeoutMs;
		let last: unknown;
		while (Date.now() < deadline) {
			try {
				const pong = await this.probe();
				if (pong.version >= 2) {
					if (!pong.methods.includes('models')) {
						throw new NativeBridgeError(
							'version',
							'桥版本过旧（缺少模型/权限方法），请更新 dsh-obsidian-bridge 并重启 DSH 服务',
						);
					}
					return pong.version;
				}
				throw new NativeBridgeError(
					'version',
					'桥版本过旧（' + String(pong.version) + '，需要 v2+）',
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

	async subscribe(
		target: string | NativeSubagentAddress,
	): Promise<{ ok: boolean; sessionId: string; revision: number }> {
		return this.call('subscribe', [target]);
	}

	async unsubscribe(): Promise<{ ok: boolean }> {
		return this.call('unsubscribe');
	}

	async snapshot(): Promise<NativeChatSnapshot> {
		return this.call<NativeChatSnapshot>('snapshot');
	}

	/** 长轮询：结构或 live 变化立即返回；超时返回 changed=false。 */
	async nextEvent(
		cursor: number,
		timeoutMs = POLL_TIMEOUT_MS,
		liveCursor?: number,
	): Promise<NativeEvent> {
		const args = liveCursor === undefined ? [cursor, timeoutMs] : [cursor, timeoutMs, liveCursor];
		return this.call<NativeEvent>('nextEvent', args, timeoutMs + 5000);
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

	async context(): Promise<NativeContextUsage> {
		return this.call<NativeContextUsage>('context');
	}

	/** Lead 会话的 Agent Teams 投影；未启用团队时返回 null。 */
	async team(): Promise<NativeTeamProjection | null> {
		return this.call<NativeTeamProjection | null>('team');
	}

	/** 当前会话（或当前子会话的父会话）的直接子代理目录；桥 v7。 */
	async subagents(): Promise<NativeSubagentList> {
		return this.call<NativeSubagentList>('subagents');
	}

	/** 当前会话的目标（dsh goal 投影）；没有目标或投影不可用时为 null。桥 v8。 */
	async goal(): Promise<NativeGoal | null> {
		return this.call<NativeGoal | null>('goal');
	}

	/** 目标操作：暂停 / 恢复 / 编辑（value = 新目标）/ 清除。桥 v8。 */
	async goalAction(
		action: 'edit' | 'pause' | 'resume' | 'clear',
		value?: string,
	): Promise<NativeGoalActionResult> {
		const args = value === undefined ? [action] : [action, value];
		return this.call<NativeGoalActionResult>('goalAction', args);
	}

	/** 宿主命令目录（"/" 菜单从这里判断 new / compact / skills 是否真的存在）。 */
	async commands(): Promise<NativeCommand[]> {
		const value = await this.call<{ commands: NativeCommand[] }>('commands');
		return Array.isArray(value?.commands) ? value.commands : [];
	}

	/** 当前会话的人类可调用技能目录（"/skills" 二级列表）。 */
	async skills(): Promise<NativeSkill[]> {
		const value = await this.call<{ skills: NativeSkill[] }>('skills');
		return Array.isArray(value?.skills) ? value.skills : [];
	}

	/** 提交一条命令行（例如 "/compact"）；宿主未注册该命令时 matched=false。 */
	async executeCommand(
		line: string,
	): Promise<{ matched: boolean; result: NativeCommandResult }> {
		return this.call<{ matched: boolean; result: NativeCommandResult }>('executeCommand', [
			line,
		]);
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
			throw new NativeBridgeError('version', 'dsh-obsidian-bridge 版本过旧（需要 v2+）');
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
			throw new NativeBridgeError('call-failed', errorText(error));
		}
		if (reply?.__dshNative !== true) {
			throw new NativeBridgeError('missing', '页面里没有 dsh-obsidian-bridge');
		}
		const version = typeof reply.version === 'number' ? reply.version : 0;
		if (version < 1) throw new NativeBridgeError('version', 'obsidian-bridge 版本信息缺失');
		if (reply.error !== undefined) {
			// 桥在 cleanup 与下一次 subscribe 之间会短暂处于未订阅态；归为可静默重试的过渡错误。
			const reason = reply.error.includes('尚未订阅会话') ? 'not-subscribed' : 'call-failed';
			throw new NativeBridgeError(reason, reply.error);
		}
		return { version, value: reply.value as T };
	}
}

/** 把桥错误翻译成可执行提示。 */
export function describeNativeBridgeError(error: unknown): string {
	if (!(error instanceof NativeBridgeError)) {
		return errorText(error);
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
