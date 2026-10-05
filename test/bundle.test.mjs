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
/**
 * Stand-in for the shell's UI primitives. The tray is expected to place, fit and
 * dismiss itself through these rather than re-deriving the rules, so the stub
 * records what it was asked for and the suite asserts on that.
 */
const primitives = {
	placed: [],
	heightCaps: [],
	heightSignals: [],
	dismissals: 0,
	/** Model a panel that has not been placed yet, i.e. still at the measure spot. */
	unplaced: false,
	useAnchoredPosition(options) {
		primitives.placed.push(options);
		if (primitives.unplaced) return null;
		return options.open === true ? { left: 40, top: 100 } : null;
	},
	useAnchoredMaxHeight(ref, cap, signal) {
		primitives.heightCaps.push(cap);
		primitives.heightSignals.push(signal);
		// The real hook measures the panel's *placed* bottom edge and re-measures
		// when its signal changes. An unplaced panel sits at the hidden measure
		// position, where that measurement collapses the tray to nothing — the bug
		// these checks exist for, so the stub reproduces the contract rather than
		// handing back the cap unconditionally.
		return signal !== null && typeof signal === "object" && typeof signal.top === "number" ? cap : 0;
	},
	useDismissOnOutsidePointer() {
		primitives.dismissals += 1;
	},
	// The shell's settings components, as host elements the suite can drive. The
	// real ones cannot load here — they import the Host tree's React, which a bare
	// Node run has no copy of — so the probe covers real React and this covers this
	// bundle's own wiring and structure.
	Switch({ checked, onChange, label, disabled }) {
		return react.createElement("button", {
			type: "button",
			"data-session-cost-switch": String(checked),
			"aria-label": label,
			disabled,
			onClick: () => onChange(!checked)
		}, label);
	},
	Button({ variant, children, ...rest }) {
		return react.createElement("button", {
			type: "button",
			"data-variant": variant,
			...rest
		}, children);
	},
	DisclosureRow({ title, open, onToggle, collapsedContent, children }) {
		return react.createElement("div", {
			"data-session-cost-fold": String(open)
		}, [react.createElement("button", {
			key: "row",
			type: "button",
			onClick: onToggle
		}, title), open ? children : collapsedContent]);
	},
	IconChevronDownOutlineRegular(props) {
		return react.createElement("svg", props);
	}
};
function bundleRequire(specifier) {
	if (specifier === "react") return react;
	if (specifier === "react-dom") return { createPortal: (node) => node };
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
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
		if (this.refuseWrites) return Promise.resolve(false);
		return Promise.resolve(this.fold(field, value));
	}
	unset(field) {
		this.writes.push([field, null]);
		if (this.refuseWrites) return Promise.resolve(false);
		const section = { ...(this.store.snapshot.value ?? {}) };
		delete section[field];
		this.publish(section);
		return Promise.resolve(true);
	}
	/**
	 * Fold an accepted write back into the mirror, the way the real
	 * ConfigFormController does: the section the form reads next already contains
	 * the write, which is what keeps the following edit's diff down to its own
	 * field instead of restating everything the draft still disagrees with.
	 */
	fold(field, value) {
		this.publish({ ...(this.store.snapshot.value ?? {}), [field]: value });
		return true;
	}
	publish(value) {
		this.store.snapshot = {
			...this.store.snapshot,
			status: "ready",
			value,
			user: { ...(this.store.snapshot.user ?? {}), ...value },
			revision: (this.store.snapshot.revision ?? 0) + 1
		};
		for (const listener of [...this.listeners]) listener();
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
/**
 * Unfold one advanced section, or one route inside it, by the title it shows.
 *
 * The page opens as settings: the rate table and the override list are folded so
 * the first screen is the four choices most sessions ever need.
 */
function unfold(mounted, title) {
	const tree = mounted.draw();
	const row = elements(tree).find((node) => typeof node?.props?.onToggle === "function" && node.props.title === title);
	if (row === undefined) throw new Error(`no folded row titled ${title}`);
	// A row that is already open stays open: this asserts a state, it does not
	// flip one, so a case can call it more than once without folding the page up.
	if (row.props.open === true) return tree;
	row.props.onToggle();
	return mounted.draw();
}
/** One override's field, by the route the row shows. */
function routeControl(tree, route, field) {
	const row = elements(tree).find((node) => node.props["data-session-cost-override"] === route);
	const control = elements(row).find((node) => node.props["data-session-cost-field"] === field);
	if (control === undefined) throw new Error(`no ${field} control in ${route}`);
	return control;
}
/** Unfold the override list and then one route inside it. */
function openOverride(mounted, route) {
	unfold(mounted, "价格覆盖");
	return unfold(mounted, route);
}
/** The page's own status line. */
function statusOf(tree) {
	return elements(tree).find((node) => node.props.className === "dshCost_status").props.children;
}
/** Every override row on screen, by route. */
function routesOf(tree) {
	return elements(tree).filter((node) => node.props["data-session-cost-override"] !== undefined).map((node) => node.props["data-session-cost-override"]);
}
/** Unfold the override list, which every override case needs open. */
function pageOf(mounted) {
	return unfold(mounted, "价格覆盖");
}

/** The converted summary figure the title carries, as rendered. */
function titleValueOf(tree) {
	const title = panelChildren(tree).find((child) => child.props.className === "dshCost_title");
	const value = flatten([title.props.children]).find((child) => child.props.className === "dshCost_titleValue");
	return value === undefined ? undefined : textOf(value);
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
// The tray carries no standing copy: a fully priced session has nothing to
// disclose, and the panel is short enough that every line has to earn its place.
checkJson("a fully priced disclosure carries no note", notesOf(open), []);
checkJson("the tray opens straight from the title rule", panelChildren(open).map((child) => child.props.className).slice(0, 3), ["dshCost_title", "dshCost_rule", "dshCost_sections"]);

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
check("the pill icon is sized against the icons beside it", pillIcon.props.width, 14);
check("the pill icon is square", pillIcon.props.height, 14);
const titleBar = panelChildren(open).find((child) => child.props.className === "dshCost_title");
// A single-child element carries the child directly, not wrapped in an array.
const titleLabel = resolve(Array.isArray(titleBar.props.children) ? titleBar.props.children[0] : titleBar.props.children);
const panelIcon = resolve(flatten(titleLabel.props.children)[0]);
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
// Thinning the line made the mark read smaller at the same diameter, so the ring
// grew to buy that back. Measured off a screenshot, the dock's circle-check icon
// spans ~13.1 of these units; the heavy first version spanned 13.9, and this one
// spans 15 — the largest it can be with a clear margin inside the box.
const ring = marked.find((child) => child.type === "circle");
const outerEdge = Number(ring.props.r) + Number(ring.props.strokeWidth) / 2;
check("the thinner ring is not smaller than the heavy one was", outerEdge > 6.95, true);
check("the mark spans at most 15 of the 16 units", Number(ring.props.r) * 2 + Number(ring.props.strokeWidth) <= 15, true);
check("leaving a margin inside the box", outerEdge < 8, true);
// The ¥ is sized for legibility, not proportion: at 16 units across, the first
// glyph spanned 4 units and read as a speck inside the ring.
const glyph = marked.find((child) => child.type === "path");
const glyphSpan = 2 * (11 - 8);
const innerDiameter = 2 * (Number(ring.props.r) - Number(ring.props.strokeWidth));
check("the glyph is big enough to read", glyphSpan >= 6, true);
check("...but stays clear of the ring", glyphSpan < innerDiameter - 2, true);
check("the ring's span is the largest that keeps a margin", Number(ring.props.r) * 2 + Number(ring.props.strokeWidth), 15);

// ── the tray is the shell's tray, not a lookalike ───────────────────────────
// The dock's other pills place and dismiss their trays through the shared
// primitives; the surface has to be the same menu material for the panels to
// read as one family.
check("the tray asks the shell to place it", primitives.placed.length > 0, true);
const placement = primitives.placed[primitives.placed.length - 1];
check("...anchored above the trigger", placement.side, "top");
check("...with the shell's gap", placement.gap, 8);
check("...and the shell's viewport margin", placement.margin, 12);
check("the tray asks the shell to dismiss it", primitives.dismissals > 0, true);
check("the tray's height cap comes from the shell's fit", primitives.heightCaps[0], 560);
const panel = resolve(open.props.children[1]);
check("the panel is the shell's menu material", panel.props.className, "dshCost_panel");
check("...applied through the shell's measure-then-place style", panel.props.style.maxHeight, 560);
check("...and scrolls inside the fitted height", panel.props.style.overflowY, "auto");
// Regression: the fit is measured from the panel's placed bottom edge, so it has
// to be re-read once the placement exists. Passing the projected view instead
// left the tray clamped to the measurement of its own unplaced frame, which is
// why the total only appeared after a re-render or a scroll.
check("the fit re-measures on placement", typeof primitives.heightSignals[primitives.heightSignals.length - 1]?.top, "number");
primitives.unplaced = true;
const measuringPanel = resolve(openRender(TWO_SEGMENTS).props.children[1]);
check("an unplaced tray is not clamped", measuringPanel.props.style.maxHeight, undefined);
check("...so the measure pass sees the natural size", measuringPanel.props.style.visibility, "hidden");
primitives.unplaced = false;
check("the title uses the shell's inline label wrapper", titleLabel.props.className, "dshCost_titleLabel");
check("the tray surface takes the shell's menu background", /\.dshCost_panel\{[^}]*background:var\(--dsw-specific-menu\)/.test(sheet), true);
check("...the shell's elevation", /\.dshCost_panel\{[^}]*box-shadow:var\(--dsw-elevation-prominent\)/.test(sheet), true);
check("...the shell's backdrop filter", /\.dshCost_panel\{[^}]*backdrop-filter:var\(--dsw-menu-backdrop-filter\)/.test(sheet), true);
check("...the shell's radius and no border", /\.dshCost_panel\{[^}]*border:0;[^}]*border-radius:var\(--dsw-radius-lg\)/.test(sheet), true);
check("...the shell's 16px padding", /\.dshCost_panel\{[^}]*padding:16px/.test(sheet), true);
check("...the shell's width band", /\.dshCost_panel\{[^}]*max-width:min\(440px/.test(sheet), true);
check("the title rule is the shell's hairline", /\.dshCost_rule\{[^}]*border-top:\.5px solid var\(--dsw-alias-border-l2\)/.test(sheet), true);

// ── the converted summary figure ─────────────────────────────────────────────
// Only the policy rides the wire — target currency plus the rates the user
// entered — and the multiplication happens here, where the totals already are.
const TWO_CURRENCIES = {
	groups: {
		yuan: group("deepseek-official", "deepseek-flash", false, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 1
		}, price("¥", "Flash", { miss: 1, hit: 0, write: 0, out: 0 })),
		dollar: group("anthropic", "claude-fable-5", false, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 1
		}, price("$", "Claude", { miss: 1, hit: 0, write: 0, out: 0 }))
	},
	unattributed: NO_UNATTRIBUTED,
	conversion: { currency: "$", rates: { "¥": 0.15 }, sources: { "¥": "manual" }, asOf: null }
};
const mixed = openRender(TWO_CURRENCIES);
check("the title carries the converted total", titleValueOf(mixed), "≈$1.15");
checkJson("the totals still list every currency as billed", totalsOf(mixed), ["¥1.00", "$1.00"]);
const titleTip = (tree) => flatten([panelChildren(tree).find((child) => child.props.className === "dshCost_title").props.children]).find((child) => child.props.className === "dshCost_titleValue").props.title;
check("the converted figure is marked as a conversion", titleTip(mixed), "按你输入的汇率折算");
// ...and says which rates, because a converted figure is never a vendor price.
const REFERENCED = { ...TWO_CURRENCIES, conversion: { currency: "$", rates: { "¥": 0.15 }, sources: { "¥": "reference" }, asOf: "2026-10-02" } };
check("a reference rate is named with its date", titleTip(openRender(REFERENCED)), "按参考汇率（ECB 2026-10-02）折算");
const SNAPSHOT_FX = { ...TWO_CURRENCIES, conversion: { currency: "$", rates: { "¥": 0.15 }, sources: { "¥": "snapshot" }, asOf: "2026-10-02" } };
check("a snapshot is named as built-in", titleTip(openRender(SNAPSHOT_FX)), "按内置参考汇率（2026-10-02）折算");
// A session that used one currency the user rated by hand and one it did not.
const BOTH_FX = {
	groups: {
		yuan: TWO_CURRENCIES.groups.yuan,
		euro: group("acme", "eu-model", false, {
			uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, attempts: 1
		}, price("€", "EU Model", { miss: 1, hit: 0, write: 0, out: 0 }))
	},
	unattributed: NO_UNATTRIBUTED,
	conversion: { currency: "$", rates: { "¥": 0.15, "€": 1.1 }, sources: { "¥": "manual", "€": "reference" }, asOf: "2026-10-02" }
};
check("a mixed table names both", titleTip(openRender(BOTH_FX)), "按参考汇率（ECB 2026-10-02）与你输入的汇率折算");
check("no conversion configured leaves today's tray untouched", titleValueOf(open), undefined);
// The display currency rates itself, so one currency alone still converts.
const SINGLE = { ...TWO_CURRENCIES, groups: { yuan: TWO_CURRENCIES.groups.yuan } };
check("a single foreign currency still converts", titleValueOf(openRender(SINGLE)), "≈$0.150");
// A currency the table does not rate withholds the figure rather than guessing.
const UNRATED = { ...TWO_CURRENCIES, conversion: { currency: "$", rates: {} } };
check("an unrated currency withholds the figure", titleValueOf(openRender(UNRATED)), undefined);
checkJson("...while the totals stay complete", totalsOf(openRender(UNRATED)), ["¥1.00", "$1.00"]);
checkJson("...and the tray names the rate it needs", notesOf(openRender(UNRATED)), ["汇率表缺少 ¥ 的汇率，未显示折算合计。"]);
checkJson("a computable figure needs no note", notesOf(mixed), []);
const ZERO_RATE = { ...TWO_CURRENCIES, conversion: { currency: "$", rates: { "¥": 0 } } };
check("a zero rate is not a rate", titleValueOf(openRender(ZERO_RATE)), undefined);
// An incomplete session makes the converted figure a lower bound too.
const MIXED_INCOMPLETE = { ...TWO_CURRENCIES, unattributed: { ...NO_UNATTRIBUTED, attempts: 2 } };
check("an incomplete session marks the figure a lower bound", titleTip(openRender(MIXED_INCOMPLETE)), "按你输入的汇率折算，且为下限");

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
	officialRates: "auto",
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
// The page opens as settings, not as a table: the two advanced sections are
// folded, and what is left is the four choices a session usually needs.
checkJson("the advanced sections start folded", elements(pageTree).filter((node) => node.props["data-session-cost-fold"] !== undefined).map((node) => node.props["data-session-cost-fold"]), ["false", "false"]);
check("...so no override row is on screen yet", routesOf(pageTree).length, 0);
checkJson("the fields stack in the shell's order", elements(pageTree).filter((node) => node.props.className === "dshCost_field").length, 5);
check("the editor offers no save control", elements(pageTree).some((node) => node.props["data-variant"] === "primary"), false);
const enableSwitch = elements(pageTree).find((node) => node.props["data-session-cost-switch"] !== undefined);
check("the editor shows the enable switch", enableSwitch?.props["data-session-cost-switch"], "true");
// Text has to come from the dictionary: the real `t` falls back to the key
// itself, so a missing entry shows on screen as a raw `settings.*` label.
// That is exactly how a missing peak-column key shipped once.
const strings = elements(pageTree).map((node) => node.props.children).filter((child) => typeof child === "string");
checkJson("no label renders as a raw dictionary key", strings.filter((value) => /^(settings|dialog)\./.test(value)), []);
check("building the editor writes nothing", configured.harness.writes.length, 0);

