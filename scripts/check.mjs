#!/usr/bin/env node
/**
 * obsidian-dsh — 提交前检查（npm run check）
 *
 * 默认检查工作区；加 --staged 时额外检查暂存集（pre-commit 钩子使用）。
 * 覆盖 AGENTS.md 的硬规则：
 *   - manifest.json / package.json / versions.json 版本三处一致
 *   - 不引入运行时依赖，保持 isDesktopOnly
 *   - tsc -noEmit -skipLibCheck 通过
 *   - main.js 与当前源码的 esbuild 生产构建逐字节一致
 *   - 暂存集不含 .DS_Store / data.json / node_modules / 技能缓存
 *   - 源码或构建配置变动时，main.js 必须一起暂存且是最新构建
 *
 * 只读检查：构建在内存中完成（write: false），不会改写 main.js。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createBuildOptions } from '../esbuild.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedMode = process.argv.includes('--staged');

class CheckError extends Error {}

function assert(condition, message) {
	if (!condition) throw new CheckError(message);
}

/** staged 模式优先读索引内容（即本次提交会包含的版本），否则读工作区。 */
function readJson(file) {
	if (stagedMode) {
		try {
			return JSON.parse(execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'utf8' }));
		} catch {
			// 索引里还没有这个文件（例如首次提交前）→ 退回工作区
		}
	}
	return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
}

function checkVersions() {
	const pkg = readJson('package.json');
	const manifest = readJson('manifest.json');
	const versions = readJson('versions.json');

	assert(
		pkg.version === manifest.version,
		`package.json (${pkg.version}) 与 manifest.json (${manifest.version}) 版本不一致`,
	);

	const keys = Object.keys(versions);
	assert(keys.length > 0, 'versions.json 为空');
	const latest = keys[keys.length - 1];
	assert(
		latest === pkg.version,
		`versions.json 最新键 ${latest} 与当前版本 ${pkg.version} 不一致（只在 minAppVersion 变化时追加）`,
	);
	assert(
		versions[pkg.version] === manifest.minAppVersion,
		`versions.json[${pkg.version}] (${versions[pkg.version]}) 与 manifest.minAppVersion (${manifest.minAppVersion}) 不一致`,
	);
	assert(manifest.isDesktopOnly === true, 'manifest.json 必须保持 isDesktopOnly: true');

	const runtimeDeps = [
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.peerDependencies ?? {}),
	];
	assert(
		runtimeDeps.length === 0,
		`package.json 只能有 devDependencies，发现运行时依赖：${runtimeDeps.join(', ')}`,
	);

	return pkg.version;
}

function checkTypes() {
	const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
	assert(existsSync(tsc), '找不到 node_modules/typescript，请先 npm install');
	try {
		execFileSync(process.execPath, [tsc, '-noEmit', '-skipLibCheck'], {
			cwd: root,
			stdio: 'pipe',
			encoding: 'utf8',
		});
	} catch (error) {
		const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
		throw new CheckError(`tsc -noEmit -skipLibCheck 失败${output ? `:\n${output}` : ''}`);
	}
}

async function buildMain() {
	try {
		const result = await esbuild.build({
			...createBuildOptions(true),
			write: false,
			logLevel: 'silent',
		});
		const output = result.outputFiles?.find((file) => path.basename(file.path) === 'main.js');
		assert(output !== undefined, 'esbuild 未产出 main.js');
		return Buffer.from(output.contents);
	} catch (error) {
		if (error instanceof CheckError) throw error;
		throw new CheckError(`esbuild 构建失败：${error.message}`);
	}
}

function stagedFiles() {
	let output;
	try {
		output = execFileSync(
			'git',
			['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
			{ cwd: root, encoding: 'utf8' },
		);
	} catch {
		throw new CheckError('--staged 只能在 git 仓库中运行');
	}
	return output.split('\0').filter(Boolean);
}

const FORBIDDEN = [
	{ pattern: /(^|\/)\.DS_Store$/, label: '.DS_Store' },
	{ pattern: /(^|\/)data\.json$/, label: 'data.json（本机运行时设置）' },
	{ pattern: /(^|\/)node_modules\//, label: 'node_modules/' },
	{ pattern: /(^|\/)skills\/[^/]+\/data\/cache\//, label: '技能缓存 skills/*/data/cache/' },
];

function checkStaged(files, builtMain) {
	const bad = [];
	for (const file of files) {
		for (const rule of FORBIDDEN) {
			if (rule.pattern.test(file)) bad.push(`${file}（${rule.label}）`);
		}
	}
	assert(bad.length === 0, `暂存集包含不应入库的文件：\n${bad.join('\n')}`);

	const staged = new Set(files);
	const sourceTouched = files.some(
		(file) =>
			file.startsWith('src/') ||
			file === 'esbuild.config.mjs' ||
			file === 'tsconfig.json',
	);
	if (sourceTouched) {
		assert(staged.has('main.js'), 'src/ 或构建配置有改动，但 main.js 未一起暂存（先 npm run build）');
	}

	if (staged.has('main.js')) {
		let stagedMain;
		try {
			stagedMain = execFileSync('git', ['show', ':main.js'], { cwd: root });
		} catch {
			throw new CheckError('无法读取暂存的 main.js');
		}
		assert(
			stagedMain.equals(builtMain),
			'暂存的 main.js 与当前源码构建结果不一致（重新 npm run build 并 git add main.js）',
		);
	}
}

async function main() {
	const version = checkVersions();
	console.log(`[check] 版本 ${version} 三处一致`);
	console.log('[check] 无运行时依赖，isDesktopOnly = true');

	checkTypes();
	console.log('[check] tsc -noEmit -skipLibCheck 通过');

	const builtMain = await buildMain();
	const diskMain = path.join(root, 'main.js');
	assert(existsSync(diskMain), 'main.js 不存在（先 npm run build）');
	assert(
		readFileSync(diskMain).equals(builtMain),
		'main.js 与当前源码构建结果不一致（先 npm run build）',
	);
	console.log('[check] main.js 与当前源码构建一致');

	if (stagedMode) {
		const files = stagedFiles();
		checkStaged(files, builtMain);
		console.log(`[check] 暂存集检查通过（${files.length} 个文件）`);
	}

	console.log('[check] ✓ 全部通过');
}

try {
	await main();
} catch (error) {
	if (error instanceof CheckError) {
		console.error(`[check] ✗ ${error.message}`);
	} else {
		console.error(`[check] ✗ 未预期错误：${error?.stack ?? error}`);
	}
	process.exitCode = 1;
}
