import { Notice, Plugin, addIcon, type WorkspaceLeaf } from 'obsidian';
import { DshServiceManager, type DshServiceOutcome } from './service/manager';
import { listDshCandidates, PATH_DSH_PLACEHOLDER, probeDshVersion, resolveDshInstall } from './service/locator';
import { clearOptionalCatalogCache, readOptionalCatalog } from './service/plugin-catalog';
import { listLocalSkillNames } from './service/skill-catalog';
import { setBundleEnabled as applyBundleEnabled } from './service/plugin-bundles';
import {
	clearPluginInventoryCache,
	profileDirOf,
	profilePatchPath,
	readPluginInventory,
} from './service/plugin-inventory';
import { togglePluginEnabled } from './service/plugin-patch';
import {
	mergeSettings,
	runStatusPlacementOf,
	type CommandScope,
	type DshPluginSettings,
	type MentionScope,
	type RunStatusPlacement,
	type SkillScope,
	type StreamRefreshMode,
} from './settings/schema';
import type { SettingsHost } from './settings/context';
import { DshSettingTab } from './settings/tab';
import { dshWhaleIconSvg } from './shared/brand';
import { errorText } from './shared/errors';
import { LEGACY_VIEW_TYPE_DSH, VIEW_TYPE_NATIVE_CHAT } from './shared/constants';
import { createDshProbe, vaultPath } from './shared/host';
import { logPlugin, logPluginWarn } from './shared/log';
import type {
	DshBridgeStatus,
	DshCommand,
	DshInstall,
	DshOptionalCatalog,
	DshPluginInventory,
	DshPluginRow,
	DshPluginRowState,
	DshRuntimeInfo,
} from './shared/types';
import { DshNativeChatView } from './view/native/native-chat-view';
import { findNativeChat, openNativeChat } from './view/open';
import type { DshPanelHost } from './view/panel-host';

/**
 * DSH in Obsidian — 方案 B：自动拉起独立的 dsh 服务 + Obsidian 原生聊天面板。
 *
 * 服务：dsh --profile obsidian --port <port>，工作目录 = 当前 vault。
 *  - 独立 profile：与日常用的 web profile（:3080）互不干扰；
 *  - 独立端口（默认 3081）：两个 GUI 可同时运行；
 *  - 工作目录 = vault：dsh 的 workspace / 会话 / AGENTS.md 都落在笔记库上。
 *
 * 0008 起不再有可见的官方 webview 面板：原生聊天视图是唯一入口，
 * 内部保留一个离屏的官方 core webview（dsh-obsidian-bridge v3 的数据源）。
 *
 * 进程生命周期由插件托管：检测到端口未监听 → spawn；插件卸载 → 杀掉自启进程
 * （用户自己启动的实例不会被杀）。
 *
 * 本文件是**组合根**：只做注册与装配，业务逻辑分层在
 *   service/  dsh 进程托管（locator / probe / manager）
 *   view/     原生聊天、承载面、页面桥（surface / native / open）
 *   settings/ 配置与设置页（schema / tab）
 *   shared/   跨域基础件（constants / async / log / host）
 */
export default class DshInObsidianPlugin extends Plugin implements DshPanelHost, SettingsHost {
	settings!: DshPluginSettings;
	private service!: DshServiceManager;
	private statusBarItem!: HTMLElement;
	/** 实际使用的 dsh 信息（启动后由 manager 回调写入，供设置页显示）。 */
	private runtimeInfo: DshRuntimeInfo | null = null;
	/** 版本冲突提示每次插件加载只弹一次。 */
	private runtimeHintShown = false;
	/** 「指定的 dsh 不存在，已回退自动」提示每次加载只弹一次。 */
	private fallbackHintShown = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.service = new DshServiceManager({
			getConfig: () => ({
				port: this.settings.port,
				profile: this.settings.profile,
				dshPath: this.settings.dshPath,
			}),
			cwd: vaultPath(this.app),
			onStatus: (text) => this.setStatus(text),
			// 可信探测：用 Obsidian requestUrl 读状态码与正文，能区分「dsh 在跑」与「端口被占用」。
			probe: createDshProbe(),
			// 实际使用的 dsh 路径 / 版本；版本冲突时给一次可见提示（M2-5）。
			onRuntime: (info) => this.handleRuntime(info),
		});

		// 标签页 / ribbon 用 DSH 鲸鱼图标（单色，跟随主题）。
		addIcon('dsh-whale', dshWhaleIconSvg());

		// 唯一的聊天视图：原生 UI + 离屏官方 core。
		this.registerView(VIEW_TYPE_NATIVE_CHAT, (leaf) => new DshNativeChatView(this, leaf));

