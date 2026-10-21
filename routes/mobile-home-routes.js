// routes/mobile-home-routes.js
// Phone home page: the user's menu as tiles, with search.
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const { buildMobileMenuGroups } = require('../utils/mobile-menu');
const DeadlineController = require('../controllers/deadline-controller');
const pushService = require('../services/push-service');

router.get('/', isLoginEnsured, async function (req, res) {
    // Cashiers already land on their own single-purpose page for their open shift.
    if (req.user.Role === 'Cashier') {
        return res.redirect('/dsm-entry');
    }
    if (req.user.Role === 'Customer') {
        return res.redirect('/home-customer');
    }

    // Overdue / due-soon deadlines above the tiles (never blocks the page)
    const deadlines = await DeadlineController.getAttentionSummary(req.user.location_code).catch(err => {
        console.error('Mobile home: deadline summary failed:', err.message);
        return null;
    });

    res.render('mobile-home', {
        title: 'Home',
        user: req.user,
        mobileReady: true,
        menuGroups: buildMobileMenuGroups(req.user.menuDetails),
        deadlines,
        pushReady: pushService.isConfigured()
    });
});

module.exports = router;
