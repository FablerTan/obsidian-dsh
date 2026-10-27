import { useState } from 'react';
import type {
	NativeTeamMember,
	NativeTeamProjection,
	NativeTeamTask,
} from '../../../shared/native-types';
import { Icon } from './icon';
import { MenuShell } from './menu-shell';

/**
 * 只读团队浮层（0035 / 路径 B）：Lead 会话的 agentTeam 投影。
 *
 * 与 dsh Web 的团队面板对齐：roster（运行中 / 空闲 / 创建中 / 失败 + 模型标签）
 * 与共享任务板（状态、负责人、依赖、就绪、写入范围与重叠警告）。区别是**不可导航**：
 * 队友等待授权时只能提示（B 路径不打开成员会话），处理请到 dsh 桌面端 / Web。
 */

type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'failed';

const MEMBER_STATUS_TEXT: Record<MemberStatus, string> = {
	running: '运行中',
	inactive: '空闲',
	provisioning: '创建中',
	failed: '失败',
};

const MEMBER_DOT_CLASS: Record<MemberStatus, string> = {
	running: 'is-running',
	inactive: 'is-idle',
	provisioning: 'is-provisioning',
	failed: 'is-failed',
};

function memberStatus(member: NativeTeamMember): MemberStatus {
	if (member.phase === 'failed') return 'failed';
	if (member.phase === 'provisioning') return 'provisioning';
	return member.running === true ? 'running' : 'inactive';
}

type TaskTone = 'idle' | 'warning' | 'ongoing' | 'done';

function taskTone(task: NativeTeamTask): TaskTone {
	if (task.status === 'completed') return 'done';
	if (task.status === 'in_progress') return 'ongoing';
	return task.ready ? 'idle' : 'warning';
}

function taskStatusText(task: NativeTeamTask): string {
	if (task.status === 'completed') return '已完成';
	if (task.status === 'in_progress') return '进行中';
	return task.ready ? '待开始' : '被阻塞';
}

function MemberRow({ member }: { member: NativeTeamMember }) {
	const status = memberStatus(member);
	return (
		<div
			className={
				'dsh-native-team-member' + (member.pendingInteraction ? ' has-pending' : '')
			}
		>
			<span
				className={'dsh-native-team-dot ' + MEMBER_DOT_CLASS[status]}
				aria-hidden="true"
			/>
			<div className="dsh-native-team-member-text">
				<div className="dsh-native-team-member-head">
					<span className="dsh-native-team-member-name">{member.name}</span>
					<span className="dsh-native-team-tag">
						{member.role === 'lead' ? 'Lead' : '队友'}
					</span>
					{member.pendingInteraction ? (
						<span
							className="dsh-native-team-badge is-pending"
							title="该成员正在等待授权或回答问题；当前面板只提示，处理请到 dsh 桌面端 / Web 打开它的会话。"
						>
							等待授权
						</span>
					) : null}
				</div>
				<div className="dsh-native-team-member-meta">
					<span>{MEMBER_STATUS_TEXT[status]}</span>
					{member.model === null ? null : <span>模型：{member.model}</span>}
				</div>
				{member.error === undefined ? null : (
					<div className="dsh-native-team-member-error">{member.error}</div>
				)}
			</div>
		</div>
	);
}

function TaskCard({ task }: { task: NativeTeamTask }) {
	const [expanded, setExpanded] = useState(false);
	const long = task.description.length > 96 || task.description.includes('\n');
	return (
		<article className="dsh-native-team-task">
			<div className="dsh-native-team-task-head">
				<span
					className={'dsh-native-team-dot ' + taskTone(task)}
					aria-hidden="true"
				/>
				<span className="dsh-native-team-task-subject">{task.subject}</span>
				<span className="dsh-native-team-task-status">{taskStatusText(task)}</span>
			</div>
			{task.description === '' ? null : (
				<>
					<p
						className={
							'dsh-native-team-task-desc' + (expanded ? '' : ' is-clamped')
						}
					>
						{task.description}
					</p>
					{long ? (
						<button
							className="dsh-native-team-task-toggle"
							onClick={() => setExpanded((value) => !value)}
						>
							{expanded ? '收起' : '展开'}
						</button>
					) : null}
				</>
			)}
			<div className="dsh-native-team-task-meta">
				<span className="dsh-native-team-task-id">{task.id}</span>
				<span>负责人：{task.ownerName ?? '未分配'}</span>
				{task.status === 'pending' ? (
					<span>{task.ready ? '可开始' : '被依赖阻塞'}</span>
				) : null}
				{task.blockedBy.length === 0 ? null : (
					<span>依赖：{task.blockedBy.join('、')}</span>
				)}
				{task.writeScopes.length === 0 ? null : (
					<span>写入范围：{task.writeScopes.join('、')}</span>
				)}
				{task.writeScopeWarnings.map((warning) => (
					<span key={warning} className="dsh-native-team-task-warning">
						{warning}
					</span>
				))}
			</div>
		</article>
	);
}

export function TeamPanel({
	team,
	anchor,
	onClose,
}: {
	team: NativeTeamProjection;
	anchor: DOMRect;
	onClose: () => void;
}) {
	return (
		<MenuShell
			anchor={{ rect: anchor, side: 'below' }}
			className="dsh-native-team-panel"
			onClose={onClose}
		>
			<div className="dsh-native-team" role="dialog" aria-label="智能体团队">
				<div className="dsh-native-team-header">
					<Icon name="users" size={14} />
					<span className="dsh-native-team-headline">智能体团队</span>
					<span className="dsh-native-team-counts">
						{team.members.length} 名成员 · {team.tasks.length} 个任务
					</span>
				</div>
				{team.failure === undefined ? null : (
					<div className="dsh-native-team-failure" role="alert">
						{team.failure}
					</div>
				)}
				<section className="dsh-native-team-section">
					<div className="dsh-native-team-section-title">成员</div>
					<div className="dsh-native-team-members">
						{team.members.map((member) => (
							<MemberRow key={member.id} member={member} />
						))}
					</div>
				</section>
				<section className="dsh-native-team-section">
					<div className="dsh-native-team-section-title">任务</div>
					{team.tasks.length === 0 ? (
						<div className="dsh-native-team-empty">
							还没有共享任务；队友用团队任务工具创建后会出现在这里。
						</div>
					) : (
						<div className="dsh-native-team-tasks">
							{team.tasks.map((task) => (
								<TaskCard key={task.id} task={task} />
							))}
						</div>
					)}
				</section>
			</div>
		</MenuShell>
	);
}
