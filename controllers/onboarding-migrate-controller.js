// controllers/onboarding-migrate-controller.js
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');
const OnboardingDao = require('../dao/onboarding-dao');

// RGB colors for standard metered products (by short_name)
const PRODUCT_RGB = { MS: '217,234,211', HSD: '172,197,220' };

// Oil-company-specific account head names
const OC_HEADS_ALL = [
    'IOCL LICENSE FEE RECOVERY', 'IOCL CHARGES',
    'BPCL LICENSE FEE RECOVERY', 'BPCL CHARGES',
];
const OC_HEADS_BY_BRAND = {
    IOCL: ['IOCL LICENSE FEE RECOVERY', 'IOCL CHARGES'],
    BPCL: ['BPCL LICENSE FEE RECOVERY', 'BPCL CHARGES'],
};

async function selectOne(sql, replacements) {
    const [row] = await db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    return row || null;
}

async function insertRow(sql, replacements) {
    const [insertId] = await db.sequelize.query(sql, { replacements, type: QueryTypes.INSERT });
    return insertId;
}

async function runSection(name, items, fn) {
    let inserted = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
        try {
            const result = await fn(item);
            if (result === 'skipped') skipped++;
            else inserted++;
        } catch (e) {
            errors.push(e.message || 'Unknown error');
            skipped++;
        }
    }
    return { section: name, inserted, skipped, errors };
}