// The page takes the shell's own settings-form metrics rather than inventing a
// look: stacked fields, a hairline between them, the label at 13/500, the control
// at 34px, the hint under it. Pinned as declared values so a rewrite cannot quietly
// drift back into a wall of boxes.
check("fields use the shell's settings-form padding", /\.dshCost_field\{[^}]*padding:12px 0/.test(sheet), true);
check("...split by the shell's hairline", /\.dshCost_field\+\.dshCost_field\{[^}]*border-top:\.5px solid var\(--dsw-alias-border-l2\)/.test(sheet), true);
check("...labelled at the shell's label metrics", /\.dshCost_fieldLabel\{[^}]*font-size:13px[^}]*font-weight:500/.test(sheet), true);
check("...with the shell's 34px control", /\.dshCost_input\{[^}]*height:34px/.test(sheet), true);
check("...and the shell's hint under it", /\.dshCost_hint\{[^}]*color:var\(--dsw-alias-label-tertiary\)/.test(sheet), true);

// An untouched form writes nothing and says nothing: with no save control there
// is no idle state to explain.
const untouched = mount(configured.component, { ...pageProps, view: "page" });
await flush();
check("an untouched form writes nothing", configured.harness.writes.length, 0);
check("...and reports no status", statusOf(untouched.draw()), "");

