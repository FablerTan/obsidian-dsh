#!/usr/bin/env node
/**
 * obsdocs.mjs — Obsidian 文档检索 CLI（供 agent 使用，零依赖）
 *
 * Obsidian 官网帮助与开发者文档都是 Obsidian Publish 站点，提供两个稳定接口：
 *   GET https://publish-01.obsidian.md/cache/<uid>    → 全站文件树 + 每页 frontmatter/headings 元数据(JSON)
 *   GET https://publish-01.obsidian.md/access/<uid>/<页面路径>.md → 页面原始 Markdown
 * 本脚本把 cache 落成本地索引（data/index-*.json），并按需抓取正文（data/cache/ 下有 TTL）。
 *
 * 子命令：
 *   list  [--lang zh|en|dev] [--section <章节>]      列出目录条目
 *   find  <关键词> [--lang ...] [--limit N] [--json] 搜标题/路径/别名/小标题
 *   get   <关键词|路径|URL> [--lang auto|zh|en|dev] [--raw] [--refresh]  抓取并打印正文
 *   url   <关键词|路径> [--lang ...]                 只打印规范 URL
 *   sync  [--lang ...] [--from <dir>] [--no-refs]    重新抓取索引并重建 references/*.md
 *
 * 示例：
 *   node scripts/obsdocs.mjs find 属性 --lang zh
 *   node scripts/obsdocs.mjs get 快速入门/创建仓库
 *   node scripts/obsdocs.mjs get Plugin/registerView --lang dev
 *   node scripts/obsdocs.mjs get https://docs.obsidian.md/Reference/TypeScript+API/Plugin
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, '..');
const DATA_DIR = join(SKILL_DIR, 'data');
const REFS_DIR = join(SKILL_DIR, 'references');
const CACHE_DIR = join(DATA_DIR, 'cache');
const PUBLISH = 'https://publish-01.obsidian.md';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 三个文档站点的 Publish 身份。 */
const SITES = {
	'help-zh': { label: 'Obsidian 中文帮助', uid: 'cf01a21839823cd6cbe18031acf708c0', base: 'https://obsidian.md/zh/help', kind: 'help' },
	'help-en': { label: 'Obsidian Help (English)', uid: 'f786db9fac45774fa4f0d8112e232d67', base: 'https://obsidian.md/help', kind: 'help' },
	dev: { label: 'Obsidian Developer Documentation', uid: 'caa27d6312fe5c26ebc657cc609543be', base: 'https://docs.obsidian.md', kind: 'dev' },
};
const LANG_ORDER = ['help-zh', 'help-en', 'dev'];
const LANG_ALIASES = {
	zh: 'help-zh', 'zh-cn': 'help-zh', cn: 'help-zh', 'help-zh': 'help-zh', chinese: 'help-zh',
	en: 'help-en', 'help-en': 'help-en', english: 'help-en',
	dev: 'dev', api: 'dev', reference: 'dev', 'dev-docs': 'dev', docs: 'dev',
	global: 'auto', auto: 'auto',
};

const USAGE = '子命令：list / find / get / url / sync（详见脚本头部注释）';

// ---------------------------------------------------------------- 基础工具

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** markdown 代码符号（避免在生成文本里出现反引号转义地狱）。 */
const TICK = '`';
const stripMd = (p) => (p.endsWith('.md') ? p.slice(0, -3) : p);
/** 规范 URL 用 '+' 表示空格（Obsidian Publish 的 pretty URL 约定）。 */
const encodePretty = (p) => p.split('/').map((s) => encodeURIComponent(s).replace(/%20/g, '+')).join('/');
/** access 接口用 %20 表示空格。 */
const encodeAccess = (p) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

function normLang(value, fallback = 'auto') {
	if (value === undefined || value === true) return fallback;
	const key = String(value).toLowerCase();
	const hit = LANG_ALIASES[key];
	if (!hit) throw new Error('未知语言 ' + value + '，可用：zh / en / dev / auto');
	return hit;
}

async function fetchText(url, options = {}) {
	const retries = options.retries ?? 2;
	const timeoutMs = options.timeoutMs ?? 25000;
	let lastError;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(timeoutMs),
				headers: { 'user-agent': 'obsidian-docs-skill/1.0 (+local agent)' },
			});
			if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
			return await res.text();
		} catch (error) {
			lastError = error;
			if (attempt < retries) await sleep(400 * (attempt + 1));
		}
	}
	throw lastError;
}

const indexPath = (lang) => join(DATA_DIR, 'index-' + lang + '.json');

