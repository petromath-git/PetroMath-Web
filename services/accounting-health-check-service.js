// Accounting Health Check — per location, for a financial year or one month of it.
//
// Each check is one read-only query that returns ONLY problem rows, plus a judge
// that turns those rows into pass / warn / fail. Codes are stable (P = pre-flight
// on source data, A = after Create Accounting, R = reconciliation) so later phases
// can keep run history and accepted-exception notes against them.
//
// The checks come from the GL audit runbook (MUE, MME and MC, FY 2025-26), but
// they must hold at EVERY location, so nothing here may assume a location's
// names:
//   - fuels are found by product ID through m_tank / m_pump / tank invoices,
//     never by product name (names are open-ended: MS, XP95, XG, POWER, CNG...);
//   - oil-company (SAP) purchases are found by amount and by what they are NOT
//     (fees, charges, TDS, rent, interest, penalty, cash), never by one label —
//     locations tag them OTHERS, PURCHASE, PURCHASE INVOICE, IOCL FUEL PURCHASE...;
//   - the user-facing "why" text describes the risk, not a location's history.
//
// Design: "Accounting Health Check — design" (Claude Docs). Phase 1 = read-only,
// no history, no accept-with-note.

const db = require('../db/db-connection');
const { getLocationConfigValue } = require('../utils/location-config');

const MAX_ROWS = 500;

// Bands — location setting 'min,max' (global '*' default), else these.
const BAND_DEFAULTS = {
    HC_FUEL_MARGIN:   [1.5, 6.0],     // ₹ per litre, any fuel: catches missing / doubled invoices
    HC_GP_PCT_FUEL:   [2.0, 5.0],     // % of fuel sales
    HC_SALES_GST_TOL: [0, 1]          // ₹ per product-month
};

// Cashflow CREDIT labels that are internal movements and SKIP on purpose.
const CASH_IN_SKIP_OK = ['Balance B/F', 'Collection', '2T Oil', 'Cash Receipt', 'Shift Cash Return',
                         'Cashier A/C (+)', 'Discount'];

// SAP debits that are not product purchases, matched on label or bank text.
const SAP_NOT_PURCHASE = 'LICEN[CS]E|CHARGE|TDS|RENT|INTEREST|PENALTY|INCENTIVE|COMMISSION';

async function getBand(locationCode, setting) {
    const raw = await getLocationConfigValue(locationCode, setting, null);
    if (raw) {
        const parts = raw.split(',').map(s => parseFloat(s));
        if (parts.length === 2 && parts.every(n => !isNaN(n))) return parts;
    }
    return BAND_DEFAULTS[setting];
}

// Optional tighter bands per fuel, by product name: HC_FUEL_MARGIN_BANDS = 'MS:3.5-4.5;HSD:2.2-3.0'.
async function getFuelBands(locationCode) {
    const raw = await getLocationConfigValue(locationCode, 'HC_FUEL_MARGIN_BANDS', '') || '';
    const map = {};
    raw.split(';').forEach(part => {
        const m = /^\s*(.+?)\s*:\s*(-?[\d.]+)\s*-\s*(-?[\d.]+)\s*$/.exec(part);
        if (m) map[m[1].toUpperCase()] = [parseFloat(m[2]), parseFloat(m[3])];
    });
    return map;
}

function q(sql, replacements) {
    return db.sequelize.query(sql, { replacements, type: db.Sequelize.QueryTypes.SELECT });
}

const sum = (rows, col) => rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);

// Fuel position per tank product for the period: opening + tank invoices − meter.
// The opening is the FY's GL seed; for a month it is carried forward through the
// FY's earlier months (seed + invoices − meter before :from, valued at the
// weighted cost of seed + those invoices). For a full FY :fyFrom = :from, so
// nothing is carried.
// A product counts as fuel when it has a tank here; it is judged only when it was
// bought on tank invoices or has a GL opening seed (2T loose, AdBlue etc. are not).
const FUEL_POSITION_SQL = `
    SELECT p.product_id, p.product_name,
           ROUND(COALESCE(sob.opening_qty,0),0)   seed_l,
           ROUND(COALESCE(sob.opening_value,0),2) seed_value,
           ROUND(COALESCE(pre_pu.litres,0),0)     pre_purchased_l,
           ROUND(COALESCE(pre_pu.value,0),2)      pre_purchase_value,
           ROUND(COALESCE(pre_sa.litres,0),0)     pre_sold_l,
           ROUND(COALESCE(pu.litres,0),0)         purchased_l,
           ROUND(COALESCE(pu.value,0),2)          purchase_value,
           ROUND(COALESCE(sa.litres,0),0)         sold_l,
           ROUND(COALESCE(sa.value,0),2)          sales_value,
           (sob.product_id IS NOT NULL)            has_opening,
           (pu.product_id IS NOT NULL)             has_invoices
    FROM m_product p
    LEFT JOIN gl_stock_opening_balance sob ON sob.product_id = p.product_id AND sob.location_code = :loc AND sob.fy_id = :fyId
    LEFT JOIN (SELECT d.product_id,
                      SUM(CASE WHEN d.qty_unit = 'KL' THEN d.quantity * 1000 ELSE d.quantity END) litres,
                      SUM(d.total_line_amount + COALESCE(ch.amt,0)) value
               FROM t_tank_invoice ti JOIN t_tank_invoice_dtl d ON d.invoice_id = ti.id
               LEFT JOIN (SELECT invoice_dtl_id, SUM(charge_amount) amt FROM t_tank_invoice_charges GROUP BY invoice_dtl_id) ch
                      ON ch.invoice_dtl_id = d.id
               WHERE ti.location_id = :loc AND ti.invoice_date BETWEEN :from AND :to
               GROUP BY d.product_id) pu ON pu.product_id = p.product_id
    LEFT JOIN (SELECT d.product_id,
                      SUM(CASE WHEN d.qty_unit = 'KL' THEN d.quantity * 1000 ELSE d.quantity END) litres,
                      SUM(d.total_line_amount + COALESCE(ch.amt,0)) value
               FROM t_tank_invoice ti JOIN t_tank_invoice_dtl d ON d.invoice_id = ti.id
               LEFT JOIN (SELECT invoice_dtl_id, SUM(charge_amount) amt FROM t_tank_invoice_charges GROUP BY invoice_dtl_id) ch
                      ON ch.invoice_dtl_id = d.id
               WHERE ti.location_id = :loc AND ti.invoice_date >= :fyFrom AND ti.invoice_date < :from
               GROUP BY d.product_id) pre_pu ON pre_pu.product_id = p.product_id
    LEFT JOIN (SELECT mp.product_id, SUM(tr.closing_reading - tr.opening_reading - tr.testing) litres,
                      SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) value
               FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
               JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
               GROUP BY mp.product_id) sa ON sa.product_id = p.product_id
    LEFT JOIN (SELECT mp.product_id, SUM(tr.closing_reading - tr.opening_reading - tr.testing) litres
               FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
               JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED'
                 AND DATE(tc.closing_date) >= :fyFrom AND DATE(tc.closing_date) < :from
               GROUP BY mp.product_id) pre_sa ON pre_sa.product_id = p.product_id
    WHERE p.location_code = :loc
      AND p.product_id IN (SELECT tk.product_id FROM m_tank tk WHERE tk.location_code = :loc)
    ORDER BY p.product_name`;

async function fuelPosition(r) {
    const prods = await q(FUEL_POSITION_SQL, r);
    return prods.map(p => {
        const seedL = parseFloat(p.seed_l), seedV = parseFloat(p.seed_value);
        const preInL = parseFloat(p.pre_purchased_l), preInV = parseFloat(p.pre_purchase_value);
        const openingL = seedL + preInL - parseFloat(p.pre_sold_l);
        const cost = seedL + preInL > 0 ? (seedV + preInV) / (seedL + preInL) : 0;
        return Object.assign(p, {
            opening_l: Math.round(openingL),
            opening_value: preInL || parseFloat(p.pre_sold_l) ? Math.round(openingL * cost * 100) / 100 : seedV
        });
    });
}

