// controllers/stock-reports-controller.js
const stockReportsDao = require('../dao/stock-reports-dao');
const stockAdjustmentDao = require('../dao/stock-adjustment-dao');
const moment = require('moment');

module.exports = {

  // Stock Summary Report
getStockSummaryReport: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const caller = req.body.caller || 'notpdf';
        
        // Get date range from body (POST) or query (GET)
        let fromDate = req.body.fromDate || req.query.fromDate;
        let toDate = req.body.toDate || req.query.toDate;
        
        // Convert to YYYY-MM-DD format
        if (fromDate instanceof Date) {
            fromDate = moment(fromDate).format('YYYY-MM-DD');
        } else if (fromDate) {
            fromDate = moment(fromDate).format('YYYY-MM-DD');
        }

        if (toDate instanceof Date) {
            toDate = moment(toDate).format('YYYY-MM-DD');
        } else if (toDate) {
            toDate = moment(toDate).format('YYYY-MM-DD');
        }

        let stockSummary = [];

        // Generate report if dates are provided
        if (fromDate && toDate) {
            // Use optimized stored procedure
            const rawResults = await stockReportsDao.getStockSummaryOptimized(
                locationCode,
                fromDate,
                toDate
            );

            
            
                        
            // Format results
            stockSummary = rawResults.map(item => ({
                product_id: item.product_id,
                product_name: item.product_name,
                unit: item.unit,
                opening_balance: item.opening_balance,
                total_in: parseFloat(item.total_in || 0),
                total_out: parseFloat(item.total_out || 0),
                closing_balance: item.closing_balance,
                has_movement: (item.total_in > 0 || item.total_out > 0)
            }));

            

        }

        const formattedFromDate = fromDate ? moment(fromDate).format('DD/MM/YYYY') : '';
        const formattedToDate = toDate ? moment(toDate).format('DD/MM/YYYY') : '';
        const currentDate = moment().format('YYYY-MM-DD');

        if (caller === 'notpdf') {
            res.render('reports-stock-summary', {
                title: 'Stock Summary Report',
                user: req.user,
                stockSummary: stockSummary,
                fromDate: fromDate,
                toDate: toDate,
                formattedFromDate: formattedFromDate,
                formattedToDate: formattedToDate,
                currentDate: currentDate
            });
        } else {
            // For PDF generation
            return new Promise((resolve, reject) => {
                res.render('reports-stock-summary', {
                    title: 'Stock Summary Report',
                    user: req.user,
                    stockSummary: stockSummary,
                    fromDate: fromDate,
                    toDate: toDate,
                    formattedFromDate: formattedFromDate,
                    formattedToDate: formattedToDate,
                    currentDate: currentDate
                }, (err, html) => {
                    if (err) {
                        console.error('getStockSummaryReport: Error in res.render:', err);
                        reject(err);
                    } else {
                        console.log('getStockSummaryReport: Successfully rendered HTML');
                        resolve(html);
                    }
                });
            });
        }

    } catch (error) {
        console.error('Error in getStockSummaryReport:', error);
        req.flash('error', 'Failed to generate stock summary report');
        res.redirect('/home');
        }
},
    
