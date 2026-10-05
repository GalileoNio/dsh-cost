window.__ModuleLoader__.load({
	id: "dsh-session-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_dom = require("react-dom");
		/**
		* The shell's own UI primitives. The dock's other pills build their tray
		* from these — `useAnchoredPosition` for the placement clamp,
		* `useDismissOnOutsidePointer` for the outside close, and
		* `useAnchoredMaxHeight` for the viewport fit — so the tray behaves and
		* measures exactly as theirs does instead of re-deriving each rule here.
		*/
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = react.createElement;
		//#region dictionary and styles
		/** Dictionary namespace owned by this plugin; must equal the profile entry id. */
		const NS = "session-cost";
		/** Composer-dock list that already carries the session's time and token pills. */
		const SLOT = "conversation.composer.dock";
		/** The Host fold this plugin registers; absent while the Host half serves nothing. */
		const PROJECTION = "sessionCost";
		/**
		* This package's name. The Plugins page keys a bundle's own configuration
		* seat by it, and keys a single patch row's seat as `<package>#<row id>`.
		*/
		const PACKAGE = "dsh-session-cost";
		/** The Host-generated chunk carrying the preset table; see `lib/rates-chunk.js`. */
		const RATES_CHUNK = "./client.rates.js";
		/**
		* The preset table, loaded once and only when a settings page asks for it.
		*
		* The Host half writes this chunk from the installed model catalog, because
		* the browser cannot read that catalog and no plugin-visible wire carries a
		* table its size. Loading is best-effort: an install the Host could not
		* write to, or an older chunk that is not there, leaves `null` and the
		* import flow falls back to filling in the key alone.
		*
		* @returns a promise for `route -> [currency, miss, hit, write, out, ...peak]`, or null.
		*/
		let ratesPromise;
		function loadRates() {
			if (ratesPromise === undefined) {
				const request = typeof require.async === "function" ? require.async(RATES_CHUNK) : null;
				ratesPromise = request === null
					? Promise.resolve(null)
					: Promise.resolve(request).then((chunk) => chunk !== null && typeof chunk === "object" && chunk.routes !== null && typeof chunk.routes === "object" ? chunk.routes : null, () => null);
			}
			return ratesPromise;
		}
		/** Plugins-page seat rendering a bundle's configuration on the bundle's page. */
		const BUNDLE_SEAT = "plugins.bundle.config";
		/** Plugins-page seat rendering one patch row's configuration, keyed `<package>#<row id>`. */
		const ROW_SEAT = "plugins.row.config";
		/** Stable no-op subscription, so a missing settings form still calls the hooks it always calls. */
		const NOOP_SUBSCRIBE = () => () => {};
		/** Stable empty read for the same reason. */
		const EMPTY_SNAPSHOT = () => void 0;
		/** Symbols the default-currency select offers; anything else is typed. */
		const CURRENCY_CHOICES = ["¥", "$", "€", "£", "₩", "₹", "₽", "₺", "R$", "A$", "C$", "HK$", "NT$", "S$", "CHF", "kr"];
		/** The select's escape hatch: a sentinel no real symbol can equal. */
		const CURRENCY_CUSTOM = "\u0000custom";
		/**
		* Bound readers for one settings form, memoized per form.
		*
		* `ConfigForm`'s methods are class methods that read `this.store`, and
		* React calls whatever it is handed detached — `getSnapshot()` with no
		* receiver — so passing `form.getSnapshot` through directly throws
		* "Cannot read properties of undefined (reading 'store')" on the first
		* render. Wrapping costs one arrow and keeps the identity stable across
		* renders, which `useSyncExternalStore` also requires.
		*/
		const FORM_ACCESS = new WeakMap();
		function formAccess(form) {
			let access = FORM_ACCESS.get(form);
			if (access === undefined) {
				access = {
					subscribe: (listener) => form.subscribe(listener),
					getSnapshot: () => form.getSnapshot()
				};
				FORM_ACCESS.set(form, access);
			}
			return access;
		}
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"pill.aria": "本会话花费",
			"dialog.title": "本会话花费",
			"dialog.period.peak": "高峰时段",
			"dialog.period.offpeak": "空闲时段",
			"dialog.source.preset": "预设价",
			"dialog.source.override": "自定义价",
			"dialog.attempts": "{count} 次请求",
			"dialog.cacheMiss": "输入（缓存未命中）",
			"dialog.cacheHit": "输入（缓存命中）",
			"dialog.cacheWrite": "输入（缓存写入）",
			"dialog.output": "输出",
			"dialog.total": "合计",
			"dialog.total.estimate": "合计（下限）",
			"dialog.note.unattributed": "另有 {count} 次请求未记录模型，未计入。",
			"dialog.note.unpriced": "{models} 未定价，未计入。",
			"settings.summary": "价格覆盖：{count} 项",
			"settings.basis": "预设价来自 harness 自带模型目录；花费按每段实际模型与计价时段计算。",
			"settings.enabled": "启用花费胶囊",
			"settings.period": "计价时段",
			"settings.period.auto": "按每段实际时段",
			"settings.period.peak": "全部按高峰",
			"settings.period.offpeak": "全部按空闲",
			"settings.currency": "默认币种符号",
			"settings.officialRates": "DeepSeek 官方价目",
			"settings.officialRates.auto": "自动（跟随账号钱包）",
			"settings.officialRates.cny": "人民币价目（¥）",
			"settings.officialRates.usd": "美元价目（$）",
			"settings.officialRates.hint": "官方对国内与国际平台分别公布价目，两者互不换算；自动模式读取已登录账号的钱包币种，读不到时用人民币价目。",
			"settings.currency.hint": "覆盖项里没单独填币种的，都用这个符号。",
			"settings.currency.custom": "自定义…",
			"settings.displayCurrency": "折算显示币种",
			"settings.displayCurrency.off": "不折算（各币种分别显示）",
			"settings.displayCurrency.hint": "首行右侧的合计按这个币种折算；合计行始终保持各币种原值。",
			"settings.fx": "汇率表",
			"settings.fx.hint": "1 单位左侧币种 = 右侧数量的折算币种。插件不联网获取汇率、也不会替你猜：某个币种没填，折算值整行不显示。",
			"settings.fx.add": "添加汇率",
			"settings.fx.currency": "币种",
			"settings.fx.rate": "折算率",
			"settings.fx.remove": "删除这条汇率",
			"dialog.summary.converted": "按你输入的汇率折算{lower}",
			"dialog.summary.lower": "，且为下限",
			"settings.import": "从已配置的模型导入",
			"settings.import.placeholder": "选择一个模型…",
			"settings.import.loading": "读取模型目录…",
			"settings.import.empty": "没有可导入的模型",
			"settings.import.added": "已添加",
			"settings.import.add": "导入",
			"settings.import.failed": "读不到模型目录，可以先手动添加。",
			"settings.import.prefill": "导入会带上当前预设价（{count} 条已定价）。",
			"settings.import.noprefill": "预设价不可用，导入只填键名和显示名。",
			"settings.manual": "手动添加空白覆盖",
			"settings.prices": "价格覆盖",
			"settings.prices.hint": "目录已覆盖 41 家提供商；这里只填需要覆盖或新增的模型。键写 `provider/model` 或 `model`，限定键优先。",
			"settings.prices.empty": "暂无覆盖，全部使用预设价。",
			"settings.column.key": "模型键",
			"settings.column.currency": "币种",
			"settings.column.label": "显示名",
			"settings.column.miss": "未命中",
			"settings.column.hit": "命中",
			"settings.column.write": "写入",
			"settings.column.out": "输出",
			"settings.peak": "高峰（留空＝全天同价）",
			"settings.add": "添加覆盖",
			"settings.remove": "删除这条覆盖",
			"settings.save": "保存",
			"settings.loading": "读取设置…",
			"settings.unavailable": "设置暂不可用：Host 未提供 session-cost 命名空间。",
			"settings.status.idle": "",
			"settings.status.saving": "保存中…",
			"settings.status.saved": "已保存",
			"settings.status.failed": "保存失败"
		};
		/** English dictionary, kept complete against the zh key set. */
		const en = {
			"pill.aria": "Session cost",
			"dialog.title": "Session cost",
			"dialog.period.peak": "Peak hours",
			"dialog.period.offpeak": "Off-peak hours",
			"dialog.source.preset": "preset",
			"dialog.source.override": "custom",
			"dialog.attempts": "{count} request(s)",
			"dialog.cacheMiss": "Input (cache miss)",
			"dialog.cacheHit": "Input (cache hit)",
			"dialog.cacheWrite": "Input (cache write)",
			"dialog.output": "Output",
			"dialog.total": "Total",
			"dialog.total.estimate": "Total (lower bound)",
			"dialog.note.unattributed": "{count} more request(s) recorded no model and are excluded.",
			"dialog.note.unpriced": "{models} has no price and is excluded.",
			"settings.summary": "Price overrides: {count}",
			"settings.basis": "Presets come from the harness model catalog; cost is priced per segment from the model and window each request fell in.",
			"settings.enabled": "Show the cost pill",
			"settings.period": "Rate window",
			"settings.period.auto": "Each segment's own window",
			"settings.period.peak": "Everything at peak",
			"settings.period.offpeak": "Everything off-peak",
			"settings.currency": "Default currency symbol",
			"settings.officialRates": "DeepSeek official price list",
			"settings.officialRates.auto": "Automatic (follow the account wallet)",
			"settings.officialRates.cny": "CNY list (¥)",
			"settings.officialRates.usd": "USD list ($)",
			"settings.officialRates.hint": "DeepSeek publishes one list per platform and neither is a conversion of the other. Automatic reads the signed-in account's wallet currency, and falls back to the CNY list when it cannot.",
			"settings.currency.hint": "Used by every override that names no symbol of its own.",
			"settings.currency.custom": "Custom…",
			"settings.displayCurrency": "Summary currency",
			"settings.displayCurrency.off": "No conversion (each currency as billed)",
			"settings.displayCurrency.hint": "The figure beside the title converts into this currency; the totals keep each currency as billed.",
			"settings.fx": "Exchange rates",
			"settings.fx.hint": "One unit of the left-hand currency is worth the right-hand amount of the summary currency. The plugin never fetches a rate or invents one: a currency missing here withholds the figure.",
			"settings.fx.add": "Add a rate",
			"settings.fx.currency": "Currency",
			"settings.fx.rate": "Rate",
			"settings.fx.remove": "Remove this rate",
			"dialog.summary.converted": "Converted at the rates you entered{lower}",
			"dialog.summary.lower": ", and a lower bound",
			"settings.import": "Import a configured model",
			"settings.import.placeholder": "Pick a model…",
			"settings.import.loading": "Reading the model catalog…",
			"settings.import.empty": "No model to import",
			"settings.import.added": "added",
			"settings.import.add": "Import",
			"settings.import.failed": "The model catalog could not be read; add a row by hand instead.",
			"settings.import.prefill": "Import also fills in the current preset rates ({count} priced).",
			"settings.import.noprefill": "Preset rates are unavailable; import fills in the key and display name only.",
			"settings.manual": "Add a blank override",
			"settings.prices": "Price overrides",
			"settings.prices.hint": "The catalog already prices 41 providers; fill in only what you need to override or add. Keys are `provider/model` or `model`, qualified first.",
			"settings.prices.empty": "No overrides — everything uses preset prices.",
			"settings.column.key": "Model key",
			"settings.column.currency": "Currency",
			"settings.column.label": "Display name",
			"settings.column.miss": "Cache miss",
			"settings.column.hit": "Cache hit",
			"settings.column.write": "Cache write",
			"settings.column.out": "Output",
			"settings.peak": "Peak (blank = one rate all day)",
			"settings.add": "Add override",
			"settings.remove": "Remove this override",
			"settings.save": "Save",
			"settings.loading": "Reading settings…",
			"settings.unavailable": "Settings unavailable: the Host serves no session-cost namespace.",
			"settings.status.idle": "",
			"settings.status.saving": "Saving…",
			"settings.status.saved": "Saved",
			"settings.status.failed": "Save failed"
		};
		/** Trace-path prefix shared by every class this plugin injects. */
		const CSS = ".dshCost_root{box-sizing:border-box;min-width:0;max-width:100%;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;display:flex}.dshCost_anchor{min-width:0;display:inline-flex}.dshCost_pill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.dshCost_pill svg,.dshCost_panel svg{flex:none;width:14px;height:14px}.dshCost_pill:hover,.dshCost_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dshCost_label{text-overflow:ellipsis;min-width:0;overflow:hidden}.dshCost_panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;padding:16px;font-size:12px;line-height:18px}.dshCost_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}.dshCost_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}.dshCost_titleValue{font-variant-numeric:tabular-nums}.dshCost_fxRow{align-items:flex-end;gap:10px;display:flex}.dshCost_fxRow .dshCost_field{width:120px}.dshCost_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}.dshCost_sections{flex-direction:column;gap:10px;display:flex}.dshCost_section{flex-direction:column;gap:4px;display:flex}.dshCost_sectionHead{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-weight:500;display:flex}.dshCost_sectionMeta{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:11px}.dshCost_row{grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:0 10px;display:grid}.dshCost_rowLabel{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshCost_rowDetail{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}.dshCost_rowCost{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.dshCost_subtotal{color:var(--dsw-alias-label-secondary);margin-top:2px;font-variant-numeric:tabular-nums;text-align:right}.dshCost_total{justify-content:space-between;gap:16px;margin-top:10px;padding-top:10px;font-weight:500;display:flex;border-top:.5px solid var(--dsw-alias-border-l2)}.dshCost_amounts{font-variant-numeric:tabular-nums;text-align:right}.dshCost_currencyRow{align-items:center;gap:8px;display:flex}.dshCost_currency{width:96px}.dshCost_fieldHint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}.dshCost_import{flex-wrap:wrap;align-items:flex-end;gap:10px;display:flex}.dshCost_note{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px}.dshCost_settings{flex-direction:column;gap:10px;max-width:760px;display:flex}.dshCost_settingsTitle{margin:6px 0 0;font-size:13px;font-weight:500;line-height:20px}.dshCost_settingsHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.dshCost_settingsRow{flex-wrap:wrap;align-items:flex-end;gap:12px;display:flex}.dshCost_check{align-items:center;gap:8px;font-size:13px;display:inline-flex}.dshCost_field{flex-direction:column;gap:4px;min-width:0;display:flex}.dshCost_wide{flex:1;min-width:150px}.dshCost_fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dshCost_input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);height:28px;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none;padding:0 8px}.dshCost_input:focus{border-color:var(--dsw-alias-state-business-primary)}.dshCost_card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);flex-direction:column;gap:8px;padding:10px 12px;display:flex}.dshCost_cardHead{align-items:flex-end;gap:10px;display:flex}.dshCost_cardRates{flex-wrap:wrap;align-items:flex-end;gap:10px;display:flex}.dshCost_cardRates .dshCost_input{width:82px;font-variant-numeric:tabular-nums}.dshCost_peakLabel{color:var(--dsw-alias-label-tertiary);align-self:center;font-size:11px;min-width:110px}.dshCost_remove{border:none;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:var(--dsw-radius-sm);width:28px;height:28px;flex:none;font-size:16px;line-height:1}.dshCost_remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}.dshCost_actions{align-items:center;gap:12px;display:flex}.dshCost_button{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;height:30px;padding:0 14px;font:inherit;font-size:13px}.dshCost_button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshCost_primary{border-color:transparent;background:var(--dsw-alias-button-info-fill);color:#fff}.dshCost_primary:hover{background:var(--dsw-alias-button-info-hover)}.dshCost_primary:disabled{opacity:.5;cursor:default}.dshCost_status{color:var(--dsw-alias-label-tertiary);font-size:12px}.dshCost_status[data-state=failed]{color:var(--dsw-alias-state-error-primary)}";
		/** Inject the class sheet once per page, keyed by the same tag protocol shipped plugins use. */
		function injectCss() {
			const tagId = "dsh-session-cost/SessionCostPill.css";
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-cost";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region disclosure
		/** Non-negative finite number, or 0. */
		function num(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
		}
		/** The four token buckets plus the billed-attempt count a wire bucket carries. */
		function bucketOf(value) {
			const source = value !== null && typeof value === "object" ? value : {};
			return {
				uncachedInputTokens: num(source.uncachedInputTokens),
				cacheReadTokens: num(source.cacheReadTokens),
				cacheWriteTokens: num(source.cacheWriteTokens),
				outputTokens: num(source.outputTokens),
				attempts: num(source.attempts)
			};
		}
		/** Total tokens across a bucket's four disjoint members. */
		function bucketTotal(bucket) {
			return bucket.uncachedInputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.outputTokens;
		}
		/** Compact token count: 1234, 12.3k, 1.23M. */
		function formatTokens(value) {
			if (value < 1e3) return String(value);
			if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0)}k`;
			return `${(value / 1e6).toFixed(2)}M`;
		}
		/** Money text with the precision the magnitude deserves. */
		function formatMoney(value, currency) {
			if (!Number.isFinite(value) || value <= 0) return `${currency}0`;
			const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
			return `${currency}${value.toFixed(digits)}`;
		}
		/** The display name a group is disclosed under. */
		function labelOf(group, price) {
			if (price !== null && price !== undefined && typeof price.label === "string" && price.label !== "") return price.label;
			const provider = typeof group.provider === "string" ? group.provider : "";
			const model = typeof group.model === "string" ? group.model : "";
			return provider === "" ? model : `${provider}/${model}`;
		}
		/** The priced rows of one bucket, dropping empty ones. */
		function pricedRows(bucket, rates, currency) {
			return [
				{ key: "dialog.cacheMiss", tokens: bucket.uncachedInputTokens, price: num(rates.miss) },
				{ key: "dialog.cacheHit", tokens: bucket.cacheReadTokens, price: num(rates.hit) },
				{ key: "dialog.cacheWrite", tokens: bucket.cacheWriteTokens, price: num(rates.write) },
				{ key: "dialog.output", tokens: bucket.outputTokens, price: num(rates.out) }
			].filter((row) => row.tokens > 0).map((row) => ({
				key: row.key,
				tokens: row.tokens,
				cost: row.tokens / 1e6 * row.price,
				detail: `${formatTokens(row.tokens)} × ${currency}${row.price}`
			}));
		}
		/**
		* Build the whole disclosure from the Host's fold.
		*
		* Every amount is `tokens × rate` with both sides supplied by the Host —
		* the tokens from the fold over the durable log, the rate already narrowed
		* to the window and long-context tier that applied. Nothing here decides a
		* price, so the browser cannot disagree with the Host about one.
		*
		* @param projected - the `sessionCost` projection value, or undefined.
		* @returns the disclosure, or null when nothing should render.
		*/
		function buildView(projected) {
			if (projected === null || projected === void 0 || typeof projected !== "object") return null;
			const rawGroups = projected.groups;
			if (rawGroups === null || typeof rawGroups !== "object") return null;
			const sections = [];
			const unpriced = [];
			const totals = /* @__PURE__ */ new Map();
			for (const key of Object.keys(rawGroups)) {
				const group = rawGroups[key];
				const bucket = bucketOf(group);
				const price = group.price;
				if (price === null || price === void 0 || typeof price !== "object" || price.rates === null || price.rates === void 0 || typeof price.rates !== "object") {
					if (bucketTotal(bucket) > 0) unpriced.push(labelOf(group, null));
					continue;
				}
				const currency = typeof price.currency === "string" ? price.currency : "";
				const rows = pricedRows(bucket, price.rates, currency);
				if (rows.length === 0) continue;
				const subtotal = rows.reduce((sum, row) => sum + row.cost, 0);
				sections.push({
					key,
					label: labelOf(group, price),
					peak: group.peak === true,
					source: price.source === "override" ? "override" : "preset",
					attempts: bucket.attempts,
					currency,
					rows,
					subtotal
				});
				totals.set(currency, (totals.get(currency) ?? 0) + subtotal);
			}
			if (sections.length === 0) return null;
			const unattributed = bucketOf(projected.unattributed);
			const notes = [];
			if (unattributed.attempts > 0) notes.push({ key: "dialog.note.unattributed", params: { count: unattributed.attempts } });
			if (unpriced.length > 0) notes.push({ key: "dialog.note.unpriced", params: { models: unpriced.join(", ") } });
			const byCurrency = [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
			return {
				sections,
				totals: byCurrency,
				summary: convertedTotal(byCurrency, projected.conversion),
				notes,
				incomplete: unattributed.attempts > 0 || unpriced.length > 0
			};
		}
		/**
		* The tray's one converted figure, or null when it cannot be stated.
		*
		* Only the policy rides the wire — the target currency and the rates the
		* user entered — and the multiplication happens here, next to the totals
		* that already exist, so the plugin keeps exactly one implementation of
		* what a session costs. A currency the table does not rate withholds the
		* figure rather than guessing at it: a partially converted total would be
		* a number no rate ever produced.
		*
		* @param totals - one `{currency, amount}` per currency the session used.
		* @param conversion - the wire's conversion policy, when one is configured.
		* @returns `{currency, amount}`, or null when no figure is honest.
		*/
		function convertedTotal(totals, conversion) {
			if (conversion === null || conversion === void 0 || typeof conversion !== "object") return null;
			const currency = typeof conversion.currency === "string" ? conversion.currency : "";
			const rates = conversion.rates !== null && typeof conversion.rates === "object" ? conversion.rates : null;
			if (currency === "" || rates === null || totals.length === 0) return null;
			let amount = 0;
			for (const total of totals) {
				// The display currency rates itself, so the table only lists the others.
				const rate = total.currency === currency ? 1 : rates[total.currency];
				if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
				amount += total.amount * rate;
			}
			return { currency, amount };
		}
		/** The pill's amount text: one amount per currency, lower-bound marked once. */
		function amountText(view) {
			const amounts = view.totals.map((total) => formatMoney(total.amount, total.currency)).join(" + ");
			return view.incomplete ? `≈${amounts}` : amounts;
		}
		/**
		* A coin mark, drawn inline so the pill owns no icon dependency.
		*
		* The whole mark is drawn at one weight, {@link MARK_STROKE}, because that
		* is what it sits among: the one stroked glyph the platform ships uses 1
		* in this same 16-unit box. The first version drew a 1.5 ring around a
		* 1.2 ¥, which read as a heavy circle with a spindly glyph inside it — a
		* different family from everything beside it.
		*
		* {@link MARK_SIZE} is 14, the width the pill's own sheet carried from the
		* start and the right one: the 15-unit ring draws ~13.1px here, which is
		* what the neighbouring circle-check icon spans. What made the first
		* version read small was never the box — it was the glyph inside it, 4
		* units wide in a 13-unit inner circle. {@link MARK_GLYPH} is now sized for
		* legibility rather than proportion, filling most of that inner diameter,
		* and {@link MARK_RADIUS} 7 is the largest ring that keeps a margin inside
		* the box.
		*
		* The intrinsic `width`/`height` matter twice over: an SVG carrying only a
		* `viewBox` sizes itself to its container, so without them the same element
		* is `MARK_SIZE` inside the pill and the full width of the 360px panel.
		* The class sheet repeats the size per context; this pair is the floor that
		* holds wherever a rule is missing.
		*/
		const MARK_STROKE = 1;
		const MARK_RADIUS = 7;
		const MARK_SIZE = 14;
		/** The ¥ mark, drawn to sit inside {@link MARK_RADIUS}'s inner circle. */
		const MARK_GLYPH = "M5 4.15 8 7.45 11 4.15M5 8.4h6M5 10.4h6M8 7.45v4.6";
		function CoinIcon() {
			return h("svg", {
				viewBox: "0 0 16 16",
				width: MARK_SIZE,
				height: MARK_SIZE,
				fill: "none",
				"aria-hidden": true
			}, h("circle", {
				cx: 8,
				cy: 8,
				r: MARK_RADIUS,
				stroke: "currentColor",
				strokeWidth: MARK_STROKE
			}), h("path", {
				d: MARK_GLYPH,
				stroke: "currentColor",
				strokeWidth: MARK_STROKE,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		//#endregion
		//#region components
		/** Viewport margin the placement clamp keeps, matching the shell's stat tray. */
		const PANEL_MARGIN = 12;
		/** Distance between the trigger's top edge and the panel's bottom. */
		const PANEL_GAP = 8;
		/** Design cap on the tray's height; the primitive clamps it to the viewport. */
		const PANEL_MAX_HEIGHT = 560;
		/**
		* Unplaced portal panel: hidden but laid out, so the clamp's measure pass
		* sees real dimensions instead of collapsing to nothing. Same shape the
		* built-in stat dialog uses.
		*/
		const MEASURE_STYLE = {
			visibility: "hidden",
			left: 0,
			top: 0
		};
		/**
		* The trigger-anchored disclosure. Mounted only while open, so its
		* measurement effects run exactly once per disclosure.
		*/
		function CostPanel({ anchor, open, view, t, onClose }) {
			const panelRef = react.useRef(null);
			const pos = primitives.useAnchoredPosition({
				open,
				anchorRef: anchor,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			// The panel is portaled, so the anchor alone is not "inside": it is passed
			// as the portal the dismiss primitive must treat as part of the popover.
			primitives.useDismissOnOutsidePointer(anchor, open, () => {
				onClose();
			}, panelRef);
			/**
			* The viewport fit is measured from the panel's **placed** bottom edge, so
			* it may only be read once `pos` exists: measured while the panel still
			* sits at the hidden measure position its bottom is the top of the
			* viewport, and the fit collapses the tray to nothing. Passing the
			* placement as the re-measure signal is what re-runs it the moment the
			* panel lands, instead of waiting for the next render or a scroll.
			*/
			const maxHeight = primitives.useAnchoredMaxHeight(panelRef, PANEL_MAX_HEIGHT, pos, PANEL_MARGIN);
			react.useEffect(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [onClose]);
			const sections = view.sections.map((section) => {
				const meta = [
					t(section.peak ? "dialog.period.peak" : "dialog.period.offpeak"),
					t(section.source === "override" ? "dialog.source.override" : "dialog.source.preset")
				];
				if (section.attempts > 0) meta.push(t("dialog.attempts", { count: section.attempts }));
				return h("div", {
					key: section.key,
					className: "dshCost_section",
					"data-session-cost-segment": section.label
				}, h("div", {
					className: "dshCost_sectionHead"
				}, h("span", null, section.label), h("span", {
					className: "dshCost_sectionMeta"
				}, meta.join(" · "))), section.rows.map((row) => h("div", {
					key: row.key,
					className: "dshCost_row"
				}, h("span", {
					className: "dshCost_rowLabel"
				}, t(row.key)), h("span", {
					className: "dshCost_rowDetail"
				}, row.detail), h("span", {
					className: "dshCost_rowCost"
				}, formatMoney(row.cost, section.currency)))), section.rows.length > 1 ? h("div", {
					className: "dshCost_subtotal"
				}, formatMoney(section.subtotal, section.currency)) : null);
			});
			const totals = h("div", {
				className: "dshCost_amounts"
			}, view.totals.map((total) => h("div", {
				key: total.currency
			}, formatMoney(total.amount, total.currency))));
			return react_dom.createPortal(h("div", {
				ref: panelRef,
				role: "dialog",
				"aria-label": t("dialog.title"),
				className: "dshCost_panel",
				"data-session-cost-panel": "",
				// The measure pass must see the tray's natural size: clamping it before
				// placement would make the clamp the thing being measured.
				style: pos === null ? MEASURE_STYLE : {
					...pos,
					maxHeight,
					overflowY: "auto"
				}
			}, h("div", {
				className: "dshCost_title"
			}, h("span", {
				className: "dshCost_titleLabel"
			}, h(CoinIcon), t("dialog.title")), view.summary === null ? null : h("span", {
				className: "dshCost_titleValue",
				title: t("dialog.summary.converted", {
					lower: view.incomplete ? t("dialog.summary.lower") : ""
				})
			}, `≈${formatMoney(view.summary.amount, view.summary.currency)}`)), h("div", {
				className: "dshCost_rule",
				"aria-hidden": true
			}), h("div", {
				className: "dshCost_sections"
			}, sections), h("div", {
				className: "dshCost_total"
			}, h("span", null, t(view.incomplete ? "dialog.total.estimate" : "dialog.total")), totals), view.notes.map((note) => h("div", {
				key: note.key,
				className: "dshCost_note"
			}, t(note.key, note.params)))), document.body);
		}
		/**
		* Composer-dock entry: this Session's cost as one more statistics pill.
		*
		* Renders nothing until the Host serves the fold, which is also how the
		* plugin's `enabled` setting turns the pill off: the Host registers no
		* unit, so no key arrives and nothing renders here.
		*/
		function SessionCostPill({ useProjection, t }) {
			const projected = useProjection(PROJECTION);
			const [open, setOpen] = react.useState(false);
			const anchor = react.useRef(null);
			const close = react.useCallback(() => {
				setOpen(false);
			}, []);
			const view = buildView(projected);
			if (view === null) return null;
			const amount = amountText(view);
			return h("div", {
				className: "dshCost_root",
				"data-session-cost": ""
			}, h("span", {
				className: "dshCost_anchor",
				ref: anchor
			}, h("button", {
				type: "button",
				className: "dshCost_pill",
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				"aria-label": `${t("pill.aria")} ${amount}`,
				title: `${t("pill.aria")} ${amount}`,
				onClick: () => {
					setOpen(!open);
				}
			}, h(CoinIcon), h("span", {
				className: "dshCost_label"
			}, amount))), open ? h(CostPanel, {
				anchor,
				open,
				view,
				t,
				onClose: close
			}) : null);
		}
		//#region settings
		/** One override's editable text state. Numbers stay text while editing. */
		function draftRowFrom(key, entry) {
			const source = entry !== null && typeof entry === "object" ? entry : {};
			const peak = source.peak !== null && typeof source.peak === "object" ? source.peak : {};
			/** Zero renders as an empty box: it is the schema's "no such rate" value. */
			const text = (value) => (typeof value === "number" && Number.isFinite(value) && value !== 0 ? String(value) : "");
			return {
				key,
				currency: typeof source.currency === "string" ? source.currency : "",
				label: typeof source.label === "string" ? source.label : "",
				miss: text(source.miss),
				hit: text(source.hit),
				write: text(source.write),
				out: text(source.out),
				peakMiss: text(peak.miss),
				peakHit: text(peak.hit),
				peakWrite: text(peak.write),
				peakOut: text(peak.out)
			};
		}
		/** The rate table as editable rows. Numbers stay text while editing. */
		function fxRowsFrom(rates) {
			const table = rates !== null && typeof rates === "object" ? rates : {};
			return Object.keys(table).map((currency) => ({
				currency,
				rate: typeof table[currency] === "number" && Number.isFinite(table[currency]) ? String(table[currency]) : ""
			}));
		}
		/** The rate table one draft produces, dropping rows without a currency. */
		function fxRatesOf(rows) {
			const rates = {};
			for (const row of rows) {
				const currency = String(row.currency).trim();
				if (currency === "") continue;
				const rate = Number(String(row.rate).trim());
				// Only a blank or unparsable box is dropped: a stored 0 is the user's
				// own value, and silently deleting it on an untouched save would be a
				// surprise. The conversion is where an unusable rate is refused.
				if (String(row.rate).trim() === "" || !Number.isFinite(rate)) continue;
				rates[currency] = rate;
			}
			return rates;
		}
		/** The symbol a provider's routes are usually billed in; a pre-fill, never a price. */
		const PROVIDER_CURRENCY = {
			dashscope: "¥",
			"dashscope-intl": "$",
			zhipu: "¥",
			zhipuai: "¥",
			moonshotai: "¥",
			"moonshotai-cn": "¥",
			"minimax-cn": "¥",
			minimax: "$",
			siliconflow: "¥",
			volcengine: "¥",
			baichuan: "¥",
			deepseek: "$",
			"deepseek-official": "¥",
			openrouter: "$",
			"vercel-ai-gateway": "$",
			anthropic: "$",
			openai: "$",
			google: "$",
			xai: "$",
			mistral: "$",
			groq: "$"
		};
		/**
		* One preset tuple as the entry shape `draftRowFrom` reads.
		*
		* The chunk stores `[currency, miss, hit, write, out, peakMiss, peakHit,
		* peakWrite, peakOut]` — positional to keep the generated file small — and
		* zero is this schema's "no such rate", which is how a catalog route with
		* no peak window arrives here.
		*/
		function presetEntry(tuple) {
			return {
				currency: tuple[0],
				miss: tuple[1],
				hit: tuple[2],
				write: tuple[3],
				out: tuple[4],
				peak: { miss: tuple[5], hit: tuple[6], write: tuple[7], out: tuple[8] }
			};
		}
		/** The editor's draft for one resolved settings section. */
		function draftFromConfig(value) {
			const prices = value.prices !== null && typeof value.prices === "object" ? value.prices : {};
			return {
				enabled: value.enabled === true,
				period: value.period === "peak" || value.period === "offpeak" ? value.period : "auto",
				officialRates: value.officialRates === "cny" || value.officialRates === "usd" ? value.officialRates : "auto",
				currency: typeof value.currency === "string" ? value.currency : "",
				displayCurrency: typeof value.displayCurrency === "string" ? value.displayCurrency : "",
				fxRows: fxRowsFrom(value.fxRates),
				rows: Object.keys(prices).map((key) => draftRowFrom(key, prices[key]))
			};
		}
		/** A non-negative finite number from one editable box. */
		function numberOf(text) {
			const parsed = Number(String(text).trim());
			return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
		}
		/** The `prices` object one draft produces, dropping unnamed rows. */
		function pricesOf(rows) {
			const prices = {};
			for (const row of rows) {
				const key = row.key.trim();
				if (key === "") continue;
				prices[key] = {
					currency: row.currency.trim(),
					label: row.label.trim(),
					miss: numberOf(row.miss),
					hit: numberOf(row.hit),
					write: numberOf(row.write),
					out: numberOf(row.out),
					peak: {
						miss: numberOf(row.peakMiss),
						hit: numberOf(row.peakHit),
						write: numberOf(row.peakWrite),
						out: numberOf(row.peakOut)
					}
				};
			}
			return prices;
		}
		/** One labelled text input. */
		function Field({ label, value, onChange, wide }) {
			return h("label", {
				className: wide ? "dshCost_field dshCost_wide" : "dshCost_field"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, label), h("input", {
				type: "text",
				className: "dshCost_input",
				value,
				onChange: (event) => onChange(event.target.value)
			}));
		}
		/**
		* This plugin's configuration, on the Plugins page.
		*
		* There is no automatic schema form in this build: the Plugins page renders
		* whatever the owning plugin registers for its seat, so the table is drawn
		* here. Reads and writes go through the namespace's `ConfigForm`, which
		* lands each accepted write in the profile patch by entry id.
		*
		* Registered on two seats: the bundle's own page (keyed by package name, the
		* discoverable one) and the `session-cost` row's page (keyed
		* `<package>#<row id>`), so the form is reachable from either.
		*/
		function SessionCostSettings({ view, settings, t, loadCatalog }) {
			/**
			* Both hook seats stay unconditional: a missing form must degrade to the
			* "unavailable" hint, and choosing the source per render would change the
			* hook order if it ever arrived late. The readers are pre-bound because
			* React calls them detached.
			*/
			const access = settings !== undefined && settings !== null ? formAccess(settings) : null;
			const snapshot = react.useSyncExternalStore(access === null ? NOOP_SUBSCRIBE : access.subscribe, access === null ? EMPTY_SNAPSHOT : access.getSnapshot);
			const value = snapshot !== undefined && snapshot.value !== undefined && typeof snapshot.value === "object" ? snapshot.value : null;
			const [draft, setDraft] = react.useState(null);
			const [status, setStatus] = react.useState("idle");
			const [picked, setPicked] = react.useState("");
			/** null while unread; `{groups, failed}` once settled. */
			const [catalog, setCatalog] = react.useState(null);
			/** null until attempted; false when no chunk arrived; then the preset table. */
			const [presets, setPresets] = react.useState(null);
			react.useEffect(() => {
				if (draft !== null || value === null) return;
				setDraft(draftFromConfig(value));
			}, [draft, value]);
			react.useEffect(() => {
				if (view !== "page" || catalog !== null) return;
				if (typeof loadCatalog !== "function") {
					setCatalog({
						groups: [],
						failed: true
					});
					return;
				}
				let live = true;
				loadCatalog().then((groups) => {
					if (live) setCatalog({
						groups: Array.isArray(groups) ? groups : [],
						failed: false
					});
				}).catch(() => {
					if (live) setCatalog({
						groups: [],
						failed: true
					});
				});
				return () => {
					live = false;
				};
			}, [view, catalog, loadCatalog]);
			// The preset chunk is fetched only by the page that pre-fills from it, so
			// the cost lands on whoever opens the form rather than on every Session.
			react.useEffect(() => {
				if (view !== "page" || presets !== null) return;
				let live = true;
				loadRates().then((routes) => {
					if (live) setPresets(routes === null ? false : routes);
				});
				return () => {
					live = false;
				};
			}, [view, presets]);
			if (view === "summary") {
				const prices = value !== null && value.prices !== null && typeof value.prices === "object" ? value.prices : {};
				return h("span", null, t("settings.summary", { count: Object.keys(prices).length }));
			}
			if (draft === null) {
				const loading = snapshot === void 0 || snapshot.status === "loading";
				return h("p", {
					className: "dshCost_settingsHint"
				}, t(loading ? "settings.loading" : "settings.unavailable"));
			}
			const rows = draft.rows;
			const setRow = (index, patch) => {
				setDraft({
					...draft,
					rows: rows.map((row, at) => (at === index ? { ...row, ...patch } : row))
				});
				setStatus("idle");
			};
			/** Patch one rate row. */
			const setFx = (index, patch) => {
				edit({
					fxRows: draft.fxRows.map((row, at) => (at === index ? { ...row, ...patch } : row))
				});
			};
			const removeRow = (index) => {
				setDraft({ ...draft, rows: rows.filter((_row, at) => at !== index) });
				setStatus("idle");
			};
			const edit = (patch) => {
				setDraft({ ...draft, ...patch });
				setStatus("idle");
			};
			/** Every route already carrying an override, so the picker can retire it. */
			const taken = new Set(rows.map((row) => row.key.trim()));
			/** The routing groups the Host reports, or none while unread or failed. */
			const groups = catalog === null || catalog.failed === true ? [] : catalog.groups;
			/** The display name one route's catalog entry carries, when the picker knows it. */
			const modelNameOf = (route) => {
				for (const group of groups) {
					for (const model of group.models) {
						if (`${group.id}/${model.id}` === route) return typeof model.name === "string" ? model.name : "";
					}
				}
				return "";
			};
			/** Add one picked route as a row, pre-filled with its key, display name, and preset rates. */
			const importRoute = (route) => {
				if (route === "" || taken.has(route)) return;
				const preset = presets !== null && presets !== false && Array.isArray(presets[route]) ? presets[route] : null;
				// A route the presets price already carries its vendor's own symbol; one
				// they do not is custom or self-hosted, and the provider id is the only
				// hint about what it bills in. Still just a pre-fill: the row overrides it.
				const suggested = preset !== null ? "" : PROVIDER_CURRENCY[route.split("/")[0]] ?? "";
				edit({
					rows: [...rows, draftRowFrom(route, {
						label: modelNameOf(route),
						currency: suggested,
						...(preset === null ? {} : presetEntry(preset))
					})]
				});
				setPicked("");
			};
			/** Write only what actually changed, one field at a time. */
			const save = async () => {
				setStatus("saving");
				const next = {
					enabled: draft.enabled,
					period: draft.period,
					officialRates: draft.officialRates,
					currency: draft.currency,
					displayCurrency: draft.displayCurrency,
					fxRates: fxRatesOf(draft.fxRows),
					prices: pricesOf(rows)
				};
				const writes = [];
				if (value.enabled !== next.enabled) writes.push(["enabled", next.enabled]);
				if (value.period !== next.period) writes.push(["period", next.period]);
				// A profile written before this field existed resolves it as absent,
				// which is the schema default; do not spend a write restating it.
				if ((value.officialRates ?? "auto") !== next.officialRates) writes.push(["officialRates", next.officialRates]);
				if (value.currency !== next.currency) writes.push(["currency", next.currency]);
				if ((value.displayCurrency ?? "") !== next.displayCurrency) writes.push(["displayCurrency", next.displayCurrency]);
				if (JSON.stringify(value.fxRates ?? {}) !== JSON.stringify(next.fxRates)) writes.push(["fxRates", next.fxRates]);
				if (JSON.stringify(value.prices ?? {}) !== JSON.stringify(next.prices)) writes.push(["prices", next.prices]);
				try {
					for (const [field, fieldValue] of writes) {
						if (await settings.set(field, fieldValue) !== true) {
							setStatus("failed");
							return;
						}
					}
					setStatus("saved");
				} catch (_writeFailed) {
					setStatus("failed");
				}
			};
			/**
			* One rate input bound to one draft field.
			*
			* `labelKey` is explicit because the dictionary is the source of truth
			* for text: `settings.column.peakMiss` does not exist, and an unknown key
			* silently renders as itself rather than failing, so the peak row reuses
			* the base four labels and names its window once above them.
			*/
			const rate = (row, index, field, labelKey) => h(Field, {
				key: field,
				label: t(labelKey ?? `settings.column.${field}`),
				value: row[field],
				onChange: (text) => setRow(index, { [field]: text })
			});
			const BASE_FIELDS = ["miss", "hit", "write", "out"];
			const PEAK_FIELDS = [["peakMiss", "miss"], ["peakHit", "hit"], ["peakWrite", "write"], ["peakOut", "out"]];
			return h("div", {
				className: "dshCost_settings",
				"data-session-cost-settings": ""
			}, h("p", {
				className: "dshCost_settingsHint"
			}, t("settings.basis")), h("label", {
				className: "dshCost_check"
			}, h("input", {
				type: "checkbox",
				checked: draft.enabled,
				onChange: (event) => edit({ enabled: event.target.checked })
			}), h("span", null, t("settings.enabled"))), h("div", {
				className: "dshCost_settingsRow"
			}, h("label", {
				className: "dshCost_field"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, t("settings.period")), h("select", {
				className: "dshCost_input",
				value: draft.period,
				onChange: (event) => edit({ period: event.target.value })
			}, ["auto", "peak", "offpeak"].map((option) => h("option", {
				key: option,
				value: option
			}, t(`settings.period.${option}`))))), h("div", {
				className: "dshCost_field"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, t("settings.officialRates")), h("select", {
				className: "dshCost_input",
				value: draft.officialRates,
				onChange: (event) => edit({
					officialRates: event.target.value
				})
			}, ["auto", "cny", "usd"].map((option) => h("option", {
				key: option,
				value: option
			}, t(`settings.officialRates.${option}`)))), h("span", {
				className: "dshCost_fieldHint"
			}, t("settings.officialRates.hint"))), h("div", {
				className: "dshCost_field"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, t("settings.currency")), h("div", {
				className: "dshCost_currencyRow"
			}, h("select", {
				className: "dshCost_input",
				"aria-label": t("settings.currency"),
				value: CURRENCY_CHOICES.includes(draft.currency) ? draft.currency : CURRENCY_CUSTOM,
				onChange: (event) => edit({
					currency: event.target.value === CURRENCY_CUSTOM ? "" : event.target.value
				})
			}, CURRENCY_CHOICES.map((symbol) => h("option", {
				key: symbol,
				value: symbol
			}, symbol)), h("option", {
				value: CURRENCY_CUSTOM
			}, t("settings.currency.custom"))), CURRENCY_CHOICES.includes(draft.currency) ? null : h("input", {
				type: "text",
				className: "dshCost_input dshCost_currency",
				"aria-label": t("settings.currency.custom"),
				placeholder: t("settings.currency.custom"),
				value: draft.currency,
				onChange: (event) => edit({ currency: event.target.value })
			})), h("span", {
				className: "dshCost_fieldHint"
			}, t("settings.currency.hint"))), h("div", {
				className: "dshCost_field"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, t("settings.displayCurrency")), h("div", {
				className: "dshCost_currencyRow"
			}, h("select", {
				className: "dshCost_input",
				"aria-label": t("settings.displayCurrency"),
				value: CURRENCY_CHOICES.includes(draft.displayCurrency) || draft.displayCurrency === "" ? draft.displayCurrency : CURRENCY_CUSTOM,
				onChange: (event) => edit({
					displayCurrency: event.target.value === CURRENCY_CUSTOM ? "" : event.target.value
				})
			}, h("option", {
				value: ""
			}, t("settings.displayCurrency.off")), CURRENCY_CHOICES.filter((symbol) => symbol !== "").map((symbol) => h("option", {
				key: symbol,
				value: symbol
			}, symbol)), h("option", {
				value: CURRENCY_CUSTOM
			}, t("settings.currency.custom"))), CURRENCY_CHOICES.includes(draft.displayCurrency) || draft.displayCurrency === "" ? null : h("input", {
				type: "text",
				className: "dshCost_input dshCost_currency",
				"aria-label": t("settings.currency.custom"),
				placeholder: t("settings.currency.custom"),
				value: draft.displayCurrency,
				onChange: (event) => edit({ displayCurrency: event.target.value })
			})), h("span", {
				className: "dshCost_fieldHint"
			}, t("settings.displayCurrency.hint")))), h("h4", {
				className: "dshCost_settingsTitle"
			}, t("settings.fx")), h("p", {
				className: "dshCost_settingsHint"
			}, t("settings.fx.hint")), draft.fxRows.map((row, index) => h("div", {
				key: `fx-${index}`,
				className: "dshCost_fxRow",
				"data-session-cost-rate": row.currency
			}, h(Field, {
				label: t("settings.fx.currency"),
				value: row.currency,
				onChange: (value) => setFx(index, { currency: value })
			}), h(Field, {
				label: t("settings.fx.rate"),
				value: row.rate,
				onChange: (value) => setFx(index, { rate: value })
			}), h("button", {
				type: "button",
				className: "dshCost_remove",
				title: t("settings.fx.remove"),
				"aria-label": t("settings.fx.remove"),
				onClick: () => edit({
					fxRows: draft.fxRows.filter((_row, at) => at !== index)
				})
			}, "×"))), h("div", {
				className: "dshCost_actions"
			}, h("button", {
				type: "button",
				className: "dshCost_button",
				onClick: () => edit({
					fxRows: [...draft.fxRows, { currency: "", rate: "" }]
				})
			}, t("settings.fx.add"))), h("h4", {
				className: "dshCost_settingsTitle"
			}, t("settings.prices")), h("p", {
				className: "dshCost_settingsHint"
			}, t("settings.prices.hint")), h("div", {
				className: "dshCost_import"
			}, h("label", {
				className: "dshCost_field dshCost_wide"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, t("settings.import")), h("select", {
				className: "dshCost_input",
				disabled: groups.length === 0,
				value: picked,
				onChange: (event) => setPicked(event.target.value)
			}, h("option", {
				value: ""
			}, catalog === null ? t("settings.import.loading") : groups.length === 0 ? t("settings.import.empty") : t("settings.import.placeholder")), groups.map((group) => h("optgroup", {
				key: group.id,
				label: group.name === undefined || group.name === "" ? group.id : `${group.name} · ${group.id}`
			}, group.models.map((model) => {
				const route = `${group.id}/${model.id}`;
				return h("option", {
					key: route,
					value: route,
					disabled: taken.has(route)
				}, taken.has(route) ? `${model.name} — ${t("settings.import.added")}` : model.name);
			}))))), h("button", {
				type: "button",
				className: "dshCost_button",
				disabled: picked === "",
				onClick: () => importRoute(picked)
			}, t("settings.import.add")), h("button", {
				type: "button",
				className: "dshCost_button",
				onClick: () => edit({
					rows: [...rows, draftRowFrom("", {})]
				})
			}, t("settings.manual")), catalog !== null && catalog.failed === true ? h("p", {
				className: "dshCost_settingsHint"
			}, t("settings.import.failed")) : null, presets === false ? h("p", {
				className: "dshCost_settingsHint",
				"data-session-cost-prefill": "unavailable"
			}, t("settings.import.noprefill")) : null, presets !== null && presets !== false ? h("p", {
				className: "dshCost_settingsHint",
				"data-session-cost-prefill": "ready"
			}, t("settings.import.prefill", {
				count: Object.keys(presets).length
			})) : null), rows.length === 0 ? h("p", {
				className: "dshCost_settingsHint"
			}, t("settings.prices.empty")) : rows.map((row, index) => h("div", {
				key: `override-${index}`,
				className: "dshCost_card",
				"data-session-cost-override": row.key
			}, h("div", {
				className: "dshCost_cardHead"
			}, h(Field, {
				label: t("settings.column.key"),
				value: row.key,
				wide: true,
				onChange: (text) => setRow(index, { key: text })
			}), h(Field, {
				label: t("settings.column.currency"),
				value: row.currency,
				onChange: (text) => setRow(index, { currency: text })
			}), h(Field, {
				label: t("settings.column.label"),
				value: row.label,
				wide: true,
				onChange: (text) => setRow(index, { label: text })
			}), h("button", {
				type: "button",
				className: "dshCost_remove",
				title: t("settings.remove"),
				"aria-label": t("settings.remove"),
				onClick: () => removeRow(index)
			}, "×")), h("div", {
				className: "dshCost_cardRates"
			}, BASE_FIELDS.map((field) => rate(row, index, field))), h("div", {
				className: "dshCost_cardRates"
			}, h("span", {
				className: "dshCost_peakLabel"
			}, t("settings.peak")), PEAK_FIELDS.map(([field, label]) => rate(row, index, field, `settings.column.${label}`)))))
			, h("div", {
				className: "dshCost_actions"
			}, h("button", {
				type: "button",
				className: "dshCost_button",
				onClick: () => edit({ rows: [...rows, draftRowFrom("", {})] })
			}, t("settings.add")), h("button", {
				type: "button",
				className: "dshCost_button dshCost_primary",
				disabled: status === "saving",
				onClick: () => {
					void save();
				}
			}, t("settings.save")), h("span", {
				className: "dshCost_status",
				"data-state": status,
				role: "status"
			}, t(`settings.status.${status}`))));
		}
		/**
		* Contain a crash in the settings form itself.
		*
		* The slot renderer retires a crashed entry from its cell, one-shot, with
		* no way back short of a reload — so an exception in this form would make
		* the configuration silently unreachable, which is exactly the state that
		* reads as "the plugin has no settings". Catching it here keeps the seat
		* alive and prints the cause, which is also what makes such a report
		* actionable instead of a mystery.
		*/
		class SettingsBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error, info) {
				console.error("session-cost: settings form crashed:", error, info);
			}
			render() {
				if (this.state.error !== null) {
					return h("p", {
						className: "dshCost_settingsHint",
						"data-session-cost-error": ""
					}, `${String(this.state.error?.message ?? this.state.error)}`);
				}
				return this.props.children;
			}
		}
		/** The seat component: the form under its own boundary. */
		function SessionCostSettingsSeat(props) {
			return h(SettingsBoundary, null, h(SessionCostSettings, props));
		}
		//#endregion
		/** Required client services: the slot ledger and this plugin's dictionaries. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: the dictionary, the composer-dock pill, and the
		* configuration the Plugins page renders.
		*
		* The configuration seats are claimed only when the settings service is
		* present, so a deployment without it still mounts the pill rather than
		* failing the whole entry.
		*
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			injectCss();
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "session-cost: dictionaries");
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: NS,
				order: 20,
				locale: NS
			}, SessionCostPill));
			ctx.inject(["configForms"], (scope) => {
				/**
				* The shared face both seats read. The catalog loader is a stable
				* function over a late-bound source, so the seats register whether or
				* not the model-catalog remote is composed, a late arrival still
				* works, and a deployment without it degrades to manual entry.
				*/
				let source = null;
				const face = {
					settings: scope.configForms.get(NS),
					loadCatalog: () => source === null ? Promise.reject(new Error("the session model catalog is unavailable")) : source()
				};
				ctx.inject(["remote", "remote.session"], (scoped) => {
					source = () => scoped.remote.session.modelCatalog().then((catalog) => catalog.groups);
				});
				for (const [seat, key] of [[BUNDLE_SEAT, PACKAGE], [ROW_SEAT, `${PACKAGE}#${NS}`]]) {
					scope.slots.inject(seat, () => scope.slots.register({
						name: seat,
						key,
						locale: NS,
						inject: () => face
					}, SessionCostSettingsSeat));
				}
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
