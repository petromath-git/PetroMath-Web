// routes/push-routes.js — turn phone reminders on/off for this device (/push)
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const PushDao = require('../dao/push-subscription-dao');
const pushService = require('../services/push-service');

// Only admin-type users receive deadline reminders, so only they can turn them on
const canUse = [isLoginEnsured, security.isAdmin()];

const validSubscription = (s) =>
    s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length <= 1000 &&
    s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string' &&
    s.keys.p256dh.length <= 200 && s.keys.auth.length <= 100;

router.get('/key', canUse, (req, res) => {
    if (!pushService.isConfigured()) return res.json({ success: false, error: 'Reminders are not set up on this server.' });
    res.json({ success: true, publicKey: pushService.publicKey() });
});

router.post('/status', canUse, async (req, res) => {
    try {
        const endpoint = req.body && req.body.endpoint;
        const found = typeof endpoint === 'string' ? await PushDao.findByEndpoint(req.user.Person_id, endpoint) : null;
        res.json({ success: true, subscribed: !!found });
    } catch (e) {
        console.error('Push status failed:', e);
        res.status(500).json({ success: false, error: 'Could not check reminders.' });
    }
});

router.post('/subscribe', canUse, async (req, res) => {
    try {
        const sub = req.body && req.body.subscription;
        if (!validSubscription(sub)) return res.status(400).json({ success: false, error: 'Invalid subscription.' });
        await PushDao.save(req.user.Person_id, sub, req.get('user-agent'));
        res.json({ success: true });
    } catch (e) {
        console.error('Push subscribe failed:', e);
        res.status(500).json({ success: false, error: 'Could not turn on reminders.' });
    }
});

router.post('/unsubscribe', canUse, async (req, res) => {
    try {
        const endpoint = req.body && req.body.endpoint;
        if (typeof endpoint === 'string') await PushDao.removeByEndpoint(req.user.Person_id, endpoint);
        res.json({ success: true });
    } catch (e) {
        console.error('Push unsubscribe failed:', e);
        res.status(500).json({ success: false, error: 'Could not turn off reminders.' });
    }
});

// Sends a test notification to this device only
router.post('/test', canUse, async (req, res) => {
    try {
        const endpoint = req.body && req.body.endpoint;
        const subs = await PushDao.findForPerson(req.user.Person_id);
        const sub = subs.find(s => s.endpoint === endpoint);
        if (!sub) return res.status(404).json({ success: false, error: 'Reminders are not on for this device.' });
        const result = await pushService.sendTo(sub, {
            title: 'PetroMath reminders are on',
            body: `You'll get deadline reminders for ${req.user.location_code} at 9 AM.`,
            url: '/deadline',
            tag: 'push-test',
        });
        if (result.status !== 'SENT') return res.status(502).json({ success: false, error: 'Send failed: ' + (result.error || result.status) });
        res.json({ success: true });
    } catch (e) {
        console.error('Push test failed:', e);
        res.status(500).json({ success: false, error: 'Could not send test.' });
    }
});

module.exports = router;
