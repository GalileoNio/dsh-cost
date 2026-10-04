/**
 * Verification harness for the `sessionCost` projection fold.
 *
 * The fold cannot be exercised through the running Host without a restart, so
 * this drives the real definition over synthetic committed events and checks
 * three things that matter: the buckets reconcile with an independently
 * reimplemented `tokenUsage` fold, the model attribution follows the documented
 * precedence, and the rate window follows the request's own clock.
 *
 *   node test/projection.test.mjs
 */
import { createSessionCostDefinition, sessionCostProjectionDefinition, sessionCostStateSchema, isPeakInstant, SESSION_COST_KEY, SESSION_COST_STATE_VERSION } from "../lib/projection.js";

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (ok) pass += 1;
	else fail += 1;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected: ${expected}\n       actual:   ${actual}`}`);
}
/** Canonical JSON: object keys sorted, so schema re-ordering is not a difference. */
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}
function checkJson(label, actual, expected) {
	check(label, canonical(actual), canonical(expected));
}

// ── event builders ───────────────────────────────────────────────────────────
const PEAK_TIME = Date.UTC(2026, 2, 4, 2, 0, 0);
const OFFPEAK_TIME = Date.UTC(2026, 2, 4, 12, 0, 0);
const SATURDAY_TIME = Date.UTC(2026, 2, 7, 2, 0, 0);
let seq = 0;
const ev = (type, data, time) => ({ type, seq: (seq += 1), time, data });
const selection = (provider, model, time = PEAK_TIME) => ev("model/selection", { provider, model }, time);
const turnStart = (turn, time = PEAK_TIME) => ev("turn/start", { turn }, time);
const turnEnd = (turn, time = PEAK_TIME) => ev("turn/end", { turn }, time);
const stepStart = (turn, step, time = PEAK_TIME) => ev("step/start", { turn, step }, time);
const stepEnd = (turn, step, time = PEAK_TIME) => ev("step/end", { turn, step }, time);
const attempt = (turn, step, usage, time = PEAK_TIME) => ev("assistant/attempt", {
	turn,
	step,
	stream: usage === undefined ? [] : [{ type: "chunk", chunk: { type: "usage", usage } }]
}, time);
const message = (turn, step, route, usage, time = PEAK_TIME) => ev("assistant/message", {
	turn,
	step,
	message: { source: route },
	...(usage === undefined ? {} : { usage })
}, time);
const retryStarted = (turn, step, time = PEAK_TIME) => ev("llm/retry-started", { turn, step }, time);

const FLASH = { provider: "deepseek-official", model: "deepseek-flash" };
const PRO = { provider: "deepseek-official", model: "deepseek-v4-pro" };
const WED_10 = Date.UTC(2026, 2, 4, 2, 0, 0);
const WED_20 = Date.UTC(2026, 2, 4, 12, 0, 0);

/** Fold a whole event log through the real unit. */
function fold(events) {
	return events.reduce(sessionCostProjectionDefinition.apply, sessionCostProjectionDefinition.init({}, 0));
}
/** Total four buckets across every group plus the unattributed slot. */
function sumWire(wire) {
	const total = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
	const add = (bucket) => {
		total.uncachedInputTokens += bucket.uncachedInputTokens;
		total.cacheReadTokens += bucket.cacheReadTokens;
		total.cacheWriteTokens += bucket.cacheWriteTokens;
		total.outputTokens += bucket.outputTokens;
	};
	for (const key of Object.keys(wire.groups)) add(wire.groups[key]);
	add(wire.unattributed);
	return total;
}
/** Total settled attempts across every group plus the unattributed slot. */
function sumAttempts(wire) {
	return Object.keys(wire.groups).reduce((sum, key) => sum + wire.groups[key].attempts, 0) + wire.unattributed.attempts;
}

