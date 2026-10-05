/**
 * Verification harness for the reference exchange rates behind the tray's one
 * converted figure.
 *
 * Three things have to hold. Nothing here may invent a rate: every published
 * number comes from the European Central Bank, and the snapshot is dated because
 * an undated one would rot into a wrong number. A symbol the plugin cannot
 * identify exactly — `kr` names three currencies — must resolve to nothing
 * rather than to a guess. And an unreachable feed is never an error: it is the
 * reason the snapshot exists.
 *
 *   node test/fx.test.mjs
 */
import {
	BUILTIN_AS_OF,
	BUILTIN_PER_EUR,
	ECB_URL,
	SYMBOL_CURRENCY,
	crossRates,
	fetchEcbRates,
	parseEcbRates
} from "../lib/fx.js";

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
/** Approximate comparison, for rates that are ratios of published numbers. */
function close(label, actual, expected, tolerance = 1e-9) {
	check(label, typeof actual === "number" && Math.abs(actual - expected) < tolerance, true);
}

// ── the feed ─────────────────────────────────────────────────────────────────
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube><Cube time="2026-10-02">
    <Cube currency="USD" rate="1.1225"/>
    <Cube currency="CNY" rate="7.5259"/>
    <Cube currency="GBP" rate="0.85033"/>
    <Cube currency="SEK" rate="11.2900"/>
  </Cube></Cube>
</gesmes:Envelope>`;
const parsed = parseEcbRates(FEED);
check("the feed's date is read", parsed.asOf, "2026-10-02");
check("...and every rate with it", Object.keys(parsed.perEur).length, 4);
check("...as numbers", parsed.perEur.USD, 1.1225);
check("the table is keyed by ISO code, the cross table by the symbol the settings offer", crossRates(parsed.perEur, "£")["$"] !== undefined, true);
check("a body with no rates is not a table", parseEcbRates("<html>nope</html>"), null);
check("...nor is a non-string", parseEcbRates(null), null);
// A malformed or zero rate would silently poison every cross rate, so it is dropped.
check("an unusable rate is dropped", parseEcbRates('<Cube time="2026-10-02"><Cube currency="USD" rate="0"/><Cube currency="CNY" rate="7.5"/></Cube>').perEur.USD, undefined);

// ── cross rates ──────────────────────────────────────────────────────────────
const inPounds = crossRates(BUILTIN_PER_EUR, "£");
close("one dollar in pounds is the reference ratio", inPounds["$"], 0.85033 / 1.1225);
close("one euro in pounds is the reference ratio", inPounds["€"], 0.85033);
check("the display currency is not restated", inPounds["£"], undefined);
check("every identified symbol resolves", Object.keys(inPounds).length, Object.keys(SYMBOL_CURRENCY).length - 1 - 2);
// `kr` is the crown of three countries, so it names no currency to convert; `₽`
// and `NT$` are identified but unpublished by the reference feed.
check("an ambiguous symbol resolves to nothing", JSON.stringify(crossRates(BUILTIN_PER_EUR, "kr")), "{}");
check("...so a figure in it is withheld", crossRates(BUILTIN_PER_EUR, "kr")["¥"], undefined);
check("an identified but unpublished symbol is absent too", inPounds["₽"], undefined);
check("a currency nothing identifies yields no table", JSON.stringify(crossRates(null, "£")), "{}");

// ── the shipped snapshot ─────────────────────────────────────────────────────
check("the snapshot is dated", /^\d{4}-\d{2}-\d{2}$/.test(BUILTIN_AS_OF), true);
check("...with the currencies the ECB publishes", Object.keys(BUILTIN_PER_EUR).length >= 25, true);
check("...all positive and finite", Object.keys(BUILTIN_PER_EUR).every((code) => Number.isFinite(BUILTIN_PER_EUR[code]) && BUILTIN_PER_EUR[code] > 0), true);
// The snapshot has to agree with the feed it was captured from, or a conversion
// made offline would disagree with one made online.
close("the snapshot's pounds per dollar match the feed", inPounds["$"], 0.85033 / 1.1225);
close("...and its yuan per dollar", crossRates(BUILTIN_PER_EUR, "$")["¥"], 1.1225 / 7.5259);

// ── fetching, and every way it can fail ──────────────────────────────────────
const okResponse = { ok: true, text: () => Promise.resolve(FEED) };
const fetched = await fetchEcbRates({ fetchImpl: () => Promise.resolve(okResponse) });
check("a reachable feed is read", fetched.perEur.GBP, 0.85033);
check("the request carries no credentials and no user data", ECB_URL.startsWith("https://www.ecb.europa.eu/"), true);
const calls = [];
await fetchEcbRates({ fetchImpl: (url, options) => { calls.push([url, options]); return Promise.resolve(okResponse); } });
check("...and asks for the feed once", calls.length, 1);
check("...accepting xml", calls[0][1].headers.accept, "application/xml");
check("an HTTP failure is null, not a throw", await fetchEcbRates({ fetchImpl: () => Promise.resolve({ ok: false, text: () => Promise.resolve("") }) }), null);
check("a transport failure is null too", await fetchEcbRates({ fetchImpl: () => Promise.reject(new Error("offline")) }), null);
check("a body without rates is null", await fetchEcbRates({ fetchImpl: () => Promise.resolve({ ok: true, text: () => Promise.resolve("<html/>") }) }), null);
check("a response with no body reader is null", await fetchEcbRates({ fetchImpl: () => Promise.resolve({ ok: true }) }), null);
check("a host with no fetch at all is null", await fetchEcbRates({ fetchImpl: null }), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
