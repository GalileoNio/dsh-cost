/**
 * Session-cost pill, node half.
 *
 * Three host-side responsibilities, no more:
 *
 * 1. **The fold.** A `sessionCost` projection unit is registered on the
 *    session-projection seam, so the browser receives per-model,
 *    per-rate-window token buckets folded over the complete durable log. See
 *    `lib/projection.js`.
 * 2. **The prices.** Each folded group is priced on the Host from the
 *    harness's own model catalog, overlaid with the user's overrides, and the
 *    resolved rates ride the wire with the group. The browser therefore needs
 *    no price table of its own and cannot disagree with the Host about one.
 *    See `lib/presets.js`.
 * 3. **The settings schema.** The exported `Config` is what the Loader
 *    validates this entry's `config` against, and the same schema becomes the
 *    settings namespace named by the profile entry id (`session-cost`), which
 *    is where the override table is maintained.
 *
 * @module dsh-session-cost
 */
import z from "@deepseek-ai/schemastery";
import { createPriceLookup } from "./presets.js";
import { createSessionCostDefinition } from "./projection.js";

/** Profile entry id; also the settings namespace the browser and the settings page address. */
export const NAMESPACE = "session-cost";

/** Cordis plugin name. */
export const name = "session-cost";

/** The projection registry is required: without it there is nothing to fold into. */
export const inject = ["sessionProjections"];

/**
 * One four-rate set, in the entry's `currency` per 1,000,000 tokens.
 *
 * Every number is `.required()` on purpose: Schemastery fields are optional by
 * default, and a partially specified entry would otherwise resolve to a silent
 * 0 and understate the Session's cost. An incomplete override is rejected here,
 * loudly, instead.
 */
const Rates = z.object({
  /** Prompt input not served from the provider's cache. */
  miss: z.number().required(),
  /** Prompt input served from the provider's cache. */
  hit: z.number().required(),
  /** Prompt input written into the provider's cache; 0 for a vendor with no separate rate. */
  write: z.number().required(),
  /** Generated output tokens. */
  out: z.number().required()
});

/** All-zero rates, the sentinel for "this vendor has no such window". */
const ZERO_RATES = { miss: 0, hit: 0, write: 0, out: 0 };

/**
 * One user override. Presets cover the harness's whole catalog, so an entry
 * here is only needed for a route the catalog does not price — a self-hosted
 * or gateway endpoint, a negotiated discount, or a catalog rate you disagree
 * with.
 *
 * `peak` cannot be omitted: Schemastery resolves a nested object through its
 * required members, so an absent one is a validation error rather than an
 * undefined field. All-zero peak rates are therefore the documented way to say
 * "this route has no peak window", which is also what the preset table means by
 * them.
 */
const PriceOverride = z.object({
  /** Symbol prefixed to this entry's amounts; empty inherits the plugin's `currency`. */
  currency: z.string().default(""),
  /** Display name shown in the cost dialog; empty shows `<provider>/<model>`. */
  label: z.string().default(""),
  /** Uncached prompt input per 1,000,000 tokens. */
  miss: z.number().required(),
  /** Cached prompt input per 1,000,000 tokens. */
  hit: z.number().required(),
  /** Cache-write prompt input per 1,000,000 tokens. */
  write: z.number().required(),
  /** Output tokens per 1,000,000 tokens. */
  out: z.number().required(),
  /** Peak-window rates; leave all four at 0 when the vendor charges one rate all day. */
  peak: Rates.default(ZERO_RATES)
});

/**
 * Live configuration.
 *
 * Every field is `.volatile()` on purpose. `dsh-settings` exposes only volatile
 * fields to the browser and to the settings page (`describe()` →
 * `volatileForm`); a non-volatile field would resolve on the Host and never
 * reach the surface that maintains it.
 */
export const Config = z.object({
  /** Whether the cost pill renders at all. */
  enabled: z.boolean().default(true).volatile(),
  /** `auto` charges each folded segment the window it actually fell in. */
  period: z.union(["auto", "peak", "offpeak"]).default("auto").volatile(),
  /** Symbol for entries that name none. The catalog prices in dollars, the DeepSeek official routes in yuan. */
  currency: z.string().default("$").volatile(),
  /**
   * Price overrides keyed by `<provider>/<model>` or by bare `<model>`.
   * Presets derived from the harness catalog apply underneath, so this table
   * starts empty and stays small.
   */
  prices: z.dict(PriceOverride).default({}).volatile()
});

/**
 * Read one resolved config field.
 *
 * Schemastery resolves a `.volatile()` field to an accessor handle rather than
 * a plain value, so every read of the resolved config has to unwrap. The plain
 * branch keeps a non-volatile field readable too.
 *
 * @param value - the resolved field, plain or volatile.
 * @param fallback - what to use when the field is absent.
 * @returns the field's value.
 */
function configValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return typeof value.get === "function" ? value.get() : value;
}

/**
 * Register the `sessionCost` unit, pricing each group from the harness catalog
 * overlaid with this entry's overrides. The registration is an effect on this
 * plugin's fiber, so unloading removes the key from every later drive.
 *
 * Disabling the plugin registers nothing rather than publishing an unpriced
 * fold: with no key served the browser renders no pill, and no pricing policy
 * has to be duplicated there to decide it.
 *
 * @param ctx - registrant context carrying the projection registry.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  if (configValue(config?.enabled, true) === false) return;
  const lookup = createPriceLookup({
    overrides: configValue(config?.prices, undefined),
    defaultCurrency: configValue(config?.currency, undefined)
  });
  ctx.sessionProjections.register(createSessionCostDefinition({
    lookup,
    period: configValue(config?.period, "auto")
  }));
}
