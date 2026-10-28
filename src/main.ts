import { Notice, Plugin, addIcon, type WorkspaceLeaf } from 'obsidian';
import { DshServiceManager, type DshServiceOutcome, type DshStopOutcome } from './service/manager';
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
	quoteExcerptLimitOf,
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
import { LEGACY_VIEW_TYPE_DSH, VIEW_TYPE_NATIVE_CHAT, WEBVIEW_PARTITION } from './shared/constants';
import { createDshProbe, vaultPath } from './shared/host';
import { logPlugin, logPluginWarn } from './shared/log';
import type {
	DshActionResult,
	DshBridgeStatus,
	DshCommand,
	DshInstall,
	DshOptionalCatalog,
	DshPluginInventory,
	DshPluginRow,
	DshPluginRowState,
	DshRuntimeInfo,
	DshStopResult,
} from './shared/types';
import { DshNativeChatView } from './view/native/native-chat-view';
import { findNativeChat, openNativeChat } from './view/open';
import type { DshPanelHost } from './view/panel-host';

/**
 * DSH Native Chat — 方案 B：自动拉起独立的 dsh 服务 + Obsidian 原生聊天面板。
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
	/** 正在进行中的重启（去重：命令面板 / 设置页连点不会并发 stop 两次，0056）。 */
	private restarting: Promise<DshActionResult> | null = null;

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
				void this.restartFromCommand();
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
		return WEBVIEW_PARTITION;
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

	/**
	 * SettingsHost / DshPanelHost：重启服务。
	 *
	 * 不弹 Notice：设置页用返回值在行下就地显示进度与结果（0056），命令面板由
	 * restartFromCommand 统一提示。原生面板打开时重载隐藏 core，但**不阻塞**返回值
	 * （重载要等页面 + 桥就绪，最长 25s；面板自己的 ensureReady 有并发去重）。
	 */
	restartService(): Promise<DshActionResult> {
		if (this.restarting === null) {
			this.restarting = this.doRestart().finally(() => {
				this.restarting = null;
			});
		}
		return this.restarting;
	}

	private async doRestart(): Promise<DshActionResult> {
		const started = Date.now();
		const outcome = await this.service.restart();
		const result = this.describeOutcome(outcome, Date.now() - started);
		if (outcome.ok) void this.reloadPanelAfterRestart();
		return result;
	}

	/** SettingsHost：结束后台 dsh（插件自拉进程 + 占用端口的遗留 dsh）；结果交设置页就地展示。 */
	async stopBackgroundService(): Promise<DshStopResult> {
		// 先等正在进行的重启收敛，避免「边起边杀」。
		if (this.restarting !== null) await this.restarting.catch((): undefined => undefined);
		const started = Date.now();
		const outcome = await this.service.stopBackground();
		return this.describeStop(outcome, Date.now() - started);
	}

	/** 命令面板入口：没有设置页的就地状态，用一条常驻 Notice 显示进行中，结束后换成结果。 */
	private async restartFromCommand(): Promise<void> {
		const pending = new Notice('DSH：正在重启服务…', 0);
		try {
			const result = await this.restartService();
			pending.hide();
			new Notice(this.actionText(result), result.ok ? 8000 : 15000);
		} catch (error) {
			// 常驻 Notice 必须收掉，否则会一直挂在窗口上。
			pending.hide();
			new Notice('DSH：重启服务失败 — ' + errorText(error), 15000);
		}
	}

	private async reloadPanelAfterRestart(): Promise<void> {
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

	/** DshPanelHost：选区引用摘录上限（0058），发送 / 预览引用时读取。 */
	getQuoteExcerptLimit(): number {
		return quoteExcerptLimitOf(this.settings.quoteExcerptLimit);
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
		const started = Date.now();
		const result = this.describeOutcome(await this.service.start(), Date.now() - started);
		// 面板打开 / 自动启动失败时给一条可操作的 Notice（成功不打扰）。
		if (!result.ok) new Notice(this.actionText(result), 15000);
		return result.ok;
	}

	/** 把 manager 的启动结果翻译成一行文案 + 下一步建议（0056：就地反馈与 Notice 共用）。 */
	private describeOutcome(outcome: DshServiceOutcome, elapsedMs: number): DshActionResult {
		const port = String(this.settings.port);
		const seconds = (elapsedMs / 1000).toFixed(1);
		if (outcome.ok) {
			return {
				ok: true,
				message: outcome.alreadyRunning
					? '服务已在运行（端口 ' + port + '）'
					: '服务已重启（端口 ' + port + '，用时 ' + seconds + 's）',
				elapsedMs,
			};
		}
		switch (outcome.reason) {
			case 'locator':
				return {
					ok: false,
					message: '无法定位 dsh 可执行文件',
					hint: '确认已安装 dsh，并在「dsh 版本」里选中一份可用安装',
					elapsedMs,
				};
			case 'exited':
				return {
					ok: false,
					message: 'dsh 进程提前退出（退出码 ' + String(outcome.exitCode) + '）',
					hint: '详见开发者控制台 [dsh] 日志',
					elapsedMs,
				};
			case 'timeout':
				return {
					ok: false,
					message: '启动超时（20 秒内端口未就绪）',
					hint: '看控制台 [dsh] 日志确认是慢还是卡住；必要时点「结束后台 dsh」重来',
					elapsedMs,
				};
			case 'occupied':
				return {
					ok: false,
					message: '端口 ' + port + ' 已被其他程序占用',
					hint: '在「端口」里换一个端口后重启',
					elapsedMs,
				};
			case 'auth':
				return {
					ok: false,
					message: '端口 ' + port + ' 上是需要 token 的遗留 dsh，插件无法接管',
					hint: '先点「结束后台 dsh」，再点「重启服务」',
					elapsedMs,
				};
			case 'unsupported':
				return {
					ok: false,
					message: '端口 ' + port + ' 上是旧版 / 不带 token 鉴权的 dsh',
					hint: '先点「结束后台 dsh」，再点「重启服务」',
					elapsedMs,
				};
		}
	}

	/** 把「结束后台 dsh」的结果翻译成文案（0056）。 */
	private describeStop(outcome: DshStopOutcome, elapsedMs: number): DshStopResult {
		const port = String(this.settings.port);
		const seconds = (elapsedMs / 1000).toFixed(1);
		const pids = outcome.pids;
		if (outcome.ok) {
			let message: string;
			if (pids.length > 0) {
				message = '已结束后台 dsh（PID ' + pids.join('、') + '，用时 ' + seconds + 's）';
			} else if (outcome.stoppedOwn) {
				message = '已结束插件拉起的 dsh 服务（用时 ' + seconds + 's）';
			} else {
				message = '没有在运行的 dsh 服务（端口 ' + port + ' 空闲）';
			}
			return { ok: true, message, pids, stoppedOwn: outcome.stoppedOwn };
		}
		if (outcome.reason === 'foreign') {
			return {
				ok: false,
				message: '端口 ' + port + ' 被其他程序占用（不是 dsh），没有结束它',
				hint: '可以换个端口，或在系统里手动处理占用该端口的程序',
				pids,
				stoppedOwn: outcome.stoppedOwn,
			};
		}
		if (outcome.reason === 'timeout') {
			const stuck = outcome.stuck ?? [];
			return {
				ok: false,
				message:
					'已发送结束信号，但 dsh 仍在运行' +
					(stuck.length === 0 ? '' : '（PID ' + stuck.join('、') + '）'),
				hint: '再点一次「结束后台 dsh」；仍不行可在终端手动结束该进程',
				pids,
				stoppedOwn: outcome.stoppedOwn,
			};
		}
		return {
			ok: false,
			message: '端口 ' + port + ' 上是 dsh，但没找到可安全结束的进程',
			hint:
				'可手动结束：pkill -f "dsh --profile ' +
				this.settings.profile +
				'"（会结束同 profile 的所有实例）',
			pids,
			stoppedOwn: outcome.stoppedOwn,
		};
	}

	/** Notice / 就地反馈统一前缀。 */
	private actionText(result: DshActionResult | DshStopResult): string {
		return 'DSH：' + result.message + (result.hint === undefined ? '' : ' — ' + result.hint);
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