// ── an independent reimplementation of the canonical tokenUsage semantics ────
function referenceTotals(events) {
	const zero = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
	const from = (usage) => ({
		uncachedInputTokens: usage.inputTokens,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0,
		outputTokens: usage.outputTokens
	});
	const equal = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
		&& left.cacheReadTokens === right.cacheReadTokens
		&& left.cacheWriteTokens === right.cacheWriteTokens
		&& left.outputTokens === right.outputTokens;
	let totals = zero;
	let last = null;
	for (const event of events) {
		if (event.type === "llm/retry-started") {
			if (last !== null && last.turn === event.data.turn && last.step === event.data.step) last = null;
			continue;
		}
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") continue;
		const sample = event.type === "assistant/message" && event.data.usage !== undefined
			? event.data.usage
			: event.data.stream?.[event.data.stream.length - 1]?.chunk?.usage;
		if (sample === undefined) continue;
		const { turn, step } = event.data;
		const buckets = from(sample);
		const previous = last !== null && last.turn === turn && last.step === step ? last.buckets : undefined;
		if (previous !== undefined && equal(previous, buckets)) continue;
		totals = {
			uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + buckets.uncachedInputTokens,
			cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + buckets.cacheReadTokens,
			cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + buckets.cacheWriteTokens,
			outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + buckets.outputTokens
		};
		last = { turn, step, buckets };
	}
	return totals;
}

// ── definition contract ──────────────────────────────────────────────────────
check("projection key", sessionCostProjectionDefinition.key, "sessionCost");
check("exported key matches", SESSION_COST_KEY, "sessionCost");
check("state version", sessionCostProjectionDefinition.stateVersion, SESSION_COST_STATE_VERSION);
check("empty state groups", Object.keys(sessionCostProjectionDefinition.init({}, 0).wire.groups).length, 0);

// Both boundary schemas must accept the seed: the registry validates persisted
// state before it seeds a fold, and every client view before it leaves.
const seed = sessionCostProjectionDefinition.init({}, 0);
check("seed passes the state schema", sessionCostStateSchema.safeParse(seed).success, true);
check("seed view passes the wire schema", sessionCostProjectionDefinition.wire.viewSchema.safeParse(sessionCostProjectionDefinition.wire.view(seed)).success, true);

// ── one attributed attempt ───────────────────────────────────────────────────
const single = fold([
	selection(FLASH.provider, FLASH.model),
	turnStart(1),
	stepStart(1, 1),
	message(1, 1, FLASH, { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 10_000_000, cacheWriteTokens: 0 }),
	stepEnd(1, 1),
	turnEnd(1)
]);
const groups = single.wire.groups;
check("one group", Object.keys(groups).length, 1);
const group = groups[Object.keys(groups)[0]];
checkJson("group descriptor", { provider: group.provider, model: group.model, peak: group.peak }, { provider: "deepseek-official", model: "deepseek-flash", peak: true });
checkJson("group buckets", {
	uncachedInputTokens: group.uncachedInputTokens,
	cacheReadTokens: group.cacheReadTokens,
	cacheWriteTokens: group.cacheWriteTokens,
	outputTokens: group.outputTokens,
	attempts: group.attempts
}, { uncachedInputTokens: 1_000_000, cacheReadTokens: 10_000_000, cacheWriteTokens: 0, outputTokens: 500_000, attempts: 1 });

// ── the rate window follows the request clock ────────────────────────────────
check("Wednesday 10:00 Beijing is peak", isPeakInstant(WED_10), true);
check("Wednesday 20:00 Beijing is off-peak", isPeakInstant(WED_20), false);
check("Saturday is off-peak", isPeakInstant(SATURDAY_TIME), false);

const windowed = fold([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1, WED_10),
	message(1, 1, FLASH, { inputTokens: 100, outputTokens: 1 }, WED_10),
	stepEnd(1, 1, WED_10),
	stepStart(1, 2, WED_20),
	message(1, 2, FLASH, { inputTokens: 200, outputTokens: 2 }, WED_20),
	stepEnd(1, 2, WED_20)
]);
check("two windows become two groups", Object.keys(windowed.wire.groups).length, 2);
const peaks = Object.values(windowed.wire.groups).map((entry) => entry.peak).sort();
checkJson("one peak and one off-peak group", peaks, [false, true]);
const peakGroup = Object.values(windowed.wire.groups).find((entry) => entry.peak === true);
const offGroup = Object.values(windowed.wire.groups).find((entry) => entry.peak === false);
check("peak group tokens", peakGroup.uncachedInputTokens, 100);
check("off-peak group tokens", offGroup.uncachedInputTokens, 200);

