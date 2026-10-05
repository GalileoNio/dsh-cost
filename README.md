# dsh-session-cost

Adds one pill to the Session's bottom statistics strip — the composer dock that
already shows turn/step counts, tokens per second, token totals, and cache-hit
share — reporting **this Session's cost, priced per segment from the model that
actually served each request**.

```
[time pill] [token pill] [$ pill] [context meter]
```

Clicking the pill opens the breakdown, one section per `(model, rate window)`.

## Install

This is a **bundle**: installing it adds a Loader entry, and the entry is what
carries the plugin, so nothing in the Harness is patched by hand.

```bash
git clone git@github.com:GalileoNio/dsh-cost.git "$HOME/.dsh/profiles/plugins/dsh-session-cost"
```

Then either install from that path on the **Plugins** page, or run the same
operation programmatically with `plugin_manager` `install_bundle` and the
absolute path. The manager adds the package as a profile dependency, appends it
to `dsh.profile.bundles`, and applies it live; uninstalling removes all three.

> **Why that clone location, and how to ignore it.** A plugin is symlinked into
> the profile, and Node resolves an import from the symlink's **real path**, so a
> clone under `~/.dsh/profiles/` reaches the Harness's own `node_modules` for
> `@deepseek-ai/schemastery` and `@earendil-works/pi-ai`. Cloned anywhere else,
> run `npm install` once inside the clone and it becomes location-independent —
> every runtime dependency is declared, so its own `node_modules` satisfies the
> imports. Both flows are verified below.

Its `cordis.patch.yml` inserts the one row over the profile root:

```yaml
- insert:
    - id: session-cost
      name: dsh-session-cost
```

No `config` is written there on purpose: the override table starts empty because
presets cover the catalog, and the settings page writes any override back by
entry id.

> **Plugin source changes need no restart.** `lib/client.js` is re-read from disk
> on every page load, so a client-side change needs only a page refresh. The Host
> half hot-reloads too, through the Harness's own `@deepseek-ai/dsh-hmr`: it clears
> the changed module from Node's ESM and CJS caches, re-imports it, and swaps the
> new exports into the live fiber, rolling back if the new module throws.
>
> It only watches what it is told to, and `dsh-base` ships that entry with
> `root: []` — which is why a Host-side edit used to need a restart. One entry in
> the profile's `cordis.patch.yml` closes the gap:
>
> ```yaml
> - id: hmr
>   name: "@deepseek-ai/dsh-hmr"
>   config:
>     base: /Users/kelonl/.dsh/profiles/plugins
>     root:
>       - .
> ```
>
> The default ignore list still skips `node_modules` inside that directory.

## How the amount is computed

**One fold, on the Host.** The plugin registers a `sessionCost` projection unit
on the session-projection seam, so it sees the **complete durable log** rather
than the paged, compaction-rewritten chat window. Every billed request attempt
is attributed:

| Fact | Source |
|---|---|
| tokens | the attempt's provider usage — `assistant/message.usage`, else the last `usage` chunk embedded in the attempt stream |
| model | the settled `assistant/message`'s `message.source`, falling back to the newest `model/selection` in effect (covers attempts that never assembled a message) |
| rate window | the request's own clock (`step/start`, else the settlement), against the vendor's published peak rule |

The add/replace bookkeeping mirrors the shipped `tokenUsage` unit exactly — a
settlement replaces its `(turn, step)` slot, and `llm/retry-started` closes the
replacement slot so a retried attempt adds rather than replaces — so the sum
over these groups reconciles with `tokenUsage` bucket for bucket. The test suite
asserts that reconciliation against an independent reimplementation.

**Prices are resolved on the Host too.** Each group goes out on the wire with
one already-narrowed four-number rate set: the long-context tier when the
vendor has one, otherwise the peak or base window the settings select. The
browser multiplies and never chooses, so it cannot disagree with the Host about
a price. The only table the browser ever holds is the preset one the Host
generates for the settings page, and that one seeds an edit — it never prices a
displayed amount.

