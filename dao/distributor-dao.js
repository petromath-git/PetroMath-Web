// dao/distributor-dao.js
const db = require("../db/db-connection");
const { Op, QueryTypes } = require("sequelize");

const DistributorDao = {

    // ─── Distributors ──────────────────────────────────────────────────────

    findAll: () => {
        return db.distributor.findAll({ order: [['distributor_name', 'ASC']] });
    },

    create: (data) => {
        return db.distributor.create(data);
    },

    // ─── Location assignments ──────────────────────────────────────────────

    // Active distributor assignment for a location as of a given date
    getActiveAssignment: (locationCode, asOfDate) => {
        return db.sequelize.query(
            `SELECT ld.assignment_id, ld.location_code, ld.distributor_id, ld.commission_percent,
                    d.distributor_name
             FROM m_location_distributor ld
             JOIN m_distributor d ON d.distributor_id = ld.distributor_id
             WHERE ld.location_code = :locationCode
               AND :asOfDate BETWEEN ld.effective_start_date AND ld.effective_end_date
             ORDER BY ld.effective_start_date DESC
             LIMIT 1`,
            {
                replacements: { locationCode, asOfDate },
                type: QueryTypes.SELECT
            }
        ).then(rows => rows[0] || null);
    },

    createAssignment: (data) => {
        return db.location_distributor.create(data);
    },

    findAllAssignments: () => {
        return db.sequelize.query(
            `SELECT ld.assignment_id, ld.location_code, l.location_name, ld.distributor_id,
                    d.distributor_name, ld.commission_percent, ld.effective_start_date, ld.effective_end_date
             FROM m_location_distributor ld
             JOIN m_distributor d ON d.distributor_id = ld.distributor_id
             JOIN m_location l ON l.location_code = ld.location_code
             ORDER BY d.distributor_name, ld.location_code`,
            { type: QueryTypes.SELECT }
        );
    },

    // ─── Commissions ────────────────────────────────────────────────────────

    createCommission: (data) => {
        return db.distributor_commission.create(data);
    },

    findCommissionById: (commissionId) => {
        return db.distributor_commission.findOne({ where: { commission_id: commissionId } });
    },

    findCommissionsForDistributor: (distributorId) => {
        return db.distributor_commission.findAll({
            where: { distributor_id: distributorId },
            order: [['creation_date', 'DESC']]
        });
    },

    findPendingCommissionsForDistributor: (distributorId) => {
        return db.distributor_commission.findAll({
            where: { distributor_id: distributorId, status: 'PENDING' },
            order: [['creation_date', 'ASC']]
        });
    },

    getAllocatedAmountForCommission: (commissionId) => {
        return db.distributor_payout_allocation.sum('allocated_amount', {
            where: { commission_id: commissionId }
        });
    },

    updateCommissionStatus: (commissionId, status) => {
        return db.distributor_commission.update({ status }, { where: { commission_id: commissionId } });
    },

    findAllCommissions: () => {
        return db.sequelize.query(
            `SELECT tc.commission_id, tc.location_code, l.location_name, tc.distributor_id, d.distributor_name,
                    tc.payment_amount, tc.commission_percent, tc.commission_amount, tc.status, tc.creation_date,
                    COALESCE((SELECT SUM(a.allocated_amount) FROM t_distributor_payout_allocation a WHERE a.commission_id = tc.commission_id), 0) AS paid_amount
             FROM t_distributor_commission tc
             JOIN m_distributor d ON d.distributor_id = tc.distributor_id
             JOIN m_location l ON l.location_code = tc.location_code
             ORDER BY tc.creation_date DESC`,
            { type: QueryTypes.SELECT }
        );
    },

    // ─── Payouts ────────────────────────────────────────────────────────────

    createPayout: (payoutData, allocations) => {
        return db.sequelize.transaction(async (t) => {
            const payout = await db.distributor_payout.create(payoutData, { transaction: t });
            const rows = allocations.map(a => ({
                payout_id: payout.payout_id,
                commission_id: a.commission_id,
                allocated_amount: a.allocated_amount,
                created_by: payoutData.created_by,
                creation_date: new Date()
            }));
            await db.distributor_payout_allocation.bulkCreate(rows, { transaction: t });
            return payout;
        });
    },

    findPayoutsForDistributor: (distributorId) => {
        return db.distributor_payout.findAll({
            where: { distributor_id: distributorId },
            order: [['payout_date', 'DESC']]
        });
    },

    // Chronological ledger for one distributor: commissions (owed) + payouts (paid)
    getLedgerForDistributor: (distributorId) => {
        return db.sequelize.query(
            `SELECT 'COMMISSION' AS entry_type, commission_id AS entry_id, creation_date AS entry_date,
                    CONCAT(location_code, ' - ', commission_percent, '%') AS reference, commission_amount AS amount, status
             FROM t_distributor_commission WHERE distributor_id = :distributorId
             UNION ALL
             SELECT 'PAYOUT' AS entry_type, payout_id AS entry_id, payout_date AS entry_date,
                    CONCAT(payment_mode, COALESCE(CONCAT(' - ', reference_number), '')) AS reference, amount, 'PAID' AS status
             FROM t_distributor_payout WHERE distributor_id = :distributorId
             ORDER BY entry_date, entry_type DESC`,
            { replacements: { distributorId }, type: QueryTypes.SELECT }
        );
    }
};

module.exports = DistributorDao;
