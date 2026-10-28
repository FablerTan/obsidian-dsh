import { ToggleComponent, setIcon } from 'obsidian';
import { errorText } from '../../shared/errors';
import type {
	DshOptionalBundle,
	DshOptionalCatalog,
	DshPluginBundle,
	DshPluginInventory,
	DshPluginRow,
	DshPluginRowState,
} from '../../shared/types';
import type { SettingsRenderContext } from '../context';
import { DEFAULT_SETTINGS } from '../schema';

/** 行状态的中文文案（与 dsh 官方插件面板口径一致）。 */
const STATE_TEXT: Record<DshPluginRowState, string> = {
	on: '运行中',
	off: '已停用',
	conditional: '由 dsh 决定',
};

/**
 * 「插件」模块：dsh 侧插件的组合清单（0031）+ 可选 / 实验性插件（0032）。
 *
 * - 组合清单来自 `dsh --profile <p> --dump-config`（宿侧读取，见 service/plugin-inventory.ts）；
 * - 可选 / 实验性插件来自 dsh 自带的 official-bundles 目录（service/plugin-catalog.ts），
 *   启用 = 往 profile 的 `dsh.profile.bundles` 里加一项（service/plugin-bundles.ts）；
 * - 组件行启停写 profile 用户层 `cordis.patch.yml`（service/plugin-patch.ts）；
 * - 两类改动都只提示「重启服务」后生效，`!!js` 条件行只展示、不给开关。
 */