		// 升级迁移：旧的 dsh-web leaf 改为原生面板；恢复布局时去重原生视图。
		this.app.workspace.onLayoutReady(() => {
			this.migrateLegacyPanel();
			this.dedupeNativeLeaves();
		});
		// 布局恢复可能在 onLayoutReady 之后才完成；延迟再兜一次，避免恢复出两个原生 leaf。
		const dedupeTimer = window.setTimeout(() => this.dedupeNativeLeaves(), 1500);
		this.register(() => window.clearTimeout(dedupeTimer));

		// ribbon 图标（只保留一个入口；新建会话在面板内）
		this.addRibbonIcon('dsh-whale', '打开 DeepSeek Harness', () => {
			void this.openNativeChatView();
		});

		// 命令面板（open-dsh-view 的 id 保持不变，避免破坏用户快捷键）
		this.addCommand({
			id: 'open-dsh-view',
			name: '打开 DeepSeek Harness',
			callback: () => {
				void this.openNativeChatView();
			},
		});
		this.addCommand({
			id: 'restart-dsh-service',
			name: '重启 DSH 服务',
			callback: () => {
				void this.restartService();
			},
		});

		// 状态栏：点击也可打开聊天
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('DSH: …');
		this.statusBarItem.addClass('dsh-status');
		this.statusBarItem.onclick = () => void this.openNativeChatView();

		// 设置页
		this.addSettingTab(new DshSettingTab(this.app, this));

