import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { DshCommand, DshOptionalBundle, DshOptionalCatalog } from '../shared/types';
import { safeMtime } from './file-atomic';
import { profileDirOf, resolveExecutable } from './plugin-inventory';

/**
 * 「可选 / 实验性插件」目录（0032）。
 *
 * dsh 把一个安装里**随包提供、默认不启用**的插件做成 **optional bundle**：
 * 它们不在 profile 的 `dsh.profile.bundles` 里，所以不会出现在组合结果（--dump-config）中，
 * 0031 的清单自然看不到。官方插件管理面板的「实验性插件」就是这批包，清单来自 dsh 自带的
 * `@deepseek-ai/dsh-official-bundles`（OPTIONAL_BUNDLES / EXPERIMENTAL_BUNDLES）。
 *
 * 这里按 dsh 自己的解析顺序（createRequire(installAnchor).resolve.paths）找到这个包并动态 import，
 * 再逐个解析 bundle 目录读版本与中文标题 / 描述；不复制名单（dsh 版本升级后自动跟随）。
 */

/** 目录缓存：切 tab / 重绘时复用。 */
const CACHE_TTL_MS = 15000;
/** 官方目录包名。 */
const CATALOG_PACKAGE = '@deepseek-ai/dsh-official-bundles';

interface CacheEntry {
	key: string;
	at: number;
	value: DshOptionalCatalog;
}

let cache: CacheEntry | null = null;

/** 清空目录缓存（启用 / 停用 bundle 之后调用）。 */
export function clearOptionalCatalogCache(): void {
	cache = null;
}

interface OptionalCatalogOptions {
	command: DshCommand;
	profile: string;
	/** 跳过缓存（「重新读取」/ 写后复验）。 */
	refresh?: boolean;
}

/** 读「可选 / 实验性插件」目录，附带每个包的启用状态（来自 profile 的 package.json）。 */
export async function readOptionalCatalog(options: OptionalCatalogOptions): Promise<DshOptionalCatalog> {
	const profileDir = profileDirOf(options.profile);
	const profileManifestPath = path.join(profileDir, 'package.json');
	const key = [options.command.cmd, options.command.prefix.join(' '), profileDir, String(safeMtime(profileManifestPath))].join(
		'\u0000',
	);
	if (options.refresh !== true && cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
		return cache.value;
	}

	const bundleList = readProfileBundles(profileManifestPath);
	const catalogDir = resolveCatalogDir(options.command, profileDir);
	const value: DshOptionalCatalog = {
		source: catalogDir,
		bundles: [],
		onDemand: [],
		message: undefined,
	};
	if (catalogDir === null) {
		value.message =
			'这个 dsh 安装没有提供可选插件目录（' + CATALOG_PACKAGE + '），无法列出实验性插件；请确认 dsh 版本与设置里选中的安装。';
		cache = { key, at: Date.now(), value };
		return value;
	}

	let lists: { optional: readonly string[]; experimental: ReadonlySet<string>; onDemand: readonly string[] };
	try {
		lists = await importCatalogLists(catalogDir);
	} catch (error) {
		value.message = '读取可选插件目录失败：' + (error instanceof Error ? error.message : String(error));
		cache = { key, at: Date.now(), value };
		return value;
	}

	const experimental = lists.experimental;
	const bundles: DshOptionalBundle[] = [];
	for (const name of lists.optional) {
		const bundleDir = resolvePackageDir(name, options.command, profileDir);
		const metadata = bundleDir === null ? null : readBundleMetadata(bundleDir);
		bundles.push({
			name,
			title: metadata?.title ?? shortName(name),
			description: metadata?.description ?? '',
			version: metadata?.version ?? null,
			experimental: experimental.has(name),
			enabled: bundleList.includes(name),
			/** 目录里声明了、但这份安装解析不到包（通常是安装不完整）：不能直接启用。 */
			available: metadata !== null,
		});
	}
	value.bundles = bundles;
	value.onDemand = lists.onDemand.filter((name) => !bundleList.includes(name));
	cache = { key, at: Date.now(), value };
	return value;
}

