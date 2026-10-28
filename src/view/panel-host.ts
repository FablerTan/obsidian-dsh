import type {
	CommandScope,
	MentionScope,
	RunStatusPlacement,
	SkillScope,
	StreamRefreshMode,
} from '../settings/schema';

/**
 * 原生聊天面板需要的最小宿主能力（由插件实现）。
 *
 * 面板只依赖这个窄接口，避免反向 import main.ts 或插件实例。
 * 可见的官方 webview 面板删除后（0008），这里只保留隐藏 core 与进程生命周期所需的成员。
 */
export interface DshPanelHost {
	/** 承载面用地址：dsh 0.2.x 带一次性登录 token；未就绪时为裸地址。 */
	readonly embedUrl: string;
	/** 插件专用 webview 分区；取不到时为 null（使用默认会话）。 */
	readonly webviewPartition: string | null;
	/** 插件拉起的 dsh 是否已就绪。 */
	isRunning(): Promise<boolean>;
	/** 确保服务在跑（原生面板打开时调用）。 */
	ensureStarted(): Promise<boolean>;
	/** 重启插件自启的 dsh 服务（原生面板错误页使用）。 */
	restartService(): Promise<void>;
	/** 当前设置里的流式刷新节奏（0021）；面板打开期间切换需即时生效。 */
	getStreamRefresh(): StreamRefreshMode;
	/** 当前设置里的运行提示位置（0048）；面板每次渲染读取，运行中切换即时生效。 */
	getRunStatusPlacement(): RunStatusPlacement;
	/** 当前设置里的「@」引用范围（0030）；每次打开 @ 菜单时读取，切设置后下一次打开生效。 */
	getMentionScope(): MentionScope;
	/** 当前设置里的「/」技能范围（0037）；只影响菜单显示，每次打开 / 菜单时读取。 */
	getSkillScope(): SkillScope;
	/** 当前设置里的「/」命令范围（0050）；只影响菜单显示，每次打开 / 菜单时读取。 */
	getCommandScope(): CommandScope;
}
