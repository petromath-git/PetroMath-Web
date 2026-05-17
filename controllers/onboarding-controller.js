// controllers/onboarding-controller.js
const { randomUUID } = require('crypto');
const OnboardingDao = require('../dao/onboarding-dao');
const dateFormat = require('dateformat');
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const CONFIG_HINT_LOCATIONS = ['MUE', 'SFS', 'AACBE'];

function formatDateForInput(d) {
    if (!d) return '';
    return new Date(d).toISOString().split('T')[0];
}

function formatDateForDisplay(d) {
    if (!d) return '';
    return dateFormat(new Date(d), 'dd-mmm-yyyy');
}

module.exports = {
    // ── Public form ────────────────────────────────────────────────────────────
    getForm: async (req, res, next) => {
        try {
            const onboarding = await OnboardingDao.findByToken(req.params.token);
            if (!onboarding) {
                return res.status(404).render('error', { message: 'Onboarding link not found or expired.', error: {} });
            }
            const formData = await OnboardingDao.getAllData(onboarding.id);
            formData.nozzles = formData.nozzles.map(n => ({
                ...n,
                next_stamping_date: formatDateForInput(n.next_stamping_date),
            }));
            res.render('onboarding/form', {
                title: `Onboarding – ${onboarding.location_name}`,
                token: req.params.token,
                onboarding,
                formData,
            });
        } catch (e) {
            next(e);
        }
    },

    upsertRo: async (req, res, next) => {
        try {
            const onboarding = await OnboardingDao.findByToken(req.params.token);
            if (!onboarding) return res.status(404).json({ error: 'Not found' });
            await OnboardingDao.upsertRo(onboarding.id, req.body);
            res.json({ ok: true });
        } catch (e) {
            next(e);
        }
    },

    addRow: async (req, res, next) => {
        try {
            const { token, section } = req.params;
            if (!OnboardingDao.SECTION_MAP[section]) return res.status(400).json({ error: 'Invalid section' });
            const onboarding = await OnboardingDao.findByToken(token);
            if (!onboarding) return res.status(404).json({ error: 'Not found' });
            const id = await OnboardingDao.addRow(onboarding.id, section);
            res.json({ id });
        } catch (e) {
            next(e);
        }
    },

    updateRow: async (req, res, next) => {
        try {
            const { token, section, rowId } = req.params;
            if (!OnboardingDao.SECTION_MAP[section]) return res.status(400).json({ error: 'Invalid section' });
            const onboarding = await OnboardingDao.findByToken(token);
            if (!onboarding) return res.status(404).json({ error: 'Not found' });
            await OnboardingDao.updateRow(onboarding.id, section, parseInt(rowId, 10), req.body);
            res.json({ ok: true });
        } catch (e) {
            next(e);
        }
    },

    deleteRow: async (req, res, next) => {
        try {
            const { token, section, rowId } = req.params;
            if (!OnboardingDao.SECTION_MAP[section]) return res.status(400).json({ error: 'Invalid section' });
            const onboarding = await OnboardingDao.findByToken(token);
            if (!onboarding) return res.status(404).json({ error: 'Not found' });
            await OnboardingDao.deleteRow(onboarding.id, section, parseInt(rowId, 10));
            res.json({ ok: true });
        } catch (e) {
            next(e);
        }
    },

    // ── Admin ──────────────────────────────────────────────────────────────────
    adminList: async (req, res, next) => {
        try {
            const onboardings = await OnboardingDao.findAll();
            res.render('onboarding/admin-list', {
                title: 'Onboarding',
                user: req.user,
                onboardings,
                baseUrl: `${req.protocol}://${req.get('host')}`,
            });
        } catch (e) {
            next(e);
        }
    },

    adminCreate: async (req, res, next) => {
        try {
            const { location_name } = req.body;
            if (!location_name?.trim()) return res.status(400).json({ error: 'Location name is required' });
            const token = randomUUID();
            const id = await OnboardingDao.create(location_name.trim(), req.user.Person_id, token);
            const url = `${req.protocol}://${req.get('host')}/onboard/${token}`;
            res.json({ id, token, url });
        } catch (e) {
            next(e);
        }
    },

    adminDetail: async (req, res, next) => {
        try {
            const onboarding = await OnboardingDao.findById(req.params.id);
            if (!onboarding) return res.status(404).render('error', { message: 'Not found', error: {} });
            const formData = await OnboardingDao.getAllData(onboarding.id);
            formData.nozzles = formData.nozzles.map(n => ({
                ...n,
                next_stamping_date: formatDateForDisplay(n.next_stamping_date),
            }));
            res.render('onboarding/admin-detail', {
                title: `Onboarding – ${onboarding.location_name}`,
                user: req.user,
                onboarding,
                formData,
                baseUrl: `${req.protocol}://${req.get('host')}`,
            });
        } catch (e) {
            next(e);
        }
    },

    adminUpdateStatus: async (req, res, next) => {
        try {
            const { status, notes } = req.body;
            if (!['active', 'setup_done'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
            await OnboardingDao.updateStatus(req.params.id, status, notes);
            res.json({ ok: true });
        } catch (e) {
            next(e);
        }
    },

    applyConfig: async (req, res, next) => {
        try {
            const { location_code, settings } = req.body;
            if (!location_code?.trim()) return res.status(400).json({ error: 'location_code is required' });
            if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings object is required' });
            const loc = location_code.trim().toUpperCase();
            const entries = Object.entries(settings).filter(([, v]) => v !== null && v !== '');
            if (!entries.length) return res.json({ inserted: 0 });
            for (const [name, value] of entries) {
                // Remove any existing open-ended row for this location+setting, then insert fresh
                await db.sequelize.query(
                    `DELETE FROM m_location_config WHERE location_code = :loc AND setting_name = :name AND effective_end_date = '9999-12-31'`,
                    { replacements: { loc, name }, type: QueryTypes.DELETE }
                );
                await db.sequelize.query(
                    `INSERT INTO m_location_config (location_code, setting_name, setting_value, effective_start_date, effective_end_date, created_by)
                     VALUES (:loc, :name, :value, CURDATE(), '9999-12-31', 'onboarding')`,
                    { replacements: { loc, name, value }, type: QueryTypes.INSERT }
                );
            }
            res.json({ inserted: entries.length });
        } catch (e) {
            next(e);
        }
    },

    hsnSuggestions: async (req, res, next) => {
        try {
            const q = (req.query.q || '').trim();
            // Return distinct HSN codes; filter by product name if q provided
            const rows = await db.sequelize.query(
                `SELECT DISTINCT hsn_code,
                        GROUP_CONCAT(DISTINCT product_name ORDER BY product_name SEPARATOR ', ') AS sample_products,
                        COUNT(*) AS cnt
                 FROM m_product
                 WHERE hsn_code IS NOT NULL AND hsn_code != ''
                   ${q ? 'AND product_name LIKE :pattern' : ''}
                 GROUP BY hsn_code
                 ORDER BY cnt DESC
                 LIMIT 30`,
                { replacements: { pattern: `%${q}%` }, type: QueryTypes.SELECT }
            );
            res.json(rows);
        } catch (e) {
            next(e);
        }
    },

    adminConfigHints: async (req, res, next) => {
        try {
            const rows = await db.sequelize.query(
                `SELECT location_code, setting_name, setting_value
                 FROM m_location_config
                 WHERE location_code IN (:locs)
                 ORDER BY setting_name, location_code`,
                { replacements: { locs: CONFIG_HINT_LOCATIONS }, type: QueryTypes.SELECT }
            );
            // Pivot: setting_name → { MUE: val, SFS: val, AACBE: val }
            const map = {};
            for (const row of rows) {
                if (!map[row.setting_name]) map[row.setting_name] = {};
                map[row.setting_name][row.location_code] = row.setting_value;
            }
            const hints = Object.entries(map)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, vals]) => ({ name, ...vals }));
            res.json(hints);
        } catch (e) {
            next(e);
        }
    },
};
