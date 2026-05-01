const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

// All map types the accounting engine supports — add new types here only
const VALID_MAP_TYPES = ['SALES', 'PURCHASE', 'OUTPUT_CGST', 'OUTPUT_SGST', 'INPUT_CGST', 'INPUT_SGST'];

module.exports = {

    // Returns one row per product with all current mapping ledger IDs
    getProducts: async (locationCode) => {
        return db.sequelize.query(`
            SELECT
                p.product_id,
                p.product_name,
                p.cgst_percent,
                p.sgst_percent,
                p.is_lube_product
            FROM m_product p
            WHERE p.location_code = :locationCode
            ORDER BY p.is_lube_product DESC, p.product_name
        `, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    // Returns flat rows (product_id, map_type, ledger_id) — used to build the modal lookup
    getAllMappingsRaw: async (locationCode) => {
        return db.sequelize.query(`
            SELECT product_id, map_type, ledger_id
            FROM gl_product_ledger_map
            WHERE location_code = :locationCode
        `, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    upsertMapping: async (locationCode, productId, mapType, ledgerId, updatedBy) => {
        if (!VALID_MAP_TYPES.includes(mapType)) {
            throw new Error(`Invalid map_type: ${mapType}`);
        }
        await db.sequelize.query(`
            INSERT INTO gl_product_ledger_map
                (location_code, product_id, map_type, ledger_id, created_by, updated_by)
            VALUES
                (:locationCode, :productId, :mapType, :ledgerId, :updatedBy, :updatedBy)
            ON DUPLICATE KEY UPDATE
                ledger_id  = :ledgerId,
                updated_by = :updatedBy
        `, {
            replacements: { locationCode, productId, mapType, ledgerId, updatedBy },
            type: QueryTypes.INSERT
        });
    },

    deleteMapping: async (locationCode, productId, mapType) => {
        if (!VALID_MAP_TYPES.includes(mapType)) {
            throw new Error(`Invalid map_type: ${mapType}`);
        }
        await db.sequelize.query(`
            DELETE FROM gl_product_ledger_map
            WHERE location_code = :locationCode
              AND product_id    = :productId
              AND map_type      = :mapType
        `, {
            replacements: { locationCode, productId, mapType },
            type: QueryTypes.DELETE
        });
    }

};
