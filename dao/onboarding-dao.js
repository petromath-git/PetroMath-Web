// dao/onboarding-dao.js
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const SECTION_MAP = {
    'employees':        { table: 't_onboarding_employees',        fields: ['employee_name', 'designation'] },
    'metered-products': { table: 't_onboarding_metered_products', fields: ['short_name', 'hsn_code', 'cgst_percent', 'sgst_percent', 'selling_price'] },
    'tanks':            { table: 't_onboarding_tanks',            fields: ['tank_name', 'tank_capacity', 'tank_short_name', 'product_short_name'] },
    'nozzles':          { table: 't_onboarding_nozzles',          fields: ['nozzle_name', 'nozzle_product', 'du_make', 'tank_connected', 'next_stamping_date'] },
    'lubes':            { table: 't_onboarding_lubes',            fields: ['product_name', 'unit', 'selling_price', 'hsn_code', 'cgst_percent', 'sgst_percent'] },
    'banks':            { table: 't_onboarding_banks',            fields: ['bank_name', 'short_name', 'branch', 'account_name', 'account_last4', 'ifsc_code', 'account_number', 'account_type'] },
    'digital':          { table: 't_onboarding_digital',          fields: ['platform_name'] },
    'customers':        { table: 't_onboarding_customers',        fields: ['customer_name', 'address', 'gstin', 'remittance_bank', 'customer_type'] },
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

    setLinkActive: async (id, active) => {
        await db.sequelize.query(
            'UPDATE t_onboarding SET link_active = :flag WHERE id = :id',
            { replacements: { id, flag: active ? 'Y' : 'N' }, type: QueryTypes.UPDATE }
        );
    },

    // Decides whether this onboarding may write to location `loc`:
    //   linked   — loc is this onboarding's own location (safe re-run)
    //   new      — nobody has loc yet; migrate may create it
    //   conflict — loc belongs to another station / onboarding, or this
    //              onboarding was already migrated under a different code
    checkLocationCode: async (onboarding, loc) => {
        if (onboarding.location_code) {
            if (onboarding.location_code.toUpperCase() === loc) return { status: 'linked' };
            return { status: 'conflict', error: `This onboarding was already migrated as ${onboarding.location_code}.` };
        }
        const [existing] = await db.sequelize.query(
            'SELECT location_name FROM m_location WHERE location_code = :loc LIMIT 1',
            { replacements: { loc }, type: QueryTypes.SELECT }
        );
        if (existing) {
            return { status: 'conflict', error: `${loc} is already used by ${existing.location_name}. Choose another code.` };
        }
        const [claimed] = await db.sequelize.query(
            'SELECT location_name FROM t_onboarding WHERE location_code = :loc AND id <> :id LIMIT 1',
            { replacements: { loc, id: onboarding.id }, type: QueryTypes.SELECT }
        );
        if (claimed) {
            return { status: 'conflict', error: `${loc} is already reserved by onboarding "${claimed.location_name}". Choose another code.` };
        }
        return { status: 'new' };
    },

    // Claims loc for this onboarding. Only succeeds while unlinked; the UNIQUE
    // key on t_onboarding.location_code stops two onboardings claiming one code.
    claimLocationCode: async (id, loc) => {
        try {
            const [, affected] = await db.sequelize.query(
                'UPDATE t_onboarding SET location_code = :loc WHERE id = :id AND location_code IS NULL',
                { replacements: { id, loc }, type: QueryTypes.UPDATE }
            );
            return affected === 1;
        } catch (e) {
            if (e.name === 'SequelizeUniqueConstraintError') return false;   // another onboarding got it first
            throw e;
        }
    },

    // Up to `limit` free 3–5 letter codes derived from the RO name, e.g.
    // "Shankar Agencies" → SHA, SAG, SHN, SHAN. Skips codes used by any
    // m_location row or reserved by another onboarding.
    suggestLocationCodes: async (onboarding, name, limit = 4) => {
        const takenRows = await db.sequelize.query(
            `SELECT UPPER(location_code) AS code FROM m_location
             UNION
             SELECT UPPER(location_code) FROM t_onboarding WHERE location_code IS NOT NULL AND id <> :id`,
            { replacements: { id: onboarding.id }, type: QueryTypes.SELECT }
        );
        const taken = new Set(takenRows.map(r => r.code));

        // NOISE is always dropped; GENERIC (trade words) only used when nothing else is left
        const NOISE = new Set(['SRI', 'SHRI', 'SREE', 'M', 'S', 'MS', 'THE', 'AND', 'CO', 'PVT', 'LTD', 'PRIVATE', 'LIMITED']);
        const GENERIC = new Set(['AGENCY', 'AGENCIES', 'AGECIES', 'FUEL', 'FUELS', 'PETRO', 'PETROLEUM', 'PETROMART', 'PRODUCTS',
            'TRADERS', 'TRADING', 'CORPORATION', 'CORP', 'FILLING', 'STATION', 'SERVICE', 'SERVICES', 'ENTERPRISES', 'BUNK', 'OIL', 'OILS']);
        // Text after the first comma is usually the town ("SENTHIL ANDAVAR FUELS, SATTUR")
        const words = (name || '').split(',')[0].toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/)
            .filter(w => w && !NOISE.has(w));
        const sig = words.filter(w => !GENERIC.has(w));
        const w = sig.length >= 2 ? sig : (sig.length ? [sig[0], ...words.filter(x => x !== sig[0])] : words);
        if (!w.length) return [];

        const [a, b = '', c = ''] = w;
        const consonants = a[0] + a.slice(1).replace(/[AEIOU]/g, '');
        const bases = [
            a.slice(0, 3),
            b ? a[0] + b[0] + (c[0] || '') : '',
            b ? a.slice(0, 2) + b[0] : '',
            b ? a[0] + b.slice(0, 2) : '',
            consonants.slice(0, 3),
            a.slice(0, 4),
            b ? a.slice(0, 3) + b[0] : '',
        ].filter(s => s.length >= 3 && s.length <= 5);

        const out = [];
        const add = (s) => { if (out.length < limit && !taken.has(s) && !out.includes(s)) out.push(s); };
        bases.forEach(add);
        // Everything natural is taken → number the first one (SHA2, SHA3…)
        for (let n = 2; out.length < limit && n <= 9 && bases[0]; n++) add(bases[0] + n);
        return out;
    },

    releaseLocationCode: async (id, loc) => {
        await db.sequelize.query(
            'UPDATE t_onboarding SET location_code = NULL WHERE id = :id AND location_code = :loc',
            { replacements: { id, loc }, type: QueryTypes.UPDATE }
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
