import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { VIEW_TYPE_NATIVE_CHAT } from '../../shared/constants';
import { errorText } from '../../shared/errors';
import { NativeBridgeError } from '../../shared/native-types';
import type { DshBridgeStatus } from '../../shared/types';
import type { DshPanelHost } from '../panel-host';
import { createDshSurface, type DshSurface } from '../surface';
import { NativeCoreBridge } from './core-bridge';
import { filterUnsupportedCommands } from './command-scope';
import { NoteTracker } from './note-tracker';
import { NativeChatRoot } from './ui/native-chat-root';

/**
 * 原生聊天视图：Obsidian ItemView 里放 React UI + 一个离屏的官方 DSH webview。
 *
 * React 负责所有可见交互；webview 只加载官方 core 与 dsh-obsidian-bridge，
 * 通过 executeJavaScript 返回 JSON 快照。视图只允许右栏一个实例（open.ts 复用）。
 * 0008 起不再提供可见的官方 webview 面板，隐藏 core 是原生 UI 唯一的数据源。
 */
export class DshNativeChatView extends ItemView {
	private surface: DshSurface | null = null;
	private bridge: NativeCoreBridge | null = null;
	private noteTracker: NoteTracker | null = null;
	private root: Root | null = null;
	private closed = false;
	/** 隐藏页面与桥是否已经成功就绪（避免并发重复 reload）。 */
	private ready = false;
	private readyPromise: Promise<void> | null = null;
	/** onOpen 完成（surface / bridge / React root 建好）后 resolve。 */
	private readonly initPromise: Promise<void>;
	private resolveInit: () => void = () => undefined;

	constructor(
		private readonly host: DshPanelHost,
		leaf: WorkspaceLeaf,
	) {
		super(leaf);
		this.initPromise = new Promise((resolve) => {
			this.resolveInit = resolve;
		});
	}

	getViewType(): string {
		return VIEW_TYPE_NATIVE_CHAT;
	}

	getDisplayText(): string {
		return 'DeepSeek Harness';
	}

	getIcon(): string {
		return 'dsh-whale';
	}

	async onOpen(): Promise<void> {
		try {
			const container = this.containerEl.children[1] as HTMLElement;
			container.empty();
			container.addClass('dsh-native-view');

			const appEl = container.createDiv({ cls: 'dsh-native-root' });
			const coreHost = container.createDiv({ cls: 'dsh-native-core-host' });
			this.surface = createDshSurface(
				coreHost,
				this.host.embedUrl,
				this.host.webviewPartition,
			);
			if (this.surface === null) {
				appEl.createDiv({
					cls: 'dsh-native-status-screen',
					text: '当前 Obsidian 环境不支持 webview，原生聊天不可用',
				});
				new Notice('DSH 原生聊天：当前环境不支持 webview', 12000);
				return;
			}

			this.noteTracker = new NoteTracker(this.app);
			this.bridge = new NativeCoreBridge((code) => this.surface!.executeJavaScript(code));
			this.root = createRoot(appEl);
			this.root.render(
				<NativeChatRoot
					app={this.app}
					bridge={this.bridge}
					noteTracker={this.noteTracker}
					ensureReady={() => this.ensureReady()}
					onExplainSettings={() => this.explainModelSetup()}
					onRestartService={() => this.restartService()}
					getStreamRefresh={() => this.host.getStreamRefresh()}
					getRunStatusPlacement={() => this.host.getRunStatusPlacement()}
					getMentionScope={() => this.host.getMentionScope()}
					getSkillScope={() => this.host.getSkillScope()}
					getCommandScope={() => this.host.getCommandScope()}
					getQuoteExcerptLimit={() => this.host.getQuoteExcerptLimit()}
				/>,
			);
		} finally {
			this.resolveInit();
		}
	}

	/**
	 * 设置页「命令范围」的候选（0051）：从隐藏 core 的桥取当前会话命令目录。
	 * 面板未打开 / 桥未就绪 / 还没有订阅会话时返回空数组（设置页提示手动输入）。
	 */
	async listCommandNames(): Promise<string[]> {
		const bridge = this.bridge;
		if (bridge === null || !this.ready) return [];
		try {
			const list = await bridge.commands();
			return filterUnsupportedCommands(list).map((command) => command.name);
		} catch {
			return [];
		}
	}

	async onClose(): Promise<void> {
		this.closed = true;
		this.ready = false;
		this.readyPromise = null;
		this.root?.unmount();
		this.root = null;
		this.noteTracker?.dispose();
		this.noteTracker = null;
		try {
			await this.bridge?.unsubscribe();
		} catch {
			// 页面可能已经销毁
		}
		this.bridge = null;
		this.surface?.destroy();
		this.surface = null;
	}

	/** 组合根重启服务后调用：重载带新 token 的隐藏页面。 */
	async reloadAfterRestart(): Promise<void> {
		this.ready = false;
		this.readyPromise = null;
		await this.ensureReady();
	}

	/** 设置页「桥接状态」：直接探测隐藏 core 里的 bridge。 */
	async probeBridge(): Promise<DshBridgeStatus> {
		if (this.bridge === null || this.surface === null) return { state: 'panel-closed' };
		try {
			const pong = await this.bridge.probe();
			if (pong.version >= 2 && pong.methods.includes('models')) {
				return { state: 'connected', version: pong.version };
			}
			return { state: 'missing', message: 'dsh-obsidian-bridge 版本过旧（需要 v2+，流式需要 v3）' };
		} catch (error) {
			if (error instanceof NativeBridgeError) {
				return {
					state: error.reason === 'missing' || error.reason === 'version' ? 'missing' : 'error',
					message: error.message,
				};
			}
			return { state: 'error', message: errorText(error) };
		}
	}

	/** React 启动/重试/新建会话共用：确保服务、重新加载带 token 的页面、等待桥就绪。 */
	private ensureReady(): Promise<void> {
		if (this.ready) return Promise.resolve();
		if (this.readyPromise !== null) return this.readyPromise;
		this.readyPromise = this.doEnsureReady()
			.then(() => {
				this.ready = true;
			})
			.finally(() => {
				this.readyPromise = null;
			});
		return this.readyPromise;
	}

	private async doEnsureReady(): Promise<void> {
		await this.waitInit();
		if (this.surface === null || this.bridge === null) throw new Error('原生视图未初始化');
		if (!(await this.host.isRunning())) {
			const started = await this.host.ensureStarted();
			if (!started) throw new Error('DSH 服务不可用');
		}
		if (this.closed) throw new Error('原生视图已关闭');
		this.surface.reload(this.host.embedUrl);
		await this.bridge.waitReady(25000);
	}

	private async waitInit(): Promise<void> {
		await Promise.race([
			this.initPromise,
			new Promise<void>((_, reject) => {
				setTimeout(() => reject(new Error('原生视图初始化超时')), 10000);
			}),
		]);
	}

	private async restartService(): Promise<void> {
		try {
			// 主进程的重启逻辑会调用 reloadAfterRestart()；React 的 boot() 随后刷新列表。
			const result = await this.host.restartService();
			if (!result.ok) {
				new Notice('DSH：' + result.message + (result.hint === undefined ? '' : ' — ' + result.hint), 12000);
			}
		} catch (error) {
			new Notice('DSH：重启服务失败 — ' + errorText(error), 12000);
		}
	}

	private explainModelSetup(): void {
		new Notice(
			'模型与凭据在 obsidian profile 的 cordis.patch.yml 配置（$DSH_HOME/profiles/obsidian/），保存后点「重启 DSH 服务」。详见 docs/development.md。',
			15000,
		);
	}
}
