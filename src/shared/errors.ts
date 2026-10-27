/** 把 unknown 形式的错误转成可读文案：Error 取 message，其余直接 String。 */
export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
