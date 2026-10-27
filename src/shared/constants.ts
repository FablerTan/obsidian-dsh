/** 原生聊天视图：插件在 Obsidian 中注册的标识，注册与打开都必须用它。 */
export const VIEW_TYPE_NATIVE_CHAT = 'dsh-native-chat';

/** 旧版官方 webview 面板的视图类型；仅用于升级时迁移已经打开的 leaf。 */
export const LEGACY_VIEW_TYPE_DSH = 'dsh-web';

/** dsh web-app 注入的引导标记，用来确认「这个端口上响应的是 dsh」而不只是「有东西在监听」。 */
const DSH_PAGE_MARKER = '__ModuleLoader__';

/** 判断响应正文是否 dsh 的 HTML 页面。 */
export function isDshPage(body: string): boolean {
	return body.includes(DSH_PAGE_MARKER);
}