// Stock Ledger Report
getStockLedgerReport: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const caller = req.body.caller || 'notpdf';
        
        // Get parameters from body (POST) or query (GET)
        const productId = req.body.productId || req.query.productId || null;
        let fromDate = req.body.fromDate || req.query.fromDate;
        let toDate = req.body.toDate || req.query.toDate;

        // Convert dates to YYYY-MM-DD format
        if (fromDate instanceof Date) {
            fromDate = moment(fromDate).format('YYYY-MM-DD');
        } else if (fromDate) {
            fromDate = moment(fromDate).format('YYYY-MM-DD');
        }

        if (toDate instanceof Date) {
            toDate = moment(toDate).format('YYYY-MM-DD');
        } else if (toDate) {
            toDate = moment(toDate).format('YYYY-MM-DD');
        }

        // Get all products for dropdown
        const products = await stockAdjustmentDao.getProductsNotLinkedToPumps(locationCode);

        let ledgerData = [];
        let productInfo = null;
        let openingBalance = null;
        let closingBalance = null;
        let totalIn = 0;
        let totalOut = 0;

        // If product is selected, get ledger data
        if (productId && fromDate && toDate) {
            productInfo = products.find(p => p.product_id == productId);
            
            // Get opening balance: closing stock on the day before fromDate.
            // If NULL (history starts on fromDate itself), fall back to any OPENING
            // adjustment entered on fromDate.
            const dayBeforeFrom = moment(fromDate).subtract(1, 'day').format('YYYY-MM-DD');

            openingBalance = await stockReportsDao.getStockBalance(
                productId,
                locationCode,
                dayBeforeFrom
            );

            if (openingBalance === null) {
                openingBalance = await stockReportsDao.getOpeningAdjustmentOnDate(
                    productId,
                    locationCode,
                    fromDate
                );
            }

            

            // Get closing balance using DB function (stock on toDate)
            closingBalance = await stockReportsDao.getStockBalance(
                productId,
                locationCode,
                toDate
            );

           

            // Only get ledger if opening balance is not null (meaning stock start date exists)
            if (openingBalance !== null && closingBalance !== null) {
                // Get ledger transactions ONLY between fromDate and toDate
                ledgerData = await stockReportsDao.getStockLedger(
                    productId, 
                    locationCode, 
                    fromDate, 
                    toDate
                );

                // Calculate totals from ledger data
                totalIn = ledgerData.reduce((sum, txn) => sum + parseFloat(txn.in_qty || 0), 0);
                totalOut = ledgerData.reduce((sum, txn) => sum + parseFloat(txn.out_qty || 0), 0);
           } else {
                 console.log('Opening or Closing is NULL - not fetching ledger');
            }
            
            
        }
                

        const formattedFromDate = fromDate ? moment(fromDate).format('DD/MM/YYYY') : '';
        const formattedToDate = toDate ? moment(toDate).format('DD/MM/YYYY') : '';
        const currentDate = moment().format('YYYY-MM-DD');



      

        if (caller === 'notpdf') {
            res.render('reports-stock-ledger', {
                title: 'Stock Ledger Report',
                user: req.user,
                products: products,
                ledgerData: ledgerData,
                productInfo: productInfo,
                openingBalance: openingBalance !== null ? parseFloat(openingBalance).toFixed(2) : null,
                closingBalance: closingBalance !== null ? parseFloat(closingBalance).toFixed(2) : null,
                totalIn: totalIn.toFixed(2),
                totalOut: totalOut.toFixed(2),
                fromDate: fromDate,
                toDate: toDate,
                formattedFromDate: formattedFromDate,
                formattedToDate: formattedToDate,
                selectedProductId: productId,
                currentDate: currentDate
            });
        } else {
            // For PDF generation
            return new Promise((resolve, reject) => {
                res.render('reports-stock-ledger', {
                    title: 'Stock Ledger Report',
                    user: req.user,
                    products: products,
                    ledgerData: ledgerData,
                    productInfo: productInfo,
                    openingBalance: openingBalance !== null ? parseFloat(openingBalance).toFixed(2) : null,
                    closingBalance: closingBalance !== null ? parseFloat(closingBalance).toFixed(2) : null,
                    totalIn: totalIn.toFixed(2),
                    totalOut: totalOut.toFixed(2),
                    fromDate: fromDate,
                    toDate: toDate,
                    formattedFromDate: formattedFromDate,
                    formattedToDate: formattedToDate,
                    selectedProductId: productId,
                    currentDate: currentDate
                }, (err, html) => {
                    if (err) {
                        console.error('getStockLedgerReport: Error in res.render:', err);
                        reject(err);
                    } else {
                        console.log('getStockLedgerReport: Successfully rendered HTML');
                        resolve(html);
                    }
                });
            });
        }

    } catch (error) {
        console.error('Error in getStockLedgerReport:', error);
        req.flash('error', 'Failed to generate stock ledger report');
        res.redirect('/home');
    }
},