async function loadIndex(lang) {
	try {
		return JSON.parse(await readFile(indexPath(lang), 'utf8'));
	} catch (error) {
		throw new Error('缺少索引 ' + indexPath(lang) + '，先运行：node scripts/obsdocs.mjs sync（' + error.message + '）');
	}
}

function sectionOf(pathNoMd) {
	const segs = pathNoMd.split('/');
	return segs.length > 1 ? segs[0] : '(根目录)';
}

// ---------------------------------------------------------------- sync：抓取并重建索引

function buildPage(site, pagePath, meta) {
	const noMd = stripMd(pagePath);
	const fm = meta?.frontmatter ?? {};
	const headings = (meta?.headings ?? [])
		.slice(0, 40)
		.map((h) => ({ level: h.level, heading: String(h.heading ?? '') }))
		.filter((h) => h.heading.length > 0);
	const page = { path: pagePath, title: String(fm.title ?? noMd.split('/').pop()), section: sectionOf(noMd), headings };
	if (site.kind === 'help') {
		const permalink = String(fm.permalink ?? '').replace(/^\/+|\/+$/g, '');
		page.slug = permalink;
		page.url = site.base + (permalink ? '/' + encodePretty(permalink) : '/');
		const aliases = Array.isArray(fm.aliases) ? fm.aliases.map(String) : fm.aliases ? [String(fm.aliases)] : [];
		if (aliases.length > 0) page.aliases = aliases.filter((a) => a !== noMd);
	} else {
		page.slug = encodePretty(noMd);
		page.url = site.base + '/' + page.slug;
		const segs = noMd.split('/');
		if (segs[0] === 'Reference' && segs[1] === 'TypeScript API' && segs.length >= 3) {
			page.kind = 'api';
			page.class = segs[2];
			if (segs.length >= 4) page.member = segs.slice(3).join('/');
			page.group = 'Reference/TypeScript API';
		} else if (segs[0] === 'Reference' && segs[1] === 'CSS variables') {
			page.kind = 'css';
			page.group = segs.slice(2).join('/') || 'CSS variables';
		} else if (segs[0] === 'Reference') {
			page.kind = 'ref';
			page.group = segs.slice(0, 2).join('/');
		} else {
			page.kind = 'guide';
			page.group = segs.length > 1 ? segs[0] + '/' + segs[1] : segs[0];
		}
	}
	return page;
}

async function fetchSiteCache(lang, fromDir) {
	const site = SITES[lang];
	const tag = lang === 'help-zh' ? 'zh' : lang === 'help-en' ? 'en' : 'dev';
	if (fromDir) {
		const cache = JSON.parse(await readFile(join(fromDir, tag + '-cache.json'), 'utf8'));
		let options = {};
		try {
			options = JSON.parse(await readFile(join(fromDir, tag + '-options.json'), 'utf8'));
		} catch {
			options = {};
		}
		return { cache, options };
	}
	const [cacheRaw, optionsRaw] = await Promise.all([
		fetchText(PUBLISH + '/cache/' + site.uid),
		fetchText(PUBLISH + '/options/' + site.uid).catch(() => '{}'),
	]);
	return { cache: JSON.parse(cacheRaw), options: JSON.parse(optionsRaw) };
}

function navigationSectionOrder(options) {
	const order = [];
	for (const entry of options?.navigationOrdering ?? []) {
		if (typeof entry !== 'string') continue;
		const value = entry.replace(/^\/+/, '');
		if (value.length === 0 || value.includes('/') || value.endsWith('.md')) continue;
		if (!order.includes(value)) order.push(value);
	}
	return order;
}

