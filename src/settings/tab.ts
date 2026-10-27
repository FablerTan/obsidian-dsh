import { PluginSettingTab, type App, type Plugin } from 'obsidian';
import type { SettingsHost, SettingsRenderContext } from './context';
import { renderChatSection } from './sections/chat';
import { renderIntegrationSection } from './sections/integration';
import { renderPluginsSection } from './sections/plugins';
import { renderRuntimeSection } from './sections/runtime';
import { renderServiceSection } from './sections/service';

/** 设置页模块 id（顺序即 tab 顺序）。 */
export type SettingsSectionId = 'service' | 'runtime' | 'chat' | 'integration' | 'plugins';

interface SettingsSection {
	id: SettingsSectionId;
	/** tab 上的短名。 */
	label: string;
	render: (containerEl: HTMLElement, context: SettingsRenderContext) => void | Promise<void>;
}

/** 模块划分（0027）：服务 / dsh 版本 / 聊天 / 集成；0031 追加「插件」。 */
const SECTIONS: SettingsSection[] = [
	{ id: 'service', label: '服务', render: renderServiceSection },
	{ id: 'runtime', label: 'dsh 版本', render: renderRuntimeSection },
	{ id: 'chat', label: '聊天', render: renderChatSection },
	{ id: 'integration', label: '集成', render: renderIntegrationSection },
	{ id: 'plugins', label: '插件', render: renderPluginsSection },
];

/**
 * 设置页：顶部 tab 按模块切换，内容区只渲染当前模块（0027）。
 *
 * - 异步模块（dsh 版本 / 集成）只在切到对应 tab 时探测：打开设置页不再等待版本探测；
 * - 每次渲染递增 renderSeq，异步结果回来时用 isStale() 丢弃过期内容；
 * - 不记忆上次 tab：每次打开设置页回到「服务」。
 */
export class DshSettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;
	private activeSection: SettingsSectionId = 'service';
	/** 防止连续切换 / 重新检测时旧渲染覆盖新内容。 */
	private renderSeq = 0;
	private readonly tabButtons = new Map<SettingsSectionId, HTMLButtonElement>();
	private contentEl: HTMLElement | null = null;

	constructor(app: App, plugin: Plugin & SettingsHost) {
		super(app, plugin);
		this.host = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		this.activeSection = 'service';
		// 让上一次 display 里未完成的异步渲染过期。
		this.renderSeq += 1;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'DSH in Obsidian' });
		containerEl.createEl('p', {
			text: '插件会自动拉起一个独立的 dsh 服务（工作目录 = 当前 vault），聊天由 Obsidian 原生面板承载。',
		});

		const tabBarEl = containerEl.createDiv({ cls: 'dsh-settings-tabs' });
		tabBarEl.setAttr('role', 'tablist');
		this.tabButtons.clear();
		for (const section of SECTIONS) {
			const button = tabBarEl.createEl('button', {
				cls: 'dsh-settings-tab',
				text: section.label,
			});
			button.setAttr('type', 'button');
			button.setAttr('role', 'tab');
			button.onclick = () => this.selectSection(section.id);
			this.tabButtons.set(section.id, button);
		}

		this.contentEl = containerEl.createDiv({ cls: 'dsh-settings-content' });
		this.updateTabBar();
		await this.renderSection();
	}

	private selectSection(id: SettingsSectionId): void {
		if (id === this.activeSection) return;
		this.activeSection = id;
		this.updateTabBar();
		void this.renderSection();
	}

	private updateTabBar(): void {
		for (const [id, button] of this.tabButtons) {
			const active = id === this.activeSection;
			button.toggleClass('is-active', active);
			button.setAttr('aria-selected', active ? 'true' : 'false');
		}
	}

	/** 只重绘内容区（tab 条不动）；递增序号让旧的异步渲染过期。 */
	private async renderSection(): Promise<void> {
		const contentEl = this.contentEl;
		if (contentEl === null) return;
		const section = SECTIONS.find((item) => item.id === this.activeSection);
		if (section === undefined) return;
		const seq = ++this.renderSeq;
		contentEl.empty();
		const context: SettingsRenderContext = {
			host: this.host,
			app: this.app,
			isStale: () => seq !== this.renderSeq,
			refresh: () => {
				void this.renderSection();
			},
		};
		await section.render(contentEl, context);
	}
}
