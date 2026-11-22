// services/tt-bpcl-advice-parser.js — reads BPCL's transporter payment advice (SAP report AP210,
// saved to Excel). One file = one payment ("clearing document").
//
//   A1  "AP210 for Vendor 0000215266 for 09/2026"
//   A2  "Clearing Document Number : 0041494442"   E2 "Clearing Date : 2026-09-10"
//   A3  "Gross Amount : 163661.38"                E3 "Loss Recovery : 64154.55"
//   A4  "TDS Recovery : 3275.00"                  E4 "Net Amount Payable : 96231.83"
//   row 5 headers: DtOfDesp., Ship.No, Tpp/Consgn., Veh.No., Cust/Plant/consig.(code),
//                  Cust/Plant/consig.(name), Product, Prod.Qty, Rate, Distance, CreditAmount,
//                  DebitAmount, Ref.Doc.No.
//   rows       freight      a shipment line (Ship.No, vehicle, product, qty, CreditAmount)
//              FLEET CARD DEBIT     DebitAmount = moved onto the truck's fleet card (part of Loss Recovery)
//              Tracking No:<vendor><plant><yyyymm><nn>  CreditAmount = toll paid back
// Gross = all credits; Net = Gross - Loss Recovery - TDS. Ref.Doc.No. (the 16-digit invoice no)
// is stored by Excel as a number and has lost its last digits, so it is NOT used: freight rows
// are tied to the uploaded invoices by shipment + product instead.

const XLSX = require('xlsx');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
    if (v == null || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
};
const intStr = (v) => (v == null || v === '' ? null : String(typeof v === 'number' ? Math.round(v) : String(v).trim()));

function isoDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
        // Excel day serial (1 = 1900-01-01, with the 1900 leap-year bug): days after 1899-12-30, UTC.
        // Converting a JS Date instead shifts the day by the time zone.
        return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(s))) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

// "Label : value" anywhere in the top rows
function headerValue(cells, label) {
    const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'i');
    for (const c of cells) {
        const m = re.exec(String(c == null ? '' : c));
        if (m) return m[1];
    }
    return null;
}

const COLS = {
    date: /^DtOfDesp/i, ship: /^Ship\.?No/i, plant: /^Tpp/i, vehicle: /^Veh/i, custCode: /\(code\)/i,
    custName: /\(name\)/i, product: /^Product/i, qty: /^Prod\.?Qty/i, rate: /^Rate/i, distance: /^Distance/i,
    credit: /^CreditAmount/i, debit: /^DebitAmount/i, refDoc: /^Ref\.?Doc/i,
};

