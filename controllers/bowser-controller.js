'use strict';
const BowserDao      = require('../dao/bowser-dao');
const utils          = require('../utils/app-utils');
const locationConfig = require('../utils/location-config');
const moment         = require('moment');

function buildTransactions(fills, deliveries) {
    const txns = [
        ...fills.map(r => ({
            closing_date:   r.closing_date,
            bowser_name:    r.bowser_name,
            direction:      'IN',
            sub_type:       'Fill',
            party:          null,
            vehicle_number: null,
            product_name:   r.product_name,
            in_qty:         parseFloat(r.quantity || 0),
            out_qty:        null,
            rate:           null,
            amount:         null,
            ref:            null
        })),
        ...deliveries.map(r => ({
            closing_date:   r.closing_date,
            bowser_name:    r.bowser_name,
            direction:      'OUT',
            sub_type:       r.sale_type,
            party:          r.party,
            vehicle_number: r.vehicle_number,
            product_name:   r.product_name,
            in_qty:         null,
            out_qty:        r.quantity != null ? parseFloat(r.quantity || 0) : null,
            rate:           r.rate != null ? parseFloat(r.rate) : null,
            amount:         parseFloat(r.amount || 0),
            ref:            r.bill_no
        }))
    ];
    txns.sort((a, b) => {
        const d = new Date(a.closing_date) - new Date(b.closing_date);
        return d !== 0 ? d : a.bowser_name.localeCompare(b.bowser_name);
    });
    return txns;
}

const parsePositiveRate = (value) => {
    const rate = Number.parseFloat(value);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
};

