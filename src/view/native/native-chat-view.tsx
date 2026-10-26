import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { VIEW_TYPE_NATIVE_CHAT } from '../../shared/constants';
import type { DshPanelHost } from '../dsh-view';
import { openDshPanel } from '../open';
import { createDshSurface, type DshSurface } from '../surface';
import { NativeCoreBridge } from './core-bridge';
import { NoteTracker } from './note-tracker';
import { NativeChatRoot } from './ui/native-chat-root';

/**
 * 原生聊天视图：Obsidian ItemView 里放 React UI + 一个离屏的官方 DSH webview。
 *
 * React 负责所有可见交互；webview 只加载官方 core 与 dsh-obsidian-bridge，
 * 通过 executeJavaScript 返回 JSON 快照。视图只允许右栏一个实例（open.ts 复用）。
 */
export class DshNativeChatView extends ItemView {
	private surface: DshSurface | null = null;
	private bridge: NativeCoreBridge | null = null;
	private noteTracker: NoteTracker | null = null;
	private root: Root | null = null;
	private closed = false;

	constructor(
		private readonly host: DshPanelHost,
		leaf: WorkspaceLeaf,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NATIVE_CHAT;
	}

	getDisplayText(): string {
		return 'DSH 原生聊天（实验）';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
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
				openDshPanel={() => {
					void openDshPanel(this.app);
				}}
			/>,
		);
	}

	async onClose(): Promise<void> {
		this.closed = true;
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

	/** React 启动/重试时调用：确保服务、重新加载带 token 的页面、等待桥就绪。 */
	private async ensureReady(): Promise<void> {
		if (this.surface === null || this.bridge === null) throw new Error('原生视图未初始化');
		if (!(await this.host.isRunning())) {
			const started = await this.host.ensureStarted();
			if (!started) throw new Error('DSH 服务不可用');
		}
		if (this.closed) throw new Error('原生视图已关闭');
		this.surface.reload(this.host.embedUrl);
		await this.bridge.waitReady(25000);
	}
}
