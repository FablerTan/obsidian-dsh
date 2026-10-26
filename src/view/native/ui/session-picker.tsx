import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeSessionSummary } from '../../../shared/native-types';
import { Icon } from './icon';

function relativeTime(ms: number | null): string {
	if (ms === null) return '';
	const diff = Date.now() - ms;
	if (diff < 60_000) return '刚刚';
	if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
	if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
	return Math.floor(diff / 86_400_000) + ' 天前';
}

export function SessionPicker({
	sessions,
	currentId,
	onSelect,
	onCreate,
	onClose,
}: {
	sessions: NativeSessionSummary[];
	currentId: string | null;
	onSelect: (sessionId: string) => void;
	onCreate: () => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const rows = useMemo(() => {
		const keyword = query.trim().toLowerCase();
		return sessions
			.filter((session) => session.blank !== true || session.id === currentId)
			.filter((session) => {
				if (keyword === '') return true;
				return (
					session.title.toLowerCase().includes(keyword) ||
					session.id.toLowerCase().includes(keyword) ||
					(session.cwd ?? '').toLowerCase().includes(keyword)
				);
			})
			.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
	}, [currentId, query, sessions]);

	return (
		<>
			<div className="dsh-native-popover-backdrop" onMouseDown={onClose} />
			<div className="dsh-native-session-popover" onMouseDown={(event) => event.stopPropagation()}>
				<div className="dsh-native-session-search">
					<Icon name="search" />
					<input
						ref={inputRef}
						value={query}
						placeholder="搜索会话"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
				<button className="dsh-native-session-new" onClick={onCreate}>
					<Icon name="plus" />
					<span>新建会话</span>
				</button>
				<div className="dsh-native-session-list">
					{rows.length === 0 ? (
						<div className="dsh-native-session-empty">
							{query === '' ? '还没有会话' : '没有匹配的会话'}
						</div>
					) : (
						rows.map((session) => (
							<button
								key={session.id}
								className={
									'dsh-native-session-row' +
									(session.id === currentId ? ' is-current' : '')
								}
								onClick={() => onSelect(session.id)}
							>
								<span className="dsh-native-session-title">{session.title}</span>
								<span className="dsh-native-session-meta">
									{session.running ? '● ' : ''}
									{relativeTime(session.updatedAt)}
								</span>
							</button>
						))
					)}
				</div>
			</div>
		</>
	);
}
