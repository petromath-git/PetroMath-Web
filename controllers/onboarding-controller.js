// controllers/onboarding-controller.js
const { randomUUID } = require('crypto');
const OnboardingDao = require('../dao/onboarding-dao');
const dateFormat = require('dateformat');

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
};
