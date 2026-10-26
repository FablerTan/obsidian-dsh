import type { Probe, ProbeResult } from '../shared/types';

/**
 * 兜底探测：只判断端口上有没有服务响应。
 *
 * fetch 的 no-cors 是 opaque 响应，读不到状态码与正文，因此这里无法区分 dsh 与别的程序
 * （一律当 running）。插件会注入基于 Obsidian requestUrl 的可信探测（见 shared/host.ts）；
 * 只有脱离 Obsidian 单独跑 service 层时才用这个兜底实现。
 */
export const defaultProbe: Probe = async (url: string): Promise<ProbeResult> => {
	try {
		await fetch(url, {
			method: 'GET',
			mode: 'no-cors',
			cache: 'no-store',
			signal: AbortSignal.timeout(1500),
		});
		return 'running';
	} catch {
		return 'down';
	}
};
