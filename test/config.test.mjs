/**
 * Verification harness for the session-cost host half.
 *
 * The host half wires three things together — the settings schema, the preset
 * lookup, and the projection fold — so these checks cover the schema boundaries
 * and then drive the definition `apply` actually registers, which is the only
 * place all three meet.
 *
 *   node test/config.test.mjs
 */
import { Config, NAMESPACE, apply, inject, name } from "../lib/index.js";
import { OFFICIAL_CURRENCY, createPriceLookup } from "../lib/presets.js";
import { SESSION_COST_KEY, SESSION_COST_STATE_VERSION } from "../lib/projection.js";

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (ok) pass += 1;
	else fail += 1;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected: ${expected}\n       actual:   ${actual}`}`);
}
function rejects(label, config) {
	try {
		Config(config);
		fail += 1;
		console.log(`FAIL ${label}\n       expected: a validation error\n       actual:   accepted`);
	} catch (error) {
		pass += 1;
		console.log(`ok   ${label} — ${String(error.message).split("\n")[0]}`);
	}
}

// ── plugin contract ──────────────────────────────────────────────────────────
check("namespace is the profile entry id", NAMESPACE, "session-cost");
check("cordis plugin name", name, "session-cost");
check("injects the projection registry", JSON.stringify(inject), JSON.stringify(["sessionProjections"]));

/**
 * Applying also materializes the browser's preset-table chunk next to
 * `client.js`, because that is what the Host does on every boot. The write is
 * idempotent — a matching file is left untouched and the client entry's
 * revision only moves when the table actually changes — so running this suite
 * inside an installed profile leaves the same artifact a real startup would.
 */
/** Capture whatever one apply() registers. */
function register(config) {
	const registered = [];
	apply({ sessionProjections: { register: (definition) => { registered.push(definition); return () => {}; } } }, config);
	return registered;
}
const defaultRegistered = register(Config({}));
check("apply registers exactly one unit", defaultRegistered.length, 1);
check("registered key", defaultRegistered[0].key, SESSION_COST_KEY);
check("registered state version", defaultRegistered[0].stateVersion, SESSION_COST_STATE_VERSION);
check("disabling registers nothing", register(Config({ enabled: false })).length, 0);

// ── the registered definition prices a real fold end to end ──────────────────
const definition = defaultRegistered[0];
const selection = (provider, model, time) => ({ type: "model/selection", seq: 1, time, data: { provider, model } });
const stepStart = (time) => ({ type: "step/start", seq: 2, time, data: { turn: 1, step: 1 } });
const message = (time, provider, model, usage) => ({
	type: "assistant/message",
	seq: 3,
	time,
	data: { turn: 1, step: 1, message: { source: { provider, model } }, usage }
});
const stepEnd = (time) => ({ type: "step/end", seq: 4, time, data: { turn: 1, step: 1 } });

/** Fold one settled attempt and read the wire the browser would receive. */
function wireFor(config, provider, model, usage, time) {
	const registered = register(config);
	const registeredDefinition = registered[0];
	const at = time ?? Date.UTC(2026, 2, 4, 12, 0, 0);
	const state = [
		selection(provider, model, at),
		stepStart(at),
		message(at, provider, model, usage),
		stepEnd(at)
	].reduce(registeredDefinition.apply, registeredDefinition.init({}, 0));
	return registeredDefinition.wire.view(state);
}
const USAGE = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 10_000_000, cacheWriteTokens: 0 };

const officialWire = wireFor(Config({}), "deepseek-official", "deepseek-flash", USAGE);
const officialGroup = Object.values(officialWire.groups)[0];
check("the wired price is a preset", officialGroup.price.source, "preset");
check("the wired price is quoted in yuan", officialGroup.price.currency, OFFICIAL_CURRENCY);
check("the wired price carries a display name", officialGroup.price.label, "DeepSeek-V4.1-Flash");
check("the wired rates are the official off-peak rates", officialGroup.price.rates.miss, 1);
check("the wired rates are already window-narrowed", officialGroup.price.rates.out, 4);

const peakWire = wireFor(Config({}), "deepseek-official", "deepseek-flash", USAGE, Date.UTC(2026, 2, 4, 2, 0, 0));
check("a request inside the peak window is wired at peak rates", Object.values(peakWire.groups)[0].price.rates.miss, 2);