function parseBpclPaymentAdvice(buffer) {
    let wb;
    try {
        wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } catch (e) {
        throw new Error('This file could not be opened as an Excel workbook.');
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('The workbook has no sheet.');
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });

    const top = [].concat(...grid.slice(0, 6));
    const title = top.find(c => /AP210 for Vendor/i.test(String(c || '')));
    if (!title) throw new Error('This is not a BPCL payment advice (no "AP210 for Vendor" title found).');
    const tm = /AP210 for Vendor\s*0*(\d+)\s*for\s*(\d{2})\/(\d{4})/i.exec(String(title));
    const header = {
        vendor_code: tm ? tm[1] : null,
        advice_period: tm ? `${tm[3]}-${tm[2]}` : null,
        clearing_doc_no: (headerValue(top, 'Clearing Document Number') || '').replace(/^0+/, '') || null,
        clearing_date: isoDate(headerValue(top, 'Clearing Date')),
        gross_amount: r2(num(headerValue(top, 'Gross Amount'))),
        loss_recovery: r2(num(headerValue(top, 'Loss Recovery'))),
        tds_amount: r2(num(headerValue(top, 'TDS Recovery'))),
        net_amount: r2(num(headerValue(top, 'Net Amount Payable'))),
    };
    if (!header.vendor_code) throw new Error('Vendor code not found in the title ("AP210 for Vendor …").');
    if (!header.clearing_doc_no) throw new Error('"Clearing Document Number" not found.');
    if (!header.clearing_date) throw new Error('"Clearing Date" not found.');

    const hIdx = grid.findIndex(r => r.some(c => COLS.ship.test(String(c || ''))) && r.some(c => COLS.credit.test(String(c || ''))));
    if (hIdx < 0) throw new Error('The column header row (Ship.No … CreditAmount …) was not found.');
    const col = {};
    grid[hIdx].forEach((c, i) => {
        for (const [k, re] of Object.entries(COLS)) if (col[k] === undefined && re.test(String(c || '').trim())) col[k] = i;
    });
    for (const k of ['date', 'ship', 'custName', 'credit', 'debit']) {
        if (col[k] === undefined) throw new Error(`Column "${k}" not found in the header row.`);
    }

    const lines = [];
    const warnings = [];
    grid.slice(hIdx + 1).forEach((r, i) => {
        const g = (k) => (col[k] === undefined ? null : r[col[k]]);
        const name = String(g('custName') || '').trim();
        const credit = r2(num(g('credit'))), debit = r2(num(g('debit')));
        if (!name && !credit && !debit) return;
        let kind = 'OTHER', trackingNo = null;
        let m;
        if (/^FLEET CARD DEBIT/i.test(name)) kind = 'FLEET_CARD';
        else if ((m = /^Tracking No\s*:\s*(\S+)/i.exec(name))) { kind = 'TOLL'; trackingNo = m[1]; }
        else if (g('vehicle') && num(g('qty')) > 0) kind = 'FREIGHT';
        if (kind === 'OTHER') warnings.push(`Row ${hIdx + i + 2} ("${name}") is not a shipment, fleet card or toll line; it is kept as "other".`);
        lines.push({
            sno: lines.length + 1,
            line_kind: kind,
            txn_date: isoDate(g('date')),
            doc_no: intStr(g('ship')),
            vehicle_no: g('vehicle') ? String(g('vehicle')).replace(/\s/g, '').toUpperCase() : null,
            material_code: intStr(g('product')),
            qty_kl: num(g('qty')),
            rate: num(g('rate')),
            distance: num(g('distance')),
            party_name: name.substring(0, 100) || null,
            tracking_no: trackingNo,
            credit_amount: credit,
            debit_amount: debit,
        });
    });
    if (!lines.length) throw new Error('No lines found under the header row.');

    const sum = (k, kind) => r2(lines.filter(l => !kind || l.line_kind === kind).reduce((s, l) => s + l[k], 0));
    const totals = {
        credits: sum('credit_amount'),
        freight: sum('credit_amount', 'FREIGHT'),
        toll: sum('credit_amount', 'TOLL'),
        other_credit: sum('credit_amount', 'OTHER'),
        fleet_card: sum('debit_amount', 'FLEET_CARD'),
        other_debit: r2(sum('debit_amount') - sum('debit_amount', 'FLEET_CARD')),
    };
    if (Math.abs(totals.credits - header.gross_amount) > 0.05) {
        throw new Error(`The lines add up to ${totals.credits.toFixed(2)} but "Gross Amount" is ${header.gross_amount.toFixed(2)}. The file was not read correctly.`);
    }
    const net = r2(header.gross_amount - header.loss_recovery - header.tds_amount);
    if (Math.abs(net - header.net_amount) > 0.05) {
        throw new Error(`Gross ${header.gross_amount.toFixed(2)} − Loss Recovery ${header.loss_recovery.toFixed(2)} − TDS ${header.tds_amount.toFixed(2)} = ${net.toFixed(2)}, but "Net Amount Payable" is ${header.net_amount.toFixed(2)}.`);
    }
    // Loss Recovery not explained by the fleet card debits in the file
    totals.other_recovery = r2(header.loss_recovery - totals.fleet_card - totals.other_debit);

    return { oil_company: 'BPCL', header, lines, totals, warnings };
}

module.exports = { parseBpclPaymentAdvice };
