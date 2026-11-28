// controllers/shift-summary-pdf-controller.js
// Cashier Shift Summary as a PDF (tkt #485): the closing screen's Summary tab,
// built from the saved shift rows, so a bunk can send it to the RO owner.
const pug = require('pug');
const path = require('path');
const fs = require('fs');
const ShiftSummaryDao = require('../dao/shift-summary-dao');
const reportDao = require('../dao/report-dao');
const security = require('../utils/app-security');

const OIL_COMPANY_NAMES = {
    BPCL: 'Bharat Petroleum Corporation Ltd',
    HPCL: 'Hindustan Petroleum Corporation Ltd',
    IOCL: 'Indian Oil Corporation Ltd'
};

// Oil-company logo embedded as a data URI: page.setContent() has no base URL.
const logoCache = {};
function companyLogo(companyName) {
    const key = companyName || 'default';
    if (key in logoCache) return logoCache[key];
    let uri = null;
    for (const name of [`${key}.png`, 'default.png']) {
        const p = path.join(__dirname, '..', 'public', 'images', 'company-logos', name);
        if (fs.existsSync(p)) {
            uri = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
            break;
        }
    }
    logoCache[key] = uri;
    return uri;
}

const num = (v) => Number(v) || 0;
const sum = (rows, key) => rows.reduce((s, r) => s + num(r[key]), 0);
const inr = (v) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v));
const qty = (v, d = 3) => num(v).toFixed(d);

function fileName(header) {
    const cashier = String(header.cashier_name || 'Cashier').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `Shift_Summary_${cashier}_${header.closing_date_fmt}.pdf`;
}

module.exports = {

    // GET /closing/:closingId/summary-pdf
    getShiftSummaryPdf: async (req, res) => {
        let page = null;
        try {
            const closingId = parseInt(req.params.closingId, 10);
            if (!closingId) return res.status(400).send('Shift not found');

            const data = await ShiftSummaryDao.getShiftSummary(closingId);
            if (!data || !security.canAccessLocation(req.user, data.header.location_code)) {
                return res.status(404).send('Shift not found');
            }

            const location = await reportDao.getLocationDetails(data.header.location_code);

            // Fuel sales by product (the "Total Sales Amount" block of the Summary tab)
            const byProduct = new Map();
            data.readings.forEach(r => {
                const k = r.product_name || '-';
                const p = byProduct.get(k) || { product_name: k, sale_qty: 0, sale_amount: 0 };
                p.sale_qty += num(r.sale_qty);
                p.sale_amount += num(r.sale_amount);
                byProduct.set(k, p);
            });

            const totals = {
                fuelQty: sum(data.readings, 'sale_qty'),
                fuelAmount: sum(data.readings, 'sale_amount'),
                oil2t: sum(data.oil2t, 'sale_amount'),
                lubes: sum(data.lubes, 'amount'),
                credits: sum(data.credits, 'amount'),
                digital: sum(data.digital, 'amount'),
                receipts: sum(data.receipts, 'amount'),
                // recoveries are cash in (+), advances/payments are cash out (-)
                advances: data.advances.reduce((s, r) =>
                    s + (r.txn_type === 'ADVANCE_RECOVERY' ? num(r.amount) : -num(r.amount)), 0),
                expenses: sum(data.expenses, 'amount'),
                denoms: sum(data.denoms, 'amount'),
                intercompany: sum(data.intercompany, 'quantity')
            };

            const html = pug.renderFile(path.join(__dirname, '..', 'views', 'closing', 'shift-summary-print.pug'), {
                ...data,
                productTotals: Array.from(byProduct.values()),
                totals,
                location,
                dealerOf: location.company_name ? (OIL_COMPANY_NAMES[location.company_name] || location.company_name) : null,
                logo: companyLogo(location.company_name),
                isDraft: data.header.closing_status !== 'CLOSED',
                generatedBy: req.user.Person_Name || req.user.username,
                generatedOn: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                inr, qty, num
            });

            const { getBrowser } = require('../utils/browserHelper');
            const browser = await getBrowser();
            page = await browser.newPage();
            // Everything is inline (data: URIs), so no script and no network.
            await page.setJavaScriptEnabled(false);
            await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
            const pdf = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '12mm', right: '10mm', bottom: '14mm', left: '10mm' },
                displayHeaderFooter: true,
                headerTemplate: '<div></div>',
                footerTemplate: `<div style="font-size:8px;color:#666;width:100%;padding:0 10mm;display:flex;justify-content:space-between;">
                    <span>Computer-generated shift summary · petromath.co.in</span>
                    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
            });
            await page.close();
            page = null;

            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${fileName(data.header)}"`,
                'Content-Length': pdf.length,
                'Cache-Control': 'no-store'
            });
            res.end(pdf);
        } catch (err) {
            console.error('ShiftSummaryPdfController.getShiftSummaryPdf:', err);
            if (page) { try { await page.close(); } catch (e) { /* ignore */ } }
            res.status(500).send('Could not create the shift summary PDF');
        }
    }
};
