import { Setting } from 'obsidian';
import type { SettingsRenderContext } from '../context';
import { isValidPort } from '../schema';

/** 服务模块：端口 / Profile / 自动启动 / 重启。 */
export function renderServiceSection(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('端口')
		.setDesc('独立服务监听端口（默认 3081，与 web profile 的 3080 互不干扰）')
		.addText((text) =>
			text
				.setPlaceholder('3081')
				.setValue(String(host.settings.port))
				.onChange(async (value) => {
					const port = Number.parseInt(value, 10);
					if (isValidPort(port)) {
						host.settings.port = port;
						await host.saveSettings();
					}
				}),
		);

	new Setting(containerEl)
		.setName('Profile')
		.setDesc('dsh profile 名（须已存在于 $DSH_HOME/profiles/）')
		.addText((text) =>
			text
				.setPlaceholder('obsidian')
				.setValue(host.settings.profile)
				.onChange(async (value) => {
					host.settings.profile = value.trim() || 'obsidian';
					await host.saveSettings();
				}),
		);

	new Setting(containerEl)
		.setName('自动启动服务')
		.setDesc('Obsidian 启动时自动拉起 dsh 服务')
		.addToggle((toggle) =>
			toggle.setValue(host.settings.autoStart).onChange(async (value) => {
				host.settings.autoStart = value;
				await host.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName('重启服务')
		.setDesc('杀掉插件自启的 dsh 进程并重新拉起（改完端口 / Profile / dsh 版本后点这里）')
		.addButton((button) =>
			button.setButtonText('重启').onClick(() => {
				void host.restartService();
			}),
		);
}
