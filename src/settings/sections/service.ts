import { Setting, type ButtonComponent } from 'obsidian';
import { errorText } from '../../shared/errors';
import type { DshActionResult, DshStopResult } from '../../shared/types';
import type { SettingsRenderContext } from '../context';
import { DEFAULT_SETTINGS, isValidPort } from '../schema';

/** 正在执行的服务动作（两个按钮互斥，避免并发停止 / 重启）。 */
type ServiceAction = 'restart' | 'stop';

/**
 * 服务模块：端口 / Profile / 自动启动 / 重启 / 结束后台 dsh。
 *
 * 0056 起两个动作都在行下**就地**显示进度与结果（不再靠叠加 Notice）：
 * 进行中「重启中…」+ 逐 0.2s 刷新的耗时；结束后显示「HH:mm:ss · 结果」，
 * 失败再补一行下一步建议。命令面板入口仍由 main.ts 弹一条 Notice。
 */
export function renderServiceSection(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('端口')
		.setDesc('独立服务监听端口（默认 3081，与 web profile 的 3080 互不干扰）')
		.addText((text) =>
			text
				.setPlaceholder(String(DEFAULT_SETTINGS.port))
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
				.setPlaceholder(DEFAULT_SETTINGS.profile)
				.setValue(host.settings.profile)
				.onChange(async (value) => {
					host.settings.profile = value.trim() || DEFAULT_SETTINGS.profile;
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

	let restartButton: ButtonComponent | null = null;
	let stopButton: ButtonComponent | null = null;
	/** 当前执行中的动作；非 null 时两个按钮都禁用。 */
	let busy: ServiceAction | null = null;
	/** 进行中耗时的刷新计时器。 */
	let ticker: number | null = null;

	const stopTicker = (): void => {
		if (ticker !== null) {
			window.clearInterval(ticker);
			ticker = null;
		}
	};

	const restartSetting = new Setting(containerEl)
		.setName('重启服务')
		.setDesc('杀掉插件自启的 dsh 进程并重新拉起（改完端口 / Profile / dsh 版本后点这里）');
	const restartStatusEl = createStatusEl(restartSetting);

	const stopSetting = new Setting(containerEl)
		.setName('结束后台 dsh')
		.setDesc(
			'结束插件拉起的 dsh，以及占住端口的遗留 dsh（会先确认是 dsh 进程，不动其他程序）；结束后再点「重启服务」',
		);
	const stopStatusEl = createStatusEl(stopSetting);

	const setBusy = (next: ServiceAction | null): void => {
		busy = next;
		if (restartButton !== null) {
			restartButton.setDisabled(next !== null);
			restartButton.setButtonText(next === 'restart' ? '重启中…' : '重启');
		}
		if (stopButton !== null) {
			stopButton.setDisabled(next !== null);
			stopButton.setButtonText(next === 'stop' ? '结束中…' : '结束');
		}
	};

	/** 计时器：每 0.2s 刷新「进行中… N.Ns」；设置页关闭 / 切 tab 后自行停止。 */
	const startTicker = (statusEl: HTMLElement, label: string): void => {
		stopTicker();
		const startedAt = Date.now();
		const paint = (): void => {
			if (context.isStale() || !statusEl.isConnected) {
				stopTicker();
				return;
			}
			setStatus(statusEl, 'busy', label + '… ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's');
		};
		paint();
		ticker = window.setInterval(paint, 200);
	};

	const paintRestart = (result: DshActionResult): void => {
		if (result.ok) clearStatus(stopStatusEl);
		setStatus(
			restartStatusEl,
			result.ok ? 'ok' : 'fail',
			clockText() + ' · ' + (result.ok ? '' : '重启失败：') + result.message,
			result.hint,
		);
	};

	const paintStop = (result: DshStopResult): void => {
		if (result.ok) clearStatus(restartStatusEl);
		setStatus(
			stopStatusEl,
			result.ok ? 'ok' : 'fail',
			clockText() + ' · ' + (result.ok ? '' : '结束失败：') + result.message,
			result.hint,
		);
	};

	const runRestart = async (): Promise<void> => {
		if (busy !== null) return;
		setBusy('restart');
		startTicker(restartStatusEl, '正在重启 dsh 服务');
		let result: DshActionResult;
		try {
			result = await host.restartService();
		} catch (error) {
			result = { ok: false, message: errorText(error), elapsedMs: 0 };
		}
		stopTicker();
		if (context.isStale() || !restartStatusEl.isConnected) return;
		setBusy(null);
		paintRestart(result);
	};

	const runStop = async (): Promise<void> => {
		if (busy !== null) return;
		setBusy('stop');
		startTicker(stopStatusEl, '正在结束后台 dsh');
		let result: DshStopResult;
		try {
			result = await host.stopBackgroundService();
		} catch (error) {
			result = { ok: false, message: errorText(error), pids: [], stoppedOwn: false };
		}
		stopTicker();
		if (context.isStale() || !stopStatusEl.isConnected) return;
		setBusy(null);
		paintStop(result);
	};

	restartSetting.addButton((button) => {
		restartButton = button;
		button.setButtonText('重启').onClick(() => {
			void runRestart();
		});
	});

	stopSetting.addButton((button) => {
		stopButton = button;
		button.setButtonText('结束').onClick(() => {
			void runStop();
		});
	});
}

/** 行下就地状态容器（放进 Setting 的描述区，跟随行布局；空内容由 CSS 隐藏）。 */
function createStatusEl(setting: Setting): HTMLElement {
	const el = setting.descEl.createDiv({ cls: 'dsh-service-action-status' });
	el.setAttr('role', 'status');
	el.setAttr('aria-live', 'polite');
	return el;
}

/** 写入一行状态：busy 用正文色，失败用错误色并显示下一步建议。 */
function setStatus(
	el: HTMLElement,
	state: 'busy' | 'ok' | 'fail',
	text: string,
	hint?: string,
): void {
	el.empty();
	el.addClass('is-visible');
	el.toggleClass('is-busy', state === 'busy');
	el.toggleClass('is-error', state === 'fail');
	el.createSpan({ text });
	if (hint !== undefined && hint !== '') {
		el.createDiv({ cls: 'dsh-service-action-hint', text: hint });
	}
}

function clearStatus(el: HTMLElement): void {
	el.empty();
	el.removeClass('is-visible', 'is-busy', 'is-error');
}

/** 本地时间 HH:mm:ss（结果行前缀，避免看不出是刚才还是上次的结果）。 */
function clockText(): string {
	const now = new Date();
	const pad = (value: number): string => String(value).padStart(2, '0');
	return pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}
