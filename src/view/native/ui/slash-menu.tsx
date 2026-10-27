import { useEffect, useRef } from 'react';
import { SKILL_SECTION, type SlashItem } from '../slash';
import { Icon } from './icon';

/**
 * `/` 命令下拉菜单：命令与技能在**同一个列表**里（「技能」分组），没有二级菜单。
 *
 * 只负责渲染与高亮，键盘事件由 Composer 统一处理；行用 mousedown 选中并
 * preventDefault，焦点始终留在输入框（combobox 模式）。
 */
export function SlashMenu({
	items,
	active,
	note,
	onActive,
	onPick,
}: {
	items: SlashItem[];
	active: number;
	/** 技能分组拿不到内容时的说明行（加载中 / 读取失败 / 没有技能）；有技能时不显示。 */
	note: string | null;
	onActive: (index: number) => void;
	onPick: (item: SlashItem) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const row = listRef.current?.querySelector('[data-active="true"]');
		if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
	}, [active, items]);

	const groups: Array<{ title: string; rows: Array<{ item: SlashItem; index: number }> }> = [];
	items.forEach((item, index) => {
		const last = groups[groups.length - 1];
		if (last !== undefined && last.title === item.section) {
			last.rows.push({ item, index });
		} else {
			groups.push({ title: item.section, rows: [{ item, index }] });
		}
	});

	return (
		<div
			className="dsh-native-slash"
			role="listbox"
			aria-label="命令与技能"
			aria-activedescendant={active >= 0 ? 'dsh-native-slash-' + active : undefined}
		>
			<div className="dsh-native-slash-list" ref={listRef}>
				{groups.map((group) => (
					<div key={group.title === '' ? 'commands' : group.title} className="dsh-native-slash-group">
						{group.title === '' ? null : (
							<div className="dsh-native-slash-section">{group.title}</div>
						)}
						{group.rows.map(({ item, index }) => (
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
									{item.kind === 'command' ? '/' + item.name : item.name}
								</span>
								{item.label === '' ? null : (
									<span className="dsh-native-slash-label">{item.label}</span>
								)}
								<span className="dsh-native-slash-meta">{item.description}</span>
							</button>
						))}
					</div>
				))}
				{note === null ? null : (
					<>
						<div className="dsh-native-slash-section">{SKILL_SECTION}</div>
						<div className="dsh-native-slash-empty">{note}</div>
					</>
				)}
			</div>
		</div>
	);
}
