import { Notice, type App } from 'obsidian';
import { VIEW_TYPE_DSH } from '../shared/constants';

/** 打开右侧面板：已存在则聚焦原面板，否则新建（避免重复开多个）。 */
export async function openDshPanel(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_DSH);
	const leaf = existing[0];
	if (leaf !== undefined) {
		await app.workspace.revealLeaf(leaf);
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return;
	}
	const newLeaf = app.workspace.getRightLeaf(false);
	if (newLeaf === null) {
		new Notice('无法创建 DSH 面板：右侧栏不可用');
		return;
	}
	await newLeaf.setViewState({ type: VIEW_TYPE_DSH, active: true });
	app.workspace.revealLeaf(newLeaf);
}
