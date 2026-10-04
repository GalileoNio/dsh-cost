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
	createElement(type, props, ...children) {
		const node = { type, props: { ...(props ?? {}) } };
		if (children.length > 0) node.props.children = children.length === 1 ? children[0] : children;
		return node;
	},
	useRef: (value) => ({ current: value === undefined ? null : value }),
	useState: (value) => {
		const initial = typeof value === "function" ? value() : value;
		return [harnessOpen && initial === false ? true : initial, () => {}];
	},
	useCallback: (fn) => fn,
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useLayoutEffect: () => {},
	useEffect: () => {}
};
function bundleRequire(specifier) {
	if (specifier === "react") return react;
	if (specifier === "react-dom") return { createPortal: (node) => node };
	throw new Error(`bundle required an unexpected module: ${specifier}`);
}

/** Materialize the bundle, apply it, and return the registration record. */
function applyToFakeContext() {
	const log = [];
	let captured;
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
		slots: {
			inject(slot, callback) {
				log.push(["slots.inject", slot]);
				callback();
			},
			register(options, component) {
				log.push(["slots.register", options.name, options.id, options.order, options.locale]);
				captured = { options, component };
				return () => {};
			}
		}
	};
	vm.runInThisContext(LOADED, { filename: BUNDLE });
	const exports_ = registration.factory(bundleRequire);
	exports_.apply(ctx);
	return { exports_, log, captured };
}

// ── registration contract ────────────────────────────────────────────────────
const applied = applyToFakeContext();
check("registration id", registration.id, "dsh-client-ui-session-cost");
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
checkJson("a preset-only disclosure notes where presets come from", notesOf(open), ["预设价来自 harness 内置模型目录，可在 Settings → Plugins → Session cost 覆盖。"]);

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