// Editing one rate writes only the prices field, and only the edited value.
const edited = settingsHarness({ settingsValue: CONFIGURED });
const mounted = mount(edited.component, { ...edited.face, t, view: "page" });
let editedTree = openOverride(mounted, "my-gateway/qwen3-32b");
checkJson("an override unfolds into its four rates and four peak rates", ["label", "currency", "miss", "hit", "write", "out", "peakMiss", "peakHit", "peakWrite", "peakOut"].map((field) => routeControl(editedTree, "my-gateway/qwen3-32b", field).props.value), ["My Qwen", "$", "0.2", "0.02", "0.2", "0.4", "", "", "", ""]);
routeControl(editedTree, "my-gateway/qwen3-32b", "miss").props.onChange({ target: { value: "1.5" } });
editedTree = mounted.draw();
await flush();
check("editing one rate writes exactly one field", edited.harness.writes.length, 1);
check("the write targets the prices table", edited.harness.writes[0][0], "prices");
check("the edited rate reaches the write", edited.harness.writes[0][1]["my-gateway/qwen3-32b"].miss, 1.5);
check("the untouched rates survive", JSON.stringify([edited.harness.writes[0][1]["my-gateway/qwen3-32b"].hit, edited.harness.writes[0][1]["my-gateway/qwen3-32b"].out]), JSON.stringify([0.02, 0.4]));
check("a blank number box means zero", edited.harness.writes[0][1]["my-gateway/qwen3-32b"].peak.miss, 0);
editedTree = mounted.draw();
check("an accepted edit reports itself saved", statusOf(editedTree), "已保存");

