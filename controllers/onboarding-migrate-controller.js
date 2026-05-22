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

            const { location_code, template_location, skip_supplier_ids } = req.body;
            if (!location_code?.trim()) return res.status(400).json({ error: 'location_code is required' });
            if (!template_location?.trim()) return res.status(400).json({ error: 'template_location is required' });
            const loc = location_code.trim();
            const tmpl = template_location.trim();
            const skipSupplierIds = new Set((skip_supplier_ids || []).map(Number));

            const data = await OnboardingDao.getAllData(onboarding.id);
            const ro = data.ro;
            const results = [];

            // Helper: uppercase a string value safely
            const up   = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : (v || null));
            const code = (v) => up(v) ? up(v).replace(/\s+/g, '') : null;

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
                            `INSERT INTO m_location (location_code, location_name, address, company_name, phone, gst_number, start_date, effective_end_date, created_by, updated_by, creation_date)
                             VALUES (:loc, :name, :address, :company, :phone, :gst, CURDATE(), '9999-12-31', 'onboarding', 'onboarding', NOW())`,
                            {
                                loc,
                                name:    up(ro.ro_name    || onboarding.location_name),
                                address: up(ro.ro_address) || '',
                                company: up(ro.ro_brand)   || null,
                                phone:   ro.owner_contact  || null,
                                gst:     up(ro.gst_number) || null,
                            }
                        );
                        // Trigger auto-seeds: expenses, CashFlow lookups, oil company supplier + SAP bank
                        results.push({ section: 'Location (m_location)', inserted: 1, skipped: 0, errors: [] });
                    } catch (e) {
                        results.push({ section: 'Location (m_location)', inserted: 0, skipped: 0, errors: [e.message] });
                    }
                }
            }

            // ── Step 2: GL Groups (copy structure from MUE) ──────────────────────
            {
                const [existCount] = await db.sequelize.query(
                    'SELECT COUNT(*) AS cnt FROM gl_ledger_groups WHERE location_code = :loc',
                    { replacements: { loc }, type: QueryTypes.SELECT }
                );
                if (existCount.cnt > 0) {
                    results.push({ section: 'GL Groups', inserted: 0, skipped: existCount.cnt, errors: ['Already exist — skipped'] });
                } else {
                    try {
                        // Top-level groups first (no parent_group_id)
                        await db.sequelize.query(
                            `INSERT INTO gl_ledger_groups (location_code, group_name, group_nature, active_flag, created_by)
                             SELECT :loc, group_name, group_nature, active_flag, 'onboarding'
                             FROM gl_ledger_groups
                             WHERE location_code = 'MUE' AND parent_group_id IS NULL`,
                            { replacements: { loc }, type: QueryTypes.INSERT }
                        );
                        // Child groups — resolve parent by matching group_name in the new location
                        await db.sequelize.query(
                            `INSERT INTO gl_ledger_groups (location_code, group_name, group_nature, parent_group_id, active_flag, created_by)
                             SELECT :loc, child.group_name, child.group_nature, new_parent.group_id, child.active_flag, 'onboarding'
                             FROM gl_ledger_groups child
                             JOIN gl_ledger_groups mue_parent ON mue_parent.group_id      = child.parent_group_id
                             JOIN gl_ledger_groups new_parent  ON new_parent.location_code = :loc
                                                               AND new_parent.group_name   = mue_parent.group_name
                             WHERE child.location_code = 'MUE' AND child.parent_group_id IS NOT NULL`,
                            { replacements: { loc }, type: QueryTypes.INSERT }
                        );
                        const [newCount] = await db.sequelize.query(
                            'SELECT COUNT(*) AS cnt FROM gl_ledger_groups WHERE location_code = :loc',
                            { replacements: { loc }, type: QueryTypes.SELECT }
                        );
                        results.push({ section: 'GL Groups', inserted: newCount.cnt, skipped: 0, errors: [] });
                    } catch (e) {
                        results.push({ section: 'GL Groups', inserted: 0, skipped: 0, errors: [e.message] });
                    }
                }
            }

            // ── Step 3: Suppliers ────────────────────────────────────────────────
            results.push(await runSection('Suppliers', data.suppliers, async (s) => {
                if (!s.supplier_name) return 'skipped';
                if (skipSupplierIds.has(s.id)) return 'skipped';
                const exists = await selectOne(
                    'SELECT supplier_id FROM m_supplier WHERE supplier_name = :name AND location_code = :loc',
                    { name: up(s.supplier_name), loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_supplier (supplier_name, supplier_short_name, location_code, effective_start_date, effective_end_date, created_by, updated_by)
                     VALUES (:name, :short, :loc, CURDATE(), '9999-12-31', 'onboarding', 'onboarding')`,
                    { name: up(s.supplier_name), short: up(s.short_name || s.supplier_name), loc }
                );
            }));

            // ── Step 3: Metered Products (with RGB color) ────────────────────────
            results.push(await runSection('Metered Products', data.metered_products, async (p) => {
                if (!p.product_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT product_id FROM m_product WHERE product_name = :name AND location_code = :loc AND is_tank_product = 1',
                    { name: up(p.product_name), loc }
                );
                if (exists) return 'skipped';
                const rgb = PRODUCT_RGB[(p.short_name || '').toUpperCase()] || '200,200,200';
                await insertRow(
                    `INSERT INTO m_product (product_name, location_code, qty, unit, is_tank_product, rgb_color, hsn_code, cgst_percent, sgst_percent, created_by, updated_by)
                     VALUES (:name, :loc, 1, 'Litres', 1, :rgb, :hsn, :cgst, :sgst, 'onboarding', 'onboarding')`,
                    { name: up(p.product_name), loc, rgb, hsn: up(p.hsn_code) || null, cgst: p.cgst_percent ?? null, sgst: p.sgst_percent ?? null }
                );
            }));

            // ── Step 4: Lubes & Other Products ───────────────────────────────────
            results.push(await runSection('Lubes & Other Products', data.lubes, async (l) => {
                if (!l.product_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT product_id FROM m_product WHERE product_name = :name AND location_code = :loc AND is_lube_product = 1',
                    { name: up(l.product_name), loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_product (product_name, location_code, qty, unit, price, is_lube_product, hsn_code, cgst_percent, sgst_percent, created_by, updated_by)
                     VALUES (:name, :loc, 1, :unit, :price, 1, :hsn, :cgst, :sgst, 'onboarding', 'onboarding')`,
                    { name: up(l.product_name), loc, unit: l.unit || 'Nos', price: l.selling_price || null, hsn: up(l.hsn_code) || null, cgst: l.cgst_percent ?? null, sgst: l.sgst_percent ?? null }
                );
            }));

            // ── Step 5: Tanks ─────────────────────────────────────────────────────
            results.push(await runSection('Tanks', data.tanks, async (t) => {
                if (!t.tank_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT tank_id FROM m_tank WHERE tank_code = :code AND location_code = :loc',
                    { code: code(t.tank_name), loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_tank (tank_code, product_code, location_code, tank_orig_capacity, tank_opening_stock, effective_start_date, effective_end_date, created_by, updated_by, creation_date)
                     VALUES (:code, :product, :loc, :capacity, 0, CURDATE(), '9999-12-31', 'onboarding', 'onboarding', NOW())`,
                    { code: code(t.tank_name), product: up(t.product_short_name) || '', loc, capacity: t.tank_capacity || 0 }
                );
            }));

            // ── Step 6: Nozzles → m_pump + m_pump_tank ────────────────────────────
            results.push(await runSection('Nozzles', data.nozzles, async (n) => {
                if (!n.nozzle_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT pump_id FROM m_pump WHERE pump_code = :code AND location_code = :loc',
                    { code: code(n.nozzle_name), loc }
                );
                if (exists) return 'skipped';
                const stampingDue = n.next_stamping_date
                    ? new Date(n.next_stamping_date).toISOString().split('T')[0]
                    : '0000-00-00 00:00:00';
                const pump_id = await insertRow(
                    `INSERT INTO m_pump (pump_code, pump_make, product_code, opening_reading, location_code,
                        effective_start_date, effective_end_date, current_stamping_date, Stamping_due, created_by, updated_by)
                     VALUES (:code, :make, :product, 0, :loc, CURDATE(), '9999-12-31', '0000-00-00 00:00:00', :stamping, 'onboarding', 'onboarding')`,
                    { code: code(n.nozzle_name), make: up(n.du_make) || 'UNKNOWN', product: up(n.nozzle_product) || '', loc, stamping: stampingDue }
                );
                if (n.tank_connected) {
                    const tank = await selectOne(
                        'SELECT tank_id FROM m_tank WHERE tank_code = :code AND location_code = :loc',
                        { code: code(n.tank_connected), loc }
                    );
                    if (tank) {
                        await insertRow(
                            `INSERT INTO m_pump_tank (pump_id, tank_id, location_code, effective_start_date, effective_end_date, created_by, updated_by)
                             VALUES (:pump_id, :tank_id, :loc, CURDATE(), '9999-12-31', 'onboarding', 'onboarding')`,
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
                    { name: up(b.bank_name), loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_bank (bank_name, bank_branch, account_number, ifsc_code, location_code, type, account_nickname, internal_flag, created_by, updated_by)
                     VALUES (:name, :branch, :accnum, :ifsc, :loc, :type, :nickname, 'Y', 'onboarding', 'onboarding')`,
                    {
                        name:     up(b.bank_name),
                        branch:   up(b.branch) || '',
                        accnum:   b.account_number,
                        ifsc:     up(b.ifsc_code),
                        loc,
                        type:     b.account_type || null,
                        nickname: up(b.short_name || b.bank_name),
                    }
                );
            }));

            // ── Step 8: Digital Platforms → m_credit_list (card_flag='Y') ─────────
            results.push(await runSection('Digital Platforms', data.digital, async (d) => {
                if (!d.platform_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT creditlist_id FROM m_credit_list WHERE Company_Name = :name AND location_code = :loc',
                    { name: up(d.platform_name), loc }
                );
                if (exists) return 'skipped';
                await insertRow(
                    `INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, type, effective_start_date, effective_end_date, creation_date, created_by, updated_by)
                     VALUES (:name, :loc, 'Y', 0, 'Credit', CURDATE(), '9999-12-31', NOW(), 'onboarding', 'onboarding')`,
                    { name: up(d.platform_name), loc }
                );
            }));

            // ── Step 9: Customers → m_credit_list (card_flag='N') ─────────────────
            results.push(await runSection('Customers', data.customers, async (c) => {
                if (!c.customer_name) return 'skipped';
                const exists = await selectOne(
                    'SELECT creditlist_id FROM m_credit_list WHERE Company_Name = :name AND location_code = :loc',
                    { name: up(c.customer_name), loc }
                );
                if (exists) return 'skipped';
                let remitBankId = null;
                if (c.remittance_bank) {
                    const rb = await selectOne(
                        `SELECT bank_id FROM m_bank WHERE location_code = :loc AND (account_nickname = :name OR bank_name = :name) LIMIT 1`,
                        { loc, name: up(c.remittance_bank) }
                    );
                    if (rb) remitBankId = rb.bank_id;
                }
                await insertRow(
                    `INSERT INTO m_credit_list (Company_Name, location_code, card_flag, Opening_Balance, gst, address, type, remittance_bank_id, effective_start_date, effective_end_date, creation_date, created_by, updated_by)
                     VALUES (:name, :loc, 'N', 0, :gst, :address, :type, :remitBankId, CURDATE(), '9999-12-31', NOW(), 'onboarding', 'onboarding')`,
                    { name: up(c.customer_name), loc, gst: up(c.gstin) || null, address: up(c.address) || null, type: c.customer_type || null, remitBankId }
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
                        // JOIN to gl_ledger_groups so gl_group_id is resolved by name for the new location
                        await db.sequelize.query(
                            `INSERT INTO m_account_heads
                                (location_code, account_head_name, account_head_type, allowed_entry_type,
                                 notes_required_flag, active_flag, effective_start_date, effective_end_date,
                                 gl_group_id, created_by, updated_by, creation_date, updation_date)
                             SELECT :loc, ah.account_head_name, ah.account_head_type, ah.allowed_entry_type,
                                ah.notes_required_flag, ah.active_flag, ah.effective_start_date, ah.effective_end_date,
                                new_grp.group_id, 'system', 'system', NOW(), NOW()
                             FROM m_account_heads ah
                             LEFT JOIN gl_ledger_groups tmpl_grp ON tmpl_grp.group_id       = ah.gl_group_id
                             LEFT JOIN gl_ledger_groups new_grp   ON new_grp.location_code  = :loc
                                                                  AND new_grp.group_name     = tmpl_grp.group_name
                             WHERE ah.location_code = :tmpl
                               AND ah.account_head_name NOT IN (
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
                                     gl_group_id, created_by, updated_by, creation_date, updation_date)
                                 SELECT :loc, ah.account_head_name, ah.account_head_type, ah.allowed_entry_type,
                                    ah.notes_required_flag, ah.active_flag, ah.effective_start_date, ah.effective_end_date,
                                    new_grp.group_id, 'system', 'system', NOW(), NOW()
                                 FROM m_account_heads ah
                                 LEFT JOIN gl_ledger_groups tmpl_grp ON tmpl_grp.group_id      = ah.gl_group_id
                                 LEFT JOIN gl_ledger_groups new_grp   ON new_grp.location_code = :loc
                                                                      AND new_grp.group_name    = tmpl_grp.group_name
                                 WHERE ah.location_code = :tmpl
                                   AND ah.account_head_name IN (:head1, :head2)`,
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
