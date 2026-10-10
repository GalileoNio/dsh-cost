/**
 * Preset unit prices, derived from the harness's own model catalog.
 *
 * The catalog (`@earendil-works/pi-ai`, the same one `dsh-llm-pi-ai` serves
 * from) ships **41 providers and ~1495 models**, each with
 * `cost: { input, output, cacheRead, cacheWrite }` in USD per 1,000,000 tokens
 * — the unit its own `calculateCost` divides by. Deriving presets from it
 * rather than hardcoding a table means every model the harness can route to is
 * priced out of the box, and the numbers track the installed catalog version.
 *
 * Two things the catalog cannot supply:
 *
 * - **The DeepSeek official routes.** `dsh-llm-deepseek` is a separate adapter
 *   billed in CNY off the vendor's published page, so its rates live here.
 * - **Long-context tiers.** 45 of the 1495 catalog models price a request
 *   differently past a threshold (all 272k today); those are carried through.
 *
 * @module dsh-session-cost/presets
 */
import { getBuiltinModelDataGeneratedAt, getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

/** Every built-in catalog provider prices in USD per 1,000,000 tokens. */
export const CATALOG_CURRENCY = "$";

/** The domestic official card quotes CNY per 1,000,000 tokens. */
export const OFFICIAL_CURRENCY = "¥";

/** The international official card quotes USD per 1,000,000 tokens. */
export const OFFICIAL_CURRENCY_USD = "$";

/**
 * DeepSeek publishes two price lists for the same models, one per platform, and
 * neither is a conversion of the other — the pair for one route sits at ~6.67
 * and the other at ~6.82 CNY per USD, so each card is rounded on its own. A Card
 * is therefore selected, never derived: converting would put a rate in the
 * disclosure that no invoice ever used.
 *
 * Peak is Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00 on both cards;
 * every other hour, plus weekends (and, per the vendor, Chinese public holidays
 * in full — see the holiday note on the fold) is off-peak at half the peak rate.
 * DeepSeek publishes no cache-write rate, so a cached write costs the
 * cache-miss rate.
 */
export const OFFICIAL_CARDS = {
  cny: {
    "deepseek-official/deepseek-flash": {
      currency: OFFICIAL_CURRENCY,
      label: "DeepSeek-V4.1-Flash",
      miss: 1,
      hit: 0.02,
      write: 1,
      out: 4,
      peak: { miss: 2, hit: 0.04, write: 2, out: 8 }
    },
    "deepseek-official/deepseek-v4-pro": {
      currency: OFFICIAL_CURRENCY,
      label: "DeepSeek-V4-Pro-0813",
      miss: 4.5,
      hit: 0.15,
      write: 4.5,
      out: 13.5,
      peak: { miss: 9, hit: 0.3, write: 9, out: 27 }
    }
  },
  usd: {
    "deepseek-official/deepseek-flash": {
      currency: OFFICIAL_CURRENCY_USD,
      label: "DeepSeek-V4.1-Flash",
      miss: 0.15,
      hit: 0.003,
      write: 0.15,
      out: 0.6,
      peak: { miss: 0.3, hit: 0.006, write: 0.3, out: 1.2 }
    },
    "deepseek-official/deepseek-v4-pro": {
      currency: OFFICIAL_CURRENCY_USD,
      label: "DeepSeek-V4-Pro-0813",
      miss: 0.66,
      hit: 0.022,
      write: 0.66,
      out: 1.98,
      peak: { miss: 1.32, hit: 0.044, write: 1.32, out: 3.96 }
    }
  }
};

/**
 * Every provider id that bills these published rates.
 *
 * DeepSeek exposes two ways to reach the same models — `dsh-llm-deepseek` for a
 * configured API key and `dsh-llm-deepseek-account` for a signed-in account — as
 * separate adapters under separate provider ids. A Session names the one that served
 * each request in its route, so pricing only the first left every segment of an
 * account-login Session unpriced, which reads as "no cost data" rather than as a
 * missing price.
 */
export const OFFICIAL_PROVIDERS = ["deepseek-official", "deepseek-account"];
// The same vendor numbers under each of them. Nothing is duplicated, so the two can
// never drift apart.
for (const card of Object.values(OFFICIAL_CARDS)) {
  for (const route of Object.keys(card)) {
    const model = route.slice(route.indexOf("/") + 1);
    for (const provider of OFFICIAL_PROVIDERS) card[`${provider}/${model}`] = card[route];
  }
}

/** The card used when nothing says which platform bills the account. */
export const DEFAULT_OFFICIAL_CARD = "cny";

/**
 * The routes of one official card.
 * @param card - `cny`, `usd`, or anything else for the default card.
 * @returns the card's route table.
 */
export function officialRoutes(card) {
  return OFFICIAL_CARDS[card] ?? OFFICIAL_CARDS[DEFAULT_OFFICIAL_CARD];
}

/**
 * Read the card a caller asked for, allowing a getter.
 *
 * The Host resolves the card late — the wallet currency it detects arrives from
 * an async Platform query — so the resolver must be able to change its answer
 * between two lookups.
 *
 * @param source - a card name, a getter for one, or nothing.
 * @returns the card name to price with.
 */
function cardOf(source) {
  const value = typeof source === "function" ? source() : source;
  return value === "cny" || value === "usd" ? value : DEFAULT_OFFICIAL_CARD;
}

/**
 * Harness routes the catalog knows under another provider id, consulted only
 * after the official table and an exact catalog hit. Forward compatibility: the
 * shipped catalog names no third DeepSeek official model today, so this is
 * inert until one exists — at which point it prices without an update here.
 */
const PROVIDER_ALIASES = {
  "deepseek-official": "deepseek",
  // An account-login model this table does not name still reaches the catalog's
  // twin: the account provider discovers its models from the Platform, so its ids
  // cannot be enumerated here.
  "deepseek-account": "deepseek"
};

/** A non-negative finite number, or 0. */
function rate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** One four-rate set from a catalog cost object. */
function ratesOf(cost) {
  return {
    miss: rate(cost.input),
    hit: rate(cost.cacheRead),
    write: rate(cost.cacheWrite),
    out: rate(cost.output)
  };
}

/** Whether a rate set carries no billing information at all. */
function isUnpriced(rates) {
  return rates.miss === 0 && rates.hit === 0 && rates.write === 0 && rates.out === 0;
}

let cachedCatalog;
let cachedGeneratedAt;

/**
 * Every catalog route's preset, keyed `"<provider>/<model>"`.
 *
 * A broken or absent catalog narrows what is priced; it must never take the
 * pill down, so a throw here yields an empty table and the overrides still
 * apply.
 * @returns the preset table, built once per process.
 */
export function catalogPresets() {
  if (cachedCatalog !== undefined) return cachedCatalog;
  const table = Object.create(null);
  try {
    for (const provider of getBuiltinProviders()) {
      for (const model of getBuiltinModels(provider)) {
        const cost = model.cost ?? {};
        const tiers = Array.isArray(cost.tiers)
          ? cost.tiers
            .filter((tier) => typeof tier.inputTokensAbove === "number")
            .map((tier) => ({ above: tier.inputTokensAbove, ...ratesOf(tier) }))
            .sort((left, right) => left.above - right.above)
          : [];
        table[`${provider}/${model.id}`] = {
          currency: CATALOG_CURRENCY,
          label: typeof model.name === "string" && model.name !== "" ? model.name : model.id,
          ...ratesOf(cost),
          ...(tiers.length === 0 ? {} : { tiers })
        };
      }
    }
  } catch (_catalogUnavailable) {
    // An unreadable catalog leaves the table as far as it got.
  }
  cachedCatalog = table;
  return table;
}

/**
 * The installed catalog's generation timestamp, shown as price provenance.
 * @returns epoch milliseconds, or undefined when the catalog does not say.
 */
export function catalogGeneratedAt() {
  if (cachedGeneratedAt !== undefined) return cachedGeneratedAt;
  try {
    cachedGeneratedAt = getBuiltinModelDataGeneratedAt();
  } catch (_catalogUnavailable) {
    cachedGeneratedAt = undefined;
  }
  return cachedGeneratedAt;
}

/** Normalize one config override entry into the internal preset shape. */
function overrideOf(entry, defaultCurrency) {
  if (entry === null || typeof entry !== "object") return null;
  // Schemastery materializes the nested `peak` field, so an all-zero one is the
  // documented spelling of "this vendor charges one rate all day".
  const declaredPeak = entry.peak !== null && typeof entry.peak === "object" ? entry.peak : null;
  const peak = declaredPeak !== null && !isUnpriced(declaredPeak) ? declaredPeak : null;
  return {
    currency: typeof entry.currency === "string" && entry.currency !== "" ? entry.currency : defaultCurrency,
    label: typeof entry.label === "string" ? entry.label : "",
    miss: rate(entry.miss),
    hit: rate(entry.hit),
    write: rate(entry.write),
    out: rate(entry.out),
    ...(peak === null ? {} : { peak: { miss: rate(peak.miss), hit: rate(peak.hit), write: rate(peak.write), out: rate(peak.out) } })
  };
}

/**
 * Build the resolution used to price one folded attempt.
 *
 * Precedence: a user override keyed `<provider>/<model>`, then one keyed by the
 * bare `<model>`, then the DeepSeek official table, then the catalog for the
 * exact route, then the catalog under the route's alias.
 *
 * @param options - user overrides, the default currency for entries that name none, and an optional catalog table.
 * @returns a resolver from one route to its wire price, or null when nothing prices it.
 */
export function createPriceLookup(options = {}) {
  const overrides = options.overrides !== null && typeof options.overrides === "object" ? options.overrides : {};
  const defaultCurrency = typeof options.defaultCurrency === "string" && options.defaultCurrency !== "" ? options.defaultCurrency : CATALOG_CURRENCY;
  const catalog = options.catalog ?? catalogPresets();
  const prepared = Object.create(null);
  for (const key of Object.keys(overrides)) {
    const entry = overrideOf(overrides[key], defaultCurrency);
    if (entry !== null) prepared[key] = entry;
  }
  return (provider, model) => {
    // Resolved per call, not once: the Host's card arrives from an async
    // Platform query and has to take effect on the next lookup.
    const card = cardOf(options.officialCard);
    if (typeof model !== "string" || model === "") return null;
    const qualified = typeof provider === "string" && provider !== "" ? `${provider}/${model}` : null;
    const routes = qualified === null ? [model] : [qualified, model];
    for (const route of routes) {
      const override = prepared[route];
      if (override !== undefined) return shape(override, "override");
    }
    if (qualified !== null) {
      const official = officialRoutes(card)[qualified];
      if (official !== undefined) return shape(official, "preset");
    }
    if (qualified !== null) {
      const direct = catalog[qualified];
      if (direct !== undefined) return shape(direct, "preset");
      const alias = PROVIDER_ALIASES[provider];
      if (alias !== undefined) {
        const aliased = catalog[`${alias}/${model}`];
        if (aliased !== undefined) return shape(aliased, "preset");
      }
    }
    return null;
  };
}

/**
 * Normalize one resolved preset into the wire price a client prices with.
 * @param entry - a catalog or official preset.
 * @param source - where the price came from, for the disclosure.
 * @returns the wire price.
 */
function shape(entry, source) {
  const base = { miss: rate(entry.miss), hit: rate(entry.hit), write: rate(entry.write), out: rate(entry.out) };
  const declaredPeak = entry.peak === undefined || entry.peak === null ? null : entry.peak;
  const peak = declaredPeak === null || isUnpriced(declaredPeak)
    ? undefined
    : { miss: rate(declaredPeak.miss), hit: rate(declaredPeak.hit), write: rate(declaredPeak.write), out: rate(declaredPeak.out) };
  const tiers = Array.isArray(entry.tiers) && entry.tiers.length > 0
    ? entry.tiers.map((tier) => ({ above: rate(tier.above), miss: rate(tier.miss), hit: rate(tier.hit), write: rate(tier.write), out: rate(tier.out) }))
    : undefined;
  return {
    currency: typeof entry.currency === "string" && entry.currency !== "" ? entry.currency : CATALOG_CURRENCY,
    label: typeof entry.label === "string" ? entry.label : "",
    base,
    ...(peak === undefined ? {} : { peak }),
    ...(tiers === undefined ? {} : { tiers }),
    source
  };
}

/**
 * Every route the preset layers can price, catalog first.
 *
 * The settings page imports a model by the route its picker shows, so the table
 * it reads has to cover both layers: the shipped catalog and the DeepSeek
 * official routes, which the adapter is billed from and which the catalog does
 * not necessarily name.
 *
 * @returns preset route keys in `<provider>/<model>` form.
 */
export function presetRoutes() {
  const routes = Object.keys(catalogPresets());
  for (const card of Object.values(OFFICIAL_CARDS)) {
    for (const route of Object.keys(card)) {
      if (!routes.includes(route)) routes.push(route);
    }
  }
  return routes;
}
