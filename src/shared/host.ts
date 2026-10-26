import { FileSystemAdapter, requestUrl, type App } from 'obsidian';
import * as os from 'os';
import { isDshPage } from './constants';
import type { Probe, ProbeResult } from './types';

/** 当前 vault 的绝对路径（桌面端由 FileSystemAdapter 提供，移动端退回 home）。 */
export function vaultPath(app: App): string {
	const adapter = app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
	return os.homedir();
}

/**
 * 基于 Obsidian requestUrl 的可信探测。
 *
 * requestUrl 不受 CORS 限制、能读到真实状态码与正文，因此可以区分「dsh 在跑」
 * 「dsh 在跑但需要 token（0.2.1+）」与「端口被别的程序占用」—— 这是 fetch 的
 * opaque 响应做不到的（见 service/probe.ts）。
 * 自带超时竞速：requestUrl 没有 timeout 参数，慢响应按 down 处理。
 */
export function createDshProbe(timeoutMs = 1500): Probe {
	return async (url: string): Promise<ProbeResult> => {
		const request = requestUrl({ url, method: 'GET', throw: false })
			.then((response): ProbeResult => {
				if (response.status === 200) return isDshPage(response.text) ? 'running' : 'foreign';
				// 0.2.1+：裸 URL 需要浏览器会话 token，正文是固定提示；
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
