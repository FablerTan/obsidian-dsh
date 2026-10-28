import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { createBackup, writeAtomic } from './file-atomic';
import { unquoteYaml } from './yaml-scalar';

/**
 * 组件行启停（0031）：只改 profile 用户层 `cordis.patch.yml` 里的 `disabled` 覆盖。
 *
 * 与 dsh 自己的 `writePluginEnabled()` 行为对齐，但不引入 YAML 依赖：
 * - 已有同 id 的覆盖条目 → 改 / 删它的 `disabled`（`!!js` 条件行拒绝改动）；
 * - 没有覆盖条目 → 追加一条 `- id: <id>\n  disabled: true`；
 * - 只有 id + disabled 的条目在重新启用时整条删掉，避免文件里堆无用覆盖；
 * - 写前备份、原子写（临时文件 + rename，mode 0600）、写后由调用方复验，失败自动回滚。
 */

interface TogglePluginOptions {
	/** profile 的用户层 patch 文件。 */
	patchPath: string;
	/** 组合条目的 id。 */
	id: string;
	/** true = 启用（删掉 disabled 覆盖），false = 停用。 */
	enabled: boolean;
	/** 写后复验：返回 false 触发回滚（由调用方用最新组合结果判断）。 */
	verify: () => Promise<boolean>;
}

interface TogglePluginResult {
	/** 文件是否真的被改（已启用且本来没有覆盖条目时为 false）。 */
	changed: boolean;
	/** 写前备份的路径（patch 文件原本不存在时为 null）。 */
	backupPath: string | null;
	/** true 表示复验失败，已恢复写入前的文件。 */
	rolledBack: boolean;
	/** 没有改动 / 回滚时给用户看的原因。 */
	message?: string;
}

interface PatchEdit {
	text: string;
	changed: boolean;
	message?: string;
}

/** 顶层列表项：`- ` 开头（patch 条目 / insert 条目）。 */
const ITEM_LINE = /^-\s/;
/** 条目里的与 id 同级字段（缩进 2）。 */
const FIELD_LINE = /^ {2}([A-Za-z]+):(.*)$/;

/**
 * 计算启停后的 patch 文本（纯函数，可单独冒烟）。
 *
 * @param text 当前 patch 文件内容（不存在时传 `'[]\n'`）。
 * @param id 组合条目 id。
 * @param enabled true = 启用，false = 停用。
 */
function editPatchText(text: string, id: string, enabled: boolean): PatchEdit {
	const source = text === '' ? '[]\n' : text;
	const lines = source.split('\n');
	const items = topLevelItems(lines);
	const target = findItem(lines, items, id);

	if (target === null) {
		if (enabled) return { text: source, changed: false, message: '这一行默认就是启用的，不需要改 patch。' };
		const appended = appendBlock(lines, '- id: ' + yamlScalar(id) + '\n  disabled: true');
		return { text: appended, changed: true };
	}

	const blockEnd = target.end;
	const disabledAt = findDisabledLine(lines, target.start, blockEnd);
	if (disabledAt !== null && lines[disabledAt]?.includes('!!js') === true) {
		return { text: source, changed: false, message: '这一行由 dsh 按运行环境决定是否启用，不能在设置页切换。' };
	}

	if (!enabled) {
		if (disabledAt !== null) {
			const value = (FIELD_LINE.exec(lines[disabledAt] ?? '')?.[2] ?? '').trim();
			if (value === 'true') return { text: source, changed: false, message: '已经是停用状态。' };
			lines[disabledAt] = '  disabled: true';
			return { text: lines.join('\n'), changed: true };
		}
		const nameAt = findFieldLine(lines, target.start, blockEnd, 'name');
		const insertAt = (nameAt ?? target.start) + 1;
		lines.splice(insertAt, 0, '  disabled: true');
		return { text: lines.join('\n'), changed: true };
	}

	// 启用：删掉 disabled 覆盖；只剩 id（+ name）的覆盖条目整条移除。
	if (disabledAt === null) return { text: source, changed: false, message: '这一行默认就是启用的，不需要改 patch。' };
	lines.splice(disabledAt, 1);
	// 删行后行号会移动：重新扫一遍顶层项，确认这一条是否只剩 id / name（与 dsh 的清理行为一致）。
	const itemsAfter = topLevelItems(lines);
	const cursor = itemsAfter.indexOf(target.start);
	const endAfter = cursor === -1 ? lines.length : (itemsAfter[cursor + 1] ?? lines.length);
	if (isOnlyIdAndName(lines, target.start, endAfter - 1)) {
		const removeTo = trimTrailingComments(lines, target.start + 1, endAfter - 1);
		lines.splice(target.start, removeTo - target.start);
	}
	return { text: lines.join('\n'), changed: true };
}

