import { realpathSync } from 'fs';
import { Notice, Plugin } from 'obsidian';
import { DshServiceManager, type DshServiceOutcome } from './service/manager';
import { listDshCandidates, PATH_DSH_PLACEHOLDER, probeDshVersion } from './service/locator';
import { mergeSettings, serviceUrl, type DshPluginSettings } from './settings/schema';
import { DshSettingTab, type SettingsHost } from './settings/tab';
import { VIEW_TYPE_DSH } from './shared/constants';
import { createDshProbe, vaultPath } from './shared/host';
import { logPlugin, logPluginWarn } from './shared/log';
import type { DshBridgeStatus, DshInstall, DshRuntimeInfo } from './shared/types';
import { callDshBridge, describeDshBridgeError, probeDshBridge, waitForDshBridge } from './view/bridge';
import { DshWebView, type DshPanelHost } from './view/dsh-view';
import { openDshPanel } from './view/open';

/**
 * DSH in Obsidian — 方案 B：自动拉起独立的 dsh 服务 + webview 嵌入（不支持时回退 iframe）。
 *
 * 服务：dsh --profile obsidian --port <port>，工作目录 = 当前 vault。
 *  - 独立 profile：与日常用的 web profile（:3080）互不干扰；
 *  - 独立端口（默认 3081）：两个 GUI 可同时运行；
 *  - 工作目录 = vault：dsh 的 workspace / 会话 / AGENTS.md 都落在笔记库上。
 *
 * 进程生命周期由插件托管：检测到端口未监听 → spawn；插件卸载 → 杀掉自启进程
 * （用户自己启动的实例不会被杀）。
 *
 * 本文件是**组合根**：只做注册与装配，业务逻辑分层在
 *   service/  dsh 进程托管（locator / probe / manager）
 *   view/     面板与承载面（dsh-view / surface / open）
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

		// 视图：读取设置中的端口
		this.registerView(VIEW_TYPE_DSH, (leaf) => new DshWebView(this, leaf));

		// ribbon 图标
		this.addRibbonIcon('bot', '打开 DSH 面板', () => {
			void this.openPanel();
		});
		this.addRibbonIcon('message-square', '新建 DSH 会话', () => {
			void this.newDshSession();
		});

		// 命令面板
		this.addCommand({
			id: 'open-dsh-view',
			name: '打开 DSH 面板',
			callback: () => {
				void this.openPanel();
			},
		});
		this.addCommand({
			id: 'new-dsh-session',
			name: '新建 DSH 会话',
			callback: () => {
				void this.newDshSession();
			},
		});
		this.addCommand({
			id: 'restart-dsh-service',
			name: '重启 DSH 服务',
			callback: () => {
				void this.restartService();
			},
		});

		// 状态栏：点击也可打开面板
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText('DSH: …');
		this.statusBarItem.addClass('dsh-status');
		this.statusBarItem.onclick = () => void this.openPanel();

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

	/** 面板展示地址（不带 token，随设置动态变化）。 */
	get url(): string {
		return serviceUrl(this.settings.port);
	}

	/** DshPanelHost：承载面用地址（0.2.1+ 为带 token 的启动 URL）。 */
	get embedUrl(): string {
		return this.service.embedUrl;
	}

	/**
	 * DshPanelHost：Obsidian 的 webview 分区，与核心 Web viewer / Canvas 网页卡片共用
	 * （实现为 persist:vault-<appId>）。这是 Obsidian 内部方法，取不到时返回 null，
	 * webview 会退回默认会话（仍能登录，只是不与核心查看器共享 cookie）。
	 */
	get webviewPartition(): string | null {
		const app = this.app as unknown as { getWebviewPartition?: () => string };
		try {
			const partition = app.getWebviewPartition?.();
			return typeof partition === 'string' && partition.length > 0 ? partition : null;
		} catch (error) {
			logPluginWarn('读取 webview 分区失败，面板将使用默认会话: ' + String(error));
			return null;
		}
	}

	get port(): number {
		return this.settings.port;
	}

	get profile(): string {
		return this.settings.profile;
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

	/** 重启服务：杀自启进程 → 重新拉起。 */
	async restartService(): Promise<void> {
		const outcome = await this.service.restart();
		this.reportOutcome(outcome, true);
	}

	/** SettingsHost：页面桥状态（设置页「Obsidian 集成」）。 */
	getBridgeStatus(): Promise<DshBridgeStatus> {
		return probeDshBridge(this.app);
	}

	/**
	 * 新建会话：确保服务 → 打开面板 → 等页面桥 → 绑定库目录工作区 → 新建。
	 * 桥只存在于 webview；iframe 回退或未安装 dsh 插件时给明确提示。
	 */
	private async newDshSession(): Promise<void> {
		if (!(await this.ensureDsh())) return;
		await openDshPanel(this.app);
		try {
			await waitForDshBridge(this.app);
			const info = await callDshBridge<{ workspacePath?: string }>(
				this.app,
				'configure',
				[{ paths: this.workspacePaths() }],
				20000,
			);
			await callDshBridge(this.app, 'newSession');
			logPlugin('新建会话: ' + (info?.workspacePath ?? '库目录'));
			new Notice('DSH：已在库目录新建会话');
		} catch (error) {
			logPluginWarn('新建会话失败: ' + (error instanceof Error ? error.message : String(error)));
			new Notice('DSH：新建会话失败 — ' + describeDshBridgeError(error), 12000);
		}
	}

	/** 库目录的两种写法（原路径 + realpath），避免符号链接导致工作区匹配失败。 */
	private workspacePaths(): string[] {
		const base = vaultPath(this.app);
		const paths = [base];
		try {
			const real = realpathSync(base);
			if (real !== base) paths.push(real);
		} catch {
			// realpath 失败时只用原路径；桥会按精确匹配/创建处理。
		}
		return paths;
	}

	private async openPanel(): Promise<void> {
		await openDshPanel(this.app);
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
		}
		if (fromRestart) new Notice('DSH 服务重启失败');
		return false;
	}

	/**
	 * 记录运行信息。
	 * - 明确指定了 dsh 版本时不弹冲突提示（选择权在用户，设置页/日志仍可查）；
	 * - 自动模式下发现版本不同的其他安装时提示一次（避免每次打开面板重复打扰）；
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

	private setStatus(text: string): void {
		if (this.statusBarItem) this.statusBarItem.setText('DSH: ' + text);
	}
}
