// Accounting Health Check — per location, per financial year.
//
// Every check here came out of the GL audit runbook (MUE, MME and MC FY 25-26):
// each is one read-only query that returns ONLY problem rows, plus a judge that
// turns those rows into pass / warn / fail. Codes are stable (P = pre-flight on
// source data, A = after Create Accounting, R = reconciliation) so later phases
// can keep run history and accepted-exception notes against them.
//
// Design: "Accounting Health Check — design" (Claude Docs). Phase 1 = read-only,
// no history, no accept-with-note.

const db = require('../db/db-connection');
const { getLocationConfigValue } = require('../utils/location-config');

const MAX_ROWS = 500;

// Ratio bands — location setting 'min,max', global '*' default, else these.
const BAND_DEFAULTS = {
    HC_MARGIN_MS:      [3.5, 4.5],
    HC_MARGIN_HSD:     [2.2, 3.0],
    HC_MARGIN_PREMIUM: [3.5, 5.5],
    HC_GP_PCT_FUEL:    [3.0, 5.0],
    HC_SALES_GST_TOL:  [0, 1]
};

// Which band a pump product's margin is judged against, by product name.
const MARGIN_BAND_BY_PRODUCT = {
    MS: 'HC_MARGIN_MS', HSD: 'HC_MARGIN_HSD',
    XMS: 'HC_MARGIN_PREMIUM', XP: 'HC_MARGIN_PREMIUM', XP95: 'HC_MARGIN_PREMIUM', POWER: 'HC_MARGIN_PREMIUM'
};

// Cashflow CREDIT labels that are internal movements and SKIP on purpose.
const CASH_IN_SKIP_OK = ['Balance B/F', 'Collection', '2T Oil', 'Cash Receipt', 'Shift Cash Return',
                         'Cashier A/C (+)', 'Discount'];

async function getBand(locationCode, setting) {
    const raw = await getLocationConfigValue(locationCode, setting, null);
    if (raw) {
        const parts = raw.split(',').map(s => parseFloat(s));
        if (parts.length === 2 && parts.every(n => !isNaN(n))) return parts;
    }
    return BAND_DEFAULTS[setting];
}

function q(sql, replacements) {
    return db.sequelize.query(sql, { replacements, type: db.Sequelize.QueryTypes.SELECT });
}

const sum = (rows, col) => rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0);

// ── The checks ───────────────────────────────────────────────────────────────
// run(ctx) → { rows, status?, summary?, amount? }. Without a status, any row = `severity`.

