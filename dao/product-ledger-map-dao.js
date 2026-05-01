const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const VALID_MAP_TYPES = ['SALES', 'PURCHASE', 'OUTPUT_CGST', 'OUTPUT_SGST'];

module.exports = {

    getAllMappings: async (locationCode) => {
        return db.sequelize.query(`
            SELECT
                p.product_id,
                p.product_name,
                p.cgst_percent,
                p.sgst_percent,
                p.is_lube_product,
                MAX(CASE WHEN plm.map_type = 'SALES'       THEN plm.ledger_id END) AS sales_ledger_id,
                MAX(CASE WHEN plm.map_type = 'PURCHASE'    THEN plm.ledger_id END) AS purchase_ledger_id,
                MAX(CASE WHEN plm.map_type = 'OUTPUT_CGST' THEN plm.ledger_id END) AS output_cgst_ledger_id,
                MAX(CASE WHEN plm.map_type = 'OUTPUT_SGST' THEN plm.ledger_id END) AS output_sgst_ledger_id
            FROM m_product p
            LEFT JOIN gl_product_ledger_map plm
                   ON plm.product_id    = p.product_id
                  AND plm.location_code = :locationCode
            WHERE p.location_code = :locationCode
            GROUP BY p.product_id, p.product_name, p.cgst_percent, p.sgst_percent, p.is_lube_product
            ORDER BY p.is_lube_product DESC, p.product_name
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
