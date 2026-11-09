// Writes the made-up statement files the upload videos pick (ticket #471), dated over the past week so they
// always look recent. Column layouts match the beta templates:
//   IOB "IOB New Portal 2026" (template 8): header row 1; B date, C value date, D ref, E description, G debit, H credit, I balance; DD/MM/YYYY
//   IOCL SAP Account Statement (template 2): header row 1; B text, D reference, E posting date (DD.MM.YY), I debit, J credit, K balance
// Usage: node samples.js   (record.js also calls it)
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DIR = path.join(__dirname, 'out', 'samples');

// Date n days ago in IST.
const ago = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 864e5);
const pad = (x) => String(x).padStart(2, '0');
const ddmmyyyy = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const ddmmyy = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${String(d.getUTCFullYear()).slice(2)}`;
const money = (v) => (v ? v.toFixed(2) : '');

// [days ago, ref, description, debit, credit] — the ledger each line should get is in the comment.
const IOB_LINES = [
  [6, '611200045871', 'NEFT-UTIB-AXISCN1512004587-PINE LABS -DEMO FUELS', 0, 18214.50], // CARD SWIPE
  [6, '611200098214', 'UPI SETTLEMENT/QR/DEMO FUELS/03112026', 0, 24560.00], // UPI QR
  [5, '000000318820', 'BY CASH DEPOSIT - ERODE MAIN', 0, 215000.00], // CASH
  [5, '630918842211', 'IMPS/630918842211/SRI LAK/KVBL/XXXXXX4410/Fuel bill Oct', 0, 45000.00], // SRI LAKSHMI TRANSPORTS
  [4, 'IOBAR52026110400871', 'RTGS-IOCL-INDIANOIL CORPORATION LTD-SAP 001234', 850000.00, 0], // IOCL-SOA (SAP)
  [3, '611500077120', 'NEFT-CNRB0001122-KAVERI ROADWAYS-OCT BILLS', 0, 32500.00], // KAVERI ROADWAYS
  [2, '000000412377', 'TNEB/EB BILL/CONS 0412377/ERODE', 12480.00, 0], // ELECTRICITY EXPENSES
  [2, 'SMSCHG1026', 'SMS ALERT CHARGES OCT 2026', 17.70, 0], // BANK CHARGES
];

const SAP_LINES = [
  [6, '7012500141', "7012500141 ': PRODUCT SUPPLY INVOICE - SALES", 848620.00, 0], // PURCHASE INVOICE
  [4, 'CIB2126001234', 'CIB2126001234 IOBA0001234_123402000001234', 0, 850000.00], // IOB (IOB CA 1234)
  [4, '4000700123-0000041', '4000700123-0000041 FLEET CARD SETTLEMENT', 0, 6420.50], // FLEET CARD
  [3, '7012500388', "7012500388 ': LICENSE FEE (SSLF) RECOVERY", 18250.00, 0], // IOCL LICENSE FEE RECOVERY
  [2, '7012500519', "7012500519 ': PRODUCT SUPPLY INVOICE - SALES", 912340.00, 0], // PURCHASE INVOICE
];

function iob() {
  let bal = 152340.25;
  const rows = [['S.No', 'Txn Date', 'Value Date', 'Cheque/Ref No', 'Description', 'Branch', 'Debit', 'Credit', 'Balance']];
  IOB_LINES.forEach(([n, ref, desc, dr, cr], i) => {
    bal += cr - dr;
    rows.push([String(i + 1), ddmmyyyy(ago(n)), ddmmyyyy(ago(n)), ref, desc, 'ERODE MAIN', money(dr), money(cr), bal.toFixed(2)]);
  });
  return rows;
}

function sap() {
  let bal = -12500.00;
  const rows = [['Doc Type', 'Text', 'Document No', 'Reference', 'Posting Date', 'Document Date', 'Due Date', 'Assignment', 'Debit', 'Credit', 'Balance']];
  SAP_LINES.forEach(([n, ref, text, dr, cr]) => {
    bal += dr - cr;
    const d = ddmmyy(ago(n));
    rows.push([dr ? 'RV' : 'DZ', text, ref, ref, d, d, d, '001234', money(dr), money(cr), bal.toFixed(2)]);
  });
  return rows;
}

function write(name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows); // every cell is text, as the bank exports read back
  ws['!cols'] = rows[0].map((h, i) => ({ wch: Math.max(...rows.map((r) => String(r[i]).length)) + 2 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  const file = path.join(DIR, name);
  XLSX.writeFile(wb, file);
  return file;
}

function makeSamples() {
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = ddmmyyyy(ago(1)).replace(/\//g, '-');
  return {
    iob: write(`IOB_Statement_${stamp}.xlsx`, iob()),
    sap: write(`IOCL_SAP_Statement_${stamp}.xlsx`, sap()),
  };
}

module.exports = { makeSamples };
if (require.main === module) console.log(makeSamples());
