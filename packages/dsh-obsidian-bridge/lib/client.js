/* dsh-obsidian-bridge — client half (browser).
 *
 * Obsidian 嵌入专用（纯客户端）。同一页面全局对象同时承载两代能力：
 *   v1 布局：configure / newSession / enforceSingleColumn / state
 *   v2 原生数据桥：listSessions / subscribe / snapshot / nextEvent /
 *                  send / cancel / loadOlder / approvalAnswer / questionAnswer
 *
 * Obsidian 通过 <webview>.executeJavaScript() 调用；桥只返回 JSON DTO。
 * 只支持 DSH 0.2.x。
 */
window.__ModuleLoader__.load({
	id: "dsh-obsidian-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const VERSION = 2;
		const GLOBAL_KEY = "__DSH_OBSIDIAN_BRIDGE__";
		const STYLE_ID = "dsh-obsidian-single-column";
		const ENFORCE_INTERVAL_MS = 500;
		const TOGGLE_GUARD_MS = 1200;
		const MAX_DEPTH = 8;
		const MAX_ARRAY = 300;
		const MAX_KEYS = 60;
		const MAX_STRING = 20000;

		let workspaceId;
		let workspacePath;
		let lastSidebarToggleAt = 0;
		let lastRightbarToggleAt = 0;

		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		function normalizePath(value) {
			if (typeof value !== "string") return "";
			return value.trim().replace(/[\\/]+$/, "");
		}

		function safeGet(ctx, name) {
			try {
				return ctx.get(name);
			} catch {
				return undefined;
			}
		}

		/** Hash-free selectors: data attributes and structural position only. */
		function injectCss() {
			if (typeof document === "undefined" || document.head === null) return;
			const existing = document.getElementById(STYLE_ID);
			if (existing !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = [
				"div:has(> [data-rightbar-col]) { grid-template-columns: 0px minmax(0, 1fr) 0px !important; }",
				"div:has(> [data-rightbar-col]) > :first-child { visibility: hidden !important; }",
				"div:has(> [data-rightbar-col]) > [data-rightbar-col] { visibility: hidden !important; }",
				"div:has(> [data-rightbar-col]) [data-side] { display: none !important; }"
			].join("\n");
			document.head.appendChild(style);
		}

		function removeCss() {
			if (typeof document === "undefined") return;
			document.getElementById(STYLE_ID)?.remove();
		}

		async function readyWorkspaces(ctx) {
			const workspaces = ctx.get("workspaces");
			if (!workspaces) throw new Error("workspaces 服务不可用");
			for (let attempt = 0; attempt < 100; attempt++) {
				const snapshot = workspaces.list.getSnapshot();
				if (snapshot.phase === "ready") return { workspaces, snapshot };
				if (snapshot.state === "error") throw new Error("工作区列表加载失败");
				await sleep(100);
			}
			throw new Error("工作区列表未就绪");
		}

		function state() {
			return {
				version: VERSION,
				workspaceId: workspaceId ?? null,
				workspacePath: workspacePath ?? null,
				singleColumn: true
			};
		}

		async function configure(ctx, input) {
			const raw = Array.isArray(input?.paths) ? input.paths : [];
			const paths = raw.map(normalizePath).filter(Boolean);
			if (paths.length === 0) throw new Error("缺少库目录路径");
			const { workspaces, snapshot } = await readyWorkspaces(ctx);
			for (const wanted of paths) {
				const hit = snapshot.items.find((item) => normalizePath(item.path) === wanted);
				if (hit) {
					workspaceId = hit.workspaceId;
					workspacePath = hit.path;
					return state();
				}
			}
			const created = await workspaces.create({ path: raw[0] });
			workspaceId = created.workspaceId;
			workspacePath = created.path;
			for (let attempt = 0; attempt < 20; attempt++) {
				const row = workspaces.list
					.getSnapshot()
					.items.find((item) => item.workspaceId === created.workspaceId);
				if (row) {
					workspacePath = row.path;
					break;
				}
				await sleep(100);
			}
			return state();
		}

		function newSession(ctx) {
			if (workspaceId === undefined) throw new Error("桥尚未配置工作区，请先调用 configure()");
			const ui = ctx.get("uiWorkspace");
			if (!ui || typeof ui.startSession !== "function") throw new Error("uiWorkspace 服务不可用");
			ui.startSession(workspaceId);
			return { ok: true, workspaceId, workspacePath: workspacePath ?? null };
		}

		/** Collapse both side columns; safe when services/DOM are not ready yet. */
		function enforceSingleColumn(ctx) {
			if (typeof document === "undefined") {
				return { sidebarCollapsed: null, rightbarExpanded: null, css: false };
			}
			injectCss();
			const result = { sidebarCollapsed: null, rightbarExpanded: null, css: true };
			const frame = document.querySelector("[data-rightbar-col]")?.parentElement;
			if (frame) {
				result.sidebarCollapsed = frame.hasAttribute("data-sidebar-collapsed");
				if (!result.sidebarCollapsed && Date.now() - lastSidebarToggleAt > TOGGLE_GUARD_MS) {
					const layout = ctx.get("layout");
					if (layout && typeof layout.toggleSidebar === "function") {
						try {
							layout.toggleSidebar();
							lastSidebarToggleAt = Date.now();
							result.sidebarCollapsed = true;
						} catch (error) {
							console.warn("[obsidian-bridge] 收起左栏失败", error);
						}
					}
				}
			}
			const right = ctx.get("sidebarRight");
			if (right && typeof right.isExpanded === "function") {
				try {
					result.rightbarExpanded = right.isExpanded();
				} catch {
					result.rightbarExpanded = null;
				}
				if (result.rightbarExpanded && Date.now() - lastRightbarToggleAt > TOGGLE_GUARD_MS) {
					try {
						right.toggleExpanded();
						lastRightbarToggleAt = Date.now();
						result.rightbarExpanded = false;
					} catch (error) {
						console.warn("[obsidian-bridge] 收起右栏失败", error);
					}
				}
			}
			return result;
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

		function nativeApi(ctx) {
			let active = null;
			let revision = 0;
			let disposed = false;
			const waiters = new Set();

			function bump() {
				revision += 1;
				for (const waiter of [...waiters]) waiter.fire();
			}

			function cleanup() {
				if (active === null) return;
				const current = active;
				active = null;
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
						updatedAt: row?.updatedAt ?? null
					};
				});
				return { phase: snapshot.phase ?? null, sessions };
			}

			async function subscribe(sessionId) {
				if (typeof sessionId !== "string" || sessionId.length === 0) {
					throw new Error("缺少会话 id");
				}
				if (active?.sessionId === sessionId) {
					return { ok: true, sessionId, revision };
				}
				cleanup();
				const sessions = sessionsService();
				let uiSession = safeGet(ctx, "uiSession");
				for (let attempt = 0; attempt < 50; attempt++) {
					if (uiSession?.adapter?.bindingSource) break;
					await sleep(100);
					uiSession = safeGet(ctx, "uiSession");
				}
				if (!uiSession?.adapter?.bindingSource) throw new Error("uiSession 服务不可用");
				const ref = sessions.retain(sessionId, { source: "obsidianBridge" });
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
				const unsubs = [
					chat.subscribe(bump),
					session.subscribe(bump),
					uiSession.sessionStatus.subscribe(bump)
				];
				active = { sessionId, ref, chat, session, uiSession, unsubs };
				try {
					const uiWorkspace = safeGet(ctx, "uiWorkspace");
					if (typeof uiWorkspace?.openSession === "function") uiWorkspace.openSession(sessionId);
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
					pending: projectPending(pendingOf())
				};
			}

			function nextEvent(cursor, timeoutMs) {
				const current = revision;
				if (cursor !== current) return Promise.resolve({ cursor: current, changed: true });
				const waitMs = Math.min(Math.max(Number(timeoutMs) || 20000, 1000), 30000);
				return new Promise((resolve) => {
					const waiter = { done: false, timer: 0 };
					const finish = (changed) => {
						if (waiter.done) return;
						waiter.done = true;
						clearTimeout(waiter.timer);
						waiters.delete(waiter);
						resolve({ cursor: revision, changed });
					};
					waiter.fire = () => finish(true);
					waiter.timer = setTimeout(() => finish(revision !== cursor), waitMs);
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
				dispose: cleanup
			};
		}

		function apply(ctx) {
			const native = nativeApi(ctx);
			const bridge = {
				version: VERSION,
				ping: () => ({
					version: VERSION,
					native: true,
					methods: ["models", "selectModel", "permissions", "setPermission", "renameSession"]
				}),
				configure: (input) => configure(ctx, input),
				newSession: () => newSession(ctx),
				enforceSingleColumn: () => enforceSingleColumn(ctx),
				state: () => state(),
				listSessions: () => native.listSessions(),
				createSession: (cwd) => native.createSession(cwd),
				openSession: (id) => native.openSession(id),
				subscribe: (id) => native.subscribe(id),
				unsubscribe: () => native.unsubscribe(),
				snapshot: () => native.snapshot(),
				diagnose: () => native.diagnose(),
				nextEvent: (cursor, timeoutMs) => native.nextEvent(cursor, timeoutMs),
				send: (text) => native.send(text),
				cancel: () => native.cancel(),
				loadOlder: () => native.loadOlder(),
				models: () => native.models(),
				selectModel: (selection) => native.selectModel(selection),
				permissions: () => native.permissions(),
				setPermission: (preset) => native.setPermission(preset),
				renameSession: (title) => native.renameSession(title),
				approvalAnswer: (decision) => native.approvalAnswer(decision),
				questionAnswer: (answer) => native.questionAnswer(answer)
			};
			window[GLOBAL_KEY] = bridge;

			const enforce = () => {
				try {
					enforceSingleColumn(ctx);
				} catch (error) {
					console.warn("[obsidian-bridge]", error);
				}
			};

			ctx.effect(() => {
				injectCss();
				const timer = setInterval(enforce, ENFORCE_INTERVAL_MS);
				const kicks = [0, 300, 1000, 2000, 4000].map((ms) => setTimeout(enforce, ms));
				return () => {
					clearInterval(timer);
					for (const handle of kicks) clearTimeout(handle);
					removeCss();
					native.dispose();
					if (window[GLOBAL_KEY] === bridge) delete window[GLOBAL_KEY];
				};
			}, "obsidian-bridge: single column + native data");
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});
