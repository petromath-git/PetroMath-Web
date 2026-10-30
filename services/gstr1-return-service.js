// GSTR-1 file for upload on the GST portal (Returns > GSTR-1 > Prepare Offline > Upload).
//
// Every figure comes from the same queries as the GST Summary report
// (dao/report-gst-summary-dao.js), the report the returns have always been filed
// from, and the page shows a tie-out against that report. Download is refused
// while there are errors the portal would reject (bad HSN, bad customer GSTIN,
// bad bill number) or the file does not tie to the report.
//
// Sections produced:
//   b2b       credit bills (non-fuel lines) to customers with a GSTIN, tax as stored on the bill
//   b2cs      everything else non-fuel (credit without GSTIN, cash, metered lubes on day bills), by rate
//   nil       Table 8: petrol / diesel as non-GST supply, split registered / unregistered
//   hsn       Table 12, split B2B / B2C as the portal has required since May 2025
//   doc_issue Table 13: one day bill per product group per day (the auditor's format),
//             B2B bill numbers, and reverse-charge self-invoices
const GstSummaryDao = require('../dao/report-gst-summary-dao');
const GstFilingDao = require('../dao/gst-filing-dao');
const GstHsnService = require('./gst-hsn-service');
const GstConfigDao = require('../dao/gst-config-dao');
const gstUtils = require('../utils/gst-utils');
const moment = require('moment');

// Version string written into the file. Copied from a GSTR-1 JSON the portal
// accepted in 2026; change here if the portal ever asks for a newer one.
const JSON_VERSION = 'GST2.2';

// Rows within this many rupees of the GST Summary count as tied (paise rounding).
const TIE_TOLERANCE = 1;

const r2 = (n) => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100;
const num = (n) => parseFloat(n || 0);

// Sale value including GST -> taxable value and each of CGST / SGST, rounded to paise.
function splitGross(gross, rate) {
    const txval = r2(num(gross) / (1 + rate / 100));
    return { txval, half: r2(txval * rate / 200) };
}

const GSTIN_CHARS ='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Format plus the check digit (15th character), so a mistyped GSTIN is caught
// here instead of failing the whole upload.
function isValidGstin(gstin) {
    if (!gstUtils.isValidGstin(gstin)) return false;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const p = GSTIN_CHARS.indexOf(gstin[i]) * (i % 2 ? 2 : 1);
        sum += Math.floor(p / 36) + (p % 36);
    }
    return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

function isValidHsn(hsn) {
    return /^\d{4}(\d{2}(\d{2})?)?$/.test(hsn || '');
}

// Portal invoice / document numbers: up to 16 characters, letters, digits, / and -.
function isValidDocNo(no) {
    return /^[A-Za-z0-9\/-]{1,16}$/.test(no || '');
}

function uqcFor(unit) {
    const u = String(unit || '').trim().toUpperCase();
    if (['LIT', 'LTR', 'L', 'LITRE', 'LITRES'].includes(u)) return 'LTR';
    if (['NOS', 'NO', 'PCS'].includes(u)) return 'NOS';
    if (['KG', 'KGS'].includes(u)) return 'KGS';
    return 'OTH';
}

// Product names for the portal's description fields: plain characters only, 30 max.
function cleanDesc(names) {
    return Array.from(new Set(names)).join(', ').replace(/[^A-Za-z0-9 ,.\-\/]/g, ' ')
        .replace(/\s+/g, ' ').trim().substring(0, 30);
}

// Accumulates HSN rows keyed by HSN + rate + unit.
function hsnBucket() {
    const map = new Map();
    return {
        add(hsn, rate, uqc, productName, qty, txval, camt, samt) {
            const key = `${hsn}|${rate}|${uqc}`;
            if (!map.has(key)) map.set(key, { hsn_sc: hsn, rt: rate, uqc, products: [], qty: 0, txval: 0, camt: 0, samt: 0 });
            const row = map.get(key);
            if (!row.products.includes(productName)) row.products.push(productName);
            row.qty += num(qty); row.txval += num(txval); row.camt += num(camt); row.samt += num(samt);
        },
        rows() {
            return Array.from(map.values()).sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.rt - b.rt);
        }
    };
}

// Table 13 range for one series: numeric order when every number is numeric.
function docRange(nos) {
    const allNumeric = nos.every(n => /^\d+$/.test(n));
    const sorted = nos.slice().sort(allNumeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b));
    return { from: sorted[0], to: sorted[sorted.length - 1], totnum: sorted.length, cancel: 0 };
}

