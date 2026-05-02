// routes/gl-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const db = require('../db/db-connection');
const createAccountingService = require('../services/create-accounting-service');

// GET /gl/api/ledgers/search?location=&group=&q=
// Returns [{ledger_id, ledger_name}] — used by Select2 ajax typeahead on product ledger fields
router.get('/api/ledgers/search', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.query.location || req.user.location_code;
    const group = req.query.group || null;
    const q = req.query.q || null;

    try {
        const rows = await db.sequelize.query(`
            SELECT l.ledger_id, l.ledger_name
            FROM gl_ledgers l
            JOIN gl_ledger_groups g ON g.group_id = l.group_id
            WHERE l.location_code = :locationCode
              AND l.active_flag = 'Y'
              AND (:group IS NULL OR g.group_name = :group)
              AND (:q IS NULL OR l.ledger_name LIKE :qLike)
            ORDER BY l.ledger_name
            LIMIT 30
        `, {
            replacements: {
                locationCode,
                group,
                q,
                qLike: q ? `%${q}%` : null
            },
            type: db.Sequelize.QueryTypes.SELECT
        });

        res.json(rows);
    } catch (error) {
        console.error('Error searching ledgers:', error);
        res.status(500).json({ error: 'Failed to search ledgers' });
    }
});

// POST /gl/api/create-accounting
// Body: { from_date, to_date }
// Runs Create Accounting for the location and date range.
router.post('/api/create-accounting', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const processedBy  = req.user.username;
    const { from_date, to_date, reprocess } = req.body;

    if (!from_date || !to_date) {
        return res.status(400).json({ error: 'from_date and to_date are required' });
    }

    try {
        const fn = reprocess === true || reprocess === 'true'
            ? createAccountingService.reprocessEvents
            : createAccountingService.processEvents;

        const summary = await fn(locationCode, from_date, to_date, processedBy);
        res.json({ success: true, summary });
    } catch (err) {
        console.error('Create Accounting error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /gl/api/accounting-events?from_date=&to_date=&status=
// Returns event queue for a date range — used by admin dashboard.
router.get('/api/accounting-events', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const { from_date, to_date, status } = req.query;

    try {
        const rows = await db.sequelize.query(`
            SELECT
                e.event_id, e.source_type, e.source_id, e.event_type,
                e.event_status, e.event_date, e.error_message,
                e.processed_at, e.processed_by, e.voucher_id
            FROM gl_accounting_events e
            WHERE e.location_code = :locationCode
              AND (:from_date IS NULL OR e.event_date >= :from_date)
              AND (:to_date   IS NULL OR e.event_date <= :to_date)
              AND (:status    IS NULL OR e.event_status = :status)
            ORDER BY e.event_date DESC, e.event_id DESC
            LIMIT 500
        `, {
            replacements: {
                locationCode,
                from_date: from_date || null,
                to_date:   to_date   || null,
                status:    status    || null
            },
            type: db.Sequelize.QueryTypes.SELECT
        });
        res.json(rows);
    } catch (err) {
        console.error('Accounting events fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Day Book ──────────────────────────────────────────────────────────────────
// GET /gl/day-book?from_date=&to_date=&voucher_type=

const VOUCHER_TYPES = ['SALES', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'JOURNAL', 'CONTRA'];

router.get('/day-book', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today    = new Date().toISOString().substring(0, 10);
    const fromDate = req.query.from_date    || today;
    const toDate   = req.query.to_date      || today;
    const selectedType = req.query.voucher_type || null;

    try {
        const rows = await db.sequelize.query(`
            SELECT
                h.voucher_id,
                DATE_FORMAT(h.voucher_date, '%d-%b-%Y') AS voucher_date,
                h.voucher_no,
                h.voucher_type,
                h.narration,
                h.source_type,
                h.is_reversal,
                l.line_no,
                gl.ledger_name,
                l.dr_amount,
                l.cr_amount,
                l.narration AS line_narration
            FROM gl_journal_headers h
            JOIN gl_journal_lines l  ON l.voucher_id = h.voucher_id
            JOIN gl_ledgers gl       ON gl.ledger_id  = l.ledger_id
            WHERE h.location_code = :locationCode
              AND h.voucher_date  BETWEEN :fromDate AND :toDate
              AND (:selectedType IS NULL OR h.voucher_type = :selectedType)
            ORDER BY h.voucher_date, h.voucher_id, l.line_no
        `, {
            replacements: { locationCode, fromDate, toDate, selectedType },
            type: db.Sequelize.QueryTypes.SELECT
        });

        // Group lines under their voucher header
        const voucherMap = new Map();
        for (const row of rows) {
            if (!voucherMap.has(row.voucher_id)) {
                voucherMap.set(row.voucher_id, {
                    voucher_id:   row.voucher_id,
                    voucher_date: row.voucher_date,
                    voucher_no:   row.voucher_no,
                    voucher_type: row.voucher_type,
                    narration:    row.narration,
                    source_type:  row.source_type,
                    is_reversal:  row.is_reversal,
                    total_dr:     0,
                    total_cr:     0,
                    lines:        []
                });
            }
            const v    = voucherMap.get(row.voucher_id);
            const dr   = parseFloat(row.dr_amount || 0);
            const cr   = parseFloat(row.cr_amount || 0);
            v.total_dr += dr;
            v.total_cr += cr;
            v.lines.push({ line_no: row.line_no, ledger_name: row.ledger_name, dr_amount: dr, cr_amount: cr });
        }

        const vouchers      = [...voucherMap.values()];
        const grandTotalDr  = vouchers.reduce((s, v) => s + v.total_dr, 0);
        const grandTotalCr  = vouchers.reduce((s, v) => s + v.total_cr, 0);

        res.render('gl-day-book', {
            title:       'Day Book',
            user:        req.user,
            config:      require('../config/app-config').APP_CONFIGS,
            fromDate,
            toDate,
            selectedType,
            vouchers,
            grandTotalDr,
            grandTotalCr,
            VOUCHER_TYPES
        });
    } catch (err) {
        console.error('Day Book error:', err);
        req.flash('error', 'Failed to load Day Book: ' + err.message);
        res.redirect('/home');
    }
});

// ── Ledger Report ─────────────────────────────────────────────────────────────
// GET /gl/ledger?ledger_id=&from_date=&to_date=

router.get('/ledger', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today    = new Date().toISOString().substring(0, 10);
    const fromDate = req.query.from_date || today;
    const toDate   = req.query.to_date   || today;
    const ledgerId = req.query.ledger_id ? parseInt(req.query.ledger_id) : null;

    let ledger = null, entries = [], obNet = 0, periodDr = 0, periodCr = 0;

    try {
        if (ledgerId) {
            // Fetch ledger meta
            const ledgerRows = await db.sequelize.query(`
                SELECT l.ledger_id, l.ledger_name, g.group_name, g.group_nature
                FROM gl_ledgers l
                JOIN gl_ledger_groups g ON g.group_id = l.group_id
                WHERE l.ledger_id = :ledgerId AND l.location_code = :locationCode
            `, { replacements: { ledgerId, locationCode }, type: db.Sequelize.QueryTypes.SELECT });

            if (!ledgerRows.length) throw new Error(`Ledger not found: ${ledgerId}`);
            ledger = ledgerRows[0];

            // Opening balance = all entries before fromDate
            const obRows = await db.sequelize.query(`
                SELECT
                    COALESCE(SUM(l.dr_amount), 0) AS ob_dr,
                    COALESCE(SUM(l.cr_amount), 0) AS ob_cr
                FROM gl_journal_lines l
                JOIN gl_journal_headers h ON h.voucher_id = l.voucher_id
                WHERE l.ledger_id      = :ledgerId
                  AND h.location_code  = :locationCode
                  AND h.voucher_date   < :fromDate
            `, { replacements: { ledgerId, locationCode, fromDate }, type: db.Sequelize.QueryTypes.SELECT });

            obNet = parseFloat(obRows[0].ob_dr) - parseFloat(obRows[0].ob_cr);

            // Period entries
            const rows = await db.sequelize.query(`
                SELECT
                    DATE_FORMAT(h.voucher_date, '%d-%b-%Y') AS voucher_date,
                    h.voucher_no,
                    h.voucher_type,
                    h.is_reversal,
                    COALESCE(l.narration, h.narration) AS narration,
                    l.dr_amount,
                    l.cr_amount
                FROM gl_journal_lines l
                JOIN gl_journal_headers h ON h.voucher_id = l.voucher_id
                WHERE l.ledger_id     = :ledgerId
                  AND h.location_code = :locationCode
                  AND h.voucher_date  BETWEEN :fromDate AND :toDate
                ORDER BY h.voucher_date, h.voucher_id, l.line_no
            `, { replacements: { ledgerId, locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });

            // Compute running balance
            let running = obNet;
            for (const row of rows) {
                const dr  = parseFloat(row.dr_amount || 0);
                const cr  = parseFloat(row.cr_amount || 0);
                running  += dr - cr;
                periodDr += dr;
                periodCr += cr;
                entries.push({
                    voucher_date: row.voucher_date,
                    voucher_no:   row.voucher_no,
                    voucher_type: row.voucher_type,
                    is_reversal:  row.is_reversal,
                    narration:    row.narration,
                    dr_amount:    dr,
                    cr_amount:    cr,
                    balance:      running
                });
            }
        }

        res.render('gl-ledger-report', {
            title:       'Ledger Report',
            user:        req.user,
            config:      require('../config/app-config').APP_CONFIGS,
            fromDate,
            toDate,
            ledgerId,
            ledger,
            obNet,
            entries,
            periodDr,
            periodCr,
            closingBalance: obNet + periodDr - periodCr,
            VOUCHER_TYPES
        });
    } catch (err) {
        console.error('Ledger report error:', err);
        req.flash('error', 'Failed to load Ledger Report: ' + err.message);
        res.redirect('/gl/day-book');
    }
});

// ── Trial Balance ─────────────────────────────────────────────────────────────
// GET /gl/trial-balance?as_of_date=&show_zero=1

const NATURE_ORDER = { ASSETS: 1, LIABILITIES: 2, INCOME: 3, EXPENSES: 4 };

router.get('/trial-balance', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today     = new Date().toISOString().substring(0, 10);
    const asOfDate  = req.query.as_of_date || today;
    const showZero  = req.query.show_zero === '1';

    try {
        const rows = await db.sequelize.query(`
            SELECT
                g.group_name,
                g.group_nature,
                l.ledger_id,
                l.ledger_name,
                COALESCE(b.total_dr, 0) AS total_dr,
                COALESCE(b.total_cr, 0) AS total_cr
            FROM gl_ledgers l
            JOIN gl_ledger_groups g ON g.group_id = l.group_id
            LEFT JOIN (
                SELECT jl.ledger_id,
                       SUM(jl.dr_amount) AS total_dr,
                       SUM(jl.cr_amount) AS total_cr
                FROM gl_journal_lines jl
                JOIN gl_journal_headers jh ON jh.voucher_id = jl.voucher_id
                WHERE jh.location_code = :locationCode
                  AND jh.voucher_date  <= :asOfDate
                GROUP BY jl.ledger_id
            ) b ON b.ledger_id = l.ledger_id
            WHERE l.location_code = :locationCode
              AND l.active_flag   = 'Y'
            ORDER BY
                FIELD(g.group_nature, 'ASSETS', 'LIABILITIES', 'INCOME', 'EXPENSES'),
                g.group_name,
                l.ledger_name
        `, { replacements: { locationCode, asOfDate }, type: db.Sequelize.QueryTypes.SELECT });

        // Group ledgers and compute net DR/CR balance per ledger
        const groupMap = new Map();
        let grandDr = 0, grandCr = 0;

        for (const row of rows) {
            const net   = parseFloat(row.total_dr) - parseFloat(row.total_cr);
            const drBal = net > 0 ?  net : 0;
            const crBal = net < 0 ? -net : 0;

            if (!showZero && drBal === 0 && crBal === 0) continue;

            if (!groupMap.has(row.group_name)) {
                groupMap.set(row.group_name, {
                    group_name:   row.group_name,
                    group_nature: row.group_nature,
                    rows:         [],
                    subtotal_dr:  0,
                    subtotal_cr:  0
                });
            }
            const g = groupMap.get(row.group_name);
            g.rows.push({ ledger_id: row.ledger_id, ledger_name: row.ledger_name, dr_balance: drBal, cr_balance: crBal });
            g.subtotal_dr += drBal;
            g.subtotal_cr += crBal;
            grandDr       += drBal;
            grandCr       += crBal;
        }

        // Sort groups by nature order
        const groups = [...groupMap.values()].sort((a, b) =>
            (NATURE_ORDER[a.group_nature] || 9) - (NATURE_ORDER[b.group_nature] || 9)
        );

        res.render('gl-trial-balance', {
            title:      'Trial Balance',
            user:       req.user,
            config:     require('../config/app-config').APP_CONFIGS,
            asOfDate,
            showZero,
            groups,
            grandDr,
            grandCr,
            isBalanced: Math.abs(grandDr - grandCr) < 0.01
        });
    } catch (err) {
        console.error('Trial Balance error:', err);
        req.flash('error', 'Failed to load Trial Balance: ' + err.message);
        res.redirect('/gl/day-book');
    }
});

// ── Profit & Loss ─────────────────────────────────────────────────────────────
// GET /gl/profit-loss?from_date=&to_date=

router.get('/profit-loss', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today  = new Date();
    const fyYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const fromDate = req.query.from_date || `${fyYear}-04-01`;
    const toDate   = req.query.to_date   || `${fyYear + 1}-03-31`;

    try {
        const rows = await db.sequelize.query(`
            SELECT
                g.group_name,
                g.group_nature,
                l.ledger_id,
                l.ledger_name,
                COALESCE(b.total_dr, 0) AS total_dr,
                COALESCE(b.total_cr, 0) AS total_cr
            FROM gl_ledgers l
            JOIN gl_ledger_groups g ON g.group_id = l.group_id
            LEFT JOIN (
                SELECT jl.ledger_id,
                       SUM(jl.dr_amount) AS total_dr,
                       SUM(jl.cr_amount) AS total_cr
                FROM gl_journal_lines jl
                JOIN gl_journal_headers jh ON jh.voucher_id = jl.voucher_id
                WHERE jh.location_code = :locationCode
                  AND jh.voucher_date  BETWEEN :fromDate AND :toDate
                GROUP BY jl.ledger_id
            ) b ON b.ledger_id = l.ledger_id
            WHERE l.location_code = :locationCode
              AND l.active_flag   = 'Y'
              AND g.group_nature  IN ('INCOME', 'EXPENSES')
              AND (b.total_dr IS NOT NULL OR b.total_cr IS NOT NULL)
            ORDER BY g.group_nature DESC, g.group_name, l.ledger_name
        `, { replacements: { locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });

        const incomeGroupMap  = new Map();
        const expenseGroupMap = new Map();
        let totalIncome = 0, totalExpenses = 0;

        for (const row of rows) {
            const dr  = parseFloat(row.total_dr);
            const cr  = parseFloat(row.total_cr);

            if (row.group_nature === 'INCOME') {
                const net = cr - dr;
                if (!incomeGroupMap.has(row.group_name))
                    incomeGroupMap.set(row.group_name, { group_name: row.group_name, rows: [], subtotal: 0 });
                const g = incomeGroupMap.get(row.group_name);
                g.rows.push({ ledger_id: row.ledger_id, ledger_name: row.ledger_name, amount: net });
                g.subtotal  += net;
                totalIncome += net;
            } else {
                const net = dr - cr;
                if (!expenseGroupMap.has(row.group_name))
                    expenseGroupMap.set(row.group_name, { group_name: row.group_name, rows: [], subtotal: 0 });
                const g = expenseGroupMap.get(row.group_name);
                g.rows.push({ ledger_id: row.ledger_id, ledger_name: row.ledger_name, amount: net });
                g.subtotal    += net;
                totalExpenses += net;
            }
        }

        res.render('gl-profit-loss', {
            title:          'Profit & Loss',
            user:           req.user,
            config:         require('../config/app-config').APP_CONFIGS,
            fromDate,
            toDate,
            incomeGroups:   [...incomeGroupMap.values()],
            expenseGroups:  [...expenseGroupMap.values()],
            totalIncome,
            totalExpenses,
            netPL:          totalIncome - totalExpenses
        });
    } catch (err) {
        console.error('P&L error:', err);
        req.flash('error', 'Failed to load P&L: ' + err.message);
        res.redirect('/gl/day-book');
    }
});

// ── Balance Sheet ─────────────────────────────────────────────────────────────
// GET /gl/balance-sheet?as_of_date=

router.get('/balance-sheet', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today    = new Date().toISOString().substring(0, 10);
    const asOfDate = req.query.as_of_date || today;

    try {
        // Asset and liability balances cumulative up to asOfDate
        const rows = await db.sequelize.query(`
            SELECT
                g.group_name,
                g.group_nature,
                l.ledger_id,
                l.ledger_name,
                COALESCE(b.total_dr, 0) AS total_dr,
                COALESCE(b.total_cr, 0) AS total_cr
            FROM gl_ledgers l
            JOIN gl_ledger_groups g ON g.group_id = l.group_id
            LEFT JOIN (
                SELECT jl.ledger_id,
                       SUM(jl.dr_amount) AS total_dr,
                       SUM(jl.cr_amount) AS total_cr
                FROM gl_journal_lines jl
                JOIN gl_journal_headers jh ON jh.voucher_id = jl.voucher_id
                WHERE jh.location_code = :locationCode
                  AND jh.voucher_date  <= :asOfDate
                GROUP BY jl.ledger_id
            ) b ON b.ledger_id = l.ledger_id
            WHERE l.location_code = :locationCode
              AND l.active_flag   = 'Y'
              AND g.group_nature  IN ('ASSETS', 'LIABILITIES')
              AND (b.total_dr IS NOT NULL OR b.total_cr IS NOT NULL)
            ORDER BY g.group_nature, g.group_name, l.ledger_name
        `, { replacements: { locationCode, asOfDate }, type: db.Sequelize.QueryTypes.SELECT });

        // Net P&L from inception to asOfDate — rolled into equity on liabilities side
        const plRows = await db.sequelize.query(`
            SELECT
                COALESCE(SUM(CASE WHEN g.group_nature = 'INCOME'   THEN jl.cr_amount - jl.dr_amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN g.group_nature = 'EXPENSES' THEN jl.dr_amount - jl.cr_amount ELSE 0 END), 0) AS total_expenses
            FROM gl_journal_lines jl
            JOIN gl_journal_headers jh ON jh.voucher_id = jl.voucher_id
            JOIN gl_ledgers l          ON l.ledger_id   = jl.ledger_id
            JOIN gl_ledger_groups g    ON g.group_id    = l.group_id
            WHERE jh.location_code = :locationCode
              AND jh.voucher_date  <= :asOfDate
              AND g.group_nature   IN ('INCOME', 'EXPENSES')
        `, { replacements: { locationCode, asOfDate }, type: db.Sequelize.QueryTypes.SELECT });

        const netPL = parseFloat(plRows[0].total_income) - parseFloat(plRows[0].total_expenses);

        const assetGroupMap     = new Map();
        const liabilityGroupMap = new Map();
        let totalAssets = 0, totalLiabilities = 0;

        for (const row of rows) {
            const dr  = parseFloat(row.total_dr);
            const cr  = parseFloat(row.total_cr);

            if (row.group_nature === 'ASSETS') {
                const net = dr - cr;
                if (!assetGroupMap.has(row.group_name))
                    assetGroupMap.set(row.group_name, { group_name: row.group_name, rows: [], subtotal: 0 });
                const g = assetGroupMap.get(row.group_name);
                g.rows.push({ ledger_id: row.ledger_id, ledger_name: row.ledger_name, amount: net });
                g.subtotal   += net;
                totalAssets  += net;
            } else {
                const net = cr - dr;
                if (!liabilityGroupMap.has(row.group_name))
                    liabilityGroupMap.set(row.group_name, { group_name: row.group_name, rows: [], subtotal: 0 });
                const g = liabilityGroupMap.get(row.group_name);
                g.rows.push({ ledger_id: row.ledger_id, ledger_name: row.ledger_name, amount: net });
                g.subtotal        += net;
                totalLiabilities  += net;
            }
        }

        const totalLiabilitiesAndPL = totalLiabilities + netPL;

        res.render('gl-balance-sheet', {
            title:                  'Balance Sheet',
            user:                   req.user,
            config:                 require('../config/app-config').APP_CONFIGS,
            asOfDate,
            assetGroups:            [...assetGroupMap.values()],
            liabilityGroups:        [...liabilityGroupMap.values()],
            totalAssets,
            totalLiabilities,
            netPL,
            totalLiabilitiesAndPL,
            isBalanced:             Math.abs(totalAssets - totalLiabilitiesAndPL) < 0.01
        });
    } catch (err) {
        console.error('Balance Sheet error:', err);
        req.flash('error', 'Failed to load Balance Sheet: ' + err.message);
        res.redirect('/gl/day-book');
    }
});

// ── Manual Journal ────────────────────────────────────────────────────────────

const MANUAL_JOURNAL_TYPES = ['JOURNAL', 'PAYMENT', 'RECEIPT', 'CONTRA'];
const VOUCHER_PREFIXES_MAP  = { JOURNAL:'JNL', PAYMENT:'PMT', RECEIPT:'RCT', CONTRA:'CNT' };

async function getFyId(locationCode, date) {
    const rows = await db.sequelize.query(`
        SELECT fy_id FROM gl_financial_years
        WHERE location_code = :locationCode
          AND :date BETWEEN start_date AND end_date
        LIMIT 1
    `, { replacements: { locationCode, date }, type: db.Sequelize.QueryTypes.SELECT });
    return rows[0] ? rows[0].fy_id : null;
}

async function nextVoucherNo(locationCode, fyId, vType) {
    const prefix  = VOUCHER_PREFIXES_MAP[vType] || 'JNL';
    const seqRows = await db.sequelize.query(`
        SELECT COALESCE(MAX(
            CAST(SUBSTRING(voucher_no, LOCATE('-', voucher_no) + 1) AS UNSIGNED)
        ), 0) + 1 AS next_no
        FROM gl_journal_headers
        WHERE location_code = :locationCode
          AND fy_id         = :fyId
          AND voucher_type  = :vType
          AND voucher_no IS NOT NULL
    `, { replacements: { locationCode, fyId, vType }, type: db.Sequelize.QueryTypes.SELECT });
    return `${prefix}-${String(seqRows[0].next_no).padStart(4, '0')}`;
}

// GET /gl/journal — list
router.get('/journal', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const today    = new Date().toISOString().substring(0, 10);
    const fromDate = req.query.from_date || today.substring(0, 8) + '01';
    const toDate   = req.query.to_date   || today;

    try {
        const journals = await db.sequelize.query(`
            SELECT
                h.voucher_id,
                DATE_FORMAT(h.voucher_date, '%d-%b-%Y') AS voucher_date,
                h.voucher_no,
                h.voucher_type,
                h.narration,
                h.is_reversal,
                h.posted_by,
                SUM(l.dr_amount) AS total_amount
            FROM gl_journal_headers h
            JOIN gl_journal_lines l ON l.voucher_id = h.voucher_id
            WHERE h.location_code = :locationCode
              AND h.source_type   = 'MANUAL_JOURNAL'
              AND h.voucher_date  BETWEEN :fromDate AND :toDate
            GROUP BY h.voucher_id
            ORDER BY h.voucher_date DESC, h.voucher_id DESC
            LIMIT 200
        `, { replacements: { locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });

        res.render('gl-journal-list', {
            title:    'Manual Journals',
            user:     req.user,
            config:   require('../config/app-config').APP_CONFIGS,
            fromDate,
            toDate,
            journals,
            messages: req.flash()
        });
    } catch (err) {
        console.error('Journal list error:', err);
        req.flash('error', err.message);
        res.redirect('/gl/day-book');
    }
});

// GET /gl/journal/new — blank form
router.get('/journal/new', [isLoginEnsured, security.isAdmin()], function(req, res) {
    const today = new Date().toISOString().substring(0, 10);
    res.render('gl-journal-form', {
        title:        'New Manual Journal',
        user:         req.user,
        config:       require('../config/app-config').APP_CONFIGS,
        voucher:      null,
        lines:        [],
        readOnly:     false,
        voucherDate:  today,
        MANUAL_JOURNAL_TYPES,
        messages:     req.flash()
    });
});

// GET /gl/journal/:id — view
router.get('/journal/:id', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const voucherId    = parseInt(req.params.id);

    try {
        const [hRows, lines] = await Promise.all([
            db.sequelize.query(`
                SELECT h.*,
                       DATE_FORMAT(h.voucher_date, '%d-%b-%Y')    AS fmt_date,
                       DATE_FORMAT(h.voucher_date, '%Y-%m-%d')    AS raw_date,
                       rv.voucher_no                              AS reversal_of_no
                FROM gl_journal_headers h
                LEFT JOIN gl_journal_headers rv ON rv.voucher_id = h.reversal_of_voucher_id
                WHERE h.voucher_id    = :voucherId
                  AND h.location_code = :locationCode
            `, { replacements: { voucherId, locationCode }, type: db.Sequelize.QueryTypes.SELECT }),
            db.sequelize.query(`
                SELECT l.line_no, l.ledger_id, gl.ledger_name, l.dr_amount, l.cr_amount, l.narration
                FROM gl_journal_lines l
                JOIN gl_ledgers gl ON gl.ledger_id = l.ledger_id
                WHERE l.voucher_id = :voucherId
                ORDER BY l.line_no
            `, { replacements: { voucherId }, type: db.Sequelize.QueryTypes.SELECT })
        ]);

        if (!hRows.length) {
            req.flash('error', 'Journal not found');
            return res.redirect('/gl/journal');
        }

        res.render('gl-journal-form', {
            title:        `Journal ${hRows[0].voucher_no}`,
            user:         req.user,
            config:       require('../config/app-config').APP_CONFIGS,
            voucher:      hRows[0],
            lines,
            readOnly:     true,
            voucherDate:  hRows[0].raw_date,
            MANUAL_JOURNAL_TYPES,
            messages:     req.flash()
        });
    } catch (err) {
        console.error('Journal view error:', err);
        req.flash('error', err.message);
        res.redirect('/gl/journal');
    }
});

// POST /gl/api/journal — save new journal
router.post('/api/journal', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const postedBy     = req.user.username || String(req.user.Person_id);
    const { voucher_type, voucher_date, narration, lines } = req.body;

    try {
        if (!voucher_date) throw new Error('Voucher date is required');
        if (!Array.isArray(lines) || lines.length < 2) throw new Error('At least 2 journal lines are required');

        const totalDr = lines.reduce((s, l) => s + parseFloat(l.dr_amount || 0), 0);
        const totalCr = lines.reduce((s, l) => s + parseFloat(l.cr_amount || 0), 0);
        if (Math.abs(totalDr - totalCr) > 0.005)
            throw new Error(`Journal does not balance: DR ${totalDr.toFixed(2)} vs CR ${totalCr.toFixed(2)}`);

        const vType = MANUAL_JOURNAL_TYPES.includes(voucher_type) ? voucher_type : 'JOURNAL';
        const fyId  = await getFyId(locationCode, voucher_date);
        if (!fyId) throw new Error(`No financial year found for date ${voucher_date}`);

        const voucherNo = await nextVoucherNo(locationCode, fyId, vType);

        const [voucherId] = await db.sequelize.query(`
            INSERT INTO gl_journal_headers
                (location_code, fy_id, voucher_type, voucher_date, voucher_no,
                 narration, source_type, source_id, is_reversal, is_exported, posted_by, created_by)
            VALUES
                (:locationCode, :fyId, :vType, :voucher_date, :voucherNo,
                 :narration, 'MANUAL_JOURNAL', NULL, 'N', 'N', :postedBy, :postedBy)
        `, {
            replacements: { locationCode, fyId, vType, voucher_date, voucherNo, narration: narration || '', postedBy },
            type: db.Sequelize.QueryTypes.INSERT
        });

        for (let i = 0; i < lines.length; i++) {
            const { ledger_id, dr_amount, cr_amount, narration: ln } = lines[i];
            await db.sequelize.query(`
                INSERT INTO gl_journal_lines
                    (voucher_id, line_no, ledger_id, dr_amount, cr_amount, narration, created_by)
                VALUES (:voucherId, :lineNo, :ledgerId, :drAmount, :crAmount, :lineNarration, :postedBy)
            `, {
                replacements: {
                    voucherId, lineNo: i + 1, ledgerId: parseInt(ledger_id),
                    drAmount: parseFloat(dr_amount || 0), crAmount: parseFloat(cr_amount || 0),
                    lineNarration: ln || null, postedBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }

        res.json({ success: true, voucher_id: voucherId, voucher_no: voucherNo });
    } catch (err) {
        console.error('Journal save error:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

// POST /gl/api/journal/:id/reverse — create reversal voucher
router.post('/api/journal/:id/reverse', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const postedBy     = req.user.username || String(req.user.Person_id);
    const voucherId    = parseInt(req.params.id);

    try {
        const [hRows, lines] = await Promise.all([
            db.sequelize.query(`SELECT * FROM gl_journal_headers WHERE voucher_id = :voucherId AND location_code = :locationCode`,
                { replacements: { voucherId, locationCode }, type: db.Sequelize.QueryTypes.SELECT }),
            db.sequelize.query(`SELECT * FROM gl_journal_lines WHERE voucher_id = :voucherId ORDER BY line_no`,
                { replacements: { voucherId }, type: db.Sequelize.QueryTypes.SELECT })
        ]);

        if (!hRows.length) throw new Error('Journal not found');
        const orig = hRows[0];

        const today  = new Date().toISOString().substring(0, 10);
        const fyId   = await getFyId(locationCode, today);
        if (!fyId) throw new Error(`No financial year found for today (${today})`);

        const voucherNo = await nextVoucherNo(locationCode, fyId, orig.voucher_type);

        const [reversalId] = await db.sequelize.query(`
            INSERT INTO gl_journal_headers
                (location_code, fy_id, voucher_type, voucher_date, voucher_no,
                 narration, source_type, source_id, is_reversal, reversal_of_voucher_id,
                 is_exported, posted_by, created_by)
            VALUES
                (:locationCode, :fyId, :vType, :today, :voucherNo,
                 :narration, 'MANUAL_JOURNAL', NULL, 'Y', :origId,
                 'N', :postedBy, :postedBy)
        `, {
            replacements: {
                locationCode, fyId, vType: orig.voucher_type, today, voucherNo,
                narration: `REVERSAL of ${orig.voucher_no} — ${orig.narration || ''}`,
                origId: voucherId, postedBy
            },
            type: db.Sequelize.QueryTypes.INSERT
        });

        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            await db.sequelize.query(`
                INSERT INTO gl_journal_lines
                    (voucher_id, line_no, ledger_id, dr_amount, cr_amount, narration, created_by)
                VALUES (:reversalId, :lineNo, :ledgerId, :drAmount, :crAmount, :lineNarration, :postedBy)
            `, {
                replacements: {
                    reversalId, lineNo: i + 1, ledgerId: l.ledger_id,
                    drAmount: parseFloat(l.cr_amount || 0),
                    crAmount: parseFloat(l.dr_amount || 0),
                    lineNarration: l.narration, postedBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }

        res.json({ success: true, voucher_id: reversalId, voucher_no: voucherNo });
    } catch (err) {
        console.error('Journal reversal error:', err);
        res.status(400).json({ success: false, error: err.message });
    }
});

// ── Ledger Groups ─────────────────────────────────────────────────────────────
// GET /gl/ledger-groups

router.get('/ledger-groups', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    try {
        const groups = await db.sequelize.query(`
            SELECT g.group_id, g.group_name, g.group_nature,
                   COUNT(l.ledger_id) AS ledger_count
            FROM gl_ledger_groups g
            LEFT JOIN gl_ledgers l ON l.group_id = g.group_id AND l.active_flag = 'Y'
            WHERE g.location_code = :locationCode
            GROUP BY g.group_id
            ORDER BY FIELD(g.group_nature,'ASSETS','LIABILITIES','INCOME','EXPENSES'), g.group_name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });

        res.render('gl-ledger-groups', {
            title:    'Ledger Groups',
            user:     req.user,
            config:   require('../config/app-config').APP_CONFIGS,
            groups,
            messages: req.flash()
        });
    } catch (err) {
        console.error('Ledger groups error:', err);
        req.flash('error', err.message);
        res.redirect('/gl/day-book');
    }
});

router.post('/api/ledger-groups', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const { group_name, group_nature } = req.body;
    const NATURES = ['ASSETS', 'LIABILITIES', 'INCOME', 'EXPENSES'];
    if (!group_name || !NATURES.includes(group_nature))
        return res.status(400).json({ success: false, error: 'group_name and valid group_nature are required' });
    try {
        const [[exists]] = await db.sequelize.query(
            `SELECT group_id FROM gl_ledger_groups WHERE location_code=:locationCode AND group_name=:group_name LIMIT 1`,
            { replacements: { locationCode, group_name }, type: db.Sequelize.QueryTypes.SELECT }
        );
        if (exists) return res.status(400).json({ success: false, error: 'A group with this name already exists' });

        const [groupId] = await db.sequelize.query(`
            INSERT INTO gl_ledger_groups (location_code, group_name, group_nature, created_by, updated_by)
            VALUES (:locationCode, :group_name, :group_nature, :user, :user)
        `, { replacements: { locationCode, group_name, group_nature, user: req.user.username }, type: db.Sequelize.QueryTypes.INSERT });
        res.json({ success: true, group_id: groupId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/ledger-groups/:id', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const groupId = parseInt(req.params.id);
    const { group_name, group_nature } = req.body;
    const NATURES = ['ASSETS', 'LIABILITIES', 'INCOME', 'EXPENSES'];
    if (!group_name || !NATURES.includes(group_nature))
        return res.status(400).json({ success: false, error: 'group_name and valid group_nature are required' });
    try {
        await db.sequelize.query(`
            UPDATE gl_ledger_groups SET group_name=:group_name, group_nature=:group_nature, updated_by=:user
            WHERE group_id=:groupId AND location_code=:locationCode
        `, { replacements: { groupId, locationCode, group_name, group_nature, user: req.user.username }, type: db.Sequelize.QueryTypes.UPDATE });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/api/ledger-groups/:id', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const groupId = parseInt(req.params.id);
    try {
        const [rows] = await db.sequelize.query(
            `SELECT COUNT(*) AS cnt FROM gl_ledgers WHERE group_id=:groupId`,
            { replacements: { groupId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        if (rows.cnt > 0)
            return res.status(400).json({ success: false, error: `Cannot delete — ${rows.cnt} ledger(s) assigned to this group` });
        await db.sequelize.query(
            `DELETE FROM gl_ledger_groups WHERE group_id=:groupId AND location_code=:locationCode`,
            { replacements: { groupId, locationCode }, type: db.Sequelize.QueryTypes.DELETE }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Ledgers ───────────────────────────────────────────────────────────────────
// GET /gl/ledgers

router.get('/ledgers', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    try {
        const [ledgers, groups] = await Promise.all([
            db.sequelize.query(`
                SELECT l.ledger_id, l.ledger_name, l.active_flag,
                       g.group_id, g.group_name, g.group_nature
                FROM gl_ledgers l
                JOIN gl_ledger_groups g ON g.group_id = l.group_id
                WHERE l.location_code = :locationCode
                ORDER BY FIELD(g.group_nature,'ASSETS','LIABILITIES','INCOME','EXPENSES'), g.group_name, l.ledger_name
            `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }),
            db.sequelize.query(`
                SELECT group_id, group_name, group_nature
                FROM gl_ledger_groups
                WHERE location_code = :locationCode
                ORDER BY FIELD(group_nature,'ASSETS','LIABILITIES','INCOME','EXPENSES'), group_name
            `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT })
        ]);

        res.render('gl-ledgers', {
            title:    'Ledgers',
            user:     req.user,
            config:   require('../config/app-config').APP_CONFIGS,
            ledgers,
            groups,
            messages: req.flash()
        });
    } catch (err) {
        console.error('Ledgers error:', err);
        req.flash('error', err.message);
        res.redirect('/gl/day-book');
    }
});

router.post('/api/ledger', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const { ledger_name, group_id } = req.body;
    if (!ledger_name || !group_id) return res.status(400).json({ success: false, error: 'ledger_name and group_id are required' });
    try {
        const [exists] = await db.sequelize.query(
            `SELECT ledger_id FROM gl_ledgers WHERE location_code=:locationCode AND ledger_name=:ledger_name LIMIT 1`,
            { replacements: { locationCode, ledger_name }, type: db.Sequelize.QueryTypes.SELECT }
        );
        if (exists) return res.status(400).json({ success: false, error: 'A ledger with this name already exists' });

        const [ledgerId] = await db.sequelize.query(`
            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, active_flag, created_by, updated_by)
            VALUES (:locationCode, :ledger_name, :group_id, 'Y', :user, :user)
        `, { replacements: { locationCode, ledger_name, group_id: parseInt(group_id), user: req.user.username }, type: db.Sequelize.QueryTypes.INSERT });
        res.json({ success: true, ledger_id: ledgerId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/ledger/:id', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const ledgerId = parseInt(req.params.id);
    const { ledger_name, group_id, active_flag } = req.body;
    if (!ledger_name || !group_id) return res.status(400).json({ success: false, error: 'ledger_name and group_id are required' });
    try {
        await db.sequelize.query(`
            UPDATE gl_ledgers SET ledger_name=:ledger_name, group_id=:group_id, active_flag=:active_flag, updated_by=:user
            WHERE ledger_id=:ledgerId AND location_code=:locationCode
        `, {
            replacements: { ledgerId, locationCode, ledger_name, group_id: parseInt(group_id), active_flag: active_flag === 'Y' ? 'Y' : 'N', user: req.user.username },
            type: db.Sequelize.QueryTypes.UPDATE
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GL Control ────────────────────────────────────────────────────────────────
// GET /gl/control — admin dashboard: events monitor + create accounting + generate events

router.get('/control', [isLoginEnsured, security.isAdmin()], function(req, res) {
    const today = new Date().toISOString().substring(0, 10);
    const fromDate = today.substring(0, 8) + '01';
    res.render('gl-control', {
        title:    'GL Control',
        user:     req.user,
        config:   require('../config/app-config').APP_CONFIGS,
        fromDate,
        toDate:   today,
        messages: req.flash()
    });
});

// GET /gl/api/event-summary?from_date=&to_date=
router.get('/api/event-summary', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const { from_date, to_date } = req.query;

    try {
        const [summary, byType] = await Promise.all([
            db.sequelize.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(event_status = 'UNPROCESSED') AS unprocessed,
                    SUM(event_status = 'PROCESSED')   AS processed,
                    SUM(event_status = 'ERROR')        AS errors
                FROM gl_accounting_events
                WHERE location_code = :locationCode
                  AND (:from_date IS NULL OR event_date >= :from_date)
                  AND (:to_date   IS NULL OR event_date <= :to_date)
            `, {
                replacements: { locationCode, from_date: from_date || null, to_date: to_date || null },
                type: db.Sequelize.QueryTypes.SELECT
            }),
            db.sequelize.query(`
                SELECT source_type,
                       COUNT(*) AS total,
                       SUM(event_status = 'UNPROCESSED') AS unprocessed,
                       SUM(event_status = 'PROCESSED')   AS processed,
                       SUM(event_status = 'ERROR')        AS errors
                FROM gl_accounting_events
                WHERE location_code = :locationCode
                  AND (:from_date IS NULL OR event_date >= :from_date)
                  AND (:to_date   IS NULL OR event_date <= :to_date)
                GROUP BY source_type
                ORDER BY source_type
            `, {
                replacements: { locationCode, from_date: from_date || null, to_date: to_date || null },
                type: db.Sequelize.QueryTypes.SELECT
            })
        ]);

        res.json({ ...summary[0], byType });
    } catch (err) {
        console.error('Event summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /gl/api/retry-event/:id — reset a single ERROR event back to UNPROCESSED
router.post('/api/retry-event/:id', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const eventId = parseInt(req.params.id);

    try {
        const [, meta] = await db.sequelize.query(`
            UPDATE gl_accounting_events
            SET event_status  = 'UNPROCESSED',
                error_message = NULL,
                processed_at  = NULL,
                processed_by  = NULL
            WHERE event_id      = :eventId
              AND location_code = :locationCode
              AND event_status  = 'ERROR'
        `, { replacements: { eventId, locationCode }, type: db.Sequelize.QueryTypes.UPDATE });

        if (!meta?.affectedRows) {
            return res.status(404).json({ success: false, error: 'Event not found or not in ERROR status' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Retry event error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /gl/api/generate-events — backfill missing events for date range
router.post('/api/generate-events', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.user.location_code;
    const createdBy    = req.user.username || String(req.user.Person_id);
    const { from_date, to_date } = req.body;

    if (!from_date || !to_date) {
        return res.status(400).json({ error: 'from_date and to_date are required' });
    }

    try {
        const result = await createAccountingService.generateMissingEvents(locationCode, from_date, to_date, createdBy);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('Generate events error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

// Exported helper — used by products route to populate ledger dropdowns server-side
module.exports.getLedgersByGroup = async function(locationCode, groupName) {
    const rows = await db.sequelize.query(`
        SELECT l.ledger_id, l.ledger_name
        FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode
          AND l.active_flag = 'Y'
          AND g.group_name = :groupName
        ORDER BY l.ledger_name
    `, {
        replacements: { locationCode, groupName },
        type: db.Sequelize.QueryTypes.SELECT
    });
    return rows;
};
