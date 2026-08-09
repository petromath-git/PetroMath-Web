// controllers/distributor-controller.js
const DistributorDao = require('../dao/distributor-dao');
const DistributorSvc = require('../services/distributor-service');
const LocationDao = require('../dao/location-dao');
const dateFormat = require('dateformat');

const DistributorController = {

    // ─── GET /distributors ──────────────────────────────────────────────────
    getList: async (req, res, next) => {
        try {
            const [distributors, assignments, commissions, locations] = await Promise.all([
                DistributorDao.findAll(),
                DistributorDao.findAllAssignments(),
                DistributorDao.findAllCommissions(),
                LocationDao.findActiveLocations()
            ]);

            res.render('platform-billing/distributors', {
                title: 'Distributor Payables',
                distributors,
                assignments,
                commissions,
                locations,
                today: dateFormat(new Date(), 'yyyy-mm-dd'),
                user: req.user
            });
        } catch (err) {
            next(err);
        }
    },

    // ─── POST /distributors ─────────────────────────────────────────────────
    createDistributor: async (req, res) => {
        try {
            const { distributor_name, phone, effective_start_date, remarks } = req.body;
            if (!distributor_name || !effective_start_date) {
                return res.status(400).json({ error: 'distributor_name and effective_start_date are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            const created = await DistributorDao.create({
                distributor_name, phone: phone || null,
                effective_start_date, effective_end_date: '9999-12-31',
                remarks: remarks || null,
                created_by: userId, creation_date: new Date(),
                updated_by: userId, updation_date: new Date()
            });
            res.json({ success: true, distributor_id: created.distributor_id });
        } catch (err) {
            console.error('DistributorController.createDistributor:', err);
            res.status(500).json({ error: 'Failed to create distributor' });
        }
    },

    // ─── POST /distributors/assignments ─────────────────────────────────────
    createAssignment: async (req, res) => {
        try {
            const { location_code, distributor_id, commission_percent, effective_start_date } = req.body;
            if (!location_code || !distributor_id || !commission_percent || !effective_start_date) {
                return res.status(400).json({ error: 'location_code, distributor_id, commission_percent and effective_start_date are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            await DistributorDao.createAssignment({
                location_code, distributor_id, commission_percent,
                effective_start_date, effective_end_date: '9999-12-31',
                created_by: userId, creation_date: new Date(),
                updated_by: userId, updation_date: new Date()
            });
            res.json({ success: true });
        } catch (err) {
            console.error('DistributorController.createAssignment:', err);
            res.status(500).json({ error: 'Failed to create assignment' });
        }
    },

    // ─── GET /distributors/:id/pending-commissions ──────────────────────────
    getPendingCommissions: async (req, res) => {
        try {
            const commissions = await DistributorDao.findPendingCommissionsForDistributor(req.params.id);
            res.json({ success: true, commissions });
        } catch (err) {
            console.error('DistributorController.getPendingCommissions:', err);
            res.status(500).json({ error: 'Failed to fetch pending commissions' });
        }
    },

    // ─── POST /distributors/payouts ─────────────────────────────────────────
    recordPayout: async (req, res) => {
        try {
            const { distributor_id, payout_date, amount, payment_mode, reference_number, remarks, allocations } = req.body;
            if (!distributor_id || !amount || !payout_date) {
                return res.status(400).json({ error: 'distributor_id, payout_date and amount are required' });
            }
            const userId = req.user.User_Name || req.user.Person_Name;
            const payout = await DistributorSvc.recordPayout({
                distributor_id, payout_date, amount,
                payment_mode: payment_mode || 'MANUAL_CASH',
                reference_number: reference_number || null,
                remarks: remarks || null,
                created_by: userId,
                creation_date: new Date(),
                updated_by: userId,
                updation_date: new Date()
            }, allocations || []);
            res.json({ success: true, payout_id: payout.payout_id });
        } catch (err) {
            console.error('DistributorController.recordPayout:', err);
            res.status(500).json({ error: err.message || 'Failed to record payout' });
        }
    }
};

module.exports = DistributorController;