## Where prices come from

**Presets, derived from the Harness's own catalog.** `@earendil-works/pi-ai` —
the catalog `dsh-llm-pi-ai` serves from — ships **41 providers and ~1495
models**, each with `cost: { input, output, cacheRead, cacheWrite }` in USD per
1,000,000 tokens, the unit its own `calculateCost` divides by. Presets are built
from it at startup, so every model the Harness can route to is priced, the
numbers track the installed catalog, and nothing here needs updating when the
catalog changes. Long-context tiers (45 models, all 272k today) are carried
through and applied per request.

**DeepSeek's official routes, in CNY.** `dsh-llm-deepseek` is a separate adapter
billed off the vendor's published page, so its two routes carry real peak and
off-peak rates here.

**Your overrides, on top.** Anything the catalog does not price — a self-hosted
or gateway endpoint, a negotiated discount, a rate you disagree with — goes in
the plugin's settings.

### Maintaining the table

**Plugins (the sidebar entry) → this plugin's card.** No automatic schema form
exists in this build: the Plugins page renders only what a plugin claims for
itself and draws on its own. This one claims two seats, so the same form is
reachable from either:

| Seat | Key | Where it appears |
|---|---|---|
| `plugins.bundle.config` | `dsh-session-cost` | The bundle card's page, between its description and its rows |
| `plugins.row.config` | `dsh-session-cost#session-cost` | The `session-cost` row's page, which also gains a configure control |

Two things about that page cost real debugging time here and are worth knowing:

- **The form is read through bound readers.** `ConfigForm`'s `getSnapshot` and
  `subscribe` are class methods that read `this.store`, and React calls whatever
  it is handed *detached*. Passing `form.getSnapshot` through directly throws
  `Cannot read properties of undefined (reading 'store')` on the first render.
- **A crash is contained and printed.** The slot renderer retires a crashed entry
  from its cell, one-shot, and never puts it back — so without the plugin's own
  error boundary an exception here would make the configuration silently vanish
  and read as "this plugin has no settings".

Every accepted write goes through the `session-cost` settings namespace's
`ConfigForm`, which lands it in the profile patch by entry id. The editor writes
only the fields you actually changed.

Adding a row normally starts from the picker. **Import a configured model** lists
every route the Host currently reports grouped by provider, straight from
`remote.session.modelCatalog()` — which is why a provider you configured in
Settings → Models shows up here without typing its `provider/model` key. Picking
one pre-fills the key *and* the display name, leaving only the rates; routes that
already carry an override are retired in the list. If the catalog cannot be read
the control says so, and manual entry still works.

The default currency is a select of the common symbols with a Custom… escape
hatch for anything else. It applies to every override that names no symbol of its
own; presets keep theirs (the catalog is `$`, DeepSeek official is `¥`).

### Where those preset rates come from

Importing fills in the rates too, from the same presets the Session fold charges
with. The browser cannot read that catalog itself — `@earendil-works/pi-ai` is a
Host dependency, and the plugin-visible wires do not carry a table this size (a
Session-projection baseline re-sends every value on every frame and for every
listed Session; a custom Remote namespace needs generated Typert contributions,
which only the assembly can add).

So the Host half materializes it as a **package-local client chunk**:
`lib/client.rates.js`, ~1500 routes as compact rate tuples, fetched with
`require.async("./client.rates.js")` the first time a settings page opens.
Nothing on the Session path pays for it, and an install the Host cannot write to
simply has no pre-filled table — the page says so and you type the rates.

The chunk is a generated artifact: gitignored, written at startup, and rewritten
only when the table changes. Its URL carries the *client entry's* artifact
revision, so a rewrite also moves `lib/client.js`'s filesystem metadata — the same
signal the client-HMR watcher already reads as "this bundle was rebuilt".

