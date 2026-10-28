import { Setting } from 'obsidian';
import type { SettingsRenderContext } from '../context';
import {
	MAX_QUOTE_EXCERPT_LIMIT,
	MIN_QUOTE_EXCERPT_LIMIT,
	quoteExcerptLimitOf,
	runStatusPlacementOf,
	type StreamRefreshMode,
} from '../schema';
import { renderCommandScope, renderMentionScope, renderSkillScope } from './chat-scope';

/**
 * 聊天模块：流式刷新（0021）+「@」引用范围（0030）+「/」技能范围（0037）
 * + 名单「选取」（0038）+「/」命令范围（0050）。
 */
export function renderChatSection(containerEl: HTMLElement, context: SettingsRenderContext): void {
	renderQuoteExcerptLimit(containerEl, context);
	renderRunStatusPlacement(containerEl, context);
	renderStreamRefresh(containerEl, context);
	renderMentionScope(containerEl, context);
	renderSkillScope(containerEl, context);
	renderCommandScope(containerEl, context);
}

/** 选区引用摘录上限（0058）：默认 2000 字，超出截断，行号范围仍完整。 */
function renderQuoteExcerptLimit(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('选区引用摘录上限')
		.setDesc(
			'在编辑区选中文字后发送，消息会带上「笔记路径 + 选中原文」的引用块；这里限制摘录最多多少字（默认 2000，范围 ' +
				MIN_QUOTE_EXCERPT_LIMIT +
				'–' +
				MAX_QUOTE_EXCERPT_LIMIT +
				'）。超出部分截断，行号范围仍完整；改动后下一次发送生效。',
		)
		.addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.min = String(MIN_QUOTE_EXCERPT_LIMIT);
			text.inputEl.max = String(MAX_QUOTE_EXCERPT_LIMIT);
			text.inputEl.step = '100';
			text
				.setPlaceholder(String(quoteExcerptLimitOf(host.settings.quoteExcerptLimit)))
				.setValue(String(quoteExcerptLimitOf(host.settings.quoteExcerptLimit)))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					if (parsed < MIN_QUOTE_EXCERPT_LIMIT || parsed > MAX_QUOTE_EXCERPT_LIMIT) return;
					host.settings.quoteExcerptLimit = parsed;
					await host.saveSettings();
				});
		});
}

/** 运行提示位置（0048）：输入框上方（默认）/ 消息流最下方。 */
function renderRunStatusPlacement(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('运行提示位置')
		.setDesc(
			'dsh 同款「深度求索中，用时 …」显示在哪：输入框上方（默认），或消息流最下方（随对话滚动，dsh 原生位置）。运行中的面板切换后即时生效。',
		)
		.addDropdown((dropdown) => {
			dropdown
				.addOption('composer', '输入框上方（默认）')
				.addOption('flow', '输出最下方（随对话滚动）')
				.setValue(runStatusPlacementOf(host.settings.runStatusPlacement))
				.onChange(async (value) => {
					host.settings.runStatusPlacement = runStatusPlacementOf(value);
					await host.saveSettings();
				});
		});
}

/** 流式正文的刷新节奏。 */
function renderStreamRefresh(containerEl: HTMLElement, context: SettingsRenderContext): void {
	const { host } = context;

	new Setting(containerEl)
		.setName('流式刷新')
		.setDesc(
			'Assistant 正文的刷新节奏：逐字最跟手（需要新版桥），平衡为旧版行为，省电最省 CPU。切换后立即生效。',
		)
		.addDropdown((dropdown) => {
			dropdown
				.addOption('chunk', '逐字（每个 chunk）')
				.addOption('frame', '每帧 16ms（默认）')
				.addOption('balanced', '平衡 50ms')
				.addOption('relaxed', '省电 100ms')
				.setValue(host.settings.streamRefresh)
				.onChange(async (value) => {
					host.settings.streamRefresh = value as StreamRefreshMode;
					await host.saveSettings();
				});
		});
}
