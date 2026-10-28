// utils/einvoice.js — GST e-invoice (IRP) helpers for invoices raised by hand on
// einvoice1.gst.gov.in: build the bulk-upload JSON (NIC e-invoice schema 1.1),
// read the portal's result file back (IRN, Ack No/Date, signed QR), and draw the
// signed QR for the printed invoice.
const XLSX = require('xlsx');
const qrcode = require('./vendor/qrcode-generator');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Schema limits: Addr1/Addr2 3–100 chars. Split a long address at a comma.
function splitAddress(address) {
    const text = String(address || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 100) return { Addr1: text };
    let cut = text.lastIndexOf(',', 100);
    if (cut < 3) cut = 100;
    const addr1 = text.substring(0, cut).trim();
    const addr2 = text.substring(cut + 1).trim().substring(0, 100);
    return addr2.length >= 3 ? { Addr1: addr1, Addr2: addr2 } : { Addr1: addr1 };
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'
const portalDate = (iso) => iso.split('-').reverse().join('/');

// Why an invoice can't go to the IRP (empty = ready)
function einvoiceProblems(inv, settings) {
    const problems = [];
    if (!inv.tenant_gstin) problems.push('tenant has no GSTIN (B2C — no e-invoice)');
    if (!/^[A-Z1-9][A-Z0-9/-]{0,15}$/.test(String(inv.invoice_no))) problems.push(`invoice no ${inv.invoice_no} not allowed by the IRP`);
    if (!/^[1-9]\d{5}$/.test(inv.tenant_pincode || '')) problems.push('tenant PIN missing');
    if (!inv.tenant_city || inv.tenant_city.length < 3) problems.push('tenant city missing');
    if (!inv.tenant_address || inv.tenant_address.length < 3) problems.push('tenant address missing');
    if (!/^[1-9]\d{5}$/.test(settings.landlord_pincode || '')) problems.push('landlord PIN missing in Settings');
    if (!settings.landlord_city || settings.landlord_city.length < 3) problems.push('landlord city missing in Settings');
    return problems;
}

// One e-invoice object (schema 1.1) for a FINAL rent invoice. Rent is an
// intra-state service (CGST + SGST), so IGST is always 0.
function buildEinvoice(inv, settings) {
    const taxable = round2(inv.taxable_value);
    const cgst = round2(inv.cgst_amount);
    const sgst = round2(inv.sgst_amount);
    const total = round2(inv.total_amount);
    const rate = round2(Number(inv.cgst_rate) + Number(inv.sgst_rate));
    return {
        Version: '1.1',
        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
        DocDtls: { Typ: 'INV', No: String(inv.invoice_no), Dt: portalDate(inv.invoice_date_iso) },
        SellerDtls: {
            Gstin: settings.gstin,
            LglNm: settings.landlord_name,
            ...splitAddress(settings.landlord_address),
            Loc: settings.landlord_city,
            Pin: Number(settings.landlord_pincode),
            Stcd: settings.gstin.substring(0, 2),
        },
        BuyerDtls: {
            Gstin: inv.tenant_gstin,
            LglNm: inv.tenant_name,
            Pos: inv.tenant_gstin.substring(0, 2),
            ...splitAddress(inv.tenant_address),
            Loc: inv.tenant_city,
            Pin: Number(inv.tenant_pincode),
            Stcd: inv.tenant_gstin.substring(0, 2),
        },
        ItemList: [{
            SlNo: '1',
            PrdDesc: String(inv.description).substring(0, 300),
            IsServc: 'Y',
            HsnCd: inv.sac_code,
            Qty: 1,
            Unit: 'OTH',
            UnitPrice: taxable,
            TotAmt: taxable,
            Discount: 0,
            AssAmt: taxable,
            GstRt: rate,
            IgstAmt: 0,
            CgstAmt: cgst,
            SgstAmt: sgst,
            CesRt: 0,
            CesAmt: 0,
            CesNonAdvlAmt: 0,
            StateCesRt: 0,
            StateCesAmt: 0,
            StateCesNonAdvlAmt: 0,
            OthChrg: 0,
            TotItemVal: total,
        }],
        ValDtls: {
            AssVal: taxable, CgstVal: cgst, SgstVal: sgst, IgstVal: 0, CesVal: 0, StCesVal: 0,
            Discount: 0, OthChrg: 0, RndOffAmt: 0, TotInvVal: total,
        },
    };
}

// ── Portal result file ──────────────────────────────────────────────────────
// The portal's bulk-generation result can be downloaded as JSON or Excel. Both
// are read by name, not position: any row/object with an IRN and a document
// number counts. Keys are compared with spaces/underscores removed, any case.
const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const KEYS = {
    docNo: ['docno', 'documentno', 'documentnumber', 'docnumber', 'invoiceno', 'invoicenumber', 'no'],
    irn: ['irn', 'irnno', 'irnnumber'],
    ackNo: ['ackno', 'acknowledgementno', 'acknowledgementnumber', 'acknumber'],
    ackDt: ['ackdt', 'ackdate', 'acknowledgementdate'],
    qr: ['signedqrcode', 'signedqr', 'qrcode'],
    buyerGstin: ['buyergstin', 'recipientgstin', 'ctin', 'gstinofbuyer', 'buyergstinuin'],
};

function pick(obj, names) {
    for (const [k, v] of Object.entries(obj)) {
        if (names.includes(norm(k)) && v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
    return null;
}

function toRecord(obj) {
    // flatten one level (e.g. { DocDtls: { No } } or { Data: { Irn } })
    const flat = { ...obj };
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(flat, v);
    }
    if (flat.DocDtls && flat.DocDtls.No) flat.DocNo = flat.DocDtls.No;
    if (flat.BuyerDtls && flat.BuyerDtls.Gstin) flat.BuyerGstin = flat.BuyerDtls.Gstin;
    const irn = pick(flat, KEYS.irn);
    const docNo = pick(flat, KEYS.docNo);
    if (!irn || !/^[0-9a-f]{64}$/i.test(irn) || !docNo) return null;
    return {
        docNo,
        irn: irn.toLowerCase(),
        ackNo: pick(flat, KEYS.ackNo),
        ackDt: pick(flat, KEYS.ackDt),
        signedQr: pick(flat, KEYS.qr),
        buyerGstin: pick(flat, KEYS.buyerGstin),
    };
}

function collectJson(node, out) {
    if (Array.isArray(node)) { node.forEach(n => collectJson(n, out)); return; }
    if (!node || typeof node !== 'object') return;
    const rec = toRecord(node);
    if (rec) out.push(rec);
    else Object.values(node).forEach(v => collectJson(v, out));
}

// Returns [{ docNo, irn, ackNo, ackDt, signedQr, buyerGstin }]
function parseResultFile(buffer, filename) {
    const out = [];
    if (/\.json$/i.test(filename)) {
        collectJson(JSON.parse(buffer.toString('utf8').replace(/^﻿/, '')), out);
        return out;
    }
    const wb = XLSX.read(buffer, { type: 'buffer' });
    for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
        const headerIdx = rows.findIndex(r => r.some(c => KEYS.irn.includes(norm(c))));
        if (headerIdx < 0) continue;
        const header = rows[headerIdx];
        for (const row of rows.slice(headerIdx + 1)) {
            const obj = {};
            header.forEach((h, i) => { if (h) obj[h] = row[i]; });
            const rec = toRecord(obj);
            if (rec) out.push(rec);
        }
    }
    return out;
}

// Signed QR from the IRP as an inline SVG (scaled by CSS on the invoice)
function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(2, 0);
}

module.exports = { buildEinvoice, einvoiceProblems, parseResultFile, qrSvg };