function renderHelpToc(lang, index, options) {
	const site = SITES[lang];
	const pages = index.pages;
	const bySection = new Map();
	for (const page of pages) {
		if (!bySection.has(page.section)) bySection.set(page.section, []);
		bySection.get(page.section).push(page);
	}
	const pageOrder = new Map();
	(options?.navigationOrdering ?? []).forEach((entry, i) => {
		if (typeof entry === 'string' && entry.endsWith('.md')) pageOrder.set(entry, i);
	});
	const sectionOrder = navigationSectionOrder(options);
	const sections = [...bySection.keys()].sort((a, b) => {
		const ia = sectionOrder.indexOf(a);
		const ib = sectionOrder.indexOf(b);
		if (ia !== -1 && ib !== -1) return ia - ib;
		if (ia !== -1) return -1;
		if (ib !== -1) return 1;
		return a.localeCompare(b, 'zh');
	});
	const L = [];
	L.push('# ' + site.label + ' · 目录索引');
	L.push('');
	L.push('> 自动生成，勿手改：node scripts/obsdocs.mjs sync');
	L.push('> 数据源：' + site.base + '/（' + pages.length + ' 页）· 生成于 ' + index.generatedAt);
	L.push('> 机器可读索引：data/index-' + lang + '.json');
	L.push('> 取正文：node scripts/obsdocs.mjs get <路径>（路径即下方反引号内的值）');
	L.push('');
	for (const section of sections) {
		const list = bySection.get(section) ?? [];
		list.sort((a, b) => {
			const ia = pageOrder.get(a.path);
			const ib = pageOrder.get(b.path);
			if (ia !== undefined && ib !== undefined) return ia - ib;
			if (ia !== undefined) return -1;
			if (ib !== undefined) return 1;
			return a.title.localeCompare(b.title, 'zh');
		});
		L.push('## ' + section + '（' + list.length + ' 页）');
		L.push('');
		for (const page of list) L.push('- [' + page.title + '](' + page.url + ') — ' + TICK + stripMd(page.path) + TICK);
		L.push('');
	}
	return L.join('\n');
}

function renderDevToc(index) {
	const pages = index.pages;
	const api = pages.filter((p) => p.kind === 'api');
	const css = pages.filter((p) => p.kind === 'css');
	const guides = pages.filter((p) => p.kind === 'guide' && p.section !== '(根目录)');
	const refs = pages.filter((p) => p.kind === 'ref');
	const roots = pages.filter((p) => p.section === '(根目录)');

	const apiClasses = new Map();
	for (const page of api) {
		const name = page.class;
		if (!apiClasses.has(name)) apiClasses.set(name, { classPage: undefined, members: 0 });
		const entry = apiClasses.get(name);
		if (page.member === undefined) entry.classPage = page;
		else entry.members += 1;
	}
	const classNames = [...apiClasses.keys()].sort((a, b) => a.localeCompare(b));

	const L = [];
	L.push('# Obsidian 开发者文档 · 目录索引');
	L.push('');
	L.push('> 自动生成，勿手改：node scripts/obsdocs.mjs sync');
	L.push('> 数据源：https://docs.obsidian.md（' + pages.length + ' 页）· 生成于 ' + index.generatedAt);
	L.push('> 机器可读索引：data/index-dev.json');
	L.push('');
	L.push('## 怎么用这份索引');
	L.push('');
	L.push('- 概念/教程类（Plugins/...）：直接 node scripts/obsdocs.mjs get <路径> 抓正文。');
	L.push('- API 类（Reference/TypeScript API/...）：先 find <类名或方法名> --lang dev，再 get；速查见 references/dev-quickref.md。');
	L.push('- CSS 变量（Reference/CSS variables/...）：find <变量名> --lang dev 或直接 get。');
	L.push('');
	const guideSections = new Map();
	for (const page of guides) {
		if (!guideSections.has(page.section)) guideSections.set(page.section, []);
		guideSections.get(page.section).push(page);
	}
	const preferredSections = ['Plugins', 'Themes', 'Community directory'];
	const sectionNames = [...guideSections.keys()].sort((a, b) => {
		const ia = preferredSections.indexOf(a);
		const ib = preferredSections.indexOf(b);
		if (ia !== -1 && ib !== -1) return ia - ib;
		if (ia !== -1) return -1;
		if (ib !== -1) return 1;
		return a.localeCompare(b);
	});
	for (const section of sectionNames) {
		const list = guideSections.get(section) ?? [];
		L.push('## ' + section + '（' + list.length + ' 页）');
		L.push('');
		const groups = new Map();
		for (const page of list) {
			const key = page.group ?? section;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(page);
		}
		for (const [group, groupPages] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			L.push('### ' + group);
			L.push('');
			for (const page of groupPages) L.push('- [' + page.title + '](' + page.url + ') — ' + TICK + stripMd(page.path) + TICK);
			L.push('');
		}
	}
	L.push('## Reference（参考）');
	L.push('');
	L.push('### TypeScript API（' + api.length + ' 页 / ' + classNames.length + ' 个类）');
	L.push('');
	L.push('每个类有一个总页 Reference/TypeScript API/<类>，其成员（属性/方法/事件）各自成页 Reference/TypeScript API/<类>/<成员>。');
	L.push('');
	const busiest = [...apiClasses.entries()]
		.filter(([, v]) => v.members > 0)
		.sort((a, b) => b[1].members - a[1].members)
		.slice(0, 24);
	L.push('成员最多的类：' + busiest.map(([name, v]) => '[' + name + '](' + (v.classPage?.url ?? SITES.dev.base + '/Reference/TypeScript+API/' + encodePretty(name)) + ')(' + v.members + ')').join(' · '));
	L.push('');
	L.push('<details><summary>全部 ' + classNames.length + ' 个类（字母序，点开复制类名去 find）</summary>');
	L.push('');
	for (let i = 0; i < classNames.length; i += 8) L.push(classNames.slice(i, i + 8).map((n) => TICK + n + TICK).join(' '));
	L.push('');
	L.push('</details>');
	L.push('');
	if (css.length > 0) {
		L.push('### CSS variables（' + css.length + ' 页）');
		L.push('');
		for (const page of css) L.push('- [' + page.title + '](' + page.url + ') — ' + TICK + stripMd(page.path) + TICK);
		L.push('');
	}
	if (refs.length > 0) {
		L.push('### 其它参考');
		L.push('');
		for (const page of refs) L.push('- [' + page.title + '](' + page.url + ') — ' + TICK + stripMd(page.path) + TICK);
		L.push('');
	}
	if (roots.length > 0) {
		L.push('## 根目录（' + roots.length + ' 页）');
		L.push('');
		for (const page of roots) L.push('- [' + page.title + '](' + page.url + ') — ' + TICK + stripMd(page.path) + TICK);
		L.push('');
	}
	return L.join('\n');
}

