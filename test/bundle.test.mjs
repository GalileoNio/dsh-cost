/**
 * Verification harness for the session-cost client bundle.
 *
 * It materializes the real `lib/client.js` with stubbed React/DOM, applies it
 * to a fake client Context, then drives the real component function to check
 * what it renders — which is arithmetic over the Host's wire, so the fixtures
 * fix both sides of every multiplication.
 *
 *   node test/bundle.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, "..", "lib", "client.js");
const LOADED = readFileSync(BUNDLE, "utf8");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (ok) pass += 1;
	else fail += 1;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected: ${expected}\n       actual:   ${actual}`}`);
}
function checkJson(label, actual, expected) {
	check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// ── deterministic environment stubs ──────────────────────────────────────────
let registration;
const moduleLoader = { load: (record) => { registration = record; } };
const styleTags = [];
/** Harness switch: force the disclosure open so the panel branch renders. */
let harnessOpen = false;

globalThis.window = {
	innerWidth: 1200,
	innerHeight: 800,
	addEventListener() {},
	removeEventListener() {},
	__ModuleLoader__: moduleLoader
};
globalThis.document = {
	head: { appendChild: (tag) => styleTags.push(tag) },
	body: {},
	querySelector: () => null,
	createElement: () => ({ dataset: {}, style: {}, textContent: "" }),
	addEventListener() {},
	removeEventListener() {}
};

const react = {
	Fragment: Symbol("Fragment"),
	/** Minimal base for the settings error boundary, which has to be a class. */
	Component: class Component {
		constructor(props) {
			this.props = props ?? {};
			this.state = {};
		}
		setState(next) {
			this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) };
		}
	},
	createElement(type, props, ...children) {
		const node = { type, props: { ...(props ?? {}) } };
		if (children.length > 0) node.props.children = children.length === 1 ? children[0] : children;
		return node;
	},
	useRef: (value) => ({ current: value === undefined ? null : value }),
	useState: (value) => {
		const initial = typeof value === "function" ? value() : value;
		// Outside a mount the pill cases only need the initial value.
		if (stateSlots === null) return [harnessOpen && initial === false ? true : initial, () => {}];
		const at = stateCursor;
		stateCursor += 1;
		// Capture this render's slots: an async setter (a queued save) lands after
		// the draw loop has cleared the module-level cursor.
		const slots = stateSlots;
		if (!(at in slots)) slots[at] = initial;
		return [slots[at], (next) => {
			slots[at] = typeof next === "function" ? next(slots[at]) : next;
			stateDirty = true;
		}];
	},
	useCallback: (fn) => fn,
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useLayoutEffect: () => {},
	useEffect: (fn) => {
		// Inside a mount, run it eagerly so a state write during the effect is
		// picked up by the draw loop; outside one it stays inert.
		if (stateSlots === null) return;
		fn();
	}
};

/** Per-render hook slots, shared across the renders of one mount. */
let stateSlots = null;
let stateCursor = 0;
let stateDirty = false;
/**
 * Render a hook-using component repeatedly until its state settles, the way
 * React does, so a test can drive an input and then observe the re-render.
 * @param component - the component function.
 * @param props - its props.
 * @returns a drawer that re-renders on demand, plus the raw state slots.
 */
function mount(component, props) {
	const slots = [];
	const draw = () => {
		let tree = null;
		for (let pass = 0; pass < 8; pass += 1) {
			stateSlots = slots;
			stateCursor = 0;
			stateDirty = false;
			tree = component(props);
			stateSlots = null;
			if (stateDirty !== true) break;
		}
		return tree;
	};
	return { draw, slots };
}
/** Render one element the way React would: function components called, classes instantiated. */
function renderNode(node) {
	if (typeof node.type !== "function") return null;
	if (node.type.prototype instanceof react.Component) {
		return new node.type(node.props).render();
	}
	return node.type(node.props);
}
/** Every element in a tree, resolving function and class components as React would. */
function elements(node, out = []) {
	if (Array.isArray(node)) {
		for (const child of node) elements(child, out);
		return out;
	}
	if (node === null || node === undefined || typeof node !== "object") return out;
	out.push(node);
	if (typeof node.type === "function") {
		elements(renderNode(node), out);
		return out;
	}
	elements(node.props?.children, out);
	return out;
}
function bundleRequire(specifier) {
	if (specifier === "react") return react;
	if (specifier === "react-dom") return { createPortal: (node) => node };
	throw new Error(`bundle required an unexpected module: ${specifier}`);
}

