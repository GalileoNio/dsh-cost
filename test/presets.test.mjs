/**
 * Verification harness for the preset price table.
 *
 * The presets are the reason any model can be priced, so these checks pin the
 * derivation (the harness catalog), the routes it cannot supply (DeepSeek
 * official, in CNY), and the precedence a user override wins through.
 *
 *   node test/presets.test.mjs
 */
import { CATALOG_CURRENCY, OFFICIAL_CURRENCY, OFFICIAL_CURRENCY_USD, catalogGeneratedAt, catalogPresets, createPriceLookup } from "../lib/presets.js";

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
	const ok = Object.is(actual, expected);
	if (ok) pass += 1;
	else fail += 1;
	console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected: ${expected}\n       actual:   ${actual}`}`);
}

// ── the harness catalog is the preset source ─────────────────────────────────
const table = catalogPresets();
const routes = Object.keys(table);
check("catalog is memoized", catalogPresets(), table);
check("catalog covers well over a thousand routes", routes.length > 1000, true);
check("every route is keyed provider/model", routes.every((key) => key.includes("/")), true);
check("the catalog's generation timestamp is exposed", typeof catalogGeneratedAt(), "number");

const ANTHROPIC = "anthropic/claude-fable-5";
check("a catalog route is priced", Object.prototype.hasOwnProperty.call(table, ANTHROPIC), true);
check("catalog rates are the catalog's own numbers", table[ANTHROPIC].miss, 10);
check("catalog output rate", table[ANTHROPIC].out, 50);
check("catalog cache-read rate", table[ANTHROPIC].hit, 1);
check("catalog cache-write rate", table[ANTHROPIC].write, 12.5);
check("catalog currency is the catalog's own", table[ANTHROPIC].currency, CATALOG_CURRENCY);
check("catalog display name is carried", table[ANTHROPIC].label, "Claude Fable 5");

// 843 of the 1495 catalog ids themselves contain a slash, so the key is not a
// two-part split.
const MULTI_SLASH = "openrouter/x-ai/grok-4.20";
check("a model id containing a slash is keyed intact", Object.prototype.hasOwnProperty.call(table, MULTI_SLASH), true);
check("long-context tiers are carried", Array.isArray(table["openai/gpt-5.6-terra"].tiers), true);
check("a tier keeps its threshold", table["openai/gpt-5.6-terra"].tiers[0].above > 0, true);

// ── routes the catalog does not ship ─────────────────────────────────────────
const lookup = createPriceLookup({});
const flash = lookup("deepseek-official", "deepseek-flash");
check("DeepSeek official is priced", flash !== null, true);
check("DeepSeek official is quoted in yuan", flash.currency, OFFICIAL_CURRENCY);
check("DeepSeek official off-peak cache miss", flash.base.miss, 1);
check("DeepSeek official off-peak output", flash.base.out, 4);
check("DeepSeek official peak cache miss", flash.peak.miss, 2);
check("DeepSeek official peak output", flash.peak.out, 8);
check("DeepSeek official presets are marked preset", flash.source, "preset");
check("DeepSeek official carries a display name", flash.label, "DeepSeek-V4.1-Flash");
check("DeepSeek official has no long-context tiers", flash.tiers, undefined);

const pro = lookup("deepseek-official", "deepseek-v4-pro");
check("the second official route is priced", pro.base.out, 13.5);
check("its peak window differs", pro.peak.out, 27);

// ── catalog lookups through the resolver ─────────────────────────────────────
check("a plain catalog route resolves", lookup("anthropic", "claude-fable-5").base.out, 50);
check("a multi-slash catalog route resolves", lookup("openrouter", "x-ai/grok-4.20").base.miss, 1.25);
check("an unknown route is unpriced", lookup("nobody", "nothing"), null);
check("an empty model is unpriced", lookup("anthropic", ""), null);
check("a route with no provider still tries the bare model", lookup("", "claude-fable-5"), null);

// The alias is a fallback only: the official table wins for the routes it
// names, and any other model on that provider resolves through the catalog's
// twin provider. Exercised with an injected catalog because the shipped one
// currently names no third official model.
const aliased = createPriceLookup({
	catalog: { "deepseek/deepseek-next": { currency: "$", label: "Next", miss: 9, hit: 0.9, write: 9, out: 18 } }
});
check("an unlisted DeepSeek official model falls through to the catalog twin", aliased("deepseek-official", "deepseek-next").base.miss, 9);
check("the official table still wins over the twin", aliased("deepseek-official", "deepseek-flash").base.miss, 1);
check("the twin is not consulted for another provider", aliased("anthropic", "deepseek-next"), null);

