/**
 * The `sessionCost` projection unit: a pure fold of the durable attempt
 * lifecycle into per-model, per-rate-window token buckets.
 *
 * Why a projection and not a client fold: per-model attribution only exists in
 * the durable log. `dsh-token-meter`'s `tokenUsage` accumulates the four
 * provider-reported buckets but carries no route; the chat window's
 * `TurnTokenUsage` carries routes but lives in a paged window that compaction
 * rewrites. The seam's contract is that folds see the complete committed log,
 * so this unit is where "which model actually served these tokens, and in which
 * rate window" can be answered exactly, once, for every carrier.
 *
 * Two facts are folded per billed request attempt:
 *
 * - **the route** — from the settled `assistant/message`'s `message.source`,
 *   falling back to the newest `model/selection` in effect. `message.source` is
 *   authoritative for a settled attempt; the selection covers attempts that
 *   never assembled a message.
 * - **the rate window** — from the event clock, using DeepSeek's published
 *   Beijing-time peak windows. This is deliberately a fixed rule and not
 *   configuration: a fold must be a pure function of the log, so a configurable
 *   window would make persisted state depend on settings the log does not
 *   record. The client applies the `period` override on top of the recorded
 *   fact.
 *
 * The add/replace bookkeeping mirrors `tokenUsage` exactly — a settlement
 * replaces its `(turn, step)` slot, and `llm/retry-started` closes the
 * replacement slot so a retried attempt adds rather than replaces — so the sum
 * over these groups reconciles with that projection bucket for bucket.
 *
 * @module dsh-session-cost/projection
 */
import { z } from "zod";

/** The projection key this unit owns. */
export const SESSION_COST_KEY = "sessionCost";

/**
 * Persisted-state version. Bump whenever the serialized fields or the fold
 * semantics change, so older cached rows are discarded rather than
 * forward-applied into garbage.
 */
export const SESSION_COST_STATE_VERSION = 1;

/** Beijing is UTC+8 with no daylight saving. */
const BEIJING_OFFSET_MS = 288e5;

/**
 * Whether one instant falls in DeepSeek's Beijing-time peak window: Monday to
 * Friday, 09:00–12:00 and 14:00–18:00. Weekends, and every other hour, are
 * off-peak at half the peak rate.
 *
 * Statutory holidays are NOT detected: the log records no holiday calendar, so
 * a weekday public holiday is classified peak. Nothing else classifies a
 * window, on either half, so there is no second answer to disagree with.
 *
 * @param ms - Unix epoch milliseconds of the request.
 * @returns whether the peak rate applies.
 */
export function isPeakInstant(ms) {
	const shifted = new Date(ms + BEIJING_OFFSET_MS);
	const day = shifted.getUTCDay();
	if (day === 0 || day === 6) return false;
	const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
	return minutes >= 540 && minutes < 720 || minutes >= 840 && minutes < 1080;
}

const totalsSchema = z.object({
	uncachedInputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative()
});

/** One group's wire shape: the four buckets plus the settled-attempt count. */
const bucketSchema = totalsSchema.extend({
	attempts: z.number().int().nonnegative()
});

/** One `(provider, model, window)` group; the descriptor rides the entry so no client parses the key. */
const groupSchema = bucketSchema.extend({
	provider: z.string(),
	model: z.string(),
	peak: z.boolean()
});

/** The fold's own client-visible payload: groups plus everything that could not be attributed. */
const sessionCostStatePayloadSchema = z.object({
	groups: z.record(z.string(), groupSchema),
	unattributed: bucketSchema
}).strict();

/** One four-rate set, in `currency` per 1,000,000 tokens. */
const ratesSchema = z.object({
	miss: z.number().nonnegative(),
	hit: z.number().nonnegative(),
	write: z.number().nonnegative(),
	out: z.number().nonnegative()
});

