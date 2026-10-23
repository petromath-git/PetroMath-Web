// Credit bill import for the shift closing Credit Sales tab.
//
// Reads a billing-system Excel export (one row per bill line; a bill with more
// than one product continues on rows with a blank bill number) and turns it into
// t_credits lines for a draft closing. Party and product names in the file rarely
// match PetroMath exactly, so each name is mapped once and remembered in
// t_credit_import_map. The whole file is rejected if any bill date is outside the
// closing window or any rate differs from the shift rate; bill numbers already in
// the location are skipped.
const XLSX = require('xlsx');
const db = require('../db/db-connection');
const lookupDao = require('../dao/lookup-dao');
const { normalize: normalizeVehicle } = require('../utils/vehicle-number-matcher');

const Q = db.Sequelize.QueryTypes;
const RATE_TOLERANCE = 0.005;
const AUTO_SUGGEST_SCORE = 0.85;

const COLUMNS = {
    billNo: ['BNO', 'BILLNO', 'BILL'],
    date: ['DATE', 'BILLDATE'],
    type: ['TYPE'],
    vehicle: ['VEHICLE', 'VEHICLENO', 'VEHICLENUMBER'],
    party: ['PARTY', 'CUSTOMER', 'PARTYNAME'],
    indent: ['INDENT', 'INDENTNO'],
    item: ['ITEM', 'PRODUCT'],
    qty: ['QTY', 'QUANTITY'],
    rate: ['RATE', 'PRICE'],
    amount: ['AMOUNT', 'AMT', 'VALUE']
};
const REQUIRED_COLUMNS = ['billNo', 'date', 'party', 'item', 'qty', 'rate', 'amount'];

// ---------- name helpers ----------

// Key stored in t_credit_import_map: the file's name, upper-cased and single-spaced.
function sourceKey(name) {
    return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Spelling-insensitive form used for "same name" checks: punctuation/spaces dropped,
// & read as AND, a zero between letters read as O (LAB0RAT0RY).
function compact(name) {
    return sourceKey(name)
        .replace(/&/g, 'AND')
        .replace(/([A-Z])0(?=[A-Z0])/g, '$1O')
        .replace(/([A-Z])0(?=[A-Z])/g, '$1O')
        .replace(/[^A-Z0-9]/g, '');
}

const NOISE_WORDS = new Set(['THE', 'P', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'CO', 'AND']);
function scoringForm(name) {
    return sourceKey(name)
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w && !NOISE_WORDS.has(w))
        .join('');
}

function bigrams(s) {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
}

// Dice coefficient on character pairs, 0..1
function similarity(a, b) {
    const x = scoringForm(a), y = scoringForm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const bx = bigrams(x), by = bigrams(y);
    let common = 0;
    bx.forEach((n, g) => { common += Math.min(n, by.get(g) || 0); });
    return (2 * common) / (Math.max(x.length - 1, 0) + Math.max(y.length - 1, 0) || 1);
}

function topMatches(name, candidates, limit) {
    return candidates
        .map(c => ({ id: c.id, name: c.name, score: Math.round(similarity(name, c.name) * 100) / 100 }))
        .filter(c => c.score >= 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// ---------- file parsing ----------

function headerKey(cell) {
    return String(cell || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, '').trim());
    return isNaN(n) ? null : n;
}

function toIsoDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v);
        return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
    }
    const m = String(v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) return null;
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const check = new Date(iso + 'T00:00:00Z');
    return isNaN(check) || check.toISOString().slice(0, 10) !== iso ? null : iso;
}

// The bill-number box on the credit tab is numeric, so "CR/13886" is kept as 13886.
function toBillNo(v) {
    const digits = String(v || '').replace(/[^0-9]/g, '');
    return digits ? String(parseInt(digits, 10)) : null;
}

// Indent numbers like "0.00" mean none was given.
function toIndent(v) {
    const s = String(v || '').trim();
    return /^[0.]*$/.test(s) ? null : s.slice(0, 100);
}