/**
 * A stand-in for the settings transport's `ConfigForm`.
 *
 * The shipped one is a class whose methods read `this.store`, and React calls
 * `subscribe` and `getSnapshot` detached. Shaping the stub the same way is what
 * makes that failure visible here: an unbound pass-through throws
 * "Cannot read properties of undefined (reading 'store')", which is exactly how
 * the settings page died in the browser while every arrow-function stub kept
 * passing.
 */
class StubConfigForm {
	constructor(value, refuseWrites) {
		this.store = {
			snapshot: {
				status: value === undefined ? "loading" : "ready",
				writable: true,
				mode: "host",
				revision: 1,
				value
			}
		};
		this.listeners = new Set();
		this.writes = [];
		this.refuseWrites = refuseWrites === true;
	}
	getSnapshot() {
		return this.store.snapshot;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	set(field, value) {
		this.writes.push([field, value]);
		return Promise.resolve(!this.refuseWrites);
	}
	unset(field) {
		this.writes.push([field, null]);
		return Promise.resolve(!this.refuseWrites);
	}
	mutate() {
		return Promise.resolve(!this.refuseWrites);
	}
}

/**
 * Materialize the bundle and apply it to a recording fake Context.
 * @param options - the settings value the stubbed ConfigForm should serve.
 * @returns the registration record, the call log, and the write log.
 */
function applyToFakeContext(options = {}) {
	const log = [];
	const registered = [];
	const settings = new StubConfigForm(options.settingsValue, options.refuseWrites);
	const writes = settings.writes;
	const settingsState = settings.getSnapshot();
	const ctx = {
		effect(fn, label) {
			log.push(["effect", label]);
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => {};
		},
		locale: {
			register(ns, dictionaries) {
				log.push(["locale", ns, dictionaries]);
				return () => {};
			}
		},
		inject(deps, callback) {
			log.push(["ctx.inject", deps.join(",")]);
			const scope = { slots: ctx.slots };
			if (deps.includes("configForms")) scope.configForms = { get: () => settings };
			if (deps.includes("remote")) {
				scope.remote = {
					session: {
						modelCatalog: () => (options.catalogFails === true ? Promise.reject(new Error("offline")) : Promise.resolve({ groups: options.catalog ?? [] }))
					}
				};
			}
			callback(scope);
		},
		slots: {
			inject(slot, callback) {
				log.push(["slots.inject", slot]);
				callback();
			},
			register(registration, component) {
				log.push(["slots.register", registration.name, registration.id ?? registration.key, registration.order, registration.locale]);
				registered.push({ options: registration, component });
				return () => {};
			}
		}
	};
	vm.runInThisContext(LOADED, { filename: BUNDLE });
	// The preset-table chunk is a package-local dynamic chunk, so the bundle asks
	// for it through `require.async`. Both an absent loader and a failing load are
	// real deployments, and both have to degrade to typing the rates by hand.
	const chunkRequire = (specifier) => bundleRequire(specifier);
	if (options.noChunkLoader !== true) {
		chunkRequire.async = () => (options.ratesFails === true
			? Promise.reject(new Error("no chunk"))
			: Promise.resolve({ routes: options.rates ?? null }));
	}
	const exports_ = registration.factory(chunkRequire);
	exports_.apply(ctx);
	const captured = registered.find((entry) => entry.options.name === "conversation.composer.dock");
	return { exports_, log, registered, captured, writes, settingsState };
}

// ── registration contract ────────────────────────────────────────────────────
const applied = applyToFakeContext();
check("registration id", registration.id, "dsh-session-cost");
check("exports.apply is a function", typeof applied.exports_.apply, "function");
check("exports.inject", JSON.stringify(applied.exports_.inject), JSON.stringify(["slots", "locale"]));
check("style tag injected once", styleTags.length, 1);
check("slot targeted", JSON.stringify(applied.log.find((row) => row[0] === "slots.inject")), JSON.stringify(["slots.inject", "conversation.composer.dock"]));
check("registration tuple", JSON.stringify(applied.log.find((row) => row[0] === "slots.register")), JSON.stringify(["slots.register", "conversation.composer.dock", "session-cost", 20, "session-cost"]));

const dictionaries = applied.log.find((row) => row[0] === "locale")[2];
check("dictionary namespace", applied.log.find((row) => row[0] === "locale")[1], "session-cost");
check("zh/en dictionary key sets match", JSON.stringify(Object.keys(dictionaries.zh).sort()), JSON.stringify(Object.keys(dictionaries.en).sort()));

// ── component driving ────────────────────────────────────────────────────────
/** Translate with `{name}` interpolation, the way the locale service does. */
function makeT(dictionary) {
	return (key, params) => {
		const text = dictionary[key];
		if (text === undefined) return key;
		return params === undefined ? text : text.replace(/\{(\w+)\}/g, (_match, name) => String(params[name]));
	};
}
const t = makeT(dictionaries.zh);

/** One wire price. */
function price(currency, label, rates, source = "preset") {
	return { currency, label, rates, source };
}
/** One wire group, with the price optional exactly as the Host emits it. */
function group(provider, model, peak, buckets, wirePrice) {
	return { provider, model, peak, attempts: 0, ...buckets, ...(wirePrice === undefined ? {} : { price: wirePrice }) };
}
const RATES_YUAN = { miss: 2, hit: 0.04, write: 2, out: 8 };
const RATES_USD = { miss: 1, hit: 0.1, write: 1, out: 2 };
const NO_UNATTRIBUTED = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 0 };