| Field | Meaning |
|---|---|
| `enabled` | Render the pill at all. Off registers no projection, so no key reaches the browser. |
| `period` | `auto` charges each segment the window it fell in; `peak` / `offpeak` re-price every segment into one window. |
| `currency` | Symbol for overrides that name none. Presets carry their own: the catalog is `$`, DeepSeek official is `¥`. Each option in this list names its currency in the interface's language — `¥ 人民币`, `¥ Chinese yuan` — because a symbol alone is ambiguous: `kr` is the crown of three countries. |
| `prices` | The override table, keyed `<provider>/<model>` or bare `<model>`; a qualified key wins. |

Each override needs all four base rates. `peak` cannot be omitted — Schemastery
resolves a nested object through its required members, so **all-zero peak rates
are the spelling of "this route charges one rate all day"**, which is also what
the preset table means by them.

```yaml
prices:
  my-gateway/qwen3-32b:
    label: My Qwen
    miss: 0.2
    hit: 0.02
    write: 0.2
    out: 0.4
```

### Currencies are never converted — unless you ask for one figure

Every total stays in the currency its vendor billed: a session that used both a
yuan-billed and a dollar-billed model shows `¥7.12 + $1.00`, and the dialog lists
them separately. Segment rows are never converted.

You can opt into a single figure, which sits at the right-hand end of the tray's
title line:

| Setting | Meaning |
|---|---|
| `displayCurrency` | The currency that figure is expressed in. Empty — the default — shows no figure at all. |
| `fxRates` | Your own rates, e.g. `{"¥": 0.1467}`. Optional: they outrank every other source. |

**Restore defaults** clears the whole user layer — price list, currencies, rate
table and price overrides — returning the namespace to the Host's own defaults. It
is disabled while nothing is overridden, and confirms first, because it discards
the override table.

The dock pill and the tray's title carry **one value**, from one function: the
converted figure when a summary currency is configured, and the billed totals when
it is not. So there is always a number to read next to "Session cost", and the two
places never disagree. The itemised totals below the title stay per currency either
way.

Which currency that value is expressed in — and the rates you enter — are read
from the settings mirror **in the browser**, so switching either shows up at once.
A projection is recomposed on session events alone and the registry offers no way
to force one, so a target currency resolved on the Host would sit stale until the
next event; the wire publishes the reference *data* and the browser resolves it.

Price settings are different, and unavoidably so: which rate applies to a segment
is the Host's fold, and that is the one place a session's cost is computed. Change
the rate window or a price and it takes effect on that session's next event —
still without a restart, and without a reload.

Rates come from three places, in this order:

1. **`fxRates`** — what you entered. Nothing outranks it, so a rate typed by hand
   is never quietly "corrected" by a fetch.
2. **The ECB daily reference feed**, read once per process the first time a
   figure needs it. EUR-based, no key, and the request carries no user data.
3. **A dated snapshot** of that same feed, shipped with the plugin, which stands
   in when the feed is unreachable — so choosing a currency still produces a
   figure offline.

Three rules keep the figure honest. No rate here is invented: every published
number is the ECB's, and the snapshot carries `BUILTIN_AS_OF` with it. A currency
no source identifies — `kr` names three different crowns, and `₽` is unpublished —
**withholds the figure entirely** rather than converting part of the total, which
would be a number no rate produced; the tray then names the currency it could not
rate. And the figure names its source on hover (a glyph beside the number was
tried and removed: it was noise on every reading, and the tray says 「合计（下限）」
in words where the detail belongs)
("reference rates (ECB 2026-10-02)", "the rates you entered"), so it can never be
read as a billed amount — the per-currency totals beneath it stay the source of
truth. Only the policy travels to the browser; the multiplication happens next to
the totals that already exist, so there is exactly one implementation of what a
session costs.

That is also why the DeepSeek official routes carry a **price-list choice**
rather than one price. The vendor publishes one list per platform — CNY on the
domestic one, USD on the international one — and the two are rounded
independently (one route's pair sits at ~6.67 CNY per USD, the other's at ~6.82),
so neither is a conversion of the other. `officialRates` picks one:

