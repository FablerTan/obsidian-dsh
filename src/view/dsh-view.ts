import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { sleep } from '../shared/async';
import { VIEW_TYPE_DSH } from '../shared/constants';
import { logPluginWarn } from '../shared/log';
import { createDshSurface, type DshSurface } from './surface';

/**
 * 面板需要的最小宿主能力（由插件实现）。
 * view 只依赖这个窄接口，避免反向 import main.ts 或插件实例。
 */
export interface DshPanelHost {
	/** 展示用地址（不带 token）。 */
	readonly url: string;
	/** 承载面用地址：dsh 0.2.1+ 带一次性登录 token，其余与 url 相同。 */
	readonly embedUrl: string;
	/** Obsidian 的 webview 分区（与核心 Web viewer 共用）；取不到时为 null。 */
	readonly webviewPartition: string | null;
	readonly profile: string;
	readonly port: number;
	isRunning(): Promise<boolean>;
	ensureStarted(): Promise<boolean>;
}

/** DSH 面板视图：状态条 + 承载面（优先 webview，环境不支持时回退 iframe）。 */
export class DshWebView extends ItemView {
	private banner!: HTMLElement;
	private surface: DshSurface | null = null;
	/** 承载面是否已经成功承载过 dsh 页面（决定服务就绪后要不要重载）。 */
	private surfaceReady = false;
	/** webview 不可用且地址带 token 时的兼容提示只弹一次。 */
	private fallbackHintShown = false;

	constructor(
		private readonly host: DshPanelHost,
		leaf: WorkspaceLeaf,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DSH;
	}

	getDisplayText(): string {
		return 'DSH';
	}

	getIcon(): string {
		return 'bot';
	}

	/** 当前承载方式；尚未创建承载面时为 null。 */
	get surfaceKind(): 'webview' | 'iframe' | null {
		return this.surface?.kind ?? null;
	}

	/** 在 DSH 页面里执行脚本（桥用）；iframe 或未打开时 reject。 */
	runScript<T>(code: string): Promise<T> {
		if (this.surface === null) return Promise.reject(new Error('DSH 面板尚未打开'));
		return this.surface.executeJavaScript<T>(code);
	}

	async onOpen(): Promise<void> {
		// containerEl.children[1] 是 ItemView 的内容容器（[0] 是头部）
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('dsh-web-view');

		this.banner = container.createDiv({ cls: 'dsh-web-banner' });
		this.banner.setText('DeepSeek Harness — ' + this.host.url);

		const alreadyRunning = await this.host.isRunning();
		this.surface = createDshSurface(container, this.host.embedUrl, this.host.webviewPartition);
		this.surfaceReady = alreadyRunning;
		this.warnIfTokenWithoutWebview();

		if (!alreadyRunning) {
			this.banner.setText('正在启动 dsh（' + this.host.profile + ' @ ' + this.host.url + '）…');
			const started = await this.host.ensureStarted();
			this.ensureSurfaceReady(started);
		}
		void this.refreshStatus();
	}

	async onClose(): Promise<void> {
		this.surface?.destroy();
		this.surface = null;
		this.surfaceReady = false;
	}

	/** 服务就绪后把停在错误页的承载面重新加载一次（只做一次，避免打断用户操作）。 */
	private ensureSurfaceReady(running: boolean): void {
		if (!running || this.surfaceReady) return;
		// 就绪后才有 0.2.1+ 的 token 地址，必须用最新 embedUrl 重新加载。
		this.surface?.reload(this.host.embedUrl);
		this.surfaceReady = true;
		this.warnIfTokenWithoutWebview();
	}

	/**
	 * webview 不可用时，0.2.1 的 token 在跨站 iframe 里无法完成登录（SameSite=Strict）。
	 * 回退本身不阻断 0.1.1，只在这种组合下提示一次并写警告日志。
	 */
	private warnIfTokenWithoutWebview(): void {
		if (this.fallbackHintShown) return;
		if (this.surface?.kind !== 'iframe' || !this.host.embedUrl.includes('token=')) return;
		this.fallbackHintShown = true;
		logPluginWarn('面板回退到 iframe，但地址含 token；跨站 iframe 不会携带 SameSite=Strict cookie，可能 401');
		new Notice(
			'当前 Obsidian 环境不支持 webview，dsh 0.2.1 面板可能无法登录。请升级 Obsidian，或在设置里改用 0.1.1。',
			15000,
		);
	}

	private async refreshStatus(): Promise<void> {
		for (let attempt = 0; attempt < 60; attempt++) {
			await sleep(500);
			if (await this.host.isRunning()) {
				this.ensureSurfaceReady(true);
				this.banner.setText('DeepSeek Harness — 已连接 ' + this.host.url);
				this.banner.addClass('dsh-web-ok');
				return;
			}
		}
		this.banner.setText(
			'DeepSeek Harness — 服务不可用（' +
				this.host.url +
				'）。请检查设置或运行: dsh --profile ' +
				this.host.profile +
				' --port ' +
				String(this.host.port),
		);
	}
}