// A step that starts inside the window is stamped by its start, not its settlement.
const straddling = fold([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1, WED_10),
	message(1, 1, FLASH, { inputTokens: 7, outputTokens: 1 }, WED_20),
	stepEnd(1, 1, WED_20)
]);
check("straddling step uses its start window", Object.values(straddling.wire.groups)[0].peak, true);

// ── replacement inside one attempt ───────────────────────────────────────────
const replaced = fold([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 10, outputTokens: 1 }),
	attempt(1, 1, { inputTokens: 40, outputTokens: 4 }),
	message(1, 1, FLASH, { inputTokens: 100, outputTokens: 10 }),
	stepEnd(1, 1)
]);
check("replacement keeps one attempt", sumAttempts(replaced.wire), 1);
check("replacement keeps the last sample", Object.values(replaced.wire.groups)[0].uncachedInputTokens, 100);
checkJson("replacement reconciles with tokenUsage", sumWire(replaced.wire), referenceTotals([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 10, outputTokens: 1 }),
	attempt(1, 1, { inputTokens: 40, outputTokens: 4 }),
	message(1, 1, FLASH, { inputTokens: 100, outputTokens: 10 }),
	stepEnd(1, 1)
]));

// ── a retry is a second billed attempt ───────────────────────────────────────
const retried = [
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 10, outputTokens: 1 }),
	retryStarted(1, 1),
	message(1, 1, FLASH, { inputTokens: 10, outputTokens: 1 }),
	stepEnd(1, 1)
];
const retriedState = fold(retried);
check("retry counts two attempts", sumAttempts(retriedState.wire), 2);
check("retry sums both attempts", sumWire(retriedState.wire).uncachedInputTokens, 20);
checkJson("retry reconciles with tokenUsage", sumWire(retriedState.wire), referenceTotals(retried));

// ── model switching ──────────────────────────────────────────────────────────
const switched = fold([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	message(1, 1, FLASH, { inputTokens: 100, outputTokens: 10 }),
	stepEnd(1, 1),
	selection(PRO.provider, PRO.model),
	stepStart(1, 2),
	message(1, 2, PRO, { inputTokens: 900, outputTokens: 90 }),
	stepEnd(1, 2)
]);
check("two models become two groups", Object.keys(switched.wire.groups).length, 2);
const models = Object.values(switched.wire.groups).map((entry) => entry.model).sort();
checkJson("both models attributed", models, ["deepseek-flash", "deepseek-v4-pro"]);
const flashOnly = Object.values(switched.wire.groups).find((entry) => entry.model === "deepseek-flash");
const proOnly = Object.values(switched.wire.groups).find((entry) => entry.model === "deepseek-v4-pro");
check("flash keeps its own tokens", flashOnly.uncachedInputTokens, 100);
check("pro keeps its own tokens", proOnly.uncachedInputTokens, 900);

// ── attribution precedence ───────────────────────────────────────────────────
const sourceWins = fold([
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	message(1, 1, PRO, { inputTokens: 5, outputTokens: 1 }),
	stepEnd(1, 1)
]);
check("message.source outranks the tracked selection", Object.values(sourceWins.wire.groups)[0].model, "deepseek-v4-pro");

const selectionFallback = fold([
	selection(PRO.provider, PRO.model),
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 5, outputTokens: 1 }),
	stepEnd(1, 1)
]);
check("a message-less attempt falls back to the selection", Object.values(selectionFallback.wire.groups)[0].model, "deepseek-v4-pro");

