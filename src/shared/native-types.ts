/** 原生聊天桥（dsh-obsidian-bridge v2/v3）的 DTO 契约。 */

export interface NativeSessionSummary {
	id: string;
	title: string;
	cwd: string | null;
	running: boolean;
	blank: boolean;
	updatedAt: number | null;
}

export interface NativeSessionList {
	phase: string | null;
	sessions: NativeSessionSummary[];
}

export interface NativeChatNode {
	key: string;
	id: string;
	kind: string;
	anchorSeq: number | null;
	turn: number | null;
	step: number | null;
	visibility: string;
	data: unknown;
}

export interface NativeQuestionItem {
	id: string;
	question: string;
	detail?: string;
	header?: string;
	options?: Array<{ label: string; description?: string }>;
	multiSelect?: boolean;
	intent?: unknown;
}

export interface NativePendingApproval {
	kind: 'approval';
	key: string;
	sessionId: string;
	toolName: string;
	callId: string | null;
	reason: string | null;
	displayReason: unknown;
	answerable: boolean;
}

export interface NativePendingQuestion {
	kind: 'question' | 'plan-review';
	key: string;
	sessionId: string;
	callId: string | null;
	questions: NativeQuestionItem[];
	review: unknown;
	dismissal: string | null;
	state: string;
	countdown: unknown;
}

export type NativePending =
	| NativePendingApproval
	| NativePendingQuestion
	| ({ kind: string; key: string; sessionId: string } & Record<string, unknown>);

export interface NativeChatSnapshot {
	revision: number;
	sessionId: string;
	title: string;
	session: Record<string, unknown>;
	order: string[];
	nodes: NativeChatNode[];
	navigation: unknown[];
	timeline: unknown;
	pending: NativePending | null;
}

export interface NativeModelSelection {
	provider: string;
	model: string;
	reasoningEffort?: string;
}

export interface NativeModelEffort {
	id: string;
	name: string;
	description?: string;
}

export interface NativeModelReasoning {
	efforts: NativeModelEffort[];
	defaultEffort?: string;
}

export interface NativeModel {
	id: string;
	name: string;
	description?: string;
	reasoning?: NativeModelReasoning;
}

export interface NativeModelGroup {
	id: string;
	name: string;
	models: NativeModel[];
}

export interface NativeModelFailure {
	id: string;
	name: string;
	message: string;
}

export interface NativeModels {
	current: NativeModelSelection | null;
	routable: boolean;
	groups: NativeModelGroup[];
	failures: NativeModelFailure[];
}

export interface NativePermissionOption {
	value: string;
	name: string;
	description?: string;
}

export interface NativePermissions {
	currentValue: string;
	options: NativePermissionOption[];
}

export interface NativeNote {
	/** vault 相对路径。 */
	path: string;
	name: string;
}

/** 桥 v5：宿主命令目录的一项（"/" 菜单里对照的命令）。 */
export interface NativeCommand {
	name: string;
	description: string;
}

/** 桥 v5：当前会话可见的人类可调用技能（"/skills" 二级列表）。 */
export interface NativeSkill {
	name: string;
	description: string;
	/** false = 只给用户调用（不进模型技能目录）。 */
	modelInvocable: boolean;
}

/** 桥 v5：一条命令行的执行结果（宿主 CommandResult 的投影）。 */
export interface NativeCommandResult {
	kind: 'success' | 'error';
	/** 宿主的提示文本；成功且无文本时为 null。 */
	text: string | null;
}

/** 桥 v5：宿主命令目录的一项（"/" 菜单里对照的命令）。 */
export interface NativeCommand {
	name: string;
	description: string;
}

/** 桥 v5：当前会话可见的人类可调用技能（"/skills" 二级列表）。 */
export interface NativeSkill {
	name: string;
	description: string;
	/** false = 只给用户调用（不进模型技能目录）。 */
	modelInvocable: boolean;
}

/** 桥 v5：一条命令行的执行结果（宿主 CommandResult 的投影）。 */
export interface NativeCommandResult {
	kind: 'success' | 'error';
	/** 宿主的提示文本；成功且无文本时为 null。 */
	text: string | null;
}

/** 桥 v3 的流式快照：与 AssistantChatData.blocks 同形，由原生端渲染成一条运行中的 assistant-step。 */
export interface NativeChatLiveBlock {
	kind: string;
	text?: string;
	callId?: string;
	name?: string;
	argsRaw?: string;
}

export interface NativeChatLive {
	turn: number;
	step: number;
	attemptId: string | null;
	blocks: NativeChatLiveBlock[];
}

/** 上下文占用：provider 报的最近一次请求压力 + 下一次请求的构成估算（桥 v4）。 */
export interface NativeContextPressure {
	pressureTokens?: number;
	projectedTokens?: number;
	contextWindow?: number;
}

export interface NativeContextBreakdown {
	systemTokens: number;
	toolsTokens: number;
	messageTokens: number;
}

export interface NativeContextUsage {
	pressure: NativeContextPressure | null;
	breakdown: NativeContextBreakdown | null;
}

export interface NativeEvent {
	cursor: number;
	changed: boolean;
	/** 桥 v3 的 live 游标；旧桥不返回（undefined），原生端据此关闭流式分支。 */
	liveCursor?: number;
	live?: NativeChatLive | null;
}

/** 桥 v6：Agent Teams 成员行（持久投影 + 会话状态拼合）。 */
export interface NativeTeamMember {
	id: string;
	name: string;
	role: 'lead' | 'teammate';
	phase: 'provisioning' | 'active' | 'failed';
	error?: string;
	/** 当前是否有轮次在执行（来自会话状态，回退会话列表摘要）。 */
	running: boolean;
	/** 是否有等待处理的授权 / 提问（原生面板只提示，B 路径不导航到成员会话）。 */
	pendingInteraction: boolean;
	/** 该成员最近选择的模型 id；冷缓存时缺失。 */
	model: string | null;
}

/** 桥 v6：共享任务板的一行（服务端的只读视图，已去掉 deleted tombstone）。 */
export interface NativeTeamTask {
	id: string;
	revision: number;
	subject: string;
	description: string;
	status: 'pending' | 'in_progress' | 'completed';
	blockedBy: string[];
	writeScopes: string[];
	ownerName?: string;
	ready: boolean;
	writeScopeWarnings: string[];
}

/** 桥 v6：Lead 会话的 agentTeam 投影；未启用「智能体团队」时为 null。 */
export interface NativeTeamProjection {
	members: NativeTeamMember[];
	tasks: NativeTeamTask[];
	failure?: string;
}

export type NativeBridgeErrorReason =
	| 'panel-closed'
	| 'missing'
	| 'version'
	| 'timeout'
	| 'call-failed'
	| 'not-subscribed';

export class NativeBridgeError extends Error {
	constructor(
		readonly reason: NativeBridgeErrorReason,
		message: string,
	) {
		super(message);
		this.name = 'NativeBridgeError';
	}
}

/** 提问答案：与 dsh 的 AskUserQuestionAnswer 同形。 */
export interface NativeQuestionAnswerItem {
	id: string;
	selected: string[];
	custom?: string;
}

export interface NativeQuestionAnswer {
	answers: NativeQuestionAnswerItem[];
}
