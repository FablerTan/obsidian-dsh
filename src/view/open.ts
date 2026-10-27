import { Notice, type App } from 'obsidian';
import { VIEW_TYPE_NATIVE_CHAT } from '../shared/constants';
import { DshNativeChatView } from './native/native-chat-view';

/** 打开原生聊天视图：固定右栏，重复打开时复用已有 leaf。 */
export async function openNativeChat(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE_NATIVE_CHAT);
	const leaf = existing[0];
	if (leaf !== undefined) {
		await app.workspace.revealLeaf(leaf);
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return;
	}
	const newLeaf = app.workspace.getRightLeaf(false);
	if (newLeaf === null) {
		new Notice('无法打开 DeepSeek Harness：右侧栏不可用');
		return;
	}
	await newLeaf.setViewState({ type: VIEW_TYPE_NATIVE_CHAT, active: true });
	await app.workspace.revealLeaf(newLeaf);
}

/** 取当前原生聊天视图；没有打开时返回 null。 */
export function findNativeChat(app: App): DshNativeChatView | null {
	const leaf = app.workspace.getLeavesOfType(VIEW_TYPE_NATIVE_CHAT)[0];
	const view = leaf?.view;
	return view instanceof DshNativeChatView ? view : null;
}
