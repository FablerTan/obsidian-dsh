#!/usr/bin/env node
/**
 * obsidian-dsh — 项目审阅扫描器（skills/project-review/scripts/audit.mjs）
 *
 * 用途：为「project-review」技能提供机械证据。只读扫描仓库，默认输出 Markdown，--json 输出单个对象。
 * 用法：node skills/project-review/scripts/audit.mjs [--root <dir>] [--json] [--out <file>] [--top <n>] [--min-block <n>]
 *
 * 约束：只读、零依赖（只用 Node 内置模块）、不联网；有 findings 也 exit 0，参数 / IO 错误 exit 2。
 * 输出确定性：findings 按固定 category 顺序 + file + line + title 排序；除生成时间外连跑两次输出一致。
 * 所有结果都是启发式线索，报告前必须人工复核。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CATEGORY_ORDER = [
	'long-file',
	'unused-export',
	'dead-file',
	'duplicate-block',
	'duplicate-export-name',
	'magic-literal',
	'layer-violation',
	'barrel',
	'cross-package',
	'root-clutter',
	'todo-marker',
	'doc-missing-file',
	'doc-map-missing',
];

const CATEGORY_LABEL = {
	'long-file': '超长文件',
	'unused-export': '无调用方导出',
	'dead-file': '死文件',
	'duplicate-block': '重复代码块',
	'duplicate-export-name': '同名导出',
	'magic-literal': '重复字面量',
	'layer-violation': '分层违规',
	barrel: 'barrel 文件',
	'cross-package': 'src 与 packages 互引',
	'root-clutter': '根目录杂项',
	'todo-marker': '遗留标记',
	'doc-missing-file': '文档断链',
	'doc-map-missing': '改动地图缺登记',
};

const ROOT_ALLOWLIST = new Set([
	'main.js',
	'manifest.json',
	'styles.css',
	'versions.json',
	'data.json',
	'package.json',
	'package-lock.json',
	'tsconfig.json',
	'esbuild.config.mjs',
	'eslint.config.mjs',
	'README.md',
	'AGENTS.md',
	'LICENSE',
	'docs',
	'skills',
	'scripts',
	'packages',
	'src',
	'.dsh',
	'.git',
	'.gitignore',
	'node_modules',
	'.DS_Store',
]);

const MAGIC_WHITELIST = new Set([
	'src/settings/schema.ts',
	'src/shared/constants.ts',
	'src/service/manager.ts',
	'src/service/locator.ts',
]);

const DUPLICATE_EXPORT_DENYLIST = new Set(['Props', 'State', 'Options', 'Config', 'Entry']);

/** 扫描器自身：模式定义里的 TODO / 3081 等字符串不算仓库里的重复字面量或遗留标记。 */
const SELF_REL = 'skills/project-review/scripts/audit.mjs';

/** 允许超长的已知例外：只降级提醒，不算结构问题。 */
const LONG_FILE_EXCEPTIONS = {
	'src/main.ts': '组合根：只做注册 / 装配 / 结果到 Notice 的映射',
	'src/view/native/ui/native-chat-root.tsx': '原生聊天的状态编排器（视图根）',
	'packages/dsh-obsidian-bridge/lib/client.js': '桥的单文件实现（dsh 客户端插件）',
};

const USAGE = [
	'用法：node skills/project-review/scripts/audit.mjs [--root <dir>] [--json] [--out <file>] [--top <n>] [--min-block <n>]',
	'',
	'  --root <dir>     扫描根目录，默认按脚本位置向上找到仓库根',
	'  --json           输出单个 JSON 对象（默认 Markdown）',
	'  --out <file>     把报告写入文件，stdout 只打印写入路径与计数',
	'  --top <n>        Markdown 各列表上限，默认 10',
	'  --min-block <n>  重复代码块最少行数，默认 8',
	'',
	'只读、零依赖。有 findings 也 exit 0；参数 / IO 错误 exit 2。',
].join('\n');

class UsageError extends Error {}

