'use strict';
const express = require('express');
const router  = express.Router();
const login   = require('connect-ensure-login');
const security = require('../utils/app-security');
const bowserController = require('../controllers/bowser-controller');

const ensureLoggedIn = login.ensureLoggedIn({});

// ── Bowser Master ─────────────────────────────────────────────
router.get('/master',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_MASTER')],
    bowserController.getMasterPage);

router.post('/master',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_MASTER')],
    bowserController.createBowser);

router.put('/master/:id',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_MASTER')],
    bowserController.updateBowser);

router.put('/master/:id/toggle-active',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_MASTER')],
    bowserController.toggleBowserActive);

// ── Intercompany API (used by SFS shift closing tab) ──────────
router.get('/api/intercompany/:closingId',
    [ensureLoggedIn],
    bowserController.getIntercompanyByClosingId);

router.post('/api/intercompany',
    [ensureLoggedIn],
    bowserController.saveIntercompany);

router.get('/api/fills-received',
    [ensureLoggedIn],
    bowserController.getFillsSuggestion);

router.get('/api/ex-shortage/:id',
    [ensureLoggedIn],
    bowserController.getExShortage);

router.get('/api/vehicles/:creditlistId',
    [ensureLoggedIn],
    bowserController.getVehiclesByCustomer);

router.get('/api/vehicles',
    [ensureLoggedIn],
    bowserController.getAllVehicles);

// ── Bowser Closing ────────────────────────────────────────────
router.get('/closing',
    [ensureLoggedIn, security.hasPermission('VIEW_BOWSER_CLOSING')],
    bowserController.getClosingList);

router.get('/closing/new',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.getClosingForm);

router.get('/closing/:id',
    [ensureLoggedIn, security.hasPermission('VIEW_BOWSER_CLOSING')],
    bowserController.getClosingForm);

router.post('/closing',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.saveDraft);

router.put('/closing/:id',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.saveDraft);

router.post('/closing/:id/finalize',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.finalizeClosing);

router.post('/closing/:id/reopen',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.reopenClosing);

router.delete('/closing/:id',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.deleteClosing);

router.post('/closing/items',
    [ensureLoggedIn, security.hasPermission('MANAGE_BOWSER_CLOSING')],
    bowserController.saveDeliveryItems);

module.exports = router;
