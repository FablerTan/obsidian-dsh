import { App, Modal, Notice, TextComponent } from 'obsidian';
import type {
	NativeModelGroup,
	NativeModelSelection,
	NativeModels,
	NativePermissions,
} from '../../../shared/native-types';

/**
 * 原生聊天里的三个浮层菜单（模型 / 权限 / 更多）。
 *
 * 用 React + 普通 DOM 而不是 Obsidian `Menu`：右栏视图里 `Menu.showAtPosition`
 * 在当前桌面端不会把菜单挂到 document 上（dom 创建了但 isConnected=false），
 * 用自带浮层行为一致、也能在 CDP 回归里断言。
 */

interface MenuShellProps {
	className?: string;
	onClose: () => void;
	children: React.ReactNode;
}

function MenuShell({ className, onClose, children }: MenuShellProps) {
	return (
		<>
			<div className="dsh-native-popover-backdrop" onMouseDown={onClose} />
			<div
				className={'dsh-native-menu ' + (className ?? '')}
				onMouseDown={(event) => event.stopPropagation()}
			>
				{children}
			</div>
		</>
	);
}

function sameSelection(
	current: NativeModelSelection | null,
	provider: string,
	model: string,
	effort?: string,
): boolean {
	return (
		current !== null &&
		current.provider === provider &&
		current.model === model &&
		(current.reasoningEffort ?? undefined) === effort
	);
}

function ModelGroupRows({
	group,
	showTitle,
	current,
	onSelect,
}: {
	group: NativeModelGroup;
	showTitle: boolean;
	current: NativeModelSelection | null;
	onSelect: (selection: NativeModelSelection) => void;
}) {
	const effortsOf = (modelId: string): { id: string; name: string }[] => {
		const model = group.models.find((entry) => entry.id === modelId);
		return Array.isArray(model?.reasoning?.efforts) ? model!.reasoning!.efforts : [];
	};
	return (
		<>
			{showTitle ? <div className="dsh-native-menu-title">{group.name}</div> : null}
			{group.models.map((model) => {
				const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : [];
				return (
					<div key={group.id + '/' + model.id}>
						<button
							className={
								'dsh-native-menu-item' +
								(sameSelection(current, group.id, model.id) ? ' is-checked' : '')
							}
							onClick={() => onSelect({ provider: group.id, model: model.id })}
						>
							<span className="dsh-native-menu-check">
								{sameSelection(current, group.id, model.id) ? '✓' : ''}
							</span>
							<span>{model.name}</span>
						</button>
						{efforts.map((effort) => (
							<button
								key={effort.id}
								className={
									'dsh-native-menu-item is-sub' +
									(sameSelection(current, group.id, model.id, effort.id)
										? ' is-checked'
										: '')
								}
								onClick={() =>
									onSelect({
										provider: group.id,
										model: model.id,
										reasoningEffort: effort.id,
									})
								}
								title={effort.description}
							>
								<span className="dsh-native-menu-check">
									{sameSelection(current, group.id, model.id, effort.id) ? '✓' : ''}
								</span>
								<span>{effort.name}</span>
							</button>
						))}
					</div>
				);
			})}
		</>
	);
}

export function ModelMenu({
	models,
	onSelect,
	onRefresh,
	onOpenSettings,
	onClose,
}: {
	models: NativeModels | null;
	onSelect: (selection: NativeModelSelection) => void;
	onRefresh: () => void;
	onOpenSettings: () => void;
	onClose: () => void;
}) {
	const groups = Array.isArray(models?.groups) ? models.groups : [];
	const failures = models?.failures ?? [];
	const pick = (selection: NativeModelSelection): void => {
		onSelect(selection);
		onClose();
	};
	return (
		<MenuShell className="is-bottom" onClose={onClose}>
			{groups.length === 0 ? (
				<div className="dsh-native-menu-empty">
					{models === null ? '模型加载中…' : '没有可用模型'}
				</div>
			) : (
				groups.map((group) => (
					<ModelGroupRows
						key={group.id}
						group={group}
						showTitle={groups.length > 1}
						current={models?.current ?? null}
						onSelect={pick}
					/>
				))
			)}
			{failures.length > 0 ? (
				<>
					<div className="dsh-native-menu-sep" />
					{failures.map((failure) => (
						<div key={failure.id} className="dsh-native-menu-empty">
							{failure.name}：加载失败
						</div>
					))}
				</>
			) : null}
			<div className="dsh-native-menu-sep" />
			<button
				className="dsh-native-menu-item"
				onClick={() => {
					onRefresh();
					onClose();
				}}
			>
				<span className="dsh-native-menu-check" />
				<span>刷新模型列表</span>
			</button>
			<button
				className="dsh-native-menu-item"
				onClick={() => {
					onOpenSettings();
					onClose();
				}}
			>
				<span className="dsh-native-menu-check" />
				<span>打开 DSH 设置</span>
			</button>
		</MenuShell>
	);
}

export function PermissionMenu({
	app,
	permissions,
	onSelect,
	onClose,
}: {
	app: App;
	permissions: NativePermissions;
	onSelect: (preset: string) => void;
	onClose: () => void;
}) {
	const options = (Array.isArray(permissions.options) ? permissions.options : []).filter(
		(option) => option.value !== 'custom',
	);
	return (
		<MenuShell className="is-bottom" onClose={onClose}>
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
							<span>{option.name}</span>
						</button>
					);
				})
			)}
		</MenuShell>
	);
}

export function SessionMenu({
	hasSession,
	onNew,
	onRename,
	onRefresh,
	onClose,
}: {
	hasSession: boolean;
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
		<MenuShell className="is-top" onClose={onClose}>
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

export class ConfirmModal extends Modal {
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
