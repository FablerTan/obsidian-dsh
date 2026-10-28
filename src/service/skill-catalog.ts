/**
 * 本地技能目录扫描（0038）：设置页「/」技能范围的「选取」按钮用它列出技能名。
 *
 * 根目录与 dsh 的 `dsh-skill-filesystem` 保持一致：
 *   <vault>/.dsh/skills、<vault>/.agents/skills、$DSH_HOME/skills、~/.agents/skills
 * 每个根下认两种形态：子目录里的 `SKILL.md`（取 frontmatter `name`），以及单文件 `*.md`（同样取 frontmatter `name`）。
 *
 * 注意：这是**本地近似值** —— 插件 / 预设注入的技能不在文件系统里，设置页仍允许手写技能名；
 * 目录不存在 / 无权限 / 解析失败一律当作「没有候选」，不抛错（不阻塞设置页）。
 */
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveDshHome } from './plugin-inventory';

/** 缓存：设置页反复点「选取」时复用；技能目录变动不频繁。 */
const CACHE_TTL_MS = 15000;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const NAME_LINE = /^name:\s*(.+)$/m;

interface CacheEntry {
	key: string;
	at: number;
	value: string[];
}

let cache: CacheEntry | null = null;


/** 扫描的根目录（与 dsh 的 dsh-skill-filesystem 一致）。 */
function skillRoots(projectRoot: string): string[] {
	return [
		path.join(projectRoot, '.dsh', 'skills'),
		path.join(projectRoot, '.agents', 'skills'),
		path.join(resolveDshHome(), 'skills'),
		path.join(os.homedir(), '.agents', 'skills'),
	];
}

/** 本地技能目录里的技能名（去重、排序；15s 缓存；失败返回空数组）。 */
export async function listLocalSkillNames(projectRoot: string, refresh = false): Promise<string[]> {
	if (
		refresh !== true &&
		cache !== null &&
		cache.key === projectRoot &&
		Date.now() - cache.at < CACHE_TTL_MS
	) {
		return [...cache.value];
	}
	const names = new Set<string>();
	for (const root of skillRoots(projectRoot)) {
		for (const name of await readSkillRoot(root)) names.add(name);
	}
	const value = [...names].sort();
	cache = { key: projectRoot, at: Date.now(), value };
	return [...value];
}

/** 读一个技能根：目录取 `SKILL.md`，单文件取 frontmatter `name`。 */
async function readSkillRoot(root: string): Promise<string[]> {
	let entries: string[];
	try {
		entries = await fs.readdir(root);
	} catch {
		return [];
	}
	const names: string[] = [];
	for (const entry of entries) {
		if (entry.startsWith('.')) continue;
		const full = path.join(root, entry);
		let stat;
		try {
			// 用 stat（跟随符号链接）：仓库里 `.dsh/skills/<name>` 常是指向 `skills/<name>` 的软链。
			stat = await fs.stat(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			const name = await readSkillName(path.join(full, 'SKILL.md'));
			if (name !== null) names.push(name);
			continue;
		}
		if (stat.isFile() && entry.endsWith('.md')) {
			const name = await readSkillName(full);
			if (name !== null) names.push(name);
		}
	}
	return names;
}

/** 从技能文件的 frontmatter 读 `name`（去引号）；没有 frontmatter / 没有 name 返回 null。 */
async function readSkillName(file: string): Promise<string | null> {
	let text: string;
	try {
		text = await fs.readFile(file, 'utf8');
	} catch {
		return null;
	}
	const frontmatter = FRONTMATTER.exec(text);
	if (frontmatter === null) return null;
	const line = NAME_LINE.exec(frontmatter[1] ?? '');
	if (line === null || line[1] === undefined) return null;
	const value = line[1].trim().replace(/^["']|["']$/gu, '');
	return value === '' ? null : value;
}