/** 顶层列表项的起始行号。 */
function topLevelItems(lines: string[]): number[] {
	const items: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (ITEM_LINE.test(lines[index] ?? '')) items.push(index);
	}
	return items;
}

interface ItemRange {
	start: number;
	/** 下一个顶层项的行号（或文件末尾）。 */
	end: number;
}

/** 找最后一个 id 匹配的顶层条目（与 dsh 的 findLast 一致：后出现的覆盖优先）。 */
function findItem(lines: string[], items: number[], id: string): ItemRange | null {
	for (let cursor = items.length - 1; cursor >= 0; cursor -= 1) {
		const start = items[cursor];
		if (start === undefined) continue;
		const line = lines[start] ?? '';
		const value = /^- id:\s*(.+)$/.exec(line)?.[1];
		if (value === undefined) continue;
		if (unquoteYaml(value.trim()) !== id) continue;
		const next = items[cursor + 1];
		return { start, end: next ?? lines.length };
	}
	return null;
}

/** 条目块里的 `disabled:` 行号（只认缩进 2 的直接字段）。 */
function findDisabledLine(lines: string[], start: number, end: number): number | null {
	for (let index = start + 1; index < end; index += 1) {
		if (/^ {2}disabled:/.test(lines[index] ?? '')) return index;
	}
	return null;
}

/** 条目块里某个直接字段的行号。 */
function findFieldLine(lines: string[], start: number, end: number, key: string): number | null {
	for (let index = start + 1; index < end; index += 1) {
		const name = FIELD_LINE.exec(lines[index] ?? '')?.[1];
		if (name === key) return index;
	}
	return null;
}

/** 条目块里是否只剩 id 与 name（重新启用时可以整条删掉）。 */
function isOnlyIdAndName(lines: string[], start: number, end: number): boolean {
	for (let index = start + 1; index <= end; index += 1) {
		const line = lines[index] ?? '';
		// 注释 / 空行不算字段（块尾的注释属于下一项，移除时另由 trimTrailingComments 保留）。
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		if (FIELD_LINE.exec(line)?.[1] !== 'name') return false;
	}
	return true;
}

/** 整条移除时，把块尾属于下一项的注释留下：返回可安全删除到的行号。 */
function trimTrailingComments(lines: string[], from: number, end: number): number {
	let cursor = end;
	while (cursor >= from) {
		const line = lines[cursor] ?? '';
		const isComment = line.startsWith('#') || line.trim() === '';
		if (!isComment) break;
		cursor -= 1;
	}
	return cursor + 1;
}

/** 在文件末尾（保留结尾换行）追加一个条目块。 */
function appendBlock(lines: string[], block: string): string {
	const body = lines.join('\n');
	const trimmed = body.replace(/\n+$/u, '');
	const separator = trimmed === '' || trimmed === '[]' ? '' : '\n';
	// 只有 `[]` 的 patch 文件：直接替换成条目列表，保留原有结尾换行。
	if (trimmed === '[]') return block + '\n';
	return trimmed + separator + block + '\n';
}

/** 需要时给 YAML 标量加单引号。 */
function yamlScalar(value: string): string {
	return /^[A-Za-z0-9._-]+$/.test(value) ? value : "'" + value.replaceAll("'", "''") + "'";
}

/** 改一个组件行的启停；写后复验失败会自动回滚。 */
export async function togglePluginEnabled(options: TogglePluginOptions): Promise<TogglePluginResult> {
	const existing = existsSync(options.patchPath);
	const before = existing ? readFileSync(options.patchPath, 'utf8') : '[]\n';
	const edit = editPatchText(before, options.id, options.enabled);
	if (!edit.changed) {
		return { changed: false, backupPath: null, rolledBack: false, message: edit.message };
	}
	const backupPath = existing ? createBackup(options.patchPath, before) : null;
	writeAtomic(options.patchPath, edit.text);
	const ok = await options.verify().catch(() => false);
	if (ok) return { changed: true, backupPath, rolledBack: false };
	try {
		if (backupPath !== null) copyFileSync(backupPath, options.patchPath);
		else if (existsSync(options.patchPath)) unlinkSync(options.patchPath);
	} catch {
		return {
			changed: false,
			backupPath,
			rolledBack: false,
			message: '写入后组合结果没有变化，且自动回滚失败；请用备份 ' + (backupPath ?? '(无)') + ' 手动恢复。',
		};
	}
	return {
		changed: false,
		backupPath,
		rolledBack: true,
		message: '写入后组合结果没有变化，已回滚到写入前的 patch。',
	};
}
