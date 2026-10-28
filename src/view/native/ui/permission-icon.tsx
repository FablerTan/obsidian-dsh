import { Icon } from './icon';

/** 权限 chip / 菜单行的图标与色调：不读文字也能分辨当前权限。 */
interface PermissionVisual {
	icon: string;
	tone: string;
}

const VISUALS: Record<string, PermissionVisual> = {
	'read-only': { icon: 'eye', tone: 'var(--text-muted)' },
	'workspace-write': { icon: 'square-pen', tone: 'var(--text-normal)' },
	'danger-full-access': { icon: 'shield-alert', tone: 'var(--text-error)' },
	custom: { icon: 'sliders-horizontal', tone: 'var(--text-muted)' },
};

const FALLBACK: PermissionVisual = { icon: 'shield', tone: 'var(--text-muted)' };

function permissionVisual(value: string): PermissionVisual {
	return VISUALS[value] ?? FALLBACK;
}

export function PermissionIcon({ value, size = 16 }: { value: string; size?: number }) {
	const visual = permissionVisual(value);
	return (
		<span className="dsh-native-permission-icon" style={{ color: visual.tone }}>
			<Icon name={visual.icon} size={size} />
		</span>
	);
}