/**
 * The prices a client prices one group with, already narrowed by the Host to
 * the one rate set that applies: the request's long-context tier when the
 * vendor has one, otherwise the peak or base window the settings policy
 * selects.
 *
 * Narrowing on the Host rather than shipping a rate card keeps the wire to one
 * four-number object per group: the browser applies no window and no tier, so it
 * cannot reach a different price than the Host did.
 */
const priceSchema = z.object({
	currency: z.string(),
	/** Display name for the route; the catalog's `name`, or the override's own label. */
	label: z.string(),
	rates: ratesSchema,
	source: z.union([z.literal("preset"), z.literal("override")])
});

/**
 * The reference rates the browser resolves its one summary figure from.
 *
 * Only data rides the wire, not a resolved policy: which currency that figure is
 * expressed in is a presentation setting, and the browser is the side that can
 * see a settings change the moment it is written. A projection is recomposed only
 * when the session log moves, so a target currency resolved on the Host would sit
 * stale until the next event; rates resolved here do not.
 *
 * `perEur` is the EUR-based table, `symbols` maps the settings' currency symbols
 * onto the ISO codes it is keyed by, and `source` says whether this is the live
 * feed or the dated snapshot standing in for it.
 */
const referenceSchema = z.object({
	perEur: z.record(z.string(), z.number()),
	symbols: z.record(z.string(), z.string()),
	asOf: z.string().nullable(),
	source: z.union([z.literal("reference"), z.literal("snapshot")])
}).strict();

/** The payload a client receives: every group plus the price the Host resolved for it. */
const sessionCostWireSchema = z.object({
	groups: z.record(z.string(), groupSchema.extend({ price: priceSchema.optional() })),
	unattributed: bucketSchema,
	/** The reference rates a summary figure is resolved from; see the schema above. */
	reference: referenceSchema.optional()
}).strict();

/** The fold state's full shape, validated on persisted-cache rows before they seed a fold. */
export const sessionCostStateSchema = z.object({
	/** Client-visible payload; kept reference-stable so the live drive can dedupe by identity. */
	wire: sessionCostStatePayloadSchema,
	/** The `(turn, step)` slot whose buckets a later sample in the same attempt replaces. */
	last: z.object({
		turn: z.number().int().nonnegative(),
		step: z.number().int().nonnegative(),
		group: z.string().nullable(),
		totals: totalsSchema
	}).strict().nullable(),
	/** Newest `model/selection` in effect, used when an attempt settles no message. */
	selection: z.object({ provider: z.string(), model: z.string() }).strict().nullable(),
	/** Open step, so an attempt is stamped with the request's start rather than its settlement. */
	step: z.object({
		turn: z.number().int().nonnegative(),
		step: z.number().int().nonnegative(),
		startTime: z.number().nonnegative()
	}).strict().nullable()
}).strict();

