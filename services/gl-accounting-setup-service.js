// services/gl-accounting-setup-service.js
// Everything a location needs before Create Accounting can post: financial
// years, the ledgers the engine looks up by name, a ledger per master row,
// sales/purchase/GST ledgers driven by the products actually sold there, the
// product ledger map, and sensible defaults on the static ledger map.
//
// Used in two places: onboarding migrate (automatic) and /gl/accounting-setup
// (preview + apply, for locations onboarded before this existed). Both go
// through buildPlan, so what the preview shows is what apply writes.
//
// Only ever fills gaps. Existing ledgers, existing product mappings and
// reviewed static labels are never changed, because a location's names may
// deliberately match its Tally books (SFS posts MS and HSD to one ledger).

const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');
const stockValuationService = require('./stock-valuation-service');

const SYSTEM_LEDGERS = [
    { name: 'Unclassified Bank Transaction', group: 'Suspense A/c',      why: 'Fallback for unreviewed bank labels' },
    { name: 'Unclassified Cashflow',         group: 'Suspense A/c',      why: 'Fallback for unreviewed cashflow labels' },
    { name: 'General Adjustment',            group: 'Suspense A/c',      why: 'Adjustments with no specific ledger' },
    { name: 'Opening Balance Equity',        group: 'Capital Account',   why: 'Customer and bank opening balances' },
    { name: 'Digital Vendor Charges',        group: 'Indirect Expenses', why: 'Digital vendor adjustments' },
    { name: 'POS Rental Charges',            group: 'Indirect Expenses', why: 'POS rental adjustments' },
];

const NEW_PRODUCT_DAYS = 7;

const GST_LEDGERS = {
    OUTPUT_CGST: 'OUTPUT CGST',
    OUTPUT_SGST: 'OUTPUT SGST',
    INPUT_CGST:  'INPUT CGST',
    INPUT_SGST:  'INPUT SGST',
    INPUT_IGST:  'INPUT IGST',
};

// Labels that post nothing, on every location already reviewed.
const STATIC_SKIP_DEFAULTS = {
    '2t oil':            'Shift rollup, day bill posts the sale',
    'balance b/f':       'Running balance, not a transaction',
    'cashier a/c (+)':   'Shift rollup',
    'cashier a/c (-)':   'Shift rollup',
    'collection':        'Shift rollup, sales post from the shift',
    'shift opening':     'Shift float moves within cash',
    'shift cash return': 'Shift float moves within cash',
    'cash receipt':      'Posted from receipts (CREDIT_RECEIPT)',
    'purchase invoice':  'Tank or lube invoice books the purchase',
};
const TO_BANK_LABEL = /^to bank\b/i;
const TO_BANK_SKIP_REASON = 'Bank statement books the deposit';

// Labels whose ledger has a different name. Same-named ledgers map themselves.
const STATIC_POST_DEFAULTS = {
    'discount':                'DISCOUNT',
    'expense':                 'OTHERS',
    'salary payout':           'SALARY EXPENSES',
    'salary recovery':         'SALARY EXPENSES',
    'salary advance':          'SALARY EXPENSES',
    'salary advance recovery': 'SALARY EXPENSES',
};

// Which sales/purchase ledger a product belongs to. A premium or green fuel
// only gets its own ledgers because a product like it exists at the location.
function classifyProduct(p) {
    const name = String(p.product_name || '').trim().toUpperCase();
    const isTank = Number(p.is_tank_product) === 1;
    const isLube = Number(p.is_lube_product) === 1;

    if (/^(XP ?95|XMS)\b|XTRA ?PREMIUM/.test(name)) return { key: 'XP95',   sales: 'XTRA PREMIUM PETROL SALES', purchase: 'XP95 PURCHASE' };
    if (/^(XG|GD)\b|XTRA ?GREEN/.test(name))        return { key: 'XG',     sales: 'XTRA GREEN DIESEL SALES',   purchase: 'XTRA GREEN DIESEL PURCHASE' };
    if (/^(MS|PETROL)\b/.test(name))                return { key: 'PETROL', sales: 'PETROL SALES',              purchase: 'PETROL PURCHASE' };
    if (/^(HSD|DIESEL)\b/.test(name))               return { key: 'DIESEL', sales: 'DIESEL SALES',              purchase: 'DIESEL PURCHASE' };
    if (isTank && !isLube)                          return { key: name,     sales: `${name} SALES`,             purchase: `${name} PURCHASE` };
    if (/ACID|WATER/.test(name))                    return { key: 'ACID',   sales: 'ACID AND DWATER SALES',     purchase: 'ACID-DWATER PURCHASE' };
    return { key: 'LUBE', sales: 'LUBE SALES', purchase: 'LUBE PURCHASE' };
}

