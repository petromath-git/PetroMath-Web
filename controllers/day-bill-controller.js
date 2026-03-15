// controllers/day-bill-controller.js
const DayBillDao   = require('../dao/day-bill-dao');
const DayBillSvc   = require('../services/day-bill-service');
const dateFormat   = require('dateformat');
const config       = require('../config/app-config');

const DayBillController = {

    // ─── GET /day-bill ─────────────────────────────────────────────────────
    // List view: shows recent day bills for the location
    getList: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const today = dateFormat(new Date(), 'yyyy-mm-dd');
            // Default: last 30 days
            const fromDate = req.query.fromDate || dateFormat(
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-mm-dd'
            );
            const toDate = req.query.toDate || today;

            const bills = await DayBillDao.findList(locationCode, fromDate, toDate);

            res.render('day-bill-list', {
                title: 'Day Bill',
                bills,
                fromDate,
                toDate,
                today,
                config: config.APP_CONFIGS,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── GET /day-bill/:date ───────────────────────────────────────────────
    // Detail view: 4-tab view for a specific date
    getByDate: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const billDate     = req.params.date; // YYYY-MM-DD

            const [dayBill, shifts, cashSalesSnap, creditSalesSnap] = await Promise.all([
                DayBillDao.findByDate(locationCode, billDate),
                DayBillDao.getShiftsByDate(locationCode, billDate),
                DayBillDao.getCashSalesSnapshotByDate(locationCode, billDate),
                DayBillDao.getCreditSalesSnapshotByDate(locationCode, billDate)
            ]);

            if (!dayBill) {
                // No bill yet for this date (no closed shifts)
                return res.render('day-bill', {
                    title: 'Day Bill',
                    billDate,
                    dayBill: null,
                    shifts,
                    cashHeaders:    [],
                    digitalHeaders: [],
                    summaryData:    [],
                    cashSalesSnap:   cashSalesSnap || [],
                    creditSalesSnap: creditSalesSnap || [],
                    config: config.APP_CONFIGS,
                    user: req.user
                });
            }

            const headers        = dayBill.headers || [];
            const cashHeaders    = headers.filter(h => h.bill_type === 'CASH');
            const digitalHeaders = headers.filter(h => h.bill_type === 'DIGITAL');
            const summaryData    = buildSummaryData(headers);

            res.render('day-bill', {
                title: 'Day Bill',
                billDate,
                dayBill,
                shifts,
                cashHeaders,
                digitalHeaders,
                summaryData,
                cashSalesSnap,
                creditSalesSnap,
                config: config.APP_CONFIGS,
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── POST /day-bill/:date/save-bill-numbers ────────────────────────────
    // AJAX: save bill numbers entered by the manager
    saveBillNumbers: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const billDate     = req.params.date;
            const userId       = req.user.username;
            const updates      = req.body.updates; // [{ header_id, bill_number }]

            if (!Array.isArray(updates) || !updates.length) {
                return res.status(400).json({ error: 'No updates provided' });
            }

            const dayBill = await DayBillDao.findByDate(locationCode, billDate);
            if (!dayBill) {
                return res.status(404).json({ error: 'Day bill not found for this date' });
            }

            // Validate all header_ids belong to this day_bill
            const validIds = new Set((dayBill.headers || []).map(h => h.header_id));
            for (const u of updates) {
                if (!validIds.has(Number(u.header_id))) {
                    return res.status(403).json({ error: 'Invalid header_id' });
                }
            }

            await DayBillDao.saveBillNumbers(updates, userId);
            await DayBillDao.touchDayBill(dayBill.day_bill_id, userId);

            res.json({ success: true });
        } catch (err) {
            console.error('DayBillController.saveBillNumbers:', err);
            res.status(500).json({ error: 'Failed to save bill numbers' });
        }
    },

    // ─── POST /day-bill/:date/recalculate ─────────────────────────────────
    // Manual recalculate (admin use / recovery)
    recalculate: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const billDate     = req.params.date;
            const userId       = req.user.username;

            await DayBillSvc.recalculateDayBill(locationCode, billDate, userId);
            res.json({ success: true, message: 'Day bill recalculated' });
        } catch (err) {
            console.error('DayBillController.recalculate:', err);
            res.status(500).json({ error: 'Recalculation failed' });
        }
    }
};

// ── Helper: build summary rows (product × pumped / credit / digital / cash) ──
function buildSummaryData(headers) {
    // product_id → { product_name, hsn_code, pumped_qty (from cash+digital+credit),
    //                credit_qty, digital_qty, cash_qty, cash_amt, digital_amt }
    const productMap = {};

    const ensureProduct = (item) => {
        const pid = item.product_id;
        if (!productMap[pid]) {
            productMap[pid] = {
                product_id:   pid,
                product_name: item.m_product ? item.m_product.product_name : pid,
                hsn_code:     item.m_product ? item.m_product.hsn_code     : '',
                cash_qty:     0,
                cash_amt:     0,
                digital_qty:  0,
                digital_amt:  0,
            };
        }
        return productMap[pid];
    };

    headers.forEach(h => {
        (h.items || []).forEach(item => {
            const row = ensureProduct(item);
            if (h.bill_type === 'CASH') {
                row.cash_qty += Number(item.quantity)     || 0;
                row.cash_amt += Number(item.total_amount) || 0;
            } else {
                row.digital_qty += Number(item.quantity)     || 0;
                row.digital_amt += Number(item.total_amount) || 0;
            }
        });
    });

    return Object.values(productMap).map(r => ({
        ...r,
        total_qty: r.cash_qty + r.digital_qty,
        total_amt: r.cash_amt + r.digital_amt,
        cash_qty:     round3(r.cash_qty),
        cash_amt:     round3(r.cash_amt),
        digital_qty:  round3(r.digital_qty),
        digital_amt:  round3(r.digital_amt)
    }));
}

function round3(val) {
    return Math.round((Number(val) || 0) * 1000) / 1000;
}

module.exports = DayBillController;