export async function renderPluginsSection(
	containerEl: HTMLElement,
	context: SettingsRenderContext,
): Promise<void> {
	const { host } = context;
	const rootEl = containerEl.createDiv({ cls: 'dsh-settings-plugins' });

	const headEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-head' });
	const summaryEl = headEl.createDiv({ cls: 'dsh-settings-plugins-summary', text: '正在读取 dsh 插件清单…' });
	const actionsEl = headEl.createDiv({ cls: 'dsh-settings-plugins-actions' });
	const reloadButtonEl = actionsEl.createEl('button', { cls: 'dsh-settings-plugins-button', text: '重新读取' });
	reloadButtonEl.setAttr('type', 'button');
	const restartButtonEl = actionsEl.createEl('button', { cls: 'dsh-settings-plugins-button', text: '重启服务' });
	restartButtonEl.setAttr('type', 'button');

	const hintEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-hint' });
	hintEl.appendText('组件行启停写入 profile 的 ');
	hintEl.createEl('code', { text: 'cordis.patch.yml' });
	hintEl.appendText('；可选 / 实验性插件写入 profile 的 ');
	hintEl.createEl('code', { text: 'package.json' });
	hintEl.appendText(' 的 ');
	hintEl.createEl('code', { text: 'dsh.profile.bundles' });
	hintEl.appendText('。两类改动都会先备份（.bak-时间戳），点「重启服务」后生效；条件行由 dsh 按运行环境决定，不提供开关。');

	const noticeEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-notice' });
	const optionalEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-optional' });
	const filterEl = rootEl.createEl('input', { cls: 'dsh-settings-plugins-filter', type: 'text' });
	filterEl.placeholder = '筛选组件（名称或 id）';
	const errorEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-error' });
	const listEl = rootEl.createDiv({ cls: 'dsh-settings-plugins-list' });

	/** 已展开的 bundle（默认全部折叠）。 */
	const expanded = new Set<string>();
	/** 可选 / 实验性插件卡片是否展开（默认收起，0034）。 */
	let catalogOpen = false;
	let inventory: DshPluginInventory | null = null;
	let catalog: DshOptionalCatalog | null = null;
	let filter = '';
	/** 正在写入的目标（'row:<id>' / 'bundle:<name>'），用于禁用所有开关。 */
	let busyKey: string | null = null;

	const setNotice = (text: string, isError: boolean): void => {
		noticeEl.setText(text);
		noticeEl.toggleClass('is-error', isError);
	};

	const renderSummary = (): void => {
		if (inventory === null) {
			summaryEl.setText('正在读取 dsh 插件清单…');
			return;
		}
		const counts = countRows(inventory.bundles.flatMap((bundle) => bundle.rows));
		summaryEl.setText(
			'profile ' +
				inventory.profile +
				' · dsh ' +
				(inventory.dshVersion ?? '版本未知') +
				' · ' +
				String(inventory.bundles.length) +
				' 个 bundle / ' +
				String(counts.all) +
				' 个组件（运行中 ' +
				String(counts.on) +
				' · 已停用 ' +
				String(counts.off) +
				' · 条件 ' +
				String(counts.conditional) +
				'）',
		);
		summaryEl.setAttr(
			'title',
			'profile 目录：' + inventory.profileDir + '\npatch：' + inventory.patchPath,
		);
	};

	/**
	 * 可选 / 实验性插件：上方独立卡片（不在组合结果里，所以不参与筛选）。
	 *
	 * 默认收起，只显示标题与统计；点标题（或键盘 Enter / 空格）展开列表（0034）。
	 * 展开状态由闭包持有，开关写库触发的重绘不会把它重置。
	 */
	const renderCatalog = (): void => {
		optionalEl.empty();
		if (catalog === null) return;
		if (catalog.message !== undefined) {
			optionalEl.createDiv({ cls: 'dsh-settings-plugins-catalog-hint', text: catalog.message });
			return;
		}
		const enabledCount = catalog.bundles.filter((bundle) => bundle.enabled).length;
		const cardEl = optionalEl.createDiv({ cls: 'dsh-settings-plugins-bundle' });
		const headEl2 = cardEl.createDiv({ cls: 'dsh-settings-plugins-bundle-head' });
		const arrowEl2 = headEl2.createDiv({ cls: 'dsh-settings-plugins-bundle-arrow' });
		setIcon(arrowEl2, catalogOpen ? 'chevron-down' : 'chevron-right');
		const titleEl = headEl2.createDiv({ cls: 'dsh-settings-plugins-bundle-title' });
		titleEl.createDiv({ cls: 'dsh-settings-plugins-bundle-name', text: '可选 / 实验性插件' });
		titleEl.createDiv({
			cls: 'dsh-settings-plugins-bundle-meta',
			text:
				'随 dsh 安装提供、默认未启用 · 共 ' +
				String(catalog.bundles.length) +
				' 个 · 已启用 ' +
				String(enabledCount) +
				' 个 · 启用后重启服务生效',
		});
		headEl2.setAttr('role', 'button');
		headEl2.setAttr('tabindex', '0');
		headEl2.setAttr('aria-expanded', catalogOpen ? 'true' : 'false');
		headEl2.onclick = () => {
			catalogOpen = !catalogOpen;
			renderCatalog();
		};
		headEl2.onkeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			headEl2.click();
		};
		if (!catalogOpen) return;
		const rowsEl = cardEl.createDiv({ cls: 'dsh-settings-plugins-rows' });
		for (const bundle of catalog.bundles) renderBundleRow(rowsEl, bundle);
		if (catalog.onDemand.length > 0) {
			const hintEl2 = cardEl.createDiv({ cls: 'dsh-settings-plugins-catalog-hint' });
			hintEl2.appendText('另有需要先安装的插件：');
			hintEl2.createEl('code', { text: catalog.onDemand.join('、') });
			hintEl2.appendText('（用 ');
			hintEl2.createEl('code', {
				text: 'dsh plugin --profile ' + (inventory?.profile ?? DEFAULT_SETTINGS.profile) + ' add <包名>',
			});
			hintEl2.appendText(' 安装后重启服务）。');
		}
	};

	const renderBundleRow = (parentEl: HTMLElement, bundle: DshOptionalBundle): void => {
		const rowEl = parentEl.createDiv({
			cls:
				'dsh-settings-plugins-row' +
				(bundle.enabled ? '' : ' is-off') +
				(bundle.available ? '' : ' is-conditional'),
		});
		const metaEl = rowEl.createDiv({ cls: 'dsh-settings-plugins-row-meta' });
		const nameEl = metaEl.createDiv({ cls: 'dsh-settings-plugins-row-name', text: bundle.title });
		nameEl.setAttr('title', bundle.name);
		const details: string[] = [bundle.name];
		if (bundle.version !== null) details.push('v' + bundle.version);
		if (bundle.experimental) details.push('实验性');
		if (!bundle.available) details.push('安装里解析不到，暂不能启用');
		metaEl.createDiv({ cls: 'dsh-settings-plugins-row-id', text: details.join(' · ') });
		if (bundle.description !== '') {
			const descriptionEl = metaEl.createDiv({ cls: 'dsh-settings-plugins-row-desc', text: bundle.description });
			descriptionEl.setAttr('title', bundle.description);
		}
		const controlEl = rowEl.createDiv({ cls: 'dsh-settings-plugins-row-control' });
		if (!bundle.available) {
			controlEl.createDiv({ cls: 'dsh-settings-plugins-row-static', text: '不可用' });
			return;
		}
		const toggle = new ToggleComponent(controlEl);
		toggle.setValue(bundle.enabled);
		toggle.setDisabled(busyKey !== null);
		toggle.onChange((value: boolean) => {
			void applyBundleToggle(bundle, value);
		});
	};

	/** 启用 / 停用一个可选 bundle：host 负责写 profile package.json + 复验 + 失败回滚。 */
	const applyBundleToggle = async (bundle: DshOptionalBundle, enabled: boolean): Promise<void> => {
		if (busyKey !== null) return;
		busyKey = 'bundle:' + bundle.name;
		setNotice('正在写入 ' + bundle.name + ' …', false);
		renderCatalog();
		try {
			await host.setBundleEnabled(bundle.name, enabled);
			bundle.enabled = enabled;
			renderCatalog();
			// bundle 层立刻反映在组合结果里，重读一次让下方分组出现 / 消失。
			await load(true);
			setNotice('已保存：点「重启服务」后生效（备份见 profile 的 package.json.bak-时间戳）。', false);
		} catch (error) {
			setNotice('写入失败：' + errorText(error), true);
		} finally {
			busyKey = null;
			renderCatalog();
		}
	};

	const renderList = (): void => {
		const scrollTop = listEl.scrollTop;
		listEl.empty();
		const query = filter.trim().toLowerCase();
		if (inventory !== null) {
			let shown = 0;
			for (const bundle of inventory.bundles) {
				const rows = query === '' ? bundle.rows : bundle.rows.filter((row) => matches(row, query));
				if (rows.length === 0 && query !== '') continue;
				shown += 1;
				renderBundle(bundle, rows, query !== '' || expanded.has(bundle.name));
			}
			if (shown === 0) listEl.createDiv({ cls: 'dsh-settings-plugins-empty', text: '没有匹配的组件。' });
		}
		listEl.scrollTop = scrollTop;
	};

	const renderBundle = (bundle: DshPluginBundle, rows: DshPluginRow[], open: boolean): void => {
		const cardEl = listEl.createDiv({ cls: 'dsh-settings-plugins-bundle' });
		const bundleHeadEl = cardEl.createDiv({ cls: 'dsh-settings-plugins-bundle-head' });
		const arrowEl = bundleHeadEl.createDiv({ cls: 'dsh-settings-plugins-bundle-arrow' });
		setIcon(arrowEl, open ? 'chevron-down' : 'chevron-right');
		const titleEl = bundleHeadEl.createDiv({ cls: 'dsh-settings-plugins-bundle-title' });
		const nameEl = titleEl.createDiv({ cls: 'dsh-settings-plugins-bundle-name', text: bundle.name });
		nameEl.setAttr('title', bundle.name);
		const counts = countRows(bundle.rows);
		titleEl.createDiv({
			cls: 'dsh-settings-plugins-bundle-meta',
			text:
				(bundle.version === null ? '版本未知' : 'v' + bundle.version) +
				' · 共 ' +
				String(counts.all) +
				' 个组件 · 运行中 ' +
				String(counts.on) +
				' · 已停用 ' +
				String(counts.off) +
				(counts.conditional === 0 ? '' : ' · 条件 ' + String(counts.conditional)),
		});
		bundleHeadEl.setAttr('role', 'button');
		bundleHeadEl.setAttr('tabindex', '0');
		bundleHeadEl.setAttr('aria-expanded', open ? 'true' : 'false');
		bundleHeadEl.onclick = () => {
			if (expanded.has(bundle.name)) expanded.delete(bundle.name);
			else expanded.add(bundle.name);
			renderList();
		};
		bundleHeadEl.onkeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			bundleHeadEl.click();
		};
		if (!open) return;
		const rowsEl = cardEl.createDiv({ cls: 'dsh-settings-plugins-rows' });
		for (const row of rows) renderRow(rowsEl, row);
	};

	const renderRow = (parentEl: HTMLElement, row: DshPluginRow): void => {
		const rowEl = parentEl.createDiv({
			cls:
				'dsh-settings-plugins-row' +
				(row.state === 'off' ? ' is-off' : '') +
				(row.state === 'conditional' ? ' is-conditional' : ''),
		});
		const metaEl = rowEl.createDiv({ cls: 'dsh-settings-plugins-row-meta' });
		const rowNameEl = metaEl.createDiv({ cls: 'dsh-settings-plugins-row-name', text: row.name });
		rowNameEl.setAttr('title', row.name);
		metaEl.createDiv({
			cls: 'dsh-settings-plugins-row-id',
			text:
				row.id +
				' · ' +
				STATE_TEXT[row.state] +
				(row.fromUserPatch ? ' · 用户层覆盖' : ''),
		});
		const controlEl = rowEl.createDiv({ cls: 'dsh-settings-plugins-row-control' });
		if (row.state === 'conditional') {
			controlEl.createDiv({ cls: 'dsh-settings-plugins-row-static', text: '自动' });
			return;
		}
		const toggle = new ToggleComponent(controlEl);
		toggle.setValue(row.state === 'on');
		toggle.setDisabled(busyKey !== null);
		toggle.onChange((value: boolean) => {
			void applyToggle(row, value);
		});
	};

	/** 启停一行：host 负责写 patch + 复验 + 失败回滚。 */
	const applyToggle = async (row: DshPluginRow, enabled: boolean): Promise<void> => {
		if (busyKey !== null) return;
		busyKey = 'row:' + row.id;
		setNotice('正在写入 ' + row.id + ' …', false);
		renderList();
		try {
			await host.setPluginEnabled(row, enabled);
			row.state = enabled ? 'on' : 'off';
			setNotice('已保存：点「重启服务」后生效（备份见 patch 旁的 .bak-时间戳）。', false);
			renderSummary();
		} catch (error) {
			setNotice('写入失败：' + errorText(error), true);
		} finally {
			busyKey = null;
			renderList();
		}
	};

	const load = async (refresh: boolean): Promise<void> => {
		errorEl.empty();
		errorEl.removeClass('is-visible');
		summaryEl.setText('正在读取 dsh 插件清单…');
		const [inventoryResult, catalogResult] = await Promise.allSettled([
			host.getPluginInventory(refresh),
			host.getOptionalCatalog(refresh),
		]);
		if (context.isStale()) return;
		if (inventoryResult.status === 'fulfilled') {
			inventory = inventoryResult.value;
		} else {
			inventory = null;
			errorEl.setText(
				'读取失败：' +
					errorText(inventoryResult.reason) +
					'（确认 dsh 可用、profile 目录存在；详见开发者控制台 [dsh-native-chat] 日志）',
			);
			errorEl.addClass('is-visible');
			summaryEl.setText('读取失败');
		}
		catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : null;
		if (catalogResult.status === 'rejected' && inventory !== null) {
			setNotice('读取可选插件目录失败：' + errorText(catalogResult.reason), true);
		}
		renderSummary();
		renderCatalog();
		renderList();
	};

	reloadButtonEl.onclick = () => {
		void load(true);
	};
	restartButtonEl.onclick = async (): Promise<void> => {
		restartButtonEl.disabled = true;
		restartButtonEl.setText('重启中…');
		setNotice('正在重启 DSH 服务…', false);
		try {
			const result = await host.restartService();
			await load(true);
			if (context.isStale()) return;
			setNotice(
				result.ok
					? result.message
					: '重启失败：' + result.message + (result.hint === undefined ? '' : '；' + result.hint),
				!result.ok,
			);
		} catch (error) {
			setNotice('重启失败：' + errorText(error), true);
		} finally {
			restartButtonEl.disabled = false;
			restartButtonEl.setText('重启服务');
		}
	};
	filterEl.oninput = () => {
		filter = filterEl.value;
		renderList();
	};

	renderSummary();
	renderList();
	await load(false);
}

/** 组件是否命中筛选词（名称或 id，忽略大小写）。 */
function matches(row: DshPluginRow, query: string): boolean {
	return row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query);
}

/** 行状态统计。 */
function countRows(rows: readonly DshPluginRow[]): {
	all: number;
	on: number;
	off: number;
	conditional: number;
} {
	let on = 0;
	let off = 0;
	let conditional = 0;
	for (const row of rows) {
		if (row.state === 'on') on += 1;
		else if (row.state === 'off') off += 1;
		else conditional += 1;
	}
	return { all: rows.length, on, off, conditional };
}
