// routes/platform-invoice-public-routes.js
// Invoice link sent to dealers over WhatsApp (tkt #460). No login: the token in
// the link is the only key. The name part is only there to make the link readable.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/platform-billing-controller');

// Generous, because a station's staff can share one IP. Stops token guessing
// and repeated PDF rendering.
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
});

router.get('/:name/:token', limiter, controller.getSharedInvoice);
router.get('/:name/:token/pdf', limiter, controller.getSharedInvoicePdf);

module.exports = router;
