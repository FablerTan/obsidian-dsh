import { useEffect, useRef } from 'react';
import { SKILL_SECTION, type SlashItem } from '../slash';
import { Icon } from './icon';

/**
 * `/` 命令下拉菜单：本地命令 / dsh 命令 / 技能在**同一个列表**里
 * （命令组无标题、技能组「技能」），没有二级菜单。
 *
 * 只负责渲染与高亮，键盘事件由 Composer 统一处理；行用 mousedown 选中并
 * preventDefault，焦点始终留在输入框（combobox 模式）。
 */
export function SlashMenu({
	items,
	active,
	commandNote,
	skillNote,
	onActive,
	onPick,
}: {
	items: SlashItem[];
	active: number;
	/** 命令组拿不到内容 / 全部被范围过滤时的说明行（有命令行时不显示）。 */
	commandNote: string | null;
	/** 技能分组拿不到内容时的说明行（有技能行时不显示）。 */
	skillNote: string | null;
	onActive: (index: number) => void;
	onPick: (item: SlashItem) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const row = listRef.current?.querySelector('[data-active="true"]');
		if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
	}, [active, items, commandNote, skillNote]);

	const rows = items.map((item, index) => ({ item, index }));
	const commandRows = rows.filter((row) => row.item.section === '');
	const skillRows = rows.filter((row) => row.item.section !== '');

	const renderRow = (row: { item: SlashItem; index: number }) => {
		const { item, index } = row;
		return (
			<button
				key={item.key}
				id={'dsh-native-slash-' + index}
				type="button"
				role="option"
				aria-selected={index === active}
				aria-disabled={item.disabled}
				data-active={index === active}
				disabled={item.disabled}
				className={
					'dsh-native-slash-item' +
					(index === active ? ' is-active' : '') +
					(item.disabled ? ' is-disabled' : '')
				}
				title={item.description}
				onMouseEnter={() => onActive(index)}
				onMouseDown={(event) => {
					event.preventDefault();
					if (item.disabled) return;
					onPick(item);
				}}
			>
				<span className="dsh-native-slash-icon">
					<Icon name={item.icon} size={14} />
				</span>
				<span className="dsh-native-slash-name">
					{item.kind === 'skill' ? item.name : '/' + item.name}
				</span>
				{item.label === '' ? null : (
					<span className="dsh-native-slash-label">{item.label}</span>
				)}
				<span className="dsh-native-slash-meta">{item.description}</span>
			</button>
		);
	};

	return (
		<div
			className="dsh-native-slash"
			role="listbox"
			aria-label="命令与技能"
			aria-activedescendant={active >= 0 ? 'dsh-native-slash-' + active : undefined}
		>
			<div className="dsh-native-slash-list" ref={listRef}>
				{commandRows.length === 0 ? null : (
					<div className="dsh-native-slash-group">{commandRows.map(renderRow)}</div>
				)}
				{commandNote === null ? null : (
					<div className="dsh-native-slash-empty">{commandNote}</div>
				)}
				{skillRows.length === 0 && skillNote === null ? null : (
					<div className="dsh-native-slash-group">
						<div className="dsh-native-slash-section">{SKILL_SECTION}</div>
						{skillRows.map(renderRow)}
						{skillNote === null ? null : (
							<div className="dsh-native-slash-empty">{skillNote}</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
