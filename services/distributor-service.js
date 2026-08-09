// services/distributor-service.js
//
// Distributor commission on platform billing revenue (e.g. Gobinath gets
// 50% of what AACBE pays PetroMath). Mirrors platform-billing-service's
// payment/allocation shape: here it's commission (owed) -> payout -> allocation.
//
const DistributorDao = require('../dao/distributor-dao');

/**
 * Called after a platform payment is recorded. If the paying location has
 * an active distributor assignment as of the payment date, creates a
 * PENDING commission entry for that distributor. No-op otherwise.
 */
async function maybeCreateCommission(payment) {
    const assignment = await DistributorDao.getActiveAssignment(payment.location_code, payment.payment_date);
    if (!assignment) return null;

    const paymentAmount = Number(payment.amount);
    const commissionPercent = Number(assignment.commission_percent);
    const commissionAmount = Math.round((paymentAmount * commissionPercent / 100) * 100) / 100;

    return DistributorDao.createCommission({
        payment_id: payment.payment_id,
        distributor_id: assignment.distributor_id,
        location_code: payment.location_code,
        payment_amount: paymentAmount,
        commission_percent: commissionPercent,
        commission_amount: commissionAmount,
        status: 'PENDING',
        created_by: payment.created_by,
        creation_date: new Date()
    });
}

/**
 * Record a payout to a distributor. If `commissionIds` is given, allocate
 * manually to those commissions (equally split across the amount isn't
 * assumed — caller must pass allocated_amount per commission); otherwise
 * auto-allocate the lump sum across the distributor's oldest PENDING
 * commissions first, same pattern as platform billing's bulk payment.
 */
async function recordPayout(payoutData, allocations) {
    let finalAllocations = allocations;

    if (!Array.isArray(allocations) || !allocations.length) {
        const pending = await DistributorDao.findPendingCommissionsForDistributor(payoutData.distributor_id);
        let remaining = Number(payoutData.amount);
        finalAllocations = [];
        for (const c of pending) {
            if (remaining <= 0) break;
            const alreadyAllocated = Number(await DistributorDao.getAllocatedAmountForCommission(c.commission_id)) || 0;
            const balance = Number(c.commission_amount) - alreadyAllocated;
            if (balance <= 0) continue;
            const applied = Math.min(balance, remaining);
            finalAllocations.push({ commission_id: c.commission_id, allocated_amount: applied });
            remaining -= applied;
        }
    }

    const totalAllocated = finalAllocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
    if (totalAllocated > Number(payoutData.amount) + 0.01) {
        throw new Error('Allocated amount exceeds payout amount');
    }

    const payout = await DistributorDao.createPayout(payoutData, finalAllocations);

    for (const a of finalAllocations) {
        await recalculateCommissionStatus(a.commission_id);
    }

    return payout;
}

async function recalculateCommissionStatus(commissionId) {
    const commission = await DistributorDao.findCommissionById(commissionId);
    if (!commission) return;
    const allocated = Number(await DistributorDao.getAllocatedAmountForCommission(commissionId)) || 0;
    const status = allocated >= Number(commission.commission_amount) ? 'PAID' : 'PENDING';
    await DistributorDao.updateCommissionStatus(commissionId, status);
}

module.exports = {
    maybeCreateCommission,
    recordPayout,
    recalculateCommissionStatus
};
