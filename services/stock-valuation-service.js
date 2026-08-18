// services/stock-valuation-service.js
// On-the-fly stock-adjusted COGS — no persisted running balance (see
// gl_stock_opening_balance for why: this domain backdates invoices
// routinely, and a live-updated balance would need the same
// correction-cascade machinery already built for gl_static_ledger_map).
//
// Instead: one seed row per (location, product, FY) in
// gl_stock_opening_balance, then every call here replays that FY's
// purchases and sales chronologically (day-by-day: purchases before that
// day's sales) using weighted-average costing, bounded by FY start — so
// cost stays manageable within a single financial year. At FY close, the
// computed closing balance gets written down once as the next FY's opening
// row (source='FY_CLOSE') — not implemented yet, deferred until a FY
// actually needs closing.
//
// Known gap: BOWSER_CASH_SALE / BOWSER_DIGITAL_SALE are payment-mode-only
// records (no product_id or quantity), so their fuel volume can't be
// subtracted from the running balance. Immaterial where those modes aren't
// used; overstates closing stock / understates COGS slightly otherwise.

const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

async function getOpeningBalances(locationCode, fyId) {
    return db.sequelize.query(`
        SELECT sob.product_id, p.product_name, sob.opening_qty, sob.opening_value
        FROM gl_stock_opening_balance sob
        JOIN m_product p ON p.product_id = sob.product_id
        WHERE sob.location_code = :locationCode AND sob.fy_id = :fyId
    `, { replacements: { locationCode, fyId }, type: QueryTypes.SELECT });
}

