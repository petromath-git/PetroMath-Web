// dao/onboarding-dao.js
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const SECTION_MAP = {
    'employees':        { table: 't_onboarding_employees',        fields: ['employee_name', 'designation'] },
    'metered-products': { table: 't_onboarding_metered_products', fields: ['product_name', 'short_name'] },
    'tanks':            { table: 't_onboarding_tanks',            fields: ['tank_name', 'tank_capacity', 'tank_short_name', 'product_short_name'] },
    'nozzles':          { table: 't_onboarding_nozzles',          fields: ['nozzle_name', 'nozzle_product', 'du_make', 'tank_connected', 'next_stamping_date'] },
    'lubes':            { table: 't_onboarding_lubes',            fields: ['product_name', 'unit', 'selling_price'] },
    'banks':            { table: 't_onboarding_banks',            fields: ['bank_name', 'short_name', 'branch', 'account_name', 'account_last4', 'ifsc_code', 'account_number', 'account_type'] },
    'digital':          { table: 't_onboarding_digital',          fields: ['platform_name'] },
    'customers':        { table: 't_onboarding_customers',        fields: ['customer_name', 'address', 'gstin', 'owner_name', 'owner_mobile', 'manager_name', 'manager_mobile', 'customer_type'] },
    'suppliers':        { table: 't_onboarding_suppliers',        fields: ['supplier_name', 'short_name'] },
};

module.exports = {
    SECTION_MAP,

    findByToken: async (token) => {
        const [row] = await db.sequelize.query(
            'SELECT * FROM t_onboarding WHERE token = :token',
            { replacements: { token }, type: QueryTypes.SELECT }
        );
        return row || null;
    },

    findById: async (id) => {
        const [row] = await db.sequelize.query(
            'SELECT * FROM t_onboarding WHERE id = :id',
            { replacements: { id }, type: QueryTypes.SELECT }
        );
        return row || null;
    },

    findAll: async () => {
        return db.sequelize.query(
            'SELECT * FROM t_onboarding ORDER BY created_at DESC',
            { type: QueryTypes.SELECT }
        );
    },

    create: async (locationName, personId, token) => {
        const [insertId] = await db.sequelize.query(
            'INSERT INTO t_onboarding (token, location_name, created_by_person_id) VALUES (:token, :locationName, :personId)',
            { replacements: { token, locationName, personId }, type: QueryTypes.INSERT }
        );
        return insertId;
    },

    updateStatus: async (id, status, notes) => {
        await db.sequelize.query(
            'UPDATE t_onboarding SET status = :status, notes = :notes WHERE id = :id',
            { replacements: { id, status, notes: notes ?? null }, type: QueryTypes.UPDATE }
        );
    },

    getRo: async (onboardingId) => {
        const [row] = await db.sequelize.query(
            'SELECT * FROM t_onboarding_ro WHERE onboarding_id = :onboardingId',
            { replacements: { onboardingId }, type: QueryTypes.SELECT }
        );
        return row || {};
    },

    upsertRo: async (onboardingId, data) => {
        const { ro_name, owner_contact, gst_number, ro_brand, ro_address, location_link } = data;
        await db.sequelize.query(`
            INSERT INTO t_onboarding_ro (onboarding_id, ro_name, owner_contact, gst_number, ro_brand, ro_address, location_link)
            VALUES (:onboardingId, :ro_name, :owner_contact, :gst_number, :ro_brand, :ro_address, :location_link)
            ON DUPLICATE KEY UPDATE
                ro_name       = VALUES(ro_name),
                owner_contact = VALUES(owner_contact),
                gst_number    = VALUES(gst_number),
                ro_brand      = VALUES(ro_brand),
                ro_address    = VALUES(ro_address),
                location_link = VALUES(location_link)
        `, {
            replacements: {
                onboardingId,
                ro_name:       ro_name       || null,
                owner_contact: owner_contact || null,
                gst_number:    gst_number    || null,
                ro_brand:      ro_brand      || null,
                ro_address:    ro_address    || null,
                location_link: location_link || null,
            },
            type: QueryTypes.INSERT
        });
    },

    getSection: async (onboardingId, section) => {
        const { table } = SECTION_MAP[section];
        return db.sequelize.query(
            `SELECT * FROM ${table} WHERE onboarding_id = :onboardingId ORDER BY sort_order, id`,
            { replacements: { onboardingId }, type: QueryTypes.SELECT }
        );
    },

    addRow: async (onboardingId, section) => {
        const { table } = SECTION_MAP[section];
        const [maxRow] = await db.sequelize.query(
            `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM ${table} WHERE onboarding_id = :onboardingId`,
            { replacements: { onboardingId }, type: QueryTypes.SELECT }
        );
        const [insertId] = await db.sequelize.query(
            `INSERT INTO ${table} (onboarding_id, sort_order) VALUES (:onboardingId, :nextOrder)`,
            { replacements: { onboardingId, nextOrder: maxRow.next_order }, type: QueryTypes.INSERT }
        );
        return insertId;
    },

    updateRow: async (onboardingId, section, rowId, data) => {
        const { table, fields } = SECTION_MAP[section];
        const allowed = {};
        for (const f of fields) {
            if (f in data) {
                allowed[f] = (data[f] === '' || data[f] === undefined) ? null : data[f];
            }
        }
        if (Object.keys(allowed).length === 0) return;
        const setClauses = Object.keys(allowed).map(f => `${f} = :${f}`).join(', ');
        await db.sequelize.query(
            `UPDATE ${table} SET ${setClauses} WHERE id = :rowId AND onboarding_id = :onboardingId`,
            { replacements: { ...allowed, rowId, onboardingId }, type: QueryTypes.UPDATE }
        );
    },

    deleteRow: async (onboardingId, section, rowId) => {
        const { table } = SECTION_MAP[section];
        await db.sequelize.query(
            `DELETE FROM ${table} WHERE id = :rowId AND onboarding_id = :onboardingId`,
            { replacements: { rowId, onboardingId }, type: QueryTypes.DELETE }
        );
    },

    getAllData: async (onboardingId) => {
        const dao = module.exports;
        const [ro, employees, metered_products, tanks, nozzles, lubes, banks, digital, customers, suppliers] =
            await Promise.all([
                dao.getRo(onboardingId),
                dao.getSection(onboardingId, 'employees'),
                dao.getSection(onboardingId, 'metered-products'),
                dao.getSection(onboardingId, 'tanks'),
                dao.getSection(onboardingId, 'nozzles'),
                dao.getSection(onboardingId, 'lubes'),
                dao.getSection(onboardingId, 'banks'),
                dao.getSection(onboardingId, 'digital'),
                dao.getSection(onboardingId, 'customers'),
                dao.getSection(onboardingId, 'suppliers'),
            ]);
        return { ro, employees, metered_products, tanks, nozzles, lubes, banks, digital, customers, suppliers };
    },
};