/** Render the real component once. */
function render(projected) {
	return applied.captured.component({
		useProjection: (key) => (key === "sessionCost" ? projected : undefined),
		t
	});
}
function openRender(projected) {
	harnessOpen = true;
	const tree = render(projected);
	harnessOpen = false;
	return tree;
}

/** The pill's rendered amount text. */
function labelOf(tree) {
	const button = tree.props.children[0].props.children;
	return button.props.children[1].props.children;
}
/** Flatten nested child arrays the way React does, dropping absent children. */
function flatten(children) {
	const out = [];
	for (const child of children) {
		if (Array.isArray(child)) out.push(...flatten(child));
		else if (child !== null && child !== undefined && child !== false) out.push(child);
	}
	return out;
}
/** Render nested function components the way React would, so panels are reachable. */
function resolve(node) {
	let current = node;
	let guard = 0;
	while (current !== null && typeof current === "object" && typeof current.type === "function" && guard < 10) {
		current = current.type(current.props);
		guard += 1;
	}
	return current;
}
/** The open panel's children. */
function panelChildren(tree) {
	return flatten(resolve(tree.props.children[1]).props.children);
}
/** The rendered segment sections. */
function sectionsOf(tree) {
	return flatten(panelChildren(tree).find((child) => child.props.className === "dshCost_sections").props.children);
}
/** Segment labels, in render order. */
function segmentLabels(tree) {
	return sectionsOf(tree).map((section) => section.props["data-session-cost-segment"]);
}
/** One segment's meta line. */
function segmentMeta(tree, label) {
	const section = sectionsOf(tree).find((child) => child.props["data-session-cost-segment"] === label);
	return flatten([section.props.children[0].props.children[1].props.children]).join("");
}
/** One segment's rendered cost cells. */
function segmentCosts(tree, label) {
	const section = sectionsOf(tree).find((child) => child.props["data-session-cost-segment"] === label);
	return flatten(section.props.children[1]).map((row) => row.props.children[2].props.children);
}
/** Every note line. */
function notesOf(tree) {
	return panelChildren(tree).filter((child) => child.props.className === "dshCost_note").map((child) => child.props.children);
}
/** Text of one rendered element tree, flattening nested spans. */
function textOf(node) {
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (node !== null && typeof node === "object") return textOf(node.props.children);
	return node === null || node === undefined ? "" : String(node);
}
/** The rendered totals block, one amount per currency. */
function totalsOf(tree) {
	const total = panelChildren(tree).find((child) => child.props.className === "dshCost_total");
	const amounts = flatten(total.props.children).find((child) => child.props.className === "dshCost_amounts");
	return flatten(amounts.props.children).map(textOf);
}
/** The total block's leading label. */
function totalLabelOf(tree) {
	const total = panelChildren(tree).find((child) => child.props.className === "dshCost_total");
	return textOf(flatten(total.props.children)[0]);
}