function parseWorkbook(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    let headerIdx = -1, cols = {};
    for (let i = 0; i < Math.min(rows.length, 20) && headerIdx < 0; i++) {
        const keys = rows[i].map(headerKey);
        const found = {};
        Object.entries(COLUMNS).forEach(([field, names]) => {
            const idx = keys.findIndex(k => names.includes(k));
            if (idx >= 0) found[field] = idx;
        });
        if (REQUIRED_COLUMNS.every(f => found[f] !== undefined)) {
            headerIdx = i;
            cols = found;
        }
    }
    if (headerIdx < 0) {
        return { error: 'Could not find the header row. Expected columns: B.No, Date, Party, Item, Qty, Rate, Amount (Vehicle, Indent, Type optional).' };
    }

    const get = (row, field) => cols[field] === undefined ? '' : row[cols[field]];
    const bills = [];
    const problems = [];
    let skippedOtherTypes = 0;
    let current = null;

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNo = i + 1;
        const rawBill = String(get(row, 'billNo')).trim();
        const item = String(get(row, 'item')).trim();
        if (!rawBill && !item) continue;

        if (rawBill) {
            const type = String(get(row, 'type')).trim().toUpperCase();
            if (type && type !== 'CREDIT') {
                skippedOtherTypes++;
                current = null;
                continue;
            }
            const dateRaw = get(row, 'date');
            current = {
                rowNo,
                rawBillNo: rawBill,
                billNo: toBillNo(rawBill),
                date: toIsoDate(dateRaw),
                dateText: String(dateRaw),
                party: sourceKey(get(row, 'party')),
                vehicle: String(get(row, 'vehicle')).trim(),
                indent: toIndent(get(row, 'indent')),
                lines: []
            };
            if (!current.billNo) problems.push(`Row ${rowNo}: bill number "${rawBill}" has no digits.`);
            if (!current.date) problems.push(`Row ${rowNo} (${rawBill}): date "${current.dateText}" is not a valid DD/MM/YYYY date.`);
            if (!current.party) problems.push(`Row ${rowNo} (${rawBill}): party is blank.`);
            bills.push(current);
        } else if (!current) {
            // continuation of a skipped (non-credit) bill
            continue;
        }

        const line = {
            rowNo,
            item: sourceKey(item),
            qty: toNumber(get(row, 'qty')),
            rate: toNumber(get(row, 'rate')),
            amount: toNumber(get(row, 'amount'))
        };
        if (!line.item || !(line.qty > 0) || !(line.rate > 0) || !(line.amount > 0)) {
            problems.push(`Row ${rowNo} (${current.rawBillNo}): item, qty, rate and amount must all be filled in.`);
        }
        current.lines.push(line);
    }

    if (bills.length === 0 && problems.length === 0) {
        return { error: 'No credit bills found in the file.' };
    }
    return { bills, problems, skippedOtherTypes };
}

// ---------- data access ----------

async function getClosing(closingId, locationCode) {
    const rows = await db.sequelize.query(
        `SELECT closing_id, DATE_FORMAT(closing_date, '%Y-%m-%d') AS closing_date, closing_status
           FROM t_closing WHERE closing_id = :closingId AND location_code = :locationCode`,
        { replacements: { closingId, locationCode }, type: Q.SELECT });
    return rows[0] || null;
}

async function getParties(locationCode) {
    return db.sequelize.query(
        `SELECT creditlist_id AS id, Company_Name AS name
           FROM m_credit_list
          WHERE location_code = :locationCode
            AND (card_flag IS NULL OR card_flag <> 'Y')
            AND (effective_end_date IS NULL OR effective_end_date > NOW())`,
        { replacements: { locationCode }, type: Q.SELECT });
}

