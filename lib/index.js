/**
 * Session-cost pill, node half.
 *
 * Four host-side responsibilities, no more:
 *
 * 1. **The fold.** A `sessionCost` projection unit is registered on the
 *    session-projection seam, so the browser receives per-model,
 *    per-rate-window token buckets folded over the complete durable log. See
 *    `lib/projection.js`.
 * 2. **The prices.** Each folded group is priced on the Host from the
 *    harness's own model catalog, overlaid with the user's overrides, and the
 *    resolved rates ride the wire with the group, so the browser multiplies and
 *    never chooses: it cannot disagree with the Host about a price. See
 *    `lib/presets.js`.
 * 3. **The settings schema.** The exported `Config` is what the Loader
 *    validates this entry's `config` against, and the same schema becomes the
 *    settings namespace named by the profile entry id (`session-cost`), which
 *    is where the override table is maintained.
 * 4. **The preset table for that page.** The settings form pre-fills the rates
 *    of an imported model, and the browser cannot read the harness catalog, so
 *    the Host materializes it as a package-local client chunk. That chunk is
 *    never used to price a displayed amount — only to seed an edit. See
 *    `lib/rates-chunk.js`.
 *
 * @module dsh-session-cost
 */
import z from "@deepseek-ai/schemastery";
import { fileURLToPath } from "node:url";
import { BUILTIN_AS_OF, BUILTIN_PER_EUR, SYMBOL_CURRENCY, fetchEcbRates } from "./fx.js";
import { DEFAULT_OFFICIAL_CARD, createPriceLookup } from "./presets.js";
import { createSessionCostDefinition } from "./projection.js";
import { materializeRatesChunk } from "./rates-chunk.js";

/** Profile entry id; also the settings namespace the browser and the settings page address. */
export const NAMESPACE = "session-cost";

/**
 * This package's name. A package-local client chunk is registered under
 * `<package>/<file>`, which is the id the browser asks for and the Host serves.
 */
const PACKAGE = "dsh-session-cost";

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
  /**
   * Whether a segment label draws the vendor and model family as brand marks
   * instead of spelling them.
   *
   * A label is the catalog's own model name, so its leading words are the vendor
   * and the model family — `Claude Opus 4.5`, `GLM-5.3`, `Anthropic: Claude 3
   * Haiku`. Those words, and the separator that follows each, become the mark;
   * the rest of the name stays text. Only words the label already carries are
   * replaced: a label naming no known brand keeps its full text rather than
   * gaining a mark it never had, and a vendor with no mark keeps its name.
   *
   * Drawing only, exactly like `showSavings`: the browser reads it from the
   * settings mirror, so toggling it needs no session event and no Host restart.
   */
  iconLabels: z.boolean().default(true).volatile(),
  /** `auto` charges each folded segment the window it actually fell in. */
  period: z.union(["auto", "peak", "offpeak"]).default("auto").volatile(),
  /** Symbol for entries that name none. The catalog prices in dollars, the DeepSeek official routes in yuan. */
  currency: z.string().default("$").volatile(),
  /**
   * Whether the tray shows what the session would have cost at list price, with
   * the cache-hit and off-peak discounts put back. The comparison is drawn from
   * the same tokens and rates as the totals themselves, and only when it is asked
   * for: a struck-through number is noise to anyone not looking for it.
   */
  showSavings: z.boolean().default(false).volatile(),
  /**
   * Currency the tray's summary figure converts into. Empty — the default —
   * shows no converted figure at all: every other total stays in the currency
   * its vendor billed, and the plugin converts nothing. The browser reads this
   * and `fxRates` from the settings mirror itself, so switching either is visible
   * at once instead of waiting for the next session event to recompose the view.
   */
  displayCurrency: z.string().default("").volatile(),
  /**
   * How many units of `displayCurrency` one unit of the keyed currency is worth,
   * entered by the user. The plugin never fetches a rate and never invents one:
   * a converted figure carries your numbers, which is exactly why it is marked
   * as a conversion rather than presented as a price.
   */
  fxRates: z.dict(z.number()).default({}).volatile(),
  /**
   * Which DeepSeek price list the two official routes are billed from.
   *
   * DeepSeek publishes one list per platform — CNY on the domestic one, USD on
   * the international one — and neither is a conversion of the other, so the
   * plugin selects a card instead of deriving one. `auto` reads the wallet
   * currency of the signed-in Platform account; anything else pins the card, for
   * an install with no account plugin or an account the read cannot classify.
   */
  officialRates: z.union(["auto", "cny", "usd"]).default("auto").volatile(),
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
 * The card to price the official routes with.
 *
 * @param mode - the configured `officialRates` value.
 * @param detected - the platform's answer, when it gave one.
 * @returns a card name; the domestic card when nothing says otherwise.
 */
export function officialCardOf(mode, detected) {
  if (mode === "cny" || mode === "usd") return mode;
  return detected === "cny" || detected === "usd" ? detected : DEFAULT_OFFICIAL_CARD;
}

/**
 * The wallet currency one balance read reports.
 *
 * The account service answers `null` when signed out and a `failed` outcome when
 * Platform did not answer; both mean "no card signal" rather than an error.
 *
 * @param balance - the account service's balance outcome.
 * @returns `"CNY"`, `"USD"`, or null when no wallet identifies a platform.
 */
export function walletCurrencyOf(balance) {
  if (balance === null || typeof balance !== "object" || balance.status !== "ready" || !Array.isArray(balance.value)) return null;
  const wallet = balance.value.find((entry) => entry !== null && typeof entry === "object" && (entry.currency === "CNY" || entry.currency === "USD"));
  return wallet === undefined ? null : wallet.currency;
}