// ── user overrides win, qualified before bare ────────────────────────────────
const overridden = createPriceLookup({
	overrides: {
		"anthropic/claude-fable-5": { label: "Discounted", miss: 1, hit: 0.1, write: 1, out: 2 },
		"claude-fable-5": { miss: 5, hit: 5, write: 5, out: 5 },
		"my-gateway/qwen3-32b": { miss: 0.2, hit: 0.02, write: 0.2, out: 0.4 },
		"deepseek-official/deepseek-flash": { currency: OFFICIAL_CURRENCY, label: "Peak-only", miss: 7, hit: 0.7, write: 7, out: 14 }
	}
});
check("a qualified override beats a bare one", overridden("anthropic", "claude-fable-5").base.miss, 1);
check("an override is marked override", overridden("anthropic", "claude-fable-5").source, "override");
check("an override keeps its label", overridden("anthropic", "claude-fable-5").label, "Discounted");
check("a bare override matches any provider", overridden("somewhere-else", "claude-fable-5").base.miss, 5);
check("an override prices a route the catalog never heard of", overridden("my-gateway", "qwen3-32b").base.out, 0.4);
check("an override replaces the official preset", overridden("deepseek-official", "deepseek-flash").base.miss, 7);
check("an override without a peak window drops the preset's", overridden("deepseek-official", "deepseek-flash").peak, undefined);

// An override without a currency inherits the configured default.
const inherited = createPriceLookup({
	overrides: { "my-gateway/qwen3-32b": { miss: 1, hit: 1, write: 1, out: 1 } },
	defaultCurrency: "€"
});
check("an override inherits the default currency", inherited("my-gateway", "qwen3-32b").currency, "€");
check("an explicit override currency wins", createPriceLookup({
	overrides: { "my-gateway/qwen3-32b": { currency: "£", miss: 1, hit: 1, write: 1, out: 1 } },
	defaultCurrency: "€"
})("my-gateway", "qwen3-32b").currency, "£");

// A malformed override must not poison the table.
const malformed = createPriceLookup({
	overrides: {
		"anthropic/claude-fable-5": null,
		"bad/two": { currency: "X", miss: "nope", hit: -1, out: Number.NaN, write: Number.POSITIVE_INFINITY }
	}
});
check("a null override is ignored, falling through to the catalog", malformed("anthropic", "claude-fable-5").source, "preset");
check("non-numeric override rates clamp to 0", malformed("bad", "two").base.miss, 0);
check("negative override rates clamp to 0", malformed("bad", "two").base.hit, 0);
check("non-finite override rates clamp to 0", malformed("bad", "two").base.out, 0);
check("a null override is ignored for a route the catalog does not know", malformed("bad", "one"), null);

// A broken catalog must narrow what is priced, never take the plugin down.
// ── the two official cards are selected, never converted ─────────────────────
// DeepSeek publishes one list per platform and rounds each on its own, so the
// ratios differ slightly. Deriving one from the other would invent a rate no
// invoice used; the plugin carries both and lets the caller pick.
const cny = createPriceLookup({ officialCard: "cny" });
const usd = createPriceLookup({ officialCard: "usd" });
const FLASH = "deepseek-flash";
check("the domestic card prices in yuan", cny("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY);
check("...at the vendor's CNY numbers", cny("deepseek-official", FLASH).base.miss, 1);
check("...with the peak window doubled", cny("deepseek-official", FLASH).peak.out, 8);
check("the international card prices in dollars", usd("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY_USD);
check("...at the vendor's USD numbers", usd("deepseek-official", FLASH).base.miss, 0.15);
check("...with the peak window doubled", usd("deepseek-official", FLASH).peak.out, 1.2);
check("...on the second route too", usd("deepseek-official", "deepseek-v4-pro").peak.miss, 1.32);
check("...and its cache-hit rate", usd("deepseek-official", "deepseek-v4-pro").base.hit, 0.022);
const cnyRatio = cny("deepseek-official", FLASH).base.miss / usd("deepseek-official", FLASH).base.miss;
const usdRatio = cny("deepseek-official", "deepseek-v4-pro").base.miss / usd("deepseek-official", "deepseek-v4-pro").base.miss;
check("the cards are rounded independently, so neither is a conversion", cnyRatio !== usdRatio, true);
check("the default card is the domestic one", createPriceLookup({})("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY);
check("an unknown card falls back to the default", createPriceLookup({ officialCard: "eur" })("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY);
check("selecting a card never restates the catalog", usd("anthropic", "claude-fable-5").currency, CATALOG_CURRENCY);
check("an override outranks either card", createPriceLookup({
  officialCard: "usd",
  overrides: { "deepseek-official/deepseek-flash": { currency: "€", label: "", miss: 9, hit: 1, write: 9, out: 9 } }
})("deepseek-official", FLASH).currency, "€");

// The Host detects the billing platform asynchronously, so the resolver has to
// be able to change its answer between two lookups.
let lateCard = "cny";
const late = createPriceLookup({ officialCard: () => lateCard });
check("a late card answer is honoured", late("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY);
lateCard = "usd";
check("...and the next lookup follows it", late("deepseek-official", FLASH).currency, OFFICIAL_CURRENCY_USD);

const emptyCatalog = createPriceLookup({ catalog: {} });
check("an empty catalog leaves only the official routes", emptyCatalog("anthropic", "claude-fable-5"), null);
check("an empty catalog still prices the official routes", emptyCatalog("deepseek-official", "deepseek-v4-pro").base.out, 13.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
