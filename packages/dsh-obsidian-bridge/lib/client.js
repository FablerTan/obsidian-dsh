/* dsh-obsidian-bridge — client half (browser).
 *
 * Obsidian 嵌入专用（纯客户端）。只暴露 v4 原生数据桥：
 *   listSessions / subscribe / snapshot / nextEvent / send / cancel / loadOlder /
 *   approvalAnswer / questionAnswer / models / permissions / renameSession / context
 *
 * Obsidian 通过 <webview>.executeJavaScript() 调用；桥只返回 JSON DTO。
 * 只支持 DSH 0.2.x。v1 布局能力（configure / newSession / enforceSingleColumn /
 * state）已随 0008 的 native-only 面板删除（0011）。
 * v3（0017）：增加 liveStream —— 直接订阅 SessionBinding.eventSource 累积流式
 * 正文 / 思考 / 工具参数，由 nextEvent 携带 live tail；不再依赖官方 UI 的 rAF 发布。
 * v4（0022）：增加 context() —— 读取 contextPressure / contextBreakdown 会话投影，
 * 供原生输入栏的上下文占用圆环与详情面板使用。
 * v5（0025）：增加 commands() / skills() / executeCommand() —— 输入框 "/" 命令菜单
 * 的宿主命令目录、技能目录与命令行提交；命令一律经宿主 command.execute 准入，
 * 插件端不自己解释 /compact 这类宿主命令。
 * v6（0035）：增加 team() —— 读 Lead 会话的 agentTeam 投影（dsh「智能体团队」bundle），
 * 并补上各成员的运行状态 / 等待授权 / 模型标签，供原生面板的只读团队浮层使用。
 * v7（0041）：增加 subagents() —— 读会话的 subagentCatalog 投影（dsh 子智能体），
 * 并把 subscribe() 扩成可接受 SubagentAddress，供原生面板列子代理、打开子会话续聊 / Stop。
 * v8（目标条）：增加 goal() / goalAction() —— 读会话的 goal 投影（目标条：id / revision /
 * objective / phase / blockedReason / maxGoalRounds / roundsStarted），并通过 remote.goals
 * 走宿主目标操作（edit / pause / resume / clear）。activation 是进程内状态、不在投影里，
 * 由 remote.goals.get() 按需读一次 + goal/activation-changed 事件补齐。
 */
