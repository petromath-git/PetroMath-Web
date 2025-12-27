const db = require("../db/db-connection");
const Product = db.product;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
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
                'cgst_percent',
                'sgst_percent',
                'sku_name',
                'sku_number',
                'hsn_code',
                'rgb_color',
                'is_tank_product'
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
                'sku_number'
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
            unit: product.unit,
            ledger_name: product.ledger_name,
            cgst_percent: product.cgst_percent,
            sgst_percent: product.sgst_percent,
            updated_by: product.updated_by,
            updation_date: new Date()
        };

        if (product.sku_name) updateFields.sku_name = product.sku_name;
        if (product.sku_number) updateFields.sku_number = product.sku_number;
        if (product.hsn_code) updateFields.hsn_code = product.hsn_code;
        if (product.is_tank_product !== undefined) updateFields.is_tank_product = product.is_tank_product;

        return Product.update(updateFields, {
            where: {
                product_id: product.product_id
            }
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