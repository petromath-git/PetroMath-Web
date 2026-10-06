// routes/mobile-home-routes.js
// Phone home page: the user's menu as tiles, with search.
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const { buildMobileMenuGroups } = require('../utils/mobile-menu');

router.get('/', isLoginEnsured, function (req, res) {
    // Cashiers already land on their own single-purpose page for their open shift.
    if (req.user.Role === 'Cashier') {
        return res.redirect('/dsm-entry');
    }
    if (req.user.Role === 'Customer') {
        return res.redirect('/home-customer');
    }

    res.render('mobile-home', {
        title: 'Home',
        user: req.user,
        mobileReady: true,
        menuGroups: buildMobileMenuGroups(req.user.menuDetails)
    });
});

module.exports = router;