getTankVarianceReport: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        const caller = req.body.caller || 'notpdf';

        let fromDate = req.body.fromDate || req.query.fromDate;
        let toDate = req.body.toDate || req.query.toDate;
        const selectedTank = req.body.tank_code || req.query.tank_code || '';
        const selectedProduct = req.body.product_code || req.query.product_code || '';

        if (fromDate) fromDate = moment(fromDate).format('YYYY-MM-DD');
        if (toDate) toDate = moment(toDate).format('YYYY-MM-DD');

        let varianceRows = [];
        let tankOptions = [];
        let productOptions = [];

        if (fromDate && toDate) {
            const raw = await stockReportsDao.getTankVarianceInputs(locationCode, fromDate, toDate);
            tankOptions = [...new Set((raw.tanks || []).map(t => t.tank_code).filter(Boolean))].sort();
            productOptions = [...new Set((raw.tanks || []).map(t => t.product_code).filter(Boolean))].sort();

            const allRows = buildTankVarianceRows(raw, fromDate, toDate);
            varianceRows = allRows
                .filter(r => !selectedTank || r.tank_code === selectedTank)
                .filter(r => !selectedProduct || r.product_code === selectedProduct)
                .map(r => ({
                    ...r,
                    date_display: moment(r.date, 'YYYY-MM-DD').format('DD/MM/YYYY')
                }));
        }

        const formattedFromDate = fromDate ? moment(fromDate).format('DD/MM/YYYY') : '';
        const formattedToDate = toDate ? moment(toDate).format('DD/MM/YYYY') : '';
        const currentDate = moment().format('YYYY-MM-DD');

        const renderModel = {
            title: 'Tank Variance Report',
            user: req.user,
            fromDate,
            toDate,
            formattedFromDate,
            formattedToDate,
            currentDate,
            varianceRows,
            tankOptions,
            productOptions,
            selectedTank,
            selectedProduct,
            caller
        };

        if (caller === 'notpdf') {
            return res.render('reports-tank-variance', renderModel);
        }

        return new Promise((resolve, reject) => {
            res.render('reports-tank-variance', renderModel, (err, html) => {
                if (err) return reject(err);
                resolve(html);
            });
        });
    } catch (error) {
        console.error('Error in getTankVarianceReport:', error);
        req.flash('error', 'Failed to generate tank variance report');
        res.redirect('/home');
    }
}
};

function toTs(dateStr, timeStr) {
    const hhmmss = (timeStr || '00:00:00').toString().slice(0, 8);
    return new Date(`${dateStr}T${hhmmss}`);
}

function decantTimeToHHMMSS(value) {
    const raw = (value || '0').toString();
    if (raw.includes(':')) return `${raw.slice(0, 5)}:00`;
    const parts = raw.split('.');
    const hh = String(parseInt(parts[0] || '0', 10)).padStart(2, '0');
    let mm = parts[1] || '00';
    if (mm === '3') mm = '30';
    if (mm === '0') mm = '00';
    mm = mm.padEnd(2, '0').slice(0, 2);
    return `${hh}:${mm}:00`;
}

function buildDipVolumeLookup(dipChartLines, tanks) {
    const linesByChart = {};
    dipChartLines.forEach(line => {
        const id = line.dipchartid;
        if (!linesByChart[id]) linesByChart[id] = [];
        linesByChart[id].push({
            dip_cm: parseFloat(line.dip_cm),
            volume_liters: parseFloat(line.volume_liters),
            diff_liters_mm: parseFloat(line.diff_liters_mm || 0)
        });
    });

    const mapByTank = {};
    tanks.forEach(t => {
        const chartLines = [...(linesByChart[t.dipchartid] || [])].sort((a, b) => a.dip_cm - b.dip_cm);
        const expanded = {};
        for (let i = 0; i < chartLines.length - 1; i++) {
            let lastVol = chartLines[i].volume_liters;
            const baseDip = chartLines[i].dip_cm;
            const diff = chartLines[i].diff_liters_mm;
            expanded[baseDip.toFixed(1)] = lastVol;
            for (let j = 1; j <= 9; j++) {
                const d = (baseDip + j * 0.1).toFixed(1);
                lastVol += diff;
                expanded[d] = lastVol;
            }
        }
        if (chartLines.length > 0) {
            const last = chartLines[chartLines.length - 1];
            expanded[last.dip_cm.toFixed(1)] = last.volume_liters;
        }
        mapByTank[t.tank_id] = expanded;
    });
    return mapByTank;
}

