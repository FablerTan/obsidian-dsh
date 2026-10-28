import { copyFileSync, existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { createBackup, writeAtomic } from './file-atomic';

/**
 * bundle 级启用 / 停用（0032）：改 profile `package.json` 的 `dsh.profile.bundles` 数组。
 *
 * 与 dsh 官方面板的 `selectBundle()` 语义一致：随安装提供的 bundle（可选 / 实验性插件）
 * 只靠这个数组选择，不需要 pnpm，也不需要往 dependencies 里加东西。
 * 写前备份、原子写、写后由调用方复验，失败自动回滚（与 0031 的 patch 写入同一套约定）。
 */

interface SetBundleOptions {
	/** profile 目录（$DSH_HOME/profiles/<profile>）。 */
	profileDir: string;
	/** bundle 的包名（如 @deepseek-ai/dsh-experimental-voice-input-bundle）。 */
	name: string;
	enabled: boolean;
	/** 写后复验：返回 false 触发回滚。 */
	verify: () => Promise<boolean>;
}

interface SetBundleResult {
	changed: boolean;
	backupPath: string | null;
	rolledBack: boolean;
	message?: string;
}

interface BundleEdit {
	text: string;
	changed: boolean;
	message?: string;
}

/** 计算启用 / 停用后的 package.json 文本（纯函数，可单独冒烟）。 */
function editBundlesJson(text: string, name: string, enabled: boolean): BundleEdit {
	const source = text === '' ? '{}\n' : text;
	let manifest: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(source);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { text: source, changed: false, message: 'profile 的 package.json 不是对象，未改动。' };
		}
		manifest = parsed as Record<string, unknown>;
	} catch {
		return { text: source, changed: false, message: 'profile 的 package.json 不是合法 JSON，未改动。' };
	}

	const dsh = isRecord(manifest.dsh) ? manifest.dsh : {};
	const profile = isRecord(dsh.profile) ? dsh.profile : {};
	const current = Array.isArray(profile.bundles)
		? profile.bundles.filter((item): item is string => typeof item === 'string')
		: [];
	const has = current.includes(name);
	if (enabled && has) return { text: source, changed: false, message: '这个插件包已经在 profile 里了。' };
	if (!enabled && !has) return { text: source, changed: false, message: '这个插件包不在 profile 里。' };

	profile.bundles = enabled ? [...current, name] : current.filter((item) => item !== name);
	dsh.profile = profile;
	manifest.dsh = dsh;
	return { text: JSON.stringify(manifest, undefined, 2) + '\n', changed: true };
}

/** 改 profile 的 bundle 选择；写后复验失败会自动回滚。 */
export async function setBundleEnabled(options: SetBundleOptions): Promise<SetBundleResult> {
	const manifestPath = path.join(options.profileDir, 'package.json');
	const existing = existsSync(manifestPath);
	if (!existing) {
		return {
			changed: false,
			backupPath: null,
			rolledBack: false,
			message: 'profile 目录里没有 package.json：' + manifestPath,
		};
	}
	const before = readFileSync(manifestPath, 'utf8');
	const edit = editBundlesJson(before, options.name, options.enabled);
	if (!edit.changed) return { changed: false, backupPath: null, rolledBack: false, message: edit.message };

	const backupPath = createBackup(manifestPath, before);
	writeAtomic(manifestPath, edit.text);
	const ok = await options.verify().catch(() => false);
	if (ok) return { changed: true, backupPath, rolledBack: false };
	try {
		copyFileSync(backupPath, manifestPath);
	} catch {
		return {
			changed: false,
			backupPath,
			rolledBack: false,
			message: '写入后组合结果没有变化，且自动回滚失败；请用备份 ' + backupPath + ' 手动恢复。',
		};
	}
	return {
		changed: false,
		backupPath,
		rolledBack: true,
		message: '写入后组合结果没有变化，已回滚到写入前的 package.json。',
	};
}

/** 是否普通对象（排除 null / 数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