// { d: 'YYYY-MM-DD', qty, value } per day, purchases only, for one product.
async function getDailyPurchases(locationCode, productId, fromDate, toDate) {
    const tankRows = await db.sequelize.query(`
        SELECT DATE(ti.invoice_date) AS d,
               SUM(CASE WHEN td.qty_unit = 'KL' THEN td.quantity * 1000 ELSE td.quantity END) AS qty,
               SUM(td.total_line_amount + COALESCE(chg.charge_total, 0)) AS value
        FROM t_tank_invoice_dtl td
        JOIN t_tank_invoice ti ON ti.id = td.invoice_id
        LEFT JOIN (
            SELECT invoice_dtl_id, SUM(charge_amount) AS charge_total
            FROM t_tank_invoice_charges
            GROUP BY invoice_dtl_id
        ) chg ON chg.invoice_dtl_id = td.id
        WHERE ti.location_id = :locationCode AND td.product_id = :productId
          AND ti.invoice_date BETWEEN :fromDate AND :toDate
        GROUP BY DATE(ti.invoice_date)
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    const lubesRows = await db.sequelize.query(`
        SELECT DATE(h.invoice_date) AS d, SUM(l.qty) AS qty, SUM(l.taxable_value) AS value
        FROM t_lubes_inv_lines l
        JOIN t_lubes_inv_hdr h ON h.lubes_hdr_id = l.lubes_hdr_id
        WHERE h.location_code = :locationCode AND l.product_id = :productId
          AND h.closing_status = 'CLOSED'
          AND h.invoice_date BETWEEN :fromDate AND :toDate
        GROUP BY DATE(h.invoice_date)
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    return [...tankRows, ...lubesRows];
}

// { d: 'YYYY-MM-DD', qty } per day, sold quantity only, for one product —
// value isn't needed here, COGS is computed from the running average, not
// from what any individual channel recorded as revenue.
async function getDailySoldQty(locationCode, productId, fromDate, toDate) {
    const dayBill = await db.sequelize.query(`
        SELECT tdb.bill_date AS d, SUM(tdi.quantity) AS qty
        FROM t_day_bill_items tdi
        JOIN t_day_bill_header tdh ON tdh.header_id = tdi.header_id
        JOIN t_day_bill tdb ON tdb.day_bill_id = tdh.day_bill_id
        WHERE tdb.location_code = :locationCode AND tdi.product_id = :productId
          AND tdb.bill_date BETWEEN :fromDate AND :toDate
        GROUP BY tdb.bill_date
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    const creditSale = await db.sequelize.query(`
        SELECT DATE(cl.closing_date) AS d, SUM(tc.qty) AS qty
        FROM t_credits tc
        JOIN t_closing cl ON cl.closing_id = tc.closing_id
        WHERE cl.location_code = :locationCode AND tc.product_id = :productId
          AND DATE(cl.closing_date) BETWEEN :fromDate AND :toDate
        GROUP BY DATE(cl.closing_date)
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    const cashSale = await db.sequelize.query(`
        SELECT DATE(cl.closing_date) AS d, SUM(cs.qty) AS qty
        FROM t_cashsales cs
        JOIN t_closing cl ON cl.closing_id = cs.closing_id
        WHERE cl.location_code = :locationCode AND cs.product_id = :productId
          AND DATE(cl.closing_date) BETWEEN :fromDate AND :toDate
        GROUP BY DATE(cl.closing_date)
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    const bowserCredit = await db.sequelize.query(`
        SELECT DATE(tbc.closing_date) AS d, SUM(bc.quantity) AS qty
        FROM t_bowser_credits bc
        JOIN t_bowser_closing tbc ON tbc.bowser_closing_id = bc.bowser_closing_id
        WHERE tbc.location_code = :locationCode AND bc.product_id = :productId
          AND DATE(tbc.closing_date) BETWEEN :fromDate AND :toDate
        GROUP BY DATE(tbc.closing_date)
    `, { replacements: { locationCode, productId, fromDate, toDate }, type: QueryTypes.SELECT });

    return [...dayBill, ...creditSale, ...cashSale, ...bowserCredit];
}

function toDateStr(d) {
    return typeof d === 'string' ? d.substring(0, 10) : d.toISOString().substring(0, 10);
}

// Merges same-day purchase/sale rows, replays weighted-average costing from
// the opening balance forward, and returns COGS for [fromDate, toDate] plus
// the closing balance as of toDate. fromDate/toDate must fall inside the FY
// gl_stock_opening_balance was seeded for.
async function computeProductStockCOGS(locationCode, fyId, productId, fromDate, toDate) {
    const [fy] = await db.sequelize.query(`
        SELECT start_date FROM gl_financial_years WHERE fy_id = :fyId
    `, { replacements: { fyId }, type: QueryTypes.SELECT });
    if (!fy) throw new Error(`Financial year not found: fy_id=${fyId}`);
    const fyStart = toDateStr(fy.start_date);

    const [opening] = await db.sequelize.query(`
        SELECT opening_qty, opening_value FROM gl_stock_opening_balance
        WHERE location_code = :locationCode AND product_id = :productId AND fy_id = :fyId
    `, { replacements: { locationCode, productId, fyId }, type: QueryTypes.SELECT });
    if (!opening) return null; // not a stock-tracked product for this FY — caller falls back to raw purchases

    const [purchases, soldQty] = await Promise.all([
        getDailyPurchases(locationCode, productId, fyStart, toDate),
        getDailySoldQty(locationCode, productId, fyStart, toDate)
    ]);

    const byDay = new Map(); // 'YYYY-MM-DD' -> { purchaseQty, purchaseValue, soldQty }
    const ensureDay = (d) => {
        if (!byDay.has(d)) byDay.set(d, { purchaseQty: 0, purchaseValue: 0, soldQty: 0 });
        return byDay.get(d);
    };
    for (const r of purchases) {
        const day = ensureDay(toDateStr(r.d));
        day.purchaseQty   += parseFloat(r.qty)   || 0;
        day.purchaseValue += parseFloat(r.value) || 0;
    }
    for (const r of soldQty) {
        const day = ensureDay(toDateStr(r.d));
        day.soldQty += parseFloat(r.qty) || 0;
    }

    const orderedDays = [...byDay.keys()].sort();
    const fromDateStr = toDateStr(fromDate);
    const toDateStr_   = toDateStr(toDate);

    let runningQty   = parseFloat(opening.opening_qty);
    let runningValue = parseFloat(opening.opening_value);
    let cogsBeforeFrom = 0;
    let cogsThroughTo   = 0;

    for (const day of orderedDays) {
        if (day > toDateStr_) break;

        const { purchaseQty, purchaseValue, soldQty: qtySold } = byDay.get(day);

        // Purchases land before that day's sales — stock arrives, then gets sold.
        runningQty   += purchaseQty;
        runningValue += purchaseValue;

        let cogsToday = 0;
        if (qtySold > 0) {
            const avgCost = runningQty > 0 ? runningValue / runningQty : 0;
            cogsToday     = qtySold * avgCost;
            runningQty   -= qtySold;
            runningValue -= cogsToday;
        }

        cogsThroughTo += cogsToday;
        if (day < fromDateStr) cogsBeforeFrom += cogsToday;
    }

    return {
        productId,
        cogs: cogsThroughTo - cogsBeforeFrom,
        closingQty: runningQty,
        closingValue: runningValue
    };
}

// All stock-tracked products (i.e. every product with a gl_stock_opening_balance
// row) for a location + FY, in one call — what the P&L route actually needs.
async function computeStockCOGS(locationCode, fyId, fromDate, toDate) {
    const openings = await getOpeningBalances(locationCode, fyId);
    const results = [];
    for (const o of openings) {
        const r = await computeProductStockCOGS(locationCode, fyId, o.product_id, fromDate, toDate);
        if (r) results.push({ ...r, productName: o.product_name });
    }
    return results;
}

module.exports = { computeStockCOGS, computeProductStockCOGS };
