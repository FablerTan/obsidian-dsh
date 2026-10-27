import { FileSystemAdapter, requestUrl, type App } from 'obsidian';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDshPage } from './constants';
import type { Probe, ProbeResult } from './types';

/** 当前 vault 的绝对路径（桌面端由 FileSystemAdapter 提供，移动端退回 home）。 */
export function vaultPath(app: App): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
	return os.homedir();
}

/** 绝对化并解析符号链接（路径不存在时退回原路径）。 */
function canonicalPath(value: string): string {
	const absolute = path.resolve(value);
	try {
		return fs.realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}

/**
 * 会话 cwd 是否落在 vault 内（vault 根目录或其子目录）。
 * 原生聊天只用它展示「当前 Obsidian 仓库」的项目会话；null / 空串不匹配。
 * 比较前做 normalize + realpath，避免尾斜杠 / 符号链接 / Windows 大小写造成误判。
 */
export function projectPathWithin(cwd: string | null, vault: string): boolean {
	if (cwd === null || cwd.trim() === '' || vault.trim() === '') return false;
	const fold = (value: string): string =>
		process.platform === 'win32' ? value.toLowerCase() : value;
	const root = fold(path.normalize(canonicalPath(vault)));
	const target = fold(path.normalize(canonicalPath(cwd)));
	if (target === root) return true;
	return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * 基于 Obsidian requestUrl 的可信探测。
 *
 * requestUrl 不受 CORS 限制、能读到真实状态码与正文，因此可以区分「dsh 在跑」
 * 「dsh 在跑但需要 token（0.2.x）」与「端口被别的程序占用」—— 这是 fetch 的
 * opaque 响应做不到的。
 * 自带超时竞速：requestUrl 没有 timeout 参数，慢响应按 down 处理。
 */
export function createDshProbe(timeoutMs = 1500): Probe {
	return async (url: string): Promise<ProbeResult> => {
		const request = requestUrl({ url, method: 'GET', throw: false })
			.then((response): ProbeResult => {
				if (response.status === 200) return isDshPage(response.text) ? 'running' : 'foreign';
				// 0.2.x：裸 URL 需要浏览器会话 token，正文是固定提示；
				// 用这段正文与陌生程序的 401 区分，避免误判成「需要 token 的 dsh」。
				if (response.status === 401 && response.text.includes('dsh web authentication required')) {
					return 'auth';
				}
				return 'foreign';
			})
			.catch((): ProbeResult => 'down');
		const timeout = new Promise<ProbeResult>((resolve) => {
			setTimeout(() => resolve('down'), timeoutMs);
		});
		return Promise.race([request, timeout]);
	};
}
