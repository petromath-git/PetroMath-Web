// services/tt-invoice-parser.js — reads the oil company's tank-truck freight bill PDF (Transport module).
//
// IOCL "Transportation Bill" (SAP, system generated after the trips are acknowledged):
//   header      vendor name / code / GSTIN, period, generation date, the IOCL terminal (recipient)
//   per bill    "Reverse Charge  Bill No. & Date:- 10134943TN25003 15.05.2025"
//   per vehicle a line with the vehicle number, then one row per trip:
//               SNo, delivery invoice, item, date, ship-to party, material, quantity (KL), shortage,
//               RTD P / H / HH (km), RATE P / H / HH, gross, penalty, IGST, CGST, S/UGST
//   totals      "Subtotal for Vehicle:", "Total for Bill:", "Total of All Bills:"
// One PDF can hold several bills (e.g. both halves of a month).
//
// pdf-parse's plain text runs the columns together (material 50700 + 4.000 KL -> "507004.000 KL"),
// so the cells are read from pdf.js text items, which keep every column apart. Rows are read from
// the right: the last 14 cells are fixed columns, whatever is left after the date is the ship-to party.
// Every bill must add up to its printed totals, or the file is refused.

const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const VEHICLE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/;
const TOLERANCE = 0.05;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function toNumber(s) {
    const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isNaN(v) ? 0 : v;
}

// dd.mm.yyyy -> yyyy-mm-dd
function isoDate(s) {
    const m = DATE_RE.exec(String(s || '').trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function finishLine(l) {
    l.cells = l.raw.map(c => ({ x: c.x, s: c.s.trim() })).filter(c => c.s !== '');
    l.text = l.raw.map(c => c.s).join(' ').replace(/\s+/g, ' ').trim();
    return l;
}

// Per page, the same text two ways ({ x, s } cells, blanks dropped):
//   lines  runs of items in content-stream order that share a y (keeps the header's left and
//          right blocks apart, as they sit on the same y)
//   rows   every item on one y position, left to right, top to bottom. A trip row whose ship-to
//          name wraps is written as three runs (start of row, wrapped word, rest of row); the
//          first and last share a y, so here they are one row again.
async function loadPages(buffer) {
    const doc = await PDFJS.getDocument({ data: new Uint8Array(buffer) });
    const pages = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            const lines = [];
            const byY = new Map();
            let lastY;
            for (const item of content.items) {
                const y = Math.round(item.transform[5]);
                const cell = { x: item.transform[4], s: item.str };
                if (lastY === undefined || y !== lastY) lines.push({ y, raw: [] });
                lines[lines.length - 1].raw.push(cell);
                lastY = y;
                if (!byY.has(y)) byY.set(y, { y, raw: [] });
                byY.get(y).raw.push(cell);
            }
            const rows = Array.from(byY.values()).sort((a, b) => b.y - a.y);
            rows.forEach(r => r.raw.sort((a, b) => a.x - b.x));
            pages.push({ lines: lines.map(finishLine), rows: rows.map(finishLine) });
        }
    } finally {
        doc.destroy();
    }
    return pages;
}

function totalsFrom(cells) {
    // label, gross, penalty, igst, cgst, sgst
    const n = cells.slice(1).map(c => toNumber(c.s));
    return { gross: r2(n[0] || 0), penalty: r2(n[1] || 0), igst: r2(n[2] || 0), cgst: r2(n[3] || 0), sgst: r2(n[4] || 0) };
}

function isTripRow(line) {
    const c = line.cells;
    return c.length >= 18 && /^\d+$/.test(c[0].s) && /^\d{6,}$/.test(c[1].s) && /^\d+$/.test(c[2].s) && DATE_RE.test(c[3].s);
}

function parseTripRow(line, vehicleNo) {
    const c = line.cells.map(x => x.s);
    const n = c.length;
    const from = (k) => c[n - k];
    // Ship-to party may be split over several text items ("... UNIT " + "II"): join the raw strings.
    const shipTo = line.raw
        .filter(r => r.s.trim() !== '')
        .slice(4, n - 14)
        .map(r => r.s).join('').replace(/\s+/g, ' ').trim();
    const m = /^(\d+)\s*-\s*(.*)$/.exec(shipTo);
    const row = {
        sno: Number(c[0]),
        vehicle_no: vehicleNo,
        delivery_invoice_no: c[1],
        item_no: c[2],
        delivery_date: isoDate(c[3]),
        ship_to_code: m ? m[1] : null,
        ship_to_name: m ? m[2] : shipTo,
        material_code: from(14),
        qty_kl: toNumber(from(13)),
        shortage: toNumber(from(12)),
        rtd_p: toNumber(from(11)), rtd_h: toNumber(from(10)), rtd_hh: toNumber(from(9)),
        rate_p: toNumber(from(8)), rate_h: toNumber(from(7)), rate_hh: toNumber(from(6)),
        gross_amount: r2(toNumber(from(5))),
        penalty_amount: r2(toNumber(from(4))),
        igst_amount: r2(toNumber(from(3))),
        cgst_amount: r2(toNumber(from(2))),
        sgst_amount: r2(toNumber(from(1)))
    };
    // Freight = KL x (km x rate) over the plain / hilly / high-hilly legs
    row.expected_gross = r2(row.qty_kl * (row.rtd_p * row.rate_p + row.rtd_h * row.rate_h + row.rtd_hh * row.rate_hh));
    return row;
}

