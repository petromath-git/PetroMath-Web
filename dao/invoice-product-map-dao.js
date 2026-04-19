const db = require('../db/db-connection');
const InvoiceProductMap = db.invoice_product_map;

module.exports = {
    // Get all mappings for a location+supplier as { invoiceProductName -> product_id }
    getMappings: async (locationCode, supplierId) => {
        const rows = await InvoiceProductMap.findAll({
            where: { location_code: locationCode, supplier_id: supplierId }
        });
        const map = {};
        rows.forEach(r => { map[r.invoice_product_name] = r.product_id; });
        return map;
    },

    // Upsert mappings — called after user confirms product selections
    saveMappings: async (locationCode, supplierId, mappings) => {
        for (const m of mappings) {
            await InvoiceProductMap.upsert({
                location_code: locationCode,
                supplier_id: supplierId,
                invoice_product_name: m.invoice_product_name,
                product_id: m.product_id
            });
        }
    }
};
