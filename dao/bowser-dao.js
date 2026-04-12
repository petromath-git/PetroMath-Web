'use strict';
const db = require('../db/db-connection');

module.exports = {

    // ── Bowser Master ─────────────────────────────────────────

    getBowsersByLocation: (locationCode) => {
        return db.sequelize.query(`
            SELECT b.bowser_id, b.bowser_name, b.capacity_litres, b.product_id,
                   p.product_name, b.is_active
            FROM m_bowser b
            JOIN m_product p ON p.product_id = b.product_id
            WHERE b.location_code = :locationCode
            ORDER BY b.bowser_name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getActiveBowsersByLocation: (locationCode) => {
        return db.sequelize.query(`
            SELECT b.bowser_id, b.bowser_name, b.capacity_litres, b.product_id,
                   p.product_name, p.price AS product_price
            FROM m_bowser b
            JOIN m_product p ON p.product_id = b.product_id
            WHERE b.location_code = :locationCode AND b.is_active = 'Y'
            ORDER BY b.bowser_name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getBowserById: (bowserId) => {
        return db.sequelize.query(`
            SELECT b.bowser_id, b.bowser_name, b.capacity_litres, b.product_id,
                   p.product_name, b.is_active, b.location_code
            FROM m_bowser b
            JOIN m_product p ON p.product_id = b.product_id
            WHERE b.bowser_id = :bowserId
        `, { replacements: { bowserId }, type: db.Sequelize.QueryTypes.SELECT })
        .then(rows => rows[0] || null);
    },

    createBowser: (data) => {
        return db.sequelize.query(`
            INSERT INTO m_bowser (location_code, bowser_name, capacity_litres, product_id, created_by)
            VALUES (:locationCode, :bowserName, :capacityLitres, :productId, :createdBy)
        `, { replacements: data, type: db.Sequelize.QueryTypes.INSERT });
    },

    updateBowser: (bowserId, data) => {
        return db.sequelize.query(`
            UPDATE m_bowser
            SET bowser_name = :bowserName,
                capacity_litres = :capacityLitres,
                product_id = :productId,
                updated_by = :updatedBy,
                updation_date = NOW()
            WHERE bowser_id = :bowserId
        `, { replacements: { ...data, bowserId }, type: db.Sequelize.QueryTypes.UPDATE });
    },

    toggleBowserActive: (bowserId, isActive, updatedBy) => {
        return db.sequelize.query(`
            UPDATE m_bowser SET is_active = :isActive, updated_by = :updatedBy, updation_date = NOW()
            WHERE bowser_id = :bowserId
        `, { replacements: { bowserId, isActive, updatedBy }, type: db.Sequelize.QueryTypes.UPDATE });
    },

    // ── Intercompany (SFS shift closing tab) ──────────────────

    getIntercompanyByClosingId: (closingId) => {
        return db.sequelize.query(`
            SELECT i.id, i.bowser_id, i.product_id, i.quantity,
                   b.bowser_name, p.product_name
            FROM t_closing_intercompany i
            JOIN m_bowser  b ON b.bowser_id  = i.bowser_id
            JOIN m_product p ON p.product_id = i.product_id
            WHERE i.closing_id = :closingId
            ORDER BY b.bowser_name
        `, { replacements: { closingId }, type: db.Sequelize.QueryTypes.SELECT });
    },

    saveIntercompanyEntries: async (closingId, closingDate, locationCode, entries, createdBy) => {
        await db.sequelize.query(`
            DELETE FROM t_closing_intercompany WHERE closing_id = :closingId
        `, { replacements: { closingId }, type: db.Sequelize.QueryTypes.DELETE });

        if (!entries || entries.length === 0) return { deleted: true, inserted: 0 };

        const placeholders = entries.map(() => '(:closingId, :closingDate, :locationCode, ?, ?, ?, :createdBy)').join(', ');
        // Build flattened replacements
        const flatValues = [];
        entries.forEach(e => flatValues.push(e.bowser_id, e.product_id, e.quantity));

        // Use a loop for clarity
        for (const entry of entries) {
            await db.sequelize.query(`
                INSERT INTO t_closing_intercompany
                    (closing_id, closing_date, location_code, bowser_id, product_id, quantity, created_by)
                VALUES (:closingId, :closingDate, :locationCode, :bowserId, :productId, :quantity, :createdBy)
            `, {
                replacements: {
                    closingId, closingDate, locationCode,
                    bowserId: entry.bowser_id,
                    productId: entry.product_id,
                    quantity: entry.quantity,
                    createdBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }
        return { inserted: entries.length };
    },

    getFillsReceivedByBowserAndDate: (bowserId, date) => {
        return db.sequelize.query(`
            SELECT COALESCE(SUM(quantity), 0) AS total_fills
            FROM t_closing_intercompany
            WHERE bowser_id = :bowserId AND closing_date = :date
        `, { replacements: { bowserId, date }, type: db.Sequelize.QueryTypes.SELECT })
        .then(rows => Number(rows[0]?.total_fills || 0));
    },

    // ── Bowser Closing ────────────────────────────────────────

    getBowserClosings: (locationCode, fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT bc.bowser_closing_id, bc.closing_date, bc.status,
                   bc.opening_meter, bc.closing_meter,
                   (bc.closing_meter - bc.opening_meter) AS meter_diff,
                   bc.rate, bc.ex_shortage,
                   b.bowser_name, b.capacity_litres
            FROM t_bowser_closing bc
            JOIN m_bowser b ON b.bowser_id = bc.bowser_id
            WHERE bc.location_code = :locationCode
              AND bc.closing_date BETWEEN :fromDate AND :toDate
            ORDER BY bc.closing_date DESC, b.bowser_name
        `, { replacements: { locationCode, fromDate, toDate }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getBowserClosingById: (bowserClosingId) => {
        return db.sequelize.query(`
            SELECT bc.*, b.bowser_name, b.capacity_litres, b.product_id,
                   p.product_name, p.price AS product_price,
                   (bc.closing_meter - bc.opening_meter) AS meter_diff,
                   (bc.opening_stock + bc.fills_received - (bc.closing_meter - bc.opening_meter)) AS closing_stock
            FROM t_bowser_closing bc
            JOIN m_bowser  b ON b.bowser_id  = bc.bowser_id
            JOIN m_product p ON p.product_id = b.product_id
            WHERE bc.bowser_closing_id = :bowserClosingId
        `, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT })
        .then(rows => rows[0] || null);
    },

    getLastClosingForBowser: (bowserId) => {
        return db.sequelize.query(`
            SELECT closing_meter,
                   (opening_stock + fills_received - (closing_meter - opening_meter)) AS closing_stock
            FROM t_bowser_closing
            WHERE bowser_id = :bowserId AND status = 'CLOSED'
            ORDER BY closing_date DESC
            LIMIT 1
        `, { replacements: { bowserId }, type: db.Sequelize.QueryTypes.SELECT })
        .then(rows => rows[0] || null);
    },

    createBowserClosing: (data) => {
        return db.sequelize.query(`
            INSERT INTO t_bowser_closing
                (bowser_id, location_code, closing_date, opening_meter, closing_meter, rate,
                 fills_received, opening_stock, status, created_by)
            VALUES (:bowserId, :locationCode, :closingDate, :openingMeter, :closingMeter, :rate,
                    :fillsReceived, :openingStock, 'DRAFT', :createdBy)
        `, { replacements: data, type: db.Sequelize.QueryTypes.INSERT });
    },

    updateBowserClosing: (bowserClosingId, data) => {
        return db.sequelize.query(`
            UPDATE t_bowser_closing
            SET opening_meter  = :openingMeter,
                closing_meter  = :closingMeter,
                rate           = :rate,
                fills_received = :fillsReceived,
                opening_stock  = :openingStock,
                updated_by     = :updatedBy,
                updation_date  = NOW()
            WHERE bowser_closing_id = :bowserClosingId AND status = 'DRAFT'
        `, { replacements: { ...data, bowserClosingId }, type: db.Sequelize.QueryTypes.UPDATE });
    },

    finalizeBowserClosing: (bowserClosingId, updatedBy) => {
        return db.sequelize.query(`
            UPDATE t_bowser_closing
            SET status     = 'CLOSED',
                ex_shortage = (
                    COALESCE((SELECT SUM(amount) FROM t_bowser_credits       WHERE bowser_closing_id = :bowserClosingId), 0) +
                    COALESCE((SELECT SUM(amount) FROM t_bowser_digital_sales  WHERE bowser_closing_id = :bowserClosingId), 0) +
                    COALESCE((SELECT SUM(amount) FROM t_bowser_cashsales      WHERE bowser_closing_id = :bowserClosingId), 0) -
                    (closing_meter - opening_meter) * rate
                ),
                updated_by  = :updatedBy,
                updation_date = NOW()
            WHERE bowser_closing_id = :bowserClosingId AND status = 'DRAFT'
        `, { replacements: { bowserClosingId, updatedBy }, type: db.Sequelize.QueryTypes.UPDATE });
    },

    reopenBowserClosing: (bowserClosingId, updatedBy) => {
        return db.sequelize.query(`
            UPDATE t_bowser_closing
            SET status = 'DRAFT', ex_shortage = NULL, updated_by = :updatedBy, updation_date = NOW()
            WHERE bowser_closing_id = :bowserClosingId AND status = 'CLOSED'
        `, { replacements: { bowserClosingId, updatedBy }, type: db.Sequelize.QueryTypes.UPDATE });
    },

    deleteBowserClosing: async (bowserClosingId) => {
        // Guard: only DRAFT may be deleted
        const [closing] = await db.sequelize.query(
            `SELECT status FROM t_bowser_closing WHERE bowser_closing_id = :bowserClosingId`,
            { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        if (!closing) throw Object.assign(new Error('Bowser closing not found.'), { statusCode: 404 });
        if (closing.status !== 'DRAFT') throw Object.assign(new Error('Only DRAFT closings can be deleted.'), { statusCode: 400 });

        await db.sequelize.query(`DELETE FROM t_bowser_credits       WHERE bowser_closing_id = :bowserClosingId`, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE });
        await db.sequelize.query(`DELETE FROM t_bowser_digital_sales  WHERE bowser_closing_id = :bowserClosingId`, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE });
        await db.sequelize.query(`DELETE FROM t_bowser_cashsales      WHERE bowser_closing_id = :bowserClosingId`, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE });
        await db.sequelize.query(`DELETE FROM t_bowser_closing        WHERE bowser_closing_id = :bowserClosingId AND status = 'DRAFT'`, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE });
    },

    // ── Delivery Items ────────────────────────────────────────

    getCreditItems: (bowserClosingId) => {
        return db.sequelize.query(`
            SELECT bc.credit_id, bc.bill_no, bc.creditlist_id, bc.vehicle_id, bc.product_id,
                   bc.quantity, bc.rate, bc.amount,
                   cl.Company_Name AS customer_name,
                   cv.vehicle_number
            FROM t_bowser_credits bc
            LEFT JOIN m_credit_list         cl ON cl.creditlist_id = bc.creditlist_id
            LEFT JOIN m_creditlist_vehicles cv ON cv.vehicle_id    = bc.vehicle_id
            WHERE bc.bowser_closing_id = :bowserClosingId
            ORDER BY bc.credit_id
        `, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getDigitalItems: (bowserClosingId) => {
        return db.sequelize.query(`
            SELECT bd.digital_id, bd.digital_vendor_id, bd.amount, bd.digital_ref,
                   dv.Company_Name AS digital_vendor_name
            FROM t_bowser_digital_sales bd
            LEFT JOIN m_credit_list dv ON dv.creditlist_id = bd.digital_vendor_id
            WHERE bd.bowser_closing_id = :bowserClosingId
            ORDER BY bd.digital_id
        `, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getCashItems: (bowserClosingId) => {
        return db.sequelize.query(`
            SELECT cashsale_id, product_id, amount
            FROM t_bowser_cashsales
            WHERE bowser_closing_id = :bowserClosingId
            ORDER BY cashsale_id
        `, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT });
    },

    saveCreditItems: async (bowserClosingId, items, closingRate, createdBy) => {
        await db.sequelize.query(
            `DELETE FROM t_bowser_credits WHERE bowser_closing_id = :bowserClosingId`,
            { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE }
        );
        for (const item of items) {
            await db.sequelize.query(`
                INSERT INTO t_bowser_credits
                    (bowser_closing_id, bill_no, creditlist_id, vehicle_id, product_id, quantity, rate, amount, created_by)
                VALUES (:bowserClosingId, :billNo, :creditlistId, :vehicleId, :productId, :quantity, :rate, :amount, :createdBy)
            `, {
                replacements: {
                    bowserClosingId,
                    billNo:       item.bill_no || null,
                    creditlistId: item.creditlist_id || null,
                    vehicleId:    item.vehicle_id    || null,
                    productId:    item.product_id,
                    quantity:     item.quantity,
                    rate:         closingRate,
                    amount:       Number(item.quantity || 0) * closingRate,
                    createdBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }
        return { inserted: items.length };
    },

    syncDraftCreditRates: (bowserClosingId, rate) => {
        return db.sequelize.query(`
            UPDATE t_bowser_credits bc
            JOIN t_bowser_closing bcl
              ON bcl.bowser_closing_id = bc.bowser_closing_id
            SET bc.rate = :rate,
                bc.amount = ROUND(COALESCE(bc.quantity, 0) * :rate, 2)
            WHERE bc.bowser_closing_id = :bowserClosingId
              AND bcl.status = 'DRAFT'
        `, {
            replacements: { bowserClosingId, rate },
            type: db.Sequelize.QueryTypes.UPDATE
        });
    },

    saveDigitalItems: async (bowserClosingId, items, createdBy) => {
        await db.sequelize.query(
            `DELETE FROM t_bowser_digital_sales WHERE bowser_closing_id = :bowserClosingId`,
            { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE }
        );
        for (const item of items) {
            await db.sequelize.query(`
                INSERT INTO t_bowser_digital_sales
                    (bowser_closing_id, digital_vendor_id, amount, digital_ref, created_by)
                VALUES (:bowserClosingId, :digitalVendorId, :amount, :digitalRef, :createdBy)
            `, {
                replacements: {
                    bowserClosingId,
                    digitalVendorId: item.digital_vendor_id || null,
                    amount:          item.amount,
                    digitalRef:      item.digital_ref || null,
                    createdBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }
        return { inserted: items.length };
    },

    saveCashItems: async (bowserClosingId, items, createdBy) => {
        await db.sequelize.query(
            `DELETE FROM t_bowser_cashsales WHERE bowser_closing_id = :bowserClosingId`,
            { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.DELETE }
        );
        for (const item of items) {
            await db.sequelize.query(`
                INSERT INTO t_bowser_cashsales
                    (bowser_closing_id, product_id, amount, created_by)
                VALUES (:bowserClosingId, :productId, :amount, :createdBy)
            `, {
                replacements: {
                    bowserClosingId,
                    productId: item.product_id,
                    amount:    item.amount,
                    createdBy
                },
                type: db.Sequelize.QueryTypes.INSERT
            });
        }
        return { inserted: items.length };
    },

    // ── Excess / Shortage ─────────────────────────────────────

    getExShortage: (bowserClosingId) => {
        return db.sequelize.query(`
            SELECT
                (bc.closing_meter - bc.opening_meter) * bc.rate          AS reading_amount,
                COALESCE(SUM(cr.amount), 0)                              AS credit_amount,
                COALESCE((SELECT SUM(amount) FROM t_bowser_digital_sales WHERE bowser_closing_id = :bowserClosingId), 0) AS digital_amount,
                COALESCE((SELECT SUM(amount) FROM t_bowser_cashsales     WHERE bowser_closing_id = :bowserClosingId), 0) AS cash_amount
            FROM t_bowser_closing bc
            LEFT JOIN t_bowser_credits cr ON cr.bowser_closing_id = bc.bowser_closing_id
            WHERE bc.bowser_closing_id = :bowserClosingId
            GROUP BY bc.bowser_closing_id, bc.closing_meter, bc.opening_meter, bc.rate
        `, { replacements: { bowserClosingId }, type: db.Sequelize.QueryTypes.SELECT })
        .then(rows => {
            if (!rows[0]) return { reading_amount: 0, credit_amount: 0, digital_amount: 0, cash_amount: 0, ex_shortage: 0 };
            const r = rows[0];
            const reading  = Number(r.reading_amount)  || 0;
            const credit   = Number(r.credit_amount)   || 0;
            const digital  = Number(r.digital_amount)  || 0;
            const cash     = Number(r.cash_amount)     || 0;
            return {
                reading_amount:  reading,
                credit_amount:   credit,
                digital_amount:  digital,
                cash_amount:     cash,
                ex_shortage:     credit + digital + cash - reading
            };
        });
    },

    // ── Products for dropdown ─────────────────────────────────

    getProductsByLocation: (locationCode) => {
        return db.sequelize.query(`
            SELECT product_id, product_name FROM m_product
            WHERE location_code = :locationCode
            ORDER BY product_name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    },

    // ── Digital vendors for delivery dropdown ────────────────

    getDigitalVendors: (locationCode) => {
        return db.sequelize.query(`
            SELECT creditlist_id, Company_Name AS vendor_name
            FROM m_credit_list
            WHERE location_code = :locationCode
              AND card_flag = 'Y'
              AND (effective_end_date IS NULL OR effective_end_date > CURDATE())
            ORDER BY Company_Name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    },

    // ── Credit customers for delivery dropdown ────────────────

    getCreditCustomers: (locationCode) => {
        return db.sequelize.query(`
            SELECT creditlist_id, Company_Name AS customer_name
            FROM m_credit_list
            WHERE location_code = :locationCode
              AND (card_flag IS NULL OR card_flag <> 'Y')
              AND (effective_end_date IS NULL OR effective_end_date > CURDATE())
            ORDER BY Company_Name
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getVehiclesByCustomer: (creditlistId) => {
        return db.sequelize.query(`
            SELECT vehicle_id, vehicle_number, vehicle_type
            FROM m_creditlist_vehicles
            WHERE creditlist_id = :creditlistId
              AND (effective_end_date IS NULL OR effective_end_date > CURDATE())
            ORDER BY vehicle_number
        `, { replacements: { creditlistId }, type: db.Sequelize.QueryTypes.SELECT });
    },

    getAllVehiclesByLocation: (locationCode) => {
        return db.sequelize.query(`
            SELECT v.vehicle_id, v.vehicle_number, v.vehicle_type, v.creditlist_id,
                   cl.Company_Name AS customer_name
            FROM m_creditlist_vehicles v
            JOIN m_credit_list cl ON cl.creditlist_id = v.creditlist_id
            WHERE cl.location_code = :locationCode
              AND (cl.effective_end_date IS NULL OR cl.effective_end_date > CURDATE())
              AND (v.effective_end_date IS NULL OR v.effective_end_date > CURDATE())
            ORDER BY v.vehicle_number
        `, { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT });
    }
};