module.exports = {

    // ── Bowser Master ─────────────────────────────────────────

    getMasterPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const [bowsers, products] = await Promise.all([
                BowserDao.getBowsersByLocation(locationCode),
                BowserDao.getProductsByLocation(locationCode)
            ]);
            res.render('bowser/bowser-master', {
                title: 'Bowser Master',
                user: req.user,
                bowsers,
                products
            });
        } catch (err) {
            console.error('getBowserMasterPage error:', err);
            res.status(500).send('Error loading bowser master');
        }
    },

    createBowser: async (req, res) => {
        try {
            const { bowser_name, capacity_litres, product_id } = req.body;
            if (!bowser_name || !product_id) {
                return res.status(400).json({ success: false, error: 'Bowser name and product are required.' });
            }
            await BowserDao.createBowser({
                locationCode: req.user.location_code,
                bowserName: bowser_name.trim().toUpperCase(),
                capacityLitres: capacity_litres || 0,
                productId: product_id,
                createdBy: String(req.user.Person_id)
            });
            res.json({ success: true, message: 'Bowser created.' });
        } catch (err) {
            console.error('createBowser error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    updateBowser: async (req, res) => {
        try {
            const { bowser_name, capacity_litres, product_id } = req.body;
            await BowserDao.updateBowser(req.params.id, {
                bowserName: bowser_name.trim().toUpperCase(),
                capacityLitres: capacity_litres || 0,
                productId: product_id,
                updatedBy: String(req.user.Person_id)
            });
            res.json({ success: true, message: 'Bowser updated.' });
        } catch (err) {
            console.error('updateBowser error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    toggleBowserActive: async (req, res) => {
        try {
            const { is_active } = req.body;
            await BowserDao.toggleBowserActive(req.params.id, is_active, String(req.user.Person_id));
            res.json({ success: true });
        } catch (err) {
            console.error('toggleBowserActive error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // ── Intercompany API (called from SFS shift closing tab) ──

    getIntercompanyByClosingId: async (req, res) => {
        try {
            const entries = await BowserDao.getIntercompanyByClosingId(req.params.closingId);
            res.json({ success: true, entries });
        } catch (err) {
            console.error('getIntercompany error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveIntercompany: async (req, res) => {
        try {
            const { closing_id, closing_date, entries } = req.body;
            if (!closing_id) {
                return res.status(400).json({ success: false, error: 'closing_id is required.' });
            }
            const result = await BowserDao.saveIntercompanyEntries(
                closing_id,
                closing_date,
                req.user.location_code,
                entries || [],
                String(req.user.Person_id)
            );
            res.json({ success: true, message: 'Intercompany entries saved.', ...result });
        } catch (err) {
            console.error('saveIntercompany error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // ── Bowser Closing List ────────────────────────────────────

    getClosingList: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const toDate   = req.query.toDate   || utils.currentDate();
            const fromDate = req.query.fromDate  || utils.currentDate();
            const [closings, bowsers, allowBowserReopen] = await Promise.all([
                BowserDao.getBowserClosings(locationCode, fromDate, toDate),
                BowserDao.getActiveBowsersByLocation(locationCode),
                locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N')
            ]);
            res.render('bowser/bowser-closing-list', {
                title: 'Bowser Closings',
                user: req.user,
                closings,
                bowsers,
                fromDate,
                toDate,
                allowBowserReopen
            });
        } catch (err) {
            console.error('getClosingList error:', err);
            res.status(500).send('Error loading bowser closings');
        }
    },

    // ── Bowser Closing Form ───────────────────────────────────

    getClosingForm: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const bowserClosingId = req.params.id || null;

            const [bowsers, customers, digitalVendors, allVehicles, allowBowserReopen, backdateDaysStr] = await Promise.all([
                BowserDao.getActiveBowsersByLocation(locationCode),
                BowserDao.getCreditCustomers(locationCode),
                BowserDao.getDigitalVendors(locationCode),
                BowserDao.getAllVehiclesByLocation(locationCode),
                locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N'),
                locationConfig.getLocationConfigValue(locationCode, 'BOWSER_CLOSING_BACKDATE_DAYS', '0')
            ]);

            const today = utils.currentDate();
            const backdateDays = parseInt(backdateDaysStr) || 0;
            let minClosingDate = today;
            if (backdateDays > 0) {
                const d = new Date(today);
                d.setDate(d.getDate() - backdateDays);
                minClosingDate = d.toISOString().slice(0, 10);
            }

            let closing = null, creditItems = [], digitalItems = [], cashItems = [];

            if (bowserClosingId) {
                [closing, creditItems, digitalItems, cashItems] = await Promise.all([
                    BowserDao.getBowserClosingById(bowserClosingId),
                    BowserDao.getCreditItems(bowserClosingId),
                    BowserDao.getDigitalItems(bowserClosingId),
                    BowserDao.getCashItems(bowserClosingId)
                ]);
                if (!closing) return res.status(404).send('Bowser closing not found.');
            }

            res.render('bowser/bowser-closing', {
                title: bowserClosingId ? 'Edit Bowser Closing' : 'New Bowser Closing',
                user: req.user,
                closing,
                creditItems,
                digitalItems,
                cashItems,
                bowsers,
                customers,
                digitalVendors,
                allVehicles,
                allowBowserReopen,
                currentDate: today,
                minClosingDate
            });
        } catch (err) {
            console.error('getClosingForm error:', err);
            res.status(500).send('Error loading bowser closing form');
        }
    },

    getLastClosing: async (req, res) => {
        try {
            const { date } = req.query;
            const asOfDate = date || require('../utils/app-utils').currentDate();
            const result = await BowserDao.getLastClosingForBowser(req.params.bowserId, asOfDate);
            res.json({ success: true, closing_meter: result ? Number(result.closing_meter) : null });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getFillsSuggestion: async (req, res) => {
        try {
            const { bowserId, date } = req.query;
            const totalFills = await BowserDao.getFillsReceivedByBowserAndDate(bowserId, date);
            res.json({ success: true, total_fills: totalFills });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getVehiclesByCustomer: async (req, res) => {
        try {
            const vehicles = await BowserDao.getVehiclesByCustomer(req.params.creditlistId);
            res.json({ success: true, vehicles });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getAllVehicles: async (req, res) => {
        try {
            const vehicles = await BowserDao.getAllVehiclesByLocation(req.user.location_code);
            res.json({ success: true, vehicles });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveDraft: async (req, res) => {
        try {
            const { bowser_closing_id, bowser_id, closing_date,
                    opening_meter, closing_meter, testing_qty, rate, fills_received, opening_stock } = req.body;
            const locationCode = req.user.location_code;
            const createdBy = String(req.user.Person_id);
            const parsedRate = parsePositiveRate(rate);

            if (parsedRate === null) {
                return res.status(400).json({ success: false, error: 'Rate is mandatory and must be greater than 0.' });
            }

            if (bowser_closing_id) {
                await BowserDao.updateBowserClosing(bowser_closing_id, {
                    openingMeter: opening_meter, closingMeter: closing_meter,
                    testingQty: testing_qty || 0,
                    rate: parsedRate,
                    fillsReceived: fills_received, openingStock: opening_stock,
                    updatedBy: createdBy
                });
                await BowserDao.syncDraftCreditRates(bowser_closing_id, parsedRate);
                res.json({ success: true, bowser_closing_id, message: 'Readings saved.' });
            } else {
                // Check for an existing record for same bowser+date before inserting
                const existingDraft = await BowserDao.getDraftByBowserAndDate(bowser_id, closing_date);
                if (existingDraft) {
                    return res.status(409).json({
                        success: false,
                        error: `A closing already exists for this bowser on ${closing_date}. Please open the existing record from the list instead of creating a new one.`
                    });
                }
                const [insertId] = await BowserDao.createBowserClosing({
                    bowserId: bowser_id, locationCode, closingDate: closing_date,
                    openingMeter: opening_meter, closingMeter: closing_meter,
                    testingQty: testing_qty || 0,
                    rate: parsedRate,
                    fillsReceived: fills_received, openingStock: opening_stock,
                    createdBy
                });
                res.json({ success: true, bowser_closing_id: insertId, message: 'Bowser closing created.' });
            }
        } catch (err) {
            console.error('saveDraft error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getExShortage: async (req, res) => {
        try {
            const result = await BowserDao.getExShortage(req.params.id);
            res.json({ success: true, ...result });
        } catch (err) {
            console.error('getExShortage error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveDeliveryItems: async (req, res) => {
        try {
            const { bowser_closing_id, items } = req.body;
            if (!bowser_closing_id) {
                return res.status(400).json({ success: false, error: 'Save readings first.' });
            }
            const closing = await BowserDao.getBowserClosingById(bowser_closing_id);
            if (!closing) {
                return res.status(404).json({ success: false, error: 'Bowser closing not found.' });
            }
            const closingRate = parsePositiveRate(closing.rate);
            if (closingRate === null) {
                return res.status(400).json({ success: false, error: 'Save a valid bowser rate before adding deliveries.' });
            }
            const createdBy     = String(req.user.Person_id);
            const creditItems   = (items || []).filter(i => i.sale_type === 'CREDIT');
            const digitalItems  = (items || []).filter(i => i.sale_type === 'DIGITAL');
            const cashItems     = (items || []).filter(i => i.sale_type === 'CASH');

            await Promise.all([
                BowserDao.saveCreditItems(bowser_closing_id, creditItems, closingRate, createdBy),
                BowserDao.saveDigitalItems(bowser_closing_id, digitalItems, createdBy),
                BowserDao.saveCashItems(bowser_closing_id, cashItems, createdBy)
            ]);
            res.json({ success: true, message: 'Delivery items saved.', inserted: (items || []).length });
        } catch (err) {
            console.error('saveDeliveryItems error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    finalizeClosing: async (req, res) => {
        try {
            await BowserDao.finalizeBowserClosing(req.params.id, String(req.user.Person_id));
            res.json({ success: true, message: 'Bowser closing finalized.' });
        } catch (err) {
            console.error('finalizeClosing error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    reopenClosing: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const userRole     = req.user.Role;

            let hasPermission = userRole === 'SuperUser';
            if (!hasPermission && userRole === 'Admin') {
                const allow = await locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N');
                hasPermission = allow === 'Y';
            }
            if (!hasPermission) {
                return res.status(403).json({ success: false, error: 'You do not have permission to reopen bowser closings.' });
            }

            await BowserDao.reopenBowserClosing(req.params.id, String(req.user.Person_id));
            res.json({ success: true, message: 'Bowser closing reopened.' });
        } catch (err) {
            console.error('reopenClosing error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    deleteClosing: async (req, res) => {
        try {
            await BowserDao.deleteBowserClosing(req.params.id);
            res.json({ success: true, message: 'Bowser closing deleted.' });
        } catch (err) {
            const status = err.statusCode || 500;
            console.error('deleteClosing error:', err);
            res.status(status).json({ success: false, error: err.message });
        }
    },

    // ── Bowser Transactions Report ────────────────────────────

    getReportPage: async (req, res) => {
        try {
            const locationCode  = req.user.location_code;
            const selectedRange = req.query.selectedRange || 'this_month';
            const today         = moment();

            let fromDate = req.query.fromDate;
            let toDate   = req.query.toDate;
            if (!fromDate || !toDate) {
                fromDate = today.clone().startOf('month').format('YYYY-MM-DD');
                toDate   = today.format('YYYY-MM-DD');
            }

            const bowserId = req.query.bowserId || null;

            const [bowsers, fills, deliveries] = await Promise.all([
                BowserDao.getActiveBowsersByLocation(locationCode),
                BowserDao.getFillsReport(locationCode, fromDate, toDate, bowserId),
                BowserDao.getDeliveriesReport(locationCode, fromDate, toDate, bowserId)
            ]);

            res.render('bowser/bowser-report', {
                title: 'Bowser Transactions Report',
                user: req.user,
                bowsers,
                transactions: buildTransactions(fills, deliveries),
                fromDate,
                toDate,
                formattedFromDate: moment(fromDate).format('DD-MMM-YYYY'),
                formattedToDate:   moment(toDate).format('DD-MMM-YYYY'),
                currentDate:       today.format('YYYY-MM-DD'),
                selectedRange,
                bowserId
            });
        } catch (err) {
            console.error('getReportPage error:', err);
            res.status(500).send('Error loading bowser report');
        }
    },

    exportReportExcel: async (req, res) => {
        try {
            const ExcelJS      = require('exceljs');
            const locationCode = req.user.location_code;
            const fromDate     = req.query.fromDate;
            const toDate       = req.query.toDate;
            const bowserId     = req.query.bowserId || null;

            if (!fromDate || !toDate) {
                return res.status(400).send('Date range required for export');
            }

            const [fills, deliveries] = await Promise.all([
                BowserDao.getFillsReport(locationCode, fromDate, toDate, bowserId),
                BowserDao.getDeliveriesReport(locationCode, fromDate, toDate, bowserId)
            ]);
            const transactions = buildTransactions(fills, deliveries);

            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Bowser Transactions');

            ws.getRow(1).getCell(1).value = req.user.station_name || locationCode;
            ws.getRow(1).getCell(1).font  = { bold: true, size: 13 };
            ws.getRow(2).getCell(1).value = `${moment(fromDate).format('DD-MMM-YYYY')} to ${moment(toDate).format('DD-MMM-YYYY')}`;

            const headers = ['Date', 'Bowser', 'IN/OUT', 'Type', 'Customer/Vendor', 'Vehicle', 'Product', 'IN Qty (L)', 'OUT Qty (L)', 'Amount (₹)', 'Ref/Bill No'];
            const hRow = ws.getRow(4);
            headers.forEach((h, i) => {
                const c = hRow.getCell(i + 1);
                c.value     = h;
                c.font      = { bold: true };
                c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
                c.alignment = { horizontal: 'center' };
                c.border    = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
            });

            const fmt3 = v => v != null ? parseFloat(parseFloat(v).toFixed(3)) : null;
            const fmt2 = v => v != null ? parseFloat(parseFloat(v).toFixed(2)) : null;
            let totalIn = 0, totalOutQty = 0, totalAmt = 0;

            transactions.forEach((t, idx) => {
                const r = ws.getRow(5 + idx);
                r.getCell(1).value  = moment(t.closing_date).format('DD-MMM-YYYY');
                r.getCell(2).value  = t.bowser_name;
                r.getCell(3).value  = t.direction;
                r.getCell(4).value  = t.sub_type;
                r.getCell(5).value  = t.party || '';
                r.getCell(6).value  = t.vehicle_number || '';
                r.getCell(7).value  = t.product_name || '';
                r.getCell(8).value  = fmt3(t.in_qty);
                r.getCell(9).value  = fmt3(t.out_qty);
                r.getCell(10).value = fmt2(t.amount);
                r.getCell(11).value = t.ref || '';
                if (t.in_qty  != null) totalIn     += t.in_qty;
                if (t.out_qty != null) totalOutQty += t.out_qty;
                if (t.amount  != null) totalAmt    += t.amount;
            });

            const tRow = ws.getRow(5 + transactions.length);
            tRow.getCell(1).value  = 'Total';
            tRow.getCell(8).value  = parseFloat(totalIn.toFixed(3));
            tRow.getCell(9).value  = parseFloat(totalOutQty.toFixed(3));
            tRow.getCell(10).value = parseFloat(totalAmt.toFixed(2));
            [1, 8, 9, 10].forEach(c => { tRow.getCell(c).font = { bold: true }; });

            ws.getColumn(1).width  = 14;
            ws.getColumn(2).width  = 22;
            ws.getColumn(3).width  = 8;
            ws.getColumn(4).width  = 10;
            ws.getColumn(5).width  = 28;
            ws.getColumn(6).width  = 14;
            ws.getColumn(7).width  = 18;
            [8, 9, 10, 11].forEach(c => { ws.getColumn(c).width = 14; });

            const fileName = `BowserTransactions_${locationCode}_${moment(fromDate).format('DDMMYYYY')}_${moment(toDate).format('DDMMYYYY')}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            await wb.xlsx.write(res);
            res.end();
        } catch (err) {
            console.error('exportReportExcel error:', err);
            res.status(500).send('Failed to generate Excel export');
        }
    }
};