// ── Sales and output GST: GST Summary vs GL ─────────────────────────────────
// The GST return is filed from the GST Summary report, so its side is worked out
// exactly as that report does (report-gst-summary-dao.js):
//   - fuel (a pump product, not a lube): meter litres × pump price, plus off-meter
//     credit sales at litres × pump price; no tax. The GL posts fuel bills at the
//     pump price too, with what was billed below it in DISCOUNT ON FUEL SALES;
//   - everything else: credit and cash bills at the billed amount and the GST
//     stored on the bill (the rate in force at the sale), plus lube lines on
//     ACTIVE day bills at their stored tax.
// The GL side is what the CREDIT_SALE / CASH_SALE / DAY_BILL vouchers posted.
// Both are broken down to one line per bill and sales ledger, so a month can be
// drilled to a day and a day to the bills and vouchers behind every rupee.
// A fuel's meter is split over its bills at the pump price; whatever the bills
// don't cover (or over-cover) is its own line. "Billed below price" is shown for
// information only: both sides hold the pump-price value.

const SALE_SOURCES = ['CREDIT_SALE', 'CASH_SALE', 'DAY_BILL'];
const r2 = n => Math.round((n || 0) * 100) / 100;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monLabel = m => `${MONTHS[+m.slice(5, 7) - 1]}-${m.slice(0, 4)}`;
const fmtRs = n => '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function salesGstLines(loc, from, to) {
    const r = { loc, from, to };
    const products = await q(`
        SELECT p.product_id, p.product_name,
               COALESCE(p.cgst_percent,0) + COALESCE(p.sgst_percent,0) rate,
               COALESCE(p.is_lube_product,0) is_lube,
               (COALESCE(p.is_lube_product,0) = 0
                AND p.product_name IN (SELECT mp.product_code FROM m_pump mp WHERE mp.location_code = :loc)) is_fuel,
               ms.ledger_id sales_ledger_id, ls.ledger_name sales_ledger,
               mc.ledger_id cgst_ledger_id, mg.ledger_id sgst_ledger_id
        FROM m_product p
        LEFT JOIN gl_product_ledger_map ms ON ms.location_code = p.location_code AND ms.product_id = p.product_id AND ms.map_type = 'SALES'
        LEFT JOIN gl_ledgers ls ON ls.ledger_id = ms.ledger_id
        LEFT JOIN gl_product_ledger_map mc ON mc.location_code = p.location_code AND mc.product_id = p.product_id AND mc.map_type = 'OUTPUT_CGST'
        LEFT JOIN gl_product_ledger_map mg ON mg.location_code = p.location_code AND mg.product_id = p.product_id AND mg.map_type = 'OUTPUT_SGST'
        WHERE p.location_code = :loc`, r);
    const prod = new Map(products.map(p => [p.product_id, p]));
    const prodByName = new Map(products.map(p => [p.product_name, p]));
    const salesLedgers = new Map(), gstLedgers = new Set();
    products.forEach(p => {
        if (p.sales_ledger_id) salesLedgers.set(p.sales_ledger_id, p.sales_ledger);
        if (p.cgst_ledger_id) gstLedgers.add(p.cgst_ledger_id);
        if (p.sgst_ledger_id) gstLedgers.add(p.sgst_ledger_id);
    });

    const shiftWhere = `tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to`;
    const [meter, credits, cash, dayBills, gl] = await Promise.all([
        q(`SELECT DATE_FORMAT(tc.closing_date,'%Y-%m-%d') d, mp.product_code product_name,
                  SUM(tr.closing_reading - tr.opening_reading - tr.testing) qty,
                  SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) amount
           FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
           JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
           WHERE ${shiftWhere}
           GROUP BY 1, 2`, r),
        q(`SELECT DATE_FORMAT(tc.closing_date,'%Y-%m-%d') d, t.tcredit_id id, t.product_id, t.bill_no ref,
                  COALESCE(cl.Company_Name,'') party, t.qty, t.price, t.amount,
                  COALESCE(t.cgst_amount,0) + COALESCE(t.sgst_amount,0) tax, t.cgst_amount + t.sgst_amount tax_stored,
                  t.cgst_percent + t.sgst_percent bill_rate, COALESCE(t.off_meter_sale,0) off_meter
           FROM t_credits t JOIN t_closing tc ON tc.closing_id = t.closing_id
           LEFT JOIN m_credit_list cl ON cl.creditlist_id = t.creditlist_id
           WHERE ${shiftWhere}`, r),
        q(`SELECT DATE_FORMAT(tc.closing_date,'%Y-%m-%d') d, c.cashsales_id id, c.product_id, c.bill_no ref,
                  COALESCE(c.customer_name,'') party, c.qty, c.price, c.amount,
                  COALESCE(c.cgst_amount,0) + COALESCE(c.sgst_amount,0) tax, c.cgst_amount + c.sgst_amount tax_stored,
                  c.cgst_percent + c.sgst_percent bill_rate, 0 off_meter
           FROM t_cashsales c JOIN t_closing tc ON tc.closing_id = c.closing_id
           WHERE ${shiftWhere}`, r),
        q(`SELECT DATE_FORMAT(d.bill_date,'%Y-%m-%d') d, d.day_bill_id id, d.status, it.product_id,
                  SUM(it.quantity) qty, SUM(it.total_amount) amount, SUM(it.cgst_amount + it.sgst_amount) tax
           FROM t_day_bill d JOIN t_day_bill_header h ON h.day_bill_id = d.day_bill_id
           JOIN t_day_bill_items it ON it.header_id = h.header_id
           WHERE d.location_code = :loc AND d.bill_date BETWEEN :from AND :to
           GROUP BY d.day_bill_id, d.bill_date, d.status, it.product_id`, r),
        (salesLedgers.size || gstLedgers.size) ? q(`
           SELECT DATE_FORMAT(h.voucher_date,'%Y-%m-%d') d, h.source_type, h.source_id, jl.ledger_id,
                  MAX(h.voucher_type = 'SALES') is_sales_voucher, MIN(h.voucher_no) voucher_no,
                  COUNT(DISTINCT h.voucher_id) vouchers, SUM(jl.cr_amount - jl.dr_amount) amt
           FROM gl_journal_headers h JOIN gl_journal_lines jl ON jl.voucher_id = h.voucher_id
           WHERE h.location_code = :loc AND h.voucher_date BETWEEN :from AND :to AND jl.ledger_id IN (:ledgers)
           GROUP BY 1, 2, 3, 4`, Object.assign({ ledgers: [...salesLedgers.keys(), ...gstLedgers] }, r)) : []
    ]);

    // GL by bill: sales ledger lines keyed source+ledger, output GST lines keyed source.
    const glSales = new Map(), glGst = new Map();
    for (const g of gl) {
        const key = `${g.source_type}:${g.source_id}`;
        const amt = parseFloat(g.amt) || 0;
        if (salesLedgers.has(g.ledger_id)) {
            const k = `${key}:${g.ledger_id}`;
            const e = glSales.get(k) || { d: g.d, source_type: g.source_type, source_id: g.source_id, ledger_id: g.ledger_id, voucher_no: g.voucher_no, amt: 0, used: false };
            e.amt += amt;
            glSales.set(k, e);
        } else if (gstLedgers.has(g.ledger_id) && (SALE_SOURCES.includes(g.source_type) || Number(g.is_sales_voucher))) {
            // output GST ledgers also take payments and set-offs: only sales vouchers count here
            const e = glGst.get(key) || { d: g.d, source_type: g.source_type, source_id: g.source_id, voucher_no: g.voucher_no, amt: 0, used: false };
            e.amt += amt;
            glGst.set(key, e);
        }
    }

    const lines = [];
    const ledgerKey = p => (p && p.sales_ledger_id) ? String(p.sales_ledger_id) : 'NONE';
    const gstKey = p => p ? `GST:${parseFloat(p.rate)}` : 'GST:?';
    const takeSales = (src, id, ledgerId) => {
        const e = glSales.get(`${src}:${id}:${ledgerId}`);
        if (!e) return null;
        e.used = true;
        return e;
    };
    const takeGst = (src, id) => {
        const e = glGst.get(`${src}:${id}`);
        if (!e) return null;
        e.used = true;
        return e;
    };
    const fuelBilled = new Map();      // `${d}|${product_id}` → { qty, value } of bills at the pump price

    // Credit and cash bills
    const bills = credits.map(b => Object.assign({ src: 'CREDIT_SALE', label: 'Credit bill' }, b))
        .concat(cash.map(b => Object.assign({ src: 'CASH_SALE', label: 'Cash bill' }, b)));
    for (const b of bills) {
        const p = prod.get(b.product_id);
        const amount = parseFloat(b.amount) || 0, tax = parseFloat(b.tax) || 0, qty = parseFloat(b.qty) || 0;
        const isFuel = p && Number(p.is_fuel);
        const g = p && p.sales_ledger_id ? takeSales(b.src, b.id, p.sales_ledger_id) : null;
        const gt = takeGst(b.src, b.id);
        const glAmt = g ? g.amt : 0, glTax = gt ? gt.amt : 0;
        const base = { d: b.d, source: b.label, ref: b.ref || '', product: p ? p.product_name : `#${b.product_id}`, party: b.party, qty,
                       voucher: [g && g.voucher_no, gt && !g && gt.voucher_no].filter(Boolean).join(', ') };
        const notes = [];
        if (!g && Math.abs(amount - tax) >= 0.01) notes.push('No GL voucher in this period');
        let gstSide = 0, explained = 0, gstTax = 0, rateKey = gstKey(p);
        let expectedGl = amount - tax;
        if (isFuel) {
            const atRate = qty * (parseFloat(b.price) || 0);
            // at the pump price, as the GL posts a fuel bill with no GST on it
            gstSide = tax < 0.01 && atRate > 0 ? atRate : amount;
            expectedGl = tax < 0.01 && atRate > 0 ? atRate : amount - tax;
            if (Number(b.off_meter)) {
                notes.push('Off-meter sale');
            } else {
                explained = amount - atRate;
                if (Math.abs(explained) >= 0.5) notes.push(`Billed ${fmtRs(explained)} ${explained < 0 ? 'below' : 'above'} the pump price`);
                const k = `${b.d}|${b.product_id}`;
                const f = fuelBilled.get(k) || { qty: 0, value: 0 };
                f.qty += qty; f.value += atRate;
                fuelBilled.set(k, f);
            }
            if (tax >= 0.01) notes.push(`GST of ${fmtRs(tax)} stored on a fuel bill`);
        } else {
            // the GST stored on the bill; the product's current rate only if the bill has none
            const rate = p ? parseFloat(p.rate) : 0;
            const billRate = b.bill_rate != null ? parseFloat(b.bill_rate) : rate;
            gstTax = b.tax_stored != null ? parseFloat(b.tax_stored) : amount * rate / (100 + rate);
            gstSide = amount - gstTax;
            rateKey = `GST:${billRate}`;
            if (Math.abs(billRate - rate) >= 0.01) notes.push(`Billed at ${billRate}% GST; the product is now ${rate}%`);
        }
        if (g && Math.abs(glAmt - expectedGl) >= 0.5) notes.push('GL voucher differs from the bill: re-create accounting for the day');
        lines.push(Object.assign({ key: ledgerKey(p), gst_summary: gstSide, explained, gl: glAmt, note: notes.join('; ') }, base));
        if (gstTax || tax || glTax) {
            lines.push(Object.assign({ key: rateKey, gst_summary: gstTax, explained: 0, gl: glTax,
                note: Math.abs(gstTax - glTax) < 0.5 ? notes.filter(n => /GST/.test(n)).join('; ')
                    : isFuel ? 'Fuel: the GST Summary has no tax on it'
                    : 'GL output GST differs from the bill: re-create accounting for the day' }, base));
        }
    }

    // Day bills: one line per day bill and sales ledger (vouchers post per ledger, not per product)
    const dbGroups = new Map();
    for (const it of dayBills) {
        const p = prod.get(it.product_id);
        const k = `${it.id}:${ledgerKey(p)}`;
        const grp = dbGroups.get(k) || { d: it.d, id: it.id, status: it.status, p, products: [], qty: 0, amount: 0, tax: 0, gstSide: 0, gstTax: 0, fuel: false };
        const amount = parseFloat(it.amount) || 0, tax = parseFloat(it.tax) || 0, qty = parseFloat(it.qty) || 0;
        grp.products.push(p ? p.product_name : `#${it.product_id}`);
        grp.qty += qty; grp.amount += amount; grp.tax += tax;
        if (p && Number(p.is_fuel)) {
            grp.fuel = true;
            grp.gstSide += amount;                       // the meter's share at the pump price
            const fk = `${it.d}|${it.product_id}`;
            const f = fuelBilled.get(fk) || { qty: 0, value: 0 };
            f.qty += qty; f.value += amount;
            fuelBilled.set(fk, f);
        } else if (p && Number(p.is_lube) && it.status === 'ACTIVE') {
            grp.gstSide += amount - tax;
            grp.gstTax += tax;
        }
        dbGroups.set(k, grp);
    }
    for (const grp of dbGroups.values()) {
        const g = grp.p && grp.p.sales_ledger_id ? takeSales('DAY_BILL', grp.id, grp.p.sales_ledger_id) : null;
        const glAmt = g ? g.amt : 0;
        const notes = [];
        if (!g && Math.abs(grp.amount - grp.tax) >= 0.01) notes.push('No GL voucher in this period');
        if (grp.fuel && grp.tax >= 0.01) notes.push(`GST of ${fmtRs(grp.tax)} split out of fuel on the day bill`);
        if (grp.status !== 'ACTIVE') notes.push(`Day bill is ${grp.status}`);
        if (!grp.fuel && grp.gstSide === 0 && grp.amount) notes.push('Not a lube: the GST Summary leaves day-bill lines of this product out');
        if (g && Math.abs(glAmt - (grp.amount - grp.tax)) >= 0.5) notes.push('GL voucher differs from the day bill: re-create accounting for the day');
        lines.push({ d: grp.d, source: 'Day bill', ref: `#${grp.id}`, product: [...new Set(grp.products)].join(', '), party: '',
                     qty: grp.qty, key: ledgerKey(grp.p), gst_summary: grp.gstSide, explained: 0, gl: glAmt,
                     voucher: g ? g.voucher_no : '', note: notes.join('; ') });
    }
    // Day-bill output GST, per rate bucket (one line per day bill and rate)
    const dbTax = new Map();
    for (const it of dayBills) {
        const p = prod.get(it.product_id);
        const tax = parseFloat(it.tax) || 0;
        if (!tax) continue;
        const k = `${it.id}|${gstKey(p)}`;
        const e = dbTax.get(k) || { d: it.d, id: it.id, key: gstKey(p), products: [], tax: 0, gstTax: 0, fuel: false };
        e.products.push(p ? p.product_name : `#${it.product_id}`);
        e.tax += tax;
        if (p && Number(p.is_fuel)) e.fuel = true;
        else if (p && Number(p.is_lube) && it.status === 'ACTIVE') e.gstTax += tax;
        dbTax.set(k, e);
    }
    const dbTaxByBill = new Map();
    for (const e of dbTax.values()) dbTaxByBill.set(e.id, (dbTaxByBill.get(e.id) || []).concat(e));
    for (const [id, parts] of dbTaxByBill) {
        const gt = takeGst('DAY_BILL', id);
        let glLeft = gt ? gt.amt : 0;
        const total = parts.reduce((s, e) => s + e.tax, 0);
        parts.forEach((e, i) => {
            // GL keeps one GST line set per voucher: share it over rate buckets by the stored tax
            const glTax = i === parts.length - 1 ? glLeft : (gt ? gt.amt * e.tax / total : 0);
            glLeft -= glTax;
            lines.push({ d: e.d, source: 'Day bill', ref: `#${id}`, product: [...new Set(e.products)].join(', '), party: '', qty: null,
                         key: e.key, gst_summary: e.gstTax, explained: 0, gl: glTax, voucher: gt ? gt.voucher_no : '',
                         note: e.fuel ? 'GST split out of fuel on the day bill: the GST Summary has no tax on fuel' : '' });
        });
    }

    // Meter not covered by bills, per fuel and day
    for (const m of meter) {
        const p = prodByName.get(m.product_name);
        if (!p || !Number(p.is_fuel)) continue;
        const f = fuelBilled.get(`${m.d}|${p.product_id}`) || { qty: 0, value: 0 };
        fuelBilled.delete(`${m.d}|${p.product_id}`);
        const gap = (parseFloat(m.amount) || 0) - f.value;
        if (Math.abs(gap) < 0.01) continue;
        lines.push({ d: m.d, source: 'Meter', ref: '', product: p.product_name, party: '', qty: (parseFloat(m.qty) || 0) - f.qty,
                     key: ledgerKey(p), gst_summary: gap, explained: 0, gl: 0, voucher: '',
                     note: Math.abs(gap) < 0.5 ? 'Rounding'
                         : gap > 0 ? 'Meter value not covered by bills: day bill missing or out of date'
                         : 'Bills exceed the meter: day bill over-billed' });
    }
    // Fuel bills on a day with no meter reading for that fuel (the GST Summary has no value for them)
    for (const [k, f] of fuelBilled) {
        const [d, pid] = k.split('|');
        const p = prod.get(parseInt(pid, 10));
        if (Math.abs(f.value) < 0.01) continue;
        lines.push({ d, source: 'Meter', ref: '', product: p ? p.product_name : pid, party: '', qty: -f.qty,
                     key: ledgerKey(p), gst_summary: -f.value, explained: 0, gl: 0, voucher: '',
                     note: 'Fuel billed on a day with no meter reading for it' });
    }

    // GL on these ledgers that no bill accounts for (manual journals, deleted bills, other sources)
    for (const e of glSales.values()) {
        if (e.used || Math.abs(e.amt) < 0.01) continue;
        lines.push({ d: e.d, source: `GL ${e.source_type}`, ref: e.source_id ? `#${e.source_id}` : '', product: '', party: '', qty: null,
                     key: String(e.ledger_id), gst_summary: 0, explained: 0, gl: e.amt, voucher: e.voucher_no,
                     note: SALE_SOURCES.includes(e.source_type) ? 'GL voucher whose bill is no longer there (or is in another period)' : 'Posted to the sales ledger outside the sales vouchers' });
    }
    for (const e of glGst.values()) {
        if (e.used || Math.abs(e.amt) < 0.01) continue;
        lines.push({ d: e.d, source: `GL ${e.source_type}`, ref: e.source_id ? `#${e.source_id}` : '', product: '', party: '', qty: null,
                     key: 'GST:?', gst_summary: 0, explained: 0, gl: e.amt, voucher: e.voucher_no,
                     note: SALE_SOURCES.includes(e.source_type) ? 'GL output GST whose bill is no longer there (or is in another period)' : 'Sales voucher posting output GST with no bill' });
    }

    lines.forEach(l => { l.unexplained = l.gl - l.gst_summary; });
    const keyLabel = key => {
        if (key === 'NONE') return '(no sales ledger mapped)';
        if (key === 'GST:?') return 'Output GST (no bill)';
        if (key.startsWith('GST:')) return `Output GST @ ${key.slice(4)}%`;
        return salesLedgers.get(parseInt(key, 10)) || `Ledger #${key}`;
    };
    const fuelLedgers = new Set(products.filter(p => Number(p.is_fuel)).map(p => ledgerKey(p)));
    const keyKind = key => key.startsWith('GST:') ? 'Output GST' : (fuelLedgers.has(key) ? 'Fuel sales' : 'GST goods sales');
    return { lines, keyLabel, keyKind };
}