async function cmdSync(flags) {
	const langs = flags.lang ? [normLang(flags.lang, 'help-zh')] : LANG_ORDER;
	const fromDir = typeof flags.from === 'string' ? resolve(flags.from) : undefined;
	await mkdir(DATA_DIR, { recursive: true });
	await mkdir(REFS_DIR, { recursive: true });
	for (const lang of langs) {
		const site = SITES[lang];
		process.stderr.write('[sync] ' + lang + ' ← ' + (fromDir ? fromDir : PUBLISH + '/cache/' + site.uid) + '\n');
		const { cache, options } = await fetchSiteCache(lang, fromDir);
		const pages = Object.keys(cache)
			.filter((key) => key.endsWith('.md'))
			.sort()
			.map((key) => buildPage(site, key, cache[key]));
		const index = {
			site: lang,
			label: site.label,
			uid: site.uid,
			baseUrl: site.base,
			generatedAt: new Date().toISOString(),
			pageCount: pages.length,
			pages,
		};
		await writeFile(indexPath(lang), JSON.stringify(index), 'utf8');
		if (flags['no-refs'] !== true) {
			const name = lang === 'help-zh' ? 'help-zh' : lang === 'help-en' ? 'help-en' : 'dev-docs';
			const target = join(REFS_DIR, name + '.md');
			const text = lang === 'dev' ? renderDevToc(index) : renderHelpToc(lang, index, options);
			await writeFile(target, text + '\n', 'utf8');
			process.stderr.write('[sync] wrote ' + target + '\n');
		}
		process.stderr.write('[sync] ' + lang + ': ' + pages.length + ' pages\n');
	}
}

// ---------------------------------------------------------------- 搜索与解析

function haystack(page) {
	if (page.__hay === undefined) {
		const parts = [page.title, stripMd(page.path), page.slug ?? ''];
		if (page.aliases) parts.push(page.aliases.join(' '));
		if (page.headings) parts.push(page.headings.map((h) => h.heading).join(' '));
		page.__hay = parts.join(' \n ').toLowerCase();
	}
	return page.__hay;
}

function scorePage(page, query) {
	const q = query.toLowerCase();
	const noMd = stripMd(page.path).toLowerCase();
	const title = page.title.toLowerCase();
	if (noMd === q || page.slug === query || (page.slug && page.slug.toLowerCase() === q)) return 100;
	if (title === q) return 95;
	if (page.aliases?.some((a) => a.toLowerCase() === q)) return 90;
	if (title.startsWith(q)) return 70;
	if (noMd.endsWith('/' + q)) return 65;
	if (page.slug && page.slug.toLowerCase().startsWith(q)) return 60;
	if (noMd.includes(q)) return 45;
	if (page.aliases?.some((a) => a.toLowerCase().includes(q))) return 40;
	if (page.headings?.some((h) => h.heading.toLowerCase().includes(q))) return 22;
	if (haystack(page).includes(q)) return 12;
	return 0;
}

