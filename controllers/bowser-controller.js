'use strict';
const BowserDao      = require('../dao/bowser-dao');
const utils          = require('../utils/app-utils');
const locationConfig = require('../utils/location-config');

module.exports = {

    // ── Bowser Master ─────────────────────────────────────────

    getMasterPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const [bowsers, products] = await Promise.all([
                BowserDao.getBowsersByLocation(locationCode),
                BowserDao.getProductsByLocation(locationCode)
            ]);
            res.render('bowser/bowser-master', {
                title: 'Bowser Master',
                user: req.user,
                bowsers,
                products
            });
        } catch (err) {
            console.error('getBowserMasterPage error:', err);
            res.status(500).send('Error loading bowser master');
        }
    },

    createBowser: async (req, res) => {
        try {
            const { bowser_name, capacity_litres, product_id } = req.body;
            if (!bowser_name || !product_id) {
                return res.status(400).json({ success: false, error: 'Bowser name and product are required.' });
            }
            await BowserDao.createBowser({
                locationCode: req.user.location_code,
                bowserName: bowser_name.trim().toUpperCase(),
                capacityLitres: capacity_litres || 0,
                productId: product_id,
                createdBy: String(req.user.Person_id)
            });
            res.json({ success: true, message: 'Bowser created.' });
        } catch (err) {
            console.error('createBowser error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    updateBowser: async (req, res) => {
        try {
            const { bowser_name, capacity_litres, product_id } = req.body;
            await BowserDao.updateBowser(req.params.id, {
                bowserName: bowser_name.trim().toUpperCase(),
                capacityLitres: capacity_litres || 0,
                productId: product_id,
                updatedBy: String(req.user.Person_id)
            });
            res.json({ success: true, message: 'Bowser updated.' });
        } catch (err) {
            console.error('updateBowser error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    toggleBowserActive: async (req, res) => {
        try {
            const { is_active } = req.body;
            await BowserDao.toggleBowserActive(req.params.id, is_active, String(req.user.Person_id));
            res.json({ success: true });
        } catch (err) {
            console.error('toggleBowserActive error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // ── Intercompany API (called from SFS shift closing tab) ──

    getIntercompanyByClosingId: async (req, res) => {
        try {
            const entries = await BowserDao.getIntercompanyByClosingId(req.params.closingId);
            res.json({ success: true, entries });
        } catch (err) {
            console.error('getIntercompany error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveIntercompany: async (req, res) => {
        try {
            const { closing_id, closing_date, entries } = req.body;
            if (!closing_id) {
                return res.status(400).json({ success: false, error: 'closing_id is required.' });
            }
            const result = await BowserDao.saveIntercompanyEntries(
                closing_id,
                closing_date,
                req.user.location_code,
                entries || [],
                String(req.user.Person_id)
            );
            res.json({ success: true, message: 'Intercompany entries saved.', ...result });
        } catch (err) {
            console.error('saveIntercompany error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    // ── Bowser Closing List ────────────────────────────────────

    getClosingList: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const toDate   = req.query.toDate   || utils.currentDate();
            const fromDate = req.query.fromDate  || utils.currentDate();
            const [closings, bowsers, allowBowserReopen] = await Promise.all([
                BowserDao.getBowserClosings(locationCode, fromDate, toDate),
                BowserDao.getActiveBowsersByLocation(locationCode),
                locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N')
            ]);
            res.render('bowser/bowser-closing-list', {
                title: 'Bowser Closings',
                user: req.user,
                closings,
                bowsers,
                fromDate,
                toDate,
                allowBowserReopen
            });
        } catch (err) {
            console.error('getClosingList error:', err);
            res.status(500).send('Error loading bowser closings');
        }
    },

    // ── Bowser Closing Form ───────────────────────────────────

    getClosingForm: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const bowserClosingId = req.params.id || null;

            const [bowsers, customers, digitalVendors, allowBowserReopen] = await Promise.all([
                BowserDao.getActiveBowsersByLocation(locationCode),
                BowserDao.getCreditCustomers(locationCode),
                BowserDao.getDigitalVendors(locationCode),
                locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N')
            ]);

            let closing = null, creditItems = [], digitalItems = [], cashItems = [];

            if (bowserClosingId) {
                [closing, creditItems, digitalItems, cashItems] = await Promise.all([
                    BowserDao.getBowserClosingById(bowserClosingId),
                    BowserDao.getCreditItems(bowserClosingId),
                    BowserDao.getDigitalItems(bowserClosingId),
                    BowserDao.getCashItems(bowserClosingId)
                ]);
                if (!closing) return res.status(404).send('Bowser closing not found.');
            }

            res.render('bowser/bowser-closing', {
                title: bowserClosingId ? 'Edit Bowser Closing' : 'New Bowser Closing',
                user: req.user,
                closing,
                creditItems,
                digitalItems,
                cashItems,
                bowsers,
                customers,
                digitalVendors,
                allowBowserReopen,
                currentDate: utils.currentDate()
            });
        } catch (err) {
            console.error('getClosingForm error:', err);
            res.status(500).send('Error loading bowser closing form');
        }
    },

    getFillsSuggestion: async (req, res) => {
        try {
            const { bowserId, date } = req.query;
            const totalFills = await BowserDao.getFillsReceivedByBowserAndDate(bowserId, date);
            res.json({ success: true, total_fills: totalFills });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getVehiclesByCustomer: async (req, res) => {
        try {
            const vehicles = await BowserDao.getVehiclesByCustomer(req.params.creditlistId);
            res.json({ success: true, vehicles });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveDraft: async (req, res) => {
        try {
            const { bowser_closing_id, bowser_id, closing_date,
                    opening_meter, closing_meter, rate, fills_received, opening_stock } = req.body;
            const locationCode = req.user.location_code;
            const createdBy = String(req.user.Person_id);

            if (bowser_closing_id) {
                await BowserDao.updateBowserClosing(bowser_closing_id, {
                    openingMeter: opening_meter, closingMeter: closing_meter,
                    rate: rate || 0,
                    fillsReceived: fills_received, openingStock: opening_stock,
                    updatedBy: createdBy
                });
                res.json({ success: true, bowser_closing_id, message: 'Readings saved.' });
            } else {
                const [insertId] = await BowserDao.createBowserClosing({
                    bowserId: bowser_id, locationCode, closingDate: closing_date,
                    openingMeter: opening_meter, closingMeter: closing_meter,
                    rate: rate || 0,
                    fillsReceived: fills_received, openingStock: opening_stock,
                    createdBy
                });
                res.json({ success: true, bowser_closing_id: insertId, message: 'Bowser closing created.' });
            }
        } catch (err) {
            console.error('saveDraft error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getExShortage: async (req, res) => {
        try {
            const result = await BowserDao.getExShortage(req.params.id);
            res.json({ success: true, ...result });
        } catch (err) {
            console.error('getExShortage error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    saveDeliveryItems: async (req, res) => {
        try {
            const { bowser_closing_id, items } = req.body;
            if (!bowser_closing_id) {
                return res.status(400).json({ success: false, error: 'Save readings first.' });
            }
            const createdBy     = String(req.user.Person_id);
            const creditItems   = (items || []).filter(i => i.sale_type === 'CREDIT');
            const digitalItems  = (items || []).filter(i => i.sale_type === 'DIGITAL');
            const cashItems     = (items || []).filter(i => i.sale_type === 'CASH');

            await Promise.all([
                BowserDao.saveCreditItems(bowser_closing_id, creditItems, createdBy),
                BowserDao.saveDigitalItems(bowser_closing_id, digitalItems, createdBy),
                BowserDao.saveCashItems(bowser_closing_id, cashItems, createdBy)
            ]);
            res.json({ success: true, message: 'Delivery items saved.', inserted: (items || []).length });
        } catch (err) {
            console.error('saveDeliveryItems error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    finalizeClosing: async (req, res) => {
        try {
            await BowserDao.finalizeBowserClosing(req.params.id, String(req.user.Person_id));
            res.json({ success: true, message: 'Bowser closing finalized.' });
        } catch (err) {
            console.error('finalizeClosing error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    reopenClosing: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const userRole     = req.user.Role;

            let hasPermission = userRole === 'SuperUser';
            if (!hasPermission && userRole === 'Admin') {
                const allow = await locationConfig.getLocationConfigValue(locationCode, 'ALLOW_BOWSER_REOPEN', 'N');
                hasPermission = allow === 'Y';
            }
            if (!hasPermission) {
                return res.status(403).json({ success: false, error: 'You do not have permission to reopen bowser closings.' });
            }

            await BowserDao.reopenBowserClosing(req.params.id, String(req.user.Person_id));
            res.json({ success: true, message: 'Bowser closing reopened.' });
        } catch (err) {
            console.error('reopenClosing error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    deleteClosing: async (req, res) => {
        try {
            await BowserDao.deleteBowserClosing(req.params.id);
            res.json({ success: true, message: 'Bowser closing deleted.' });
        } catch (err) {
            const status = err.statusCode || 500;
            console.error('deleteClosing error:', err);
            res.status(status).json({ success: false, error: err.message });
        }
    }
};
