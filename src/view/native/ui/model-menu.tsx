import { useEffect, useRef, useState } from 'react';
import type { NativeModelSelection, NativeModels } from '../../../shared/native-types';
import { Icon } from './icon';
import { MenuShell, SubmenuPanel, type MenuAnchor, type OpenSubmenu } from './menu-shell';

function sameModel(
	current: NativeModelSelection | null,
	provider: string,
	model: string,
): boolean {
	return current !== null && current.provider === provider && current.model === model;
}

/** 模型菜单：一级列模型，有思考层级的模型悬停/聚焦出二级菜单。 */
export function ModelMenu({
	models,
	anchor,
	onSelect,
	onRefresh,
	onExplainSettings,
	onClose,
}: {
	models: NativeModels | null;
	anchor: MenuAnchor;
	onSelect: (selection: NativeModelSelection) => void;
	onRefresh: () => void;
	onExplainSettings: () => void;
	onClose: () => void;
}) {
	const groups = Array.isArray(models?.groups) ? models.groups : [];
	const failures = models?.failures ?? [];
	const current = models?.current ?? null;
	const [submenu, setSubmenu] = useState<OpenSubmenu | null>(null);
	const closeTimer = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		},
		[],
	);

	const cancelClose = (): void => {
		if (closeTimer.current === null) return;
		window.clearTimeout(closeTimer.current);
		closeTimer.current = null;
	};

	const scheduleClose = (): void => {
		cancelClose();
		closeTimer.current = window.setTimeout(() => setSubmenu(null), 160);
	};

	const openSubmenu = (provider: string, model: string, target: HTMLElement): void => {
		cancelClose();
		setSubmenu({ provider, model, rect: target.getBoundingClientRect() });
	};

	const pick = (selection: NativeModelSelection): void => {
		onSelect(selection);
		onClose();
	};

	const submenuGroup =
		submenu === null ? undefined : groups.find((group) => group.id === submenu.provider);
	const submenuModel =
		submenuGroup === undefined || submenu === null
			? undefined
			: submenuGroup.models.find((model) => model.id === submenu.model);
	const submenuEfforts = Array.isArray(submenuModel?.reasoning?.efforts)
		? submenuModel.reasoning.efforts
		: [];
	const submenuChecked =
		submenu !== null && sameModel(current, submenu.provider, submenu.model)
			? (current?.reasoningEffort ?? submenuModel?.reasoning?.defaultEffort)
			: undefined;

	const effortName = (provider: string, model: string): string | null => {
		if (!sameModel(current, provider, model)) return null;
		const group = groups.find((entry) => entry.id === provider);
		const target = group?.models.find((entry) => entry.id === model);
		const efforts = Array.isArray(target?.reasoning?.efforts) ? target.reasoning.efforts : [];
		const effort =
			efforts.find((entry) => entry.id === current?.reasoningEffort) ??
			efforts.find((entry) => entry.id === target?.reasoning?.defaultEffort);
		return effort?.name ?? null;
	};

	return (
		<>
			<MenuShell
				anchor={anchor}
				onClose={onClose}
				onMouseLeave={scheduleClose}
				onMouseEnter={cancelClose}
			>
			{groups.length === 0 ? (
				<div className="dsh-native-menu-empty">
					{models === null ? '模型加载中…' : '没有可用模型'}
				</div>
			) : (
				groups.map((group) => (
					<div key={group.id}>
						{groups.length > 1 ? (
							<div className="dsh-native-menu-title">{group.name}</div>
						) : null}
						{group.models.map((model) => {
							const efforts = Array.isArray(model.reasoning?.efforts)
								? model.reasoning.efforts
								: [];
							const checked = sameModel(current, group.id, model.id);
							const active = effortName(group.id, model.id);
							const expanded =
								submenu !== null &&
								submenu.provider === group.id &&
								submenu.model === model.id;
							return (
								<button
									key={group.id + '/' + model.id}
									className={
										'dsh-native-menu-item' +
										(checked ? ' is-checked' : '') +
										(expanded ? ' is-expanded' : '')
									}
									title={model.description}
									onMouseEnter={(event) => {
										cancelClose();
										if (efforts.length > 0) {
											openSubmenu(group.id, model.id, event.currentTarget);
										}
									}}
									onFocus={(event) => {
										if (efforts.length > 0) {
											openSubmenu(group.id, model.id, event.currentTarget);
										}
									}}
									onClick={(event) => {
										if (efforts.length === 0) {
											pick({ provider: group.id, model: model.id });
											return;
										}
										openSubmenu(group.id, model.id, event.currentTarget);
									}}
								>
									<span className="dsh-native-menu-check">{checked ? '✓' : ''}</span>
									<span className="dsh-native-menu-label">{model.name}</span>
									{active !== null ? (
										<span className="dsh-native-menu-meta">{active}</span>
									) : null}
									{efforts.length > 0 ? (
										<Icon name="chevron-right" size={14} />
									) : null}
								</button>
							);
						})}
					</div>
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
					onExplainSettings();
					onClose();
				}}
			>
				<span className="dsh-native-menu-check" />
				<span>模型配置说明</span>
			</button>
			</MenuShell>
			{submenu !== null && submenuEfforts.length > 0 ? (
				<SubmenuPanel
					key={submenu.provider + '/' + submenu.model}
					rowRect={submenu.rect}
					onEnter={cancelClose}
					onLeave={scheduleClose}
				>
					{submenuEfforts.map((effort) => {
						const checked = submenuChecked === effort.id;
						return (
							<button
								key={effort.id}
								className={
									'dsh-native-menu-item' + (checked ? ' is-checked' : '')
								}
								title={effort.description}
								onClick={() =>
									pick({
										provider: submenu.provider,
										model: submenu.model,
										reasoningEffort: effort.id,
									})
								}
							>
								<span className="dsh-native-menu-check">
									{checked ? '✓' : ''}
								</span>
								<span className="dsh-native-menu-label">{effort.name}</span>
							</button>
						);
					})}
				</SubmenuPanel>
			) : null}
		</>
	);
}
