const db = require("../db/db-connection");

module.exports = {

    // Get the active (DRAFT) closing for this cashier — returns latest, flags if multiple exist
    getActiveClosing: async (cashierId, locationCode) => {
        const results = await db.sequelize.query(`
            SELECT closing_id, closing_date, closing_status
            FROM t_closing
            WHERE cashier_id = :cashierId
              AND location_code = :locationCode
              AND closing_status = 'DRAFT'
            ORDER BY closing_date DESC
        `, {
            replacements: { cashierId, locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });

        if (!results.length) return null;

        const active = results[0];
        active.multipleDrafts = results.length > 1;
        active.draftCount = results.length;
        return active;
    },

    // Get tank products for this location
    getTankProducts: async (locationCode) => {
        return db.sequelize.query(`
            SELECT product_id, product_name, price, rgb_color
            FROM m_product
            WHERE location_code = :locationCode
              AND is_tank_product = 1
            ORDER BY product_name
        `, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Get active credit customers for this location
    getCreditCustomers: async (locationCode) => {
        return db.sequelize.query(`
            SELECT creditlist_id, Company_Name, short_name
            FROM m_credit_list
            WHERE location_code = :locationCode
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE())
            ORDER BY Company_Name
        `, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Get active vehicles for a customer
    getVehiclesForCustomer: async (creditlistId) => {
        return db.sequelize.query(`
            SELECT vehicle_id, vehicle_number, vehicle_type
            FROM m_creditlist_vehicles
            WHERE creditlist_id = :creditlistId
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE())
            ORDER BY vehicle_number
        `, {
            replacements: { creditlistId },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Save a new credit entry to t_credits
    saveEntry: async (data) => {
        // Fetch product price server-side — do not trust client
        const priceResult = await db.sequelize.query(`
            SELECT price FROM m_product WHERE product_id = :productId LIMIT 1
        `, {
            replacements: { productId: data.product_id },
            type: db.Sequelize.QueryTypes.SELECT
        });
        const price = priceResult.length ? parseFloat(priceResult[0].price) || 0 : 0;

        const result = await db.sequelize.query(`
            INSERT INTO t_credits
                (closing_id, creditlist_id, vehicle_id, product_id, price, qty, amount, bill_no, notes, created_by, creation_date, updation_date)
            VALUES
                (:closingId, :creditlistId, :vehicleId, :productId, :price, :qty, :amount, :billNo, :notes, :createdBy, NOW(), NOW())
        `, {
            replacements: {
                closingId:    data.closing_id,
                creditlistId: data.creditlist_id,
                vehicleId:    data.vehicle_id || null,
                productId:    data.product_id,
                price:        price,
                qty:          data.qty,
                amount:       data.amount,
                billNo:       data.bill_no && data.bill_no.trim() !== '' ? data.bill_no.trim() : null,
                notes:        data.notes && data.notes.trim() !== '' ? data.notes.trim() : null,
                createdBy:    data.created_by
            },
            type: db.Sequelize.QueryTypes.INSERT
        });
        return result[0]; // insertId
    },

    // Get all today's entries for this cashier across all their shifts
    getEntriesByClosing: async (closingId, cashierId, locationCode) => {
        return db.sequelize.query(`
            SELECT
                tc.tcredit_id,
                tc.closing_id,
                tc.qty,
                tc.amount,
                tc.bill_no,
                tc.notes,
                tc.creation_date,
                mp.product_name,
                mp.rgb_color,
                mcl.Company_Name,
                COALESCE(mv.vehicle_number, '') as vehicle_number
            FROM t_credits tc
            JOIN t_closing cl ON tc.closing_id = cl.closing_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
            LEFT JOIN m_creditlist_vehicles mv ON tc.vehicle_id = mv.vehicle_id
            WHERE cl.cashier_id = :cashierId
              AND cl.location_code = :locationCode
              AND DATE(cl.closing_date) = CURDATE()
            ORDER BY tc.creation_date DESC
        `, {
            replacements: { cashierId, locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Delete an entry — only if it belongs to this closing (safety check)
    deleteEntry: async (tcreditId, closingId) => {
        const result = await db.sequelize.query(`
            DELETE FROM t_credits
            WHERE tcredit_id = :tcreditId
              AND closing_id = :closingId
        `, {
            replacements: { tcreditId, closingId },
            type: db.Sequelize.QueryTypes.DELETE
        });
        return result;
    }

};