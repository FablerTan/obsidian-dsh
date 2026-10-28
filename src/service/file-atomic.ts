import { existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';

/**
 * profile 文件写入的公共约定（0031 组件行启停 / 0032 bundle 启停共用）。
 *
 * 两个写入目标（cordis.patch.yml 与 package.json）用同一套语义：
 * - 写前备份：备份名 .bak-<本地时间戳>，同秒内重复写自动加序号，绝不覆盖旧备份；
 * - 原子写：临时文件 + rename（mode 0600），失败时清掉临时文件再抛出；
 * - mtime 读取：让缓存感知文件被外部改动（不存在 / 读不到返回 0）。
 *
 * 纯 Node 逻辑，不 import obsidian；失败回滚由调用方按返回值处理。
 */

/** 写前备份（本地时间，同秒自动加序号）。返回备份文件路径。 */
export function createBackup(file: string, content: string): string {
	const now = new Date();
	const pad = (value: number): string => String(value).padStart(2, '0');
	// 本地时间，形如 20261027-153322（用户看文件名就能对上「刚才那次改动」）。
	const stamp =
		String(now.getFullYear()) +
		pad(now.getMonth() + 1) +
		pad(now.getDate()) +
		'-' +
		pad(now.getHours()) +
		pad(now.getMinutes()) +
		pad(now.getSeconds());
	let backupPath = file + '.bak-' + stamp;
	let suffix = 1;
	while (existsSync(backupPath)) {
		backupPath = file + '.bak-' + stamp + '-' + String(suffix);
		suffix += 1;
	}
	writeFileSync(backupPath, content, { mode: 0o600 });
	return backupPath;
}

/** 原子写：临时文件 + rename（与 dsh 的 writeFileAtomic 同一思路）。 */
export function writeAtomic(file: string, content: string): void {
	const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp-' + String(process.pid));
	try {
		writeFileSync(tmp, content, { mode: 0o600 });
		renameSync(tmp, file);
	} catch (error) {
		try {
			unlinkSync(tmp);
		} catch {
			// 临时文件可能根本没写出来
		}
		throw error;
	}
}

/** 文件的 mtime（毫秒截断；不存在 / 读不到为 0）。用于让缓存感知外部改动。 */
export function safeMtime(file: string): number {
	try {
		return existsSync(file) ? Math.trunc(statSync(file).mtimeMs) : 0;
	} catch {
		return 0;
	}
}