/** The ECB feed for this process, or null while unread or unreachable. */
let ecbRates = null;
/** Whether the one fetch has been started. */
let ecbRequested = false;
/** Bumped when the feed lands, so a cached composition can tell it is stale. */
let ecbGeneration = 0;

/**
 * Read the reference feed once per process, the first time a figure needs it.
 *
 * Never awaited and never fatal: until it lands — and forever, if the machine is
 * offline — the published snapshot stands in, so the figure exists either way.
 * The generation counter is what makes the composed view recompose afterwards.
 *
 * @param ctx - registrant context, for the one warning an unreachable feed earns.
 */
function ensureEcbRates(ctx) {
  if (ecbRequested) return;
  ecbRequested = true;
  fetchEcbRates().then((rates) => {
    if (rates === null) {
      // Not an error to act on: the snapshot exists precisely for this.
      ctx.logger?.warn?.(`session-cost: reference rates unreachable, using the ${BUILTIN_AS_OF} snapshot`);
      return;
    }
    ecbRates = rates;
    ecbGeneration += 1;
  }).catch((_unreachable) => {});
}

/**
 * The identity the account service wants for one read. The Platform uses it to
 * localize server-authored text, which a balance read never shows, so the values
 * only have to be well-formed.
 */
function accountClient() {
  return {
    version: "1.0.0",
    locale: "en",
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
  };
}

/** The platform's answer for this process, or null while unknown. */
let detectedCard = null;
/** Whether the account service was ever asked; the inject itself runs once. */
let detectionRequested = false;
/** Whether the one read actually started, i.e. the service had arrived. */
let detectionStarted = false;

/**
 * Ask the signed-in Platform account which wallet bills it, once per process.
 *
 * The plugin has no cheaper signal: the DeepSeek adapter is configured with a
 * credential reference, not an endpoint, and both platforms answer on the same
 * origin, so the wallet currency is what distinguishes them. Started lazily —
 * the trigger is the first price lookup, i.e. the moment a card is needed — and
 * read once per process: a later sign-in is picked up by a restart, and the
 * `officialRates` setting pins the card outright for anyone who wants that.
 *
 * @param ctx - registrant context, which may or may not carry the account service.
 * @param onCard - called with the card once the read classifies it.
 */
function detectOfficialCard(ctx, onCard) {
  if (detectionStarted || detectionRequested) return;
  detectionRequested = true;
  // The guard above is on the inject, not on the read: a profile whose account
  // plugin activates after this one still gets its answer, and one without the
  // plugin never spins up a second child scope for the attempt.
  ctx.inject(["deepseekAccount"], (scope) => {
    detectionStarted = true;
    scope.deepseekAccount.getBalance(accountClient()).then((balance) => {
      const currency = walletCurrencyOf(balance);
      if (currency === null) return;
      detectedCard = currency === "USD" ? "usd" : "cny";
      onCard(detectedCard);
    }).catch((_unreadable) => {
      // An unreachable Platform leaves the configured card in place.
    });
  });
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
  const mode = configValue(config?.officialRates, "auto");
  const directory = fileURLToPath(new URL(".", import.meta.url));
  /**
   * The card in effect. Reading it is also what starts the one detection read,
   * so a profile that never prices anything never asks Platform anything, and a
   * card that arrives later takes effect on the next lookup.
   */
  const officialCard = () => {
    if (mode === "auto") detectOfficialCard(ctx, () => materialize());
    return officialCardOf(mode, detectedCard);
  };
  /**
   * Write the settings page's preset table from the current card. Idempotent —
   * only a changed table is written — so re-running it when the detection lands
   * costs one comparison in the common case.
   */
  const materialize = () => {
    const chunk = materializeRatesChunk({
      directory,
      packageName: PACKAGE,
      officialCard: officialCardOf(mode, detectedCard)
    });
    if (chunk.failure !== undefined) {
      // A read-only install simply has no pre-filled table; the page says so.
      ctx.logger?.warn?.(`session-cost: no preset table chunk (${chunk.failure})`);
    }
  };
  // Materialized even when the pill is off: the page stays reachable exactly so
  // that `enabled` can be turned back on.
  materialize();
  if (configValue(config?.enabled, true) === false) return;
  const lookup = createPriceLookup({
    overrides: configValue(config?.prices, undefined),
    defaultCurrency: configValue(config?.currency, undefined),
    officialCard
  });
  /**
   * The reference rates the browser resolves its summary figure from.
   *
   * The euro is defined as one, because the feed is EUR-based and a currency can
   * be the target of its own conversion. Reading this is also what starts the one
   * fetch, so a profile that never opens the tray never asks the network
   * anything; until the feed lands — and forever, offline — the dated snapshot
   * answers instead.
   */
  const reference = () => {
    ensureEcbRates(ctx);
    if (ecbRates !== null) {
      return {
        perEur: {
          EUR: 1,
          ...ecbRates.perEur
        },
        symbols: SYMBOL_CURRENCY,
        asOf: ecbRates.asOf,
        source: "reference"
      };
    }
    return {
      perEur: {
        EUR: 1,
        ...BUILTIN_PER_EUR
      },
      symbols: SYMBOL_CURRENCY,
      asOf: BUILTIN_AS_OF,
      source: "snapshot"
    };
  };
  ctx.sessionProjections.register(createSessionCostDefinition({
    lookup,
    period: configValue(config?.period, "auto"),
    // Both the billing card and the rate table can change an already-composed
    // view, so both belong in the pricing identity the cache keys on.
    priceRevision: () => `${officialCard()}|${ecbGeneration}`,
    reference
  }));
}
