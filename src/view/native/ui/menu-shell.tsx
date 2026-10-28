import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';

/**
 * 原生聊天浮层的公共骨架：锚定定位 + 背板 + 二级浮层。
 *
 * 位置由触发按钮的 `DOMRect` 决定（absolute + 视口 clamp），不写死坐标；
 * 具体菜单（模型 / 权限 / 会话）只关心内容，各自在独立文件里。
 */

export interface MenuAnchor {
	rect: DOMRect;
	side: 'above' | 'below';
}

const MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * 浮层自己的定位：贴着锚点展开，空间不足时换边 / 内收。
 * `grow` = 允许浮层随内容变高（高度上限取锚点下方可用空间，而不是首次测量的内容高度）：
 * 列表类浮层（子智能体目录）用它，避免内容加载 / 行高变化后被锁死在一个很矮的高度里。
 */
function useMenuStyle(anchor: MenuAnchor, grow: boolean): {
	panelRef: RefObject<HTMLDivElement>;
	style: CSSProperties;
} {
	const panelRef = useRef<HTMLDivElement>(null);
	const [style, setStyle] = useState<CSSProperties>({
		left: anchor.rect.left,
		top: anchor.side === 'below' ? anchor.rect.bottom + 6 : undefined,
		visibility: 'hidden',
	});
	useLayoutEffect(() => {
		const el = panelRef.current;
		if (el === null) return;
		// 浮层用 absolute 定位在 .dsh-native-app 里：fixed 会被侧栏 / popout 的
		// 包含块（transform 等）带偏，坐标必须相对宿主容器算。
		const hostEl = el.offsetParent instanceof HTMLElement ? el.offsetParent : null;
		const hostRect = hostEl?.getBoundingClientRect();
		const hostLeft = hostRect?.left ?? 0;
		const hostTop = hostRect?.top ?? 0;
		const hostWidth = hostRect?.width ?? window.innerWidth;
		const hostHeight = hostRect?.height ?? window.innerHeight;
		const width = el.offsetWidth;
		const naturalHeight = el.offsetHeight;
		const anchorLeft = anchor.rect.left - hostLeft;
		const anchorTop = anchor.rect.top - hostTop;
		const anchorBottom = anchor.rect.bottom - hostTop;
		const aboveRoom = anchorTop - 6 - MARGIN;
		const belowRoom = hostHeight - anchorBottom - 6 - MARGIN;
		let side = anchor.side;
		if (side === 'above' && aboveRoom < 120 && belowRoom > aboveRoom) side = 'below';
		if (side === 'below' && belowRoom < 120 && aboveRoom > belowRoom) side = 'above';
		const room = side === 'above' ? aboveRoom : belowRoom;
		// 列表类浮层：上限取「可用空间」，列表变长时跟着长高（不锁在首帧内容高度）。
		const maxHeight = grow
			? Math.max(1, Math.min(room, Math.round(hostHeight * 0.72)))
			: Math.max(1, Math.min(naturalHeight, room));
		const left = clamp(anchorLeft, MARGIN, hostWidth - width - MARGIN);
		const top =
			side === 'above'
				? Math.max(MARGIN, anchorTop - 6 - maxHeight)
				: clamp(anchorBottom + 6, MARGIN, hostHeight - maxHeight - MARGIN);
		setStyle({ left, top, maxHeight, visibility: 'visible' });
	}, [anchor.rect, anchor.side]);
	return { panelRef, style };
}

interface MenuShellProps {
	anchor: MenuAnchor;
	className?: string;
	/** 允许浮层随内容变高（最多约 72% 视口 / 锚点下方空间）；默认按首帧内容高度。 */
	grow?: boolean;
	onClose: () => void;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	children: ReactNode;
}

/** 一级浮层：背板点掉 / Esc 关闭，内容由调用方给。 */
export function MenuShell({
	anchor,
	className,
	grow = false,
	onClose,
	onMouseEnter,
	onMouseLeave,
	children,
}: MenuShellProps) {
	const { panelRef, style } = useMenuStyle(anchor, grow);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	return (
		<>
			<div className="dsh-native-popover-backdrop" onMouseDown={onClose} />
			<div
				ref={panelRef}
				className={'dsh-native-menu ' + (className ?? '')}
				style={style}
				onMouseDown={(event) => event.stopPropagation()}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
			>
				{children}
			</div>
		</>
	);
}

export interface OpenSubmenu {
	provider: string;
	model: string;
	rect: DOMRect;
}

/** 二级浮层（思考层级）：贴着一级行右侧，越界翻到左侧。 */
export function SubmenuPanel({
	rowRect,
	onEnter,
	onLeave,
	children,
}: {
	rowRect: DOMRect;
	onEnter: () => void;
	onLeave: () => void;
	children: ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
	useLayoutEffect(() => {
		const el = panelRef.current;
		if (el === null) return;
		const hostEl = el.offsetParent instanceof HTMLElement ? el.offsetParent : null;
		const hostRect = hostEl?.getBoundingClientRect();
		const hostLeft = hostRect?.left ?? 0;
		const hostTop = hostRect?.top ?? 0;
		const hostWidth = hostRect?.width ?? window.innerWidth;
		const hostHeight = hostRect?.height ?? window.innerHeight;
		const width = el.offsetWidth;
		const height = el.offsetHeight;
		const rowLeft = rowRect.left - hostLeft;
		const rowRight = rowRect.right - hostLeft;
		const rowTop = rowRect.top - hostTop;
		let left = rowRight + 4;
		if (left + width > hostWidth - MARGIN) {
			const flipped = rowLeft - width - 4;
			left = flipped >= MARGIN ? flipped : hostWidth - MARGIN - width;
		}
		left = Math.max(MARGIN, left);
		const top = clamp(rowTop, MARGIN, hostHeight - height - MARGIN);
		setStyle({ left, top, visibility: 'visible' });
	}, [rowRect]);
	return (
		<div
			ref={panelRef}
			className="dsh-native-menu is-submenu"
			style={style}
			onMouseDown={(event) => event.stopPropagation()}
			onMouseEnter={onEnter}
			onMouseLeave={onLeave}
		>
			{children}
		</div>
	);
}
