import type { App, EventRef } from 'obsidian';
import type { NativeNote } from '../../shared/native-types';

/**
 * 记住最后一次激活的 Markdown 笔记。
 *
 * 原生聊天视图本身是 ItemView，获得焦点后 `workspace.getActiveFile()` 可能返回 null；
 * 如果每次都直接读，会把「当前笔记」清空。这里只在真正打开 Markdown 文件时更新，
 * 其他 active-leaf-change 保持上一次的值。
 */
export class NoteTracker {
	private current: NativeNote | null = null;
	private readonly listeners = new Set<() => void>();
	private readonly refs: EventRef[] = [];

	constructor(private readonly app: App) {
		this.refs.push(
			app.workspace.on('file-open', () => this.refresh()),
			app.workspace.on('active-leaf-change', () => this.refresh()),
		);
		this.refresh();
	}

	refresh(): void {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md') return;
		this.set({ path: file.path, name: file.basename });
	}

	getSnapshot = (): NativeNote | null => this.current;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	dispose(): void {
		for (const ref of this.refs) this.app.workspace.offref(ref);
		this.refs.length = 0;
		this.listeners.clear();
	}

	private set(next: NativeNote): void {
		if (this.current?.path === next.path && this.current.name === next.name) return;
		this.current = next;
		for (const listener of [...this.listeners]) listener();
	}
}
