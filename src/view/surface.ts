import { logPlugin, logPluginWarn } from '../shared/log';

/**
 * 面板的承载面：优先 Electron <webview>，环境不支持时回退 <iframe>。
 *
 * 为什么不是直接 iframe：dsh 0.2.1+ 的会话 cookie 是 SameSite=Strict，
 * iframe 在 Obsidian 的 app:// 顶层里属于跨站，303 之后不会带 cookie，必然 401；
 * <webview> 的 guest 是独立顶层浏览上下文，Strict cookie 正常。
 *
 * webview 不是 Obsidian 的公开插件 API，但核心 Web viewer / Canvas 网页卡片
 * 都用它（webviewTag 已开），因此这里做能力探测 + 回退，不把 iframe 路径删掉。
 */
export type DshSurfaceKind = 'webview' | 'iframe';

export interface DshSurface {
	readonly kind: DshSurfaceKind;
	/** 换源（端口变更后使用）。 */
	load(url: string): void;
	/**
	 * 重新加载当前地址（或换到新地址后重新加载）。
	 *
	 * 服务后起时承载面已经停在 Chromium 错误页，仅改状态条文案不会重试；
	 * 传 url 用于 dsh 0.2.1+ 每次重启后 token 变化的情况。
	 */
	reload(url?: string): void;
	/** 从 DOM 移除（ItemView 关闭）。 */
	destroy(): void;
	/** 在页面里执行脚本（webview 专用；iframe 会拒绝）。 */
	executeJavaScript<T>(code: string): Promise<T>;
}

/** Electron webview 元素的最小结构（Obsidian 未提供公共类型）。 */
interface ElectronWebviewElement extends HTMLElement {
	src: string;
	partition: string;
	allowpopups: boolean;
	loadURL(url: string): Promise<void>;
	reload(): void;
	executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
}

/** 创建承载面；webview 不可用时回退 iframe。 */
export function createDshSurface(
	parent: HTMLElement,
	url: string,
	partition: string | null,
): DshSurface {
	const webview = createWebview(parent, url, partition);
	if (webview !== null) return webview;
	logPluginWarn('当前环境不支持 webview，面板回退到 iframe（dsh 0.2.1 的 token 登录可能失败）');
	return createIframe(parent, url);
}

/**
 * 创建 webview 并挂载。
 *
 * 用 parent.ownerDocument 而不是全局 document：面板可能位于弹窗（popout）窗口。
 * partition 必须在首次导航前设置；取不到分区时留空，使用默认会话。
 */
function createWebview(parent: HTMLElement, url: string, partition: string | null): DshSurface | null {
	const doc = parent.ownerDocument;
	// webview 在 Electron 里注册为自定义元素；未注册说明当前环境没有 webviewTag，直接回退。
	const registry = doc.defaultView?.customElements;
	if (typeof registry?.get !== 'function') return null;
	if (typeof registry.get('webview') !== 'function') return null;

	const el = doc.createElement('webview') as ElectronWebviewElement;
	if (typeof el.loadURL !== 'function' || typeof el.reload !== 'function') return null;

	// partition / src 必须在挂载前设置：guest 的 session 在 attach 时创建，之后再改分区不生效。
	el.className = 'dsh-surface-webview';
	el.allowpopups = true;
	if (partition !== null) el.partition = partition;
	// 服务未起时停在错误页，稍后由 reload() 重新导航。
	el.setAttribute('src', url);
	parent.appendChild(el);

	logPlugin('面板承载方式: webview' + (partition === null ? '（默认会话）' : '（' + partition + '）'));
	let current = url;
	return {
		kind: 'webview',
		load(next) {
			current = next;
			navigate(el, next);
		},
		reload(next) {
			if (next !== undefined) current = next;
			// 错误页上即使地址没变也要重新发起导航；loadURL 比只改 src 更可靠。
			navigate(el, current);
		},
		destroy() {
			el.remove();
		},
		executeJavaScript<T>(code: string): Promise<T> {
			if (typeof el.executeJavaScript !== 'function') {
				return Promise.reject(new Error('当前 webview 不支持 executeJavaScript'));
			}
			return el.executeJavaScript<T>(code);
		},
	};
}

/** 触发一次导航；用户在加载中再次重载会产生 ERR_ABORTED，属正常现象，吞掉即可。 */
function navigate(el: ElectronWebviewElement, url: string): void {
	try {
		void el.loadURL(url).catch(() => undefined);
	} catch {
		// 某些 Electron 版本在 detached 元素上会同步抛错；忽略，下一轮 reload 会再试。
	}
}

/** iframe 回退：行为与 0003 的 iframe 封装保持一致。 */
function createIframe(parent: HTMLElement, url: string): DshSurface {
	const el = parent.ownerDocument.createElement('iframe');
	el.className = 'dsh-surface-iframe';
	el.src = url;
	parent.appendChild(el);

	let current = url;
	return {
		kind: 'iframe',
		load(next) {
			current = next;
			el.src = next;
		},
		reload(next) {
			if (next !== undefined) current = next;
			el.src = 'about:blank';
			el.src = current;
		},
		destroy() {
			el.remove();
		},
		executeJavaScript<T>(): Promise<T> {
			// iframe 是跨源文档，Obsidian 没有注入脚本的通道；桥在这种情况下不可用。
			return Promise.reject(new Error('iframe 承载不支持 executeJavaScript'));
		},
	};
}
