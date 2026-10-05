/**
 * Verification harness for the preset-table chunk the Host half hands the
 * settings page.
 *
 * These checks pin the contract between the two halves: the table has to price
 * exactly what the Session fold would charge, the generated source has to be a
 * chunk the module system accepts and can evaluate, and writing it twice must
 * not churn the file — or the client entry's revision, which is what keys the
 * chunk's browser cache.
 *
 *   node test/rates-chunk.test.mjs
 */
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { CATALOG_CURRENCY, OFFICIAL_CURRENCY, createPriceLookup } from "../lib/presets.js";
import { CHUNK_FILE, RATE_FIELDS, materializeRatesChunk, presetTable, ratesChunkSource } from "../lib/rates-chunk.js";

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

/** Load one generated chunk the way the browser does, returning its exports. */
function evaluate(source) {
	let registration;
	const sandbox = { window: { __ModuleLoader__: { load: (record) => { registration = record; } } } };
	runInNewContext(source, sandbox);
	return { registration, exports: registration.factory(() => ({})) };
}
/** A scratch `lib/` holding a stand-in client entry whose metadata carries the revision. */
function scratch() {
	const directory = mkdtempSync(join(tmpdir(), "session-cost-rates-"));
	writeFileSync(join(directory, "client.js"), "// client entry\n");
	const past = new Date(Date.now() - 60_000);
	utimesSync(join(directory, "client.js"), past, past);
	return directory;
}

// ── the table ────────────────────────────────────────────────────────────────
const table = presetTable();
const routes = Object.keys(table);
const lookup = createPriceLookup({ overrides: {} });

check("the table covers the whole catalog plus the official routes", routes.length > 1000, true);
check("its keys are the routes the picker shows", routes.every((route) => route.includes("/")), true);
check("every tuple carries a currency and eight rates", routes.every((route) => table[route].length === 1 + RATE_FIELDS.length * 2), true);
check("every rate is a finite number", routes.every((route) => table[route].slice(1).every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)), true);

// The table is a lookup through the same resolution the fold uses, so a
// pre-filled row starts from what the plugin would have charged.
checkJson("an official route carries its CNY rates", table["deepseek-official/deepseek-flash"], [OFFICIAL_CURRENCY, 1, 0.02, 1, 4, 2, 0.04, 2, 8]);
checkJson("an official route carries its peak window", table["deepseek-official/deepseek-v4-pro"], [OFFICIAL_CURRENCY, 4.5, 0.15, 4.5, 13.5, 9, 0.3, 9, 27]);
const CATALOG_ROUTE = "anthropic/claude-fable-5";
checkJson("a catalog route carries its USD rates", table[CATALOG_ROUTE], [CATALOG_CURRENCY, 10, 1, 12.5, 50, 0, 0, 0, 0]);
check("a catalog route has no peak window", table[CATALOG_ROUTE].slice(5).every((value) => value === 0), true);

// The split is at the first slash: 843 catalog ids contain one of their own.
const MULTI_SLASH = "openrouter/x-ai/grok-4.20";
check("a model id that contains a slash keeps its route", Object.prototype.hasOwnProperty.call(table, MULTI_SLASH), true);
check("and is resolved through the full model id", table[MULTI_SLASH][4], lookup("openrouter", "x-ai/grok-4.20").base.out);

// Every value must agree with the live lookup, not just the sampled ones.
const disagreed = routes.filter((route) => {
	const cut = route.indexOf("/");
	const price = lookup(route.slice(0, cut), route.slice(cut + 1));
	if (price === null) return true;
	const expected = [price.currency, ...RATE_FIELDS.map((field) => price.base[field]), ...RATE_FIELDS.map((field) => (price.peak ?? {})[field] ?? 0)];
	return JSON.stringify(expected) !== JSON.stringify(table[route]);
});
checkJson("every tuple matches the live preset lookup", disagreed, []);
check("an unpriced route is simply absent", Object.prototype.hasOwnProperty.call(table, "nowhere/nothing"), false);
check("the table can be built from a supplied catalog", Object.keys(presetTable({ catalog: {}, routes: [] })).length, 0);

// ── the generated source is a chunk the loader accepts ───────────────────────
const source = ratesChunkSource({ "a/b": ["$", 1, 0, 0, 2, 0, 0, 0, 0] }, { packageName: "dsh-session-cost", generatedAt: 1234 });
const evaluated = evaluate(source);
check("the chunk registers under <package>/<file>", evaluated.registration.id, `dsh-session-cost/${CHUNK_FILE}`);
check("the file name satisfies the loader's client.*.js rule", /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(CHUNK_FILE), true);
checkJson("the chunk exports the routes", evaluated.exports.routes, { "a/b": ["$", 1, 0, 0, 2, 0, 0, 0, 0] });
check("the chunk exports the catalog stamp", evaluated.exports.generatedAt, 1234);
check("an unknown stamp is null rather than NaN", evaluate(ratesChunkSource({}, { packageName: "p" })).exports.generatedAt, null);
check("the source is deterministic", ratesChunkSource({ "a/b": [1] }, { packageName: "p", generatedAt: 7 }), ratesChunkSource({ "a/b": [1] }, { packageName: "p", generatedAt: 7 }));

// ── writing it, and not rewriting it ─────────────────────────────────────────
const directory = scratch();
const owner = join(directory, "client.js");
const before = statSync(owner).mtimeMs;

const first = materializeRatesChunk({ directory, packageName: "dsh-session-cost" });
check("the first write materializes the chunk", first.changed, true);
check("it reports how many routes were priced", first.routes > 1000, true);
check("it records no failure", first.failure, undefined);
check("the chunk lands beside client.js", first.path, join(directory, CHUNK_FILE));
check("the owner's revision is moved so the chunk URL changes", statSync(owner).mtimeMs > before, true);
const written = readFileSync(join(directory, CHUNK_FILE), "utf8");
check("the written file is the generated source", written.startsWith("// Generated by dsh-session-cost"), true);
check("its routes are the table's", Object.keys(evaluate(written).exports.routes).length, routes.length);

const settled = statSync(owner).mtimeMs;
const second = materializeRatesChunk({ directory, packageName: "dsh-session-cost" });
check("an unchanged catalog does not rewrite the chunk", second.changed, false);
check("and does not churn the owner's revision", statSync(owner).mtimeMs, settled);

// A different table has to be written, and has to move the revision again.
const third = materializeRatesChunk({ directory, packageName: "dsh-session-cost", table: { "only/one": ["$", 1, 2, 3, 4, 0, 0, 0, 0] } });
check("a changed table is written", third.changed, true);
check("and moves the owner's revision", statSync(owner).mtimeMs > settled, true);
checkJson("the new table is what landed", evaluate(readFileSync(join(directory, CHUNK_FILE), "utf8")).exports.routes, { "only/one": ["$", 1, 2, 3, 4, 0, 0, 0, 0] });

rmSync(directory, { recursive: true, force: true });

// ── failures degrade, they never throw ───────────────────────────────────────
const missing = materializeRatesChunk({ directory: join(tmpdir(), "session-cost-absent-dir"), packageName: "p" });
check("an unwritable directory reports a failure", typeof missing.failure, "string");
check("and reports nothing written", missing.changed, false);
check("a missing directory is rejected without touching the filesystem", materializeRatesChunk({ packageName: "p" }).failure, "no directory");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
