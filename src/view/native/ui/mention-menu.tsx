import { useEffect, useRef } from 'react';
import type { MentionKind } from '../mention';
import { Icon } from './icon';

/** 菜单里的一行：当前笔记 / 文件 / 文件夹。 */
export interface MentionItem {
	/** 稳定的 key（`note` 或 vault 相对路径）。 */
	key: string;
	kind: 'note' | MentionKind;
	/** 显示名：当前笔记行固定为「当前笔记」。 */
	label: string;
	/** vault 相对路径，显示为灰色说明。 */
	path: string;
	/** 选中后写进草稿的文本（已含 @ / 引号）。 */
	mention: string;
	/** 分组标题。 */
	section: string;
}

function iconOf(kind: MentionItem['kind']): string {
	if (kind === 'note') return 'file-text';
	return kind === 'directory' ? 'folder' : 'file';
}

/**
 * @ 引用下拉菜单：只负责渲染与高亮，键盘事件由 Composer 统一处理。
 * 行用 mousedown 选中并 preventDefault，焦点始终留在输入框（combobox 模式）。
 */
export function MentionMenu({
	items,
	active,
	onActive,
	onPick,
	onDrill,
}: {
	items: MentionItem[];
	active: number;
	onActive: (index: number) => void;
	onPick: (item: MentionItem) => void;
	/** 目录行的「进入目录」箭头（等价于 Tab）。 */
	onDrill: (item: MentionItem) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const row = listRef.current?.querySelector('[data-active="true"]');
		if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
	}, [active, items]);

	const groups: Array<{ title: string; rows: Array<{ item: MentionItem; index: number }> }> = [];
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
			className="dsh-native-mention"
			role="listbox"
			aria-label="引用文件"
			aria-activedescendant={active >= 0 ? 'dsh-native-mention-' + active : undefined}
		>
			<div className="dsh-native-mention-list" ref={listRef}>
				{groups.map((group) => (
					<div key={group.title} className="dsh-native-mention-group">
						{group.title === '' ? null : (
							<div className="dsh-native-mention-section">{group.title}</div>
						)}

						{group.rows.map(({ item, index }) => (
							<button
								key={item.key}
								id={'dsh-native-mention-' + index}
								type="button"
								role="option"
								aria-selected={index === active}
								data-active={index === active}
								className={
									'dsh-native-mention-item' + (index === active ? ' is-active' : '')
								}
								title={item.path}
								onMouseEnter={() => onActive(index)}
								onMouseDown={(event) => {
									event.preventDefault();
									onPick(item);
								}}
							>
								<span className="dsh-native-mention-icon">
									<Icon name={iconOf(item.kind)} size={14} />
								</span>
								<span className="dsh-native-mention-name">
									{item.label}
									{item.kind === 'directory' ? '/' : ''}
								</span>
								<span className="dsh-native-mention-path">{item.path}</span>
								{item.kind === 'directory' ? (
									<span
										className="dsh-native-mention-drill"
										title="进入目录（Tab）"
										aria-hidden="true"
										onMouseDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onDrill(item);
										}}
									>
										<Icon name="chevron-right" size={14} />
									</span>
								) : null}
							</button>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
