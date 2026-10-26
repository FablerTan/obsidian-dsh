import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el === null) return;
		el.empty();
		setIcon(el, name);
	}, [name]);
	return <span ref={ref} className="dsh-native-icon" style={{ width: size, height: size }} />;
}