// Sums lines by a grouping function; keeps first-seen order of groups.
function rollUp(lines, groupOf) {
    const map = new Map();
    for (const l of lines) {
        const k = groupOf(l);
        const e = map.get(k) || { k, gst_summary: 0, explained: 0, gl: 0, unexplained: 0 };
        e.gst_summary += l.gst_summary; e.explained += l.explained; e.gl += l.gl; e.unexplained += l.unexplained;
        map.set(k, e);
    }
    return [...map.values()];
}

const keyOrder = (kind, label) => ({ 'Fuel sales': 0, 'GST goods sales': 1, 'Output GST': 2 }[kind] + '|' + label);

const SALES_GST_CODE = 'A04';

// Drill-down for the sales check: a month → its days; a day → its bills and vouchers.
async function drillSalesGst(locationCode, fy, params) {
    const mon = /^\d{4}-\d{2}$/.test(params.mon || '') ? params.mon : null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day || '') ? params.day : null;
    const key = String(params.key || '');
    if (!mon || !/^(\d+|NONE|GST:[\d.?]+)$/.test(key)) throw new Error('Bad drill-down parameters');
    const monStart = `${mon}-01`;
    const monEnd = new Date(Date.UTC(+mon.slice(0, 4), +mon.slice(5, 7), 0)).toISOString().slice(0, 10);
    const from = day || (monStart > fy.start_date ? monStart : fy.start_date);
    const to = day || (monEnd < fy.end_date ? monEnd : fy.end_date);
    if (from < fy.start_date || to > fy.end_date) throw new Error('Date is outside the financial year');

    const tol = (await getBand(locationCode, 'HC_SALES_GST_TOL'))[1];
    const { lines, keyLabel } = await salesGstLines(locationCode, from, to);
    const mine = lines.filter(l => l.key === key);
    const title = `${keyLabel(key)} · ${day ? day.split('-').reverse().join('-') : monLabel(mon)}`;

    if (!day) {
        const rows = rollUp(mine, l => l.d).sort((a, b) => a.k < b.k ? -1 : 1).map(e => ({
            day: e.k, gst_summary: r2(e.gst_summary), billed_below_price: r2(e.explained), gl: r2(e.gl), unexplained: r2(e.unexplained),
            result: Math.abs(e.unexplained) > Math.max(tol, 0.5) ? 'fail' : '',
            _drill: { mon, key, day: e.k }
        }));
        return { title, level: 'day', rows };
    }
    const rows = mine
        .sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained))
        .map(l => ({
            source: l.source, bill: l.ref, product: l.product, party: l.party,
            qty: l.qty == null ? null : Math.round(l.qty * 1000) / 1000,
            gst_summary: r2(l.gst_summary), billed_below_price: r2(l.explained), gl: r2(l.gl), unexplained: r2(l.unexplained),
            voucher: l.voucher || '', note: l.note,
            result: Math.abs(l.unexplained) >= 0.5 ? 'fail' : ''
        }));
    return { title, level: 'bill', rows };
}

