import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { sleep } from '../shared/async';
import { VIEW_TYPE_DSH } from '../shared/constants';
import { createDshSurface, type DshSurface } from './surface';

/**
 * 面板需要的最小宿主能力（由插件实现）。
 * view 只依赖这个窄接口，避免反向 import main.ts 或插件实例。
 */
export interface DshPanelHost {
	/** 展示用地址（不带 token）。 */
	readonly url: string;
	/** 承载面用地址：dsh 0.2.x 带一次性登录 token；未就绪时与 url 相同。 */
	readonly embedUrl: string;
	/** Obsidian 的 webview 分区（与核心 Web viewer 共用）；取不到时为 null。 */
	readonly webviewPartition: string | null;
	readonly profile: string;
	readonly port: number;
	isRunning(): Promise<boolean>;
	ensureStarted(): Promise<boolean>;
}

/** DSH 面板视图：状态条 + Electron webview 承载面。 */
export class DshWebView extends ItemView {
	private banner!: HTMLElement;
	private surface: DshSurface | null = null;
	/** 承载面是否已经成功承载过 dsh 页面（决定服务就绪后要不要重载）。 */
	private surfaceReady = false;
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
	get surfaceKind(): 'webview' | null {
		return this.surface?.kind ?? null;
	}

	/** 在 DSH 页面里执行脚本（桥用）；承载面未打开时 reject。 */
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
		if (this.surface === null) {
			this.banner.setText('DeepSeek Harness — 当前 Obsidian 环境不支持 webview，无法承载面板');
			new Notice('当前 Obsidian 环境不支持 Electron webview，DSH 面板不可用；请升级 Obsidian。', 15000);
			return;
		}
		this.surfaceReady = alreadyRunning;

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
		// 就绪后才有 0.2.x 的 token 地址，必须用最新 embedUrl 重新加载。
		this.surface?.reload(this.host.embedUrl);
		this.surfaceReady = true;
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