// The Host materializes every schema default into the section it resolves —
// `label: ""`, `currency: ""`, and an all-zero peak window. None of that is an
// edit, and comparing the raw objects would spend a write restating it.
const materialized = settingsHarness({
	settingsValue: {
		...CONFIGURED,
		prices: { "my-gateway/qwen3-32b": { label: "", currency: "", miss: 0.2, hit: 0.02, write: 0.2, out: 0.4, peak: { miss: 0, hit: 0, write: 0, out: 0 } } }
	}
});
const materializedMount = mount(materialized.component, { ...materialized.face, t, view: "page" });
materializedMount.draw();
await flush();
check("the Host's materialized defaults are not an edit", materialized.harness.writes.length, 0);

// Each edit writes what it changed and nothing else.
const sequential = settingsHarness({ settingsValue: CONFIGURED });
const sequentialMount = mount(sequential.component, { ...sequential.face, t, view: "page" });
let sequentialTree = sequentialMount.draw();
elements(sequentialTree).find((node) => node.props["data-session-cost-switch"] !== undefined).props.onClick();
await flush();
checkJson("an edited switch writes only that field", sequential.harness.writes.map((write) => write[0]), ["enabled"]);
sequentialTree = pageOf(sequentialMount);
sequentialTree = unfold(sequentialMount, "my-gateway/qwen3-32b");
routeControl(sequentialTree, "my-gateway/qwen3-32b", "miss").props.onChange({ target: { value: "1.5" } });
await flush();
checkJson("...and the next edit writes only its own", sequential.harness.writes.map((write) => write[0]), ["enabled", "prices"]);
check("re-selecting the same value writes nothing new", (() => {
	const stable = settingsHarness({ settingsValue: CONFIGURED });
	const stableMount = mount(stable.component, { ...stable.face, t, view: "page" });
	const stableTree = stableMount.draw();
	// `offpeak` appears in the rate-window select alone, so it identifies it.
	const select = elements(stableTree).find((node) => node.type === "select" && elements(node).some((child) => child.props.value === "offpeak"));
	select.props.onChange({ target: { value: "auto" } });
	return stable.harness.writes.length;
})(), 0);