async function getProducts(locationCode, productIds) {
    if (!productIds.length) return [];
    return db.sequelize.query(
        `SELECT product_id AS id, product_name AS name, price
           FROM m_product WHERE location_code = :locationCode AND product_id IN (:productIds)`,
        { replacements: { locationCode, productIds }, type: Q.SELECT });
}

async function getMappings(locationCode) {
    const rows = await db.sequelize.query(
        `SELECT map_type, source_name, target_id FROM t_credit_import_map WHERE location_code = :locationCode`,
        { replacements: { locationCode }, type: Q.SELECT });
    const out = { PARTY: new Map(), PRODUCT: new Map() };
    rows.forEach(r => out[r.map_type] && out[r.map_type].set(r.source_name, r.target_id));
    return out;
}

async function saveMapping(locationCode, mapType, sourceName, targetId, userName, transaction) {
    await db.sequelize.query(
        `INSERT INTO t_credit_import_map (location_code, map_type, source_name, target_id, created_by, updated_by)
         VALUES (:locationCode, :mapType, :sourceName, :targetId, :userName, :userName)
         ON DUPLICATE KEY UPDATE target_id = VALUES(target_id), updated_by = VALUES(updated_by)`,
        { replacements: { locationCode, mapType, sourceName, targetId, userName }, transaction });
}

// Bill numbers already entered in this location around the closing date. Limited to
// a window because billing systems restart their numbering (e.g. each year).
const DUPLICATE_WINDOW_DAYS = 90;
async function getExistingBillNos(locationCode, closingDate, billNos, transaction) {
    if (!billNos.length) return new Map();
    const rows = await db.sequelize.query(
        `SELECT DISTINCT tc.bill_no, DATE_FORMAT(c.closing_date, '%Y-%m-%d') AS closing_date
           FROM t_credits tc JOIN t_closing c ON c.closing_id = tc.closing_id
          WHERE c.location_code = :locationCode AND tc.bill_no IN (:billNos)
            AND c.closing_date BETWEEN DATE_SUB(:closingDate, INTERVAL :days DAY) AND DATE_ADD(:closingDate, INTERVAL :days DAY)`,
        { replacements: { locationCode, closingDate, billNos, days: DUPLICATE_WINDOW_DAYS }, type: Q.SELECT, transaction });
    return new Map(rows.map(r => [String(r.bill_no), r.closing_date]));
}

// ---------- resolution ----------

// For each distinct name in the file: the remembered mapping, else a same-name
// match (spelling-insensitive), else suggestions for the user to choose from.
function resolveNames(names, mapping, candidates, withSuggestions) {
    const byId = new Map(candidates.map(c => [String(c.id), c]));
    const byCompact = new Map();
    candidates.forEach(c => {
        const k = compact(c.name);
        if (!byCompact.has(k)) byCompact.set(k, c);
    });
    return names.map(name => {
        const mappedId = mapping.get(name);
        if (mappedId && byId.has(String(mappedId))) {
            return { source: name, status: 'mapped', id: mappedId, name: byId.get(String(mappedId)).name };
        }
        const same = byCompact.get(compact(name));
        if (same) return { source: name, status: 'matched', id: same.id, name: same.name };
        const suggestions = withSuggestions ? topMatches(name, candidates, 5) : [];
        const best = suggestions[0];
        return {
            source: name,
            status: 'choose',
            id: best && best.score >= AUTO_SUGGEST_SCORE ? best.id : null,
            suggestions
        };
    });
}

function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Same window as the credit tab's bill-date box: closing date -1 .. +1, and never after today.
function dateErrors(bills, closingDate) {
    const today = todayLocal();
    const min = addDays(closingDate, -1);
    const max = addDays(closingDate, 1) < today ? addDays(closingDate, 1) : today;
    return bills
        .filter(b => b.date && (b.date < min || b.date > max))
        .map(b => `${b.rawBillNo}: bill date ${fmt(b.date)} is outside ${fmt(min)} to ${fmt(max)}`
            + (b.date > today ? ' (future date)' : '') + '.');
}

