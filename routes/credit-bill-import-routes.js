// Shift closing > Credit Sales > Import bills (gated by CREDIT_BILL_IMPORT)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const locationConfig = require('../utils/location-config');
const importService = require('../services/credit-bill-import-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function isEnabled(req, res, next) {
    const flag = await locationConfig.getLocationConfigValue(req.user.location_code, 'CREDIT_BILL_IMPORT', 'N');
    if (flag !== 'Y') return res.status(403).json({ error: 'Credit bill import is not enabled for this location.' });
    next();
}

function parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (e) { return fallback; }
}

function requestArgs(req) {
    return {
        locationCode: req.user.location_code,
        closingId: parseInt(req.body.closing_id, 10),
        buffer: req.file.buffer,
        productIds: parseJson(req.body.product_ids, []),
        rates: parseJson(req.body.rates, {})
    };
}

router.post('/preview', [isLoginEnsured, isEnabled, upload.single('file')], async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an Excel file.' });
    try {
        const result = await importService.preview(requestArgs(req));
        res.status(result.error ? 400 : 200).json(result);
    } catch (err) {
        console.error('Credit bill import preview failed:', err);
        res.status(500).json({ error: 'Could not read the file: ' + err.message });
    }
});

router.post('/import', [isLoginEnsured, isEnabled, upload.single('file')], async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an Excel file.' });
    try {
        const result = await importService.runImport({
            ...requestArgs(req),
            partyChoices: parseJson(req.body.party_choices, {}),
            productChoices: parseJson(req.body.product_choices, {}),
            user: req.user
        });
        res.status(result.error ? 400 : 200).json(result);
    } catch (err) {
        console.error('Credit bill import failed:', err);
        res.status(500).json({ error: 'Import failed, nothing was saved: ' + err.message });
    }
});

module.exports = router;