| Value | Behaviour |
|---|---|
| `auto` (default) | Reads the wallet currency of the signed-in Platform account (`deepseekAccount.getBalance` → `CNY` / `USD`) and follows it. |
| `cny` | Always the domestic list: ¥1 / ¥2 per 1M cache-miss, ¥0.02 / ¥0.04 cache-hit, ¥4 / ¥8 output. |
| `usd` | Always the international list: $0.15 / $0.30, $0.003 / $0.006, $0.60 / $1.20. |

There is no cheaper signal inside the Harness: the DeepSeek adapter is configured
with a credential reference rather than an endpoint, and both platforms answer on
the same origin, so the wallet is what distinguishes them. `auto` therefore costs
one Platform read, started the first time a price is actually needed and
memoized for the process; a profile without the account plugin — or one whose
account cannot be classified — keeps the domestic list. Pin `cny` or `usd` to
skip the read entirely.

## What it is not

- **List prices, not your bill.** Discounts, promotions, and account-level terms
  are invisible here.
- **No holiday calendar.** The log records no holiday data and a fold must be a
  pure function of the log, so a weekday statutory holiday is classified peak.
  There is deliberately no holiday setting, and no second place that classifies a
  window, so there is nothing for such a setting to keep in step.
- **Unattributed attempts and unpriced routes are disclosed, not hidden.** Either
  makes the total a lower bound: the tray's total reads 「合计（下限）」 and the pill
  says so on hover.

## Verification

Five self-contained harnesses, all runnable with plain `node` and no build:

```
npm test
```

`npm test` runs all five, and each also runs alone:

```
node test/presets.test.mjs      # 64 checks: catalog derivation and precedence
node test/rates-chunk.test.mjs  # 34 checks: the preset table the Host hands the page
node test/fx.test.mjs           # 29 checks: the reference rates behind the converted figure
node test/projection.test.mjs   # 61 checks: the fold and price narrowing
node test/bundle.test.mjs       # 205 checks: the browser half, the tray and its settings page
node test/config.test.mjs       # 78 checks: the schema, the live wiring and the billing card
```

Nothing is mocked away that matters: the suites import the real modules and
stub only React and the DOM, so a passing run means the shipped code works.

- `presets.test.mjs` pins the catalog derivation, the CNY official routes, the
  843 catalog ids that themselves contain a slash, and the precedence an
  override wins through.
- `projection.test.mjs` drives the real fold over synthetic committed events —
  attribution precedence, replacement and retry semantics, reference stability,
  a JSON round trip, and a bucket-for-bucket reconciliation against an
  independently reimplemented `tokenUsage` fold — then pins how a price is
  narrowed to one rate set (window, tier threshold, `period` override).
- `bundle.test.mjs` materializes the real `lib/client.js` against stubbed React
  and DOM and drives the real components through a stateful mount: per-segment
  arithmetic, mixed currencies, disclosed incompleteness, the icon's intrinsic
  size and single stroke weight in both mount contexts, and the settings page end to end — the seats it
  claims, the page it draws — fields stacked in the shell's own settings-form
    metrics, the two advanced sections folded — and the fact that each edit writes only the field
  it changed. Its `ConfigForm` stub is a class whose methods read `this.store`,
  so the detached method references React hands to `useSyncExternalStore` fail
  the suite exactly as they fail in the browser, and it folds accepted writes back
  into its section the way the real controller does — without that, a second edit
  would keep restating fields the draft still disagreed with.
- `rates-chunk.test.mjs` pins the table against the live preset lookup route by
  route, evaluates the generated source the way the browser does, and proves the
  writer is idempotent: an unchanged catalog must not rewrite the file or move the
  client entry's revision, which is what keys the chunk's browser cache.
- `config.test.mjs` checks schema defaults and rejections, the `.volatile()`
  markers the settings page depends on, and then drives the definition `apply`
  actually registers — the only place the schema, the presets, and the fold meet.

## License

MIT — see [LICENSE](LICENSE).
