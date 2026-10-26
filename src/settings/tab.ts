import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { vaultPath } from '../shared/host';
import type { DshBridgeStatus, DshInstall, DshRuntimeInfo } from '../shared/types';
import { isValidPort } from './schema';
import type { DshPluginSettings } from './schema';

/** 设置页需要的最小宿主能力（由插件实现）。 */
export interface SettingsHost {
	settings: DshPluginSettings;
	saveSettings(): Promise<void>;
	restartService(): Promise<void>;
	/** 实际使用的 dsh（路径 / 版本 / 其他版本安装）；尚未拉起时返回 null。 */
	getRuntimeInfo(): DshRuntimeInfo | null;
	/** 检测到的 dsh 安装（带版本），供「dsh 版本」下拉与「运行环境」展示。 */
	detectDshInstalls(): Promise<DshInstall[]>;
	/** 页面桥（dsh-obsidian-bridge）状态；面板未打开/iframe 时返回对应状态。 */
	getBridgeStatus(): Promise<DshBridgeStatus>;
}

/** 桥状态 → 设置页文案。 */
function describeBridgeStatus(status: DshBridgeStatus): string {
	switch (status.state) {
		case 'connected':
			return '已连接' + (status.version === undefined ? '' : '（v' + String(status.version) + '）');
		case 'panel-closed':
			return 'DSH 面板未打开（打开面板后可检测）';
		case 'iframe':
			return '当前承载方式为 iframe，桥不可用';
		case 'missing':
			return '未检测到 dsh-obsidian-bridge：请安装后重启 DSH 服务并重开面板';
		default:
			return '检测失败：' + (status.message ?? '未知错误');
	}
}

/**
 * 设置页：端口 / profile / dsh 版本 / 自动启动 / 重启服务 / 运行环境。
 *
 * display() 是 async 的：版本下拉需要先探测各安装的版本再渲染，
 * 避免「先渲染、异步补 options」导致中途覆盖用户刚改的值。
 */
