const db = require("../db/db-connection");
const Product = db.product;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

// Tables that reference m_product.product_id. Any row here means the product
// has been used and must not be deleted.
const PRODUCT_REF_TABLES = [
    ['t_credits',                'credit sales'],
    ['t_credits_cancelled',      'cancelled credit sales'],
    ['t_cashsales',              'cash sales'],
    ['t_cashsales_cancelled',    'cancelled cash sales'],
    ['t_2toil',                  '2T oil entries'],
    ['t_testing',                'testing entries'],
    ['t_lubes_inv_lines',        'lube purchase invoice lines'],
    ['t_tank_invoice_dtl',       'fuel purchase invoice lines'],
    ['t_lubes_stock_adjustment', 'stock adjustments'],
    ['t_day_bill_items',         'day bill items'],
    ['t_bowser_cashsales',       'bowser cash sales'],
    ['t_bowser_credits',         'bowser credit sales'],
    ['t_closing_intercompany',   'intercompany entries'],
    ['r_product_open_bal',       'opening stock balances'],
    ['m_bowser',                 'bowsers'],
    ['m_creditlist_vehicles',    'customer vehicles']
];

// Product units come from config productUnits (LIT, NOS). Older spellings
// (Litres, LTS, Nos, Kgs ...) map onto them; anything unknown returns null.
function normalizeUnit(unit) {
    const u = String(unit || '').trim().toUpperCase();
    if (/^(L|LT|LTR|LTRS|LTS|LIT|LITS|LITRE|LITRES|LITER|LITERS)$/.test(u)) return 'LIT';
    if (/^(NO|NOS|PC|PCS|PIECE|PIECES|KG|KGS)$/.test(u)) return 'NOS';
    return null;
}

// NOS products are counted in pieces, so their quantities must be whole
// numbers; LIT products may have decimals. Quantities worked out from an
// amount are stored to 3 decimals, hence the tolerance.
function isPieceUnit(unit) {
    return normalizeUnit(unit) === 'NOS';
}
function isWholeQty(qty) {
    const n = Number(qty);
    return Math.abs(n - Math.round(n)) < 0.0005;
}

function fmtQty(qty) {
    return String(Math.round(Number(qty) * 1000) / 1000);
}

module.exports = {
    normalizeUnit,
    isPieceUnit,
    isWholeQty,

    // Returns an error message for the first row selling/moving a piece (NOS)
    // product in a fractional quantity, or null.
    //   rows: [{ product_id, qty }]   (qty may also be an array of quantities)
    //   hint: what the user should do, appended to the message
    checkPieceQuantities: async (rows, hint) => {
        const ids = [...new Set((rows || []).map(r => parseInt(r.product_id)).filter(id => id > 0))];
        if (!ids.length) return null;
        const products = await db.sequelize.query(
            `SELECT product_id, product_name, unit FROM m_product WHERE product_id IN (:ids)`,
            { replacements: { ids }, type: db.Sequelize.QueryTypes.SELECT }
        );
        const byId = new Map(products.map(p => [Number(p.product_id), p]));
        for (const row of rows) {
            const product = byId.get(parseInt(row.product_id));
            if (!product || !isPieceUnit(product.unit)) continue;
            const qtys = Array.isArray(row.qty) ? row.qty : [row.qty];
            const bad = qtys.find(q => q !== null && q !== undefined && q !== '' && !isWholeQty(q));
            if (bad !== undefined) {
                return `${product.product_name} is sold in pieces (NOS), so the quantity must be a whole number — ${fmtQty(bad)} is not.`
                    + (hint ? ' ' + hint : '');
            }
        }
        return null;
    },

    findPumpLinkedProductNames: async (locationCode) => {
        const rows = await db.sequelize.query(`
            SELECT DISTINCT product_code
            FROM m_pump
            WHERE location_code = :locationCode
              AND product_code IS NOT NULL
        `, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });

        return rows.map(r => r.product_code);
    },

    findById: (productId, locationCode) => {
        const where = { product_id: productId };
        if (locationCode) where.location_code = locationCode;
        return Product.findOne({ where });
    },

    findByName: (productName, locationCode) => {
        const where = { product_name: productName };
        if (locationCode) where.location_code = locationCode;
        return Product.findOne({ where });
    },

    isProductLinkedToPumpOrTank: async (locationCode, productName) => {
        const rows = await db.sequelize.query(`
            SELECT
                (
                    (SELECT COUNT(*) FROM m_pump WHERE location_code = :locationCode AND product_code = :productName)
                    +
                    (SELECT COUNT(*) FROM m_tank WHERE location_code = :locationCode AND product_code = :productName)
                ) AS link_count
        `, {
            replacements: { locationCode, productName },
            type: db.Sequelize.QueryTypes.SELECT
        });

        return Number(rows?.[0]?.link_count || 0) > 0;
    },

    findProducts: async (locationCode) => {
        // Base pump products query with location filter
        const pumpProductsQuery = `
            SELECT DISTINCT product_code 
            FROM m_pump 
            WHERE product_code IS NOT NULL 
            ${locationCode ? `AND location_code = '${locationCode}'` : ''}
        `;
        
        const [pumpProducts] = await db.sequelize.query(pumpProductsQuery);
        const pumpProductCodes = pumpProducts.map(p => p.product_code);
        
        const baseQuery = {
            attributes: [
                'product_id',
                'product_name',
                'qty',
                'unit',
                'price',
                'ledger_name',
                'purchase_ledger_name',
                'cgst_percent',
                'sgst_percent',
                'sku_name',
                'sku_number',
                'hsn_code',
                'rgb_color',
                'is_tank_product',
                'is_lube_product'
            ],
            order: [
                // Dynamic ordering based on location-specific pump products
                Sequelize.literal(`CASE WHEN product_name IN ('${pumpProductCodes.join("','")}') THEN 0 ELSE 1 END`),
                ['product_name', 'ASC']
            ]
        };

        if (locationCode) {
            baseQuery.where = { location_code: locationCode };
        }

        return Product.findAll(baseQuery);
    },

    findProductNames: (productIds) => {
        return Product.findAll({
            attributes: [
                'product_id',
                'product_name',
                'sku_name',
                'sku_number',
                'is_lube_product',
                'is_tank_product'
            ],
            where: {
                product_id: {
                    [Op.in]: productIds
                }
            }
        });
    },

    findPreviousDaysData: (locationCode) => {
        return Product.findAll({
            attributes: [
                'product_name', 
                'qty', 
                'unit', 
                'price',
                'sku_name',
                'sku_number'
            ], 
            where: {
                location_code: locationCode
            }
        });
    },
    findAll: (locationCode) => {
    const baseQuery = {
        attributes: [
            'product_id', 
            'product_name', 
            'qty', 
            'unit', 
            'price'
        ],
        order: [['product_name', 'ASC']]
    };

    if (locationCode) {
        baseQuery.where = { location_code: locationCode };
    }

    return Product.findAll(baseQuery);
},

