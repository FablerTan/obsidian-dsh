/** 原生聊天桥（dsh-obsidian-bridge v2）的 DTO 契约。 */

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

export interface NativeEvent {
	cursor: number;
	changed: boolean;
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