function cmp(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

function isPositiveInt(value) {
	return /^[1-9][0-9]*$/.test(value);
}

function parseArgs(argv) {
	const opts = { root: null, json: false, out: null, top: 10, minBlock: 8, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const eq = arg.indexOf('=');
		const flag = eq > 0 ? arg.slice(0, eq) : arg;
		const inline = eq > 0 ? arg.slice(eq + 1) : null;
		const readValue = () => {
			if (inline !== null) return inline;
			const next = argv[++i];
			if (next === undefined) throw new UsageError(flag + ' 缺少参数值');
			return next;
		};
		if (flag === '--json') {
			opts.json = true;
		} else if (flag === '--root') {
			opts.root = readValue();
		} else if (flag === '--out') {
			opts.out = readValue();
		} else if (flag === '--top') {
			const raw = readValue();
			if (!isPositiveInt(raw)) throw new UsageError('--top 需要正整数，收到：' + raw);
			opts.top = Number(raw);
		} else if (flag === '--min-block') {
			const raw = readValue();
			if (!isPositiveInt(raw)) throw new UsageError('--min-block 需要正整数，收到：' + raw);
			opts.minBlock = Number(raw);
		} else if (flag === '--help' || flag === '-h') {
			opts.help = true;
		} else {
			throw new UsageError('未知参数：' + arg);
		}
	}
	return opts;
}

function defaultRepoRoot() {
	const scriptPath = realpathSync(fileURLToPath(import.meta.url));
	let dir = path.dirname(scriptPath);
	for (let i = 0; i < 6; i++) {
		if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'AGENTS.md'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(path.dirname(scriptPath), '..', '..', '..');
}

function isExcludedRel(rel) {
	const parts = rel.split('/');
	if (parts.indexOf('node_modules') >= 0) return true;
	if (parts.indexOf('.git') >= 0) return true;
	if (parts.indexOf('.dsh') >= 0) return true;
	if (/^skills\/[^/]+\/data(?:\/|$)/.test(rel)) return true;
	if (rel === 'main.js') return true;
	if (/\.d\.ts$/.test(rel)) return true;
	if (rel === 'package-lock.json' || rel === 'data.json') return true;
	return false;
}

function walkFiles(root) {
	const out = [];
	const stack = [{ abs: root, rel: '' }];
	while (stack.length) {
		const current = stack.pop();
		let entries;
		try {
			entries = readdirSync(current.abs, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const rel = current.rel ? current.rel + '/' + entry.name : entry.name;
			if (isExcludedRel(rel)) continue;
			if (entry.isDirectory()) stack.push({ abs: path.join(current.abs, entry.name), rel });
			else if (entry.isFile()) out.push(rel);
		}
	}
	out.sort(cmp);
	return out;
}

function isCodeFile(rel) {
	if (/^src\/.*\.(ts|tsx)$/.test(rel)) return true;
	if (/^packages\/.*\.js$/.test(rel)) return true;
	if (/^scripts\/.*\.mjs$/.test(rel)) return true;
	if (/^skills\/.+\/scripts\/.*\.mjs$/.test(rel)) return true;
	return false;
}

function isDocFile(rel) {
	if (/^docs\/.*\.md$/.test(rel)) return true;
	if (rel === 'README.md' || rel === 'AGENTS.md') return true;
	if (rel === 'skills/README.md') return true;
	if (/^skills\/[^/]+\/SKILL\.md$/.test(rel)) return true;
	return false;
}

/** --root 指向子目录时（没有仓库根标记），按扩展名扫描该根下全部代码 / 文档。 */
function isLooseCodeFile(rel) {
	if (/\.d\.ts$/.test(rel)) return false;
	if (rel === 'main.js' || rel === 'package-lock.json' || rel === 'data.json') return false;
	return /\.(ts|tsx|js|mjs)$/.test(rel);
}

function isLooseDocFile(rel) {
	return /\.md$/.test(rel);
}

function countLines(text) {
	if (!text) return 0;
	const parts = text.split('\n');
	if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
	return parts.length;
}

function buildContext(root) {
	const repoRoot = defaultRepoRoot();
	const allFiles = walkFiles(root);
	const atRepoRoot = existsSync(path.join(root, 'package.json')) && existsSync(path.join(root, 'AGENTS.md'));
	const codeFiles = allFiles.filter((rel) => isCodeFile(rel) || (!atRepoRoot && isLooseCodeFile(rel)));
	const docFiles = allFiles.filter((rel) => isDocFile(rel) || (!atRepoRoot && isLooseDocFile(rel)));
	const codeFileSet = new Set(codeFiles);
	const textCache = new Map();
	const lineCache = new Map();

	const readText = (rel) => {
		let text = textCache.get(rel);
		if (text === undefined) {
			text = readFileSync(path.join(root, rel), 'utf8');
			textCache.set(rel, text);
		}
		return text;
	};
	const linesOf = (rel) => {
		let lines = lineCache.get(rel);
		if (!lines) {
			lines = readText(rel).split('\n').map((line) => line.replace(/\r$/, ''));
			lineCache.set(rel, lines);
		}
		return lines;
	};

	const fileLines = new Map();
	let codeLines = 0;
	for (const rel of codeFiles) {
		const n = countLines(readText(rel));
		fileLines.set(rel, n);
		codeLines += n;
	}
	let docLines = 0;
	for (const rel of docFiles) docLines += countLines(readText(rel));

	const ctx = {
		root,
		repoRoot,
		allFiles,
		codeFiles,
		docFiles,
		codeFileSet,
		readText,
		linesOf,
		fileLines,
		codeLines,
		docLines,
		importsByFile: new Map(),
		exports: [],
		identStats: new Map(),
		docIdentStats: new Map(),
	};

	for (const rel of codeFiles) {
		ctx.importsByFile.set(rel, parseImports(readText(rel)));
		ctx.exports.push(...parseExports(rel, linesOf(rel)));
	}
	buildIdentifierStats(ctx);
	return ctx;
}

function parseImports(text) {
	const out = [];
	const re = /(?:^[ \t]*import[ \t]+['"]([^'"]+)['"])|(?:\bfrom[ \t]*['"]([^'"]+)['"])|(?:\bimport[ \t]*\([ \t]*['"]([^'"]+)['"][ \t]*\))|(?:\brequire[ \t]*\([ \t]*['"]([^'"]+)['"][ \t]*\))/gm;
	let match;
	while ((match = re.exec(text))) {
		const spec = match[1] || match[2] || match[3] || match[4];
		if (!spec) continue;
		const line = text.slice(0, match.index).split('\n').length;
		out.push({ spec, line });
	}
	return out;
}

function parseExports(rel, lines) {
	const out = [];
	const patterns = [
		/^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
		/^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
		/^export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
		/^export\s+(?:interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
	];
	for (let i = 0; i < lines.length; i++) {
		const text = lines[i].trim();
		if (!text.startsWith('export')) continue;
		if (/^export\s+default\b/.test(text)) continue;
		let matched = false;
		for (const pattern of patterns) {
			const match = pattern.exec(text);
			if (match) {
				out.push({ name: match[1], file: rel, line: i + 1, kind: 'declaration' });
				matched = true;
				break;
			}
		}
		if (matched) continue;
		const list = /^export\s+(?:type\s+)?\{([^}]*)\}/.exec(text);
		if (list && !/\bfrom\b/.test(text)) {
			for (const part of list[1].split(',')) {
				const piece = part.trim();
				if (!piece) continue;
				const asMatch = /\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(piece);
				const name = asMatch ? asMatch[1] : piece;
				if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) out.push({ name, file: rel, line: i + 1, kind: 'reexport' });
			}
		}
	}
	return out;
}

function buildIdentifierStats(ctx) {
	for (const rel of ctx.codeFiles) {
		const text = ctx.readText(rel);
		const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
		let match;
		while ((match = re.exec(text))) {
			const name = match[0];
			let stat = ctx.identStats.get(name);
			if (!stat) {
				stat = { total: 0, files: new Map() };
				ctx.identStats.set(name, stat);
			}
			stat.total++;
			stat.files.set(rel, (stat.files.get(rel) || 0) + 1);
		}
	}
	for (const rel of ctx.docFiles) {
		const text = ctx.readText(rel);
		const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
		let match;
		while ((match = re.exec(text))) {
			ctx.docIdentStats.set(match[0], (ctx.docIdentStats.get(match[0]) || 0) + 1);
		}
	}
}

function resolveCodeSpec(ctx, rel, spec) {
	if (!spec.startsWith('.')) return null;
	const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
	const candidates = [
		base,
		base + '.ts',
		base + '.tsx',
		base + '.js',
		base + '.mjs',
		base.replace(/\.js$/, '.ts'),
		base.replace(/\.js$/, '.tsx'),
		base + '/index.ts',
		base + '/index.tsx',
		base + '/index.js',
	];
	for (const candidate of candidates) if (ctx.codeFileSet.has(candidate)) return candidate;
	return null;
}

function domainOf(rel) {
	if (rel === 'src/main.ts') return 'main';
	if (rel.startsWith('src/service/')) return 'service';
	if (rel.startsWith('src/view/')) return 'view';
	if (rel.startsWith('src/settings/')) return 'settings';
	if (rel.startsWith('src/shared/')) return 'shared';
	return null;
}

function finding(category, severity, confidence, file, line, title, evidence, suggestion) {
	return { category, severity, confidence, file, line, title, evidence, suggestion };
}

function firstNumber(text) {
	const match = /[0-9]+/.exec(text);
	return match ? Number(match[0]) : 0;
}

/** 把 --root 下的相对路径换算成仓库根相对路径（--root 指向子树时例外 / 白名单仍按仓库路径判断）。 */
function repoRelative(ctx, rel) {
	const abs = path.resolve(ctx.root, rel);
	const reverse = path.relative(ctx.repoRoot, abs).split(path.sep).join('/');
	if (!reverse || reverse === '..' || reverse.startsWith('../') || path.isAbsolute(reverse)) return rel;
	return reverse;
}

/** 已知路径匹配：仓库路径、子树相对路径都能认（src/main.ts 与 main.ts 都算命中）。 */
function pathMatchesKnown(rel, repoRel, known) {
	if (rel === known || repoRel === known) return true;
	if (repoRel.endsWith('/' + known)) return true;
	if (known.endsWith('/' + repoRel)) return true;
	if (rel.endsWith('/' + known)) return true;
	if (known.endsWith('/' + rel)) return true;
	return false;
}

function qualityCodeFiles(ctx) {
	const quality = ctx.codeFiles.filter((rel) => {
		const repoRel = repoRelative(ctx, rel);
		return repoRel.startsWith('src/') || repoRel.startsWith('packages/');
	});
	// --root 指向 src/ 或 packages/ 子目录时，相对路径不再带前缀：退化为扫描该根下全部代码文件
	if (quality.length > 0) return quality;
	return ctx.codeFiles;
}

function scanLongFiles(ctx) {
	const out = [];
	for (const rel of qualityCodeFiles(ctx)) {
		const n = ctx.fileLines.get(rel);
		if (n < 150) continue;
		const repoRel = repoRelative(ctx, rel);
		const exceptionKey = Object.keys(LONG_FILE_EXCEPTIONS).find((key) => pathMatchesKnown(rel, repoRel, key));
		const exception = exceptionKey ? LONG_FILE_EXCEPTIONS[exceptionKey] : null;
		if (exception) {
			out.push(
				finding(
					'long-file',
					'info',
					'mechanical',
					rel,
					1,
					'超长文件（已知例外）：' + n + ' 行',
					'行数 ' + n + '；已知例外，允许超长（' + exception + '）；理由见 references/checks.md。',
					'保持职责单一；出现可独立成文件的纯逻辑再搬。',
				),
			);
			continue;
		}
		const severity = n >= 500 ? 'high' : n >= 300 ? 'medium' : 'low';
		const level = n >= 500 ? '>=500 强拆信号' : n >= 300 ? '>=300 建议拆分' : '>=150 提示阈值';
		const suggestion =
			n >= 500
				? '强信号：文件明显混装多个职责，按 project-guide 第 5 节拆域；先纯搬运（只移动文件 + 改 import），再改逻辑。'
				: n >= 300
					? '建议拆：单文件超过约 150 行多半混了两个职责；先把纯函数 / 子组件抽到相邻文件，构建通过后再继续。'
					: '提示：观察是否混了两个职责；下次改动该文件前评估是否顺带拆分。';
		const imports = ctx.importsByFile.get(rel) || [];
		out.push(
			finding(
				'long-file',
				severity,
				'mechanical',
				rel,
				1,
				'超长文件：' + n + ' 行',
				'行数 ' + n + '（' + level + '），import 依赖 ' + imports.length + ' 条。',
				suggestion,
			),
		);
	}
	return out;
}

function scanUnusedExports(ctx) {
	const out = [];
	const seen = new Set();
	const qualitySet = new Set(qualityCodeFiles(ctx));
	for (const entry of ctx.exports) {
		if (!qualitySet.has(entry.file)) continue;
		const key = entry.file + ':' + entry.line + ':' + entry.name;
		if (seen.has(key)) continue;
		seen.add(key);
		const stat = ctx.identStats.get(entry.name);
		const total = stat ? stat.total : 0;
		const self = stat ? stat.files.get(entry.file) || 0 : 0;
		const refsSelf = Math.max(0, self - 1);
		const refsOther = Math.max(0, total - self);
		if (refsOther > 0) continue;
		const docsMentions = ctx.docIdentStats.get(entry.name) || 0;
		const external = entry.file.startsWith('packages/');
		if (refsSelf === 0) {
			out.push(
				finding(
					'unused-export',
					external ? 'low' : 'medium',
					external ? 'low' : 'high',
					entry.file,
					entry.line,
					'无调用方导出：' + entry.name,
					'全仓代码引用 0 次（本文件 0 / 其他文件 0）；docs 与 skills 提及 ' + docsMentions + ' 次。',
					external
						? '该文件在 packages/，导出可能被 dsh 运行时 / 外部插件消费；先 grep 全仓与 profile 用法，确认外部契约前不要删。'
						: '先 grep 全仓与 docs/skills 提及，并确认桥 / Obsidian 动态调用等外部契约；无外部使用再连同实现删除，删后跑 npm run build。',
				),
			);
		} else {
			out.push(
				finding(
					'unused-export',
					'low',
					'low',
					entry.file,
					entry.line,
					'仅自引用导出：' + entry.name,
					'仅本文件引用 ' + refsSelf + ' 次，其他文件 0 次；docs 与 skills 提及 ' + docsMentions + ' 次。',
					'导出可能多余（内部使用可直接去掉 export）；先确认没有外部消费者，再决定收敛为私有。',
				),
			);
		}
	}
	return out;
}

function scanDeadFiles(ctx) {
	const importers = new Map();
	for (const rel of ctx.codeFiles) {
		for (const imp of ctx.importsByFile.get(rel) || []) {
			const target = resolveCodeSpec(ctx, rel, imp.spec);
			if (!target || target === rel) continue;
			let set = importers.get(target);
			if (!set) {
				set = new Set();
				importers.set(target, set);
			}
			set.add(rel);
		}
	}
	const out = [];
	for (const rel of ctx.codeFiles) {
		if (!rel.startsWith('src/') || rel === 'src/main.ts') continue;
		const count = importers.has(rel) ? importers.get(rel).size : 0;
		if (count > 0) continue;
		out.push(
			finding(
				'dead-file',
				'medium',
				'medium',
				rel,
				1,
				'疑似死文件：' + rel,
				'未被任何其他代码文件 import（静态 / 动态 / require 均 0）。',
				'先 grep 全仓文件名与导出名，确认没有 Obsidian 注册 / 桥外部消费 / 动态加载，再从 git 里删除；删后跑 npm run build。',
			),
		);
	}
	return out;
}

function normalizeCodeLines(text) {
	const raw = text.split('\n');
	const out = [];
	let inStatement = false;
	for (let i = 0; i < raw.length; i++) {
		const line = raw[i].replace(/\r$/, '');
		const trimmed = line.trim();
		if (inStatement) {
			if (/\bfrom\s*['"][^'"]+['"]/.test(trimmed) || /^['"][^'"]+['"];?$/.test(trimmed) || /;\s*$/.test(trimmed)) inStatement = false;
			continue;
		}
		if (/^import\b/.test(trimmed)) {
			if (/\bfrom\s*['"][^'"]+['"]/.test(trimmed) || /^import\s+['"][^'"]+['"];?$/.test(trimmed) || /;\s*$/.test(trimmed)) continue;
			inStatement = true;
			continue;
		}
		if (/^export\s+(?:type\s+)?(?:\*|\{)/.test(trimmed)) {
			if (/\bfrom\b/.test(trimmed) || /\}\s*;?\s*$/.test(trimmed)) continue;
			inStatement = true;
			continue;
		}
		if (!trimmed) continue;
		// 纯注释行不参与查重：两处相同的注释块不算重复实现（行号仍映射回原文件）
		if (/^(?:\/\/|\/\*|\*)/.test(trimmed)) continue;
		out.push({ line: i + 1, text: trimmed.replace(/\s+/g, ' ') });
	}
	return out;
}

function scanDuplicateBlocks(ctx, minBlock) {
	const shingle = Math.min(6, minBlock);
	const qualityFiles = qualityCodeFiles(ctx);
	const seqs = new Map();
	for (const rel of qualityFiles) seqs.set(rel, normalizeCodeLines(ctx.readText(rel)));
	const index = new Map();
	for (const rel of qualityFiles) {
		const seq = seqs.get(rel);
		for (let i = 0; i + shingle <= seq.length; i++) {
			let key = '';
			for (let k = 0; k < shingle; k++) key += seq[i + k].text + '\n';
			let list = index.get(key);
			if (!list) {
				list = [];
				index.set(key, list);
			}
			if (list.length < 16) list.push({ file: rel, idx: i });
		}
	}
	const maxBlock = 160;
	const candidates = new Map();
	for (const list of index.values()) {
		if (list.length < 2) continue;
		for (let a = 0; a < list.length - 1; a++) {
			for (let b = a + 1; b < list.length; b++) {
				const p = list[a];
				const q = list[b];
				if (p.file === q.file && Math.abs(p.idx - q.idx) < shingle) continue;
				const sp = seqs.get(p.file);
				const sq = seqs.get(q.file);
				let start = p.idx;
				let qStart = q.idx;
				while (start > 0 && qStart > 0 && sp[start - 1].text === sq[qStart - 1].text) {
					start--;
					qStart--;
				}
				let end = p.idx + shingle;
				let qEnd = q.idx + shingle;
				while (
					end < sp.length &&
					qEnd < sq.length &&
					sp[end].text === sq[qEnd].text &&
					end - start < maxBlock
				) {
					end++;
					qEnd++;
				}
				if (p.file === q.file && start < qEnd && qStart < end) continue;
				const normLen = end - start;
				if (normLen < minBlock) continue;
				let key = '';
				for (let k = start; k < end; k++) key += sp[k].text + '\n';
				let candidate = candidates.get(key);
				if (!candidate) {
					candidate = { normLen, occurrences: new Map() };
					candidates.set(key, candidate);
				}
				candidate.occurrences.set(p.file + ':' + start, { file: p.file, idxStart: start, idxEnd: end });
				candidate.occurrences.set(q.file + ':' + qStart, { file: q.file, idxStart: qStart, idxEnd: qEnd });
			}
		}
	}
	const blocks = [];
	for (const candidate of candidates.values()) {
		const occ = Array.from(candidate.occurrences.values()).sort(
			(x, y) => cmp(x.file, y.file) || x.idxStart - y.idxStart,
		);
		const dedup = [];
		for (const item of occ) {
			const last = dedup[dedup.length - 1];
			if (last && last.file === item.file && item.idxStart < last.idxEnd) {
				if (item.idxEnd - item.idxStart > last.idxEnd - last.idxStart) dedup[dedup.length - 1] = item;
				continue;
			}
			dedup.push(item);
		}
		if (dedup.length < 2) continue;
		blocks.push({ normLen: candidate.normLen, occurrences: dedup, saved: candidate.normLen * (dedup.length - 1) });
	}
	blocks.sort(
		(x, y) =>
			y.saved - x.saved ||
			cmp(x.occurrences[0].file, y.occurrences[0].file) ||
			x.occurrences[0].idxStart - y.occurrences[0].idxStart,
	);
	const accepted = [];
	for (const block of blocks) {
		const contained = accepted.some((existing) =>
			block.occurrences.every((occ) =>
				existing.occurrences.some(
					(prev) => prev.file === occ.file && prev.idxStart <= occ.idxStart && prev.idxEnd >= occ.idxEnd,
				),
			),
		);
		if (contained) continue;
		accepted.push(block);
	}
	return accepted.map((block) => {
		const first = block.occurrences[0];
		const sameFile = block.occurrences.every((occ) => occ.file === first.file);
		const locations = block.occurrences.slice(0, 3).map((occ) => {
			const seq = seqs.get(occ.file);
			const endLine = seq[occ.idxEnd - 1].line;
			return occ.file + ':' + seq[occ.idxStart].line + '–' + endLine;
		});
		const more = block.occurrences.length > 3 ? ' 等 ' + block.occurrences.length + ' 处' : '';
		const note = sameFile ? '；同文件内重复，可能是 JSX / 表格结构，优先人工判断' : '';
		const firstSeq = seqs.get(first.file);
		return finding(
			'duplicate-block',
			'medium',
			sameFile ? 'low' : 'medium',
			first.file,
			firstSeq[first.idxStart].line,
			'重复代码块：' + block.normLen + ' 行 × ' + block.occurrences.length + ' 处',
			'归一化后 ' + block.normLen + ' 行，约可节省 ' + block.saved + ' 行；位置：' + locations.join('；') + more + note + '。',
			'先确认多处语义确实相同（不是巧合同形），再按 project-guide 第 5 节抽公共函数 / 组件；纯搬运与改逻辑分开提交。',
		);
	});
}

function scanDuplicateExportNames(ctx) {
	const byName = new Map();
	for (const entry of ctx.exports) {
		if (entry.kind === 'reexport') continue;
		let list = byName.get(entry.name);
		if (!list) {
			list = [];
			byName.set(entry.name, list);
		}
		list.push(entry);
	}
	const out = [];
	for (const [name, list] of byName) {
		if (DUPLICATE_EXPORT_DENYLIST.has(name)) continue;
		const files = Array.from(new Set(list.map((entry) => entry.file))).sort(cmp);
		if (files.length < 2) continue;
		const first = list.find((entry) => entry.file === files[0]);
		const locations = list
			.slice(0, 4)
			.map((entry) => entry.file + ':' + entry.line)
			.join('；');
		const more = list.length > 4 ? ' 等 ' + list.length + ' 处' : '';
		out.push(
			finding(
				'duplicate-export-name',
				'low',
				'medium',
				files[0],
				first ? first.line : 1,
				'同名导出：' + name + '（' + files.length + ' 个文件）',
				'导出名 ' + name + ' 出现在 ' + files.length + ' 个文件：' + locations + more + '。',
				'确认是否该收敛为共享实现 / 公共工具；同名但语义不同则改名区分，避免调用方 import 时混淆。',
			),
		);
	}
	return out;
}

function isMagicWhitelisted(ctx, rel) {
	const repoRel = repoRelative(ctx, rel);
	if (repoRel.startsWith('packages/')) return true;
	for (const known of MAGIC_WHITELIST) {
		if (pathMatchesKnown(rel, repoRel, known)) return true;
	}
	return false;
}

const MAGIC_LITERAL_LABEL = {
	3081: '端口 3081',
	'127.0.0.1': '主机 127.0.0.1',
	obsidian: 'profile obsidian',
	'persist:dsh-obsidian': '持久化键 persist:dsh-obsidian',
};

function scanMagicLiterals(ctx) {
	const out = [];
	const literalRe = /(['"])(3081|127\.0\.0\.1|obsidian|persist:dsh-obsidian)\1/g;
	for (const rel of qualityCodeFiles(ctx)) {
		if (pathMatchesKnown(rel, repoRelative(ctx, rel), SELF_REL)) continue;
		if (isMagicWhitelisted(ctx, rel)) continue;
		const lines = ctx.linesOf(rel);
		for (let i = 0; i < lines.length; i++) {
			const text = lines[i];
			const trimmed = text.trim();
			// 注释行不参与（避免把「默认 3081」之类的说明当成字面量）
			if (/^(?:\/\/|\/\*|\*)/.test(trimmed)) continue;
			// 模块说明符不是配置值
			if (/(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]obsidian['"]/.test(text)) continue;
			const keys = [];
			literalRe.lastIndex = 0;
			let match;
			while ((match = literalRe.exec(text))) {
				const label = MAGIC_LITERAL_LABEL[match[2]];
				if (label && keys.indexOf(label) < 0) keys.push(label);
			}
			if (keys.length === 0) continue;
			const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 80);
			out.push(
				finding(
					'magic-literal',
					'info',
					'mechanical',
					rel,
					i + 1,
					'重复字面量：' + keys.join('、'),
					'命中第 ' + (i + 1) + ' 行：' + snippet,
					'先确认是否是配置默认值 / 外部协议值的唯一出处；不是就引用 src/settings/schema.ts 或 src/shared/constants.ts，避免默认值多处漂移（AGENTS 规则 3）。',
				),
			);
		}
	}
	return out;
}

function scanLayerViolations(ctx) {
	const out = [];
	for (const rel of ctx.codeFiles) {
		const from = domainOf(rel);
		if (!from) continue;
		for (const imp of ctx.importsByFile.get(rel) || []) {
			if (imp.spec === 'obsidian') {
				if (from === 'service') {
					out.push(
						finding(
							'layer-violation',
							'medium',
							'high',
							rel,
							imp.line,
							'分层违规：service 域 import obsidian',
							'第 ' + imp.line + ' 行 import obsidian；service 是纯 Node 逻辑。',
							'按 AGENTS 规则 11 / project-guide 第 4 节：需要状态就传回调，需要探测就注入函数，不要直接依赖 obsidian。',
						),
					);
				}
				continue;
			}
			const target = resolveCodeSpec(ctx, rel, imp.spec);
			if (!target) continue;
			const to = domainOf(target);
			if (!to || to === from) continue;
			let title = null;
			let confidence = 'high';
			if (from === 'service' && (to === 'view' || to === 'settings' || to === 'main')) {
				title = '分层违规：service 依赖 ' + to;
			} else if (from === 'view' && to === 'main') {
				title = '分层违规：view import main.ts';
			} else if (from === 'view' && to === 'service') {
				title = '候选分层违规：view 直接 import service 实现';
				confidence = 'medium';
			} else if (from === 'settings' && (to === 'view' || to === 'service' || to === 'main')) {
				title = '分层违规：settings 依赖 ' + to;
			} else if (from === 'shared' && to !== 'shared') {
				title = '分层违规：shared 依赖 ' + to;
			}
			if (!title) continue;
			out.push(
				finding(
					'layer-violation',
					'medium',
					confidence,
					rel,
					imp.line,
					title,
					'第 ' + imp.line + " 行 import '" + imp.spec + "' 解析为 " + target + '。',
					'按 AGENTS 规则 11 / project-guide 第 4 节调整依赖方向：view 只依赖窄接口 DshPanelHost / settings/schema / shared，公共逻辑下沉 shared。',
				),
			);
		}
	}
	return out;
}

function scanBarrels(ctx) {
	const out = [];
	for (const rel of ctx.codeFiles) {
		const base = path.posix.basename(rel);
		if (base !== 'index.ts' && base !== 'index.tsx') continue;
		out.push(
			finding(
				'barrel',
				'medium',
				'mechanical',
				rel,
				1,
				'barrel 文件：' + rel,
				'检测到 index.ts / index.tsx 聚合导出。',
				'删除 barrel，调用方直接 import 实际文件；单产物打包下 barrel 只会带来循环依赖与打包膨胀（project-guide 第 4 节）。',
			),
		);
	}
	return out;
}

function scanCrossPackage(ctx) {
	const out = [];
	for (const rel of ctx.codeFiles) {
		for (const imp of ctx.importsByFile.get(rel) || []) {
			let title = null;
			let targetText = imp.spec;
			if (rel.startsWith('src/')) {
				const target = resolveCodeSpec(ctx, rel, imp.spec);
				if (target && target.startsWith('packages/')) {
					title = 'src import packages：' + rel;
					targetText = imp.spec + ' → ' + target;
				} else if (/^dsh-obsidian-bridge(?:\/|$)/.test(imp.spec)) {
					title = 'src 引用 bridge 包：' + rel;
				}
			} else if (rel.startsWith('packages/')) {
				const target = resolveCodeSpec(ctx, rel, imp.spec);
				if (target && target.startsWith('src/')) {
					title = 'packages import src：' + rel;
					targetText = imp.spec + ' → ' + target;
				}
			}
			if (!title) continue;
			out.push(
				finding(
					'cross-package',
					'medium',
					'mechanical',
					rel,
					imp.line,
					title,
					'第 ' + imp.line + " 行 import '" + targetText + "'；packages/ 是独立 dsh 客户端插件。",
					'保持 src 与 packages 互不 import（AGENTS 规则 11）；需要共享契约就用文档 / 运行时协议，不要跨包直接依赖。',
				),
			);
		}
	}
	return out;
}

function scanRootClutter(ctx) {
	// 只在仓库根生效：--root 指向子目录时根条目本来就不适用允许清单
	if (!existsSync(path.join(ctx.root, 'package.json'))) return [];
	const out = [];
	const entries = readdirSync(ctx.root, { withFileTypes: true });
	const names = entries.map((entry) => entry.name).sort(cmp);
	for (const name of names) {
		if (ROOT_ALLOWLIST.has(name)) continue;
		out.push(
			finding(
				'root-clutter',
				'info',
				'mechanical',
				name,
				1,
				'根目录杂项：' + name,
				'根条目不在允许清单（源码 / 文档 / 构建配置 / 插件运行必需文件）。',
				'移到 docs/、scripts/、skills/ 或 packages/ 对应位置；临时文件不入库（AGENTS 目录约定）。',
			),
		);
	}
	return out;
}

function scanTodoMarkers(ctx) {
	const out = [];
	const markerRe = /\b(?:TODO|FIXME|HACK|XXX)\b|@ts-ignore\b|@ts-expect-error\b/;
	for (const rel of ctx.codeFiles) {
		if (pathMatchesKnown(rel, repoRelative(ctx, rel), SELF_REL)) continue;
		const lines = ctx.linesOf(rel);
		let count = 0;
		let firstLine = 0;
		const kinds = new Set();
		for (let i = 0; i < lines.length; i++) {
			const match = markerRe.exec(lines[i]);
			if (!match) continue;
			count++;
			if (!firstLine) firstLine = i + 1;
			kinds.add(match[0]);
		}
		if (count === 0) continue;
		out.push(
			finding(
				'todo-marker',
				'info',
				'mechanical',
				rel,
				firstLine,
				'遗留标记：' + count + ' 处',
				'共 ' + count + ' 处（' + Array.from(kinds).sort(cmp).join('、') + '），首处第 ' + firstLine + ' 行。',
				'逐条确认：过期的删除，仍有效的转 docs/roadmap.md 需求待办（AGENTS 规则 12）；@ts-ignore 优先改成精确类型或补原因说明。',
			),
		);
	}
	return out;
}

function maskFencedCode(text) {
	const fence = String.fromCharCode(96, 96, 96);
	const pattern = fence + '[\\s\\S]*?' + fence;
	return text.replace(new RegExp(pattern, 'g'), (block) => block.replace(/[^\n]/g, ' '));
}

function scanDocLinks(ctx) {
	const out = [];
	const linkRe = /(!?)\[([^\]]*)\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+['"][^'"\n]*['"])?\s*\)/g;
	for (const rel of ctx.docFiles) {
		if (rel.startsWith('docs/changes/')) continue;
		const text = ctx.readText(rel);
		const masked = maskFencedCode(text);
		linkRe.lastIndex = 0;
		let match;
		while ((match = linkRe.exec(masked))) {
			let target = match[3];
			if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
			if (!target) continue;
			if (/[<>$]/.test(target)) continue;
			if (target.startsWith('#') || target.startsWith('/')) continue;
			if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) continue;
			if (target.indexOf('{') >= 0) continue;
			const clean = target.split('#')[0].split('?')[0];
			if (!clean) continue;
			let decoded = clean;
			try {
				decoded = decodeURIComponent(clean);
			} catch {
				decoded = clean;
			}
			const abs = path.resolve(ctx.root, path.dirname(rel), decoded);
			if (existsSync(abs)) continue;
			const line = masked.slice(0, match.index).split('\n').length;
			out.push(
				finding(
					'doc-missing-file',
					'medium',
					'high',
					rel,
					line,
					'断链：' + target,
					'第 ' + line + ' 行相对链接解析为 ' + path.relative(ctx.root, abs) + '，目标不存在。',
					'核对文件是否改名 / 移动；文档跟随行为走（AGENTS 规则 8），链接改用实际存在的相对路径。',
				),
			);
		}
	}
	return out;
}

function scanDocMap(ctx) {
	const devRel = 'docs/development.md';
	if (ctx.docFiles.indexOf(devRel) < 0) return [];
	const devText = ctx.readText(devRel);
	const out = [];
	for (const rel of ctx.codeFiles) {
		if (!rel.startsWith('src/')) continue;
		const base = path.posix.basename(rel);
		const short = rel.slice('src/'.length);
		if (devText.indexOf(base) >= 0 || devText.indexOf(rel) >= 0 || devText.indexOf(short) >= 0) continue;
		out.push(
			finding(
				'doc-map-missing',
				'info',
				'low',
				rel,
				1,
				'改动地图未登记：' + rel,
				'docs/development.md 未出现文件名 ' + base + ' 或路径 ' + rel + '。',
				'若该文件是稳定职责，补进「代码结构与改动地图」；新建文件按 project-guide 第 6 节验收清单同步文档；纯内部拆分产物可忽略。',
			),
		);
	}
	return out;
}

function scanRepo(root, opts) {
	const ctx = buildContext(root);
	const findings = [];
	findings.push(...scanLongFiles(ctx));
	findings.push(...scanUnusedExports(ctx));
	findings.push(...scanDeadFiles(ctx));
	findings.push(...scanDuplicateBlocks(ctx, opts.minBlock));
	findings.push(...scanDuplicateExportNames(ctx));
	findings.push(...scanMagicLiterals(ctx));
	findings.push(...scanLayerViolations(ctx));
	findings.push(...scanBarrels(ctx));
	findings.push(...scanCrossPackage(ctx));
	findings.push(...scanRootClutter(ctx));
	findings.push(...scanTodoMarkers(ctx));
	findings.push(...scanDocLinks(ctx));
	findings.push(...scanDocMap(ctx));
	const categoryIndex = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
	findings.sort(
		(a, b) =>
			categoryIndex.get(a.category) - categoryIndex.get(b.category) ||
			cmp(a.file, b.file) ||
			a.line - b.line ||
			cmp(a.title, b.title),
	);
	return { ctx, findings };
}

function mdCell(value) {
	return String(value === undefined || value === null ? '' : value)
		.replace(/\|/g, '\\|')
		.replace(/\s+/g, ' ')
		.trim();
}

function groupByCategory(findings) {
	const map = new Map();
	for (const item of findings) {
		let list = map.get(item.category);
		if (!list) {
			list = [];
			map.set(item.category, list);
		}
		list.push(item);
	}
	return map;
}

function formatLocalTime(date) {
	const pad = (value) => (value < 10 ? '0' + value : String(value));
	return (
		date.getFullYear() +
		'-' +
		pad(date.getMonth() + 1) +
		'-' +
		pad(date.getDate()) +
		' ' +
		pad(date.getHours()) +
		':' +
		pad(date.getMinutes()) +
		':' +
		pad(date.getSeconds())
	);
}

function renderMarkdown(ctx, findings, opts, now) {
	const byCategory = groupByCategory(findings);
	const limit = opts.top;
	const lines = [];
	const push = (...items) => lines.push(...items);

	push('# 项目审阅报告', '');
	const qualityFiles = qualityCodeFiles(ctx);
	const qualityLines = qualityFiles.reduce((sum, rel) => sum + ctx.fileLines.get(rel), 0);
	push(
		'生成时间：' +
			formatLocalTime(now) +
			' / root：' +
			ctx.root +
			' / 全仓代码 ' +
			ctx.codeFiles.length +
			' 个文件、' +
			ctx.codeLines +
			' 行（含 scripts / 技能脚本）' +
			' / 质量类 src + packages：' +
			qualityFiles.length +
			' 个文件、' +
			qualityLines +
			' 行 / 发现 ' +
			findings.length +
			' 条',
		'',
	);

	push('## 0. 概览', '');
	const longCount = (threshold) => qualityFiles.filter((rel) => ctx.fileLines.get(rel) >= threshold).length;
	push('| 指标 | 值 |', '|---|---|');
	push('| 全仓代码文件 | ' + ctx.codeFiles.length + ' |');
	push('| 全仓代码行数 | ' + ctx.codeLines + ' |');
	push('| 质量类扫描范围 | src + packages：' + qualityFiles.length + ' 个文件 / ' + qualityLines + ' 行 |');
	push('| 文档文件 | ' + ctx.docFiles.length + ' |');
	push('| 文档行数 | ' + ctx.docLines + ' |');
	push('| ≥150 行代码文件 | ' + longCount(150) + ' |');
	push('| ≥300 行代码文件 | ' + longCount(300) + ' |');
	push('| ≥500 行代码文件 | ' + longCount(500) + ' |');
	push('');
	push('| category | 类别 | 数量 |', '|---|---|---|');
	for (const category of CATEGORY_ORDER) {
		const list = byCategory.get(category) || [];
		push('| ' + category + ' | ' + CATEGORY_LABEL[category] + ' | ' + list.length + ' |');
	}
	push('| 合计 | — | ' + findings.length + ' |', '');

	push('## 1. 超长文件', '');
	push(
		'阈值：≥150 提示、≥300 建议拆分、≥500 强信号；扫描范围为 src + packages（工具脚本不计入），已排除 main.js 与文档。已知例外（main.ts / native-chat-root.tsx / 桥 client.js）降为 info。按行数降序。',
		'',
	);
	const longFiles = (byCategory.get('long-file') || [])
		.slice()
		.sort((a, b) => firstNumber(b.title) - firstNumber(a.title) || cmp(a.file, b.file));
	if (longFiles.length === 0) {
		push('无（没有 ≥150 行的代码文件）。', '');
	} else {
		push('| 行数 | 文件 | 严重度 | 建议 |', '|---|---|---|---|');
		for (const item of longFiles.slice(0, limit)) {
			push(
				'| ' +
					firstNumber(item.title) +
					' | ' +
					mdCell(item.file) +
					' | ' +
					item.severity +
					' | ' +
					mdCell(item.suggestion) +
					' |',
			);
		}
		push('');
		if (longFiles.length > limit) push('另有 ' + (longFiles.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 2. 无调用方导出与死文件', '');
	push('### 无调用方导出', '');
	const unused = byCategory.get('unused-export') || [];
	if (unused.length === 0) {
		push('无（未发现 0 引用或仅自引用的导出；default export 已跳过）。', '');
	} else {
		push('| 位置 | 导出名 | 证据 | confidence | 建议 |', '|---|---|---|---|---|');
		for (const item of unused.slice(0, limit)) {
			const name = item.title.replace(/^[^：]*：/, '');
			push(
				'| ' +
					mdCell(item.file + ':' + item.line) +
					' | ' +
					mdCell(name) +
					' | ' +
					mdCell(item.evidence) +
					' | ' +
					item.confidence +
					' | ' +
					mdCell(item.suggestion) +
					' |',
			);
		}
		push('');
		if (unused.length > limit) push('另有 ' + (unused.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}
	push('### 死文件', '');
	const dead = byCategory.get('dead-file') || [];
	if (dead.length === 0) {
		push('无（src 下所有文件都被其它代码 import；main.ts 作为入口已排除）。', '');
	} else {
		push('| 文件 | 证据 | confidence | 建议 |', '|---|---|---|---|');
		for (const item of dead.slice(0, limit)) {
			push(
				'| ' +
					mdCell(item.file) +
					' | ' +
					mdCell(item.evidence) +
					' | ' +
					item.confidence +
					' | ' +
					mdCell(item.suggestion) +
					' |',
			);
		}
		push('');
		if (dead.length > limit) push('另有 ' + (dead.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 3. 重复实现', '');
	push('> 启发式结果（归一化 + 6 行 shingle + 极大块合并），报告前必须人工复核。', '');
	push('### 重复代码块', '');
	const dupBlocks = (byCategory.get('duplicate-block') || []).slice().sort((a, b) => {
		const matchA = /([0-9]+) 行 × ([0-9]+) 处/.exec(a.title);
		const matchB = /([0-9]+) 行 × ([0-9]+) 处/.exec(b.title);
		const savedA = matchA ? Number(matchA[1]) * (Number(matchA[2]) - 1) : 0;
		const savedB = matchB ? Number(matchB[1]) * (Number(matchB[2]) - 1) : 0;
		return savedB - savedA || cmp(a.file, b.file);
	});
	if (dupBlocks.length === 0) {
		push('无（≥' + opts.minBlock + ' 行的归一化重复块未发现）。', '');
	} else {
		push('| 重复块 | 位置与行数 | 证据 | confidence |', '|---|---|---|---|');
		for (const item of dupBlocks.slice(0, limit)) {
			push(
				'| ' +
					mdCell(item.title.replace(/^重复代码块：/, '')) +
					' | ' +
					mdCell(item.file + ':' + item.line) +
					' | ' +
					mdCell(item.evidence) +
					' | ' +
					item.confidence +
					' |',
			);
		}
		push('');
		if (dupBlocks.length > limit) push('另有 ' + (dupBlocks.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}
	push('### 同名导出', '');
	const dupNames = byCategory.get('duplicate-export-name') || [];
	if (dupNames.length === 0) {
		push('无（没有同名导出出现在 2 个以上文件）。', '');
	} else {
		push('| 导出名 | 位置 | 证据 | confidence |', '|---|---|---|---|');
		for (const item of dupNames.slice(0, limit)) {
			push(
				'| ' +
					mdCell(item.title.replace(/^同名导出：/, '')) +
					' | ' +
					mdCell(item.file + ':' + item.line) +
					' | ' +
					mdCell(item.evidence) +
					' | ' +
					item.confidence +
					' |',
			);
		}
		push('');
		if (dupNames.length > limit) push('另有 ' + (dupNames.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}
	push('### 重复字面量', '');
	const magic = byCategory.get('magic-literal') || [];
	if (magic.length === 0) {
		push('无（白名单外未发现 3081 / 127.0.0.1 / obsidian / persist:dsh-obsidian 字面量）。', '');
	} else {
		push('| 字面量 | 位置 | 证据 |', '|---|---|---|');
		for (const item of magic.slice(0, limit)) {
			push(
				'| ' +
					mdCell(item.title.replace(/^重复字面量：/, '')) +
					' | ' +
					mdCell(item.file + ':' + item.line) +
					' | ' +
					mdCell(item.evidence) +
					' |',
			);
		}
		push('');
		if (magic.length > limit) push('另有 ' + (magic.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 4. 结构漂移', '');
	const structural = findings.filter(
		(item) =>
			item.category === 'layer-violation' ||
			item.category === 'barrel' ||
			item.category === 'cross-package' ||
			item.category === 'root-clutter',
	);
	if (structural.length === 0) {
		push('无（分层依赖、barrel、跨包引用、根目录条目均未发现违规）。', '');
	} else {
		push('| 类别 | 位置 | 证据 | 严重度 | confidence |', '|---|---|---|---|---|');
		for (const item of structural.slice(0, limit)) {
			push(
				'| ' +
					CATEGORY_LABEL[item.category] +
					' | ' +
					mdCell(item.file + ':' + item.line) +
					' | ' +
					mdCell(item.title + '；' + item.evidence) +
					' | ' +
					item.severity +
					' | ' +
					item.confidence +
					' |',
			);
		}
		push('');
		if (structural.length > limit) push('另有 ' + (structural.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 5. 遗留标记', '');
	const todos = byCategory.get('todo-marker') || [];
	if (todos.length === 0) {
		push('无（TODO / FIXME / HACK / XXX / @ts-ignore / @ts-expect-error 均未命中）。', '');
	} else {
		push('| 文件 | 处数 | 类型 | 首处 |', '|---|---|---|---|');
		for (const item of todos.slice(0, limit)) {
			const countMatch = /([0-9]+) 处/.exec(item.title);
			const kindsMatch = /（([^（）]*)）/.exec(item.evidence);
			push(
				'| ' +
					mdCell(item.file) +
					' | ' +
					(countMatch ? countMatch[1] : '?') +
					' | ' +
					mdCell(kindsMatch ? kindsMatch[1] : '') +
					' | ' +
					item.line +
					' |',
			);
		}
		push('');
		if (todos.length > limit) push('另有 ' + (todos.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 6. 文档漂移', '');
	push('### 相对链接断链', '');
	const broken = byCategory.get('doc-missing-file') || [];
	if (broken.length === 0) {
		push('无（文档相对链接目标均存在；http / 锚点 / mailto / docs/changes/ 历史提案已跳过）。', '');
	} else {
		push('| 文件 | 行 | 链接目标 | 解析结果 | confidence |', '|---|---|---|---|---|');
		for (const item of broken.slice(0, limit)) {
			push(
				'| ' +
					mdCell(item.file) +
					' | ' +
					item.line +
					' | ' +
					mdCell(item.title.replace(/^断链：/, '')) +
					' | ' +
					mdCell(item.evidence) +
					' | ' +
					item.confidence +
					' |',
			);
		}
		push('');
		if (broken.length > limit) push('另有 ' + (broken.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}
	push('### 改动地图缺登记', '');
	const mapMissing = byCategory.get('doc-map-missing') || [];
	if (mapMissing.length === 0) {
		push('无（src 下文件都能在 docs/development.md 找到文件名或路径）。', '');
	} else {
		push('| 文件 | 证据 | confidence |', '|---|---|---|');
		const shown = mapMissing.slice(0, limit);
		for (const item of shown) {
			push('| ' + mdCell(item.file) + ' | ' + mdCell(item.evidence) + ' | ' + item.confidence + ' |');
		}
		push('');
		if (mapMissing.length > limit) push('另有 ' + (mapMissing.length - limit) + ' 条未列出（--top ' + limit + '）。', '');
	}

	push('## 7. 建议重构批次', '');
	const batches = [
		{
			title: '批次 1：文档同步',
			categories: ['doc-missing-file', 'doc-map-missing'],
			detail: '只改文档：修断链、把稳定文件登记进 docs/development.md 的改动地图。',
			verify: 'node skills/project-review/scripts/audit.mjs --json（确认 doc-* 计数下降）；git diff --stat',
			risk: '零代码风险；不要顺手改代码或顺手改用户可见文案。',
		},
		{
			title: '批次 2：死代码清理',
			categories: ['unused-export', 'dead-file', 'todo-marker'],
			detail: '删无调用方导出、死文件，清理过期遗留标记。',
			verify: '先 grep 全仓与 docs/skills 提及；npm run build；node skills/project-review/scripts/audit.mjs --json',
			risk: '外部契约（packages 导出、Obsidian 动态调用、docs 示例）可能在使用；删导出前必须确认。',
		},
		{
			title: '批次 3：纯搬运拆分',
			categories: ['long-file', 'barrel', 'layer-violation', 'cross-package', 'root-clutter'],
			detail: '只移动文件 / 改 import：超长文件拆分、去 barrel、修分层方向、清根目录杂项。',
			verify: 'npm run build && npm run check；再按 docs/development.md 的手动回归清单跑一遍',
			risk: '行为必须不变（文案 / 命令 id / 时序不改）；一次提交别既搬又改；main.js 由构建生成，禁止手改。',
		},
		{
			title: '批次 4：收敛重复',
			categories: ['duplicate-block', 'duplicate-export-name', 'magic-literal'],
			detail: '抽公共实现 / 统一常量出处。',
			verify: 'npm run build && npm run check && npm run lint；仅重构时对比构建前后 main.js 是否一致',
			risk: '重复块可能只是形似而语义不同；字面量可能是外部协议值，收敛前确认。',
		},
	];
	const batchCount = (batch) => findings.filter((item) => batch.categories.indexOf(item.category) >= 0).length;
	push('建议顺序：按批次 1 → 4 逐批执行、逐批确认、逐批提交；每批完成后重跑扫描器复查。', '');
	for (const batch of batches) {
		push('### ' + batch.title + '（' + batchCount(batch) + ' 条）', '');
		push('- 内容：' + batch.detail);
		push('- 验证命令：' + batch.verify);
		push('- 风险：' + batch.risk, '');
	}
	push('> 重构前必须让用户确认批次，并按 AGENTS.md 规则 12/13 登记 roadmap R-<n> + docs/changes 提案（≥2 条路径）。');
	push('> 本报告是机器扫描结果，人工复核后才能作为改动依据。');
	push('');

	return lines.join('\n');
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(USAGE + '\n');
		return;
	}
	const root = path.resolve(opts.root === null ? defaultRepoRoot() : opts.root);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new UsageError('root 不是目录：' + root);
	}
	const now = new Date();
	const result = scanRepo(root, opts);
	const payload = {
		root,
		generatedAt: now.toISOString(),
		metrics: {
			codeFiles: result.ctx.codeFiles.length,
			codeLines: result.ctx.codeLines,
			findings: result.findings.length,
		},
		findings: result.findings,
	};
	const output = opts.json ? JSON.stringify(payload, null, 2) + '\n' : renderMarkdown(result.ctx, result.findings, opts, now);
	if (opts.out !== null) {
		const outPath = path.resolve(opts.out);
		try {
			writeFileSync(outPath, output, 'utf8');
		} catch (error) {
			throw new UsageError('写入 --out 失败：' + outPath + '（' + (error instanceof Error ? error.message : String(error)) + '）');
		}
		process.stdout.write('已写入 ' + outPath + '；findings ' + result.findings.length + ' 条\n');
		return;
	}
	process.stdout.write(output);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write('audit.mjs: ' + message + '\n');
	process.exitCode = 2;
}