// Add this new method to your existing product-dao.js (keep existing findAll)

findPumpProducts: async (locationCode) => {
    // Get pump products for the location
    const pumpProductsQuery = `
        SELECT DISTINCT mp.product_code 
        FROM m_pump mp
        WHERE mp.product_code IS NOT NULL 
        ${locationCode ? `AND mp.location_code = :locationCode` : ''}
    `;
    
    const pumpProducts = await db.sequelize.query(pumpProductsQuery, {
        replacements: { locationCode },
        type: db.Sequelize.QueryTypes.SELECT
    });
    
    const pumpProductCodes = pumpProducts.map(p => p.product_code);
    
    if (pumpProductCodes.length === 0) {
        // No pump products found, return empty array
        return [];
    }
    
    // Get product details for pump products only
    const baseQuery = {
        attributes: [
            'product_id', 
            'product_name', 
            'unit', 
            'price'
        ],
        where: {
            product_name: {
                [Op.in]: pumpProductCodes
            }
        },
        order: [['product_name', 'ASC']]
    };

    if (locationCode) {
        baseQuery.where.location_code = locationCode;
    }

    return Product.findAll(baseQuery);
},

    create: (product) => {
        if (!product.sku_name) {
            product.sku_name = product.product_name;
        }
        
        if (!product.sku_number) {
            product.sku_number = `SKU-${Date.now()}`;
        }

        return Product.create(product);
    },

    update: (product) => {
        const updateFields = {
            price: product.price,
            ledger_name: product.ledger_name,
            purchase_ledger_name: product.purchase_ledger_name,
            cgst_percent: product.cgst_percent,
            sgst_percent: product.sgst_percent,
            updated_by: product.updated_by,
            updation_date: new Date()
        };

        if (product.unit) updateFields.unit = product.unit;
        if (product.product_name) updateFields.product_name = product.product_name;
        if (product.sku_name) updateFields.sku_name = product.sku_name;
        if (product.sku_number) updateFields.sku_number = product.sku_number;
        if (product.hsn_code) updateFields.hsn_code = product.hsn_code;
        if (product.is_tank_product !== undefined) updateFields.is_tank_product = product.is_tank_product;
        if (product.is_lube_product !== undefined) updateFields.is_lube_product = product.is_lube_product;

        return Product.update(updateFields, {
            where: {
                product_id: product.product_id
            }
        });
    },

    // Returns [{ label, count }] for everything that stops a product from being
    // deleted. Empty array = safe to delete. Transaction tables are matched by
    // product_id; pump/tank config is matched by name (m_pump/m_tank.product_code),
    // so a name link only blocks when this is the sole product carrying that name.
    getDeleteBlockers: async (productId, locationCode, productName) => {
        const sql = PRODUCT_REF_TABLES
            .map(([table, label]) => `SELECT '${label}' AS label, COUNT(*) AS cnt FROM ${table} WHERE product_id = :productId`)
            .join(' UNION ALL ');
        const rows = await db.sequelize.query(sql, {
            replacements: { productId },
            type: db.Sequelize.QueryTypes.SELECT
        });
        const blockers = rows
            .filter(r => Number(r.cnt) > 0)
            .map(r => ({ label: r.label, count: Number(r.cnt) }));

        const [link] = await db.sequelize.query(`
            SELECT
                (SELECT COUNT(*) FROM m_pump WHERE location_code = :locationCode AND product_code = :productName) AS pumps,
                (SELECT COUNT(*) FROM m_tank WHERE location_code = :locationCode AND product_code = :productName) AS tanks,
                (SELECT COUNT(*) FROM m_product WHERE location_code = :locationCode AND product_name = :productName) AS same_name
        `, {
            replacements: { locationCode, productName },
            type: db.Sequelize.QueryTypes.SELECT
        });
        if (Number(link.same_name) <= 1) {
            if (Number(link.pumps) > 0) blockers.push({ label: 'nozzles (pump configuration)', count: Number(link.pumps) });
            if (Number(link.tanks) > 0) blockers.push({ label: 'tanks', count: Number(link.tanks) });
        }
        return blockers;
    },

    // Product ids at the location that pass the same rules as getDeleteBlockers,
    // in one round trip for the list page (each ref table is scanned once, not
    // once per product). getDeleteBlockers stays the authoritative check on delete.
    findDeletableProductIds: async (locationCode) => {
        const usedSql = PRODUCT_REF_TABLES
            .map(([table]) => `SELECT product_id FROM ${table} WHERE product_id IN (SELECT product_id FROM m_product WHERE location_code = :locationCode)`)
            .join(' UNION ');
        const rows = await db.sequelize.query(`
            SELECT p.product_id
            FROM m_product p
            LEFT JOIN (${usedSql}) used ON used.product_id = p.product_id
            WHERE p.location_code = :locationCode
              AND used.product_id IS NULL
              AND (
                    (SELECT COUNT(*) FROM m_product s WHERE s.location_code = p.location_code AND s.product_name = p.product_name) > 1
                    OR (    NOT EXISTS (SELECT 1 FROM m_pump mp WHERE mp.location_code = p.location_code AND mp.product_code = p.product_name)
                        AND NOT EXISTS (SELECT 1 FROM m_tank mt WHERE mt.location_code = p.location_code AND mt.product_code = p.product_name))
                  )
        `, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return new Set(rows.map(r => Number(r.product_id)));
    },

    // Product ids at the location with any sale, purchase or stock entry
    // (the PRODUCT_REF_TABLES) — their unit is locked.
    findUsedProductIds: async (locationCode) => {
        const usedSql = PRODUCT_REF_TABLES
            .map(([table]) => `SELECT product_id FROM ${table} WHERE product_id IN (SELECT product_id FROM m_product WHERE location_code = :locationCode)`)
            .join(' UNION ');
        const rows = await db.sequelize.query(usedSql, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return new Set(rows.map(r => Number(r.product_id)));
    },

    isProductUsed: async (productId) => {
        const sql = PRODUCT_REF_TABLES
            .map(([table]) => `SELECT 1 FROM ${table} WHERE product_id = :productId`)
            .join(' UNION ALL ');
        const rows = await db.sequelize.query(`SELECT EXISTS (${sql}) AS used`, {
            replacements: { productId },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return Number(rows[0].used) === 1;
    },

    // Caller must check getDeleteBlockers first. Removes config-only rows that
    // point at the product, keeps a DELETE snapshot in m_product_h, then deletes.
    deleteProduct: (productId, deletedBy) => {
        return db.sequelize.transaction(async (t) => {
            const opts = { replacements: { productId, deletedBy }, transaction: t };
            await db.sequelize.query(`DELETE FROM gl_product_ledger_map WHERE product_id = :productId`, opts);
            await db.sequelize.query(`DELETE FROM t_invoice_product_map WHERE product_id = :productId`, opts);
            await db.sequelize.query(`
                INSERT INTO m_product_h (product_id, product_name, location_code, qty, unit, price,
                    created_by, updated_by, updation_date, creation_date, ledger_name,
                    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, operation_type)
                SELECT product_id, product_name, location_code, qty, unit, price,
                    created_by, :deletedBy, NOW(), creation_date, ledger_name,
                    cgst_percent, sgst_percent, sku_name, sku_number, hsn_code, rgb_color, 'DELETE'
                FROM m_product WHERE product_id = :productId
            `, opts);
            await db.sequelize.query(`DELETE FROM m_product WHERE product_id = :productId`, opts);
        });
    },

    findBySkuNumber: (skuNumber) => {
        return Product.findOne({
            where: {
                sku_number: skuNumber
            }
        });
    },

    bulkUpdate: (products) => {
        return Promise.all(products.map(product => module.exports.update(product)));
    }
};