const CHECKS = [
    {
        code: 'P03', stage: 'PRE', severity: 'warn',
        title: 'Bank debits tagged CASH',
        why: 'MME had 72 IOCL payments (₹6.66 Cr) tagged CASH, which put ₹6.8 Cr of cash in hand on the books.',
        fix: 'Real cash withdrawals are fine. Anything else (oil-company payments, salary, EMI) needs retagging on the bank statement screen.',
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
        why: 'MME and MC were missing 25 invoices (₹2.8 Cr). A missing invoice drops its litres from book stock and inflates profit.',
        fix: 'Upload the invoice for each listed SAP debit (same date and amount). A cancellation credit means the matching invoice must not be in PetroMath.',
        fixUrl: '/tank-invoice',
        run: async c => {
            // Purchase = any SAP debit >= 50,000 except licence fee / charges / TDS / rent / cash (ledger-name independent).
            const missing = await q(`
                WITH sap AS (
                    SELECT t.t_bank_id, t.trans_date, t.debit_amount, t.ledger_name, t.remarks
                    FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                    WHERE b.location_code = :loc AND b.is_oil_company = 'Y'
                      AND t.trans_date BETWEEN :from AND :to AND t.debit_amount >= 50000
                      AND COALESCE(t.ledger_name,'') NOT IN ('IOCL LICENSE FEE RECOVERY','IOCL CHARGES','TDS PAYMENT','RENT','CASH')
                      AND COALESCE(t.remarks,'') NOT LIKE '%LICENSE FEE%'),
                sc AS (SELECT trans_date dt, ROUND(debit_amount,0) amt, COUNT(*) n FROM sap GROUP BY 1, 2),
                ic AS (SELECT invoice_date dt, ROUND(total_invoice_amount,0) amt, COUNT(*) n
                       FROM t_tank_invoice WHERE location_id = :loc AND invoice_date BETWEEN :from AND :to GROUP BY 1, 2)
                SELECT 'No invoice' issue, s.t_bank_id, s.trans_date, s.debit_amount amount, LEFT(TRIM(s.remarks), 80) remarks
                FROM sap s
                JOIN sc ON sc.dt = s.trans_date AND sc.amt = ROUND(s.debit_amount,0)
                LEFT JOIN ic ON ic.dt = s.trans_date AND ic.amt = ROUND(s.debit_amount,0)
                WHERE sc.n > COALESCE(ic.n,0)
                ORDER BY s.trans_date`, c.r);
            const cancelled = await q(`
                SELECT t.t_bank_id, t.trans_date, t.credit_amount amount, LEFT(TRIM(t.remarks), 80) remarks
                FROM t_bank_transaction t JOIN m_bank b ON b.bank_id = t.bank_id
                WHERE b.location_code = :loc AND b.is_oil_company = 'Y'
                  AND t.trans_date BETWEEN :from AND :to AND t.credit_amount > 0
                  AND UPPER(t.remarks) LIKE '%CANCELLATION OF INVOICE%'
                ORDER BY t.trans_date`, c.r);

            // A cancellation credit undoes an SAP debit of the same amount up to 10 days earlier (MC 02-Feb-26:
            // load sent back after the tanker accident). If that debit has no invoice, the pair is settled;
            // if it does, the cancelled load's invoice is still in PetroMath and must go.
            const days = d => Date.parse(String(d).slice(0, 10)) / 864e5;
            const cancelRows = [];
            for (const cn of cancelled) {
                const i = missing.findIndex(m => parseFloat(m.amount) === parseFloat(cn.amount)
                    && days(cn.trans_date) - days(m.trans_date) >= 0 && days(cn.trans_date) - days(m.trans_date) <= 10);
                if (i >= 0) {
                    cancelRows.push(Object.assign({ issue: `Cancelled load, paired with SAP debit ${missing[i].t_bank_id}: no invoice, as expected` }, cn, { result: 'info' }));
                    missing.splice(i, 1);
                } else {
                    cancelRows.push(Object.assign({ issue: 'Cancellation credit: its load still has an invoice in PetroMath; delete it if the load never arrived' }, cn, { result: 'warn' }));
                }
            }
            missing.forEach(m => { m.result = 'fail'; });
            const open = cancelRows.filter(r => r.result === 'warn');
            return {
                rows: missing.concat(cancelRows), showAll: true,
                status: missing.length ? 'fail' : (open.length ? 'warn' : 'pass'),
                amount: sum(missing, 'amount'),
                summary: `${missing.length} SAP purchase(s) with no invoice`
                    + (open.length ? `, ${open.length} cancellation(s) whose invoice is still in PetroMath` : '')
                    + (cancelRows.length - open.length ? `, ${cancelRows.length - open.length} cancelled load(s) settled` : '')
            };
        }
    },
    {
        code: 'P07', stage: 'PRE', severity: 'fail',
        title: 'Tank invoices that do not add up',
        why: 'MME\'s Nov-25 invoices counted VAT twice (₹16.5L), cutting gross profit from 3.8% to 2.4%.',
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
        why: 'MC had ₹19.5L of salary, staff advances, tanker costs and the proprietor\'s personal spending posted to OTHERS.',
        fix: 'Move the lines to the right cashflow head (Salary Payout, SALARY ADVANCES, TANK TRUCK EXPENSES, To WithDrawals).',
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
                                WHEN LOWER(tct.description) REGEXP 'property tax|water tax|income tax|itax|emi|loan' THEN 'Tax or loan'
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
        why: 'At MC, To Deposits (₹5.97L of cash brought into the drawer) was set to SKIP, so GL never saw the cash arrive.',
        fix: 'Set a rule for each label on the Static Ledger Map screen. A cash-in label on SKIP is usually wrong unless it is an internal movement.',
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
        why: 'An event in ERROR or UNPROCESSED means a sale, bank line or cashflow line is missing from the books.',
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
        why: 'At MC, Volume Discount and reversal adjustments sat in General Adjustment (Suspense) instead of the P&L.',
        fix: 'Find the source of each posting (ledger report) and give it a proper ledger or rule.',
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
        title: 'Fuel sales in GL vs GST summary (meter), by month',
        why: 'At MME, GD and CNG day bills carried 18% GST, so ₹6.37L of sales sat in output GST instead of sales.',
        fix: 'Drill the month by day. Differences explained by credit sales billed below the pump rate are expected.',
        fixUrl: '/gl/profit-loss',
        run: async c => {
            const [lo, hi] = await getBand(c.loc, 'HC_SALES_GST_TOL');
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
                            AND p.product_name IN (SELECT DISTINCT product_code FROM m_pump WHERE location_code = :loc)) k
                    LEFT JOIN (SELECT DATE_FORMAT(tc.closing_date,'%Y-%m') mon, mp.product_code,
                                      SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) amt
                               FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
                               JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
                               WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                               GROUP BY 1, 2) mtr ON mtr.mon = k.mon AND mtr.product_code = k.product_name
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
                ORDER BY x.product_name, x.mon`, Object.assign({ tol: hi }, c.r));
            return { rows, summary: rows.length ? `${rows.length} product-month(s) off by more than ₹${hi}` : `Every product-month within ₹${hi}` };
        }
    },
    {
        code: 'A07', stage: 'POST', severity: 'warn',
        title: 'Fuel margin per litre and gross profit',
        why: 'Margins outside the usual band point at a missing or doubled invoice, wrong opening stock, or a pricing error.',
        fix: 'Check P06 and P07 first, then the opening stock and the tank invoices for the product.',
        fixUrl: '/gl/profit-loss',
        run: async c => {
            // Weighted average cost = (opening seed + tank invoice lines and charges) / litres; sales from the meter.
            const prods = await q(`
                SELECT p.product_name,
                       ROUND(COALESCE(sa.litres,0),0) litres_sold,
                       ROUND(COALESCE(sa.value,0),2) sales_value,
                       ROUND((COALESCE(sob.opening_value,0) + COALESCE(pu.value,0))
                             / NULLIF(COALESCE(sob.opening_qty,0) + COALESCE(pu.litres,0),0),3) avg_cost_per_l,
                       ROUND(COALESCE(sa.value,0) / NULLIF(sa.litres,0),3) avg_sale_per_l
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
                LEFT JOIN (SELECT mp.product_code, SUM(tr.closing_reading - tr.opening_reading - tr.testing) litres,
                                  SUM((tr.closing_reading - tr.opening_reading - tr.testing) * tr.price) value
                           FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
                           JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
                           WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                           GROUP BY mp.product_code) sa ON sa.product_code = p.product_name
                WHERE p.location_code = :loc
                  AND p.product_name IN (SELECT DISTINCT product_code FROM m_pump WHERE location_code = :loc)
                  AND COALESCE(sa.litres,0) > 0
                ORDER BY p.product_name`, c.r);

            let worst = 'pass', gp = 0, sales = 0;
            const rows = [];
            for (const p of prods) {
                const margin = p.avg_cost_per_l == null ? null : parseFloat(p.avg_sale_per_l) - parseFloat(p.avg_cost_per_l);
                const setting = MARGIN_BAND_BY_PRODUCT[String(p.product_name).toUpperCase()];
                const band = setting ? await getBand(c.loc, setting) : null;
                let status = 'info';
                if (margin == null) status = 'fail';                       // sold but never bought: no invoices, no opening
                else if (band) status = (margin >= band[0] && margin <= band[1]) ? 'pass' : 'warn';
                if (status === 'fail' || (status === 'warn' && worst === 'pass')) worst = status;
                if (margin != null) { gp += margin * parseFloat(p.litres_sold); sales += parseFloat(p.sales_value); }
                rows.push(Object.assign({}, p, {
                    margin_per_l: margin == null ? null : Math.round(margin * 1000) / 1000,
                    band: band ? `${band[0]} to ${band[1]}` : 'no band',
                    result: status
                }));
            }
            const gpBand = await getBand(c.loc, 'HC_GP_PCT_FUEL');
            const gpPct = sales ? Math.round(gp / sales * 10000) / 100 : null;
            if (gpPct != null && (gpPct < gpBand[0] || gpPct > gpBand[1]) && worst === 'pass') worst = 'warn';
            return {
                rows, status: worst, showAll: true,
                summary: gpPct == null ? 'No fuel sold in the period'
                    : `Fuel gross profit ${gpPct}% of sales (band ${gpBand[0]}–${gpBand[1]}%), before stock shortage`
            };
        }
    },
    {
        code: 'R02', stage: 'RECON', severity: 'fail',
        title: 'Book stock at the end of the period',
        why: 'Book stock = opening + tank invoices − meter. A negative balance means invoices are missing; compare the rest with the dip.',
        fix: 'Negative stock: check P06. Otherwise compare each product with the physical stock or dip at the period end.',
        fixUrl: '/tank-invoice',
        run: async c => {
            const prods = await q(`
                SELECT p.product_name,
                       ROUND(COALESCE(sob.opening_qty,0),0) opening_l,
                       ROUND(COALESCE(pu.litres,0),0) purchased_l,
                       ROUND(COALESCE(sa.litres,0),0) sold_l,
                       ROUND(COALESCE(sob.opening_qty,0) + COALESCE(pu.litres,0) - COALESCE(sa.litres,0),0) book_closing_l,
                       CASE WHEN sob.product_id IS NULL THEN 'No opening stock entered' ELSE '' END note
                FROM m_product p
                LEFT JOIN gl_stock_opening_balance sob ON sob.product_id = p.product_id AND sob.location_code = :loc AND sob.fy_id = :fyId
                LEFT JOIN (SELECT d.product_id, SUM(CASE WHEN d.qty_unit = 'KL' THEN d.quantity * 1000 ELSE d.quantity END) litres
                           FROM t_tank_invoice ti JOIN t_tank_invoice_dtl d ON d.invoice_id = ti.id
                           WHERE ti.location_id = :loc AND ti.invoice_date BETWEEN :from AND :to
                           GROUP BY d.product_id) pu ON pu.product_id = p.product_id
                LEFT JOIN (SELECT mp.product_code, SUM(tr.closing_reading - tr.opening_reading - tr.testing) litres
                           FROM t_closing tc JOIN t_reading tr ON tr.closing_id = tc.closing_id
                           JOIN m_pump mp ON mp.pump_id = tr.pump_id AND DATE(tc.closing_date) BETWEEN mp.effective_start_date AND mp.effective_end_date
                           WHERE tc.location_code = :loc AND tc.closing_status = 'CLOSED' AND DATE(tc.closing_date) BETWEEN :from AND :to
                           GROUP BY mp.product_code) sa ON sa.product_code = p.product_name
                WHERE p.location_code = :loc
                  AND p.product_name IN (SELECT DISTINCT product_code FROM m_pump WHERE location_code = :loc)
                ORDER BY p.product_name`, c.r);
            const negative = prods.filter(p => parseFloat(p.book_closing_l) < 0);
            const noOpening = prods.filter(p => p.note);
            prods.forEach(p => { p.result = parseFloat(p.book_closing_l) < 0 ? 'fail' : (p.note ? 'warn' : 'info'); });
            return {
                rows: prods, showAll: true,
                status: negative.length ? 'fail' : (noOpening.length ? 'warn' : 'pass'),
                summary: negative.length ? `${negative.length} product(s) with negative book stock`
                    : noOpening.length ? `${noOpening.length} product(s) with no opening stock for the year`
                    : 'Book stock is positive for every fuel; compare it with the dip'
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
            problemCount: res.showAll ? rows.filter(r => r.result && r.result !== 'pass' && r.result !== 'info').length : rows.length,
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