/** 动态 import 官方目录包，取三份名单（名单是纯常量，不依赖 dsh 运行时）。 */
async function importCatalogLists(
	catalogDir: string,
): Promise<{ optional: readonly string[]; experimental: ReadonlySet<string>; onDemand: readonly string[] }> {
	const manifest = readJson(path.join(catalogDir, 'package.json')) as {
		main?: unknown;
		exports?: Record<string, unknown>;
	};
	const entry = entryFileOf(catalogDir, manifest);
	// 优先同步 require：Electron 渲染进程里 `import()` 走浏览器加载器，加载不了 file:// 的 ESM；
	// 而新版 Node（Obsidian 自带的 Node ≥ 22）支持 require(ESM)。旧环境兜底用真正的动态 import。
	let module: Record<string, unknown>;
	try {
		const nodeRequire = createRequire(entry);
		module = nodeRequire(entry) as Record<string, unknown>;
	} catch (requireError) {
		try {
			// 非字面量 specifier 时 esbuild 原样保留原生动态 import()（不会注入 require / eval）。
			// eslint-disable-next-line no-unsanitized/method -- specifier 是按安装目录解析出的本地 file:// URL，不接受用户输入。
			module = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
		} catch {
			throw requireError instanceof Error ? requireError : new Error(String(requireError));
		}
	}
	const lists = module;
	const optional = module.OPTIONAL_BUNDLES;
	const experimental = module.EXPERIMENTAL_BUNDLES;
	const onDemand = module.ON_DEMAND_BUNDLES;
	if (!Array.isArray(optional)) throw new Error('OPTIONAL_BUNDLES 不是数组');
	// EXPERIMENTAL_BUNDLES 是 Set（同一 realm，可直接展开）；其它形态兜底成数组。
	const names = (value: unknown): string[] => {
		if (typeof value === 'object' && value !== null && typeof (value as { has?: unknown }).has === 'function') {
			return [...(value as Set<unknown>)].filter((item): item is string => typeof item === 'string');
		}
		return (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string');
	};
	return {
		optional: optional.filter((item): item is string => typeof item === 'string'),
		experimental: new Set(names(experimental)),
		onDemand: names(onDemand),
	};
}

/** 目录包的入口文件（优先 exports["."].default，其次 main，最后 lib/index.js）。 */
function entryFileOf(catalogDir: string, manifest: { main?: unknown; exports?: Record<string, unknown> }): string {
	const rootExport = manifest.exports?.['.'];
	if (typeof rootExport === 'object' && rootExport !== null) {
		const value = (rootExport as { default?: unknown }).default;
		if (typeof value === 'string') return path.join(catalogDir, value);
	}
	if (typeof rootExport === 'string') return path.join(catalogDir, rootExport);
	if (typeof manifest.main === 'string') return path.join(catalogDir, manifest.main);
	return path.join(catalogDir, 'lib/index.js');
}

/** 按 dsh 的解析顺序找官方目录包（安装锚点优先，其次 profile）。 */
function resolveCatalogDir(command: DshCommand, profileDir: string): string | null {
	for (const anchor of anchorsOf(command, profileDir)) {
		const dir = packageDirFromAnchor(anchor, CATALOG_PACKAGE);
		if (dir !== null) return dir;
	}
	return null;
}

/** 解析一个包的目录（与 dsh 的 resolveBundleDir 相同的锚点顺序）。 */
function resolvePackageDir(name: string, command: DshCommand, profileDir: string): string | null {
	for (const anchor of anchorsOf(command, profileDir)) {
		const dir = packageDirFromAnchor(anchor, name);
		if (dir !== null) return dir;
	}
	return null;
}

/** 与 dsh 一致：安装锚点优先，profile 兜底。 */
function anchorsOf(command: DshCommand, profileDir: string): string[] {
	const anchors: string[] = [];
	const executable = resolveExecutable(command.prefix[0] ?? command.cmd);
	let dir = path.dirname(executable);
	for (let index = 0; index < 4; index += 1) {
		anchors.push(path.join(dir, 'package.json'));
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	anchors.push(path.join(profileDir, 'package.json'));
	return anchors;
}

/** Node 的 node_modules 查找顺序（与 dsh 的 packageDirFromAnchor 相同）。 */
function packageDirFromAnchor(anchor: string, packageName: string): string | null {
	if (!existsSync(anchor)) return null;
	try {
		const searchPaths = createRequire(anchor).resolve.paths(packageName) ?? [];
		for (const searchPath of searchPaths) {
			const candidate = path.join(searchPath, packageName);
			if (existsSync(path.join(candidate, 'package.json'))) return candidate;
		}
	} catch {
		return null;
	}
	return null;
}

/** bundle 目录 → 版本 / 中文标题 / 描述（locale/zh.json 的 meta 优先，其次 manifest description）。 */
function readBundleMetadata(bundleDir: string): { version: string | null; title: string; description: string } | null {
	const manifest = readJson(path.join(bundleDir, 'package.json')) as {
		version?: unknown;
		description?: unknown;
	};
	if (manifest === null) return null;
	const version = typeof manifest.version === 'string' ? manifest.version : null;
	const fallbackDescription = typeof manifest.description === 'string' ? manifest.description : '';
	for (const localeFile of ['zh.json', 'en.json']) {
		const locale = readJson(path.join(bundleDir, 'locale', localeFile)) as {
			meta?: { title?: unknown; description?: unknown };
		};
		if (locale?.meta === undefined) continue;
		const title = typeof locale.meta.title === 'string' ? locale.meta.title : null;
		const description = typeof locale.meta.description === 'string' ? locale.meta.description : null;
		if (title !== null) {
			return {
				version,
				title,
				description: description ?? fallbackDescription,
			};
		}
	}
	return { version, title: shortName(path.basename(bundleDir)), description: fallbackDescription };
}

/** profile package.json 里的 `dsh.profile.bundles`。 */
function readProfileBundles(manifestPath: string): string[] {
	const manifest = readJson(manifestPath) as {
		dsh?: { profile?: { bundles?: unknown } };
	};
	const bundles = manifest?.dsh?.profile?.bundles;
	if (!Array.isArray(bundles)) return [];
	return bundles.filter((item): item is string => typeof item === 'string');
}

/** 读 JSON（不存在 / 非法返回 null）。 */
function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as unknown;
	} catch {
		return null;
	}
}

/** 包名的短名（`@deepseek-ai/dsh-experimental-voice-input-bundle` → `voice-input`）。 */
function shortName(packageName: string): string {
	const unscoped = packageName.startsWith('@') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
	return unscoped.replace(/^dsh-(?:experimental-|client-)?/u, '').replace(/-bundle$/u, '');
}