// ── per-segment arithmetic ───────────────────────────────────────────────────
// flash peak: 1e6×2 + 10e6×0.04 + 0.5e6×8 = 2 + 0.4 + 4 = 6.4
// pro off-peak: 1e5×4.5 + 2e4×13.5 = 0.45 + 0.27 = 0.72
// total = 7.12
const TWO_SEGMENTS = {
	groups: {
		a: group("deepseek-official", "deepseek-flash", true, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 10_000_000, cacheWriteTokens: 0, outputTokens: 500_000, attempts: 2
		}, price("¥", "DeepSeek-V4.1-Flash", RATES_YUAN)),
		b: group("deepseek-official", "deepseek-v4-pro", false, {
			uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20_000, attempts: 1
		}, price("¥", "DeepSeek-V4-Pro-0813", { miss: 4.5, hit: 0.15, write: 4.5, out: 13.5 }))
	},
	unattributed: NO_UNATTRIBUTED
};
check("the pill totals the segments", labelOf(render(TWO_SEGMENTS)), "¥7.12");
const open = openRender(TWO_SEGMENTS);
checkJson("one segment per group", segmentLabels(open), ["DeepSeek-V4.1-Flash", "DeepSeek-V4-Pro-0813"]);
checkJson("flash priced at its own rates", segmentCosts(open, "DeepSeek-V4.1-Flash"), ["¥2.00", "¥0.400", "¥4.00"]);
checkJson("pro priced at its own rates", segmentCosts(open, "DeepSeek-V4-Pro-0813"), ["¥0.450", "¥0.270"]);
check("a group already narrowed to peak is labelled peak", segmentMeta(open, "DeepSeek-V4.1-Flash"), "高峰时段 · 预设价 · 2 次请求");
check("a group already narrowed to off-peak is labelled off-peak", segmentMeta(open, "DeepSeek-V4-Pro-0813"), "空闲时段 · 预设价 · 1 次请求");
checkJson("totals follow the currencies present", totalsOf(open), ["¥7.12"]);
check("the total block is labelled a total", totalLabelOf(open), "合计");
checkJson("a preset-only disclosure notes where presets come from", notesOf(open), ["预设价来自 harness 内置模型目录，可在【插件】页本插件的配置区覆盖。"]);

// An override is disclosed as custom, and the label comes from the wire.
const OVERRIDDEN = {
	groups: {
		a: group("my-gateway", "qwen3-32b", false, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 1
		}, price("$", "My Qwen", { miss: 0.2, hit: 0.02, write: 0.2, out: 0.4 }, "override"))
	},
	unattributed: NO_UNATTRIBUTED
};
check("an override is priced from the wire", labelOf(render(OVERRIDDEN)), "$0.200");
check("an override is disclosed as custom", segmentMeta(openRender(OVERRIDDEN), "My Qwen"), "空闲时段 · 自定义价 · 1 次请求");

// A price with no label falls back to the route.
const UNLABELLED = {
	groups: {
		a: group("my-gateway", "qwen3-32b", false, { uncachedInputTokens: 1_000_000 }, price("$", "", RATES_USD, "override"))
	},
	unattributed: NO_UNATTRIBUTED
};
checkJson("an unlabelled price falls back to provider/model", segmentLabels(openRender(UNLABELLED)), ["my-gateway/qwen3-32b"]);

// ── mixed currencies are never converted ─────────────────────────────────────
const MIXED = {
	groups: {
		a: TWO_SEGMENTS.groups.a,
		b: TWO_SEGMENTS.groups.b,
		c: group("openai", "gpt-5.6-terra", false, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 1
		}, price("$", "GPT-5.6 Terra", RATES_USD))
	},
	unattributed: NO_UNATTRIBUTED
};
check("mixed currencies are listed, never converted", labelOf(render(MIXED)), "¥7.12 + $1.00");
checkJson("each currency gets its own total", totalsOf(openRender(MIXED)), ["¥7.12", "$1.00"]);

// ── disclosed incompleteness ─────────────────────────────────────────────────
const WITH_UNATTRIBUTED = {
	groups: TWO_SEGMENTS.groups,
	unattributed: { uncachedInputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 3 }
};
check("unattributed attempts mark the amount a lower bound", labelOf(render(WITH_UNATTRIBUTED)), "≈¥7.12");
checkJson("unattributed is disclosed with its request count", notesOf(openRender(WITH_UNATTRIBUTED))[0], "另有 3 次请求未记录模型，未计入。");
checkJson("a lower-bound total says so", totalsOf(openRender(WITH_UNATTRIBUTED)), ["¥7.12"]);
check("a lower-bound total is labelled so", totalLabelOf(openRender(WITH_UNATTRIBUTED)), "合计（下限）");

const WITH_UNPRICED = {
	groups: {
		...TWO_SEGMENTS.groups,
		c: group("some-provider", "mystery-model", true, { uncachedInputTokens: 1_000, attempts: 1 })
	},
	unattributed: NO_UNATTRIBUTED
};
check("an unpriced group marks the amount a lower bound", labelOf(render(WITH_UNPRICED)), "≈¥7.12");
check("an unpriced group is not a segment", segmentLabels(openRender(WITH_UNPRICED)).length, 2);
checkJson("the unpriced route is named", notesOf(openRender(WITH_UNPRICED))[0], "some-provider/mystery-model 未定价，未计入。");