const forcedWire = wireFor(Config({ period: "peak" }), "deepseek-official", "deepseek-flash", USAGE);
check("period=peak narrows every group to peak", Object.values(forcedWire.groups)[0].price.rates.miss, 2);

// The catalog reaches the wire for a third-party route.
const catalogWire = wireFor(Config({}), "anthropic", "claude-fable-5", USAGE);
const catalogGroup = Object.values(catalogWire.groups)[0];
check("a catalog route is wired", catalogGroup.price.source, "preset");
check("a catalog route is quoted in dollars", catalogGroup.price.currency, "$");
check("a catalog rate reaches the wire", catalogGroup.price.rates.out, 50);

// A user override reaches the wire, with its own label and currency.
const overrideWire = wireFor(Config({
	prices: { "my-gateway/qwen3-32b": { label: "My Qwen", currency: "$", miss: 0.2, hit: 0.02, write: 0.2, out: 0.4 } },
	defaultCurrency: "$"
}), "my-gateway", "qwen3-32b", USAGE);
const overrideGroup = Object.values(overrideWire.groups)[0];
check("an override is wired", overrideGroup.price.source, "override");
check("an override label reaches the wire", overrideGroup.price.label, "My Qwen");
check("an override rate reaches the wire", overrideGroup.price.rates.miss, 0.2);

// An unknown route still folds its tokens; it just carries no price.
const unknownWire = wireFor(Config({}), "nobody", "nothing", USAGE);
const unknownGroup = Object.values(unknownWire.groups)[0];
check("an unpriced route is still folded", unknownGroup.uncachedInputTokens, 1_000_000);
check("an unpriced route carries no price", unknownGroup.price, undefined);

// ── defaults ─────────────────────────────────────────────────────────────────
const defaults = Config({});
check("default enabled", defaults.enabled.get(), true);
check("default period", defaults.period.get(), "auto");
check("default currency", defaults.currency.get(), "$");
check("the override table starts empty", JSON.stringify(defaults.prices.get()), "{}");

// ── every top-level field is volatile, or the settings page never sees it ────
for (const field of ["enabled", "period", "currency", "prices"]) {
	check(`${field} resolves as a volatile handle`, typeof defaults[field]?.get, "function");
}

// ── explicit values win ──────────────────────────────────────────────────────
const explicit = Config({
	enabled: false,
	period: "peak",
	currency: "€",
	prices: { "gateway/model": { miss: 1, hit: 2, write: 3, out: 4 } }
});
check("explicit enabled", explicit.enabled.get(), false);
check("explicit period", explicit.period.get(), "peak");
check("explicit currency", explicit.currency.get(), "€");
const explicitEntry = explicit.prices.get()["gateway/model"];
check("explicit override rates", JSON.stringify([explicitEntry.miss, explicitEntry.hit, explicitEntry.write, explicitEntry.out]), JSON.stringify([1, 2, 3, 4]));
check("an omitted override currency resolves empty so it can inherit", explicitEntry.currency, "");

// ── loud rejection: an incomplete entry must never resolve to a silent 0 ─────
rejects("partial base rates", { prices: { "gateway/model": { miss: 1, hit: 1, write: 1 } } });
rejects("no rates at all", { prices: { "gateway/model": { label: "x" } } });
rejects("non-numeric rate", { prices: { "gateway/model": { miss: "1", hit: 1, write: 1, out: 1 } } });
rejects("partial peak window", { prices: { "gateway/model": { miss: 1, hit: 1, write: 1, out: 1, peak: { miss: 2, hit: 2, write: 2 } } } });
rejects("unknown period", { period: "bogus" });

// Schemastery always materializes the nested `peak`, so all-zero rates are the
// spelling of "no peak window" and the lookup is what drops it.
const noPeak = Config({ prices: { "gateway/model": { miss: 1, hit: 1, write: 1, out: 1 } } });
check("an omitted peak window materializes as zeros", noPeak.prices.get()["gateway/model"].peak.miss, 0);
check("zero peak rates mean no peak window", createPriceLookup({ overrides: noPeak.prices.get() })("gateway", "model").peak, undefined);
const withPeak = Config({ prices: { "gateway/model": { miss: 1, hit: 1, write: 1, out: 1, peak: { miss: 2, hit: 2, write: 2, out: 2 } } } });
check("a peak window resolves when given", withPeak.prices.get()["gateway/model"].peak.miss, 2);
check("a real peak window reaches the lookup", createPriceLookup({ overrides: withPeak.prices.get() })("gateway", "model").peak.miss, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