// Removing a row is an edit like any other: it has to reach the Host.
const removing = settingsHarness({ settingsValue: CONFIGURED });
const removingMount = mount(removing.component, { ...removing.face, t, view: "page" });
let removingTree = openOverride(removingMount, "my-gateway/qwen3-32b");
elements(removingTree).find((node) => node.type === "button" && node.props.children === "删除这条覆盖").props.onClick();
await flush();
check("removing a row persists the empty table", JSON.stringify(removing.harness.writes), JSON.stringify([["prices", {}]]));

// Adding a row writes a second entry, and a refused write is reported.
const added = settingsHarness({ settingsValue: CONFIGURED });
const addedMounted = mount(added.component, { ...added.face, t, view: "page" });
let addedTree = pageOf(addedMounted);
elements(addedTree).find((node) => node.type === "button" && node.props.children === "添加覆盖").props.onClick();
addedTree = addedMounted.draw();
check("adding a row shows a second row", routesOf(addedTree).length, 2);
// The title is what the row shows, so read it off the row that renders it.
const unnamedRow = elements(addedTree).find((node) => node.props["data-session-cost-override"] === "");
check("...named as an unnamed override", elements(unnamedRow).find((node) => typeof node.props?.title === "string")?.props.title, "未命名覆盖");
await flush();
check("an unnamed added row is not written", added.harness.writes.length, 0);

const refused = settingsHarness({ settingsValue: CONFIGURED, refuseWrites: true });
const refusedMounted = mount(refused.component, { settings: refused.face.settings, t, view: "page" });
let refusedTree = openOverride(refusedMounted, "my-gateway/qwen3-32b");
routeControl(refusedTree, "my-gateway/qwen3-32b", "miss").props.onChange({ target: { value: "2" } });
await flush();
check("a refused write reports failure", statusOf(refusedMounted.draw()), "保存失败");

