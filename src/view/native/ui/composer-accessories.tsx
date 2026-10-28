import type {
	NativeContextUsage,
	NativeModels,
	NativePermissions,
} from '../../../shared/native-types';
import { ContextRing } from './context-meter';
import { Icon } from './icon';
import { modelChip, WhaleMark } from './model-brand';
import { PermissionIcon } from './permission-icon';

function permissionTitle(permissions: NativePermissions | null): string {
	if (permissions === null) return '权限';
	const options = Array.isArray(permissions.options) ? permissions.options : [];
	const option = options.find((entry) => entry.value === permissions.currentValue);
	const name = option?.name ?? permissions.currentValue;
	return option?.description ? name + ' — ' + option.description : name;
}

export function ComposerNotices({
	compacting,
	modelMissing,
	unroutable,
	onExplainSettings,
}: {
	compacting: boolean;
	modelMissing: boolean;
	unroutable: boolean;
	onExplainSettings: () => void;
}) {
	return (
		<>
			{compacting ? (
				<div className="dsh-native-composer-notice" role="status">
					<Icon name="loader" />
					<span>正在压缩会话历史…</span>
				</div>
			) : null}
			{modelMissing || unroutable ? (
				<div className="dsh-native-composer-warning">
					<Icon name="alert-triangle" />
					<span>{modelMissing ? '还没有配置模型' : '当前模型路由不可用'}</span>
					<button onClick={onExplainSettings}>配置说明</button>
				</div>
			) : null}
		</>
	);
}

export function ComposerReadOnlyNotice({
	readOnly,
	running,
	busy,
	onStop,
}: {
	readOnly: string;
	running: boolean;
	busy: boolean;
	onStop: () => void;
}) {
	return (
		<div className="dsh-native-composer-readonly" role="status">
			<Icon name="info" size={14} />
			<span>{readOnly}</span>
			{running ? (
				<button
					className="dsh-native-send is-stop"
					disabled={busy}
					onClick={onStop}
					title="停止"
				>
					<Icon name="square" />
				</button>
			) : null}
		</div>
	);
}

export function ComposerBar({
	ready,
	models,
	permissions,
	context,
	contextOpen,
	onContext,
	onModel,
	onPermission,
	running,
	busy,
	canSend,
	onSend,
	onStop,
}: {
	ready: boolean;
	models: NativeModels | null;
	permissions: NativePermissions | null;
	context: NativeContextUsage | null;
	contextOpen: boolean;
	onContext: (anchor: DOMRect) => void;
	onModel: (anchor: DOMRect) => void;
	onPermission: (anchor: DOMRect) => void;
	running: boolean;
	busy: boolean;
	canSend: boolean;
	onSend: () => void;
	onStop: () => void;
}) {
	const chip = modelChip(models);
	return (
		<div className="dsh-native-composer-bar">
			<div className="dsh-native-composer-left">
				<button
					className="dsh-native-chip is-model"
					disabled={!ready}
					onClick={(event) => onModel(event.currentTarget.getBoundingClientRect())}
					title={chip.title}
					aria-label={'选择模型：' + chip.title}
				>
					{chip.mark === 'whale' ? <WhaleMark height={14} /> : <Icon name="cpu" />}
					{chip.text === '' ? null : <span>{chip.text}</span>}
				</button>
				{permissions !== null ? (
					<button
						className="dsh-native-chip is-permission"
						disabled={!ready}
						onClick={(event) =>
							onPermission(event.currentTarget.getBoundingClientRect())
						}
						title={permissionTitle(permissions)}
						aria-label={'切换权限：' + permissionTitle(permissions)}
					>
						<PermissionIcon value={permissions.currentValue} />
					</button>
				) : null}
			</div>
			<div className="dsh-native-composer-right">
				<ContextRing
					context={context}
					expanded={contextOpen}
					onClick={onContext}
				/>
				{running ? (
					<button
						className="dsh-native-send is-stop"
						disabled={busy}
						onClick={onStop}
						title="停止"
					>
						<Icon name="square" />
					</button>
				) : (
					<button
						className="dsh-native-send"
						disabled={!canSend}
						onClick={onSend}
						title="发送"
					>
						<Icon name="send" />
					</button>
				)}
			</div>
		</div>
	);
}
