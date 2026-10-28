import type { ReactNode } from 'react';
import type {
	NativeCommand,
	NativeContextUsage,
	NativeModels,
	NativeNote,
	NativePermissions,
	NativeSkill,
} from '../../../shared/native-types';
import type { CommandScope, SkillScope } from '../../../settings/schema';
import type { MentionEntry } from '../mention';
import type { SelectionQuote } from '../quote';

export interface ComposerProps {
	/** 非 null = 只读（一次性 / 类型未知 / 父会话不可用的子会话）：不显示输入框，只保留停止。 */
	readOnly: string | null;
	currentNote: NativeNote | null;
	/** 打开菜单时取一次 vault 快照；按键过滤只在这份快照上跑。 */
	listEntries: () => MentionEntry[];
	models: NativeModels | null;
	permissions: NativePermissions | null;
	context: NativeContextUsage | null;
	contextOpen: boolean;
	onContext: (anchor: DOMRect) => void;
	/** 0048：运行提示是否显示在输入框上方（false = 放在消息流最下方）。 */
	showRunStatus: boolean;
	/** 0047：本轮开始时间（根组件持有，切换显示位置时计时不归零）。 */
	runStartedAt: number | null;
	running: boolean;
	busy: boolean;
	ready: boolean;
	draft: string;
	onDraft: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	onModel: (anchor: DOMRect) => void;
	onPermission: (anchor: DOMRect) => void;
	onExplainSettings: () => void;
	/** 桥 v5 是否可用：命令 / 技能目录依赖它。 */
	commandsAvailable: boolean;
	/** 0050：当前会话是否显示 dsh 命令组（子会话跟随官方隐藏）。 */
	showCommands: boolean;
	/** "/new"：新建会话并切换（复用根组件的 createSession）。 */
	onNewSession: () => void;
	/** 取当前会话的 dsh 命令目录（失败时抛错，菜单里显示原因）；打开 "/" 菜单时刷新。 */
	loadCommands: () => Promise<NativeCommand[]>;
	/** 执行一条 dsh 命令行（根组件走 bridge.executeCommand）；错误由根组件报出。 */
	onRunCommand: (line: string) => Promise<void>;
	/** 取当前会话的技能目录（失败时抛错，菜单里显示原因）；打开 "/" 菜单时拉一次。 */
	loadSkills: () => Promise<NativeSkill[]>;
	/** 设置页的「/」技能范围（0037）；打开菜单时读一次，只过滤菜单里的技能行。 */
	getSkillScope: () => SkillScope;
	/** 设置页的「/」命令范围（0050）；打开菜单时读一次，只过滤菜单里的命令行。 */
	getCommandScope: () => CommandScope;
	pending: ReactNode;
	/** 0052：输入框上方的目标条（有目标时由根组件传入，无目标为 null）。 */
	goalBar: ReactNode;
	/** 0058：点输入卡 / 输入框时捕获的选区引用；null = 本次不引用。 */
	quote: SelectionQuote | null;
	/** 0058：设置页的摘录上限（预览与实际发送共用）。 */
	quoteLimit: number;
	/** 0058：输入卡 mousedown / 输入框 focus 时抓选区快照（必须在失焦前）。 */
	onCaptureQuote: () => void;
	/** 0060：点预览条跳回笔记并选中高亮（与点引用卡一致）。 */
	onOpenQuote: () => void;
	/** 0058：点 × 本次不引用（同一选区不再自动带回）。 */
	onClearQuote: () => void;
}