module.exports = {
    migrate: async (req, res, next) => {
        try {
            const onboarding = await OnboardingDao.findById(req.params.id);
            if (!onboarding) return res.status(404).json({ error: 'Not found' });

            const { location_code, template_location } = req.body;
            if (!location_code?.trim()) return res.status(400).json({ error: 'location_code is required' });
            if (!template_location?.trim()) return res.status(400).json({ error: 'template_location is required' });
            const loc = location_code.trim();
            const tmpl = template_location.trim();

            const data = await OnboardingDao.getAllData(onboarding.id);
            const ro = data.ro;
            const results = [];

            // ── Step 1: Create Location ──────────────────────────────────────────
            {
                const exists = await selectOne(
                    'SELECT location_id FROM m_location WHERE location_code = :loc', { loc }
                );
                if (exists) {
                    results.push({ section: 'Location (m_location)', inserted: 0, skipped: 1, errors: ['Already exists — skipped'] });
                } else {
                    try {
                        await insertRow(
                            `INSERT INTO m_location (location_code, location_name, address, company_name, phone, gst_number, start_date, effective_end_date, created_by)
                             VALUES (:loc, :name, :address, :company, :phone, :gst, CURDATE(), '9999-12-31', 'onboarding')`,
                            {
                                loc,
                                name:    ro.ro_name    || onboarding.location_name,
                                address: ro.ro_address || '',
                                company: ro.ro_brand   || null,
                                phone:   ro.owner_contact || null,
                                gst:     ro.gst_number || null,
                            }
                        );
                        // Trigger auto-seeds: expenses, CashFlow lookups, oil company supplier + SAP bank
                        results.push({ section: 'Location (m_location)', inserted: 1, skipped: 0, errors: [] });
                    } catch (e) {
                        results.push({ section: 'Location (m_location)', inserted: 0, skipped: 0, errors: [e.message] });
                    }
                }
            }

            // ── Step 2: Suppliers ────────────────────────────────────────────────
            results.push(await runSection('Suppliers', data.suppliers, async (s) => {
                if (!s.supplier_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT supplier_id FROM m_supplier WHERE supplier_name = :name AND location_code = :loc',
                    { name: s.supplier_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_supplier (supplier_name, supplier_short_name, location_code, effective_start_date, effective_end_date, created_by)
                     VALUES (:name, :short, :loc, CURDATE(), '9999-12-31', 'onboarding')`,
                    { name: s.supplier_name, short: s.short_name || s.supplier_name, loc }
                );
            }));

            // ── Step 3: Metered Products (with RGB color) ────────────────────────
            results.push(await runSection('Metered Products', data.metered_products, async (p) => {
                if (!p.product_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT product_id FROM m_product WHERE product_name = :name AND location_code = :loc AND is_tank_product = 1',
                    { name: p.product_name, loc }
                );
                if (exists) return 'skipped';
                const rgb = PRODUCT_RGB[(p.short_name || '').toUpperCase()] || '200,200,200';
                await insertRow(
                    `INSERT INTO m_product (product_name, location_code, qty, unit, is_tank_product, rgb_color, created_by)
                     VALUES (:name, :loc, 1, 'Litres', 1, :rgb, 'onboarding')`,
                    { name: p.product_name, loc, rgb }
                );
            }));

            // ── Step 4: Lubes & Other Products ───────────────────────────────────
            results.push(await runSection('Lubes & Other Products', data.lubes, async (l) => {
                if (!l.product_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT product_id FROM m_product WHERE product_name = :name AND location_code = :loc AND is_lube_product = 1',
                    { name: l.product_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_product (product_name, location_code, qty, unit, price, is_lube_product, created_by)
                     VALUES (:name, :loc, 1, :unit, :price, 1, 'onboarding')`,
                    { name: l.product_name, loc, unit: l.unit || 'Nos', price: l.selling_price || null }
                );
            }));

            // ── Step 5: Tanks ─────────────────────────────────────────────────────
            results.push(await runSection('Tanks', data.tanks, async (t) => {
                if (!t.tank_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT tank_id FROM m_tank WHERE tank_code = :code AND location_code = :loc',
                    { code: t.tank_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_tank (tank_code, product_code, location_code, tank_orig_capacity, tank_opening_stock, effective_start_date, effective_end_date, created_by)
                     VALUES (:code, :product, :loc, :capacity, 0, CURDATE(), '9999-12-31', 'onboarding')`,
                    { code: t.tank_name, product: t.product_short_name || '', loc, capacity: t.tank_capacity || 0 }
                );
            }));

            // ── Step 6: Nozzles → m_pump + m_pump_tank ────────────────────────────
            results.push(await runSection('Nozzles', data.nozzles, async (n) => {
                if (!n.nozzle_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT pump_id FROM m_pump WHERE pump_code = :code AND location_code = :loc',
                    { code: n.nozzle_name, loc }
                );
                if (exists) return 'skipped';
                const stampingDue = n.next_stamping_date
                    ? new Date(n.next_stamping_date).toISOString().split('T')[0]
                    : '0000-00-00 00:00:00';
                const pump_id = await insertRow(
                    `INSERT INTO m_pump (pump_code, pump_make, product_code, opening_reading, location_code,
                        effective_start_date, effective_end_date, current_stamping_date, Stamping_due, created_by)
                     VALUES (:code, :make, :product, 0, :loc, CURDATE(), '9999-12-31', '0000-00-00 00:00:00', :stamping, 'onboarding')`,
                    { code: n.nozzle_name, make: n.du_make || 'Unknown', product: n.nozzle_product || '', loc, stamping: stampingDue }
                );
                if (n.tank_connected) {
                    const tank = await selectOne(
                        'SELECT tank_id FROM m_tank WHERE tank_code = :code AND location_code = :loc',
                        { code: n.tank_connected, loc }
                    );
                    if (tank) {
                        await insertRow(
                            `INSERT INTO m_pump_tank (pump_id, tank_id, location_code, effective_start_date, effective_end_date, created_by)
                             VALUES (:pump_id, :tank_id, :loc, CURDATE(), '9999-12-31', 'onboarding')`,
                            { pump_id, tank_id: tank.tank_id, loc }
                        );
                    }
                }
            }));

            // ── Step 7: Banks (internal customer banks only) ──────────────────────
            // Oil company SAP/SOA bank is auto-created by the m_location insert trigger
            results.push(await runSection('Banks', data.banks, async (b) => {
                if (!b.bank_name) return 'skipped';
                if (!b.account_number || !b.ifsc_code) return 'skipped';
                const exists = await selectOne(
                    'SELECT bank_id FROM m_bank WHERE bank_name = :name AND location_code = :loc',
                    { name: b.bank_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_bank (bank_name, bank_branch, account_number, ifsc_code, location_code, type, account_nickname, internal_flag, created_by)
                     VALUES (:name, :branch, :accnum, :ifsc, :loc, :type, :nickname, 'Y', 'onboarding')`,
                    {
                        name:     b.bank_name,
                        branch:   b.branch || '',
                        accnum:   b.account_number,
                        ifsc:     b.ifsc_code,
                        loc,
                        type:     b.account_type || null,
                        nickname: b.short_name || null,
                    }
                );
            }));

            // ── Step 8: Digital Platforms → m_credit_list (card_flag='Y') ─────────
            results.push(await runSection('Digital Platforms', data.digital, async (d) => {
                if (!d.platform_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT creditlist_id FROM m_credit_list WHERE Company_Name = :name AND location_code = :loc',
                    { name: d.platform_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, type, creation_date, created_by)
                     VALUES (:name, :loc, 'Y', 0, 'Digital', NOW(), 'onboarding')`,
                    { name: d.platform_name, loc }
                );
            }));

            // ── Step 9: Customers → m_credit_list (card_flag='N') ─────────────────
            results.push(await runSection('Customers', data.customers, async (c) => {
                if (!c.customer_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT creditlist_id FROM m_credit_list WHERE Company_Name = :name AND location_code = :loc',
                    { name: c.customer_name, loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, gst, address, phoneno, type, creation_date, created_by)
                     VALUES (:name, :loc, 'N', 0, :gst, :address, :phone, :type, NOW(), 'onboarding')`,
                    { name: c.customer_name, loc, gst: c.gstin || null, address: c.address || null, phone: c.owner_mobile || null, type: c.customer_type || null }
                );
            }));

            // ── Step 10: Account Heads (copy from template) ───────────────────────
            {
                const [countRow] = await db.sequelize.query(
                    'SELECT COUNT(*) AS cnt FROM m_account_heads WHERE location_code = :loc',
                    { replacements: { loc }, type: QueryTypes.SELECT }
                );
                if (countRow.cnt > 0) {
                    results.push({ section: 'Account Heads', inserted: 0, skipped: countRow.cnt, errors: ['Already exist — skipped'] });
                } else {
                    try {
                        // 5a: Copy all common heads (exclude any oil-company-specific heads)
                        await db.sequelize.query(
                            `INSERT INTO m_account_heads
                                (location_code, account_head_name, account_head_type, allowed_entry_type,
                                 notes_required_flag, active_flag, effective_start_date, effective_end_date,
                                 created_by, updated_by, creation_date, updation_date)
                             SELECT :loc, account_head_name, account_head_type, allowed_entry_type,
                                notes_required_flag, active_flag, effective_start_date, effective_end_date,
                                'system', 'system', NOW(), NOW()
                             FROM m_account_heads
                             WHERE location_code = :tmpl
                               AND account_head_name NOT IN (
                                   'IOCL LICENSE FEE RECOVERY', 'IOCL CHARGES',
                                   'BPCL LICENSE FEE RECOVERY', 'BPCL CHARGES'
                               )`,
                            { replacements: { loc, tmpl }, type: QueryTypes.INSERT }
                        );

                        // 5b: Add the oil-company-specific heads matching this location's brand
                        const ocHeads = OC_HEADS_BY_BRAND[ro.ro_brand];
                        if (ocHeads) {
                            await db.sequelize.query(
                                `INSERT INTO m_account_heads
                                    (location_code, account_head_name, account_head_type, allowed_entry_type,
                                     notes_required_flag, active_flag, effective_start_date, effective_end_date,
                                     created_by, updated_by, creation_date, updation_date)
                                 SELECT :loc, account_head_name, account_head_type, allowed_entry_type,
                                    notes_required_flag, active_flag, effective_start_date, effective_end_date,
                                    'system', 'system', NOW(), NOW()
                                 FROM m_account_heads
                                 WHERE location_code = :tmpl
                                   AND account_head_name IN (:head1, :head2)`,
                                { replacements: { loc, tmpl, head1: ocHeads[0], head2: ocHeads[1] }, type: QueryTypes.INSERT }
                            );
                        }

                        const [newCountRow] = await db.sequelize.query(
                            'SELECT COUNT(*) AS cnt FROM m_account_heads WHERE location_code = :loc',
                            { replacements: { loc }, type: QueryTypes.SELECT }
                        );
                        results.push({ section: 'Account Heads', inserted: newCountRow.cnt, skipped: 0, errors: [] });
                    } catch (e) {
                        results.push({ section: 'Account Heads', inserted: 0, skipped: 0, errors: [e.message] });
                    }
                }
            }

            // ── Step 11: Ledger Rules ─────────────────────────────────────────────
            try {
                await db.sequelize.query('CALL init_sap_static_ledger_rules(:loc, :tmpl)', { replacements: { loc, tmpl }, type: QueryTypes.RAW });
                await db.sequelize.query('CALL init_internal_static_ledger_rules(:loc, :tmpl)', { replacements: { loc, tmpl }, type: QueryTypes.RAW });
                results.push({ section: 'Ledger Rules', inserted: 1, skipped: 0, errors: [] });
            } catch (e) {
                results.push({ section: 'Ledger Rules', inserted: 0, skipped: 0, errors: [e.message] });
            }

            // ── Step 12: Refresh Menu Cache ───────────────────────────────────────
            try {
                await db.sequelize.query('CALL RefreshMenuCache()', { type: QueryTypes.RAW });
                results.push({ section: 'Menu Cache', inserted: 1, skipped: 0, errors: [] });
            } catch (e) {
                results.push({ section: 'Menu Cache', inserted: 0, skipped: 0, errors: [e.message] });
            }

            res.json({ ok: true, results });
        } catch (e) {
            next(e);
        }
    },
};
