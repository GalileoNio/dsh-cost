window.__ModuleLoader__.load({
	id: "dsh-client-ui-session-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_dom = require("react-dom");
		const h = react.createElement;
		//#region dictionary and styles
		/** Dictionary namespace owned by this plugin; must equal the profile entry id. */
		const NS = "session-cost";
		/** Composer-dock list that already carries the session's time and token pills. */
		const SLOT = "conversation.composer.dock";
		/** The Host fold this plugin registers; absent while the Host half serves nothing. */
		const PROJECTION = "sessionCost";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"pill.aria": "本会话花费",
			"dialog.title": "本会话花费",
			"dialog.basis": "按每段实际模型、计价时段与单价计算",
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
			"dialog.note.prices": "预设价来自 harness 内置模型目录，可在 Settings → Plugins → Session cost 覆盖。"
		};
		/** English dictionary, kept complete against the zh key set. */
		const en = {
			"pill.aria": "Session cost",
			"dialog.title": "Session cost",
			"dialog.basis": "Priced per segment from the model that served it, in the window it fell in",
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
			"dialog.note.prices": "Presets come from the harness model catalog; override them in Settings → Plugins → Session cost."
		};
		/** Trace-path prefix shared by every class this plugin injects. */
		const CSS = ".dshCost_root{box-sizing:border-box;min-width:0;max-width:100%;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;gap:12px;display:flex}.dshCost_anchor{min-width:0;display:inline-flex}.dshCost_pill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.dshCost_pill svg,.dshCost_panel svg{flex:none;width:14px;height:14px}.dshCost_pill:hover,.dshCost_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dshCost_label{text-overflow:ellipsis;min-width:0;overflow:hidden}.dshCost_panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:360px;max-height:min(64vh,560px);overflow-y:auto;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.18));font-size:12px;line-height:18px}.dshCost_title{font-size:13px;font-weight:500;align-items:center;gap:6px;display:flex}.dshCost_basis{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:11px;line-height:16px}.dshCost_rule{height:1px;background:var(--dsw-alias-border-l1);margin:8px -12px}.dshCost_sections{flex-direction:column;gap:10px;display:flex}.dshCost_section{flex-direction:column;gap:4px;display:flex}.dshCost_sectionHead{color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-weight:500;display:flex}.dshCost_sectionMeta{color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:11px}.dshCost_row{grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:0 10px;display:grid}.dshCost_rowLabel{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshCost_rowDetail{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}.dshCost_rowCost{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.dshCost_subtotal{color:var(--dsw-alias-label-primary);margin-top:2px;font-variant-numeric:tabular-nums;text-align:right}.dshCost_total{justify-content:space-between;gap:12px;margin-top:8px;padding-top:8px;font-weight:500;display:flex;border-top:1px solid var(--dsw-alias-border-l1)}.dshCost_amounts{font-variant-numeric:tabular-nums;text-align:right}.dshCost_note{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px}";
		/** Inject the class sheet once per page, keyed by the same tag protocol shipped plugins use. */
		function injectCss() {
			const tagId = "dsh-client-ui-session-cost/SessionCostPill.css";
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-session-cost";
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
			return {
				sections,
				totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
				notes,
				incomplete: unattributed.attempts > 0 || unpriced.length > 0
			};
		}
		/** The pill's amount text: one amount per currency, lower-bound marked once. */
		function amountText(view) {
			const amounts = view.totals.map((total) => formatMoney(total.amount, total.currency)).join(" + ");
			return view.incomplete ? `≈${amounts}` : amounts;
		}
		/**
		* A coin mark, drawn inline so the pill owns no icon dependency.
		*
		* The intrinsic `width`/`height` matter: an SVG carrying only a
		* `viewBox` sizes itself to its container, so the same element is 14px
		* inside the pill and the full width of the 360px disclosure panel
		* without them. The class sheet repeats the size per context; this pair
		* is the floor that holds wherever a rule is missing.
		*/
		function CoinIcon() {
			return h("svg", {
				viewBox: "0 0 16 16",
				width: 14,
				height: 14,
				fill: "none",
				"aria-hidden": true
			}, h("circle", {
				cx: 8,
				cy: 8,
				r: 6.2,
				stroke: "currentColor",
				strokeWidth: 1.5
			}), h("path", {
				d: "M6 5.4 8 7.9 10 5.4M6 8.4h4M6 10h4M8 7.9v3.1",
				stroke: "currentColor",
				strokeWidth: 1.2,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		//#endregion
		//#region components
		/**
		* The trigger-anchored disclosure. Mounted only while open, so its
		* measurement effects run exactly once per disclosure.
		*/
		function CostPanel({ anchor, view, t, onClose }) {
			const panelRef = react.useRef(null);
			const [pos, setPos] = react.useState(null);
			react.useLayoutEffect(() => {
				const place = () => {
					const node = anchor.current;
					if (node === null) return;
					const rect = node.getBoundingClientRect();
					const width = panelRef.current === null ? 360 : panelRef.current.offsetWidth;
					const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), Math.max(8, window.innerWidth - width - 8));
					setPos({ left, bottom: Math.max(8, window.innerHeight - rect.top + 8) });
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [anchor]);
			react.useEffect(() => {
				const onPointerDown = (event) => {
					const panel = panelRef.current;
					const trigger = anchor.current;
					if (panel !== null && panel.contains(event.target)) return;
					if (trigger !== null && trigger.contains(event.target)) return;
					onClose();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") onClose();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [anchor, onClose]);
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
				style: pos === null ? { left: 0, bottom: 0, visibility: "hidden" } : pos
			}, h("div", {
				className: "dshCost_title"
			}, h(CoinIcon), t("dialog.title")), h("div", {
				className: "dshCost_basis"
			}, t("dialog.basis")), h("div", {
				className: "dshCost_rule",
				"aria-hidden": true
			}), h("div", {
				className: "dshCost_sections"
			}, sections), h("div", {
				className: "dshCost_total"
			}, h("span", null, t(view.incomplete ? "dialog.total.estimate" : "dialog.total")), totals), view.notes.map((note) => h("div", {
				key: note.key,
				className: "dshCost_note"
			}, t(note.key, note.params))), h("div", {
				className: "dshCost_note"
			}, t("dialog.note.prices"))), document.body);
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
				view,
				t,
				onClose: close
			}) : null);
		}
		//#endregion
		/** Required client services: the slot ledger and this plugin's dictionaries. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: install the dictionary and one composer-dock entry.
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
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