/** A zeroed four-bucket total. */
function zeroTotals() {
	return { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}

/** A zeroed wire bucket. */
function zeroBucket() {
	return { ...zeroTotals(), attempts: 0 };
}

/** Whether a bucket carries nothing at all. */
function isEmptyBucket(bucket) {
	return bucket.uncachedInputTokens === 0
		&& bucket.cacheReadTokens === 0
		&& bucket.cacheWriteTokens === 0
		&& bucket.outputTokens === 0
		&& bucket.attempts === 0;
}

/** Whether two four-bucket totals are equal. */
function sameTotals(left, right) {
	return left.uncachedInputTokens === right.uncachedInputTokens
		&& left.cacheReadTokens === right.cacheReadTokens
		&& left.cacheWriteTokens === right.cacheWriteTokens
		&& left.outputTokens === right.outputTokens;
}

/** A non-negative safe integer, or undefined. */
function count(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The four disjoint buckets one provider usage record contributes, mirroring
 * `tokenUsage`'s `bucketsFrom`.
 * @param usage - a provider usage record from a settled or failed attempt.
 * @returns the buckets, or undefined when the record is unusable.
 */
function totalsOf(usage) {
	if (usage === null || typeof usage !== "object") return undefined;
	const input = count(usage.inputTokens);
	const output = count(usage.outputTokens);
	if (input === undefined || output === undefined) return undefined;
	const cacheRead = usage.cacheReadTokens === undefined ? 0 : count(usage.cacheReadTokens);
	const cacheWrite = usage.cacheWriteTokens === undefined ? 0 : count(usage.cacheWriteTokens);
	if (cacheRead === undefined || cacheWrite === undefined) return undefined;
	return {
		uncachedInputTokens: input,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: cacheWrite,
		outputTokens: output
	};
}

/** The last embedded chunk of one never-packed type, mirroring `lastAssistantStreamChunk`. */
function lastUsageChunk(stream) {
	if (!Array.isArray(stream)) return undefined;
	for (let index = stream.length - 1; index >= 0; index -= 1) {
		const record = stream[index];
		if (record === null || typeof record !== "object" || record.type !== "chunk") continue;
		const chunk = record.chunk;
		if (chunk !== null && typeof chunk === "object" && chunk.type === "usage") return chunk;
	}
	return undefined;
}

/**
 * The usage one durable attempt settlement reports, mirroring `tokenUsage`'s
 * `usageOf`: an explicit `assistant/message.usage` wins, otherwise the last
 * `usage` chunk embedded in the stream.
 * @param event - a committed session event.
 * @returns the usage record, or undefined when this event reports none.
 */
function usageOf(event) {
	if (event.type === "assistant/message" && event.data.usage !== undefined) return event.data.usage;
	if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return undefined;
	const chunk = lastUsageChunk(event.data.stream);
	return chunk === undefined ? undefined : chunk.usage;
}

/** A `{provider, model}` with both members non-empty, or null. */
function validSelection(value) {
	if (value === null || typeof value !== "object") return null;
	const provider = value.provider;
	const model = value.model;
	if (typeof provider !== "string" || provider === "") return null;
	if (typeof model !== "string" || model === "") return null;
	return { provider, model };
}

/**
 * The route a settled attempt is billed to: its own assembled message when it
 * has one, otherwise the newest selection in effect.
 * @param event - the settling event.
 * @param state - fold state carrying the tracked selection.
 * @returns the route, or null when neither source names one.
 */
function routeOf(event, state) {
	if (event.type === "assistant/message" && event.data.message !== undefined) {
		const own = validSelection(event.data.message === null ? null : event.data.message.source);
		if (own !== null) return own;
	}
	return state.selection;
}

/** The group key for one route and rate window. */
function groupKeyOf(route, peak) {
	return `${route.provider}\u0000${route.model}\u0000${peak ? "peak" : "offpeak"}`;
}

/**
 * Apply one signed contribution to a wire payload.
 * @param wire - the current payload.
 * @param group - group key, or null for the unattributed slot.
 * @param descriptor - route and window, required only when this creates a group entry.
 * @param totals - the four buckets to apply.
 * @param sign - `1` to add, `-1` to remove.
 * @returns the next payload.
 */
function contribute(wire, group, descriptor, totals, sign) {
	if (group === null) {
		const current = wire.unattributed;
		return {
			groups: wire.groups,
			unattributed: {
				uncachedInputTokens: Math.max(0, current.uncachedInputTokens + sign * totals.uncachedInputTokens),
				cacheReadTokens: Math.max(0, current.cacheReadTokens + sign * totals.cacheReadTokens),
				cacheWriteTokens: Math.max(0, current.cacheWriteTokens + sign * totals.cacheWriteTokens),
				outputTokens: Math.max(0, current.outputTokens + sign * totals.outputTokens),
				attempts: Math.max(0, current.attempts + sign)
			}
		};
	}
	const current = Object.prototype.hasOwnProperty.call(wire.groups, group) ? wire.groups[group] : undefined;
	// Removal carries no descriptor: the entry being undone already holds one.
	const source = current ?? descriptor;
	if (source === undefined || source === null) return wire;
	const next = {
		provider: source.provider,
		model: source.model,
		peak: source.peak,
		uncachedInputTokens: Math.max(0, (current?.uncachedInputTokens ?? 0) + sign * totals.uncachedInputTokens),
		cacheReadTokens: Math.max(0, (current?.cacheReadTokens ?? 0) + sign * totals.cacheReadTokens),
		cacheWriteTokens: Math.max(0, (current?.cacheWriteTokens ?? 0) + sign * totals.cacheWriteTokens),
		outputTokens: Math.max(0, (current?.outputTokens ?? 0) + sign * totals.outputTokens),
		attempts: Math.max(0, (current?.attempts ?? 0) + sign)
	};
	const groups = { ...wire.groups };
	if (isEmptyBucket(next)) delete groups[group];
	else groups[group] = next;
	return { groups, unattributed: wire.unattributed };
}

/** The empty fold state. */
function emptyState() {
	return {
		wire: { groups: {}, unattributed: zeroBucket() },
		last: null,
		selection: null,
		step: null
	};
}

/**
 * The pure fold, independent of prices: previous state plus one committed
 * session event.
 *
 * An uninterested event returns the SAME state reference, which is what keeps
 * the drive's work proportional to the events a unit actually consumes.
 */
const fold = {
	init: () => emptyState(),
	apply: (state, event) => {
		switch (event.type) {
			case "model/selection": {
				const selection = validSelection(event.data);
				if (selection === null) return state;
				if (state.selection !== null
					&& state.selection.provider === selection.provider
					&& state.selection.model === selection.model) return state;
				return { ...state, selection };
			}
			case "step/start": {
				const { turn, step } = event.data;
				if (state.step !== null && state.step.turn === turn && state.step.step === step) return state;
				return { ...state, step: { turn, step, startTime: event.time } };
			}
			case "step/end": {
				if (state.step === null) return state;
				if (state.step.turn !== event.data.turn || state.step.step !== event.data.step) return state;
				return { ...state, step: null };
			}
			case "turn/end": {
				if (state.step === null || state.step.turn !== event.data.turn) return state;
				return { ...state, step: null };
			}
			case "llm/retry-started": {
				// Mirror tokenUsage: dropping the slot makes the retried attempt ADD
				// instead of replacing the attempt it supersedes. Both were billed.
				if (state.last === null) return state;
				if (state.last.turn !== event.data.turn || state.last.step !== event.data.step) return state;
				return { ...state, last: null };
			}
			case "assistant/message":
			case "assistant/attempt": {
				const sample = usageOf(event);
				if (sample === undefined) return state;
				const totals = totalsOf(sample);
				if (totals === undefined) return state;
				const { turn, step } = event.data;
				const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null;
				const route = routeOf(event, state);
				const at = state.step !== null && state.step.turn === turn && state.step.step === step ? state.step.startTime : event.time;
				const peak = isPeakInstant(at);
				const group = route === null ? null : groupKeyOf(route, peak);
				if (previous !== null && previous.group === group && sameTotals(previous.totals, totals)) return state;
				let wire = state.wire;
				if (previous !== null) wire = contribute(wire, previous.group, null, previous.totals, -1);
				wire = contribute(wire, group, route === null ? null : { provider: route.provider, model: route.model, peak }, totals, 1);
				return { ...state, wire, last: { turn, step, group, totals } };
			}
			default:
				return state;
		}
	}
};

/**
 * Compose the fold's payload with the price resolved for each group.
 *
 * Prices are a presentation concern resolved against the catalog and the
 * plugin's settings, so they are attached here rather than carried through the
 * fold — the fold must stay a pure function of the log.
 * @param payload - the fold's own client-visible payload.
 * @param lookup - route → price resolver.
 * @returns the payload a client prices with.
 */
/**
 * Narrow one resolved price to the single rate set that applies to a group.
 *
 * Long-context tiers are checked first and replace both windows, mirroring the
 * catalog's own `calculateCost`: the highest configured threshold the request's
 * total input exceeds wins, and it prices the whole request. No shipped vendor
 * pairs tiers with peak windows, so a tiered route needs no window recursion.
 *
 * @param price - the resolved preset or override.
 * @param group - the folded group, for its token split and recorded window.
 * @param period - the settings policy: `auto` honours the recorded window.
 * @returns the applicable four-rate set.
 */
function narrowRates(price, group, period) {
	const inputTokens = group.uncachedInputTokens + group.cacheReadTokens + group.cacheWriteTokens;
	if (Array.isArray(price.tiers)) {
		let matched;
		for (const tier of price.tiers) {
			if (inputTokens > tier.above) matched = tier;
		}
		if (matched !== undefined) return { miss: matched.miss, hit: matched.hit, write: matched.write, out: matched.out };
	}
	const peakWindow = period === "peak" ? true : period === "offpeak" ? false : group.peak === true;
	return peakWindow && price.peak !== undefined ? price.peak : price.base;
}

/**
 * Compose the fold's payload with the price resolved for each group.
 *
 * Prices and the rate-window policy are a presentation concern resolved against
 * the catalog and the plugin's settings, so they are attached here rather than
 * carried through the fold — the fold must stay a pure function of the log.
 *
 * @param payload - the fold's own client-visible payload.
 * @param lookup - route → price resolver.
 * @param period - the configured rate-window policy.
 * @returns the payload a client prices with.
 */
function composeWire(payload, lookup, period, reference = null) {
	// The reference data is a getter: the Host publishes the live feed once it
	// lands, and a snapshot until then, so that answer can change between two
	// compositions. `priceRevision` is what makes the view cache miss when it does.
	const rates = typeof reference === "function" ? reference() : reference;
	const groups = {};
	for (const key of Object.keys(payload.groups)) {
		const group = payload.groups[key];
		const price = lookup(group.provider, group.model);
		if (price === null) {
			groups[key] = group;
			continue;
		}
		groups[key] = {
			...group,
			price: {
				currency: price.currency,
				label: price.label,
				rates: narrowRates(price, group, period),
				source: price.source
			}
		};
	}
	return {
		groups,
		unattributed: payload.unattributed,
		...(rates === null || rates === undefined ? {} : { reference: rates })
	};
}

/**
 * Create the `sessionCost` projection unit for one resolved price table.
 *
 * The composed view is cached per state object, so a resumed render of the
 * same state reuses its reference — the live drive keeps the two latest raw
 * views and compares them with `Object.is`, and an object-valued view that
 * allocated on every call would publish on every event. A `WeakMap` keys that
 * cache by the state itself, so the cache is per session and dies with it.
 *
 * `priceRevision` exists because the cached view is a function of the prices as
 * well as the state: the Host resolves the DeepSeek billing platform
 * asynchronously, so the same recorded state can legitimately compose to a
 * different view once that answer arrives. Passing the pricing identity makes the
 * cache miss in that case instead of serving the earlier card.
 *
 * @param options - the host-composed price resolver, its rate-window policy, an
 * optional getter for whatever else the composed prices depend on, and the
 * reference rates the browser resolves a summary figure from.
 * @returns the definition to register on the session-projection seam.
 */
export function createSessionCostDefinition({ lookup, period = "auto", priceRevision, reference = null }) {
	const cache = new WeakMap();
	const revisionOf = typeof priceRevision === "function" ? priceRevision : () => null;
	return {
		key: SESSION_COST_KEY,
		stateVersion: SESSION_COST_STATE_VERSION,
		stateSchema: sessionCostStateSchema,
		init: fold.init,
		apply: fold.apply,
		wire: {
			viewSchema: sessionCostWireSchema,
			view(state) {
				const revision = revisionOf();
				const cached = cache.get(state);
				if (cached !== undefined && cached.revision === revision) return cached.view;
				const view = composeWire(state.wire, lookup, period, reference);
				cache.set(state, { revision, view });
				return view;
			}
		}
	};
}

/** The fold without prices, for tests and for hosts that price nothing. */
export const sessionCostProjectionDefinition = createSessionCostDefinition({ lookup: () => null });