function sumRows(rows) {
    const t = { gross: 0, penalty: 0, igst: 0, cgst: 0, sgst: 0 };
    rows.forEach(r => { t.gross += r.gross_amount; t.penalty += r.penalty_amount; t.igst += r.igst_amount; t.cgst += r.cgst_amount; t.sgst += r.sgst_amount; });
    Object.keys(t).forEach(k => { t[k] = r2(t[k]); });
    return t;
}

function sameTotals(a, b) {
    return ['gross', 'penalty', 'igst', 'cgst', 'sgst'].every(k => Math.abs(a[k] - b[k]) <= TOLERANCE);
}

const fmt = (t) => `gross ${t.gross.toFixed(2)}, penalty ${t.penalty.toFixed(2)}, CGST ${t.cgst.toFixed(2)}, SGST ${t.sgst.toFixed(2)}, IGST ${t.igst.toFixed(2)}`;

// Returns { header, bills[], allBills, warnings[] }. Throws with a readable message when the file
// is not an IOCL transportation bill or does not add up.
async function parseIoclTransportBill(buffer) {
    if (!buffer || buffer.length < 5 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error('This is not a PDF file.');
    }
    const pages = await loadPages(buffer);
    const allLines = [].concat(...pages.map(p => p.lines));
    const allRows = [].concat(...pages.map(p => p.rows));
    const fullText = allLines.map(l => l.text).join('\n');
    if (!/Transportation Bill/i.test(fullText) || !/Bill No\.\s*&\s*Date/i.test(fullText)) {
        throw new Error('This PDF is not an IOCL Transportation Bill (no "Transportation Bill" / "Bill No. & Date" found).');
    }

    const header = { vendor_name: null, vendor_code: null, vendor_gstin: null, period_from: null, period_to: null,
        generated_on: null, recipient_name: null, recipient_gstin: null, recipient_address: null, state_office: null };
    const vendorX = (() => {
        const l = allLines.find(x => /Tax Invoice issued by/i.test(x.text));
        return l && l.cells.length ? l.cells[0].x : null;
    })();
    const page1 = pages.length ? pages[0].lines : [];
    for (let i = 0; i < page1.length; i++) {
        const l = page1[i];
        let m;
        if (/Tax Invoice issued by/i.test(l.text) && page1[i + 1]) header.vendor_name = page1[i + 1].text;
        if ((m = /Vendor code:\s*(\S+)/i.exec(l.text))) header.vendor_code = m[1];
        if ((m = /^GSTIN:-\s*([0-9A-Z]{15})/i.exec(l.text))) header.vendor_gstin = m[1].toUpperCase();
        if ((m = /\(GSTIN:-\s*([0-9A-Z]{15})\)/i.exec(l.text))) {
            header.recipient_gstin = m[1].toUpperCase();
            if (page1[i - 1]) header.recipient_name = page1[i - 1].text;
            header.recipient_address = [page1[i + 1], page1[i + 2]]
                .filter(x => x && vendorX !== null && x.cells.length && x.cells[0].x < vendorX - 50 && !/^Page /i.test(x.text))
                .map(x => x.text).join(', ') || null;
        }
        if ((m = /Period:\s*(\d{2}\.\d{2}\.\d{4})\s*to\s*(\d{2}\.\d{2}\.\d{4})/i.exec(l.text))) {
            header.period_from = isoDate(m[1]); header.period_to = isoDate(m[2]);
        }
        if ((m = /State Office\s*-\s*(\d+)/i.exec(l.text))) header.state_office = l.text;
        if ((m = /period on\s*(\d{2}\.\d{2}\.\d{4})/i.exec(l.text))) header.generated_on = isoDate(m[1]);
    }
    if (!header.vendor_gstin) throw new Error('Vendor GSTIN ("GSTIN:-") not found on the bill.');

    const bills = [];
    const warnings = [];
    let bill = null, vehicleNo = null, vehicleRows = [], allBills = null, lastRow = null;
    // x range of the ship-to column, from the first trip row: a line with text only there is the
    // wrapped end of the previous row's ship-to name
    let shipToX = null;

    for (const line of allRows) {
        const t = line.text;
        let m;
        if (lastRow && shipToX && line.cells.length && !isTripRow(line)
            && line.cells.every(c => c.x >= shipToX.from - 1 && c.x < shipToX.to)) {
            lastRow.ship_to_name = `${lastRow.ship_to_name} ${t}`.replace(/\s+/g, ' ').trim();
            continue;
        }
        lastRow = null;
        if ((m = /Bill No\.\s*&\s*Date:-\s*(\S+)\s+(\d{2}\.\d{2}\.\d{4})/i.exec(t))) {
            bill = { bill_no: m[1], bill_date: isoDate(m[2]), reverse_charge: /Reverse Charge/i.test(t) ? 'Y' : 'N',
                lines: [], vehicles: [], totals: null };
            bills.push(bill);
            vehicleNo = null; vehicleRows = [];
            continue;
        }
        if (line.cells.length === 1 && VEHICLE_RE.test(line.cells[0].s.replace(/\s/g, ''))) {
            vehicleNo = line.cells[0].s.replace(/\s/g, '');
            vehicleRows = [];
            continue;
        }
        if (isTripRow(line)) {
            if (!bill) throw new Error('A trip row was found before any "Bill No. & Date" line.');
            if (!vehicleNo) throw new Error(`Bill ${bill.bill_no}: a trip row was found before the vehicle number.`);
            const row = parseTripRow(line, vehicleNo);
            bill.lines.push(row);
            vehicleRows.push(row);
            if (!shipToX) {
                const n = line.cells.length;
                shipToX = { from: line.cells[4].x, to: line.cells[n - 14].x };
            }
            lastRow = row;
            continue;
        }
        if (/^Subtotal for Vehicle:/i.test(t)) {
            const printed = totalsFrom(line.cells);
            const sum = sumRows(vehicleRows);
            if (!sameTotals(printed, sum)) {
                throw new Error(`Bill ${bill ? bill.bill_no : '?'}, vehicle ${vehicleNo}: the trip rows add up to ${fmt(sum)} but the bill prints ${fmt(printed)}. The file was not read correctly.`);
            }
            bill.vehicles.push({ vehicle_no: vehicleNo, trips: vehicleRows.length, totals: printed });
            continue;
        }
        if (/^Total for Bill:/i.test(t)) {
            if (!bill) throw new Error('"Total for Bill" found before any bill.');
            bill.totals = totalsFrom(line.cells);
            continue;
        }
        if (/^Total of All Bills:/i.test(t)) {
            allBills = totalsFrom(line.cells);
        }
    }

    if (!bills.length) throw new Error('No bills found in the file.');
    for (const b of bills) {
        if (!b.lines.length) throw new Error(`Bill ${b.bill_no} has no trip rows.`);
        if (!b.totals) throw new Error(`Bill ${b.bill_no}: "Total for Bill" line not found.`);
        const sum = sumRows(b.lines);
        if (!sameTotals(sum, b.totals)) {
            throw new Error(`Bill ${b.bill_no}: the trip rows add up to ${fmt(sum)} but the bill prints ${fmt(b.totals)}. The file was not read correctly.`);
        }
        b.lines.forEach(r => {
            if (Math.abs(r.expected_gross - r.gross_amount) > 0.05) {
                warnings.push(`Bill ${b.bill_no} row ${r.sno} (invoice ${r.delivery_invoice_no}): ${r.qty_kl} KL x distance x rate = ${r.expected_gross.toFixed(2)}, the bill shows ${r.gross_amount.toFixed(2)}.`);
            }
        });
        if (b.totals.penalty > 0) warnings.push(`Bill ${b.bill_no} has a penalty of ${b.totals.penalty.toFixed(2)}; taxable value is taken as gross less penalty.`);
        if (b.reverse_charge !== 'Y') warnings.push(`Bill ${b.bill_no} is not marked "Reverse Charge". Check how GST is charged on it before saving.`);
    }
    if (allBills) {
        const sum = bills.reduce((t, b) => {
            Object.keys(t).forEach(k => { t[k] = r2(t[k] + b.totals[k]); });
            return t;
        }, { gross: 0, penalty: 0, igst: 0, cgst: 0, sgst: 0 });
        if (!sameTotals(sum, allBills)) {
            throw new Error(`The bills add up to ${fmt(sum)} but "Total of All Bills" prints ${fmt(allBills)}. The file was not read correctly.`);
        }
    }

    return { oil_company: 'IOCL', header, bills, allBills, warnings };
}

module.exports = { parseIoclTransportBill, isoDate, toNumber };