// ── The checks ───────────────────────────────────────────────────────────────
// run(ctx) → { rows, status?, summary?, amount?, showAll? }. Without a status, any row = `severity`.
// showAll = the rows are a full listing; only rows whose `result` is fail / warn count as problems.

const CHECKS = [
    {
        code: 'P03', stage: 'PRE', severity: 'warn',
        title: 'Bank debits tagged CASH',
        why: 'A bank debit tagged CASH is booked as cash taken out of the bank into the drawer. Unless it really was a cash withdrawal, cash in hand ends up too high and the real payment or expense is missing.',
        fix: 'Real cash withdrawals are fine. Anything else (oil-company payments, rent, salary, EMI) needs reclassifying on the bank statement screen.',
        fixUrl: '/bank-statement',
        run: async c => {
            const rows = await q(`
                SELECT t.t_bank_id, t.trans_date, b.bank_name, t.debit_amount, LEFT(TRIM(t.remarks), 80) remarks
                FROM t_bank_transaction t
                JOIN m_bank b ON b.bank_id = t.bank_id AND COALESCE(b.is_oil_company,'N') <> 'Y'
                WHERE b.location_code = :loc AND t.trans_date BETWEEN :from AND :to
                  AND t.ledger_name = 'CASH' AND t.debit_amount > 0
                ORDER BY t.debit_amount DESC`, c.r);
            return { rows, amount: sum(rows, 'debit_amount') };
        }
    },
    {
        code: 'P06', stage: 'PRE', severity: 'fail',
        title: 'Oil-company (SAP) purchases without a tank invoice',
        why: 'Every load on the oil company\'s statement needs its tank invoice in PetroMath. A missing invoice leaves its litres out of book stock and its cost out of purchases, so profit is overstated.',
        fix: 'Upload the tank invoice for each listed SAP debit (same date and amount). A cancelled load must have no invoice in PetroMath.',
        fixUrl: '/tank-invoice',
        run: async c => {
            // Purchase = any SAP debit >= 50,000 that is not a fee / charge / TDS / rent / interest / penalty /
            // cash, and not a payment to some other supplier routed through the oil-company account.
            // Label-independent: locations tag purchases OTHERS, PURCHASE, IOCL FUEL PURCHASE, and so on.
            const debits = await q(`
                SELECT t.t_bank_id, DATE_FORMAT(t.trans_date,'%Y-%m-%d') trans_date, t.debit_amount amount,
                       COALESCE(t.ledger_name,'') label, LEFT(TRIM(t.remarks), 80) remarks
                FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                WHERE b.location_code = :loc AND b.is_oil_company = 'Y'
                  AND t.trans_date BETWEEN :from AND :to AND t.debit_amount >= 50000
                  AND COALESCE(t.ledger_name,'') <> 'CASH'
                  AND UPPER(COALESCE(t.ledger_name,'')) NOT REGEXP :notPurchase
                  AND UPPER(COALESCE(t.remarks,'')) NOT REGEXP :notPurchase
                  AND NOT (t.external_source = 'Supplier' AND t.external_id <> COALESCE(b.supplier_id, -1))
                ORDER BY t.trans_date, t.t_bank_id`, Object.assign({ notPurchase: SAP_NOT_PURCHASE }, c.r));
            const credits = await q(`
                SELECT t.t_bank_id, DATE_FORMAT(t.trans_date,'%Y-%m-%d') trans_date, t.credit_amount amount,
                       COALESCE(t.ledger_name,'') label, LEFT(TRIM(t.remarks), 80) remarks
                FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                WHERE b.location_code = :loc AND b.is_oil_company = 'Y' AND t.credit_amount >= 50000
                  AND t.trans_date BETWEEN :from AND DATE_ADD(:to, INTERVAL 10 DAY)
                ORDER BY t.trans_date, t.t_bank_id`, c.r);
            const invoices = await q(`
                SELECT id, invoice_number, DATE_FORMAT(invoice_date,'%Y-%m-%d') invoice_date, total_invoice_amount amount
                FROM t_tank_invoice
                WHERE location_id = :loc AND invoice_date BETWEEN DATE_SUB(:from, INTERVAL 3 DAY) AND DATE_ADD(:to, INTERVAL 3 DAY)
                ORDER BY invoice_date, id`, c.r);

            const days = d => Date.parse(String(d).slice(0, 10)) / 864e5;
            const same = (a, b) => Math.abs(parseFloat(a) - parseFloat(b)) < 1;
            const usedInv = new Set();
            const takeInvoice = (d, maxGap) => {
                for (const gap of maxGap ? [0, 1, 2, 3] : [0]) {
                    const inv = invoices.find(i => !usedInv.has(i.id) && same(i.amount, d.amount)
                        && Math.abs(days(i.invoice_date) - days(d.trans_date)) === gap);
                    if (inv) { usedInv.add(inv.id); return { inv, gap }; }
                }
                return null;
            };

            // 1. A load undone on the statement: a credit with the same label and amount up to 10 days later
            //    that says CANCEL or repeats the debit's text (IOCL "CANCELLATION OF INVOICE"; BPCL reverses a
            //    provisional CNG debit with an identical "Invoice" credit). A bank payment that happens to equal
            //    a load carries different text, so it never undoes a load.
            //    Amounts repeat (same load size every few days), so the credit pairs with the NEAREST earlier
            //    debit: same day first, then 1 day back, and so on.
            const undone = new Map();
            for (const cr of credits) {
                const gap = x => days(cr.trans_date) - days(x.trans_date);
                const d = debits
                    .filter(x => !undone.has(x.t_bank_id) && same(x.amount, cr.amount) && x.label === cr.label
                        && gap(x) >= 0 && gap(x) <= 10
                        && (/CANCEL/i.test(cr.remarks) || cr.remarks.trim().toUpperCase() === x.remarks.trim().toUpperCase()))
                    .sort((a, b) => gap(a) - gap(b))[0];
                if (d) undone.set(d.t_bank_id, cr);
            }

            // 2. Every other debit takes an invoice of the same amount: same date first, then the nearest
            //    within 3 days. Each invoice is used once, so a neighbouring load can't hide a missing one.
            const live = debits.filter(d => !undone.has(d.t_bank_id));
            const unmatched = live.filter(d => !takeInvoice(d, false));
            const missing = [], timing = [];
            for (const d of unmatched) {
                const m = takeInvoice(d, true);
                if (m) timing.push(Object.assign({ issue: `Timing: invoice ${m.inv.invoice_number} is dated ${m.gap} day(s) apart` }, d, { result: 'info' }));
                else missing.push(Object.assign({ issue: 'No tank invoice' }, d, { result: 'fail' }));
            }

            // 3. An undone load should have no invoice; if a spare invoice still matches it, that invoice must go.
            const undoneRows = [];
            for (const d of debits.filter(x => undone.has(x.t_bank_id))) {
                const cr = undone.get(d.t_bank_id);
                const m = takeInvoice(d, true);
                undoneRows.push(Object.assign({
                    issue: m ? `Load undone by SAP line ${cr.t_bank_id} on ${cr.trans_date}, but invoice ${m.inv.invoice_number} is still in PetroMath`
                             : `Load undone by SAP line ${cr.t_bank_id} on ${cr.trans_date}: no invoice, as expected`
                }, d, { result: m ? 'warn' : 'info' }));
            }

            const stillInvoiced = undoneRows.filter(r => r.result === 'warn');
            const rows = missing.concat(stillInvoiced, timing, undoneRows.filter(r => r.result === 'info'));
            return {
                rows, showAll: true,
                status: missing.length ? 'fail' : (stillInvoiced.length ? 'warn' : 'pass'),
                amount: sum(missing, 'amount'),
                summary: `${missing.length} of ${live.length} SAP purchase(s) with no tank invoice`
                    + (stillInvoiced.length ? `, ${stillInvoiced.length} undone load(s) still invoiced` : '')
                    + (timing.length ? `, ${timing.length} matched with a 1–3 day gap` : '')
                    + (undoneRows.length - stillInvoiced.length ? `, ${undoneRows.length - stillInvoiced.length} undone load(s) settled` : '')
            };
        }
    },
    {
        code: 'P07', stage: 'PRE', severity: 'fail',
        title: 'Tank invoices that do not add up',
        why: 'Purchase cost and book stock come from each invoice\'s lines and charges. When they don\'t add up to the invoice total (for example VAT counted twice, or an invoice with no lines), cost and stock are wrong.',
        fix: 'Correct the invoice lines so lines + charges equal the invoice total, or re-upload the invoice.',
        fixUrl: '/tank-invoice',
        run: async c => {
            const rows = await q(`
                SELECT * FROM (
                    SELECT i.id, i.invoice_number, i.invoice_date, i.total_invoice_amount,
                           (SELECT COUNT(*) FROM t_tank_invoice_dtl d WHERE d.invoice_id = i.id) n_lines,
                           ROUND((SELECT COALESCE(SUM(d.total_line_amount),0) FROM t_tank_invoice_dtl d WHERE d.invoice_id = i.id)
                               + (SELECT COALESCE(SUM(ch.charge_amount),0) FROM t_tank_invoice_charges ch
                                    JOIN t_tank_invoice_dtl d ON d.id = ch.invoice_dtl_id WHERE d.invoice_id = i.id), 2) lines_plus_charges
                    FROM t_tank_invoice i
                    WHERE i.location_id = :loc AND i.invoice_date BETWEEN :from AND :to) x
                WHERE x.n_lines = 0 OR ABS(x.lines_plus_charges - x.total_invoice_amount) > 5
                ORDER BY x.invoice_date`, c.r);
            return { rows };
        }
    },
    {
        code: 'P09', stage: 'PRE', severity: 'warn',
        title: 'Salary, advances, tanker and personal costs inside OTHERS',
        why: 'Cashflow lines under the Expense head all post to OTHERS. Salary, staff advances, tanker costs, the owner\'s personal spending and taxes hidden there distort the P&L and leave advances and drawings off the balance sheet.',
        fix: 'Move the lines to the right cashflow head: Salary Payout, Salary Advance, a tanker expense head, To WithDrawals, or a tax head.',
        fixUrl: '/cashflowhome',
        run: async c => {
            const rows = await q(`
                SELECT category, COUNT(*) n, ROUND(SUM(amount),2) amount, MIN(cashflow_date) first_day, MAX(cashflow_date) last_day,
                       LEFT(GROUP_CONCAT(DISTINCT description ORDER BY description SEPARATOR ' | '), 160) examples
                FROM (
                    SELECT tcc.cashflow_date, tct.amount, TRIM(tct.description) description,
                           CASE WHEN LOWER(tct.description) REGEXP 'advance|adcance|advnce|advan|(^|[^a-z])adv([^a-z]|$)' THEN 'Staff advance'
                                WHEN LOWER(tct.description) REGEXP 'salary|salry|wages|(^|[^a-z])pay([^a-z]|$)|bonus' THEN 'Salary / wages'
                                WHEN LOWER(tct.description) REGEXP '(^|[^a-z])tt([^a-z]|$)|tanker|lorry' THEN 'Tanker truck'
                                WHEN LOWER(tct.description) REGEXP 'residence|house|home|personal|tour|withdraw' THEN 'Personal / residence'
                                WHEN LOWER(tct.description) REGEXP 'property tax|water tax|income tax|itax|(^|[^a-z])emi([^a-z]|$)|loan' THEN 'Tax or loan'
                           END category
                    FROM t_cashflow_transaction tct
                    JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
                    JOIN m_account_heads mah ON mah.account_head_id = tct.account_head_id
                    WHERE tcc.location_code = :loc AND tcc.cashflow_date BETWEEN :from AND :to
                      AND mah.account_head_name = 'Expense') x
                WHERE category IS NOT NULL
                GROUP BY category ORDER BY amount DESC`, c.r);
            return { rows, amount: sum(rows, 'amount') };
        }
    },
    {
        code: 'P10', stage: 'PRE', severity: 'fail',
        title: 'Labels with no GL rule, and cash-in skipped',
        why: 'A bank or cashflow label with no rule posts to Unclassified, or not at all. A cash-in label set to SKIP means GL never sees that cash arrive, so cash in hand is understated.',
        fix: 'Set a rule for each label on the Static Ledger Map screen. A cash-in label on SKIP is usually wrong unless it is an internal movement between shifts.',
        fixUrl: '/gl/static-ledger-map',
        run: async c => {
            const bank = await q(`
                SELECT 'Bank label, no rule' issue, t.ledger_name label, COUNT(*) n,
                       ROUND(SUM(COALESCE(t.debit_amount,0) + COALESCE(t.credit_amount,0)),2) amount
                FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                LEFT JOIN gl_static_ledger_map s ON s.location_code = b.location_code AND s.ledger_name = t.ledger_name
                WHERE b.location_code = :loc AND t.trans_date BETWEEN :from AND :to
                  AND t.ledger_name IS NOT NULL AND t.ledger_name <> 'Others'
                  AND (LOWER(t.external_source) = 'static' OR t.external_source IS NULL)
                  AND (s.treatment IS NULL OR (s.treatment = 'POST' AND s.gl_ledger_id IS NULL))
                GROUP BY t.ledger_name`, c.r);
            const cash = await q(`
                SELECT CASE WHEN s.treatment = 'SKIP' THEN 'Cash-in label on SKIP' ELSE 'Cashflow label, no rule' END issue,
                       COALESCE(mah.account_head_name, tct.type) label, COUNT(*) n, ROUND(SUM(tct.amount),2) amount
                FROM t_cashflow_transaction tct
                JOIN t_cashflow_closing tcc ON tcc.cashflow_id = tct.cashflow_id
                LEFT JOIN m_account_heads mah ON mah.account_head_id = tct.account_head_id
                LEFT JOIN gl_static_ledger_map s ON s.location_code = tcc.location_code
                     AND s.ledger_name = COALESCE(mah.account_head_name, tct.type)
                WHERE tcc.location_code = :loc AND tcc.cashflow_date BETWEEN :from AND :to AND tct.amount > 0
                  AND (s.treatment IS NULL OR (s.treatment = 'POST' AND s.gl_ledger_id IS NULL)
                       OR (s.treatment = 'SKIP' AND tct.entry_type = 'CREDIT'
                           AND COALESCE(mah.account_head_name, tct.type) NOT IN (:skipOk)))
                GROUP BY 1, 2`, Object.assign({ skipOk: CASH_IN_SKIP_OK }, c.r));
            const rows = bank.concat(cash).sort((a, b) => b.amount - a.amount);
            return { rows, amount: sum(rows, 'amount') };
        }
    },
    {
        code: 'P11', stage: 'PRE', severity: 'fail',
        title: 'Oil-company purchase lines that post to GL',
        why: 'The tank invoice already books each load as a purchase. If the matching debit on the oil company\'s statement also posts (for example to OTHERS or an expense), every load is counted twice and profit is understated by the full purchase value.',
        fix: 'Give these statement lines a purchase label whose rule is SKIP (as PURCHASE INVOICE / IOCL FUEL PURCHASE are elsewhere), or set the label\'s rule to SKIP on the Static Ledger Map screen.',
        fixUrl: '/gl/static-ledger-map',
        run: async c => {
            // Same purchase rule as P06; GL itself skips labels mapped to a Purchase Accounts ledger.
            const rows = await q(`
                SELECT COALESCE(t.ledger_name,'') label, s.treatment, COALESCE(gl.ledger_name,'(none)') posts_to,
                       COALESCE(g.group_name,'') group_name, COUNT(*) n, ROUND(SUM(t.debit_amount),2) amount,
                       MIN(t.trans_date) first_day, MAX(t.trans_date) last_day
                FROM t_bank_transaction t
                JOIN m_bank b ON b.bank_id = t.bank_id AND b.is_oil_company = 'Y'
                JOIN gl_static_ledger_map s ON s.location_code = b.location_code AND s.ledger_name = t.ledger_name
                LEFT JOIN gl_ledgers gl ON gl.ledger_id = s.gl_ledger_id
                LEFT JOIN gl_ledger_groups g ON g.group_id = gl.group_id
                WHERE b.location_code = :loc AND t.trans_date BETWEEN :from AND :to AND t.debit_amount >= 50000
                  AND COALESCE(t.ledger_name,'') <> 'CASH'
                  AND UPPER(COALESCE(t.ledger_name,'')) NOT REGEXP :notPurchase
                  AND UPPER(COALESCE(t.remarks,'')) NOT REGEXP :notPurchase
                  AND (LOWER(t.external_source) = 'static' OR t.external_source IS NULL)
                  AND s.treatment = 'POST' AND COALESCE(g.group_name,'') <> 'Purchase Accounts'
                GROUP BY 1, 2, 3, 4
                ORDER BY amount DESC`, Object.assign({ notPurchase: SAP_NOT_PURCHASE }, c.r));
            return { rows, amount: sum(rows, 'amount') };
        }
    },
    {
        code: 'P12', stage: 'PRE', severity: 'fail',
        title: 'Payments to the oil company booked in the P&L or twice',
        why: 'A payment from the bank to the oil company must reduce what is owed to it, and must post once: from the bank\'s statement, with the oil company\'s copy tagged to that bank (GL skips it). A payment label posting to an expense ledger understates profit by every rupee paid; an untagged copy on the oil company\'s statement posts the payment a second time.',
        fix: 'Point the bank-side payment label at the oil company\'s supplier ledger on the Static Ledger Map screen, and tag the oil company\'s copy of each payment to the paying bank on the oil-company statement screen.',
        fixUrl: '/gl/static-ledger-map',
        run: async c => {
            // (a) bank debits that reappear as a credit on the oil-company statement (same amount, within 3 days)
            //     but whose label posts to an income / expense ledger
            const expensed = await q(`
                SELECT 'Payment booked as P&L' issue, b.bank_name, t.ledger_name label, gl.ledger_name posts_to, g.group_name,
                       COUNT(*) n, ROUND(SUM(t.debit_amount),2) amount, MIN(t.trans_date) first_day, MAX(t.trans_date) last_day
                FROM t_bank_transaction t
                JOIN m_bank b ON b.bank_id = t.bank_id AND COALESCE(b.is_oil_company,'N') <> 'Y'
                JOIN gl_static_ledger_map s ON s.location_code = b.location_code AND s.ledger_name = t.ledger_name AND s.treatment = 'POST'
                JOIN gl_ledgers gl ON gl.ledger_id = s.gl_ledger_id
                JOIN gl_ledger_groups g ON g.group_id = gl.group_id AND g.group_nature IN ('INCOME','EXPENSES')
                WHERE b.location_code = :loc AND t.trans_date BETWEEN :from AND :to AND t.debit_amount >= 50000
                  AND (LOWER(t.external_source) = 'static' OR t.external_source IS NULL)
                  AND EXISTS (SELECT 1 FROM t_bank_transaction o JOIN m_bank ob ON ob.bank_id = o.bank_id
                              WHERE ob.location_code = :loc AND ob.is_oil_company = 'Y' AND o.credit_amount = t.debit_amount
                                AND o.trans_date BETWEEN DATE_SUB(t.trans_date, INTERVAL 3 DAY) AND DATE_ADD(t.trans_date, INTERVAL 3 DAY))
                GROUP BY 1, 2, 3, 4, 5`, c.r);
            // (b) a credit on the oil-company statement (it always reduces what is owed to the oil company) that is
            //     not tagged to a bank and not on SKIP, while a payment from our bank of the same amount within
            //     3 days ALSO reduces what is owed to that same oil company: the payment posts twice. A bank debit
            //     posting elsewhere (e.g. repaying a dealer-finance loan that paid the oil company) is not a duplicate.
            const twice = await q(`
                SELECT 'Oil-company copy not tagged to the bank' issue, ob.bank_name, o.ledger_name label,
                       COALESCE(s.treatment,'no rule') posts_to, '' group_name,
                       COUNT(*) n, ROUND(SUM(o.credit_amount),2) amount, MIN(o.trans_date) first_day, MAX(o.trans_date) last_day
                FROM t_bank_transaction o
                JOIN m_bank ob ON ob.bank_id = o.bank_id AND ob.is_oil_company = 'Y'
                LEFT JOIN gl_static_ledger_map s ON s.location_code = ob.location_code AND s.ledger_name = o.ledger_name
                WHERE ob.location_code = :loc AND o.trans_date BETWEEN :from AND :to AND o.credit_amount >= 50000
                  AND o.ledger_name IS NOT NULL
                  AND COALESCE(LOWER(o.external_source),'') NOT IN ('bank', 'supplier')
                  AND COALESCE(s.treatment,'') <> 'SKIP'
                  AND EXISTS (SELECT 1 FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                              LEFT JOIN gl_static_ledger_map ts ON ts.location_code = b.location_code AND ts.ledger_name = t.ledger_name
                              LEFT JOIN gl_ledgers tl ON tl.ledger_id = ts.gl_ledger_id
                              WHERE b.location_code = :loc AND COALESCE(b.is_oil_company,'N') <> 'Y' AND t.debit_amount = o.credit_amount
                                AND t.trans_date BETWEEN DATE_SUB(o.trans_date, INTERVAL 3 DAY) AND DATE_ADD(o.trans_date, INTERVAL 3 DAY)
                                AND ((LOWER(t.external_source) = 'supplier' AND t.external_id = ob.supplier_id)
                                     OR (ts.treatment = 'POST' AND tl.source_type = 'SUPPLIER' AND tl.source_id = ob.supplier_id)))
                GROUP BY 1, 2, 3, 4`, c.r);
            const rows = expensed.concat(twice);
            return { rows, amount: sum(rows, 'amount') };
        }
    },
    {
        code: 'A01', stage: 'POST', severity: 'fail',
        title: 'GL events not processed',
        why: 'An event in ERROR or UNPROCESSED means a sale, receipt, bank line or cashflow line is missing from the books.',
        fix: 'Fix the cause named in the error, then run Generate Missing Events and Create Accounting again.',
        fixUrl: '/gl/control',
        run: async c => {
            const rows = await q(`
                SELECT source_type, event_status, COUNT(*) n, MIN(event_date) first_day, MAX(event_date) last_day,
                       MIN(LEFT(error_message, 110)) sample_error
                FROM gl_accounting_events
                WHERE location_code = :loc AND event_date BETWEEN :from AND :to AND event_status <> 'PROCESSED'
                GROUP BY source_type, event_status ORDER BY n DESC`, c.r);
            return { rows };
        }
    },
    {
        code: 'A02', stage: 'POST', severity: 'fail',
        title: 'Unbalanced vouchers',
        why: 'Debits must equal credits on every voucher, or the trial balance will not tie.',
        fix: 'Delete and re-create accounting for the voucher dates.',
        fixUrl: '/gl/control',
        run: async c => {
            const rows = await q(`
                SELECT h.voucher_id, h.voucher_no, h.voucher_date, h.source_type,
                       ROUND(SUM(jl.dr_amount),2) dr, ROUND(SUM(jl.cr_amount),2) cr
                FROM gl_journal_headers h JOIN gl_journal_lines jl ON jl.voucher_id = h.voucher_id
                WHERE h.location_code = :loc AND h.voucher_date BETWEEN :from AND :to
                GROUP BY h.voucher_id, h.voucher_no, h.voucher_date, h.source_type
                HAVING ABS(SUM(jl.dr_amount) - SUM(jl.cr_amount)) > 0.01`, c.r);
            return { rows };
        }
    },
    {
        code: 'A03', stage: 'POST', severity: 'warn',
        title: 'Balances parked in suspense or catch-all ledgers',
        why: 'Amounts in Unclassified, General Adjustment or a Suspense group were posted without a proper ledger: they belong in the P&L or the balance sheet, and the auditor will ask about each one.',
        fix: 'Open the ledger report, find what posted each amount, and give it a proper ledger or rule.',
        fixUrl: '/gl/ledger',
        run: async c => {
            const rows = await q(`
                SELECT l.ledger_id, l.ledger_name, g.group_name, COUNT(DISTINCT h.voucher_id) vouchers,
                       ROUND(SUM(jl.dr_amount - jl.cr_amount),2) net_dr
                FROM gl_journal_headers h JOIN gl_journal_lines jl ON jl.voucher_id = h.voucher_id
                JOIN gl_ledgers l ON l.ledger_id = jl.ledger_id
                JOIN gl_ledger_groups g ON g.group_id = l.group_id
                WHERE h.location_code = :loc AND h.voucher_date BETWEEN :from AND :to
                  AND (l.ledger_name LIKE 'Unclassified%' OR l.ledger_name = 'General Adjustment' OR g.group_name LIKE 'Suspense%')
                GROUP BY l.ledger_id, l.ledger_name, g.group_name
                HAVING ABS(SUM(jl.dr_amount - jl.cr_amount)) > 0.01
                ORDER BY ABS(SUM(jl.dr_amount - jl.cr_amount)) DESC`, c.r);
            return { rows, amount: rows.reduce((s, r) => s + Math.abs(parseFloat(r.net_dr) || 0), 0) };
        }
    },
    {
        code: SALES_GST_CODE, stage: 'POST', severity: 'fail',
        title: 'Sales and output GST: GST Summary vs GL, by month',
        why: 'The GST return is filed from the GST Summary; the books are the GL. For every month, each sales ledger (fuel, oil and other GST goods) and the output GST at each rate should agree. The auditor compares the two, and any gap has to be explained bill by bill.',
        fix: 'Click a month to see its days, and a day to see every bill and voucher with a note on what is wrong. Fuel is taken at the pump price (meter plus off-meter sales), as the GST Summary reports it and the GL posts it; what bills were charged below the pump price is in DISCOUNT ON FUEL SALES, and "billed below price" is shown for information only.',
        fixUrl: '/reports-gst-summary',
        drill: true,
        run: async c => {
            const tol = (await getBand(c.loc, 'HC_SALES_GST_TOL'))[1];
            const { lines, keyLabel, keyKind } = await salesGstLines(c.loc, c.r.from, c.r.to);
            const months = rollUp(lines, l => `${l.d.slice(0, 7)}|${l.key}`);
            const rowOf = (e, mon, key) => ({
                month: mon === 'Year' ? (c.isMonth ? 'Total' : 'Year total') : monLabel(mon), kind: keyKind(key), ledger: keyLabel(key),
                gst_summary: r2(e.gst_summary), billed_below_price: r2(e.explained), gl: r2(e.gl), unexplained: r2(e.unexplained)
            });
            const rows = months.map(e => {
                const [mon, key] = e.k.split('|');
                return Object.assign(rowOf(e, mon, key), {
                    result: Math.abs(e.unexplained) > tol ? 'fail' : '',
                    _drill: { mon, key }, _sort: keyOrder(keyKind(key), keyLabel(key)) + '|' + mon
                });
            }).sort((a, b) => a._sort < b._sort ? -1 : 1);
            const totals = rollUp(lines, l => l.key).map(e => Object.assign(rowOf(e, 'Year', e.k), { result: '', _sort: keyOrder(keyKind(e.k), keyLabel(e.k)) }))
                .sort((a, b) => a._sort < b._sort ? -1 : 1);
            const bad = rows.filter(x => x.result === 'fail');
            rows.forEach(x => delete x._sort);
            totals.forEach(x => delete x._sort);
            return {
                rows: totals.concat(rows), showAll: true,          // year totals first: the auditor's view
                status: bad.length ? 'fail' : 'pass',
                amount: bad.reduce((s, x) => s + Math.abs(x.unexplained), 0),
                summary: bad.length ? `${bad.length} ledger-month(s) off by more than ₹${tol}` : `Every ledger-month within ₹${tol}`
            };
        }
    },
    {
        code: 'A07', stage: 'POST', severity: 'warn',
        title: 'Fuel margin per litre and gross profit',
        why: 'A fuel\'s margin per litre normally stays in a narrow band. Far outside it usually means a missing or doubled tank invoice, a wrong opening stock, or a pricing error.',
        fix: 'Check P06 and P07 first, then the opening stock and the tank invoices for the product.',
        fixUrl: '/gl/profit-loss',
        run: async c => {
            const prods = await fuelPosition(c.r);
            const defBand = await getBand(c.loc, 'HC_FUEL_MARGIN');
            const fuelBands = await getFuelBands(c.loc);
            let worst = 'pass', gp = 0, sales = 0;
            const rows = [];
            for (const p of prods) {
                if (parseFloat(p.sold_l) <= 0) continue;
                const judged = Number(p.has_invoices) || Number(p.has_opening);
                const litresIn = parseFloat(p.opening_l) + parseFloat(p.purchased_l);
                const avgCost = judged && litresIn > 0 ? (parseFloat(p.opening_value) + parseFloat(p.purchase_value)) / litresIn : null;
                const avgSale = parseFloat(p.sales_value) / parseFloat(p.sold_l);
                const margin = avgCost == null ? null : avgSale - avgCost;
                const band = fuelBands[String(p.product_name).toUpperCase()] || defBand;
                let status = 'info';
                if (judged && margin != null) {
                    status = (margin >= band[0] && margin <= band[1]) ? 'pass' : 'warn';
                    gp += margin * parseFloat(p.sold_l);
                    sales += parseFloat(p.sales_value);
                }
                if (status === 'warn' && worst === 'pass') worst = 'warn';
                rows.push({
                    product_name: p.product_name,
                    litres_sold: p.sold_l,
                    avg_cost_per_l: avgCost == null ? null : Math.round(avgCost * 1000) / 1000,
                    avg_sale_per_l: Math.round(avgSale * 1000) / 1000,
                    margin_per_l: margin == null ? null : Math.round(margin * 1000) / 1000,
                    band: judged ? `${band[0]} to ${band[1]}` : 'not bought on tank invoices: not judged',
                    result: status
                });
            }
            const gpBand = await getBand(c.loc, 'HC_GP_PCT_FUEL');
            const gpPct = sales ? Math.round(gp / sales * 10000) / 100 : null;
            if (gpPct != null && (gpPct < gpBand[0] || gpPct > gpBand[1]) && worst === 'pass') worst = 'warn';
            return {
                rows, status: worst, showAll: true,
                summary: gpPct == null ? 'No fuel bought on tank invoices was sold in the period'
                    : `Fuel gross profit ${gpPct}% of fuel sales (band ${gpBand[0]}–${gpBand[1]}%), before any stock shortage`
            };
        }
    },
    {
        code: 'R02', stage: 'RECON', severity: 'fail',
        title: 'Book stock at the end of the period',
        why: 'Book stock = opening + tank invoices − meter. A negative balance means invoices are missing; a fuel with no opening stock for the year gets no stock adjustment in the P&L. Compare the rest with the physical stock or dip.',
        fix: 'Negative stock: check P06. No opening stock: enter the year\'s opening stock for the product. Otherwise compare each fuel with the physical stock at the period end.',
        fixUrl: '/tank-invoice',
        run: async c => {
            const prods = await fuelPosition(c.r);
            const rows = prods
                .filter(p => Number(p.has_invoices) || Number(p.has_opening))
                .map(p => {
                    const closing = parseFloat(p.opening_l) + parseFloat(p.purchased_l) - parseFloat(p.sold_l);
                    const noOpening = !Number(p.has_opening);
                    return {
                        product_name: p.product_name, opening_l: p.opening_l, purchased_l: p.purchased_l, sold_l: p.sold_l,
                        book_closing_l: Math.round(closing),
                        note: noOpening ? 'No opening stock for the year' : '',
                        result: closing < 0 ? 'fail' : (noOpening ? 'warn' : 'info')
                    };
                });
            const negative = rows.filter(r => r.result === 'fail');
            const noOpening = rows.filter(r => r.note);
            return {
                rows, showAll: true,
                status: negative.length ? 'fail' : (noOpening.length ? 'warn' : 'pass'),
                summary: negative.length ? `${negative.length} fuel(s) with negative book stock`
                    : noOpening.length ? `${noOpening.length} fuel(s) with no opening stock for the year`
                    : rows.length ? 'Book stock is positive for every fuel; compare it with the physical stock'
                    : 'No fuel bought on tank invoices in the period'
            };
        }
    }
];

