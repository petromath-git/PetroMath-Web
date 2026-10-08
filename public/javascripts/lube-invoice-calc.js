/*
 * Lube purchase invoice arithmetic — shared by the browser (live screen) and
 * the server (controllers/lubes-invoice-controller.js recomputes on save), so
 * what the user sees is exactly what gets stored. Keep it dependency-free.
 *
 * The user types what is printed on the invoice:
 *   qty (pieces, or litres/kg that we convert), gross amount, line discount,
 *   and at invoice level a cash discount and the printed total.
 * Everything else — per-piece rate, taxable value, GST, round-off — is derived.
 *
 * Cash discount reduces the taxable value BEFORE GST (that is how BPCL prints
 * it: the CGST/SGST shown are on the post-cash-discount value), so it is split
 * across paid lines in proportion to their post-discount value.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LubeInvoiceCalc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const GST_RATES = [0, 5, 12, 18, 28, 40];
    const TOTAL_TOLERANCE = 1.00;   // ₹ — printed total vs computed total

    function num(v) {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
    }
    function toPaise(v) { return Math.round(num(v) * 100); }
    function fromPaise(p) { return p / 100; }
    function round2(v) { return fromPaise(toPaise(v)); }

    // Split `total` (rupees) across `weights` in proportion, in whole paise, so the
    // parts always add back to the total exactly. Remainder paise go to the
    // largest-weight entries first.
    function allocate(total, weights) {
        const totalP = toPaise(total);
        const w = weights.map(x => Math.max(0, num(x)));
        const sumW = w.reduce((a, b) => a + b, 0);
        const out = w.map(() => 0);
        if (!totalP || !sumW) return out.map(fromPaise);
        let used = 0;
        const fracs = w.map((wi, i) => {
            const exact = totalP * wi / sumW;
            out[i] = Math.floor(exact);
            used += out[i];
            return { i, frac: exact - out[i], wi };
        });
        let left = totalP - used;
        fracs.sort((a, b) => (b.frac - a.frac) || (b.wi - a.wi));
        for (let k = 0; left > 0 && k < fracs.length; k++, left--) {
            if (fracs[k].wi > 0) out[fracs[k].i] += 1; else left++;
        }
        return out.map(fromPaise);
    }

    // ── Pack size from product name ───────────────────────────────────────────
    // "SERVO 20W-40 1L" → 1 L, "MAK DIAMOND-5 LTR" → 5 L, "BRAKE FLUID - 250 ML"
    // → 0.25 L, "SERVO 20W/40 1/2L" → 0.5 L, "GREASE 500GM" → 0.5 KG.
    // A trailing "(12 LTR CASE)" style note is ignored — that's the carton.
    const UNIT_RE = '(MLS?|LITRES?|LITERS?|LITS?|LTRS?|LTS?|LT|L|KGS?|GMS?|GM|G)';
    // The number must not be glued to a preceding letter/digit, so grades like
    // "20W50" never read as a pack size.
    const PACK_RE = new RegExp('(?<![A-Z0-9.])(\\d+\\/\\d+|\\d*\\.\\d+|\\d+)\\s*' + UNIT_RE + '(?![A-Z])', 'g');

    function parsePackSize(name) {
        if (!name) return null;
        const clean = String(name).toUpperCase().replace(/\([^)]*CASE[^)]*\)/g, ' ');
        PACK_RE.lastIndex = 0;
        let m;
        while ((m = PACK_RE.exec(clean)) !== null) {
            let value;
            if (m[1].indexOf('/') >= 0) {
                const [a, b] = m[1].split('/').map(Number);
                value = b ? a / b : 0;
            } else {
                value = parseFloat(m[1]);
            }
            if (!value || value <= 0) continue;
            const u = m[2];
            if (/^ML/.test(u)) return { size: round3(value / 1000), measure: 'L' };
            if (/^(GM|G)/.test(u)) return { size: round3(value / 1000), measure: 'KG' };
            if (/^KG/.test(u)) return { size: round3(value), measure: 'KG' };
            return { size: round3(value), measure: 'L' };
        }
        return null;
    }
    function round3(v) { return Math.round(v * 1000) / 1000; }

    // Product unit says the product is itself counted in litres/kg (loose oil,
    // barrels) — then qty is entered in that unit directly, no pieces conversion.
    function measureUnit(unit) {
        const u = String(unit || '').toUpperCase().trim();
        if (/^(L|LT|LTR|LTRS|LTS|LIT|LITS|LITRE|LITRES|LITER|LITERS)$/.test(u)) return 'L';
        if (/^(KG|KGS)$/.test(u)) return 'KG';
        return null;
    }

    // Pieces received from what was typed.
    //   uom 'PCS' → as typed. uom 'LTR'/'KG' → divided by the pack size.
    // Returns { qty, whole } — whole=false flags e.g. 37 L of a 0.8 L pack.
    function toPieces(enteredQty, uom, packSize) {
        const q = num(enteredQty);
        if (uom === 'PCS' || !packSize) return { qty: q, whole: Number.isInteger(round3(q)) };
        const pcs = round3(q / packSize);
        return { qty: pcs, whole: Math.abs(pcs - Math.round(pcs)) < 0.001 };
    }

    // ── Invoice computation ───────────────────────────────────────────────────
    // input: {
    //   tax_type: 'CGST_SGST' | 'IGST',
    //   discount_mode: 'LINE' | 'TOTAL',
    //   total_line_discount, cash_discount, printed_total (optional),
    //   lines: [{ qty, gross, line_discount, gst_pct }]
    // }
    function compute(input) {
        const taxType = input.tax_type === 'IGST' ? 'IGST' : 'CGST_SGST';
        const mode = input.discount_mode === 'TOTAL' ? 'TOTAL' : 'LINE';
        const lines = (input.lines || []).map(l => ({
            qty: num(l.qty),
            gross: round2(l.gross),
            line_discount: round2(l.line_discount),
            gst_pct: num(l.gst_pct)
        }));
        const errors = [];

        const paidRates = lines.filter(l => l.gross > 0).map(l => l.gst_pct);
        const mixedGst = new Set(paidRates).size > 1;

        if (mode === 'TOTAL') {
            if (mixedGst) errors.push('Discount can only be entered as one total when all lines have the same GST %. Enter it per line instead.');
            const shares = allocate(input.total_line_discount, lines.map(l => l.gross));
            lines.forEach((l, i) => { l.line_discount = shares[i]; });
        }

        const cashShares = allocate(input.cash_discount, lines.map(l => Math.max(0, l.gross - l.line_discount)));

        let tGross = 0, tDisc = 0, tCash = 0, tTaxable = 0, tGst = 0, tAmount = 0;
        const out = lines.map((l, i) => {
            const cash = cashShares[i];
            const taxable = round2(l.gross - l.line_discount - cash);
            if (taxable < 0) errors.push(`Line ${i + 1}: discount is more than the amount.`);
            if (GST_RATES.indexOf(l.gst_pct) < 0) errors.push(`Line ${i + 1}: GST ${l.gst_pct}% is not a valid rate.`);

            let cgstPct = 0, sgstPct = 0, igstPct = 0, cgst = 0, sgst = 0, igst = 0;
            if (taxType === 'IGST') {
                igstPct = l.gst_pct;
                igst = round2(taxable * igstPct / 100);
            } else {
                cgstPct = sgstPct = l.gst_pct / 2;
                cgst = round2(taxable * cgstPct / 100);
                sgst = round2(taxable * sgstPct / 100);
            }
            const gst = round2(cgst + sgst + igst);
            const amount = round2(taxable + gst);

            tGross += l.gross; tDisc += l.line_discount; tCash += cash;
            tTaxable += taxable; tGst += gst; tAmount += amount;

            return {
                qty: l.qty,
                gross_amount: l.gross,
                discount_amount: l.line_discount,
                cash_discount_amount: cash,
                taxable_value: taxable,
                gst_pct: l.gst_pct,
                cgst_pct: cgstPct, cgst_amount: cgst,
                sgst_pct: sgstPct, sgst_amount: sgst,
                igst_pct: igstPct, igst_amount: igst,
                gst_amount: gst,
                amount: amount,
                // Pre-discount rate per piece — same meaning net_rate has always had
                // (stock ledger shows qty × net_rate). 0 on free-goods lines.
                net_rate: l.qty > 0 ? round2(l.gross / l.qty) : 0,
                // What one piece actually cost, incl. GST — used for the sanity check
                cost_per_unit: l.qty > 0 ? round2(amount / l.qty) : 0,
                is_free: l.gross === 0
            };
        });

        const linesTotal = round2(tAmount);
        const printed = input.printed_total === '' || input.printed_total == null ? null : round2(input.printed_total);
        const diff = printed == null ? null : round2(printed - linesTotal);
        const matches = diff != null && Math.abs(diff) <= TOTAL_TOLERANCE;

        return {
            tax_type: taxType,
            discount_mode: mode,
            mixedGst,
            lines: out,
            totals: {
                gross: round2(tGross),
                discount: round2(tDisc),
                cash_discount: round2(tCash),
                taxable: round2(tTaxable),
                gst: round2(tGst),
                lines_total: linesTotal,
                printed_total: printed,
                diff,
                matches,
                round_off: matches ? diff : null,
                invoice_amount: matches ? printed : linesTotal
            },
            errors
        };
    }

    // Cost-vs-selling-price sanity check (per piece, GST included on both sides).
    // Returns a warning string or null. Free lines and products without a selling
    // price are skipped.
    function priceWarning(costPerUnit, sellingPrice, unitLabel) {
        const cost = num(costPerUnit), price = num(sellingPrice);
        if (!cost || !price) return null;
        const per = unitLabel || 'piece';
        if (cost > price * 1.02) {
            return `Cost ₹${cost.toFixed(2)} per ${per} is MORE than your selling price ₹${price.toFixed(2)}. Did you enter litres as pieces, or the carton price?`;
        }
        if (cost < price * 0.4) {
            return `Cost ₹${cost.toFixed(2)} per ${per} is very low against your selling price ₹${price.toFixed(2)}. Did you enter litres as pieces?`;
        }
        return null;
    }

    return { GST_RATES, TOTAL_TOLERANCE, round2, allocate, parsePackSize, measureUnit, toPieces, compute, priceWarning };
}));