// ── the inline icon is bounded in every context it mounts in ────────────────
// An SVG carrying only a viewBox sizes to its container: the first version
// constrained it inside the pill alone, so the disclosure panel drew it at the
// panel's full 360px width.
const pillIcon = resolve(render(TWO_SEGMENTS).props.children[0].props.children.props.children[0]);
check("the pill icon carries an intrinsic width", pillIcon.props.width, 14);
check("the pill icon carries an intrinsic height", pillIcon.props.height, 14);
const titleBar = panelChildren(open).find((child) => child.props.className === "dshCost_title");
const panelIcon = resolve(flatten(titleBar.props.children)[0]);
check("the panel icon carries an intrinsic width", panelIcon.props.width, 14);
check("the panel icon carries an intrinsic height", panelIcon.props.height, 14);
check("both mounts share one viewBox", panelIcon.props.viewBox, pillIcon.props.viewBox);

const sheet = styleTags[0].textContent;
check("the class sheet bounds a pill icon", /\.dshCost_pill svg[^{]*\{[^}]*width:14px/.test(sheet), true);
check("the class sheet bounds a panel icon", /\.dshCost_panel svg[^{]*\{[^}]*width:14px/.test(sheet), true);

// ── the mark matches the weight of the icons it sits among ──────────────────
// The dock's line icons read at about one unit in a 16-unit box, which is also
// what the one stroked glyph the platform ships uses. The first version drew a
// 1.5 ring around a 1.2 ¥: a heavy circle with a spindly glyph inside, which is
// the mismatch this pins shut.
const marked = flatten([pillIcon.props.children]);
check("the icon is a line drawing, not a filled mark", pillIcon.props.fill, "none");
check("the mark has parts", marked.length > 0, true);
checkJson("every part strokes", marked.filter((child) => child.props.stroke !== "currentColor").length, 0);
const weights = [...new Set(marked.map((child) => child.props.strokeWidth))];
check("the mark is drawn at exactly one weight", weights.length, 1);
// Mainstream 16-unit line icons sit between 1 and 1.5; outside that reads either
// faint or heavy beside the dock's own glyphs.
check("the weight is inside the line-icon range", weights[0] >= 1 && weights[0] <= 1.5, true);
check("the ring is the heavier half of the first version gone", weights[0] < 1.5, true);
// Thinning the line must not shrink the mark: the outer edge stays where the
// original 6.2-radius / 1.5-stroke ring already put it.
const ring = marked.find((child) => child.type === "circle");
const outerEdge = Number(ring.props.r) + Number(ring.props.strokeWidth) / 2;
check("the thinner ring keeps the icon's outer edge", Math.abs(outerEdge - 6.95) < 0.1, true);
check("the ring stays inside the 16-unit box", outerEdge <= 8, true);

// ── the settings seats ───────────────────────────────────────────────────────
// The Plugins page renders no automatic schema form: it renders whatever the
// owning plugin claims for these seats, so a plugin with settings must claim
// one or its configuration is invisible.
const seats = applied.registered.filter((entry) => entry.options.name !== "conversation.composer.dock");
check("the bundle-config seat is claimed under the package name", seats.some((entry) => entry.options.name === "plugins.bundle.config" && entry.options.key === "dsh-session-cost"), true);
check("the row-config seat is claimed under package#row", seats.some((entry) => entry.options.name === "plugins.row.config" && entry.options.key === "dsh-session-cost#session-cost"), true);
check("the settings seats ask for the shared config form", applied.log.some((row) => row[0] === "ctx.inject" && row[1] === "configForms"), true);
check("the settings seats are localized", seats.every((entry) => entry.options.locale === "session-cost"), true);

// ── the settings page ────────────────────────────────────────────────────────
const CONFIGURED = {
	enabled: true,
	period: "auto",
	currency: "¥",
	prices: {
		"my-gateway/qwen3-32b": {
			currency: "$",
			label: "My Qwen",
			miss: 0.2,
			hit: 0.02,
			write: 0.2,
			out: 0.4,
			peak: { miss: 0, hit: 0, write: 0, out: 0 }
		}
	}
};
/** Apply once and hand back the settings seat, its boundary, and the form it wraps. */
function settingsHarness(options) {
	const harness = applyToFakeContext(options);
	const seat = harness.registered.find((entry) => entry.options.name === "plugins.bundle.config");
	const face = seat.options.inject();
	// The seat renders the form under its own error boundary: the seat element's
	// child is the form element the interaction tests mount directly.
	const boundaryElement = seat.component({ view: "page", ...face, t });
	return { harness, seat, boundary: boundaryElement.type, component: boundaryElement.props.children.type, face };
}
/** Let the component's queued writes settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const configured = settingsHarness({ settingsValue: CONFIGURED });
const pageProps = { settings: configured.face.settings, t };

const summaryTree = mount(configured.component, { ...pageProps, view: "summary" }).draw();
check("the summary view counts the overrides", textOf(summaryTree), "价格覆盖：1 项");

// The seat is wrapped in its own error boundary: a crash in the form must not
// let the slot renderer retire the entry, which would make the configuration
// silently unreachable until a reload.
check("the seat wraps the form in an error boundary", typeof configured.boundary?.getDerivedStateFromError, "function");
const crashed = new configured.boundary({ children: null });
crashed.state = configured.boundary.getDerivedStateFromError(new Error("boom"));
check("a boundary crash renders the cause rather than nothing", textOf(crashed.render()), "boom");
const healthy = new configured.boundary({ children: "CHILD" });
check("the boundary passes children through while healthy", healthy.render(), "CHILD");

const pageTree = mount(configured.component, { ...pageProps, view: "page" }).draw();
checkJson("one card per override", elements(pageTree).filter((node) => node.props["data-session-cost-override"] !== undefined).map((node) => node.props["data-session-cost-override"]), ["my-gateway/qwen3-32b"]);
check("the editor offers a save control", elements(pageTree).some((node) => node.props.className === "dshCost_button dshCost_primary"), true);
check("the editor shows the enable switch", elements(pageTree).some((node) => node.type === "input" && node.props.type === "checkbox"), true);
check("the editor shows the window selector", elements(pageTree).some((node) => node.type === "select"), true);
// Text has to come from the dictionary: the real `t` falls back to the key
// itself, so a missing entry shows on screen as a raw `settings.*` label.
// That is exactly how a missing peak-column key shipped once.
const strings = elements(pageTree).map((node) => node.props.children).filter((child) => typeof child === "string");
checkJson("no label renders as a raw dictionary key", strings.filter((text) => /^(settings|dialog)\./.test(text)), []);
check("building the editor writes nothing", configured.harness.writes.length, 0);

// Saving an untouched form must not rewrite the configuration.
const untouched = mount(configured.component, { ...pageProps, view: "page" });
elements(untouched.draw()).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
check("saving an untouched form writes nothing", configured.harness.writes.length, 0);
check("an untouched save reports saved", elements(untouched.draw()).find((node) => node.props.className === "dshCost_status").props.children, "已保存");

// Editing one rate writes only the prices field, and only the edited value.
const edited = settingsHarness({ settingsValue: CONFIGURED });
const editedProps = { settings: edited.face.settings, t };
const mounted = mount(edited.component, { ...editedProps, view: "page" });
let editedTree = mounted.draw();
const card = elements(editedTree).find((node) => node.props["data-session-cost-override"] !== undefined);
const cardInputs = elements(card).filter((node) => node.type === "input");
check("a card exposes the key, currency, label, four rates and four peak rates", cardInputs.length, 11);
cardInputs[3].props.onChange({ target: { value: "1.5" } });
editedTree = mounted.draw();
elements(editedTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
check("editing one rate writes exactly one field", edited.harness.writes.length, 1);
check("the write targets the prices table", edited.harness.writes[0][0], "prices");
check("the edited rate reaches the write", edited.harness.writes[0][1]["my-gateway/qwen3-32b"].miss, 1.5);
check("the untouched rates survive", JSON.stringify([edited.harness.writes[0][1]["my-gateway/qwen3-32b"].hit, edited.harness.writes[0][1]["my-gateway/qwen3-32b"].out]), JSON.stringify([0.02, 0.4]));
check("a blank number box means zero", edited.harness.writes[0][1]["my-gateway/qwen3-32b"].peak.miss, 0);

// Adding a row writes a second entry, and a refused write is reported.
const added = settingsHarness({ settingsValue: CONFIGURED });
const addedMounted = mount(added.component, { ...added.face, t, view: "page" });
let addedTree = addedMounted.draw();
elements(addedTree).find((node) => node.type === "button" && node.props.children === "手动添加空白覆盖").props.onClick();
addedTree = addedMounted.draw();
check("adding a row shows a second card", elements(addedTree).filter((node) => node.props["data-session-cost-override"] !== undefined).length, 2);
elements(addedTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
check("an unnamed added row is not written", added.harness.writes.length, 0);

const refused = settingsHarness({ settingsValue: CONFIGURED, refuseWrites: true });
const refusedMounted = mount(refused.component, { settings: refused.face.settings, t, view: "page" });
const refusedCard = elements(refusedMounted.draw()).find((node) => node.props["data-session-cost-override"] !== undefined);
elements(refusedCard).filter((node) => node.type === "input")[3].props.onChange({ target: { value: "2" } });
const refusedTree = refusedMounted.draw();
elements(refusedTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
check("a refused write reports failure", elements(refusedMounted.draw()).find((node) => node.props.className === "dshCost_status").props.children, "保存失败");

// An empty table, a loading namespace, and an unavailable one each say so.
const emptyHarness = settingsHarness({ settingsValue: { enabled: true, period: "auto", currency: "$", prices: {} } });
check("an empty override table says so", textOf(mount(emptyHarness.component, { settings: emptyHarness.face.settings, t, view: "page" }).draw()).includes("暂无覆盖"), true);
const loadingHarness = settingsHarness({});
check("a loading namespace says so", elements(mount(loadingHarness.component, { settings: loadingHarness.face.settings, t, view: "page" }).draw()).find((node) => node.props.className === "dshCost_settingsHint").props.children, "读取设置…");

// ── the currency control ─────────────────────────────────────────────────────
const currency = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const currencyMount = mount(currency.component, { ...currency.face, t, view: "page" });
let currencyTree = currencyMount.draw();
const currencySelect = elements(currencyTree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "option" && child.props.value === "HK$"));
check("the currency control offers common symbols", currencySelect !== undefined, true);
check("the currency control offers an escape hatch", elements(currencySelect).some((child) => child.type === "option" && child.props.value === "\u0000custom"), true);
check("a preset symbol needs no text box", elements(currencyTree).some((node) => node.props.className === "dshCost_input dshCost_currency"), false);
currencySelect.props.onChange({ target: { value: "HK$" } });
currencyTree = currencyMount.draw();
elements(currencyTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
checkJson("picking a symbol writes it", currency.harness.writes.filter((write) => write[0] === "currency"), [["currency", "HK$"]]);

// A symbol outside the list keeps its own text box, and the select says so.
const custom = settingsHarness({ settingsValue: { ...CONFIGURED, currency: "元" }, catalog: [] });
const customTree = mount(custom.component, { ...custom.face, t, view: "page" }).draw();
check("an unlisted symbol gets a text box", elements(customTree).find((node) => node.props.className === "dshCost_input dshCost_currency")?.props.value, "元");
const customSelect = elements(customTree).find((node) => node.type === "select" && elements(node).some((child) => child.props.value === "\u0000custom"));
check("the select reports the custom choice", customSelect.props.value, "\u0000custom");

// ── importing a configured model ─────────────────────────────────────────────
const CATALOG = [
	{ id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "DeepSeek Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }] },
	{ id: "my-gateway", name: "My Gateway", models: [{ id: "qwen3-32b", name: "Qwen3 32B" }, { id: "llama-4", name: "Llama 4" }] }
];
const importing = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG });
const importingMount = mount(importing.component, { ...importing.face, t, view: "page" });
importingMount.draw();
await flush();
let importingTree = importingMount.draw();
const picker = elements(importingTree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
checkJson("the picker groups routes by provider", elements(picker).filter((node) => node.type === "optgroup").map((node) => node.props.label), ["DeepSeek · deepseek", "My Gateway · my-gateway"]);
const routeOptions = elements(picker).filter((node) => node.type === "option" && node.props.value !== "");
checkJson("the picker offers every provider/model route", routeOptions.map((node) => node.props.value), ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro", "my-gateway/qwen3-32b", "my-gateway/llama-4"]);
const overridden = routeOptions.find((node) => node.props.value === "my-gateway/qwen3-32b");
check("a route already overridden is retired in the picker", overridden.props.disabled, true);
check("...and labelled as such", textOf(overridden).includes("已添加"), true);

picker.props.onChange({ target: { value: "my-gateway/llama-4" } });
importingTree = importingMount.draw();
elements(importingTree).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
importingTree = importingMount.draw();
const importedCards = elements(importingTree).filter((node) => node.props["data-session-cost-override"] !== undefined);
checkJson("importing adds the picked route as a row", importedCards.map((node) => node.props["data-session-cost-override"]), ["my-gateway/qwen3-32b", "my-gateway/llama-4"]);
check("the display name arrives with the route", elements(importedCards[1]).filter((node) => node.type === "input")[2].props.value, "Llama 4");
elements(importingTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
check("saving writes both rows", Object.keys(importing.harness.writes[0][1]).length, 2);

// A catalog that cannot be read must leave manual entry working.
const offline = settingsHarness({ settingsValue: CONFIGURED, catalogFails: true });
const offlineMount = mount(offline.component, { ...offline.face, t, view: "page" });
offlineMount.draw();
await flush();
const offlineTree = offlineMount.draw();
check("a failed catalog says so", textOf(offlineTree).includes("读不到模型目录"), true);
check("manual entry survives a failed catalog", elements(offlineTree).some((node) => node.type === "button" && node.props.children === "手动添加空白覆盖"), true);

// ── pre-filling an imported row from the Host's preset table ─────────────────
// The table arrives as a package-local chunk the Host half generates, so these
// cases drive the chunk's three shapes: present, failing, and absent.
const RATES = { "my-gateway/llama-4": ["$", 1, 0.1, 1.25, 5, 0, 0, 0, 0] };
const prefilling = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, rates: RATES });
const prefillMount = mount(prefilling.component, { ...prefilling.face, t, view: "page" });
prefillMount.draw();
await flush();
let prefillTree = prefillMount.draw();
const disclosure = elements(prefillTree).find((node) => node.props["data-session-cost-prefill"] !== undefined);
check("the page discloses the pre-fill", disclosure?.props["data-session-cost-prefill"], "ready");
check("...and how many routes it covers", textOf(disclosure).includes("1 条已定价"), true);
const prefillPicker = elements(prefillTree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
prefillPicker.props.onChange({ target: { value: "my-gateway/llama-4" } });
prefillTree = prefillMount.draw();
elements(prefillTree).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
prefillTree = prefillMount.draw();
const prefillCard = elements(prefillTree).filter((node) => node.props["data-session-cost-override"] !== undefined)[1];
checkJson("the preset rates arrive with the route, zeros left blank", elements(prefillCard).filter((node) => node.type === "input").map((node) => node.props.value), ["my-gateway/llama-4", "$", "Llama 4", "1", "0.1", "1.25", "5", "", "", "", ""]);
elements(prefillTree).find((node) => node.props.className === "dshCost_button dshCost_primary").props.onClick();
await flush();
checkJson("a pre-filled row writes the preset", prefilling.harness.writes[0][1]["my-gateway/llama-4"], { currency: "$", label: "Llama 4", miss: 1, hit: 0.1, write: 1.25, out: 5, peak: { miss: 0, hit: 0, write: 0, out: 0 } });

/** Import one route and report the row it produced, for the degradation cases. */
async function importInto(harness) {
	const mounted = mount(harness.component, { ...harness.face, t, view: "page" });
	mounted.draw();
	await flush();
	let tree = mounted.draw();
	const picker = elements(tree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
	picker.props.onChange({ target: { value: "my-gateway/llama-4" } });
	tree = mounted.draw();
	elements(tree).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
	tree = mounted.draw();
	return tree;
}

const failing = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, ratesFails: true });
const failingTree = await importInto(failing);
const failingCard = elements(failingTree).filter((node) => node.props["data-session-cost-override"] !== undefined)[1];
check("a failing chunk still imports the route", failingCard?.props["data-session-cost-override"], "my-gateway/llama-4");
checkJson("...without inventing rates", elements(failingCard).filter((node) => node.type === "input").map((node) => node.props.value), ["my-gateway/llama-4", "", "Llama 4", "", "", "", "", "", "", "", ""]);
check("...and says presets are unavailable", textOf(elements(failingTree).find((node) => node.props["data-session-cost-prefill"] !== undefined)).includes("预设价不可用"), true);

const chunkless = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, noChunkLoader: true });
const chunklessTree = await importInto(chunkless);
check("a deployment without the chunk loader still imports", elements(chunklessTree).filter((node) => node.props["data-session-cost-override"] !== undefined).length, 2);
check("...and reports no pre-fill", elements(chunklessTree).find((node) => node.props["data-session-cost-prefill"] !== undefined)?.props["data-session-cost-prefill"], "unavailable");