		// 自动拉起服务
		if (this.settings.autoStart) {
			void this.ensureStarted();
		}
	}

	onunload(): void {
		// 只杀自己拉起的进程
		this.service?.stop();
	}

	/** DshPanelHost：承载面用地址（0.2.x 为带 token 的启动 URL）。 */
	get embedUrl(): string {
		return this.service.embedUrl;
	}

	/**
	 * DshPanelHost：插件专用 webview 分区。
	 *
	 * 0008 起不再与 Obsidian 核心 Web viewer / Canvas 共用 persist:vault-*：
	 * 否则任何核心 webview 打开同一地址都能复用 dsh 的登录 cookie。
	 * 用持久化分区是为了重开面板时不必重新 token 登录；它仍与其它插件隔离。
	 */
	get webviewPartition(): string | null {
		return 'persist:dsh-obsidian';
	}

	/** DshPanelHost：端口上是否有服务在响应。 */
	isRunning(): Promise<boolean> {
		return this.service.isReachable();
	}

	/** DshPanelHost：确保服务在跑（面板打开时调用）。 */
	ensureStarted(): Promise<boolean> {
		return this.ensureDsh();
	}

	/** SettingsHost：实际使用的 dsh 信息（设置页「运行环境」）。 */
	getRuntimeInfo(): DshRuntimeInfo | null {
		return this.runtimeInfo;
	}

	/** SettingsHost：检测到的 dsh 安装（设置页「dsh 版本」下拉，带版本号）。 */
	async detectDshInstalls(): Promise<DshInstall[]> {
		// 占位候选（PATH 上找不到 dsh 时的兜底启动方式）不作为可选版本展示。
		const installs = listDshCandidates().filter((install) => install.path !== PATH_DSH_PLACEHOLDER);
		return Promise.all(
			installs.map(async (install) => ({
				...install,
				version: await probeDshVersion(install.command),
			})),
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 重启服务：杀自启进程 → 重新拉起；原生面板打开时重载隐藏 core。 */
	async restartService(): Promise<void> {
		const outcome = await this.service.restart();
		this.reportOutcome(outcome, true);
		if (!outcome.ok) return;
		const view = findNativeChat(this.app);
		if (view === null) return;
		try {
			await view.reloadAfterRestart();
		} catch (error) {
			logPluginWarn('重启后重载原生面板失败: ' + errorText(error));
		}
	}

	/** DshPanelHost：设置页的流式刷新节奏（0021），面板打开时每次轮询读取。 */
	getStreamRefresh(): StreamRefreshMode {
		return this.settings.streamRefresh;
	}

	/** DshPanelHost：运行提示位置（0048），面板每次渲染读取，运行中切换即时生效。 */
	getRunStatusPlacement(): RunStatusPlacement {
		return runStatusPlacementOf(this.settings.runStatusPlacement);
	}

	/** DshPanelHost：「@」引用范围（0030），每次打开 @ 菜单时读取。 */
	getMentionScope(): MentionScope {
		return {
			mode: this.settings.mentionScope,
			allow: this.settings.mentionWhitelist,
			deny: this.settings.mentionBlacklist,
		};
	}

	/** DshPanelHost：「/」技能范围（0037），每次打开 / 菜单时读取；只影响菜单显示。 */
	getSkillScope(): SkillScope {
		return {
			mode: this.settings.skillScope,
			allow: this.settings.skillWhitelist,
			deny: this.settings.skillBlacklist,
		};
	}

	/** DshPanelHost：「/」命令范围（0050），每次打开 / 菜单时读取；只影响菜单显示。 */
	getCommandScope(): CommandScope {
		return {
			mode: this.settings.commandScope,
			allow: this.settings.commandWhitelist,
			deny: this.settings.commandBlacklist,
		};
	}

	/** SettingsHost：本地技能目录里的技能名（0038，设置页「/」技能范围的「选取」按钮）。 */
	getSkillCandidates(): Promise<string[]> {
		return listLocalSkillNames(vaultPath(this.app));
	}

	/** SettingsHost：「/」命令范围的候选（0051，从原生面板的桥取当前会话命令目录）。 */
	async getCommandCandidates(): Promise<string[]> {
		const view = findNativeChat(this.app);
		if (view === null) return [];
		return view.listCommandNames();
	}

	/** SettingsHost：原生聊天隐藏 core 的页面桥状态。 */
	getBridgeStatus(): Promise<DshBridgeStatus> {
		const view = findNativeChat(this.app);
		if (view === null) return Promise.resolve({ state: 'panel-closed' });
		return view.probeBridge();
	}

	/** SettingsHost：profile 的组合插件清单（0031，设置页「插件」tab）。 */
	getPluginInventory(refresh = false): Promise<DshPluginInventory> {
		return this.inventoryOptions().then((options) => readPluginInventory({ ...options, refresh }));
	}

	/** SettingsHost：启停一个组件行（写 profile 用户层 patch，重启服务后生效）。 */
	async setPluginEnabled(row: Pick<DshPluginRow, 'id' | 'name'>, enabled: boolean): Promise<void> {
		const options = await this.inventoryOptions();
		const expected: DshPluginRowState = enabled ? 'on' : 'off';
		const result = await togglePluginEnabled({
			patchPath: profilePatchPath(options.profile),
			id: row.id,
			enabled,
			// 写后复验：重新组合一次，确认这一行真的按预期变了（不一致就回滚）。
			verify: async (): Promise<boolean> => {
				const inventory = await readPluginInventory({ ...options, refresh: true });
				const current = inventory.bundles
					.flatMap((bundle) => bundle.rows)
					.find((item) => item.id === row.id);
				return current !== undefined && current.state === expected;
			},
		});
		clearPluginInventoryCache();
		if (!result.changed) throw new Error(result.message ?? '没有可写入的改动');
		if (result.rolledBack) throw new Error(result.message ?? '写入后复验失败，已回滚');
		logPlugin(
			'插件启停：' +
				row.id +
				' → ' +
				(enabled ? '启用' : '停用') +
				(result.backupPath === null ? '' : '（备份 ' + result.backupPath + '）'),
		);
	}

	/** SettingsHost：「可选 / 实验性插件」目录（0032）。 */
	getOptionalCatalog(refresh = false): Promise<DshOptionalCatalog> {
		return this.inventoryOptions().then((options) =>
			readOptionalCatalog({ command: options.command, profile: options.profile, refresh }),
		);
	}

	/** SettingsHost：启用 / 停用可选 bundle（写 profile 的 dsh.profile.bundles，重启后生效）。 */
	async setBundleEnabled(name: string, enabled: boolean): Promise<void> {
		const options = await this.inventoryOptions();
		const catalog = await readOptionalCatalog({
			command: options.command,
			profile: options.profile,
			refresh: true,
		});
		// 只允许动目录里的可选 bundle：dsh-base / dsh-web-app / 桥等基础层不能被这里误删。
		if (!catalog.bundles.some((bundle) => bundle.name === name)) {
			throw new Error('不在可选插件目录里，不能在这里改：' + name);
		}
		const result = await applyBundleEnabled({
			profileDir: profileDirOf(options.profile),
			name,
			enabled,
			// 写后复验：重新组合一次，确认 bundle 层真的被带进 / 移出了组合结果。
			verify: async (): Promise<boolean> => {
				const inventory = await readPluginInventory({ ...options, refresh: true });
				return inventory.bundles.some((bundle) => bundle.name === name) === enabled;
			},
		});
		clearOptionalCatalogCache();
		clearPluginInventoryCache();
		if (!result.changed) throw new Error(result.message ?? '没有可写入的改动');
		if (result.rolledBack) throw new Error(result.message ?? '写入后复验失败，已回滚');
		logPlugin(
			'插件包启停：' + name + ' → ' + (enabled ? '启用' : '停用') + '（备份 ' + (result.backupPath ?? '无') + '）',
		);
	}

	/** 插件清单 / 启停共用的解析结果（与服务启动用同一份 dsh 与 profile）。 */
	private async inventoryOptions(): Promise<{ command: DshCommand; profile: string; cwd: string }> {
		const resolved = resolveDshInstall(this.settings.dshPath);
		if (resolved === null) throw new Error('找不到可用的 dsh 可执行文件');
		return {
			command: resolved.install.command,
			profile: this.settings.profile,
			cwd: vaultPath(this.app),
		};
	}

	private async openNativeChatView(): Promise<void> {
		await openNativeChat(this.app);
	}

	private async ensureDsh(): Promise<boolean> {
		return this.reportOutcome(await this.service.start(), false);
	}

	/** 把 service 的结果翻译成用户可见的 Notice，返回服务是否可用。 */
	private reportOutcome(outcome: DshServiceOutcome, fromRestart: boolean): boolean {
		if (outcome.ok) {
			if (fromRestart) new Notice('DSH 服务已重启');
			return true;
		}
		if (outcome.reason === 'locator') {
			new Notice('DSH：无法定位 dsh 可执行文件，请确认已安装');
		} else if (outcome.reason === 'exited') {
			new Notice('DSH 进程提前退出（退出码 ' + String(outcome.exitCode) + '）。详见开发者控制台 [dsh] 日志');
		} else if (outcome.reason === 'occupied') {
			new Notice(
				'DSH：端口 ' + String(this.settings.port) + ' 已被其他程序占用，请在设置里换端口后重启服务',
			);
		} else if (outcome.reason === 'auth') {
			new Notice(
				'DSH：端口上的 dsh 需要 token，插件无法接管（通常是上次遗留的实例）。请先结束它（pkill -f "dsh --profile ' +
					this.settings.profile +
					'"），再点「重启服务」',
				15000,
			);
		} else if (outcome.reason === 'unsupported') {
			new Notice(
				'DSH：端口 ' +
					String(this.settings.port) +
					' 上是 0.1.x 或不带 token 鉴权的实例，本插件只支持 0.2.x；请先结束它（pkill -f "dsh --profile ' +
					this.settings.profile +
					'"），再点「重启服务」',
				15000,
			);
		}
		if (fromRestart) new Notice('DSH 服务重启失败');
		return false;
	}

	/**
	 * 记录运行信息。
	 * - 明确指定了 dsh 版本时不弹冲突提示（选择权在用户，设置页/日志仍可查）；
	 * - 自动模式下发现版本不同的其他安装时提示一次（避免每次打开聊天重复打扰）；
	 * - 指定的安装未检测到时提示一次「已回退自动」。
	 */
	private handleRuntime(info: DshRuntimeInfo): void {
		this.runtimeInfo = info;
		if (info.fallback && !this.fallbackHintShown) {
			this.fallbackHintShown = true;
			new Notice('DSH：设置里选择的 dsh 未检测到，已回退到自动解析：' + info.used.path, 10000);
		}
		if (this.settings.dshPath !== null || this.runtimeHintShown || info.others.length === 0) return;
		this.runtimeHintShown = true;
		const others = info.others.map((install) => install.version ?? '未知').join('、');
		const prefix = info.confirmed ? '当前使用 dsh ' : '插件将使用 dsh ';
		new Notice(
			'DSH：' + prefix + (info.used.version ?? '未知') + '，另发现版本 ' + others + '。可在设置页「dsh 版本」切换',
			10000,
		);
	}

	/** 把旧版可见 webview 面板的 leaf 迁移为原生视图（0008）。 */
	private migrateLegacyPanel(): void {
		const legacy: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			let type: string;
			try {
				type = leaf.getViewState().type;
			} catch {
				return;
			}
			if (type === LEGACY_VIEW_TYPE_DSH) legacy.push(leaf);
		});
		if (legacy.length === 0) return;
		logPlugin('迁移旧 DSH 面板为原生聊天: ' + String(legacy.length) + ' 个');
		for (const leaf of legacy) leaf.detach();
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_NATIVE_CHAT).length === 0) {
			void openNativeChat(this.app);
		}
	}

	/** 恢复布局时可能留下多个原生 leaf；只保留当前激活的那个（正常运行时 openNativeChat 已防重）。 */
	private dedupeNativeLeaves(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_NATIVE_CHAT);
		if (leaves.length <= 1) return;
		const active = this.app.workspace.activeLeaf;
		const keep = leaves.find((leaf) => leaf === active) ?? leaves[0];
		for (const leaf of leaves) {
			if (leaf !== keep) leaf.detach();
		}
	}

	private setStatus(text: string): void {
		if (this.statusBarItem) this.statusBarItem.setText('DSH: ' + text);
	}
}