// An empty table, a loading namespace, and an unavailable one each say so.
const emptyHarness = settingsHarness({ settingsValue: { enabled: true, period: "auto", currency: "$", prices: {} } });
check("an empty override table says so", textOf(pageOf(mount(emptyHarness.component, { settings: emptyHarness.face.settings, t, view: "page" }))).includes("暂无覆盖"), true);
const loadingHarness = settingsHarness({});
const loadingTree = mount(loadingHarness.component, { settings: loadingHarness.face.settings, t, view: "page" }).draw();
check("a loading namespace says so", elements(loadingTree).find((node) => node.props.className === "dshCost_notice").props.children, "读取设置…");

// ── the currency control ─────────────────────────────────────────────────────
const currency = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const currencyMount = mount(currency.component, { ...currency.face, t, view: "page" });
let currencyTree = currencyMount.draw();
const currencySelect = elements(currencyTree).find((node) => node.type === "select" && node.props["aria-label"] === "默认币种符号");
check("the currency control offers common symbols", elements(currencySelect).some((child) => child.type === "option" && child.props.value === "HK$"), true);
check("the currency control offers an escape hatch", elements(currencySelect).some((child) => child.type === "option" && child.props.value === "\u0000custom"), true);
check("a preset symbol needs no text box", elements(currencyTree).some((node) => node.props.className === "dshCost_input dshCost_custom"), false);
currencySelect.props.onChange({ target: { value: "HK$" } });
currencyTree = currencyMount.draw();
await flush();
checkJson("picking a symbol writes it", currency.harness.writes.filter((write) => write[0] === "currency"), [["currency", "HK$"]]);

// A symbol outside the list keeps its own text box, and the select says so.
const custom = settingsHarness({ settingsValue: { ...CONFIGURED, currency: "元" }, catalog: [] });
const customTree = mount(custom.component, { ...custom.face, t, view: "page" }).draw();
check("an unlisted symbol gets a text box", elements(customTree).find((node) => node.props.className === "dshCost_input dshCost_custom")?.props.value, "元");
const customSelect = elements(customTree).find((node) => node.type === "select" && node.props["aria-label"] === "默认币种符号");
check("the select reports the custom choice", customSelect.props.value, "\u0000custom");

// ── the official price list control ──────────────────────────────────────────
const cards = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const cardsMount = mount(cards.component, { ...cards.face, t, view: "page" });
let cardsTree = cardsMount.draw();
const cardsSelect = elements(cardsTree).find((node) => node.type === "select" && node.props["aria-label"] === "DeepSeek 官方价目");
check("the page offers the official price lists", cardsSelect !== undefined, true);
checkJson("...including automatic detection", elements(cardsSelect).filter((child) => child.type === "option").map((child) => child.props.value), ["auto", "cny", "usd"]);
check("the resolved choice is selected", cardsSelect.props.value, "auto");
cardsSelect.props.onChange({ target: { value: "usd" } });
cardsTree = cardsMount.draw();
await flush();
checkJson("picking a list writes it", cards.harness.writes.filter((write) => write[0] === "officialRates"), [["officialRates", "usd"]]);

// Saving an untouched form still writes nothing once the field is resolved.
const settled = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const settledMount = mount(settled.component, { ...settled.face, t, view: "page" });
await flush();
check("a resolved default is not restated on save", settled.harness.writes.length, 0);

// ── the summary currency and its rate table ──────────────────────────────────
const fx = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const fxMount = mount(fx.component, { ...fx.face, t, view: "page" });
let fxTree = fxMount.draw();
const displaySelect = elements(fxTree).find((node) => node.type === "select" && node.props["aria-label"] === "折算显示币种");
check("the page offers a summary currency", displaySelect !== undefined, true);
check("...including no conversion at all", elements(displaySelect).some((child) => child.type === "option" && child.props.value === ""), true);
check("no conversion is the resolved default", displaySelect.props.value, "");
displaySelect.props.onChange({ target: { value: "€" } });
fxTree = fxMount.draw();
await flush();
checkJson("picking a summary currency writes it", fx.harness.writes.filter((write) => write[0] === "displayCurrency"), [["displayCurrency", "€"]]);