function buildTankVarianceRows(raw, fromDate, toDate) {
    const tankById = {};
    raw.tanks.forEach(t => { tankById[t.tank_id] = t; });
    const volumeMapByTank = buildDipVolumeLookup(raw.dipChartLines, raw.tanks);

    const readingsByDip = {};
    raw.pumpReadings.forEach(r => {
        if (!readingsByDip[r.tdip_id]) readingsByDip[r.tdip_id] = {};
        readingsByDip[r.tdip_id][r.pump_id] = parseFloat(r.reading || 0);
    });

    const receiptsByTank = {};
    raw.receipts.forEach(r => {
        const ts = toTs(r.decant_date, decantTimeToHHMMSS(r.decant_time));
        if (!receiptsByTank[r.tank_id]) receiptsByTank[r.tank_id] = [];
        receiptsByTank[r.tank_id].push({
            ts,
            qtyLiters: parseFloat(r.quantity_kl || 0) * 1000
        });
    });

    const eventsByTank = {};
    [...raw.previousDips, ...raw.currentDips].forEach(d => {
        if (!eventsByTank[d.tank_id]) eventsByTank[d.tank_id] = [];
        eventsByTank[d.tank_id].push({
            ...d,
            ts: toTs(d.dip_date, d.dip_time),
            dipReading: parseFloat(d.dip_reading || 0),
            readings: readingsByDip[d.tdip_id] || {}
        });
    });

    const start = new Date(`${fromDate}T00:00:00`);
    const end = new Date(`${toDate}T23:59:59`);
    const rows = [];

    Object.keys(eventsByTank).forEach(tankIdStr => {
        const tankId = parseInt(tankIdStr, 10);
        const events = eventsByTank[tankId].sort((a, b) => a.ts - b.ts);
        const receipts = (receiptsByTank[tankId] || []).sort((a, b) => a.ts - b.ts);
        const tank = tankById[tankId];
        const lookup = volumeMapByTank[tankId] || {};

        for (let i = 1; i < events.length; i++) {
            const prev = events[i - 1];
            const curr = events[i];
            if (curr.ts < start || curr.ts > end) continue;

            const opening = lookup[prev.dipReading.toFixed(1)];
            const actual = lookup[curr.dipReading.toFixed(1)];
            if (opening === undefined || actual === undefined) continue;

            const receiptLiters = receipts
                .filter(r => r.ts > prev.ts && r.ts <= curr.ts)
                .reduce((s, r) => s + r.qtyLiters, 0);

            const pumpIds = Object.keys(curr.readings);
            let sales = 0;
            pumpIds.forEach(pid => {
                if (prev.readings[pid] !== undefined) {
                    const delta = curr.readings[pid] - prev.readings[pid];
                    if (delta > 0) sales += delta;
                }
            });

            const expected = opening + receiptLiters - sales;
            const variance = actual - expected;
            const variancePct = sales > 0 ? (variance / sales) * 100 : null;

            rows.push({
                date: curr.dip_date,
                time: (curr.dip_time || '').slice(0, 5),
                tank_code: tank?.tank_code || tankId,
                product_code: tank?.product_code || '-',
                opening_liters: opening,
                receipts_liters: receiptLiters,
                sales_liters: sales,
                expected_liters: expected,
                actual_liters: actual,
                variance_liters: variance,
                variance_pct: variancePct
            });
        }
    });

    return rows.sort((a, b) => {
        const ka = `${a.date} ${a.time} ${a.tank_code}`;
        const kb = `${b.date} ${b.time} ${b.tank_code}`;
        return ka.localeCompare(kb);
    });
}
