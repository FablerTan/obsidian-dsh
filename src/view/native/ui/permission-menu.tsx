import { Modal, type App } from 'obsidian';
import type { NativePermissions } from '../../../shared/native-types';
import { MenuShell, type MenuAnchor } from './menu-shell';
import { PermissionIcon } from './permission-icon';

/** 危险操作的确认弹窗（目前只有「完全访问」用它）。 */
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			title: string;
			body: string;
			confirmLabel: string;
			onConfirm: () => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl('p', { text: this.options.body });
		const row = this.contentEl.createDiv({ cls: 'dsh-native-modal-actions' });
		const cancel = row.createEl('button', { text: '取消' });
		cancel.onclick = () => this.close();
		const confirm = row.createEl('button', {
			text: this.options.confirmLabel,
			cls: 'mod-warning',
		});
		confirm.onclick = () => {
			this.close();
			this.options.onConfirm();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 权限菜单：只列可切换预设；自定义（custom）不在此处出现。 */
export function PermissionMenu({
	app,
	anchor,
	permissions,
	onSelect,
	onClose,
}: {
	app: App;
	anchor: MenuAnchor;
	permissions: NativePermissions;
	onSelect: (preset: string) => void;
	onClose: () => void;
}) {
	const options = (Array.isArray(permissions.options) ? permissions.options : []).filter(
		(option) => option.value !== 'custom',
	);
	return (
		<MenuShell anchor={anchor} onClose={onClose}>
			{options.length === 0 ? (
				<div className="dsh-native-menu-empty">当前没有可切换的权限</div>
			) : (
				options.map((option) => {
					const checked = option.value === permissions.currentValue;
					return (
						<button
							key={option.value}
							className={'dsh-native-menu-item' + (checked ? ' is-checked' : '')}
							title={option.description}
							onClick={() => {
								onClose();
								if (option.value === 'danger-full-access') {
									new ConfirmModal(app, {
										title: '启用完全访问',
										body: '完全访问会让 agent 在 vault 之外执行命令和读写文件。只在你信任当前会话与模型时启用。',
										confirmLabel: '启用',
										onConfirm: () => onSelect(option.value),
									}).open();
									return;
								}
								onSelect(option.value);
							}}
						>
							<span className="dsh-native-menu-check">{checked ? '✓' : ''}</span>
							<PermissionIcon value={option.value} />
							<span className="dsh-native-menu-label">{option.name}</span>
						</button>
					);
				})
			)}
		</MenuShell>
	);
}
