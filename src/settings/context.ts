import type { App } from 'obsidian';
import type {
	DshActionResult,
	DshBridgeStatus,
	DshInstall,
	DshOptionalCatalog,
	DshPluginInventory,
	DshPluginRow,
	DshRuntimeInfo,
	DshStopResult,
} from '../shared/types';
import type { DshPluginSettings } from './schema';

/** 设置页需要的最小宿主能力（由插件实现）。 */
export interface SettingsHost {
	settings: DshPluginSettings;
	saveSettings(): Promise<void>;
	/** 重启服务；结果交给调用方就地展示（0056：进度 / 成功 / 失败 + 下一步建议）。 */
	restartService(): Promise<DshActionResult>;
	/** 结束后台 dsh：插件自拉进程 + 占用配置端口的遗留 dsh（0056）。 */
	stopBackgroundService(): Promise<DshStopResult>;
	/** 实际使用的 dsh（路径 / 版本 / 其他版本安装）；尚未拉起时返回 null。 */
	getRuntimeInfo(): DshRuntimeInfo | null;
	/** 检测到的 dsh 安装（带版本），供「dsh 版本」下拉与「运行环境」展示。 */
	detectDshInstalls(): Promise<DshInstall[]>;
	/** 页面桥（dsh-obsidian-bridge）状态；原生聊天面板未打开时返回对应状态。 */
	getBridgeStatus(): Promise<DshBridgeStatus>;
	/** 本地技能目录里的技能名（0038：白 / 黑名单「选取」按钮的候选）；读取失败返回空数组。 */
	getSkillCandidates(): Promise<string[]>;
	/** 当前会话的 dsh 命令名（0051：命令范围「选取」的候选）；原生面板未打开/未连接时返回空数组。 */
	getCommandCandidates(): Promise<string[]>;
	/** profile 的组合插件清单（0031）；`refresh` 跳过缓存。 */
	getPluginInventory(refresh?: boolean): Promise<DshPluginInventory>;
	/** 启停一个组件行：写 profile 用户层 patch，重启服务后生效（0031）。 */
	setPluginEnabled(row: Pick<DshPluginRow, 'id' | 'name'>, enabled: boolean): Promise<void>;
	/** 「可选 / 实验性插件」目录（0032）；`refresh` 跳过缓存。 */
	getOptionalCatalog(refresh?: boolean): Promise<DshOptionalCatalog>;
	/** 启用 / 停用可选 bundle：写 profile 的 `dsh.profile.bundles`，重启服务后生效（0032）。 */
	setBundleEnabled(name: string, enabled: boolean): Promise<void>;
}

/**
 * 单个设置模块的渲染上下文（0027）。
 *
 * 模块只能通过这个窄接口访问宿主与 app，不直接拿 Plugin 实例；
 * 异步模块在 `await` 之后必须先检查 `isStale()`，否则快速切 tab / 连点「重新检测」时
 * 旧结果会写进已经换掉的内容区。
 */
export interface SettingsRenderContext {
	host: SettingsHost;
	app: App;
	/** 本次渲染是否已被后续渲染取代。 */
	isStale(): boolean;
	/** 请求重绘当前模块（「重新检测」这类按钮用；不会重建 tab 条）。 */
	refresh(): void;
}