// ── hidden cases ─────────────────────────────────────────────────────────────
check("no projection renders nothing", render(undefined), null);
check("a null projection renders nothing", render(null), null);
check("a projection without groups renders nothing", render({ groups: {}, unattributed: NO_UNATTRIBUTED }), null);
check("a group with no price and no tokens renders nothing", render({
	groups: { a: group("p", "m", true, {}, undefined) },
	unattributed: NO_UNATTRIBUTED
}), null);
check("a priced but empty group renders nothing", render({
	groups: { a: group("p", "m", true, {}, price("$", "M", RATES_USD)) },
	unattributed: NO_UNATTRIBUTED
}), null);
check("a group whose price lacks rates renders nothing", render({
	groups: { a: group("p", "m", true, { uncachedInputTokens: 5 }, { currency: "$", label: "M", source: "preset" }) },
	unattributed: NO_UNATTRIBUTED
}), null);
check("a closed pill renders no panel", render(TWO_SEGMENTS).props.children[1], null);

// A malformed price must never become a wrong number.
const ZERO_RATES = {
	groups: { a: group("p", "m", true, { uncachedInputTokens: 1_000_000 }, price("$", "M", { miss: 0, hit: 0, write: 0, out: 0 })) },
	unattributed: NO_UNATTRIBUTED
};
check("all-zero rates yield a zero amount", labelOf(render(ZERO_RATES)), "$0");
check("a zero amount is not marked a lower bound", labelOf(render(ZERO_RATES)).startsWith("≈"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