export class DshSettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;
	/** 防止连续点击「重新检测」时两次异步渲染互相覆盖。 */
	private renderSeq = 0;

	constructor(app: App, plugin: Plugin & SettingsHost) {
		super(app, plugin);
		this.host = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		const seq = ++this.renderSeq;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'DSH in Obsidian' });
		containerEl.createEl('p', {
			text: '插件会自动拉起一个独立的 dsh 服务（工作目录 = 当前 vault），并在面板中嵌入其 GUI。',
		});

		new Setting(containerEl)
			.setName('端口')
			.setDesc('独立服务监听端口（默认 3081，与 web profile 的 3080 互不干扰）')
			.addText((text) =>
				text
					.setPlaceholder('3081')
					.setValue(String(this.host.settings.port))
					.onChange(async (value) => {
						const port = Number.parseInt(value, 10);
						if (isValidPort(port)) {
							this.host.settings.port = port;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Profile')
			.setDesc('dsh profile 名（须已存在于 $DSH_HOME/profiles/）')
			.addText((text) =>
				text
					.setPlaceholder('obsidian')
					.setValue(this.host.settings.profile)
					.onChange(async (value) => {
						this.host.settings.profile = value.trim() || 'obsidian';
						await this.host.saveSettings();
					}),
			);

		// dsh 版本：只列 locator 检测到的安装（+「自动」）。先探测版本再渲染，避免异步覆盖用户输入。
		const installs = await this.host.detectDshInstalls().catch((): DshInstall[] => []);
		if (seq !== this.renderSeq) return;
		const selected = this.host.settings.dshPath;
		new Setting(containerEl)
			.setName('dsh 版本')
			.setDesc('选择使用哪份检测到的 dsh（自动 = 现有解析优先级）。改完点「重启服务」生效。')
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', '自动（按优先级）');
				for (const install of installs) {
					dropdown.addOption(
						install.path,
						(install.version ?? '未知版本') + ' — ' + install.path,
					);
				}
				if (selected !== null && !installs.some((install) => install.path === selected)) {
					dropdown.addOption(selected, '未检测到：' + selected + '（启动时回退自动）');
				}
				dropdown.setValue(selected ?? 'auto').onChange(async (value) => {
					this.host.settings.dshPath = value === 'auto' ? null : value;
					await this.host.saveSettings();
				});
			})
			.addButton((button) => {
				button.setButtonText('重新检测').onClick(() => {
					void this.display();
				});
			});

		new Setting(containerEl)
			.setName('自动启动服务')
			.setDesc('Obsidian 启动时自动拉起 dsh 服务')
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.autoStart).onChange(async (value) => {
					this.host.settings.autoStart = value;
					await this.host.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('重启服务')
			.setDesc('杀掉插件自启的 dsh 进程并重新拉起（改完端口 / Profile / dsh 版本后点这里）')
			.addButton((button) =>
				button.setButtonText('重启').onClick(() => {
					void this.host.restartService();
				}),
			);

		const runtime = this.host.getRuntimeInfo();
		const mode = this.host.settings.dshPath === null ? '自动' : '手动选择';
		containerEl.createEl('h3', { text: '运行环境' });
		let currentDesc: string;
		if (runtime === null) {
			currentDesc = '尚未拉起服务；启动或重启后显示解析到的 dsh 路径与版本';
		} else {
			const prefix = runtime.confirmed
				? '当前使用：'
				: '服务已在运行（非本次拉起），无法确认其版本；解析结果：';
			currentDesc =
				prefix + runtime.used.path + '（版本 ' + (runtime.used.version ?? '未知') + '，' + mode + '）';
			if (runtime.fallback) currentDesc += '；设置里选择的 dsh 未检测到，已回退自动';
		}
		new Setting(containerEl).setName('当前 dsh').setDesc(currentDesc);
		if (runtime !== null && runtime.others.length > 0) {
			new Setting(containerEl)
				.setName('发现其他版本的 dsh')
				.setDesc(
					runtime.others
						.map((install) => install.path + '（版本 ' + (install.version ?? '未知') + '）')
						.join('；') + '。可在上方「dsh 版本」里切换，改完点「重启服务」。',
				);
		}

		containerEl.createEl('h3', { text: 'Obsidian 集成' });

		new Setting(containerEl)
			.setName('单栏模式')
			.setDesc('始终开启：由 dsh-obsidian-bridge 收起 DSH 左栏与右栏（只留聊天）');

		new Setting(containerEl)
			.setName('项目目录')
			.setDesc(vaultPath(this.app) + '（新建会话固定落在这个工作区）');

		let statusSetting: Setting | null = null;
		const refreshBridgeStatus = async (): Promise<void> => {
			if (statusSetting === null) return;
			statusSetting.setDesc('正在检测…');
			const status = await this.host.getBridgeStatus().catch(
				(error: unknown): DshBridgeStatus => ({
					state: 'error',
					message: error instanceof Error ? error.message : String(error),
				}),
			);
			if (seq !== this.renderSeq) return;
			statusSetting.setDesc(describeBridgeStatus(status));
		};
		statusSetting = new Setting(containerEl)
			.setName('桥接状态')
			.setDesc('尚未检测')
			.addButton((button) =>
				button.setButtonText('重新检测').onClick(() => {
					void refreshBridgeStatus();
				}),
			);
		void refreshBridgeStatus();

		const hint = containerEl.createEl('p', { cls: 'dsh-bridge-hint' });
		hint.appendText('需要 dsh 侧插件 ');
		hint.createEl('code', { text: 'dsh-obsidian-bridge' });
		hint.appendText('（obsidian profile）：');
		hint.createEl('code', {
			text: 'dsh plugin --profile obsidian add link:/Users/fabler/dsh/dsh-plugin/self-made/dsh-obsidian-bridge',
		});
		hint.appendText('，然后在面板里点「重启 DSH 服务」。');
	}
}