// The custom path. `""` is the "no conversion" value, so it cannot double as the
// custom sentinel — it did, and choosing "custom" wrote `""`: the box stayed
// hidden, the select snapped back to "no conversion", and because the value never
// changed not even a write happened. That is a summary currency nobody could set.
const typed = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const typedMount = mount(typed.component, { ...typed.face, t, view: "page" });
let typedTree = typedMount.draw();
const typedSelect = elements(typedTree).find((node) => node.type === "select" && node.props["aria-label"] === "折算显示币种");
check("no custom box until custom is chosen", elements(typedTree).filter((node) => node.props.className === "dshCost_input dshCost_custom").length, 0);
typedSelect.props.onChange({ target: { value: "\u0000custom" } });
typedTree = typedMount.draw();
const typedBox = elements(typedTree).find((node) => node.props.className === "dshCost_input dshCost_custom");
check("choosing custom reveals the box", typedBox !== undefined, true);
check("...without writing a value yet", typed.harness.writes.length, 0);
typedBox.props.onChange({ target: { value: "₫" } });
await flush();
checkJson("...and typing one persists it", typed.harness.writes.filter((write) => write[0] === "displayCurrency"), [["displayCurrency", "₫"]]);
typedTree = typedMount.draw();
check("a stored custom symbol keeps the box open", elements(typedTree).some((node) => node.props.className === "dshCost_input dshCost_custom"), true);

// The rate table lives behind its own fold, and only usable rates are stored.
const rates = settingsHarness({ settingsValue: CONFIGURED, catalog: [] });
const ratesMount = mount(rates.component, { ...rates.face, t, view: "page" });
check("the rate table is folded away at first", elements(ratesMount.draw()).filter((node) => node.props["data-session-cost-fx"] !== undefined).length, 0);
let ratesTree = unfold(ratesMount, "汇率表");
check("no rate rows until one is added", elements(ratesTree).filter((node) => node.props["data-session-cost-fx"] !== undefined).length, 0);
elements(ratesTree).find((node) => node.type === "button" && node.props.children === "添加汇率").props.onClick();
ratesTree = ratesMount.draw();
const rateRow = elements(ratesTree).find((node) => node.props["data-session-cost-fx"] !== undefined);
check("adding a rate shows a row", rateRow !== undefined, true);
// Re-draw between edits: a real keystroke re-renders, so the second field sees
// the draft the first one produced.
elements(rateRow).find((node) => node.props["data-session-cost-fx-field"] === "currency").props.onChange({ target: { value: "¥" } });
ratesTree = ratesMount.draw();
elements(elements(ratesTree).find((node) => node.props["data-session-cost-fx"] !== undefined)).find((node) => node.props["data-session-cost-fx-field"] === "rate").props.onChange({ target: { value: "0.1467" } });
ratesTree = ratesMount.draw();
await flush();
checkJson("a filled rate row is stored as a number", rates.harness.writes.filter((write) => write[0] === "fxRates"), [["fxRates", { "¥": 0.1467 }]]);

// A stored zero is the user's own value: an untouched save must not delete it
// (the conversion is where an unusable rate is refused).
const blank = settingsHarness({ settingsValue: { ...CONFIGURED, fxRates: { "¥": 0 } }, catalog: [] });
const blankMount = mount(blank.component, { ...blank.face, t, view: "page" });
check("a stored rate round-trips into the table", elements(unfold(blankMount, "汇率表")).find((node) => node.props["data-session-cost-fx"] !== undefined).props["data-session-cost-fx"], "¥");
await flush();
check("an untouched rate table is not restated", blank.harness.writes.length, 0);

// ── importing a configured model ─────────────────────────────────────────────
const CATALOG = [
	{ id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "DeepSeek Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }] },
	{ id: "my-gateway", name: "My Gateway", models: [{ id: "qwen3-32b", name: "Qwen3 32B" }, { id: "llama-4", name: "Llama 4" }] }
];
/** Import one route through the picker; reports the page and the mount that drove it. */
async function importInto(harness) {
	const mounted = mount(harness.component, { ...harness.face, t, view: "page" });
	mounted.draw();
	await flush();
	const tree = unfold(mounted, "价格覆盖");
	const picker = elements(tree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
	picker.props.onChange({ target: { value: "my-gateway/llama-4" } });
	const picked = mounted.draw();
	elements(picked).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
	return { tree: mounted.draw(), mounted };
}

const importing = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG });
const importingMount = mount(importing.component, { ...importing.face, t, view: "page" });
importingMount.draw();
await flush();
let importingTree = unfold(importingMount, "价格覆盖");
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
checkJson("importing adds the picked route as a row", routesOf(importingTree), ["my-gateway/qwen3-32b", "my-gateway/llama-4"]);
const importedTree = unfold(importingMount, "my-gateway/llama-4");
check("the display name arrives with the route", routeControl(importedTree, "my-gateway/llama-4", "label").props.value, "Llama 4");
await flush();
check("saving writes both rows", Object.keys(importing.harness.writes[0][1]).length, 2);

// A catalog that cannot be read must leave manual entry working.
const offline = settingsHarness({ settingsValue: CONFIGURED, catalogFails: true });
const offlineMount = mount(offline.component, { ...offline.face, t, view: "page" });
offlineMount.draw();
await flush();
const offlineTree = unfold(offlineMount, "价格覆盖");
check("a failed catalog says so", textOf(offlineTree).includes("读不到模型目录"), true);
check("manual entry survives a failed catalog", elements(offlineTree).some((node) => node.type === "button" && node.props.children === "添加覆盖"), true);