function requiredMapTypes(p) {
    const purchased = Number(p.is_tank_product) === 1 || Number(p.is_lube_product) === 1;
    const taxed = Number(p.cgst_percent) > 0 || Number(p.sgst_percent) > 0;
    const types = ['SALES'];
    if (purchased) types.push('PURCHASE');
    if (Number(p.cgst_percent) > 0) types.push('OUTPUT_CGST');
    if (Number(p.sgst_percent) > 0) types.push('OUTPUT_SGST');
    if (purchased && Number(p.cgst_percent) > 0) types.push('INPUT_CGST');
    if (purchased && Number(p.sgst_percent) > 0) types.push('INPUT_SGST');
    if (purchased && taxed) types.push('INPUT_IGST');
    return types;
}

function ledgerGroupFor(mapType) {
    if (mapType === 'SALES') return 'Sales Accounts';
    if (mapType === 'PURCHASE') return 'Purchase Accounts';
    return 'Duties & Taxes';
}

function indianFyStartYear(dateStr) {
    const year = Number(dateStr.substring(0, 4));
    const month = Number(dateStr.substring(5, 7));
    return month >= 4 ? year : year - 1;
}

function todayIst() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().substring(0, 10);
}

async function select(sql, replacements, transaction) {
    return db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
}

async function buildPlan(locationCode, options = {}) {
    const t = options.transaction;
    const r = { locationCode };

    const [groups, ledgers, fys, firstClosing, products, maps, heads, staticRows, suppliers, banks, credits, vouchers] = await Promise.all([
        select(`SELECT group_name FROM gl_ledger_groups WHERE location_code = :locationCode`, r, t),
        select(`SELECT l.ledger_id, l.ledger_name, l.source_type, l.source_id, g.group_name
                FROM gl_ledgers l JOIN gl_ledger_groups g ON g.group_id = l.group_id
                WHERE l.location_code = :locationCode`, r, t),
        select(`SELECT fy_name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date, is_current
                FROM gl_financial_years WHERE location_code = :locationCode`, r, t),
        select(`SELECT DATE_FORMAT(MIN(closing_date), '%Y-%m-%d') AS d FROM t_closing WHERE location_code = :locationCode`, r, t),
        select(`SELECT product_id, product_name, is_tank_product, is_lube_product, cgst_percent, sgst_percent
                FROM m_product WHERE location_code = :locationCode ORDER BY product_name`, r, t),
        select(`SELECT m.product_id, m.map_type, m.ledger_id, l.ledger_name
                FROM gl_product_ledger_map m JOIN gl_ledgers l ON l.ledger_id = m.ledger_id
                WHERE m.location_code = :locationCode`, r, t),
        select(`SELECT account_head_name, account_head_type FROM m_account_heads WHERE location_code = :locationCode AND active_flag = 'Y'`, r, t),
        select(`SELECT map_id, ledger_name, treatment FROM gl_static_ledger_map WHERE location_code = :locationCode`, r, t),
        select(`SELECT supplier_id AS id, supplier_name AS name FROM m_supplier WHERE location_code = :locationCode`, r, t),
        select(`SELECT bank_id AS id, bank_name AS name FROM m_bank WHERE location_code = :locationCode AND is_oil_company <> 'Y'`, r, t),
        select(`SELECT creditlist_id AS id, Company_Name AS name FROM m_credit_list WHERE location_code = :locationCode`, r, t),
        select(`SELECT EXISTS(SELECT 1 FROM gl_journal_headers WHERE location_code = :locationCode) AS has_vouchers`, r, t),
    ]);

    const plan = {
        locationCode,
        hasGroups: groups.length > 0,
        fyToCreate: [],
        ledgersToCreate: [],
        productMaps: [],
        staticRowsToAdd: [],
        staticSkip: [],
        staticPost: [],
        staticManual: [],
        needsReview: [],
    };

    // The current financial year. A location with none yet also gets last year
    // if it has closings there; anything older is a deliberate choice for the
    // Financial Years page, since it opens years of history up to accounting.
    const today = todayIst();
    const lastYear = indianFyStartYear(today);
    const firstClosingYear = firstClosing[0]?.d ? indianFyStartYear(firstClosing[0].d) : lastYear;
    const firstYear = fys.length ? lastYear : Math.max(firstClosingYear, lastYear - 1);
    const hasCurrent = fys.some(f => f.is_current === 'Y');
    for (let y = firstYear; y <= lastYear; y++) {
        const start = `${y}-04-01`;
        const end = `${y + 1}-03-31`;
        if (fys.some(f => f.start_date <= end && f.end_date >= start)) continue;
        plan.fyToCreate.push({ fy_name: `${y}-${y + 1}`, start_date: start, end_date: end, is_current: (!hasCurrent && y === lastYear) ? 'Y' : 'N' });
    }

    // Names are unique per location, case-insensitively
    const ledgerNames = new Set(ledgers.map(l => l.ledger_name.toLowerCase()));
    const groupNames = new Set(groups.map(g => g.group_name));
    const addLedger = (name, group, why, sourceType = 'STATIC', sourceId = null) => {
        if (ledgerNames.has(name.toLowerCase())) return false;
        if (!groupNames.has(group)) {
            plan.needsReview.push(`Ledger group "${group}" is missing, so "${name}" cannot be created`);
            return false;
        }
        ledgerNames.add(name.toLowerCase());
        plan.ledgersToCreate.push({ ledger_name: name, group_name: group, source_type: sourceType, source_id: sourceId, why });
        return true;
    };

    if (!ledgers.some(l => l.group_name === 'Cash-in-Hand')) addLedger('CASH', 'Cash-in-Hand', 'Cash book');
    SYSTEM_LEDGERS.forEach(l => addLedger(l.name, l.group, l.why));

    // Useful, but a location already posting has made its own choice for these.
    const postingAlready = Number(vouchers[0].has_vouchers) === 1;
    const hasTdsLedger = ledgers.some(l => /tds/i.test(l.ledger_name));
    if (!(postingAlready && hasTdsLedger)) addLedger('TDS Payable', 'Duties & Taxes', 'TDS');
    const hasCapitalLedger = ledgers.some(l => l.group_name === 'Capital Account' && l.ledger_name !== 'Opening Balance Equity');
    if (!hasCapitalLedger) addLedger('DRAWINGS', 'Capital Account', 'Owner withdrawals');

    // A ledger per supplier, bank and customer. The DB triggers only create one
    // if the groups already exist, and they stay silent when the name is taken.
    const linked = new Set(ledgers.map(l => `${l.source_type}:${l.source_id}`));
    const addMasterLedgers = (rows, sourceType, group, why) => {
        rows.forEach(row => {
            if (linked.has(`${sourceType}:${row.id}`)) return;
            if (ledgerNames.has(String(row.name).toLowerCase())) {
                plan.needsReview.push(`${why} "${row.name}" has no ledger, and another ledger already uses that name`);
                return;
            }
            addLedger(row.name, group, why, sourceType, row.id);
        });
    };
    addMasterLedgers(suppliers, 'SUPPLIER', 'Sundry Creditors', 'Supplier');
    addMasterLedgers(banks, 'BANK', 'Bank Accounts', 'Bank account');
    addMasterLedgers(credits, 'CREDIT', 'Sundry Debtors', 'Customer');

    // Product map. Reuse what the location already uses for the same kind of
    // product before creating anything, so Tally-matched names are respected.
    const mapped = new Set(maps.map(m => `${m.product_id}:${m.map_type}`));
    const reuse = new Map();
    const productById = new Map(products.map(p => [p.product_id, p]));
    maps.forEach(m => {
        const p = productById.get(m.product_id);
        if (!p) return;
        const key = (m.map_type === 'SALES' || m.map_type === 'PURCHASE')
            ? `${classifyProduct(p).key}:${m.map_type}`
            : m.map_type;
        if (!reuse.has(key)) reuse.set(key, m.ledger_name);
    });
    products.forEach(p => {
        const cls = classifyProduct(p);
        requiredMapTypes(p).forEach(mapType => {
            if (mapped.has(`${p.product_id}:${mapType}`)) return;
            const isTrading = mapType === 'SALES' || mapType === 'PURCHASE';
            const defaultName = mapType === 'SALES' ? cls.sales : (mapType === 'PURCHASE' ? cls.purchase : GST_LEDGERS[mapType]);
            const ledgerName = reuse.get(isTrading ? `${cls.key}:${mapType}` : mapType) || defaultName;
            addLedger(ledgerName, ledgerGroupFor(mapType), `${mapType.replace('_', ' ')} for ${p.product_name}`);
            plan.productMaps.push({ product_id: p.product_id, product_name: p.product_name, map_type: mapType, ledger_name: ledgerName });
        });
    });

    // Static ledger map: every active head gets a row, then defaults on
    // anything unreviewed. What is left needs a person.
    const staticByLabel = new Map(staticRows.map(s => [s.ledger_name.toLowerCase(), s]));
    heads.forEach(h => {
        const key = h.account_head_name.toLowerCase();
        if (staticByLabel.has(key)) return;
        staticByLabel.set(key, { map_id: null, ledger_name: h.account_head_name, treatment: null });
        plan.staticRowsToAdd.push(h.account_head_name);
    });
    // An unreviewed expense head with no ledger gets its own, so it can post
    // under its own name. DISCOUNT is only created for a label that will use it.
    const expenseHeads = new Set(heads.filter(h => h.account_head_type === 'EXPENSE').map(h => h.account_head_name.toLowerCase()));
    [...staticByLabel.values()].filter(s => !s.treatment).forEach(s => {
        const key = s.ledger_name.toLowerCase();
        if (key === 'discount') addLedger('DISCOUNT', 'Indirect Expenses', 'Cashflow discounts');
        else if (key === 'gst payment') addLedger(s.ledger_name, 'Duties & Taxes', 'GST paid');
        else if (expenseHeads.has(key)) addLedger(s.ledger_name, 'Indirect Expenses', 'Expense account head');
    });

    const staticLedgers = new Set(ledgers.filter(l => l.source_type === 'STATIC').map(l => l.ledger_name.toLowerCase()));
    plan.ledgersToCreate.filter(l => l.source_type === 'STATIC').forEach(l => staticLedgers.add(l.ledger_name.toLowerCase()));
    [...staticByLabel.values()]
        .filter(s => !s.treatment)
        .sort((a, b) => a.ledger_name.localeCompare(b.ledger_name))
        .forEach(s => {
            const key = s.ledger_name.toLowerCase();
            const skipReason = STATIC_SKIP_DEFAULTS[key] || (TO_BANK_LABEL.test(s.ledger_name) ? TO_BANK_SKIP_REASON : null);
            if (skipReason) {
                plan.staticSkip.push({ ledger_name: s.ledger_name, skip_reason: skipReason });
                return;
            }
            const target = STATIC_POST_DEFAULTS[key] || (staticLedgers.has(key) ? s.ledger_name : null);
            if (target && staticLedgers.has(target.toLowerCase())) {
                plan.staticPost.push({ ledger_name: s.ledger_name, target });
                return;
            }
            plan.staticManual.push(s.ledger_name);
        });

    plan.todo = plan.fyToCreate.length + plan.ledgersToCreate.length + plan.productMaps.length
        + plan.staticRowsToAdd.length + plan.staticSkip.length + plan.staticPost.length;
    return plan;
}