const unattributed = fold([
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 5, outputTokens: 1 }),
	stepEnd(1, 1)
]);
check("no route means no group", Object.keys(unattributed.wire.groups).length, 0);
checkJson("no route lands in the unattributed slot", {
	uncachedInputTokens: unattributed.wire.unattributed.uncachedInputTokens,
	attempts: unattributed.wire.unattributed.attempts
}, { uncachedInputTokens: 5, attempts: 1 });
check("unattributed still reconciles", sumWire(unattributed.wire).uncachedInputTokens, 5);

// A replacement that gains a route moves the buckets out of the unattributed slot.
const gainedRoute = fold([
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: 5, outputTokens: 1 }),
	message(1, 1, FLASH, { inputTokens: 5, outputTokens: 1 }),
	stepEnd(1, 1)
]);
check("gaining a route empties the unattributed slot", gainedRoute.wire.unattributed.attempts, 0);
check("gaining a route keeps one attempt", sumAttempts(gainedRoute.wire), 1);
check("gaining a route attributes the tokens", Object.values(gainedRoute.wire.groups)[0].uncachedInputTokens, 5);

// Malformed selections and usage records are ignored, never half-applied.
const malformed = fold([
	selection("", ""),
	selection(FLASH.provider, FLASH.model),
	stepStart(1, 1),
	attempt(1, 1, { inputTokens: -1, outputTokens: 1 }),
	attempt(1, 1, { inputTokens: 1.5, outputTokens: 1 }),
	attempt(1, 1, { inputTokens: "9", outputTokens: 1 }),
	message(1, 1, FLASH, undefined),
	stepEnd(1, 1)
]);
check("malformed usage adds nothing", sumAttempts(malformed.wire), 0);
check("malformed usage still tracks the route", Object.keys(malformed.wire.groups).length, 0);

// ── identity stability ───────────────────────────────────────────────────────
const base = fold([selection(FLASH.provider, FLASH.model), stepStart(1, 1), message(1, 1, FLASH, { inputTokens: 1, outputTokens: 1 }), stepEnd(1, 1)]);
check("uninterested events keep the state reference", sessionCostProjectionDefinition.apply(base, ev("tool/call", { toolCallId: "x" })), base);
check("a repeated selection keeps the state reference", sessionCostProjectionDefinition.apply(base, selection(FLASH.provider, FLASH.model)), base);
check("view reuses the payload reference", sessionCostProjectionDefinition.wire.view(base), sessionCostProjectionDefinition.wire.view(base));

// ── persisted-state round trip ───────────────────────────────────────────────
check("a folded state passes the state schema", sessionCostStateSchema.safeParse(switched).success, true);
const restored = sessionCostStateSchema.parse(JSON.parse(JSON.stringify(switched)));
checkJson("state survives a JSON round trip", restored.wire.groups, switched.wire.groups);
const continued = sessionCostProjectionDefinition.apply(restored, message(1, 3, PRO, { inputTokens: 1, outputTokens: 1 }));
check("a restored state continues folding", sumWire(continued.wire).uncachedInputTokens, 1001);
checkJson("view payload passes the wire schema", sessionCostProjectionDefinition.wire.viewSchema.parse(sessionCostProjectionDefinition.wire.view(switched)), JSON.parse(JSON.stringify(switched.wire)));


// ── price composition ────────────────────────────────────────────────────────
// The Host narrows a resolved price to ONE rate set before the wire leaves, so
// the browser multiplies and never chooses. These pin that narrowing.
const RATES = { miss: 2, hit: 0.04, write: 2, out: 8 };
const PEAK_RATES = { miss: 4, hit: 0.08, write: 4, out: 16 };
const TIER_RATES = { miss: 20, hit: 0.4, write: 20, out: 80 };
const PRICE = {
	currency: "$",
	label: "Test Model",
	base: RATES,
	peak: PEAK_RATES,
	tiers: [{ above: 1_000, ...TIER_RATES }],
	source: "preset"
};