// ── pre-filling an imported row from the Host's preset table ─────────────────
// The table arrives as a package-local chunk the Host half generates, so these
// cases drive the chunk's three shapes: present, failing, and absent.
const RATES = { "my-gateway/llama-4": ["$", 1, 0.1, 1.25, 5, 0, 0, 0, 0] };
const prefilling = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, rates: RATES });
const prefillMount = mount(prefilling.component, { ...prefilling.face, t, view: "page" });
prefillMount.draw();
await flush();
let prefillTree = unfold(prefillMount, "价格覆盖");
const disclosure = elements(prefillTree).find((node) => node.props["data-session-cost-prefill"] !== undefined);
check("the page discloses the pre-fill", disclosure?.props["data-session-cost-prefill"], "ready");
check("...and how many routes it covers", textOf(disclosure).includes("1 条已定价"), true);
const prefillPicker = elements(prefillTree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
prefillPicker.props.onChange({ target: { value: "my-gateway/llama-4" } });
prefillTree = prefillMount.draw();
elements(prefillTree).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
prefillTree = prefillMount.draw();
prefillTree = openOverride(prefillMount, "my-gateway/llama-4");
checkJson("the preset rates arrive with the route, zeros left blank", ["label", "currency", "miss", "hit", "write", "out", "peakMiss", "peakHit", "peakWrite", "peakOut"].map((field) => routeControl(prefillTree, "my-gateway/llama-4", field).props.value), ["Llama 4", "$", "1", "0.1", "1.25", "5", "", "", "", ""]);
await flush();
checkJson("a pre-filled row writes the preset", prefilling.harness.writes[0][1]["my-gateway/llama-4"], { currency: "$", label: "Llama 4", miss: 1, hit: 0.1, write: 1.25, out: 5, peak: { miss: 0, hit: 0, write: 0, out: 0 } });

const failing = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, ratesFails: true });
const imported = await importInto(failing);
const failingTree = imported.tree;
const failingRow = openOverride(imported.mounted, "my-gateway/llama-4");
const failingFields = ["label", "currency", "miss", "hit", "write", "out", "peakMiss", "peakHit", "peakWrite", "peakOut"];
checkJson("a failing chunk still imports the route, without inventing rates", failingFields.map((field) => routeControl(failingRow, "my-gateway/llama-4", field).props.value), ["Llama 4", "", "", "", "", "", "", "", "", ""]);
check("...and says presets are unavailable", textOf(elements(failingTree).find((node) => node.props["data-session-cost-prefill"] !== undefined)).includes("预设价不可用"), true);

const chunkless = settingsHarness({ settingsValue: CONFIGURED, catalog: CATALOG, noChunkLoader: true });
const chunklessTree = (await importInto(chunkless)).tree;
check("a deployment without the chunk loader still imports", routesOf(chunklessTree).length, 2);
check("...and reports no pre-fill", elements(chunklessTree).find((node) => node.props["data-session-cost-prefill"] !== undefined)?.props["data-session-cost-prefill"], "unavailable");

// A route the presets do not price is custom or self-hosted, and the provider id
// is the only hint about what it bills in — still only a pre-fill.
const CUSTOM_ONLY = [...CATALOG, { id: "dashscope", name: "DashScope", models: [{ id: "qwen-max", name: "Qwen Max" }] }];
const suggesting = settingsHarness({ settingsValue: CONFIGURED, catalog: CUSTOM_ONLY, rates: RATES });
const suggestingMount = mount(suggesting.component, { ...suggesting.face, t, view: "page" });
suggestingMount.draw();
await flush();
let suggestingTree = unfold(suggestingMount, "价格覆盖");
const suggestingPicker = elements(suggestingTree).find((node) => node.type === "select" && elements(node).some((child) => child.type === "optgroup"));
suggestingPicker.props.onChange({ target: { value: "dashscope/qwen-max" } });
suggestingTree = suggestingMount.draw();
elements(suggestingTree).find((node) => node.type === "button" && node.props.children === "导入").props.onClick();
suggestingTree = suggestingMount.draw();
const suggestedRow = openOverride(suggestingMount, "dashscope/qwen-max");
check("a custom route gets a currency suggestion", routeControl(suggestedRow, "dashscope/qwen-max", "currency").props.value, "¥");
check("a preset-priced route keeps its own symbol", routeControl(prefillTree, "my-gateway/llama-4", "currency").props.value, "$");


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