async function insertLedgers(locationCode, user, ledgers, transaction) {
    for (const l of ledgers) {
        await db.sequelize.query(`
            INSERT INTO gl_ledgers (location_code, ledger_name, group_id, source_type, source_id, active_flag, created_by, updated_by)
            SELECT :locationCode, :ledger_name, g.group_id, :source_type, :source_id, 'Y', :user, :user
            FROM gl_ledger_groups g
            WHERE g.location_code = :locationCode AND g.group_name = :group_name
            LIMIT 1
        `, { replacements: { locationCode, user, ...l }, type: QueryTypes.INSERT, transaction });
    }
}

async function insertProductMaps(locationCode, user, maps, transaction) {
    for (const m of maps) {
        await db.sequelize.query(`
            INSERT IGNORE INTO gl_product_ledger_map (location_code, product_id, map_type, ledger_id, created_by, updated_by)
            SELECT :locationCode, :product_id, :map_type, l.ledger_id, :user, :user
            FROM gl_ledgers l
            WHERE l.location_code = :locationCode AND l.ledger_name = :ledger_name
        `, { replacements: { locationCode, user, product_id: m.product_id, map_type: m.map_type, ledger_name: m.ledger_name }, type: QueryTypes.INSERT, transaction });
    }
}

// Recomputes the plan inside the transaction, so a stale preview can't write
// anything a concurrent change has made wrong. Safe to run repeatedly.
async function applyPlan(locationCode, user, options = {}) {
    const run = async (transaction) => {
        const plan = await buildPlan(locationCode, { transaction });
        if (!plan.hasGroups) throw new Error(`No ledger groups for ${locationCode}. Create them before setting up accounting.`);

        for (const fy of plan.fyToCreate) {
            await db.sequelize.query(`
                INSERT INTO gl_financial_years (location_code, fy_name, start_date, end_date, is_current, created_by, updated_by)
                VALUES (:locationCode, :fy_name, :start_date, :end_date, :is_current, :user, :user)
            `, { replacements: { locationCode, user, ...fy }, type: QueryTypes.INSERT, transaction });
        }

        await insertLedgers(locationCode, user, plan.ledgersToCreate, transaction);
        await insertProductMaps(locationCode, user, plan.productMaps, transaction);

        for (const label of plan.staticRowsToAdd) {
            await db.sequelize.query(`
                INSERT IGNORE INTO gl_static_ledger_map (location_code, ledger_name, created_by, updated_by)
                VALUES (:locationCode, :label, :user, :user)
            `, { replacements: { locationCode, label, user }, type: QueryTypes.INSERT, transaction });
        }

        for (const s of plan.staticSkip) {
            await db.sequelize.query(`
                UPDATE gl_static_ledger_map
                SET treatment = 'SKIP', gl_ledger_id = NULL, skip_reason = :skip_reason, updated_by = :user
                WHERE location_code = :locationCode AND ledger_name = :ledger_name AND treatment IS NULL
            `, { replacements: { locationCode, user, ...s }, type: QueryTypes.UPDATE, transaction });
        }

        for (const s of plan.staticPost) {
            await db.sequelize.query(`
                UPDATE gl_static_ledger_map m
                JOIN gl_ledgers l ON l.location_code = m.location_code AND l.ledger_name = :target
                SET m.treatment = 'POST', m.gl_ledger_id = l.ledger_id, m.skip_reason = NULL, m.updated_by = :user
                WHERE m.location_code = :locationCode AND m.ledger_name = :ledger_name AND m.treatment IS NULL
            `, { replacements: { locationCode, user, ...s }, type: QueryTypes.UPDATE, transaction });
        }

        return plan;
    };

    return options.transaction ? run(options.transaction) : db.sequelize.transaction(run);
}

