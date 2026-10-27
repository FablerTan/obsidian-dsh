import { Setting } from 'obsidian';
import type { DshInstall } from '../../shared/types';
import type { SettingsRenderContext } from '../context';

/**
 * dsh 版本模块：版本选择 + 运行环境。
 *
 * 版本探测是异步且可能较慢的，所以只在切到本 tab 时执行；
 * 打开设置页不再被它阻塞（0027）。
 */
export async function renderRuntimeSection(
	containerEl: HTMLElement,
	context: SettingsRenderContext,
): Promise<void> {
	const { host } = context;
	// 先占位再探测：本模块首次打开要等几份 dsh 的版本探测，避免内容区空白。
	const loadingEl = containerEl.createEl('p', { text: '正在检测 dsh 版本…' });
	// 只列 locator 检测到的安装（+「自动」）。先探测版本再渲染，避免异步覆盖用户输入。
	const installs = await host.detectDshInstalls().catch((): DshInstall[] => []);
	if (context.isStale()) return;
	loadingEl.remove();
	const selected = host.settings.dshPath;
	new Setting(containerEl)
		.setName('dsh 版本')
		.setDesc('选择使用哪份检测到的 dsh（自动 = 现有解析优先级）。改完在「服务」里点「重启服务」生效。')
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
				host.settings.dshPath = value === 'auto' ? null : value;
				await host.saveSettings();
			});
		})
		.addButton((button) => {
			button.setButtonText('重新检测').onClick(() => {
				context.refresh();
			});
		});

	const runtime = host.getRuntimeInfo();
	const mode = host.settings.dshPath === null ? '自动' : '手动选择';
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
					.join('；') + '。可在上方「dsh 版本」里切换，改完在「服务」里点「重启服务」。',
			);
	}
}
