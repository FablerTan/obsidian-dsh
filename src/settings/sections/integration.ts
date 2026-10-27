import { Setting } from 'obsidian';
import { errorText } from '../../shared/errors';
import { vaultPath } from '../../shared/host';
import type { DshBridgeStatus } from '../../shared/types';
import type { SettingsRenderContext } from '../context';

/** 桥状态 → 设置页文案。 */
function describeBridgeStatus(status: DshBridgeStatus): string {
	switch (status.state) {
		case 'connected':
			return '已连接' + (status.version === undefined ? '' : '（v' + String(status.version) + '）');
		case 'panel-closed':
			return '原生聊天面板未打开（打开后可检测）';
		case 'missing':
			return '未检测到 dsh-obsidian-bridge：请安装后重启 DSH 服务并重开原生面板';
		default:
			return '检测失败：' + (status.message ?? '未知错误');
	}
}

/** 集成模块：项目目录 / 桥接状态 / 桥的安装提示。 */
export function renderIntegrationSection(
	containerEl: HTMLElement,
	context: SettingsRenderContext,
): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('项目目录')
		.setDesc(vaultPath(context.app) + '（新建会话固定落在这个工作区）');

	let statusSetting: Setting | null = null;
	const refreshBridgeStatus = async (): Promise<void> => {
		if (statusSetting === null) return;
		statusSetting.setDesc('正在检测…');
		const status = await host.getBridgeStatus().catch(
			(error: unknown): DshBridgeStatus => ({
				state: 'error',
				message: errorText(error),
			}),
		);
		if (context.isStale()) return;
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
		text: 'dsh plugin --profile obsidian add link:<本仓库>/packages/dsh-obsidian-bridge',
	});
	hint.appendText('（路径按实际 checkout 替换），然后在设置页点「重启」。');
}