// Opening stock for the P&L. Product Master keeps quantity only, and the P&L
// needs quantity and value in gl_stock_opening_balance. Value is suggested at
// the location's own first purchase rate (as the MME and MUE seeds were) and
// stays editable: this is an estimate of what the stock actually cost.
async function buildStockPlan(locationCode) {
    const r = { locationCode };
    const [openings, fys, seeds, products] = await Promise.all([
        select(`SELECT product_id, qty, DATE_FORMAT(adjustment_date, '%Y-%m-%d') AS opening_date
                FROM t_lubes_stock_adjustment
                WHERE location_code = :locationCode AND adjustment_type = 'OPENING'`, r),
        select(`SELECT fy_id, fy_name, is_current, is_closed,
                       DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
                FROM gl_financial_years WHERE location_code = :locationCode ORDER BY start_date`, r),
        select(`SELECT product_id, fy_id, opening_qty, opening_value, source
                FROM gl_stock_opening_balance WHERE location_code = :locationCode`, r),
        select(`SELECT product_id, product_name, is_tank_product FROM m_product
                WHERE location_code = :locationCode ORDER BY is_tank_product DESC, product_name`, r),
    ]);

    const openingByProduct = new Map(openings.map(o => [o.product_id, o]));
    const seedKey = (productId, fyId) => `${productId}:${fyId}`;
    const seedByKey = new Map(seeds.map(s => [seedKey(s.product_id, s.fy_id), s]));
    const currentFy = fys.find(f => f.is_current === 'Y');

    const rows = [];
    for (const p of products) {
        const opening = openingByProduct.get(p.product_id);
        const fy = opening
            ? fys.find(f => opening.opening_date >= f.start_date && opening.opening_date <= f.end_date)
            : currentFy;
        const row = {
            product_id: p.product_id,
            product_name: p.product_name,
            opening_date: opening ? opening.opening_date : null,
            qty: opening ? Number(opening.qty) : 0,
            fy_id: fy ? fy.fy_id : null,
            fy_name: fy ? fy.fy_name : null,
            rate: null,
            value: null,
            seeded_qty: null,
            seeded_value: null,
            status: 'ready',
            message: null,
        };

        const purchases = await stockValuationService.getDailyPurchases(locationCode, p.product_id, '2000-01-01', '2999-12-31');
        const days = purchases
            .map(d => ({ d: stockValuationService.toDateStr(d.d), qty: Number(d.qty), value: Number(d.value) }))
            .filter(d => d.qty > 0)
            .sort((a, b) => a.d.localeCompare(b.d));
        const firstPurchase = (opening && days.find(d => d.d >= opening.opening_date)) || days[0];
        if (firstPurchase) row.rate = firstPurchase.value / firstPurchase.qty;

        if (!fy) {
            if (!opening) continue;
            row.status = 'review';
            row.message = 'No financial year covers the opening date';
        } else if (!opening) {
            // Bought but no opening: a zero row keeps its purchases in COGS when
            // it shares a purchase ledger with products that do have one.
            const boughtThisFy = days.some(d => d.d >= fy.start_date && d.d <= fy.end_date);
            const seed = seedByKey.get(seedKey(p.product_id, fy.fy_id));
            if (!boughtThisFy && !seed) continue;
            if (seed) {
                row.status = 'saved';
                row.seeded_qty = Number(seed.opening_qty);
                row.seeded_value = Number(seed.opening_value);
                row.qty = row.seeded_qty;
                row.value = row.seeded_value;
            } else {
                row.value = 0;
                row.message = 'Purchased, but no opening stock entered. Saved as zero.';
            }
        } else {
            const seed = seedByKey.get(seedKey(p.product_id, fy.fy_id));
            const soldBefore = opening.opening_date > fy.start_date
                ? await stockValuationService.getDailySoldQty(locationCode, p.product_id, fy.start_date, moveDay(opening.opening_date, -1))
                : [];
            const soldBeforeQty = soldBefore.reduce((sum, d) => sum + Number(d.qty || 0), 0);

            if (seed) {
                row.status = 'saved';
                row.seeded_qty = Number(seed.opening_qty);
                row.seeded_value = Number(seed.opening_value);
                row.value = row.seeded_value;
                if (Math.abs(row.seeded_qty - row.qty) > 0.001) {
                    row.status = 'changed';
                    row.message = `Product Master now shows ${row.qty}. Saved quantity is ${row.seeded_qty}.`;
                    row.value = row.rate ? round2(row.qty * row.rate) : null;
                }
                if (seed.source === 'FY_CLOSE') row.status = 'locked';
            } else if (soldBeforeQty > 0) {
                row.status = 'review';
                row.message = `${soldBeforeQty} sold in this financial year before the opening date, so the opening cannot be used as is`;
            } else if (fy.is_closed === 'Y') {
                row.status = 'review';
                row.message = `${fy.fy_name} is closed`;
            } else if (row.rate) {
                row.value = round2(row.qty * row.rate);
            } else {
                row.status = 'needs_rate';
                row.message = 'No purchase in the system. Enter a rate.';
            }
        }
        rows.push(row);
    }
    return rows;
}

