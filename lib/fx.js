/**
 * Reference exchange rates, for the one figure the tray converts.
 *
 * Two rules shape this module. The plugin never invents a rate — every number
 * here is either published by the European Central Bank or typed by the user —
 * and the user's own table always outranks the reference, so a rate someone
 * enters by hand is never quietly "corrected" by a fetch.
 *
 * @module dsh-session-cost/fx
 */

/** The ECB's daily reference feed: EUR-based, no key, no user data in the request. */
export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** How long one fetch may take before the snapshot stands in for it. */
export const FETCH_TIMEOUT_MS = 5000;

/**
 * A snapshot of {@link ECB_URL}, captured so a conversion still has a rate with
 * no network at all. {@link BUILTIN_2026-10-02} travels with every figure it prices:
 * an undated snapshot would silently rot into a wrong number.
 */
export const BUILTIN_AS_OF = "2026-10-02";

/** Units of each currency per one euro, as published on {@link BUILTIN_2026-10-02}. */
export const BUILTIN_PER_EUR = {
  AUD: 1.6176,
  BRL: 5.8610,
  CAD: 1.5984,
  CHF: 0.9279,
  CNY: 7.5259,
  CZK: 24.470,
  DKK: 7.4736,
  GBP: 0.85033,
  HKD: 8.8084,
  HUF: 369.18,
  IDR: 20149.32,
  ILS: 3.4408,
  INR: 108.1245,
  ISK: 137.00,
  JPY: 176.99,
  KRW: 1513.44,
  MXN: 20.5806,
  MYR: 4.5849,
  NOK: 10.8315,
  NZD: 2.0002,
  PHP: 70.265,
  PLN: 4.3775,
  RON: 5.3488,
  SEK: 11.2900,
  SGD: 1.4366,
  THB: 37.710,
  TRY: 55.1650,
  USD: 1.1225,
  ZAR: 18.7839,};

/**
 * The ISO currency each symbol unambiguously names.
 *
 * The settings offer symbols rather than codes, and a few are shared — `kr` is
 * the crown of three countries — so those stay out of the map and need a rate
 * the user enters. `NT$` and `₽` are mapped but unpublished by the ECB, so they
 * resolve only from a manual rate.
 */
export const SYMBOL_CURRENCY = {
  "€": "EUR",
  "$": "USD",
  "¥": "CNY",
  "£": "GBP",
  "₩": "KRW",
  "₹": "INR",
  "₽": "RUB",
  "₺": "TRY",
  "R$": "BRL",
  "A$": "AUD",
  "C$": "CAD",
  "HK$": "HKD",
  "NT$": "TWD",
  "S$": "SGD",
  CHF: "CHF"
};

/**
 * Units of one currency per euro, with the euro itself defined as one.
 *
 * @param perEur - a table like {@link BUILTIN_PER_EUR}.
 * @param code - an ISO currency code.
 * @returns the rate, or null when the table does not carry that currency.
 */
function perEurOf(perEur, code) {
  if (code === "EUR") return 1;
  const rate = perEur === null || typeof perEur !== "object" ? undefined : perEur[code];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Every rate that table can express against one display currency.
 *
 * @param perEur - a table like {@link BUILTIN_PER_EUR}, or null when unread.
 * @param displayCurrency - the symbol the figure is expressed in.
 * @returns `{symbol: rate}`, where the rate is how many units of the display
 * currency one unit of that symbol is worth. Empty when the display symbol
 * itself cannot be identified.
 */
export function crossRates(perEur, displayCurrency) {
  const mine = perEurOf(perEur, SYMBOL_CURRENCY[displayCurrency]);
  if (mine === null) return {};
  const rates = {};
  for (const symbol of Object.keys(SYMBOL_CURRENCY)) {
    if (symbol === displayCurrency) continue;
    const other = perEurOf(perEur, SYMBOL_CURRENCY[symbol]);
    if (other === null) continue;
    rates[symbol] = mine / other;
  }
  return rates;
}

/**
 * Read the ECB feed.
 *
 * A regex rather than an XML parser: the feed is one flat list of `<Cube>`
 * elements, and a dependency for four attributes would be the larger risk.
 *
 * @param xml - the feed's body.
 * @returns `{asOf, perEur}`, or null when nothing usable was published.
 */
export function parseEcbRates(xml) {
  if (typeof xml !== "string") return null;
  const day = /time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml);
  const perEur = {};
  const cube = /currency=["']([A-Z]{3})["']\s+rate=["']([0-9.]+)["']/g;
  for (let match = cube.exec(xml); match !== null; match = cube.exec(xml)) {
    const rate = Number(match[2]);
    if (Number.isFinite(rate) && rate > 0) perEur[match[1]] = rate;
  }
  return Object.keys(perEur).length === 0 ? null : {
    asOf: day === null ? null : day[1],
    perEur
  };
}

/**
 * Fetch the ECB feed once.
 *
 * Never throws: an unreachable feed is not an error the user has to act on, it
 * is the reason the snapshot exists.
 *
 * @param options - an injectable `fetch` for tests and a timeout override.
 * @returns `{asOf, perEur}`, or null when the feed could not be read.
 */
export async function fetchEcbRates(options = {}) {
  const impl = options.fetchImpl !== undefined ? options.fetchImpl : typeof fetch === "function" ? fetch : null;
  if (impl === null) return null;
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : FETCH_TIMEOUT_MS;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(ECB_URL, {
      headers: {
        accept: "application/xml"
      },
      signal: controller === null ? undefined : controller.signal
    });
    if (response === null || typeof response !== "object" || response.ok !== true || typeof response.text !== "function") return null;
    return parseEcbRates(await response.text());
  } catch (_unreachable) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
