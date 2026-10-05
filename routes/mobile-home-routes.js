// routes/mobile-home-routes.js
// Phone home page: open shifts on top, then the user's menu as tiles.
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const moment = require('moment');
const TxnReadDao = require('../dao/txn-read-dao');
const rolePermissionsDao = require('../dao/role-permissions-dao');
const { buildMobileMenuGroups, userHasUrl } = require('../utils/mobile-menu');

router.get('/', isLoginEnsured, async function (req, res, next) {
    try {
        // Cashiers already land on their own single-purpose page for their open shift.
        if (req.user.Role === 'Cashier') {
            return res.redirect('/dsm-entry');
        }
        if (req.user.Role === 'Customer') {
            return res.redirect('/home-customer');
        }

        const menuDetails = req.user.menuDetails;
        const canOpenShifts = userHasUrl(menuDetails, '/home');

        let openShifts = [];
        let canCreateShift = false;
        if (canOpenShifts) {
            canCreateShift = await rolePermissionsDao.hasPermission(
                req.user.Role, req.user.location_code, 'CREATE_SHIFT_CLOSING');
            const drafts = await TxnReadDao.getDraftClosingsForHome(req.user.location_code);
            openShifts = drafts.map(d => ({
                closingId: d.closing_id,
                cashierName: d.cashier_name || 'Shift',
                closingDate: d.closing_date ? moment(d.closing_date).format('DD-MMM-YYYY') : ''
            }));
        }

        res.render('mobile-home', {
            title: 'Home',
            user: req.user,
            mobileReady: true,
            menuGroups: buildMobileMenuGroups(menuDetails),
            openShifts,
            canOpenShifts,
            canCreateShift
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
