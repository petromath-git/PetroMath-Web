// routes/onboarding-routes.js — public (no auth required)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/onboarding-controller');

router.get('/:token',                  ctrl.getForm);
router.patch('/:token/ro',             ctrl.upsertRo);
router.post('/:token/:section',        ctrl.addRow);
router.patch('/:token/:section/:rowId', ctrl.updateRow);
router.delete('/:token/:section/:rowId', ctrl.deleteRow);

module.exports = router;