async function searchPages(query, langs, limit) {
	const results = [];
	for (const lang of langs) {
		const index = await loadIndex(lang);
		for (const page of index.pages) {
			const score = scorePage(page, query);
			if (score > 0) results.push({ lang, page, score });
		}
	}
	const langRank = new Map(LANG_ORDER.map((l, i) => [l, i]));
	results.sort((a, b) => b.score - a.score || (langRank.get(a.lang) ?? 9) - (langRank.get(b.lang) ?? 9) || a.page.title.localeCompare(b.page.title));
	return results.slice(0, limit);
}

function parseUrlTarget(input) {
	let url;
	try {
		url = new URL(input);
	} catch {
		return undefined;
	}
	const host = url.hostname;
	const path = decodeURIComponent(url.pathname.replace(/\+/g, '%20')).replace(/^\/+/, '');
	const segs = path.split('/').filter((s) => s.length > 0);
	if (host === 'docs.obsidian.md') return { lang: 'dev', slug: segs.join('/') };
	if (host.endsWith('obsidian.md')) {
		if (segs[0] === 'zh' && segs[1] === 'help') return { lang: 'help-zh', slug: segs.slice(2).join('/') };
		if (segs[0] === 'help') return { lang: 'help-en', slug: segs.slice(1).join('/') };
	}
	if (host === 'publish-01.obsidian.md' && segs[0] === 'access' && segs.length >= 3) {
		const lang = Object.keys(SITES).find((l) => SITES[l].uid === segs[1]);
		if (lang) return { lang, path: segs.slice(2).join('/') };
	}
	return undefined;
}

async function locate(query, langInput, options = {}) {
	const wantFuzzy = options.fuzzy !== false;
	const lang = normLang(langInput);
	const urlTarget = parseUrlTarget(query);
	if (urlTarget) {
		const index = await loadIndex(urlTarget.lang);
		const page = index.pages.find((p) =>
			urlTarget.slug !== undefined ? p.slug === urlTarget.slug || stripMd(p.path) === urlTarget.slug : p.path === urlTarget.path,
		);
		if (page) return { lang: urlTarget.lang, page };
	}
	const langs = lang === 'auto' ? LANG_ORDER : [lang];
	const q = query.trim();
	for (const current of langs) {
		const index = await loadIndex(current);
		const exact = index.pages.find(
			(p) => stripMd(p.path) === stripMd(q) || p.path === q || (p.slug !== undefined && p.slug.toLowerCase() === q.toLowerCase()) || p.title === q,
		);
		if (exact) return { lang: current, page: exact };
	}
	if (!wantFuzzy) return undefined;
	const hits = await searchPages(query, langs, 8);
	if (hits.length === 0) return undefined;
	return { lang: hits[0].lang, page: hits[0].page, ambiguous: hits.length > 1 ? hits : undefined };
}

// ---------------------------------------------------------------- 抓取正文