/** A priced definition over a fixed resolution. */
function priced(overrides = {}) {
	return createSessionCostDefinition({ lookup: () => PRICE, period: "auto", ...overrides });
}
/** Fold one settled attempt of `input` prompt tokens at one instant. */
function attemptAt(definition, time, input) {
	return [
		selection(FLASH.provider, FLASH.model, time),
		stepStart(1, 1, time),
		message(1, 1, FLASH, { inputTokens: input, outputTokens: 1 }, time),
		stepEnd(1, 1, time)
	].reduce(definition.apply, definition.init({}, 0));
}
const groupOf = (wire) => Object.values(wire.groups)[0];

const autoDefinition = priced();
const offWire = autoDefinition.wire.view(attemptAt(autoDefinition, WED_20, 100));
checkJson("an off-peak group carries the base rates", groupOf(offWire).price.rates, RATES);
check("the wire carries the currency", groupOf(offWire).price.currency, "$");
check("the wire carries the display label", groupOf(offWire).price.label, "Test Model");
check("the wire carries the price source", groupOf(offWire).price.source, "preset");

const peakWire = autoDefinition.wire.view(attemptAt(autoDefinition, WED_10, 100));
check("a peak group carries the peak rates", groupOf(peakWire).price.rates.miss, 4);
check("the recorded window survives on the group", groupOf(peakWire).peak, true);

const forcedPeak = priced({ period: "peak" });
check("period=peak re-prices an off-peak group", groupOf(forcedPeak.wire.view(attemptAt(forcedPeak, WED_20, 100))).price.rates.miss, 4);
const forcedOff = priced({ period: "offpeak" });
check("period=offpeak re-prices a peak group", groupOf(forcedOff.wire.view(attemptAt(forcedOff, WED_10, 100))).price.rates.miss, 2);

// A long-context tier replaces BOTH windows, mirroring the catalog's own
// calculateCost: the highest threshold strictly exceeded prices the request.
const tiered = priced();
check("a tier above the threshold replaces the base rates", groupOf(tiered.wire.view(attemptAt(tiered, WED_20, 2_000))).price.rates.miss, 20);
check("a tier also replaces the peak rates", groupOf(tiered.wire.view(attemptAt(tiered, WED_10, 2_000))).price.rates.miss, 20);
check("the threshold is strict", groupOf(tiered.wire.view(attemptAt(tiered, WED_20, 1_000))).price.rates.miss, 2);
check("just above the threshold matches", groupOf(tiered.wire.view(attemptAt(tiered, WED_20, 1_001))).price.rates.miss, 20);

// Cache traffic counts toward the tier threshold, as it does in calculateCost.
const cacheTierDefinition = priced();
const cacheState = [
	selection(FLASH.provider, FLASH.model, WED_20),
	stepStart(1, 1, WED_20),
	message(1, 1, FLASH, { inputTokens: 100, outputTokens: 1, cacheReadTokens: 1_000, cacheWriteTokens: 0 }, WED_20),
	stepEnd(1, 1, WED_20)
].reduce(cacheTierDefinition.apply, cacheTierDefinition.init({}, 0));
check("cache reads count toward the tier threshold", groupOf(cacheTierDefinition.wire.view(cacheState)).price.rates.miss, 20);

// An unpriced route carries no price at all; the browser lists it as excluded.
const unpricedDefinition = createSessionCostDefinition({ lookup: () => null });
const unpricedWire = unpricedDefinition.wire.view(attemptAt(unpricedDefinition, WED_20, 100));
check("an unpriced group carries no price", groupOf(unpricedWire).price, undefined);
check("its tokens still folded", groupOf(unpricedWire).uncachedInputTokens, 100);

// The composed view is reference-stable so publication dedupes by identity.
const stableState = attemptAt(autoDefinition, WED_20, 100);
check("the composed view reuses its reference", autoDefinition.wire.view(stableState), autoDefinition.wire.view(stableState));
check("the composed wire passes its own schema", autoDefinition.wire.viewSchema.safeParse(offWire).success, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