// Quantity always comes from the plan, not the browser: only value is an input.
async function saveStockRows(locationCode, user, inputs) {
    const plan = await buildStockPlan(locationCode);
    const byKey = new Map(plan.map(p => [`${p.product_id}:${p.fy_id}`, p]));
    let saved = 0;
    const skipped = [];

    await db.sequelize.transaction(async (transaction) => {
        for (const input of inputs) {
            const row = byKey.get(`${Number(input.product_id)}:${Number(input.fy_id)}`);
            const value = Number(input.value);
            if (!row || !['ready', 'needs_rate', 'saved', 'changed'].includes(row.status)) {
                skipped.push(row ? row.product_name : `product ${input.product_id}`);
                continue;
            }
            if (!Number.isFinite(value) || value < 0 || (row.qty > 0 && value === 0)) {
                skipped.push(row.product_name);
                continue;
            }
            const notes = row.opening_date
                ? `From Product Master opening ${row.opening_date}, value set in Accounting Setup`
                : 'Purchased with no opening stock entered';
            await db.sequelize.query(`
                INSERT INTO gl_stock_opening_balance (location_code, product_id, fy_id, opening_qty, opening_value, source, notes, created_by)
                VALUES (:locationCode, :product_id, :fy_id, :qty, :value, 'SEED', :notes, :user)
                ON DUPLICATE KEY UPDATE opening_qty = VALUES(opening_qty), opening_value = VALUES(opening_value), notes = VALUES(notes)
            `, {
                replacements: { locationCode, user, notes, product_id: row.product_id, fy_id: row.fy_id, qty: row.qty, value: round2(value) },
                type: QueryTypes.INSERT,
                transaction,
            });
            saved++;
        }
    });
    return { saved, skipped };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function moveDay(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().substring(0, 10);
}

// Creates the financial year that today falls in, if the location has none
// covering it. The current flag moves only off the year that just ended, so a
// location still deliberately working in an older year keeps its choice.
async function ensureCurrentFinancialYear(locationCode, user, options = {}) {
    const startYear = indianFyStartYear(options.today || todayIst());
    const start = `${startYear}-04-01`;
    const end = `${startYear + 1}-03-31`;
    const previousEnd = `${startYear}-03-31`;

    const run = async (transaction) => {
        const r = { locationCode, start, end, previousEnd, user, fy_name: `${startYear}-${startYear + 1}` };
        const fys = await select(`SELECT fy_id, is_current, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
                                  FROM gl_financial_years
                                  WHERE location_code = :locationCode`, r, transaction);
        const covered = await select(`SELECT fy_id FROM gl_financial_years
                                      WHERE location_code = :locationCode AND start_date <= :end AND end_date >= :start
                                      LIMIT 1`, r, transaction);
        if (covered.length) return null;

        const current = fys.find(f => f.is_current === 'Y');
        const takeOver = !current || current.end_date === previousEnd;
        if (current && takeOver) {
            await db.sequelize.query(`UPDATE gl_financial_years SET is_current = 'N', updated_by = :user WHERE fy_id = :fy_id`,
                { replacements: { user, fy_id: current.fy_id }, type: QueryTypes.UPDATE, transaction });
        }
        await db.sequelize.query(`
            INSERT INTO gl_financial_years (location_code, fy_name, start_date, end_date, is_current, created_by, updated_by)
            VALUES (:locationCode, :fy_name, :start, :end, :is_current, :user, :user)
        `, { replacements: { ...r, is_current: takeOver ? 'Y' : 'N' }, type: QueryTypes.INSERT, transaction });
        return { fy_name: r.fy_name, is_current: takeOver ? 'Y' : 'N' };
    };
    return options.transaction ? run(options.transaction) : db.sequelize.transaction(run);
}

// Maps products added in the last few days, and creates only the ledgers those
// maps need. Older unmapped products are left alone: a location may have left
// them out on purpose, and only the Accounting Setup page should touch them.
async function mapNewProducts(locationCode, user, options = {}) {
    const days = options.days || NEW_PRODUCT_DAYS;
    const run = async (transaction) => {
        const recent = await select(`SELECT product_id FROM m_product
                                     WHERE location_code = :locationCode AND creation_date >= NOW() - INTERVAL :days DAY`,
            { locationCode, days }, transaction);
        if (!recent.length) return [];

        const plan = await buildPlan(locationCode, { transaction });
        if (!plan.hasGroups) return [];

        const recentIds = new Set(recent.map(p => p.product_id));
        const maps = plan.productMaps.filter(m => recentIds.has(m.product_id));
        const names = new Set(maps.map(m => m.ledger_name.toLowerCase()));
        const ledgers = plan.ledgersToCreate.filter(l => names.has(l.ledger_name.toLowerCase()));
        await insertLedgers(locationCode, user, ledgers, transaction);
        await insertProductMaps(locationCode, user, maps, transaction);
        return maps;
    };
    return options.transaction ? run(options.transaction) : db.sequelize.transaction(run);
}

module.exports = { buildPlan, applyPlan, buildStockPlan, saveStockRows, classifyProduct, ensureCurrentFinancialYear, mapNewProducts };