const sanitizeCacheName = (p) => p.replace(/[\/\\:*?"<>|]/g, '_');

async function readPageBody(lang, page, options = {}) {
	const site = SITES[lang];
	const dir = join(CACHE_DIR, lang);
	const file = join(dir, sanitizeCacheName(page.path));
	if (options.refresh !== true) {
		try {
			const info = await stat(file);
			if (Date.now() - info.mtimeMs < CACHE_TTL_MS) return { body: await readFile(file, 'utf8'), cached: true };
		} catch {
			/* 未缓存 */
		}
	}
	const body = await fetchText(PUBLISH + '/access/' + site.uid + '/' + encodeAccess(page.path));
	await mkdir(dir, { recursive: true });
	await writeFile(file, body, 'utf8');
	return { body, cached: false };
}

function stripFrontmatter(markdown) {
	if (!markdown.startsWith('---')) return markdown;
	const end = markdown.indexOf('\n---', 3);
	if (end < 0) return markdown;
	const after = markdown.indexOf('\n', end + 4);
	return after < 0 ? '' : markdown.slice(after + 1);
}

// ---------------------------------------------------------------- 子命令

async function cmdList(flags) {
	const lang = normLang(flags.lang, 'help-zh');
	const langs = lang === 'auto' ? LANG_ORDER : [lang];
	const section = typeof flags.section === 'string' ? flags.section : undefined;
	for (const current of langs) {
		const index = await loadIndex(current);
		const pages = section ? index.pages.filter((p) => p.section === section) : index.pages;
		console.log('\n## ' + SITES[current].label + ' — ' + index.pageCount + ' 页' + (section ? ' · 筛选 ' + section : ''));
		const bySection = new Map();
		for (const page of pages) {
			if (!bySection.has(page.section)) bySection.set(page.section, []);
			bySection.get(page.section).push(page);
		}
		for (const [name, list] of bySection) {
			console.log('\n### ' + name + ' (' + list.length + ')');
			for (const page of list) console.log('- ' + page.title + '  ' + page.url + '  [get ' + stripMd(page.path) + ']');
		}
	}
}

async function cmdFind(query, flags) {
	const lang = normLang(flags.lang, 'auto');
	const langs = lang === 'auto' ? LANG_ORDER : [lang];
	const limit = Number.parseInt(String(flags.limit ?? '15'), 10) || 15;
	const hits = await searchPages(query, langs, limit);
	if (flags.json === true) {
		console.log(JSON.stringify(hits.map((hit) => ({ lang: hit.lang, title: hit.page.title, path: stripMd(hit.page.path), url: hit.page.url, score: hit.score })), null, 2));
		return;
	}
	if (hits.length === 0) {
		console.log('无匹配：「' + query + '」');
		const en = await searchPages(query, ['help-en'], 5);
		if (en.length > 0) console.log('（英文站有 ' + en.length + ' 条相关结果，试试 --lang en）');
		return;
	}
	for (const hit of hits) {
		console.log('[' + hit.lang + '] ' + hit.page.title + '  →  ' + hit.page.url);
		console.log('    get ' + stripMd(hit.page.path) + (hit.lang === 'help-zh' ? '' : ' --lang ' + hit.lang));
	}
}

async function cmdGet(query, flags) {
	const located = await locate(query, flags.lang, { fuzzy: true });
	if (!located) {
		console.log('没找到：「' + query + '」。用 find 搜索关键词，或 list 看目录。');
		process.exitCode = 1;
		return;
	}
	if (located.ambiguous && flags.strict === true) {
		console.log('命中多个页面，请更精确：');
		for (const hit of located.ambiguous) console.log('- [' + hit.lang + '] ' + hit.page.title + ' — get ' + stripMd(hit.page.path) + ' --lang ' + hit.lang);
		return;
	}
	const page = located.page;
	const lang = located.lang;
	const body = await readPageBody(lang, page, { refresh: flags.refresh === true });
	const text = flags.raw === true ? body.body : stripFrontmatter(body.body);
	console.log('# ' + page.title);
	console.log('');
	console.log('- 来源：' + page.url);
	console.log('- 站点：' + SITES[lang].label + ' (' + lang + ')');
	console.log('- 路径：' + page.path + (body.cached ? ' · 本地缓存' : ' · 刚刚抓取'));
	if (page.headings?.length) {
		const toc = page.headings.filter((h) => h.level <= 3).slice(0, 12).map((h) => '  - ' + h.heading);
		if (toc.length > 0) console.log('- 小节：\n' + toc.join('\n'));
	}
	console.log('');
	console.log('---');
	console.log('');
	console.log(text.trim());
}

async function cmdUrl(query, flags) {
	const located = await locate(query, flags.lang, { fuzzy: true });
	if (!located) {
		console.log('没找到：「' + query + '」');
		process.exitCode = 1;
		return;
	}
	console.log(located.page.url);
}

// ---------------------------------------------------------------- 入口

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith('--')) {
				flags[key] = next;
				i += 1;
			} else {
				flags[key] = true;
			}
		} else {
			positional.push(arg);
		}
	}
	return { positional, flags };
}

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const command = positional[0];
	if (!command || command === 'help') {
		console.log(USAGE);
		return;
	}
	const query = positional.slice(1).join(' ').trim();
	if (command === 'sync') {
		await cmdSync(flags);
		return;
	}
	if (command === 'list') {
		await cmdList(flags);
		return;
	}
	if (command === 'find') {
		if (!query) throw new Error('find 需要一个关键词');
		await cmdFind(query, flags);
		return;
	}
	if (command === 'get') {
		if (!query) throw new Error('get 需要一个路径/标题/URL');
		await cmdGet(query, flags);
		return;
	}
	if (command === 'url') {
		if (!query) throw new Error('url 需要一个路径/标题');
		await cmdUrl(query, flags);
		return;
	}
	console.log('未知子命令：' + command + '\n' + USAGE);
	process.exitCode = 1;
}

main().catch((error) => {
	console.error('[obsdocs] ' + (error?.stack ?? error));
	process.exitCode = 1;
});
