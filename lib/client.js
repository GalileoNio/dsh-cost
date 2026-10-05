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
			"dialog.note.fx": "汇率表缺少 {currencies} 的汇率，未显示折算合计。",
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
			"settings.currency.hint": "只影响覆盖项里没单独填币种的条目。预设价自带厂商的符号，不受这里影响。",
			"settings.currency.custom": "自定义…",
			"settings.displayCurrency": "折算显示币种",
			"settings.displayCurrency.off": "不折算（各币种分别显示）",
			"settings.displayCurrency.hint": "首行右侧的合计按这个币种折算；合计行始终保持各币种原值。折算值只在下面的汇率表覆盖到会话用到的每个币种时才显示。",
			"settings.fx": "汇率表",
			"settings.fx.hint": "1 单位左侧币种 = 右侧数量的折算币种。插件不联网获取汇率、也不会替你猜：某个币种没填，折算值整行不显示。",
			"settings.fx.add": "添加汇率",
			"settings.fx.currency": "币种",
			"settings.fx.rate": "折算率",
			"settings.fx.remove": "删除这条汇率",
			"dialog.summary.converted": "按{source}折算{lower}",
			"dialog.summary.source.manual": "你输入的汇率",
			"dialog.summary.source.reference": "参考汇率（ECB {asOf}）",
			"dialog.summary.source.snapshot": "内置参考汇率（{asOf}）",
			"dialog.summary.source.mixed": "参考汇率（ECB {asOf}）与你输入的汇率",
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
			"settings.reset": "恢复默认设置",
			"settings.reset.description": "清空全部覆盖：价目、币种、汇率表与价格覆盖都会回到插件默认值。",
			"settings.reset.confirm": "恢复",
			"settings.reset.cancel": "取消",
			"settings.readonly": "设置只读：当前连接把偏好保存在进程内，不会写入 Host。",
			"settings.row.unnamed": "未命名覆盖",
			"settings.currency.inherit": "继承默认符号",
			"settings.column.base": "标准费率",
			"settings.fx.count": "{count} 条汇率",
			"settings.fx.empty": "还没有汇率，先加一行。",
			"settings.prices.count": "{count} 项覆盖",
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
			"dialog.note.fx": "No converted total: the rate table has no rate for {currencies}.",
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
			"settings.currency.hint": "Only overrides that name no symbol of their own. Presets carry their vendor's symbol and ignore this.",
			"settings.currency.custom": "Custom…",
			"settings.displayCurrency": "Summary currency",
			"settings.displayCurrency.off": "No conversion (each currency as billed)",
			"settings.displayCurrency.hint": "The figure beside the title converts into this currency; the totals keep each currency as billed. It appears only once the rate table below covers every currency the session used.",
			"settings.fx": "Exchange rates",
			"settings.fx.hint": "One unit of the left-hand currency is worth the right-hand amount of the summary currency. The plugin never fetches a rate or invents one: a currency missing here withholds the figure.",
			"settings.fx.add": "Add a rate",
			"settings.fx.currency": "Currency",
			"settings.fx.rate": "Rate",
			"settings.fx.remove": "Remove this rate",
			"dialog.summary.converted": "Converted at {source}{lower}",
			"dialog.summary.source.manual": "the rates you entered",
			"dialog.summary.source.reference": "reference rates (ECB {asOf})",
			"dialog.summary.source.snapshot": "built-in reference rates ({asOf})",
			"dialog.summary.source.mixed": "reference rates (ECB {asOf}) and your own",
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
			"settings.reset": "Restore defaults",
			"settings.reset.description": "Clears every override: price list, currencies, rate table and price overrides all return to the plugin's defaults.",
			"settings.reset.confirm": "Restore",
			"settings.reset.cancel": "Cancel",
			"settings.readonly": "Read-only: this connection keeps preferences in-process instead of writing them to the Host.",
			"settings.row.unnamed": "Unnamed override",
			"settings.currency.inherit": "inherits the default",
			"settings.column.base": "Standard rates",
			"settings.fx.count": "{count} rate(s)",
			"settings.fx.empty": "No rates yet — add one below.",
			"settings.prices.count": "{count} override(s)",
			"settings.loading": "Reading settings…",
			"settings.unavailable": "Settings unavailable: the Host serves no session-cost namespace.",
			"settings.status.idle": "",
			"settings.status.saving": "Saving…",
			"settings.status.saved": "Saved",
			"settings.status.failed": "Save failed"
		};
		/** Trace-path prefix shared by every class this plugin injects. */
		const CSS = ".dshCost_root{box-sizing:border-box;min-width:0;max-width:100%;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;display:flex}.dshCost_anchor{min-width:0;display:inline-flex}.dshCost_pill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.dshCost_pill svg,.dshCost_panel svg{flex:none;width:14px;height:14px}.dshCost_pill:hover,.dshCost_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dshCost_label{text-overflow:ellipsis;min-width:0;overflow:hidden}.dshCost_panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;padding:16px;font-size:12px;line-height:18px}.dshCost_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}.dshCost_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}.dshCost_titleValue{font-variant-numeric:tabular-nums}.dshCost_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}.dshCost_sections{flex-direction:column;gap:10px;display:flex}.dshCost_section{flex-direction:column;gap:4px;display:flex}.dshCost_sectionHead{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-weight:500;display:flex}.dshCost_sectionMeta{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:11px}.dshCost_row{grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:0 10px;display:grid}.dshCost_rowLabel{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshCost_rowDetail{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}.dshCost_rowCost{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.dshCost_subtotal{color:var(--dsw-alias-label-secondary);margin-top:2px;font-variant-numeric:tabular-nums;text-align:right}.dshCost_total{justify-content:space-between;gap:16px;margin-top:10px;padding-top:10px;font-weight:500;display:flex;border-top:.5px solid var(--dsw-alias-border-l2)}.dshCost_amounts{font-variant-numeric:tabular-nums;text-align:right}.dshCost_note{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px}.dshCost_form{display:flex;flex-direction:column}.dshCost_notice{margin:0 0 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dshCost_field{display:flex;flex-direction:column;gap:6px;padding:12px 0}.dshCost_field+.dshCost_field{border-top:.5px solid var(--dsw-alias-border-l2)}.dshCost_fieldHead{align-items:center;gap:8px;display:flex}.dshCost_fieldLabel{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}.dshCost_hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dshCost_footer{align-items:center;gap:8px;padding-top:16px;display:flex}.dshCost_status{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dshCost_status[data-state=failed]{color:var(--dsw-alias-label-error)}.dshCost_control{box-sizing:border-box;appearance:none;width:100%;height:34px;padding:0 30px 0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}.dshCost_control:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.dshCost_control:disabled{color:var(--dsw-alias-label-tertiary)}.dshCost_input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}.dshCost_input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.dshCost_input:disabled{color:var(--dsw-alias-label-tertiary)}.dshCost_select{display:flex;align-items:center;position:relative;flex:1;min-width:0}.dshCost_select svg{position:absolute;right:10px;pointer-events:none;color:var(--dsw-alias-label-tertiary)}.dshCost_switch{display:flex;align-items:center}.dshCost_custom{flex:none;width:96px}.dshCost_body{display:flex;flex-direction:column;gap:10px;padding:4px 0 12px}.dshCost_line{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}.dshCost_cell{display:flex;flex-direction:column;gap:4px;min-width:0}.dshCost_cellLabel{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dshCost_cell .dshCost_input,.dshCost_cell .dshCost_control{width:92px}.dshCost_cellName .dshCost_input{width:100%}.dshCost_cellName{flex:1;min-width:180px}.dshCost_rateGroupLabel{align-self:center;min-width:110px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.dshCost_route{padding:2px 0}.dshCost_route+.dshCost_route{border-top:.5px solid var(--dsw-alias-border-l2)}.dshCost_routeMeta{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}";
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
		function buildView(projected, money) {
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
			const byCurrency = [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
			const converted = money === null ? null : convertedTotal(byCurrency, money, projected.reference);
			const summary = converted === null ? null : {
				...converted,
				source: fxSourceKind(byCurrency, money, projected.reference)
			};
			const notes = [];
			if (unattributed.attempts > 0) notes.push({ key: "dialog.note.unattributed", params: { count: unattributed.attempts } });
			if (unpriced.length > 0) notes.push({ key: "dialog.note.unpriced", params: { models: unpriced.join(", ") } });
			// A configured summary that cannot be computed is not a silent nothing:
			// the note names the currency whose rate is missing, which is the only
			// thing the user has to add.
			if (summary === null && money !== null && money.displayCurrency !== "") {
				const unrated = unratedCurrencies(byCurrency, money, projected.reference);
				if (unrated.length > 0) notes.push({ key: "dialog.note.fx", params: { currencies: unrated.join(", ") } });
			}
			return {
				sections,
				totals: byCurrency,
				summary,
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
		function convertedTotal(totals, money, reference) {
			if (money === null || money.displayCurrency === "" || totals.length === 0) return null;
			let amount = 0;
			let asOf = null;
			for (const total of totals) {
				const rated = rateFor(total.currency, money, reference);
				if (rated === null) return null;
				if (rated.source !== null && asOf === null) asOf = reference.asOf ?? null;
				amount += total.amount * rated.rate;
			}
			return {
				currency: money.displayCurrency,
				amount,
				asOf
			};
		}
		/**
		* The rate one currency converts at, and where that rate came from.
		*
		* The one place that decides what counts as a usable rate, so the figure and
		* the note explaining its absence can never disagree. Precedence is the
		* documented one — the user's own table outranks the reference data, and
		* nothing outranks the user's — and it is resolved here, in the browser,
		* because this is the side that sees a settings change the moment it is
		* written. The Host could only offer a resolved policy, and a projection is
		* recomposed on session events alone, so switching the currency would sit
		* stale until the next one.
		*
		* @param currency - a currency the session used.
		* @param money - the two settings this reads: target currency and own rates.
		* @param reference - the wire's published reference rates, when it carries any.
		* @returns `{rate, source}`, or null when no source can rate that currency.
		*/
		function rateFor(currency, money, reference) {
			// The target currency rates itself, so no source has to list it.
			if (currency === money.displayCurrency) return {
				rate: 1,
				source: null
			};
			const own = money.fxRates !== null && typeof money.fxRates === "object" ? money.fxRates[currency] : undefined;
			if (typeof own === "number" && Number.isFinite(own) && own > 0) return {
				rate: own,
				source: "manual"
			};
			if (reference === null || reference === void 0 || typeof reference !== "object") return null;
			const perEur = reference.perEur !== null && typeof reference.perEur === "object" ? reference.perEur : null;
			const symbols = reference.symbols !== null && typeof reference.symbols === "object" ? reference.symbols : null;
			if (perEur === null || symbols === null) return null;
			// 1 unit of `currency` in the target: both expressed in euro.
			const target = perEur[symbols[money.displayCurrency]];
			const source = perEur[symbols[currency]];
			if (typeof target !== "number" || typeof source !== "number" || target <= 0 || source <= 0) return null;
			return {
				rate: target / source,
				source: reference.source === "snapshot" ? "snapshot" : "reference"
			};
		}
		/**
		* What the figure's rates were, among the currencies it actually used.
		*
		* One kind when every rate came from the same place, `mixed` when the user's
		* own table and the reference data both contributed. The tray names this, so a
		* converted figure is never read as a price a vendor published.
		*
		* @param totals - one `{currency, amount}` per currency the session used.
		* @param conversion - the wire's conversion policy.
		* @returns `manual`, `reference`, `snapshot` or `mixed`.
		*/
		function fxSourceKind(totals, money, reference) {
			const kinds = /* @__PURE__ */ new Set();
			for (const total of totals) {
				const rated = rateFor(total.currency, money, reference);
				if (rated !== null && rated.source !== null) kinds.add(rated.source);
			}
			if (kinds.size === 0) return "manual";
			return kinds.size === 1 ? [...kinds][0] : "mixed";
		}
		/**
		* The currencies standing between a configured summary and its figure.
		*
		* @param totals - one `{currency, amount}` per currency the session used.
		* @param conversion - the wire's conversion policy.
		* @returns the unrated currency symbols, in the order the totals list them.
		*/
		function unratedCurrencies(totals, money, reference) {
			const missing = [];
			for (const total of totals) {
				if (rateFor(total.currency, money, reference) === null && !missing.includes(total.currency)) missing.push(total.currency);
			}
			return missing;
		}
		/**
		* The session's one cost value, which the pill and the tray's title both show.
		*
		* It is the converted figure when a summary currency is configured, and the
		* per-currency totals when one is not — so the two places always agree, and
		* there is always something to read. Below the title, the totals stay per
		* currency either way.
		*
		* @param view - the built view.
		* @returns the text both places render.
		*/
		function costText(view) {
			if (view.summary !== null) return formatMoney(view.summary.amount, view.summary.currency);
			return view.totals.map((total) => formatMoney(total.amount, total.currency)).join(" + ");
		}
		/**
		* What the value needs explaining, or undefined when it speaks for itself.
		*
		* A figured marked with a hint is not a vendor's own number: a converted one
		* names the rates it used, and one drawn from an incomplete session is a lower
		* bound. The hint is a hover title rather than a glyph beside the number — the
		* mark was noise on every reading, and the tray already says 「合计（下限）」
		* in words where the detail belongs.
		*
		* @param view - the built view.
		* @param t - the dictionary lookup.
		* @returns the hint text, or undefined when the value is exact and billed.
		*/
		function costHint(view, t) {
			if (view.summary !== null) {
				return t("dialog.summary.converted", {
					source: t(`dialog.summary.source.${view.summary.source}`, {
						asOf: typeof view.summary.asOf === "string" ? view.summary.asOf : ""
					}),
					lower: view.incomplete ? t("dialog.summary.lower") : ""
				});
			}
			return view.incomplete ? t("dialog.total.estimate") : void 0;
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
			}, h(CoinIcon), t("dialog.title")), h("span", {
				className: "dshCost_titleValue",
				title: costHint(view, t)
			}, costText(view))), h("div", {
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
		/** The two presentation settings the tray resolves its own figure from. */
		function moneyOf(snapshot) {
			const value = snapshot !== undefined && snapshot !== null && snapshot.value !== undefined && typeof snapshot.value === "object" ? snapshot.value : null;
			if (value === null) return null;
			return {
				displayCurrency: typeof value.displayCurrency === "string" ? value.displayCurrency : "",
				fxRates: value.fxRates !== null && typeof value.fxRates === "object" ? value.fxRates : {}
			};
		}
		function SessionCostPill({ useProjection, settings, t }) {
			const projected = useProjection(PROJECTION);
			// The settings mirror is a client-side store, so subscribing to it is what
			// makes switching the summary currency visible at once: a projection is
			// recomposed on session events alone, and this needs no event at all.
			const moneyForm = settings === undefined || settings === null ? null : formAccess(settings);
			const moneySnapshot = react.useSyncExternalStore(moneyForm === null ? NOOP_SUBSCRIBE : moneyForm.subscribe, moneyForm === null ? EMPTY_SNAPSHOT : moneyForm.getSnapshot);
			const money = moneyOf(moneySnapshot);
			const [open, setOpen] = react.useState(false);
			const anchor = react.useRef(null);
			const close = react.useCallback(() => {
				setOpen(false);
			}, []);
			const view = buildView(projected, money);
			if (view === null) return null;
			const amount = costText(view);
			const hint = costHint(view, t);
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
				// The pill's own hover text names the value; the explanation for a figure
				// that is not a vendor's own number is appended to it when there is one.
				title: hint === void 0 ? `${t("pill.aria")} ${amount}` : `${t("pill.aria")} ${amount} · ${hint}`,
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
		/**
		* The schema's own defaults, which is what restoring returns the document to.
		*
		* A field absent from the user layer re-inherits the composition, so restoring
		* clears fields rather than writing these values back: the defaults stay
		* declared in one place, on the Host.
		*/
		const CONFIG_DEFAULTS = {
			enabled: true,
			period: "auto",
			officialRates: "auto",
			currency: "$",
			displayCurrency: "",
			fxRates: {},
			prices: {}
		};
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
		/**
		* A canonical string for the override table.
		*
		* The Host materializes every schema default into the section it resolves —
		* `label: ""`, `currency: ""`, and an all-zero `peak` on an entry with no peak
		* window — so comparing the raw objects would find a "difference" on an
		* untouched form and spend a write restating it. Comparing canonical forms
		* instead means only a real edit is a change.
		*
		* @param table - an override table from either side.
		* @returns a string equal for two tables that mean the same thing.
		*/
		function pricesKey(table) {
			const source = table !== null && typeof table === "object" ? table : {};
			const entries = [];
			for (const key of Object.keys(source).sort()) {
				const entry = source[key] !== null && typeof source[key] === "object" ? source[key] : {};
				const peak = entry.peak !== null && typeof entry.peak === "object" ? entry.peak : {};
				const window = [peak.miss, peak.hit, peak.write, peak.out];
				const hasPeak = window.some((value) => typeof value === "number" && value !== 0);
				entries.push([key, [
					typeof entry.label === "string" ? entry.label : "",
					typeof entry.currency === "string" ? entry.currency : "",
					entry.miss,
					entry.hit,
					entry.write,
					entry.out,
					hasPeak ? window : null
				]]);
			}
			return JSON.stringify(entries);
		}
		/** The same canonical treatment for the rate table. */
		function fxKey(rates) {
			const source = rates !== null && typeof rates === "object" ? rates : {};
			return JSON.stringify(Object.keys(source).sort().map((currency) => [currency, source[currency]]));
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
			// Memory mode (or a namespace this client may not write) accepts no writes;
			// attempting them would report a failure the user cannot act on.
			const writable = snapshot === undefined || snapshot.writable !== false;
			const [draft, setDraft] = react.useState(null);
			const [status, setStatus] = react.useState("idle");
			const [picked, setPicked] = react.useState("");
			/** Whether the summary currency is being typed rather than picked from the list. */
			const [customDisplay, setCustomDisplay] = react.useState(false);
			/** The two advanced sections start folded: the page opens as settings, not a table. */
			const [fxOpen, setFxOpen] = react.useState(false);
			const [pricesOpen, setPricesOpen] = react.useState(false);
			/** Which override rows are unfolded, by the route they show. */
			const [openRoutes, setOpenRoutes] = react.useState([]);
			/** Whether the restore confirmation is showing. */
			const [resetOpen, setResetOpen] = react.useState(false);
			// A stored symbol the list does not carry means the form was left in custom
			// mode, so a reload resumes typing it instead of dropping to the sentinel.
			const displayCustom = customDisplay || (draft !== null && draft.displayCurrency !== "" && !CURRENCY_CHOICES.includes(draft.displayCurrency));
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
				return h("div", {
					className: "dshCost_form"
				}, h("p", {
					className: "dshCost_notice",
					role: "status"
				}, t(loading ? "settings.loading" : "settings.unavailable")));
			}
			const rows = draft.rows;
			const setRow = (index, patch) => {
				edit({
					rows: draft.rows.map((row, at) => (at === index ? { ...row, ...patch } : row))
				});
			};
			/** Patch one rate row. */
			const setFx = (index, patch) => {
				edit({
					fxRows: draft.fxRows.map((row, at) => (at === index ? { ...row, ...patch } : row))
				});
			};
			const removeRow = (index) => {
				edit({ rows: draft.rows.filter((_row, at) => at !== index) });
			};
			const edit = (patch) => {
				const next = { ...draft, ...patch };
				setDraft(next);
				setStatus("idle");
				if (value !== null) void persist(changesBetween(value, configOfDraft(next)));
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
			/**
			* Clear every field the user layer carries, returning the namespace to the
			* Host's own defaults.
			*
			* `unset` is the right write for this: a field absent from the user layer
			* re-inherits the composition, which is where the defaults are declared.
			* The fields to clear come from the snapshot's `user` layer, because a field
			* whose value happens to equal the default is still an override.
			*/
			const restore = async () => {
				setResetOpen(false);
				const carried = snapshot !== void 0 && snapshot.user !== null && typeof snapshot.user === "object" ? Object.keys(snapshot.user) : Object.keys(CONFIG_DEFAULTS);
				setDraft(draftFromConfig(CONFIG_DEFAULTS));
				if (carried.length === 0 || writable === false) return;
				setStatus("saving");
				try {
					for (const field of carried) {
						if (await settings.unset(field) !== true) {
							setStatus("failed");
							return;
						}
					}
					setStatus("saved");
				} catch (_resetFailed) {
					setStatus("failed");
				}
			};
			/** What is overridden right now, which is what restoring clears. */
			const overriddenFields = snapshot !== void 0 && snapshot.user !== null && typeof snapshot.user === "object" ? Object.keys(snapshot.user) : [];
			/** The config one draft describes. */
			const configOfDraft = (state) => ({
				enabled: state.enabled,
				period: state.period,
				officialRates: state.officialRates,
				currency: state.currency,
				displayCurrency: state.displayCurrency,
				fxRates: fxRatesOf(state.fxRows),
				prices: pricesOf(state.rows)
			});
			/**
			* The writes one draft implies, in field order.
			*
			* Only real differences are written, and the two table-valued fields are
			* compared canonically. A profile written before a field existed resolves
			* it as absent, which is that field's schema default, so a missing value
			* is compared as the default rather than spending a write restating it.
			*
			* @param current - the section the Host resolved.
			* @param next - the config the draft describes.
			* @returns `[field, value]` pairs, empty when nothing changed.
			*/
			const changesBetween = (current, next) => {
				const writes = [];
				if (current.enabled !== next.enabled) writes.push(["enabled", next.enabled]);
				if (current.period !== next.period) writes.push(["period", next.period]);
				if ((current.officialRates ?? "auto") !== next.officialRates) writes.push(["officialRates", next.officialRates]);
				if ((current.currency ?? "") !== next.currency) writes.push(["currency", next.currency]);
				if ((current.displayCurrency ?? "") !== next.displayCurrency) writes.push(["displayCurrency", next.displayCurrency]);
				if (fxKey(current.fxRates) !== fxKey(next.fxRates)) writes.push(["fxRates", next.fxRates]);
				if (pricesKey(current.prices) !== pricesKey(next.prices)) writes.push(["prices", next.prices]);
				return writes;
			};
			/**
			* Persist what an edit changed, one field at a time.
			*
			* There is no Save button: the form writes as the user edits. `set` is the
			* transport's field-write, which carries the latest known revision itself
			* and collapses rapid writes to the last settlement — the same call the
			* shipped settings pages use — so a burst of keystrokes stays ordered and
			* only the newest one publishes.
			*
			* @param writes - `[field, value]` pairs from `changesBetween`.
			*/
			const persist = async (writes) => {
				if (writes.length === 0 || writable === false) return;
				setStatus("saving");
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
			/**
			* One settings field, in the shape a first-class settings page uses: the
			* label above the control, the hint under it, and a hairline between
			* fields. The class sheet mirrors `dsh-client-ui-primitives/settings-form`,
			* because a bundle config page renders inside the Plugins page and should
			* read as one of its sections rather than as a plugin's side panel.
			*/
			const field = (label, control, hint) => h("div", {
				className: "dshCost_field"
			}, h("div", {
				className: "dshCost_fieldHead"
			}, h("span", {
				className: "dshCost_fieldLabel"
			}, label)), control, hint === undefined || hint === "" ? null : h("p", {
				className: "dshCost_hint"
			}, hint));
			/** A choice control wearing that field style, with the shell's own chevron. */
			const choice = (options, value, onChange, label) => h("span", {
				className: "dshCost_select"
			}, h("select", {
				className: "dshCost_control",
				"aria-label": label,
				value,
				onChange: (event) => onChange(event.target.value)
			}, options.map((option) => h("option", {
				key: option.value,
				value: option.value
			}, option.label))), h(primitives.IconChevronDownOutlineRegular, {
				size: 14
			}));
			/** One labelled cell of a compact row inside a folded section. */
			const cell = (label, control, className, key) => h("label", {
				key,
				className: className === undefined ? "dshCost_cell" : `dshCost_cell ${className}`
			}, h("span", {
				className: "dshCost_cellLabel"
			}, label), control);
			/** The text control for a field the shell's kit ships no component for. */
			const text = (attrs) => h("input", {
				type: "text",
				className: "dshCost_input",
				...attrs
			});
			const PERIOD_OPTIONS = ["auto", "peak", "offpeak"].map((option) => ({
				value: option,
				label: t(`settings.period.${option}`)
			}));
			const CARD_OPTIONS = ["auto", "cny", "usd"].map((option) => ({
				value: option,
				label: t(`settings.officialRates.${option}`)
			}));
			const SYMBOL_OPTIONS = CURRENCY_CHOICES.map((symbol) => ({
				value: symbol,
				label: symbol
			})).concat([{
				value: CURRENCY_CUSTOM,
				label: t("settings.currency.custom")
			}]);
			const BASE_FIELDS = ["miss", "hit", "write", "out"];
			const PEAK_FIELDS = [["peakMiss", "miss"], ["peakHit", "hit"], ["peakWrite", "write"], ["peakOut", "out"]];
			/** The compact rate line a folded override shows in place of its rates. */
			const ratesSummary = (row) => BASE_FIELDS.map((name) => {
				const entered = String(row[name]).trim();
				return entered === "" ? "0" : entered;
			}).join(" / ");
			/** One override: folded to its route, unfolded into its rates. */
			const overrideRow = (row, index) => {
				const route = row.key.trim();
				const name = route === "" ? `unnamed-${index}` : route;
				const open = openRoutes.includes(name);
				const control = (fieldName, value) => text({
					"data-session-cost-field": fieldName,
					value,
					onChange: (event) => setRow(index, {
						[fieldName]: event.target.value
					})
				});
				return h("div", {
					key: name,
					className: "dshCost_route",
					"data-session-cost-override": route
				}, h(primitives.DisclosureRow, {
					title: route === "" ? t("settings.row.unnamed") : route,
					open,
					expandable: true,
					expandOnRowClick: true,
					previewChevron: false,
					onToggle: () => setOpenRoutes(open ? openRoutes.filter((each) => each !== name) : [...openRoutes, name]),
					collapsedContent: h("span", {
						className: "dshCost_routeMeta"
					}, row.currency.trim() === "" ? t("settings.currency.inherit") : row.currency, " · ", ratesSummary(row))
				}, h("div", {
					className: "dshCost_body"
				}, h("div", {
					className: "dshCost_line"
				}, cell(t("settings.column.label"), control("label", row.label), "dshCost_cellName"), cell(t("settings.column.currency"), control("currency", row.currency))), h("div", {
					className: "dshCost_line"
				}, h("span", {
					className: "dshCost_rateGroupLabel"
				}, t("settings.column.base")), BASE_FIELDS.map((fieldName) => cell(t(`settings.column.${fieldName}`), control(fieldName, row[fieldName]), undefined, fieldName))), h("div", {
					className: "dshCost_line"
				}, h("span", {
					className: "dshCost_rateGroupLabel"
				}, t("settings.peak")), PEAK_FIELDS.map(([peakName, baseName]) => cell(t(`settings.column.${baseName}`), control(peakName, row[peakName]), undefined, peakName))), h("div", {
					className: "dshCost_line"
				}, h(primitives.Button, {
					variant: "ghost",
					onClick: () => edit({
						rows: draft.rows.filter((_row, at) => at !== index)
					})
				}, t("settings.remove"))))));
			};
			/** The model picker: routes grouped by provider, and the import itself. */
			const importControls = [cell(t("settings.import"), h("span", {
				className: "dshCost_select"
			}, h("select", {
				className: "dshCost_control",
				"aria-label": t("settings.import"),
				value: picked,
				onChange: (event) => setPicked(event.target.value)
			}, h("option", {
				value: ""
			}, t("settings.import.placeholder")), groups.map((group) => h("optgroup", {
				key: group.id,
				label: group.name === group.id ? group.id : `${group.name} · ${group.id}`
			}, group.models.map((model) => {
				const route = `${group.id}/${model.id}`;
				const name = model.name === "" ? model.id : `${model.name} · ${model.id}`;
				// A route already overridden stays listed but disabled, and says why: the
				// suffix is the only thing that explains a greyed-out option.
				return h("option", {
					key: route,
					value: route,
					disabled: taken.has(route)
				}, taken.has(route) ? `${name} · ${t("settings.import.added")}` : name);
			})))), h(primitives.IconChevronDownOutlineRegular, {
				size: 14
			})), "dshCost_cellName", "pick"), h(primitives.Button, {
				key: "import",
				variant: "outline",
				disabled: picked === "" || taken.has(picked),
				onClick: () => importRoute(picked)
			}, t("settings.import.add"))];
			return h("div", {
				className: "dshCost_form",
				"data-session-cost-settings": ""
			}, writable ? null : h("p", {
				className: "dshCost_notice",
				role: "status"
			}, t("settings.readonly")), field(t("settings.enabled"), h("div", {
				className: "dshCost_switch"
			}, h(primitives.Switch, {
				checked: draft.enabled,
				label: t("settings.enabled"),
				onChange: (next) => edit({
					enabled: next
				})
			}))), field(t("settings.period"), choice(PERIOD_OPTIONS, draft.period, (value) => edit({
				period: value
			}), t("settings.period")), t("settings.basis")), field(t("settings.officialRates"), choice(CARD_OPTIONS, draft.officialRates, (value) => edit({
				officialRates: value
			}), t("settings.officialRates")), t("settings.officialRates.hint")), field(t("settings.currency"), h("div", {
				className: "dshCost_line"
			}, choice(SYMBOL_OPTIONS, CURRENCY_CHOICES.includes(draft.currency) ? draft.currency : CURRENCY_CUSTOM, (value) => {
				if (value === CURRENCY_CUSTOM) return;
				edit({
					currency: value
				});
			}, t("settings.currency")), CURRENCY_CHOICES.includes(draft.currency) ? null : text({
				className: "dshCost_input dshCost_custom",
				"aria-label": t("settings.currency.custom"),
				placeholder: t("settings.currency.custom"),
				value: draft.currency,
				onChange: (event) => edit({
					currency: event.target.value
				})
			})), t("settings.currency.hint")), field(t("settings.displayCurrency"), h("div", {
				className: "dshCost_line"
			}, choice([{
				value: "",
				label: t("settings.displayCurrency.off")
			}].concat(SYMBOL_OPTIONS), displayCustom ? CURRENCY_CUSTOM : draft.displayCurrency, (value) => {
				if (value !== CURRENCY_CUSTOM) {
					setCustomDisplay(false);
					edit({
						displayCurrency: value
					});
					return;
				}
				setCustomDisplay(true);
			}, t("settings.displayCurrency")), displayCustom ? text({
				className: "dshCost_input dshCost_custom",
				"aria-label": t("settings.currency.custom"),
				placeholder: t("settings.currency.custom"),
				value: draft.displayCurrency,
				onChange: (event) => edit({
					displayCurrency: event.target.value
				})
			}) : null), t("settings.displayCurrency.hint")), h(primitives.DisclosureRow, {
				title: t("settings.fx"),
				open: fxOpen,
				expandable: true,
				expandOnRowClick: true,
				previewChevron: false,
				onToggle: () => setFxOpen(!fxOpen),
				collapsedContent: h("span", {
					className: "dshCost_routeMeta"
				}, t("settings.fx.count", {
					count: draft.fxRows.length
				}))
			}, h("div", {
				className: "dshCost_body"
			}, draft.fxRows.length === 0 ? h("p", {
				className: "dshCost_hint"
			}, t("settings.fx.empty")) : null, draft.fxRows.map((row, index) => h("div", {
				key: `fx-${index}`,
				className: "dshCost_line",
				"data-session-cost-fx": row.currency
			}, cell(t("settings.fx.currency"), text({
				"data-session-cost-fx-field": "currency",
				value: row.currency,
				onChange: (event) => setFx(index, {
					currency: event.target.value
				})
			})), cell(t("settings.fx.rate"), text({
				inputMode: "decimal",
				"data-session-cost-fx-field": "rate",
				value: row.rate,
				onChange: (event) => setFx(index, {
					rate: event.target.value
				})
			})), h(primitives.Button, {
				variant: "ghost",
				"aria-label": t("settings.fx.remove"),
				onClick: () => edit({
					fxRows: draft.fxRows.filter((_row, at) => at !== index)
				})
			}, t("settings.remove")))), h("div", {
				className: "dshCost_line"
			}, h(primitives.Button, {
				variant: "outline",
				onClick: () => edit({
					fxRows: [...draft.fxRows, {
						currency: "",
						rate: ""
					}]
				})
			}, t("settings.fx.add"))), h("p", {
				className: "dshCost_hint"
			}, t("settings.fx.hint")))), h(primitives.DisclosureRow, {
				title: t("settings.prices"),
				open: pricesOpen,
				expandable: true,
				expandOnRowClick: true,
				previewChevron: false,
				onToggle: () => setPricesOpen(!pricesOpen),
				collapsedContent: h("span", {
					className: "dshCost_routeMeta"
				}, t("settings.prices.count", {
					count: rows.length
				}))
			}, h("div", {
				className: "dshCost_body"
			}, h("p", {
				className: "dshCost_hint"
			}, t("settings.prices.hint")), h("p", {
				className: "dshCost_hint",
				"data-session-cost-prefill": presets === false ? "unavailable" : "ready"
			}, t(presets === false ? "settings.import.noprefill" : "settings.import.prefill", {
				count: presets === null || presets === false ? 0 : Object.keys(presets).length
			})), groups.length === 0 ? h("p", {
				className: "dshCost_hint"
			}, t(catalog === null ? "settings.import.loading" : catalog.failed === true ? "settings.import.failed" : "settings.import.empty")) : h("div", {
				className: "dshCost_line"
			}, importControls), rows.length === 0 ? h("p", {
				className: "dshCost_hint"
			}, t("settings.prices.empty")) : null, rows.map((row, index) => overrideRow(row, index)), h("div", {
				className: "dshCost_line"
			}, h(primitives.Button, {
				variant: "outline",
				onClick: () => edit({
					rows: [...rows, draftRowFrom("", {})]
				})
			}, t("settings.add"))))), h("div", {
				className: "dshCost_footer"
			}, h(primitives.Button, {
				variant: "ghost",
				disabled: overriddenFields.length === 0,
				onClick: () => setResetOpen(true)
			}, t("settings.reset")), h("span", {
				className: "dshCost_status",
				"data-state": status,
				role: "status"
			}, t(`settings.status.${status}`))), h(primitives.Modal, {
				open: resetOpen,
				onClose: () => setResetOpen(false),
				title: t("settings.reset"),
				closeLabel: t("settings.reset.cancel"),
				description: t("settings.reset.description"),
				footer: [h(primitives.Button, {
					key: "cancel",
					variant: "outline",
					onClick: () => setResetOpen(false)
				}, t("settings.reset.cancel")), h(primitives.Button, {
					key: "restore",
					variant: "primary",
					onClick: () => {
						void restore();
					}
				}, t("settings.reset.confirm"))]
			}));
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
						className: "dshCost_notice",
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
			ctx.inject(["configForms"], (scope) => {
				const form = scope.configForms.get(NS);
				// The pill is registered inside this injection because it reads the same
				// mirror the seats do: that subscription is what makes a change to the
				// summary currency visible without a session event.
				ctx.slots.inject(SLOT, () => ctx.slots.register({
					name: SLOT,
					id: NS,
					order: 20,
					locale: NS,
					inject: () => ({
						settings: form
					})
				}, SessionCostPill));
				/**
				* The shared face both seats read. The catalog loader is a stable
				* function over a late-bound source, so the seats register whether or
				* not the model-catalog remote is composed, a late arrival still
				* works, and a deployment without it degrades to manual entry.
				*/
				let source = null;
				const face = {
					settings: form,
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