const STAGES = [
    { key: 'PRE',   label: 'Pre-flight (source data)',  hint: 'Run before Create Accounting' },
    { key: 'POST',  label: 'Post-accounting (GL)',      hint: 'Run after Create Accounting' },
    { key: 'RECON', label: 'Reconciliation',            hint: 'Run before the Tally export' }
];

async function getFinancialYears(locationCode) {
    // Dates as plain strings: a JS Date replacement would be rendered with a time zone.
    return q(`SELECT fy_id, fy_name, DATE_FORMAT(start_date,'%Y-%m-%d') start_date, DATE_FORMAT(end_date,'%Y-%m-%d') end_date, is_current
              FROM gl_financial_years WHERE location_code = :loc ORDER BY start_date DESC`, { loc: locationCode });
}

// period: { from, to } inside the FY (one month), or omitted for the whole FY.
async function runChecks(locationCode, fy, period) {
    const from = period ? period.from : fy.start_date;
    const to = period ? period.to : fy.end_date;
    const ctx = {
        loc: locationCode, isMonth: !!period,
        r: { loc: locationCode, from, to, fyFrom: fy.start_date, fyId: fy.fy_id }
    };
    const results = [];
    for (const check of CHECKS) {                       // sequential: keeps the load on prod MySQL low
        const started = Date.now();
        let res;
        try {
            res = await check.run(ctx);
        } catch (err) {
            console.error(`Health check ${check.code} failed:`, err);
            res = { rows: [], status: 'error', summary: `Check could not run: ${err.message}` };
        }
        const rows = res.rows || [];
        const status = res.status || (rows.length ? check.severity : 'pass');
        results.push({
            code: check.code, stage: check.stage, title: check.title, why: check.why, fix: check.fix, fixUrl: check.fixUrl,
            drill: !!check.drill, status,
            problemCount: res.showAll ? rows.filter(r => r.result === 'fail' || r.result === 'warn').length : rows.length,
            amount: res.amount != null ? Math.round(res.amount * 100) / 100 : null,
            summary: res.summary || (rows.length ? `${rows.length} row(s) to review` : 'Nothing found'),
            rows: rows.slice(0, MAX_ROWS),
            truncated: rows.length > MAX_ROWS,
            durationMs: Date.now() - started
        });
    }
    const counts = { pass: 0, warn: 0, fail: 0, error: 0 };
    results.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
    return { results, counts, stages: STAGES };
}

module.exports = { runChecks, getFinancialYears, drillSalesGst, SALES_GST_CODE, CHECKS, STAGES };