// Table 13 day-bill series per fuel family, as the auditor numbers them:
// XP95 / E20 go with petrol (MS), Xtra Green (GD / XG) with diesel (HSD), CNG on its own.
const FUEL_DOC_SERIES = { PETROL: 'MS', DIESEL: 'HSD', CNG: 'CNG' };
const fuelDocGroup = (product) => FUEL_DOC_SERIES[GstHsnService.fuelFamily(product)];

// Table 13 document types used here (portal numbering).
const DOC_OUTWARD = 1;        // Invoices for outward supply
const DOC_INWARD_UNREG = 2;   // Invoices for inward supply from unregistered person (RCM self-invoice)

async function buildGstr1(locationCode, returnPeriod, options = {}) {
    const includeFuelInHsn = options.includeFuelInHsn !== false;
    const gstConfig = await GstConfigDao.findByLocationCode(locationCode);
    if (!gstConfig) throw new Error('GSTIN is not set up for this location. Open GST Returns > Settings first.');

    const ownGstin = String(gstConfig.gstin).trim().toUpperCase();
    const stateCode = ownGstin.substring(0, 2);
    const { from_date, to_date, financial_year } = gstUtils.getPeriodDates(returnPeriod);

    const [b2bLines, b2bReportRows, b2cItems, fuelRows, nonFuelConsolidated, saleDays, products, rcmEntries, hsnMaster] = await Promise.all([
        GstSummaryDao.getB2BLinesForReturn(locationCode, from_date, to_date),
        GstSummaryDao.getNonFuelB2BSalesByBill(locationCode, from_date, to_date),
        GstSummaryDao.getNonFuelSalesByItem(locationCode, from_date, to_date),
        GstSummaryDao.getFuelSales(locationCode, from_date, to_date),
        GstSummaryDao.getNonFuelSalesConsolidated(locationCode, from_date, to_date),
        GstFilingDao.getSaleDays(locationCode, from_date, to_date),
        GstFilingDao.getProductsForHsn(locationCode),
        GstFilingDao.getRcmEntries(locationCode, returnPeriod),
        GstFilingDao.getHsnMaster()
    ]);
    const hsnDesc = new Map(hsnMaster.map(h => [h.hsn_code, h.description]));
    const hsnResolver = await GstHsnService.loadResolver(locationCode);

    const errors = [];
    const warnings = [];
    const productByName = new Map(products.map(p => [p.product_name, p]));
    // HSN as filed: see services/gst-hsn-service.js (own code, oil company invoice, reference outlet, default).
    const hsnFor = new Map(products.map(p => [p.product_name, hsnResolver.resolve(p)]));
    const hsnOf = (productName) => (hsnFor.get(productName) || {}).code || '';

    // HSN problems are listed once per product, not once per bill.
    const hsnChecked = new Set();
    function checkHsn(productName, hsn, rate, isFuel) {
        if (hsnChecked.has(productName)) return;
        hsnChecked.add(productName);
        if (!hsn) {
            errors.push({ msg: `${productName}: no HSN code, and no default for its kind of product.`, fix: 'GST Returns > HSN codes: enter the HSN for this product.' });
        } else if (!isValidHsn(hsn)) {
            errors.push({ msg: `${productName}: HSN "${hsn}" is not a 4, 6 or 8 digit code.`, fix: 'Products master: correct the HSN code.' });
        } else if (!hsnDesc.has(hsn)) {
            warnings.push({ msg: `${productName}: HSN ${hsn} is not in the HSN master, so the file describes it by product name.`, fix: 'GST Returns > HSN codes: add the code with its portal description.' });
        } else if (hsn.length === 4) {
            warnings.push({ msg: `${productName}: HSN ${hsn} has only 4 digits. Above ₹5 crore turnover (fuel counts) the portal needs 6.` });
        } else if (!isFuel && hsn.startsWith('2710') && rate !== 18) {
            warnings.push({ msg: `${productName}: HSN ${hsn} is the code for petroleum oils / lubricants but the item is billed at ${rate}%. Check the HSN with your auditor once.` });
        }
    }

    // ---------- B2B: credit bills to customers with a GSTIN ----------
    const invoices = new Map();   // gstin|bill_no -> invoice
    const fuelB2B = new Map();    // product_name -> { qty, value }
    let nilB2B = 0;               // non-fuel 0% lines to registered customers
    const hsnB2B = hsnBucket();
    const b2bTotals = { amount: 0, txval: 0, camt: 0, samt: 0 };
    const badCustomers = new Map();

    for (const line of b2bLines) {
        const gstin = line.gstin;
        const amount = num(line.amount);
        if (line.is_fuel) {
            const f = fuelB2B.get(line.product_name) || { qty: 0, value: 0 };
            f.qty += num(line.qty);
            f.value += num(line.qty) * num(line.price);   // pump price, as the GST Summary fuel figure
            fuelB2B.set(line.product_name, f);
            continue;
        }

        if (!isValidGstin(gstin)) {
            badCustomers.set(line.creditlist_id, `${line.customer}: GSTIN "${gstin}" is not valid (wrong length, format or check digit).`);
        } else if (gstin === ownGstin) {
            badCustomers.set(line.creditlist_id, `${line.customer}: GSTIN ${gstin} is your own GSTIN. A bill to yourself is not a sale and the portal rejects it.`);
        }

        const rate = r2(line.gst_rate);
        const cgst = num(line.cgst), sgst = num(line.sgst);
        const txval = amount - cgst - sgst;
        b2bTotals.amount += amount; b2bTotals.txval += txval; b2bTotals.camt += cgst; b2bTotals.samt += sgst;

        checkHsn(line.product_name, hsnOf(line.product_name), rate, false);
        hsnB2B.add(hsnOf(line.product_name), rate, uqcFor(line.unit), line.product_name, line.qty, txval, cgst, sgst);

        if (rate === 0) { nilB2B += amount; continue; }

        const key = `${gstin}|${line.bill_no}`;
        if (!invoices.has(key)) {
            invoices.set(key, {
                bill_no: line.bill_no, gstin, customer: line.customer,
                bill_date: line.bill_date, dates: new Set(), lines: [], items: new Map(), val: 0
            });
        }
        const inv = invoices.get(key);
        inv.dates.add(moment(line.bill_date).format('YYYY-MM-DD'));
        if (moment(line.bill_date).isBefore(inv.bill_date)) inv.bill_date = line.bill_date;
        inv.val += amount;
        inv.lines.push({ product: line.product_name, hsn: hsnOf(line.product_name), qty: num(line.qty), rate, txval, cgst, sgst, amount });
        const item = inv.items.get(rate) || { txval: 0, camt: 0, samt: 0 };
        item.txval += txval; item.camt += cgst; item.samt += sgst;
        inv.items.set(rate, item);
    }
    badCustomers.forEach(msg => errors.push({ msg, fix: 'Credit Customers master: correct or clear the GSTIN, then come back.' }));

    // Fuel lines on a bill that also has non-fuel items count in that invoice's value.
    for (const line of b2bLines) {
        if (!line.is_fuel) continue;
        const inv = invoices.get(`${line.gstin}|${line.bill_no}`);
        if (inv) inv.val += num(line.amount);
    }

    // Bill numbers: portal limits, and one number may not go to two customers.
    const billOwner = new Map();
    for (const inv of invoices.values()) {
        if (!isValidDocNo(inv.bill_no)) {
            errors.push({ msg: `Bill "${inv.bill_no || '(blank)'}" to ${inv.customer}: the portal accepts up to 16 letters, digits, / or - only.`, fix: 'Correct the bill number on that credit bill.' });
        }
        if (billOwner.has(inv.bill_no) && billOwner.get(inv.bill_no) !== inv.gstin) {
            errors.push({ msg: `Bill ${inv.bill_no} is used for two different customers this month.`, fix: 'Correct the bill number on one of the credit bills.' });
        }
        billOwner.set(inv.bill_no, inv.gstin);
        if (inv.dates.size > 1) {
            warnings.push({ msg: `Bill ${inv.bill_no} (${inv.customer}) has lines on ${inv.dates.size} different dates; filed as one invoice dated ${moment(inv.bill_date).format('DD-MMM-YYYY')}.` });
        }
        if (moment(inv.bill_date).isBefore(from_date)) {
            warnings.push({ msg: `Bill ${inv.bill_no} (${inv.customer}) is dated ${moment(inv.bill_date).format('DD-MMM-YYYY')}, before this month, but its shift closed this month. It is filed in this month (as in the GST Summary).` });
        }
    }

    const invoiceList = Array.from(invoices.values())
        .sort((a, b) => moment(a.bill_date).diff(moment(b.bill_date)) || String(a.bill_no).localeCompare(String(b.bill_no)));

    const b2bByCustomer = new Map();
    for (const inv of invoiceList) {
        if (!b2bByCustomer.has(inv.gstin)) b2bByCustomer.set(inv.gstin, []);
        b2bByCustomer.get(inv.gstin).push({
            inum: inv.bill_no,
            idt: moment(inv.bill_date).format('DD-MM-YYYY'),
            val: r2(inv.val),
            pos: stateCode,
            rchrg: 'N',
            inv_typ: 'R',
            itms: Array.from(inv.items.entries()).map(([rt, it], i) => ({
                num: i + 1,
                itm_det: { txval: r2(it.txval), rt, iamt: 0, camt: r2(it.camt), samt: r2(it.samt), csamt: 0 }
            }))
        });
    }
    const b2b = Array.from(b2bByCustomer.entries()).map(([ctin, inv]) => ({ ctin, inv }));

    // ---------- B2C: all other non-fuel sales, straight from the GST Summary rows ----------
    const b2csByRate = new Map();
    const hsnB2C = hsnBucket();
    const b2cTotals = { amount: 0, txval: 0, camt: 0, samt: 0 };
    let nilB2C = 0;
    const b2cView = [];

    for (const row of b2cItems) {
        const product = productByName.get(row.product_name);
        const rate = r2(String(row.gst_rate).replace('%', ''));
        const amount = num(row.total_amount), cgst = num(row.total_cgst), sgst = num(row.total_sgst);
        const txval = amount - cgst - sgst;
        b2cTotals.amount += amount; b2cTotals.txval += txval; b2cTotals.camt += cgst; b2cTotals.samt += sgst;

        if (!product) {
            errors.push({ msg: `${row.product_name}: sold this month but not found in the product master.`, fix: 'Check the product name in the Products master.' });
            continue;
        }
        checkHsn(row.product_name, hsnOf(row.product_name), rate, false);
        hsnB2C.add(hsnOf(row.product_name), rate, uqcFor(product.unit), row.product_name, row.total_qty, txval, cgst, sgst);
        b2cView.push({ product: row.product_name, hsn: hsnOf(row.product_name), rate, qty: num(row.total_qty), txval, cgst, sgst, amount });

        if (rate === 0) { nilB2C += amount; continue; }
        b2csByRate.set(rate, (b2csByRate.get(rate) || 0) + amount);
    }
    // B2C is one line per rate for the month, not real invoices: value = sales ÷ (1 + rate)
    // and tax on that, as the auditor files it. Summing the tax rounded on each bill
    // instead can be a paisa off.
    const b2cs = Array.from(b2csByRate.entries()).sort((a, b) => a[0] - b[0]).map(([rt, amount]) => {
        const split = splitGross(amount, rt);
        return { sply_ty: 'INTRA', pos: stateCode, typ: 'OE', rt, txval: split.txval, iamt: 0, camt: split.half, samt: split.half, csamt: 0 };
    });

    // ---------- Fuel: non-GST supply (Table 8), split registered / unregistered ----------
    const fuelView = [];
    let fuelTotal = 0, fuelB2BTotal = 0;
    for (const row of fuelRows) {
        const b2bPart = fuelB2B.get(row.product) || { qty: 0, value: 0 };
        const total = num(row.amount), litres = num(row.litres);
        const b2cValue = total - b2bPart.value, b2cQty = litres - b2bPart.qty;
        fuelTotal += total; fuelB2BTotal += b2bPart.value;
        if (b2cValue < -TIE_TOLERANCE) {
            warnings.push({ msg: `${row.product}: credit sales to GST customers (₹${r2(b2bPart.value)}) are more than the meter sales (₹${r2(total)}). Check the readings.` });
        }
        fuelView.push({ product: row.product, hsn: hsnOf(row.product), litres, total, b2bQty: b2bPart.qty, b2bValue: b2bPart.value, b2cQty, b2cValue });
        if (includeFuelInHsn) {
            checkHsn(row.product, hsnOf(row.product), 0, true);
            if (b2bPart.value) hsnB2B.add(hsnOf(row.product), 0, 'LTR', row.product, b2bPart.qty, b2bPart.value, 0, 0);
            if (b2cValue) hsnB2C.add(hsnOf(row.product), 0, 'LTR', row.product, b2cQty, b2cValue, 0, 0);
        }
    }
    const fuelB2CTotal = fuelTotal - fuelB2BTotal;

    const nilInv = [];
    if (nilB2B || fuelB2BTotal) nilInv.push({ sply_ty: 'INTRAB2B', nil_amt: r2(nilB2B), expt_amt: 0, ngsup_amt: r2(fuelB2BTotal) });
    if (nilB2C || fuelB2CTotal) nilInv.push({ sply_ty: 'INTRAB2C', nil_amt: r2(nilB2C), expt_amt: 0, ngsup_amt: r2(fuelB2CTotal) });

    // ---------- Table 12: HSN summary ----------
    // B2C rows are split from the sale value the same way as b2cs, so the two tables agree.
    const toHsnJson = (rows, fromGross) => rows.map((h, i) => {
        const split = fromGross ? splitGross(h.txval + h.camt + h.samt, h.rt) : null;
        return {
            num: i + 1,
            hsn_sc: h.hsn_sc,
            desc: hsnDesc.get(h.hsn_sc) || cleanDesc(h.products),
            user_desc: cleanDesc(h.products),
            uqc: h.uqc,
            qty: r2(h.qty),
            rt: h.rt,
            txval: split ? split.txval : r2(h.txval),
            iamt: 0,
            camt: split ? split.half : r2(h.camt),
            samt: split ? split.half : r2(h.samt),
            csamt: 0
        };
    });
    // HSN rows with a bad code are listed as errors above; keep them out of the file.
    const hsnB2BRows = hsnB2B.rows(), hsnB2CRows = hsnB2C.rows();
    const hsnJson = {};
    const hsnB2BJson = toHsnJson(hsnB2BRows.filter(h => isValidHsn(h.hsn_sc)));
    const hsnB2CJson = toHsnJson(hsnB2CRows.filter(h => isValidHsn(h.hsn_sc)), true);
    if (hsnB2BJson.length) hsnJson.hsn_b2b = hsnB2BJson;
    if (hsnB2CJson.length) hsnJson.hsn_b2c = hsnB2CJson;

    // ---------- Table 13: documents issued ----------
    // As the auditor files it: one day bill per day for lubes (OIL) and for each fuel,
    // numbered <GROUP>/<MON>/<DD>; days without a closed shift count as cancelled.
    // Then the B2B bill numbers, and the reverse-charge self-invoices as type 2.
    const mon = moment(from_date).format('MMM').toUpperCase();
    const dayNos = saleDays.map(d => moment(d.sale_date).date());
    const docView = [];
    if (dayNos.length) {
        const lastDay = Math.max(...dayNos);
        const dd = (n) => String(n).padStart(2, '0');
        const groups = [];
        if (b2bTotals.amount + b2cTotals.amount > 0) groups.push('OIL');
        fuelRows.filter(f => num(f.amount) > 0).forEach(f => {
            const g = fuelDocGroup(f.product);
            if (!groups.includes(g)) groups.push(g);
        });
        const order = ['OIL', 'MS', 'HSD', 'CNG'];
        groups.sort((x, y) => order.indexOf(x) - order.indexOf(y));
        groups.forEach(g => docView.push({
            doc_num: DOC_OUTWARD, series: `Day bills · ${g}`,
            from: `${g}/${mon}/01`, to: `${g}/${mon}/${dd(lastDay)}`, totnum: lastDay, cancel: lastDay - dayNos.length
        }));
    }
    if (invoiceList.length) {
        docView.push(Object.assign({ doc_num: DOC_OUTWARD, series: 'Credit bills to GST customers (B2B)' },
            docRange(invoiceList.map(inv => String(inv.bill_no)))));
    }
    if (rcmEntries.length) {
        docView.push(Object.assign({ doc_num: DOC_INWARD_UNREG, series: 'Reverse charge self-invoices' },
            docRange(rcmEntries.map(e => e.self_invoice_no))));
    }
    docView.forEach(d => {
        d.net_issue = d.totnum - d.cancel;
        if (!isValidDocNo(d.from) || !isValidDocNo(d.to)) {
            warnings.push({ msg: `Table 13 ${d.series}: "${!isValidDocNo(d.from) ? d.from : d.to}" is longer than 16 characters or has symbols; left out of the file, enter it on the portal.` });
        }
    });
    const docJson = docView.filter(d => isValidDocNo(d.from) && isValidDocNo(d.to));

    // ---------- Tie-out against the GST Summary ----------
    const reportB2B = b2bReportRows.reduce((t, r) => {
        t.amount += num(r.Amount); t.camt += num(r.CGST); t.samt += num(r.SGST); return t;
    }, { amount: 0, camt: 0, samt: 0 });
    const reportNonFuelTotal = nonFuelConsolidated.reduce((t, r) => t + num(r.total_amount), 0);
    const tieOut = [
        { label: 'B2B non-fuel sales (incl. GST)', report: reportB2B.amount, file: b2bTotals.amount },
        { label: 'B2B CGST', report: reportB2B.camt, file: b2bTotals.camt },
        { label: 'B2B SGST', report: reportB2B.samt, file: b2bTotals.samt },
        { label: 'All non-fuel sales (incl. GST)', report: reportNonFuelTotal, file: b2bTotals.amount + b2cTotals.amount },
        { label: 'Fuel sales (non-GST)', report: fuelRows.reduce((t, r) => t + num(r.amount), 0), file: fuelB2BTotal + fuelB2CTotal }
    ].map(t => Object.assign(t, { diff: r2(t.file - t.report), ok: Math.abs(t.file - t.report) <= TIE_TOLERANCE }));
    tieOut.filter(t => !t.ok).forEach(t => errors.push({
        msg: `${t.label}: this file ₹${r2(t.file)} vs GST Summary ₹${r2(t.report)} (difference ₹${t.diff}).`,
        fix: 'Do not upload. Report this to PetroMath support.'
    }));

    // ---------- GSTR-3B Table 3.1 (the worksheet adds credit and payment) ----------
    // 3.1(a) is what the portal adds up from the file: the rounded b2b item and b2cs rows
    // (0% non-fuel lines are not in them; they go in 3.1(c)).
    const outward = { txval: 0, camt: 0, samt: 0 };
    const addFiled = (d) => { outward.txval += d.txval; outward.camt += d.camt; outward.samt += d.samt; };
    b2cs.forEach(addFiled);
    b2b.forEach(c => c.inv.forEach(inv => inv.itms.forEach(it => addFiled(it.itm_det))));
    const gstr3b = {
        outward: { txval: r2(outward.txval), camt: r2(outward.camt), samt: r2(outward.samt) },
        nil: nilB2B + nilB2C,
        nonGst: fuelTotal
    };

    const json = { gstin: ownGstin, fp: returnPeriod, version: JSON_VERSION, hash: 'hash' };
    if (b2b.length) json.b2b = b2b;
    if (b2cs.length) json.b2cs = b2cs;
    if (nilInv.length) json.nil = { inv: nilInv };
    if (Object.keys(hsnJson).length) json.hsn = hsnJson;
    if (docJson.length) {
        const docDet = [DOC_OUTWARD, DOC_INWARD_UNREG].map(docNum => ({
            doc_num: docNum,
            docs: docJson.filter(d => d.doc_num === docNum)
                .map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.totnum, cancel: d.cancel, net_issue: d.net_issue }))
        })).filter(d => d.docs.length);
        json.doc_issue = { doc_det: docDet };
    }

    return {
        json,
        canDownload: errors.length === 0,
        errors,
        warnings,
        period: {
            code: returnPeriod,
            label: gstUtils.formatReturnPeriod(returnPeriod),
            from: moment(from_date).format('DD-MMM-YYYY'),
            to: moment(to_date).format('DD-MMM-YYYY'),
            financialYear: financial_year
        },
        gstin: ownGstin,
        includeFuelInHsn,
        invoices: invoiceList.map(inv => Object.assign({}, inv, { date: moment(inv.bill_date).format('DD-MMM-YYYY'), dates: undefined, items: undefined })),
        b2bTotals,
        b2c: b2cView,
        b2cs,
        b2cTotals,
        fuel: fuelView,
        fuelTotals: { total: fuelTotal, b2b: fuelB2BTotal, b2c: fuelB2CTotal },
        nil: { b2b: nilB2B, b2c: nilB2C },
        hsnB2B: hsnB2BRows,
        hsnB2C: hsnB2CRows,
        hsnDesc,
        hsnSources: Array.from(hsnChecked).map(name => Object.assign({ product: name }, hsnFor.get(name) || { code: '', source: 'none' }))
            .filter(h => h.source !== 'product'),
        docs: docView,
        tieOut,
        gstr3b
    };
}

module.exports = { buildGstr1, isValidGstin, JSON_VERSION };