window.__ModuleLoader__.load({
	id: "dsh-obsidian-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const VERSION = 8;
		const GLOBAL_KEY = "__DSH_OBSIDIAN_BRIDGE__";
		const MAX_DEPTH = 8;
		const MAX_ARRAY = 300;
		const MAX_KEYS = 60;
		const MAX_STRING = 20000;

		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		function safeGet(ctx, name) {
			try {
				return ctx.get(name);
			} catch {
				return undefined;
			}
		}

		/** JSON-safe projection with bounded depth and size. */
		function sanitize(value, depth = 0, ancestors = new Set()) {
			if (value === null || value === undefined) return null;
			const type = typeof value;
			if (type === "string") {
				return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…[truncated]" : value;
			}
			if (type === "number" || type === "boolean") return value;
			if (type === "bigint") return value.toString();
			if (type === "function" || type === "symbol") return null;
			if (depth >= MAX_DEPTH) return "[depth]";
			if (type !== "object") return null;
			if (ancestors.has(value)) return "[circular]";
			if (value instanceof Date) return value.toISOString();
			if (value instanceof Error) return { name: value.name, message: value.message };
			if (typeof Element !== "undefined" && value instanceof Element) return "[Element]";
			if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return "[AbortSignal]";
			ancestors.add(value);
			try {
				if (Array.isArray(value)) {
					const out = value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1, ancestors));
					if (value.length > MAX_ARRAY) out.push("[+" + (value.length - MAX_ARRAY) + " more]");
					return out;
				}
				if (value instanceof Map) {
					const entries = [...value.entries()].slice(0, MAX_KEYS);
					const allString = entries.every(([key]) => typeof key === "string" || typeof key === "number");
					if (allString) {
						const out = {};
						for (const [key, item] of entries) out[String(key)] = sanitize(item, depth + 1, ancestors);
						if (value.size > MAX_KEYS) out.__truncated = value.size - MAX_KEYS;
						return out;
					}
					return {
						__type: "Map",
						entries: entries.map(([key, item]) => [
							sanitize(key, depth + 1, ancestors),
							sanitize(item, depth + 1, ancestors)
						])
					};
				}
				if (value instanceof Set) {
					return {
						__type: "Set",
						values: [...value.values()].slice(0, MAX_KEYS).map((item) => sanitize(item, depth + 1, ancestors))
					};
				}
				const out = {};
				let count = 0;
				for (const key of Object.keys(value)) {
					if (key === "signal" || key === "element" || key.startsWith("__react")) continue;
					if (count >= MAX_KEYS) {
						out.__truncated = true;
						break;
					}
					let item;
					try {
						item = value[key];
					} catch {
						continue;
					}
					out[key] = sanitize(item, depth + 1, ancestors);
					count += 1;
				}
				return out;
			} finally {
				ancestors.delete(value);
			}
		}

		function projectNode(node) {
			let turn = null;
			let step = null;
			try {
				const location = node.location;
				if (location?.kind === "turn") turn = location.turn.turn;
				else if (location?.kind === "step") {
					turn = location.turn.turn;
					step = location.step.step;
				}
			} catch {
				// 保持 null
			}
			return {
				key: node.key,
				id: node.id,
				kind: node.kind,
				anchorSeq: node.anchorSeq ?? null,
				turn,
				step,
				visibility: node.visibility ?? "visible",
				data: sanitize(node.data)
			};
		}

		function projectPending(pending) {
			if (!pending) return null;
			const base = {
				kind: pending.kind,
				key: pending.key,
				sessionId: String(pending.sessionId)
			};
			if (pending.kind === "approval") {
				return {
					...base,
					toolName: pending.toolName,
					callId: pending.callId ?? null,
					reason: pending.reason ?? null,
					displayReason: sanitize(pending.displayReason),
					answerable: typeof pending.answerable === "boolean" ? pending.answerable : true
				};
			}
			if (pending.kind === "question" || pending.kind === "plan-review") {
				let card = null;
				try {
					card = pending.snapshot?.() ?? null;
				} catch {
					card = null;
				}
				return {
					...base,
					callId: pending.callId ?? null,
					questions: sanitize(pending.questions),
					review: sanitize(pending.review),
					dismissal: pending.dismissal ?? null,
					state: card?.state ?? "open",
					countdown: sanitize(card?.countdown)
				};
			}
			return { ...base, raw: sanitize(pending) };
		}

		function nativeApi(ctx, remotes) {
			let active = null;
			let revision = 0;
			let live = null;
			let liveRevision = 0;
			let disposed = false;
			// v8 goal：进程内 activation 缓存（goal 投影里没有 activation），键为 { id, revision }。
			let activationCache = null;
			let activationReadKey = null;
			const waiters = new Set();

			function notify() {
				for (const waiter of [...waiters]) waiter.fire();
			}

			function bump() {
				revision += 1;
				notify();
			}

			/**
			 * 立即发布 live（每个 chunk 一次）。
			 *
			 * 0021 起合并/节流全部交给原生端：离屏 webview 里的 setTimeout 会被 Chromium
			 * 拖到 ~75ms 才触发，桥端定时合并反而把刷新率压到 13Hz；宿侧按帧合帧更可靠。
			 */
			function bumpLive() {
				liveRevision += 1;
				notify();
			}

			/** 只比较原生 UI 真正消费的字段，避免每个 stream chunk 都触发全量快照。 */
			function statusDigest(snapshot) {
				if (!snapshot || typeof snapshot !== "object") return "";
				const promptError = snapshot.promptError;
				return [
					snapshot.running === true,
					snapshot.hasMore === true,
					snapshot.lastAgentError ?? "",
					promptError && typeof promptError === "object" ? promptError.message ?? "" : ""
				].join("\u0000");
			}

			function livePacket() {
				if (live === null) return null;
				return {
					turn: live.turn,
					step: live.step,
					attemptId: live.attemptId ?? null,
					blocks: sanitize(live.blocks)
				};
			}

			function ensureLive(turn, step, attemptId) {
				if (
					live === null ||
					live.turn !== turn ||
					live.step !== step ||
					live.attemptId !== (attemptId ?? null)
				) {
					live = { turn, step, attemptId: attemptId ?? null, blocks: [] };
				}
				return live;
			}

			/** 把一个 assistant/live-chunk 折进当前 live blocks；返回是否有可见变化。 */
			function applyLiveChunk(data) {
				if (!data || typeof data !== "object") return false;
				const { turn, step, attemptId, chunk } = data;
				if (typeof turn !== "number" || typeof step !== "number" || !chunk || typeof chunk !== "object") {
					return false;
				}
				const state = ensureLive(turn, step, typeof attemptId === "string" ? attemptId : null);
				const blocks = state.blocks;
				const index = typeof chunk.index === "number" && chunk.index >= 0 ? chunk.index : 0;
				switch (chunk.type) {
					case "block-start": {
						const blockType = chunk.blockType;
						blocks[index] =
							blockType === "reasoning"
								? { kind: "reasoning", text: "" }
								: blockType === "tool-call"
									? { kind: "tool-call", callId: "", name: "", argsRaw: "" }
									: { kind: "text", text: "" };
						break;
					}
					case "text-delta": {
						const previous = blocks[index];
						blocks[index] = {
							kind: "text",
							text: (previous?.kind === "text" ? previous.text : "") + String(chunk.text ?? "")
						};
						break;
					}
					case "reasoning-delta": {
						const previous = blocks[index];
						blocks[index] = {
							kind: "reasoning",
							text: (previous?.kind === "reasoning" ? previous.text : "") + String(chunk.text ?? "")
						};
						break;
					}
					case "tool-call-delta": {
						const previous = blocks[index];
						const callId =
							chunk.id === undefined || chunk.id === null
								? previous?.kind === "tool-call" ? previous.callId : ""
								: String(chunk.id);
						blocks[index] = {
							kind: "tool-call",
							callId,
							name:
								typeof chunk.name === "string" && chunk.name !== ""
									? chunk.name
									: previous?.kind === "tool-call" ? previous.name : "",
							argsRaw:
								(previous?.kind === "tool-call" ? previous.argsRaw : "") +
								String(chunk.argumentsDelta ?? "")
						};
						break;
					}
					case "block-end": {
						const block = chunk.block;
						if (!block || typeof block !== "object") return false;
						if (block.type === "text") {
							blocks[index] = { kind: "text", text: String(block.text ?? "") };
						} else if (block.type === "reasoning") {
							blocks[index] = { kind: "reasoning", text: String(block.text ?? "") };
						} else if (block.type === "tool-call") {
							blocks[index] = {
								kind: "tool-call",
								callId: String(block.id ?? ""),
								name: String(block.name ?? ""),
								argsRaw: String(block.arguments ?? "")
							};
						} else {
							return false;
						}
						break;
					}
					default:
						return false;
				}
				return true;
			}

			/** 应用一条事件窗口条目；返回 "chunk"（可合并）或 "reset"（立即发布）。 */
			function applyLiveEntry(entry) {
				if (!entry || typeof entry !== "object") return false;
				if (entry.type === "transient") {
					const event = entry.event;
					if (!event || event.type !== "assistant/live-chunk") return false;
					return applyLiveChunk(event.data) ? "chunk" : false;
				}
				const event = entry.event;
				if (!event || typeof event !== "object") return false;
				switch (event.type) {
					case "step/start": {
						const data = event.data ?? {};
						live = {
							turn: typeof data.turn === "number" ? data.turn : 0,
							step: typeof data.step === "number" ? data.step : 0,
							attemptId: null,
							blocks: []
						};
						return "reset";
					}
					case "assistant/message":
					case "assistant/attempt":
					case "turn/end": {
						if (live === null) return false;
						live = null;
						return "reset";
					}
					case "llm/retry": {
						if (live === null || live.blocks.length === 0) return false;
						live = { ...live, blocks: [] };
						return "reset";
					}
					default:
						return false;
				}
			}

			function seedLive(window) {
				live = null;
				for (const entry of window?.entries ?? []) applyLiveEntry(entry);
			}

			function onSessionEvent() {
				if (active === null) return;
				const window = active.eventSource.getSnapshot();
				if (!window || !window.change) return;
				const change = window.change;
				if (change.kind === "replace") {
					seedLive(window);
					bumpLive();
					return;
				}
				if (change.kind === "prepend") return;
				if (change.kind === "settle-assistant") {
					if (live === null) return;
					live = null;
					bumpLive();
					return;
				}
				let chunk = false;
				let reset = false;
				for (const entry of change.entries ?? []) {
					const kind = applyLiveEntry(entry);
					if (kind === "chunk") chunk = true;
					else if (kind === "reset") reset = true;
				}
				if (reset) bumpLive();
				else if (chunk) bumpLive();
			}

			function cleanup() {
				if (active === null) return;
				const current = active;
				const hadLive = live !== null;
				active = null;
				live = null;
				activationCache = null;
				activationReadKey = null;
				for (const unsubscribe of current.unsubs) {
					try {
						unsubscribe();
					} catch {
						// ignore
					}
				}
				try {
					current.ref.release();
				} catch {
					// ignore
				}
				if (!disposed) bump();
				if (hadLive) bumpLive();
			}

			function sessionsService() {
				const sessions = safeGet(ctx, "sessions");
				if (!sessions) throw new Error("sessions 服务不可用");
				return sessions;
			}

			function wireSessions() {
				const connection = safeGet(ctx, "connection");
				const sessions = connection?.api?.sessions;
				if (!sessions) throw new Error("connection.api.sessions 不可用");
				return sessions;
			}

			function sessionFace() {
				if (active === null) throw new Error("尚未订阅会话");
				const binding = active.ref.binding;
				if (!binding) throw new Error("会话没有活动 binding");
				return binding.session;
			}

			function pendingOf() {
				if (active === null) throw new Error("尚未订阅会话");
				const status = active.uiSession.sessionStatus.getSnapshot().get(active.sessionId);
				return status?.pendingInteraction ?? null;
			}

			function diagnose() {
				if (active === null) return { active: null };
				let binding = null;
				let scope = null;
				let conversation = null;
				try {
					binding = active.ref.binding ?? null;
					scope = sessionsService().scope(active.sessionId) ?? null;
					conversation = scope?.get("conversation") ?? null;
				} catch {
					// 诊断不抛错
				}
				const session = active.ref.binding?.session;
				let snapshot = null;
				try {
					snapshot = active.session.getSnapshot();
				} catch {
					snapshot = null;
				}
				return {
					active: {
						sessionId: active.sessionId,
						hasBinding: binding !== null,
						hasSessionFace: session !== undefined && session !== null,
						hasScope: scope !== null,
						hasConversation: conversation !== null,
						openState: snapshot?.openState ?? null,
						running: snapshot?.running ?? null,
						promptError: sanitize(snapshot?.promptError ?? null),
						lastAgentError: snapshot?.lastAgentError ?? null
					}
				};
			}

			function newSessionId() {
				try {
					return "session-" + crypto.randomUUID();
				} catch {
					return "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
				}
			}

			async function createSession(cwd) {
				const request = { sessionId: newSessionId() };
				if (typeof cwd === "string" && cwd.length > 0) request.cwd = cwd;
				const created = await sessionsService().create(request);
				await subscribe(created);
				return { ok: true, sessionId: created };
			}

			function sessionTitle(sessionId) {
				const snapshot = sessionsService().list.getSnapshot();
				const row = snapshot.byId?.[sessionId];
				return row?.displayTitle ?? row?.title ?? sessionId;
			}

			function listSessions() {
				const snapshot = sessionsService().list.getSnapshot();
				const sessions = snapshot.ids.map((id) => {
					const row = snapshot.byId[id];
					return {
						id,
						title: row?.displayTitle ?? row?.title ?? row?.cwd ?? id,
						cwd: row?.cwd ?? null,
						running: row?.running === true,
						blank: row?.blank === true,
						updatedAt: row?.updatedAt ?? null,
						origin: typeof row?.origin === "string" ? row.origin : null,
						parentId: typeof row?.parentId === "string" ? row.parentId : null
					};
				});
				return { phase: snapshot.phase ?? null, sessions };
			}

			/** 规范 subscribe 参数：string = 普通会话；{ parentSessionId, childSessionId, mode } = 子会话地址。 */
			function normalizeTarget(target) {
				if (typeof target === "string" && target.length > 0) {
					return { sessionId: target, address: null };
				}
				if (target !== null && typeof target === "object") {
					const parentSessionId = typeof target.parentSessionId === "string" ? target.parentSessionId : "";
					const childSessionId = typeof target.childSessionId === "string" ? target.childSessionId : "";
					const mode = target.mode;
					if (
						parentSessionId !== "" &&
						childSessionId !== "" &&
						(mode === "one-shot" || mode === "continuable" || mode === "unknown")
					) {
						return {
							sessionId: childSessionId,
							address: { parentSessionId, childSessionId, mode }
						};
					}
				}
				throw new Error("缺少会话 id");
			}

			/** 当前订阅会话的子代理地址（普通会话为 null）。 */
			function activeSubagentAddress() {
				if (active === null) return null;
				try {
					const address = active.session.getSnapshot()?.subagent?.address ?? null;
					return address !== null && typeof address === "object" ? address : null;
				} catch {
					return null;
				}
			}

			/** 子代理目录的根：普通会话是自己；子会话是它的父会话（这样能列出兄弟）。 */
			function catalogRootId() {
				if (active === null) throw new Error("尚未订阅会话");
				const address = activeSubagentAddress();
				return address && typeof address.parentSessionId === "string" && address.parentSessionId.length > 0
					? address.parentSessionId
					: active.sessionId;
			}

			/** 读一个会话在列表快照里的 summary 投影值（projectionsBySession 优先，回退 byId 上的投影块）。 */
			function projectionValuesOf(sessionId) {
				try {
					const list = sessionsService().list.getSnapshot();
					return (
						list?.projectionsBySession?.[sessionId]?.values ??
						list?.byId?.[sessionId]?.projectionValues ??
						null
					);
				} catch {
					return null;
				}
			}

			/** 目录摘要：只关心目录根的 subagentCatalog，避免会话列表的任何变化都唤醒原生端。 */
			function catalogDigest() {
				try {
					const values = projectionValuesOf(catalogRootId());
					const catalog = Array.isArray(values?.subagentCatalog) ? values.subagentCatalog : null;
					return JSON.stringify(catalog);
				} catch {
					return "";
				}
			}

			async function subscribe(target) {
				const normalized = normalizeTarget(target);
				const sessionId = normalized.sessionId;
				const address = normalized.address;
				if (active?.sessionId === sessionId) {
					return { ok: true, sessionId, revision };
				}
				cleanup();
				activationCache = null;
				activationReadKey = null;
				const sessions = sessionsService();
				let uiSession = safeGet(ctx, "uiSession");
				for (let attempt = 0; attempt < 50; attempt++) {
					if (uiSession?.adapter?.bindingSource) break;
					await sleep(100);
					uiSession = safeGet(ctx, "uiSession");
				}
				if (!uiSession?.adapter?.bindingSource) throw new Error("uiSession 服务不可用");
				const ref = address === null
					? sessions.retain(sessionId, { source: "obsidianBridge" })
					: sessions.retain(address, { source: "obsidianBridge" });
				let binding;
				try {
					await ref.ready;
					const source = uiSession.adapter.bindingSource(ref);
					for (let attempt = 0; attempt < 50; attempt++) {
						binding = source.getSnapshot();
						if (binding?.hooks?.chat && binding?.hooks?.session) break;
						await sleep(100);
					}
				} catch (error) {
					try {
						ref.release();
					} catch {
						// ignore
					}
					throw error;
				}
				const chat = binding?.hooks?.chat;
				const session = binding?.hooks?.session;
				if (!chat || !session) {
					try {
						ref.release();
					} catch {
						// ignore
					}
					throw new Error("会话没有提供 chat/session hooks");
				}
				let statusKey = statusDigest(session.getSnapshot());
				const onSessionChange = () => {
					const next = statusDigest(session.getSnapshot());
					if (next === statusKey) return;
					statusKey = next;
					bump();
				};
				const unsubs = [
					chat.subscribe(bump),
					session.subscribe(onSessionChange),
					uiSession.sessionStatus.subscribe(bump)
				];
				let eventSource = null;
				try {
					eventSource = ref.binding?.eventSource ?? null;
				} catch {
					eventSource = null;
				}
				active = { sessionId, address, ref, chat, session, uiSession, eventSource, unsubs };
				// 子代理目录可能随会话列表更新（父会话在别处跑出 / 结束子代理）：只在目录变化时唤醒。
				let catalogKey = catalogDigest();
				try {
					unsubs.push(
						sessionsService().list.subscribe(() => {
							const next = catalogDigest();
							if (next === catalogKey) return;
							catalogKey = next;
							bump();
						})
					);
				} catch {
					// 列表订阅失败不阻塞会话订阅
				}
				// 上下文占用与标题来自独立投影：用量 / 构成 / 标题变化时也要唤醒原生端。
				// 投影是可选的，缺少时 context() 会返回 null（原生端显示灰色空环），标题则退回列表里的 displayTitle。
				try {
					const projections = sessionFace().projections;
					for (const key of [
						"contextPressure",
						"contextBreakdown",
						"title",
						"agentTeam",
						"subagentCatalog",
						"subagent",
						"subagentTiming",
						"goal"
					]) {
						const face = projections?.faceOf?.(key);
						if (face && typeof face.subscribe === "function") {
							unsubs.push(face.subscribe(bump));
						}
					}
				} catch {
					// 投影尚未就绪：不阻塞订阅。
				}
				// v8 goal：durable 投影只有 phase，进程内 activation 要经 remote.goals.get() 读；
				// 事件只跟随当前会话，cleanup 时随 active.unsubs 一起释放。缺 goal 插件时整段跳过。
				try {
					const remote = remotes.remote;
					if (remote && typeof remote.$on === "function") {
						const unsubscribeGoal = remote.$on("goal/activation-changed", (event) => {
							try {
								if (active === null || event?.sessionId !== active.sessionId) return;
								const changed = event.goal;
								const activation = goalActivation(changed?.activation);
								if (!changed || changed.id === undefined || changed.id === null || activation === null) {
									activationCache = null;
								} else {
									activationCache = {
										id: String(changed.id),
										revision: Number(changed.revision),
										activation
									};
								}
								bump();
							} catch {
								// 事件处理失败不影响桥
							}
						});
						if (typeof unsubscribeGoal === "function") unsubs.push(unsubscribeGoal);
					}
				} catch {
					// goal 事件不可用：activation 只靠 goal() 的按需读取
				}
				if (eventSource) {
					seedLive(eventSource.getSnapshot());
					unsubs.push(eventSource.subscribe(onSessionEvent));
				}
				try {
					const uiWorkspace = safeGet(ctx, "uiWorkspace");
					if (typeof uiWorkspace?.openSession === "function") {
						uiWorkspace.openSession(address === null ? sessionId : address);
					}
				} catch {
					// 只影响官方页面跟随，不影响数据桥
				}
				bump();
				return { ok: true, sessionId, revision };
			}

			function unsubscribe() {
				cleanup();
				return { ok: true };
			}

			function snapshot() {
				if (active === null) throw new Error("尚未订阅会话");
				const chat = active.chat.getSnapshot();
				const session = active.session.getSnapshot();
				const nodes = [];
				for (const key of chat.order) {
					const node = chat.nodes.get(key);
					if (node) nodes.push(projectNode(node));
				}
				let navigation = [];
				try {
					navigation = sanitize(chat.navigation.items());
				} catch {
					navigation = [];
				}
				return {
					revision,
					sessionId: active.sessionId,
					title: sessionTitle(active.sessionId),
					session: sanitize(session),
					order: [...chat.order],
					nodes,
					navigation,
					timeline: sanitize(chat.timeline),
					pending: projectPending(pendingOf()),
					subagent: sanitize(active.session.getSnapshot()?.subagent ?? null)
				};
			}

			/** 读取一个会话投影的当前快照；投影未注册 / 尚未就绪时返回 undefined。 */
			function projectionValue(key) {
				try {
					const projections = sessionFace().projections;
					if (!projections || typeof projections.faceOf !== "function") return undefined;
					const face = projections.faceOf(key);
					return face && typeof face.getSnapshot === "function" ? face.getSnapshot() : undefined;
				} catch {
					return undefined;
				}
			}

			function tokenCount(value) {
				return typeof value === "number" && Number.isFinite(value) && value >= 0
					? Math.round(value)
					: undefined;
			}

			function contextCapacity(value) {
				return typeof value === "number" && Number.isFinite(value) && value > 0
					? Math.round(value)
					: undefined;
			}

			/** 上下文占用：provider 报的请求压力 + 下一次请求的启发式构成。 */
			function context() {
				if (active === null) throw new Error("尚未订阅会话");
				const pressure = projectionValue("contextPressure");
				const breakdown = projectionValue("contextBreakdown");
				const pressureTokens = tokenCount(pressure?.pressureTokens);
				const projectedTokens = tokenCount(pressure?.projectedTokens);
				const contextWindow = contextCapacity(pressure?.contextWindow);
				const systemTokens = tokenCount(breakdown?.systemTokens);
				const toolsTokens = tokenCount(breakdown?.toolsTokens);
				const messageTokens = tokenCount(breakdown?.messageTokens);
				return {
					pressure:
						pressureTokens === undefined &&
						projectedTokens === undefined &&
						contextWindow === undefined
							? null
							: {
									...(pressureTokens === undefined ? {} : { pressureTokens }),
									...(projectedTokens === undefined ? {} : { projectedTokens }),
									...(contextWindow === undefined ? {} : { contextWindow })
								},
					breakdown:
						systemTokens === undefined ||
						toolsTokens === undefined ||
						messageTokens === undefined
							? null
							: { systemTokens, toolsTokens, messageTokens }
				};
			}

			/**
			 * 团队（v6）：Lead 会话的 agentTeam 投影 + 成员运行状态 / 模型标签。
			 *
			 * 投影本身只带持久 roster（phase / error）与任务板；running 来自会话状态
			 * （与 Web 面板同源：api-session/status 事件），model 来自列表摘要里各成员的
			 * modelSelection 投影。未启用「智能体团队」bundle 时投影为空 → null，
			 * 原生端据此隐藏入口并把工具行 / 消息当普通内容处理。
			 */
			function team() {
				if (active === null) throw new Error("尚未订阅会话");
				const projection = projectionValue("agentTeam");
				if (!projection || typeof projection !== "object") return null;
				const members = Array.isArray(projection.members) ? projection.members : [];
				const tasks = Array.isArray(projection.tasks) ? projection.tasks : [];
				let statuses = null;
				try {
					statuses = active.uiSession?.sessionStatus?.getSnapshot?.() ?? null;
				} catch {
					statuses = null;
				}
				let list = null;
				try {
					list = sessionsService().list.getSnapshot();
				} catch {
					list = null;
				}
				return sanitize({
					members: members.map((member) => {
						const id = typeof member?.id === "string" ? member.id : "";
						let status = null;
						try {
							status = statuses?.get?.(id) ?? null;
						} catch {
							status = null;
						}
						const row = list?.byId?.[id] ?? null;
						const running =
							typeof status?.running === "boolean" ? status.running : row?.running === true;
						const pendingInteraction =
							status?.pendingInteraction !== undefined && status?.pendingInteraction !== null;
						const model = list?.projectionsBySession?.[id]?.values?.modelSelection?.next?.model;
						return {
							...member,
							running,
							pendingInteraction,
							model: typeof model === "string" ? model : null
						};
					}),
					tasks,
					...(projection.failure === undefined ? {} : { failure: projection.failure })
				});
			}

			/**
			 * 子智能体（v7）：目录根的直接子级 + 模式 / 运行状态 / 等待授权 / 未读 / 耗时 / token / 模型。
			 *
			 * 目录来自会话列表快照里的 summary 投影 subagentCatalog（父会话拥有），子行另拼
			 * subagentTiming / tokenUsage / modelSelection 与 uiSession.sessionStatus；未知 / 冷目录时
			 * 先 refreshProjections 再读一次。没有子代理时返回空数组，原生端据此隐藏入口。
			 */
			async function subagents() {
				if (active === null) throw new Error("尚未订阅会话");
				const rootId = catalogRootId();
				let values = projectionValuesOf(rootId);
				if (!Array.isArray(values?.subagentCatalog)) {
					try {
						await sessionsService().refreshProjections(rootId);
					} catch {
						// 目录未注册 / 冷历史：按空目录处理
					}
					values = projectionValuesOf(rootId);
				}
				const catalog = Array.isArray(values?.subagentCatalog) ? values.subagentCatalog : [];
				let statuses = null;
				try {
					statuses = active.uiSession?.sessionStatus?.getSnapshot?.() ?? null;
				} catch {
					statuses = null;
				}
				let list = null;
				try {
					list = sessionsService().list.getSnapshot();
				} catch {
					list = null;
				}
				const entries = [];
				for (const entry of catalog) {
					if (entry === null || typeof entry !== "object") continue;
					if (entry.mode === "external") continue;
					const id = typeof entry.id === "string" ? entry.id : "";
					if (id === "") continue;
					const row = list?.byId?.[id] ?? null;
					const childValues = projectionValuesOf(id);
					let status = null;
					try {
						status = statuses?.get?.(id) ?? null;
					} catch {
						status = null;
					}
					const timing = childValues?.subagentTiming ?? null;
					const usage = childValues?.tokenUsage ?? null;
					const totalTokens =
						usage === null || typeof usage !== "object"
							? null
							: (Number(usage.uncachedInputTokens) || 0) +
								(Number(usage.outputTokens) || 0) +
								(Number(usage.cacheReadTokens) || 0) +
								(Number(usage.cacheWriteTokens) || 0);
					const model = childValues?.modelSelection?.next?.model;
					const label = typeof entry.label === "string" && entry.label !== ""
						? entry.label
						: typeof row?.displayTitle === "string" && row.displayTitle !== ""
							? row.displayTitle
							: id;
					entries.push({
						id,
						label,
						title: typeof row?.displayTitle === "string" ? row.displayTitle : null,
						mode: entry.mode === "one-shot" || entry.mode === "continuable" ? entry.mode : "unknown",
						createdAt: typeof entry.createdAt === "number" ? entry.createdAt : null,
						running: typeof status?.running === "boolean" ? status.running : row?.running === true,
						pendingInteraction:
							status?.pendingInteraction !== undefined && status?.pendingInteraction !== null,
						unread: status?.completionUnread === true,
						settledMs:
							typeof timing?.settledMs === "number" && timing.settledMs >= 0
								? timing.settledMs
								: null,
						activeSince:
							typeof timing?.active?.since === "number" ? timing.active.since : null,
						totalTokens,
						model: typeof model === "string" ? model : null,
						current: id === active.sessionId
					});
				}
				return sanitize({
					rootSessionId: rootId,
					currentSessionId: active.sessionId,
					entries
				});
			}

			/* ---- v8：目标条数据面（goal 投影 + remote.goals 目标操作） ---- */

			/** 目标 phase 的合法值；未知值按 active 处理，避免原生端丢目标条。 */
			function goalPhase(value) {
				return value === "paused" || value === "blocked" || value === "complete" ? value : "active";
			}

			/** 进程内 activation 的合法值；未知值视为尚未读到。 */
			function goalActivation(value) {
				return value === "armed" || value === "disarmed" ? value : null;
			}

			/** 数字字段兜底：Number() 后非有限值回退到 fallback。 */
			function goalCount(value, fallback) {
				const count = Number(value);
				return Number.isFinite(count) ? count : fallback;
			}

			/** 当前会话 goal 投影里的 durable goal；投影未注册 / 当前无目标时 null。 */
			function currentGoal() {
				if (active === null) return null;
				const projection = projectionValue("goal");
				const value = projection?.goal;
				if (value === null || typeof value !== "object") return null;
				if (value.id === undefined || value.id === null) return null;
				return value;
			}

			/** activation 缓存按 { id, revision } 精确匹配；未命中返回 null。 */
			function cachedActivation(id, revision) {
				if (activationCache === null) return null;
				if (activationCache.id !== id || activationCache.revision !== revision) return null;
				return activationCache.activation;
			}

			/**
			 * activation 不在 durable 投影里（进程内状态），只能按需向宿主读一次。
			 * 同一 { id, revision } 只允许一个并发读；读失败保持静默，下次目标变化再试。
			 */
			function refreshActivation(value) {
				if (active === null) return;
				const service = remotes.goals;
				if (!service || typeof service.get !== "function") return;
				const id = String(value.id);
				const revision = Number(value.revision);
				const key = id + "\u0000" + revision;
				if (activationReadKey === key) return;
				activationReadKey = key;
				const sessionId = active.sessionId;
				Promise.resolve()
					.then(() => service.get(sessionId))
					.then((response) => {
						const result = response?.result ?? response;
						if (!result || result.ok !== true) return;
						const view = result.value;
						if (!view || typeof view !== "object") return;
						if (active === null || active.sessionId !== sessionId) return;
						const current = currentGoal();
						if (current === null) return;
						if (String(current.id) !== id || Number(current.revision) !== revision) return;
						const activation = goalActivation(view.activation);
						if (activation === null) return;
						activationCache = { id, revision, activation };
						bump();
					})
					.catch(() => {
						// 读失败保持静默：目标条只显示 durable phase
					})
					.finally(() => {
						if (activationReadKey === key) activationReadKey = null;
					});
			}

			/**
			 * 目标条（v8）：当前会话的 goal 投影 + 按需 activation。
			 * 没有目标 / goal 投影未注册时返回 null；activation 未知时不带该字段。
			 */
			function goal() {
				if (active === null) throw new Error("尚未订阅会话");
				const projection = projectionValue("goal");
				if (!projection || typeof projection !== "object") return null;
				const value = projection.goal;
				if (!value || typeof value !== "object") return null;
				const id = String(value.id ?? "");
				if (id === "") return null;
				const revision = Number(value.revision);
				const phase = goalPhase(value.phase);
				const result = {
					id,
					revision,
					objective: typeof value.objective === "string" ? value.objective : "",
					phase,
					maxGoalRounds: goalCount(value.maxGoalRounds, 0),
					roundsStarted: goalCount(projection.roundsStarted, 0)
				};
				if (phase === "blocked" && value.blockedReason && typeof value.blockedReason === "object") {
					result.blockedReason = {
						code: typeof value.blockedReason.code === "string" ? value.blockedReason.code : "",
						message:
							typeof value.blockedReason.message === "string" ? value.blockedReason.message : ""
					};
				}
				if (phase === "active") {
					const cached = cachedActivation(id, revision);
					if (cached !== null) {
						result.activation = cached;
					} else {
						refreshActivation(value);
					}
				}
				return result;
			}

			const GOAL_ACTIONS = ["edit", "pause", "resume", "clear"];

			function goalError(code, message) {
				return { ok: false, error: { code, message } };
			}

			function goalUnavailable(detail) {
				const suffix = typeof detail === "string" && detail !== "" ? "：" + detail : "";
				return goalError(
					"goal-unavailable",
					"目标服务不可用（需要 dsh 0.2.x 的 goal 插件）" + suffix
				);
			}

			/**
			 * 目标操作（v8）：edit / pause / resume / clear，ref 取当前投影的 { id, revision }。
			 * 业务错误与远端失败都以 { ok: false, error } 返回，不抛错（原生端直接展示）。
			 */
			async function goalAction(action, value) {
				if (GOAL_ACTIONS.indexOf(action) < 0) {
					return goalError("invalid-action", "未知目标操作：" + String(action));
				}
				if (active === null) return goalError("no-current-goal", "当前没有目标");
				const sessionId = active.sessionId;
				const current = currentGoal();
				if (current === null) return goalError("no-current-goal", "当前没有目标");
				const ref = { id: current.id, revision: Number(current.revision) };
				let objective = "";
				if (action === "edit") {
					objective = typeof value === "string" ? value.trim() : "";
					if (objective === "") return goalError("invalid-objective", "目标内容不能为空");
				}
				const service = remotes.goals;
				if (!service || typeof service[action] !== "function") return goalUnavailable();
				let response;
				try {
					response =
						action === "edit"
							? await service.edit(sessionId, ref, { objective })
							: await service[action](sessionId, ref);
				} catch (error) {
					return goalUnavailable(typeof error?.message === "string" ? error.message : "");
				}
				const result = response?.result ?? response;
				if (!result || result.ok !== true) {
					return {
						ok: false,
						error: {
							code: typeof result?.error?.code === "string" ? result.error.code : "goal-failed",
							message:
								typeof result?.error?.message === "string"
									? result.error.message
									: "目标操作失败"
						}
					};
				}
				const view = result.value;
				// 期间可能已切会话：只在仍是同一会话时刷新缓存，避免把旧结果写进新会话。
				if (view && typeof view === "object" && active !== null && active.sessionId === sessionId) {
					const activation = goalActivation(view.activation);
					if (activation !== null) {
						activationCache = {
							id: String(view.id ?? ref.id),
							revision: Number(view.revision ?? ref.revision),
							activation
						};
					}
				}
				bump();
				return { ok: true };
			}

			function nextEvent(cursor, timeoutMs, liveCursor) {
				const trackLive = liveCursor !== undefined && liveCursor !== null;
				const packet = () => ({
					cursor: revision,
					changed: cursor !== revision,
					liveCursor: liveRevision,
					live: livePacket()
				});
				if (cursor !== revision || (trackLive && liveCursor !== liveRevision)) {
					return Promise.resolve(packet());
				}
				const waitMs = Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 30000);
				return new Promise((resolve) => {
					const waiter = { done: false, timer: 0 };
					const finish = () => {
						if (waiter.done) return;
						waiter.done = true;
						clearTimeout(waiter.timer);
						waiters.delete(waiter);
						resolve(packet());
					};
					waiter.fire = () => {
						// 旧原生端（不传 liveCursor）只关心结构变化；live 唤醒时继续等。
						if (!trackLive && cursor === revision) return;
						finish();
					};
					waiter.timer = setTimeout(finish, waitMs);
					waiters.add(waiter);
				});
			}

			async function send(text) {
				const result = await sessionFace().prompt([{ type: "text", text: String(text ?? "") }], "queue");
				if (!result.ok) {
					throw new Error("session.prompt failed: " + result.error.code + ": " + result.error.message);
				}
				return { ok: true };
			}

			async function cancel() {
				const result = await sessionFace().cancel();
				if (!result.ok) {
					throw new Error("session.cancel failed: " + result.error.code + ": " + result.error.message);
				}
				return { ok: true };
			}

			async function loadOlder() {
				await sessionFace().loadOlder();
				return { ok: true };
			}

			function unwrapRpc(response, label) {
				const result = response?.result ?? response;
				if (!result || result.ok !== true) {
					const error = result?.error;
					throw new Error(label + " failed: " + (error?.code ?? "unknown") + ": " + (error?.message ?? "unknown"));
				}
				return result.value;
			}

			/** 0.2.x 的模型目录：优先用 modelDirectories（官方 UI 同款），退回到 connection.api.sessions。 */
			function modelDirectory() {
				if (active === null) throw new Error("尚未订阅会话");
				const resolver = safeGet(ctx, "modelDirectories");
				if (resolver && typeof resolver.directoryFor === "function") {
					return resolver.directoryFor(active.sessionId);
				}
				const sessions = safeGet(ctx, "sessions");
				const scope = sessions ? sessions.scope(active.sessionId) : null;
				const scoped = scope ? scope.get("modelDirectories") : null;
				if (scoped && typeof scoped.directoryFor === "function") {
					return scoped.directoryFor(active.sessionId);
				}
				const wire = wireSessions();
				return {
					store: null,
					load: () => wire.models({ sessionId: active.sessionId }),
					select: (selection) =>
						wire.selectModel({
							sessionId: active.sessionId,
							provider: selection.provider,
							model: selection.model,
							...(selection.reasoningEffort === undefined
								? {}
								: { reasoningEffort: selection.reasoningEffort })
						})
				};
			}

			function effortId(value, modelId, groups) {
				if (typeof value !== "string" || value.length === 0) return undefined;
				for (const group of Array.isArray(groups) ? groups : []) {
					for (const model of Array.isArray(group.models) ? group.models : []) {
						if (model.id !== modelId) continue;
						for (const effort of model.reasoning?.efforts ?? []) {
							if (effort.id === value || effort.name === value) return effort.id;
						}
					}
				}
				return value;
			}

			async function models() {
				const directory = modelDirectory();
				if (directory.store === null) {
					const value = unwrapRpc(await directory.load(), "session.models");
					return {
						current: value?.current ?? null,
						routable: value?.routable !== false,
						groups: Array.isArray(value?.groups) ? value.groups : [],
						failures: Array.isArray(value?.failures) ? value.failures : []
					};
				}
				let snapshot = directory.store.getSnapshot();
				if (!snapshot || snapshot.status === "idle" || snapshot.status === "error") {
					try {
						await directory.load();
					} catch (error) {
						// 下面的 error 分支统一抛出，保持文案一致
					}
					snapshot = directory.store.getSnapshot();
				}
				if (snapshot.status === "error" && snapshot.error) {
					throw new Error("session.models failed: " + snapshot.error);
				}
				const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
				const current = snapshot.current
					? {
							provider: snapshot.current.provider,
							model: snapshot.current.model,
							reasoningEffort: effortId(
								snapshot.retainedEffort,
								snapshot.current.model,
								groups,
							)
						}
					: null;
				return {
					current,
					routable: snapshot.routable !== false,
					groups,
					failures: Array.isArray(snapshot.failures) ? snapshot.failures : []
				};
			}

			async function selectModel(input) {
				if (active === null) throw new Error("尚未订阅会话");
				if (!input || typeof input.provider !== "string" || typeof input.model !== "string") {
					throw new Error("selection 必须是 { provider, model, reasoningEffort? }");
				}
				const selection = { provider: input.provider, model: input.model };
				if (typeof input.reasoningEffort === "string" && input.reasoningEffort.length > 0) {
					selection.reasoningEffort = input.reasoningEffort;
				}
				const directory = modelDirectory();
				let selected = selection;
				if (directory.store === null) {
					const value = unwrapRpc(await directory.select(selection), "session.selectModel");
					selected = value?.selected ?? selection;
				} else {
					await directory.select(selection);
					selected = directory.store.getSnapshot()?.current ?? selection;
				}
				bump();
				return { ok: true, selected };
			}

			const PERMISSION_FALLBACK = [
				{
					value: "read-only",
					description: "Read-only access; writes and commands that change files are rejected."
				},
				{
					value: "workspace-write",
					description: "Write inside the workspace and permitted temporary directories; wider retries require approval."
				},
				{
					value: "danger-full-access",
					description: "Full file access without approval prompts."
				}
			];

			/** 官方 PermissionSelect 的显示规则：kebab-case 转 Title Case，完全访问用产品名。 */
			function permissionLabel(value) {
				if (value === "danger-full-access") return "Full access";
				if (value === "custom") return "Custom";
				if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) return value;
				return value
					.split("-")
					.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
					.join(" ");
			}

			function permissions() {
				const live = sessionFace();
				const face = live.projections?.faceOf?.("permissions");
				if (!face) return null;
				const value = face.getSnapshot?.();
				if (!value || typeof value !== "object") return null;
				const currentValue =
					typeof value.currentValue === "string" ? value.currentValue : "custom";
				// 0.2.x 的会话投影只推 currentValue；宿主未广告 options 时用内置预设兜底。
				const options =
					Array.isArray(value.options) && value.options.length > 0
						? value.options.map((option) => ({
								value: option.value,
								name: option.name ?? permissionLabel(option.value),
								description: option.description
							}))
						: PERMISSION_FALLBACK.map((preset) => ({
								value: preset.value,
								name: permissionLabel(preset.value),
								description: preset.description
							}));
				if (currentValue === "custom" && !options.some((option) => option.value === "custom")) {
					options.push({
						value: "custom",
						name: "Custom",
						description: "Current sandbox and approval settings do not match a preset."
					});
				}
				return { currentValue, options };
			}

			async function setPermission(preset) {
				if (typeof preset !== "string" || preset.length === 0) throw new Error("缺少权限 preset");
				const result = await sessionFace().command("/permission " + preset);
				if (!result?.ok) {
					throw new Error("permission switch failed: " + (result?.error?.code ?? "unknown") + ": " + (result?.error?.message ?? "unknown"));
				}
				if (!result.value?.matched) throw new Error("the host offers no /permission command");
				bump();
				return { ok: true };
			}

			async function renameSession(title) {
				if (active === null) throw new Error("尚未订阅会话");
				if (typeof title !== "string") throw new Error("缺少 title");
				const result = await sessionFace().rename(title);
				if (!result.ok) {
					throw new Error("session.rename failed: " + result.error.code + ": " + result.error.message);
				}
				bump();
				return { ok: true, title: result.value.title };
			}

			async function approvalAnswer(decision) {
				const pending = pendingOf();
				if (pending?.kind !== "approval") throw new Error("当前没有待审批请求");
				if (pending.answerable === false) throw new Error("审批请求已结束");
				if (decision !== "allowed-once" && decision !== "rejected") {
					throw new Error("decision 只能是 allowed-once 或 rejected");
				}
				await pending.answer(decision);
				return { ok: true };
			}

			async function questionAnswer(answer) {
				const pending = pendingOf();
				if (pending?.kind !== "question" && pending?.kind !== "plan-review") {
					throw new Error("当前没有待回答的问题");
				}
				if (!answer || !Array.isArray(answer.answers)) {
					throw new Error("answer 必须是 { answers: [...] }");
				}
				await pending.answer(answer);
				return { ok: true };
			}

			/* ---- v5："/" 命令菜单的数据面（都按当前订阅会话寻址） ---- */

			/**
			 * remote.* 是带作用域的注入项（cordis 会拒绝 "without inject" 的访问）：
			 * apply() 里用 ctx.inject 子 fiber 把命名空间挂到 remotes 上，这里只负责取用。
			 * 这样 profile 没装 commands / skills 插件时只是这两个功能报错，整个桥照常加载。
			 */
			function remoteService(namespace, method) {
				const service = remotes[namespace];
				if (!service || typeof service[method] !== "function") {
					throw new Error(namespace + " 服务不可用（需要 dsh 0.2.x 的对应插件）");
				}
				return service;
			}

			function subscribedSessionId() {
				if (active === null) throw new Error("尚未订阅会话");
				return active.sessionId;
			}

			/** 宿主命令目录（当前会话的组合）：name + description，供 "/" 菜单显示。 */
			async function commands() {
				const sessionId = subscribedSessionId();
				const value = unwrapRpc(
					await remoteService("commands", "list").list(sessionId),
					"command.list"
				);
				const list = Array.isArray(value) ? value : [];
				return {
					commands: list
						.map((command) => ({
							name: typeof command?.name === "string" ? command.name : "",
							description:
								typeof command?.description === "string" ? command.description : ""
						}))
						.filter((command) => command.name.length > 0)
				};
			}

			/** 当前会话可见的人类可调用技能目录（dsh 的 skills/list）。 */
			async function skills() {
				const sessionId = subscribedSessionId();
				const value = unwrapRpc(
					await remoteService("skills", "list").list(
						{ sessionId },
						new AbortController().signal
					),
					"skills/list"
				);
				const list = Array.isArray(value?.skills) ? value.skills : [];
				return {
					skills: list
						.map((skill) => ({
							name: typeof skill?.name === "string" ? skill.name : "",
							description:
								typeof skill?.description === "string" ? skill.description : "",
							modelInvocable: skill?.modelInvocable !== false
						}))
						.filter((skill) => skill.name.length > 0)
				};
			}

			/**
			 * 提交一条 `/name …` 命令行（宿主 command.execute 准入）。
			 * 宿主没注册该名字时返回 matched=false，其余把宿主的 CommandResult 原样带回。
			 */
			async function executeCommand(line) {
				const text = typeof line === "string" ? line.trim() : "";
				if (text === "") throw new Error("命令为空");
				const sessionId = subscribedSessionId();
				const value = unwrapRpc(
					await remoteService("commands", "execute").execute(sessionId, text, []),
					"command.execute"
				);
				if (value === undefined || value === null) {
					return {
						ok: true,
						matched: false,
						result: { kind: "error", text: "未知命令：" + text }
					};
				}
				const outcome = value.result ?? null;
				return {
					ok: true,
					matched: true,
					result: {
						kind: outcome?.kind === "error" ? "error" : "success",
						text: typeof outcome?.text === "string" ? outcome.text : null
					}
				};
			}

			return {
				listSessions,
				createSession,
				openSession: subscribe,
				subscribe,
				unsubscribe,
				snapshot,
				diagnose,
				nextEvent,
				send,
				cancel,
				loadOlder,
				models,
				selectModel,
				permissions,
				setPermission,
				renameSession,
				approvalAnswer,
				questionAnswer,
				context,
				team,
				subagents,
				goal,
				goalAction,
				commands,
				skills,
				executeCommand,
				dispose: cleanup
			};
		}

		function apply(ctx) {
			/** v5 / v8 的 remote 命名空间（命令目录 / 技能目录 / 目标），由 ctx.inject 子 fiber 填充。 */
			const remotes = { commands: null, skills: null, goals: null, remote: null };
			const native = nativeApi(ctx, remotes);
			ctx.inject(["remote", "remote.commands"], (scope) => {
				remotes.commands = scope.remote.commands;
				return () => {
					remotes.commands = null;
				};
			});
			ctx.inject(["remote", "remote.skills"], (scope) => {
				remotes.skills = scope.remote.skills;
				return () => {
					remotes.skills = null;
				};
			});
			// v8 goal：goals 命名空间负责目标操作，remote 本体负责 goal/activation-changed 事件。
			ctx.inject(["remote", "remote.goals"], (scope) => {
				remotes.goals = scope.remote.goals;
				remotes.remote = scope.remote;
				return () => {
					remotes.goals = null;
					remotes.remote = null;
				};
			});
			const bridge = {
				version: VERSION,
				ping: () => ({
					version: VERSION,
					native: true,
					methods: [
						"models",
						"selectModel",
						"permissions",
						"setPermission",
						"renameSession",
						"liveStream",
						"context",
						"team",
						"subagents",
						"goal",
						"goalAction",
						"commands",
						"skills",
						"executeCommand"
					]
				}),
				listSessions: () => native.listSessions(),
				createSession: (cwd) => native.createSession(cwd),
				openSession: (target) => native.openSession(target),
				subscribe: (target) => native.subscribe(target),
				unsubscribe: () => native.unsubscribe(),
				snapshot: () => native.snapshot(),
				diagnose: () => native.diagnose(),
				nextEvent: (cursor, timeoutMs, liveCursor) => native.nextEvent(cursor, timeoutMs, liveCursor),
				send: (text) => native.send(text),
				cancel: () => native.cancel(),
				loadOlder: () => native.loadOlder(),
				models: () => native.models(),
				selectModel: (selection) => native.selectModel(selection),
				permissions: () => native.permissions(),
				setPermission: (preset) => native.setPermission(preset),
				renameSession: (title) => native.renameSession(title),
				approvalAnswer: (decision) => native.approvalAnswer(decision),
				questionAnswer: (answer) => native.questionAnswer(answer),
				context: () => native.context(),
				team: () => native.team(),
				subagents: () => native.subagents(),
				goal: () => native.goal(),
				goalAction: (action, value) => native.goalAction(action, value),
				commands: () => native.commands(),
				skills: () => native.skills(),
				executeCommand: (line) => native.executeCommand(line)
			};
			window[GLOBAL_KEY] = bridge;

			ctx.effect(() => {
				return () => {
					native.dispose();
					if (window[GLOBAL_KEY] === bridge) delete window[GLOBAL_KEY];
				};
			}, "obsidian-bridge: native data");
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});
