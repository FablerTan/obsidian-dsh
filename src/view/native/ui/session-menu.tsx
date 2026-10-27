import { Modal, Notice, TextComponent, type App } from 'obsidian';
import { MenuShell, type MenuAnchor } from './menu-shell';

/** 会话菜单：新建 / 重命名 / 刷新。 */
export function SessionMenu({
	hasSession,
	anchor,
	onNew,
	onRename,
	onRefresh,
	onClose,
}: {
	hasSession: boolean;
	anchor: MenuAnchor;
	onNew: () => void;
	onRename: () => void;
	onRefresh: () => void;
	onClose: () => void;
}) {
	const run = (action: () => void) => () => {
		onClose();
		action();
	};
	return (
		<MenuShell anchor={anchor} onClose={onClose}>
			<button className="dsh-native-menu-item" onClick={run(onNew)}>
				<span className="dsh-native-menu-check" />
				<span>新建会话</span>
			</button>
			<div className="dsh-native-menu-sep" />
			<button
				className="dsh-native-menu-item"
				disabled={!hasSession}
				onClick={hasSession ? run(onRename) : undefined}
			>
				<span className="dsh-native-menu-check" />
				<span>重命名会话</span>
			</button>
			<button className="dsh-native-menu-item" onClick={run(onRefresh)}>
				<span className="dsh-native-menu-check" />
				<span>刷新会话列表</span>
			</button>
		</MenuShell>
	);
}

/** 重命名会话的输入弹窗（Enter 提交，空标题拦截）。 */
export class RenameSessionModal extends Modal {
	constructor(
		app: App,
		private readonly initial: string,
		private readonly onSubmit: (title: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('重命名会话');
		const input = new TextComponent(this.contentEl);
		input.setValue(this.initial);
		input.inputEl.addClass('dsh-native-rename-input');
		const row = this.contentEl.createDiv({ cls: 'dsh-native-modal-actions' });
		const cancel = row.createEl('button', { text: '取消' });
		cancel.onclick = () => this.close();
		const submit = row.createEl('button', { text: '保存', cls: 'mod-cta' });
		const save = (): void => {
			const title = input.getValue().trim();
			if (title === '') {
				new Notice('标题不能为空');
				return;
			}
			this.close();
			this.onSubmit(title);
		};
		submit.onclick = save;
		input.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				save();
			}
		});
		window.setTimeout(() => {
			input.inputEl.focus();
			input.inputEl.select();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
