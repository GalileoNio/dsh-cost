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

/** The DeepSeek official vendor page quotes CNY per 1,000,000 tokens. */
export const OFFICIAL_CURRENCY = "¥";

/**
 * Routes the harness ships outside the catalog, from DeepSeek's published
 * price list (captured 2026-10-01, CNY per 1,000,000 tokens).
 *
 * Peak is Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00; every other
 * hour, plus weekends, is off-peak at half the peak rate. DeepSeek publishes no
 * cache-write rate, so a cached write costs the cache-miss rate.
 */
const OFFICIAL_ROUTES = {
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
};

/**
 * Harness routes the catalog knows under another provider id, consulted only
 * after the official table and an exact catalog hit. Forward compatibility: the
 * shipped catalog names no third DeepSeek official model today, so this is
 * inert until one exists — at which point it prices without an update here.
 */
const PROVIDER_ALIASES = {
  "deepseek-official": "deepseek"
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
export function isUnpriced(rates) {
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
    if (typeof model !== "string" || model === "") return null;
    const qualified = typeof provider === "string" && provider !== "" ? `${provider}/${model}` : null;
    const routes = qualified === null ? [model] : [qualified, model];
    for (const route of routes) {
      const override = prepared[route];
      if (override !== undefined) return shape(override, "override");
    }
    if (qualified !== null && OFFICIAL_ROUTES[qualified] !== undefined) return shape(OFFICIAL_ROUTES[qualified], "preset");
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