function rateErrors(bills, productIdByItem, rates) {
    const errors = [];
    bills.forEach(b => b.lines.forEach(l => {
        const productId = productIdByItem.get(l.item);
        if (!productId || l.rate === null) return;
        const shiftRate = rates.get(String(productId));
        if (shiftRate === undefined || shiftRate === null) return;
        if (Math.abs(l.rate - shiftRate) > RATE_TOLERANCE) {
            errors.push(`${b.rawBillNo}: ${l.item} rate ${l.rate.toFixed(2)} does not match shift rate ${Number(shiftRate).toFixed(2)}.`);
        }
    }));
    return errors;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function fmt(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}-${MONTHS[parseInt(m, 10) - 1]}-${y}`;
}

// rates: { productId: rate } as shown on the closing page; falls back to m_product.price
function buildRateMap(products, clientRates) {
    const rates = new Map();
    products.forEach(p => {
        const fromPage = clientRates ? parseFloat(clientRates[p.id]) : NaN;
        rates.set(String(p.id), !isNaN(fromPage) && fromPage > 0 ? fromPage : parseFloat(p.price));
    });
    return rates;
}

async function loadContext({ locationCode, closingId, buffer, productIds }) {
    const closing = await getClosing(closingId, locationCode);
    if (!closing) return { error: 'Save the closing first, then import the bills.' };
    if (closing.closing_status !== 'DRAFT') return { error: 'Bills can only be imported into a draft closing.' };

    const parsed = parseWorkbook(buffer);
    if (parsed.error) return { error: parsed.error };

    const ids = (productIds || []).map(n => parseInt(n, 10)).filter(n => n > 0);
    const [parties, products, mappings] = await Promise.all([
        getParties(locationCode), getProducts(locationCode, ids), getMappings(locationCode)
    ]);
    return { closing, parsed, parties, products, mappings };
}

// ---------- public API ----------

async function preview({ locationCode, closingId, buffer, productIds, rates }) {
    const ctx = await loadContext({ locationCode, closingId, buffer, productIds });
    if (ctx.error) return { error: ctx.error };
    const { closing, parsed, parties, products, mappings } = ctx;
    const { bills } = parsed;

    const existing = await getExistingBillNos(locationCode, closing.closing_date, bills.map(b => b.billNo).filter(Boolean));
    const toImport = bills.filter(b => !existing.has(b.billNo));

    // Only names on bills that will actually be imported need a match
    const partyNames = [...new Set(toImport.map(b => b.party).filter(Boolean))].sort();
    const itemNames = [...new Set(toImport.flatMap(b => b.lines.map(l => l.item)).filter(Boolean))].sort();

    const partyRes = resolveNames(partyNames, mappings.PARTY, parties, true);
    const productRes = resolveNames(itemNames, mappings.PRODUCT, products, true);

    const productIdByItem = new Map(productRes.filter(p => p.id).map(p => [p.source, p.id]));

    const billCount = new Map();
    toImport.forEach(b => billCount.set(b.party, (billCount.get(b.party) || 0) + 1));
    partyRes.forEach(p => { p.bills = billCount.get(p.source) || 0; });

    return {
        closingDate: closing.closing_date,
        billCount: toImport.length,
        lineCount: toImport.reduce((n, b) => n + b.lines.length, 0),
        totalAmount: toImport.reduce((n, b) => n + b.lines.reduce((m, l) => m + (l.amount || 0), 0), 0),
        skippedOtherTypes: parsed.skippedOtherTypes,
        problems: parsed.problems,
        dateErrors: dateErrors(toImport, closing.closing_date),
        rateErrors: rateErrors(toImport, productIdByItem, buildRateMap(products, rates)),
        duplicates: bills.filter(b => existing.has(b.billNo))
            .map(b => ({ billNo: b.rawBillNo, closingDate: fmt(existing.get(b.billNo)) })),
        parties: partyRes,
        products: productRes,
        partyOptions: parties.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
        productOptions: products.map(p => ({ id: p.id, name: p.name }))
    };
}

// partyChoices: { sourceName: creditlist_id | 'NEW' }, productChoices: { sourceName: product_id }
async function runImport({ locationCode, closingId, buffer, productIds, rates, partyChoices, productChoices, user }) {
    const ctx = await loadContext({ locationCode, closingId, buffer, productIds });
    if (ctx.error) return { error: ctx.error };
    const { closing, parsed, parties, products, mappings } = ctx;
    const { bills } = parsed;
    const userName = user.User_Name;

    if (parsed.problems.length) return { error: 'Fix these rows in the file first.', details: parsed.problems };

    const partyIds = new Set(parties.map(p => String(p.id)));
    const productIdSet = new Set(products.map(p => String(p.id)));

    // Bills already in PetroMath are skipped, so their names need no match and their
    // dates/rates are not checked (re-checked inside the transaction before saving).
    const existingBefore = await getExistingBillNos(locationCode, closing.closing_date, bills.map(b => b.billNo));
    const candidates = bills.filter(b => !existingBefore.has(b.billNo));
    if (!candidates.length) {
        return { imported: 0, lines: 0, skipped: bills.map(b => b.rawBillNo), createdParties: [], createdVehicles: [] };
    }

    // Final party/product for each name: remembered/same-name first, else the user's choice.
    const partyNames = [...new Set(candidates.map(b => b.party))];
    const itemNames = [...new Set(candidates.flatMap(b => b.lines.map(l => l.item)))];
    const partyRes = resolveNames(partyNames, mappings.PARTY, parties, false);
    const productRes = resolveNames(itemNames, mappings.PRODUCT, products, false);

    const missing = [];
    const partyTarget = new Map();   // source -> id | 'NEW'
    partyRes.forEach(p => {
        if (p.status !== 'choose') return partyTarget.set(p.source, p.id);
        const choice = partyChoices && partyChoices[p.source];
        if (choice === 'NEW' || partyIds.has(String(choice))) partyTarget.set(p.source, choice === 'NEW' ? 'NEW' : parseInt(choice, 10));
        else missing.push(`Customer for "${p.source}"`);
    });
    const productIdByItem = new Map();
    productRes.forEach(p => {
        if (p.status !== 'choose') return productIdByItem.set(p.source, p.id);
        const choice = productChoices && productChoices[p.source];
        if (productIdSet.has(String(choice))) productIdByItem.set(p.source, parseInt(choice, 10));
        else missing.push(`Product for "${p.source}"`);
    });
    if (missing.length) return { error: 'Choose a match for every name.', details: missing };

    // Remember the confirmed choices even if the file is rejected below, so a corrected
    // file does not ask again. New customers are only created by a successful import.
    for (const p of partyRes) {
        const target = partyTarget.get(p.source);
        if (p.status !== 'mapped' && target !== 'NEW') await saveMapping(locationCode, 'PARTY', p.source, target, userName);
    }
    for (const p of productRes) {
        if (p.status !== 'mapped') await saveMapping(locationCode, 'PRODUCT', p.source, productIdByItem.get(p.source), userName);
    }

    const rejects = [
        ...dateErrors(candidates, closing.closing_date),
        ...rateErrors(candidates, productIdByItem, buildRateMap(products, rates))
    ];
    if (rejects.length) return { error: 'File rejected - nothing was imported.', details: rejects };

    const defaultType = await lookupDao.getDefaultCustomerType(locationCode);

    return db.sequelize.transaction(async (transaction) => {
        const existing = await getExistingBillNos(locationCode, closing.closing_date, candidates.map(b => b.billNo), transaction);
        existingBefore.forEach((date, billNo) => existing.set(billNo, date));
        const toImport = candidates.filter(b => !existing.has(b.billNo));

        // New customers, only for names that still have bills to import
        const createdParties = [];
        for (const [source, target] of partyTarget) {
            if (target !== 'NEW' || !toImport.some(b => b.party === source)) continue;
            const [creditlistId] = await db.sequelize.query(
                `INSERT INTO m_credit_list (location_code, Company_Name, type, Opening_Balance, created_by, updated_by,
                        creation_date, updation_date, effective_start_date, effective_end_date)
                 VALUES (:locationCode, :name, :type, 0, :personId, :personId, NOW(), NOW(), CURDATE(), '2400-01-01')`,
                { replacements: { locationCode, name: source, type: defaultType, personId: String(user.Person_id) },
                  type: Q.INSERT, transaction });
            partyTarget.set(source, creditlistId);
            await saveMapping(locationCode, 'PARTY', source, creditlistId, userName, transaction);
            createdParties.push(source);
        }

        // Vehicles: match on the normalised number under the bill's customer, create if missing
        const vehicleCache = new Map();
        const createdVehicles = [];
        async function vehicleIdFor(creditlistId, vehicleText, productId) {
            const number = normalizeVehicle(vehicleText);
            if (!number) return null;
            const key = creditlistId + '|' + number;
            if (vehicleCache.has(key)) return vehicleCache.get(key);
            const active = await db.sequelize.query(
                `SELECT vehicle_id, vehicle_number FROM m_creditlist_vehicles
                  WHERE creditlist_id = :creditlistId
                    AND (effective_end_date IS NULL OR effective_end_date >= NOW())`,
                { replacements: { creditlistId }, type: Q.SELECT, transaction });
            const found = active.find(v => normalizeVehicle(v.vehicle_number) === number);
            let id = found ? found.vehicle_id : null;
            if (!id) {
                [id] = await db.sequelize.query(
                    `INSERT INTO m_creditlist_vehicles (creditlist_id, vehicle_number, product_id, notes, created_by, updated_by,
                            creation_date, updation_date, effective_start_date)
                     VALUES (:creditlistId, :number, :productId, 'Created by credit bill import', :userName, :userName, NOW(), NOW(), NOW())`,
                    { replacements: { creditlistId, number, productId, userName }, type: Q.INSERT, transaction });
                createdVehicles.push(number);
            }
            vehicleCache.set(key, id);
            return id;
        }

        let lineCount = 0;
        for (const bill of toImport) {
            const creditlistId = partyTarget.get(bill.party);
            const firstProduct = productIdByItem.get(bill.lines[0].item);
            const vehicleId = await vehicleIdFor(creditlistId, bill.vehicle, firstProduct);
            for (const line of bill.lines) {
                await db.sequelize.query(
                    `INSERT INTO t_credits (closing_id, bill_no, creditlist_id, vehicle_id, product_id, price, price_discount,
                            qty, amount, notes, indent_number, credit_bill_date, created_by, updated_by, creation_date, updation_date)
                     VALUES (:closingId, :billNo, :creditlistId, :vehicleId, :productId, :rate, 0,
                            :qty, :amount, :notes, :indent, :billDate, :userName, :userName, NOW(), NOW())`,
                    { replacements: {
                        closingId: closing.closing_id, billNo: bill.billNo, creditlistId, vehicleId,
                        productId: productIdByItem.get(line.item), rate: line.rate, qty: line.qty, amount: line.amount,
                        notes: 'Imported ' + bill.rawBillNo, indent: bill.indent, billDate: bill.date, userName
                    }, type: Q.INSERT, transaction });
                lineCount++;
            }
        }

        return {
            imported: toImport.length,
            lines: lineCount,
            skipped: bills.filter(b => existing.has(b.billNo)).map(b => b.rawBillNo),
            createdParties,
            createdVehicles
        };
    });
}

module.exports = { preview, runImport, parseWorkbook, similarity, compact };
