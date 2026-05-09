const db = require('../db/db-connection');
const InvoiceProductMap = db.invoice_product_map;

module.exports = {
    // Get all mappings for a location+supplier as { invoiceProductName -> product_id }
    // Used by fuel invoice flow — shape unchanged.
    getMappings: async (locationCode, supplierId) => {
        const rows = await InvoiceProductMap.findAll({
            where: { location_code: locationCode, supplier_id: supplierId }
        });
        const map = {};
        rows.forEach(r => { map[r.invoice_product_name] = r.product_id; });
        return map;
    },

    // Get mappings for lube invoices — includes conversion_factor.
    // Returns { invoiceProductName -> { product_id, conversion_factor } }
    getLubesMappings: async (locationCode, supplierId) => {
        const rows = await InvoiceProductMap.findAll({
            where: { location_code: locationCode, supplier_id: supplierId }
        });
        const map = {};
        rows.forEach(r => {
            map[r.invoice_product_name] = {
                product_id: r.product_id,
                conversion_factor: r.conversion_factor != null ? parseFloat(r.conversion_factor) : null
            };
        });
        return map;
    },

    // Upsert mappings — called after user confirms product selections (fuel invoices)
    saveMappings: async (locationCode, supplierId, mappings) => {
        for (const m of mappings) {
            await InvoiceProductMap.upsert({
                location_code: locationCode,
                supplier_id: supplierId,
                invoice_product_name: m.invoice_product_name,
                product_id: m.product_id
            });
        }
    },

    // Upsert lube mappings — includes conversion_factor
    saveLubesMappings: async (locationCode, supplierId, mappings) => {
        for (const m of mappings) {
            await InvoiceProductMap.upsert({
                location_code: locationCode,
                supplier_id: supplierId,
                invoice_product_name: m.invoice_product_name,
                product_id: m.product_id,
                conversion_factor: m.conversion_factor != null ? m.conversion_factor : null
            });
        }
    }
};
