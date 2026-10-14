// Accounting Health Check — per location, per financial year.
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

// Fuel position per tank product for the year: opening seed + tank invoices − meter.
// A product counts as fuel when it has a tank here; it is judged only when it was
// bought on tank invoices or has a GL opening seed (2T loose, AdBlue etc. are not).
const FUEL_POSITION_SQL = `
    SELECT p.product_id, p.product_name,
           ROUND(COALESCE(sob.opening_qty,0),0)   opening_l,
           ROUND(COALESCE(sob.opening_value,0),2) opening_value,
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
    LEFT JOIN (SELECT mp.product_id, SUM(tr.closing_reading - tr.opening_reading - tr.testing) litres,
                      SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) value
               FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
               JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
               GROUP BY mp.product_id) sa ON sa.product_id = p.product_id
    WHERE p.location_code = :loc
      AND p.product_id IN (SELECT tk.product_id FROM m_tank tk WHERE tk.location_code = :loc)
    ORDER BY p.product_name`;

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
        code: 'A04', stage: 'POST', severity: 'fail',
        title: 'Metered sales in GL vs GST summary (meter), by month',
        why: 'Sales in GL should equal the meter reading value for every product and month. A gap means missing or stale day bills, GST wrongly charged on fuel, or day bills that exceed the meter.',
        fix: 'Drill the month by day. Differences explained by credit sales billed below the pump rate are expected and already netted here.',
        fixUrl: '/gl/profit-loss',
        run: async c => {
            const tol = (await getBand(c.loc, 'HC_SALES_GST_TOL'))[1];
            const rows = await q(`
                SELECT * FROM (
                    SELECT k.mon, k.product_name,
                           ROUND(COALESCE(mtr.amt,0),2) gst_summary,
                           ROUND(COALESCE(gl.amt,0),2) gl_sales,
                           ROUND(COALESCE(cr.price_diff,0),2) credit_below_rate,
                           ROUND(COALESCE(gl.amt,0) - COALESCE(mtr.amt,0) + COALESCE(db.gst_amt,0) - COALESCE(cr.price_diff,0),2) unexplained
                    FROM (SELECT DISTINCT DATE_FORMAT(tc.closing_date,'%Y-%m') mon, p.product_id, p.product_name, m.ledger_id
                          FROM t_closing tc
                          JOIN m_product p ON p.location_code = tc.location_code
                          LEFT JOIN gl_product_ledger_map m ON m.product_id = p.product_id AND m.location_code = p.location_code AND m.map_type = 'SALES'
                          WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                            AND p.product_id IN (SELECT mp.product_id FROM m_pump mp WHERE mp.location_code = :loc)) k
                    LEFT JOIN (SELECT DATE_FORMAT(tc.closing_date,'%Y-%m') mon, mp.product_id,
                                      SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) amt
                               FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
                               JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
                               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                               GROUP BY 1, 2) mtr ON mtr.mon = k.mon AND mtr.product_id = k.product_id
                    LEFT JOIN (SELECT DATE_FORMAT(tc.closing_date,'%Y-%m') mon, t.product_id, SUM(t.amount - t.qty * t.price) price_diff
                               FROM t_credits t JOIN t_closing tc ON tc.closing_id = t.closing_id
                               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                                 AND COALESCE(t.off_meter_sale,0) = 0
                               GROUP BY 1, 2) cr ON cr.mon = k.mon AND cr.product_id = k.product_id
                    LEFT JOIN (SELECT DATE_FORMAT(d.bill_date,'%Y-%m') mon, it.product_id, SUM(it.cgst_amount + it.sgst_amount) gst_amt
                               FROM t_day_bill d JOIN t_day_bill_header h ON h.day_bill_id = d.day_bill_id
                               JOIN t_day_bill_items it ON it.header_id = h.header_id
                               WHERE d.location_code = :loc AND d.bill_date BETWEEN :from AND :to
                               GROUP BY 1, 2) db ON db.mon = k.mon AND db.product_id = k.product_id
                    LEFT JOIN (SELECT DATE_FORMAT(h.voucher_date,'%Y-%m') mon, jl.ledger_id, SUM(jl.cr_amount - jl.dr_amount) amt
                               FROM gl_journal_headers h JOIN gl_journal_lines jl ON jl.voucher_id = h.voucher_id
                               WHERE h.location_code = :loc AND h.voucher_date BETWEEN :from AND :to
                               GROUP BY 1, 2) gl ON gl.mon = k.mon AND gl.ledger_id = k.ledger_id) x
                WHERE ABS(x.unexplained) > :tol
                ORDER BY x.product_name, x.mon`, Object.assign({ tol }, c.r));
            return { rows, summary: rows.length ? `${rows.length} product-month(s) off by more than ₹${tol}` : `Every product-month within ₹${tol}` };
        }
    },
    {
        code: 'A07', stage: 'POST', severity: 'warn',
        title: 'Fuel margin per litre and gross profit',
        why: 'A fuel\'s margin per litre normally stays in a narrow band. Far outside it usually means a missing or doubled tank invoice, a wrong opening stock, or a pricing error.',
        fix: 'Check P06 and P07 first, then the opening stock and the tank invoices for the product.',
        fixUrl: '/gl/profit-loss',
        run: async c => {
            const prods = await q(FUEL_POSITION_SQL, c.r);
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
            const prods = await q(FUEL_POSITION_SQL, c.r);
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

async function runChecks(locationCode, fy) {
    const ctx = {
        loc: locationCode,
        r: { loc: locationCode, from: fy.start_date, to: fy.end_date, fyId: fy.fy_id }
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
            status,
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

module.exports = { runChecks, getFinancialYears, CHECKS, STAGES };
