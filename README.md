# dsh-client-ui-session-cost

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
git clone git@github.com:GalileoNio/dsh-cost.git "$HOME/.dsh/profiles/plugins/dsh-cost"
```

Then either install from that path in **Settings → Plugins**, or run the same
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
      name: dsh-client-ui-session-cost
```

No `config` is written there on purpose: the override table starts empty because
presets cover the catalog, and the settings page writes any override back by
entry id.

> **Plugin source changes.** `lib/client.js` is re-read from disk on every page
> load, so a client-side change needs only a page refresh. A change to
> `lib/index.js`, `lib/presets.js`, or `lib/projection.js` needs a Harness
> restart: Node imports a module once per process, and the profile watcher
> follows `cordis.patch.yml`, not a package directory. Installing a *new*
> package loads it fresh, which is why this install took effect without one.

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
a price — and the plugin needs no price table client-side.

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
| `plugins.bundle.config` | `dsh-client-ui-session-cost` | The bundle card's page, between its description and its rows |
| `plugins.row.config` | `dsh-client-ui-session-cost#session-cost` | The `session-cost` row's page, which also gains a configure control |

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

| Field | Meaning |
|---|---|
| `enabled` | Render the pill at all. Off registers no projection, so no key reaches the browser. |
| `period` | `auto` charges each segment the window it fell in; `peak` / `offpeak` re-price every segment into one window. |
| `currency` | Symbol for overrides that name none. Presets carry their own: the catalog is `$`, DeepSeek official is `¥`. |
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

### Currencies are never converted

A session that used both a yuan-billed and a dollar-billed model shows two
totals, `¥7.12 + $1.00`, and the dialog lists them separately. Inventing an
exchange rate would put a number in the disclosure that no vendor ever billed.

## What it is not

- **List prices, not your bill.** Discounts, promotions, and account-level terms
  are invisible here.
- **No holiday calendar.** The log records no holiday data and a fold must be a
  pure function of the log, so a weekday statutory holiday is classified peak.
  There is deliberately no holiday setting: it could only ever affect one of two
  paths, and they must not disagree.
- **Unattributed attempts and unpriced routes are disclosed, not hidden.** Either
  makes the total a lower bound and the pill shows `≈`.

## Verification

Four self-contained harnesses, all runnable with plain `node` and no build:

```
npm test
```

`npm test` runs all four, and each also runs alone:

```
node test/presets.test.mjs      # 49 checks: catalog derivation and precedence
node test/projection.test.mjs   # 61 checks: the fold and price narrowing
node test/bundle.test.mjs       # 72 checks: the browser half and its settings page
node test/config.test.mjs       # 44 checks: the schema and the live wiring
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
  size in both mount contexts, and the settings page end to end — the seats it
  claims, the cards it draws, and the fact that a save writes only what
  changed. Its `ConfigForm` stub is a class whose methods read `this.store`, so
  the detached method references React hands to `useSyncExternalStore` fail the
  suite exactly as they fail in the browser.
- `config.test.mjs` checks schema defaults and rejections, the `.volatile()`
  markers the settings page depends on, and then drives the definition `apply`
  actually registers — the only place the schema, the presets, and the fold meet.

## License

MIT — see [LICENSE](LICENSE).
