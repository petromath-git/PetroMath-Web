// services/platform-billing-service.js
//
// PetroMath's own subscription invoicing + payment tracking, per location.
// Not to be confused with fuel/oil-company billing (Day Bill, tank invoices).
//
const dateFormat = require('dateformat');
const PlatformBillingDao = require('../dao/platform-billing-dao');
const DistributorService = require('./distributor-service');

const DUE_DAYS_AFTER_GENERATION = 5; // payment is usually received within 5 days of the invoice being generated

/**
 * Generate platform invoices for every active, non-trial location whose
 * billing plan isn't already covered by a prior invoice (e.g. an annual
 * plan already covers this month).
 *
 * @param {string} periodStartDate  YYYY-MM-DD, first of the billing month
 * @param {string} userId
 * @param {object} [options]
 * @param {string} [options.locationCode]   restrict generation to one location
 * @param {string} [options.generatedDate]  YYYY-MM-DD, defaults to today; due date is
 *                                          computed as generatedDate + 5 days, not
 *                                          relative to the period — invoices are
 *                                          typically raised a few days into the
 *                                          following month, not on day 1 of the period
 * @returns {{ generated: string[], skipped: {location_code:string, reason:string}[] }}
 */
async function generateInvoicesForPeriod(periodStartDate, userId, options = {}) {
    const generatedDate = options.generatedDate || dateFormat(new Date(), 'yyyy-mm-dd');
    const dueDate = addDays(generatedDate, DUE_DAYS_AFTER_GENERATION);

    const plans = await PlatformBillingDao.getActiveBillingPlansForGeneration(periodStartDate, options.locationCode);
    const generated = [];
    const skipped = [];

    for (const plan of plans) {
        try {
            if (plan.trial_end_date && periodStartDate < dateFormat(plan.trial_end_date, 'yyyy-mm-dd')) {
                skipped.push({ location_code: plan.location_code, reason: 'In trial period' });
                continue;
            }

            const covering = await PlatformBillingDao.findCoveringInvoice(plan.location_code, periodStartDate);
            if (covering) {
                skipped.push({ location_code: plan.location_code, reason: `Already covered by invoice ${covering.invoice_number}` });
                continue;
            }

            const periodEndDate = addMonthsMinusOneDay(periodStartDate, plan.plan_duration_months);

            const gross = Number(plan.plan_rate) || 0;
            const discount = computeDiscount(gross, plan.discount_type, plan.discount_value);
            const net = Math.max(0, gross - discount);

            const invoiceNumber = buildInvoiceNumber(plan.location_code, periodStartDate);

            const items = [{
                description: plan.plan_duration_months >= 12 ? 'PetroMath platform subscription (Annual)' : 'PetroMath platform subscription (Monthly)',
                amount: gross
            }];
            if (discount > 0) {
                items.push({ description: 'Discount', amount: -discount });
            }

            await PlatformBillingDao.createInvoice({
                location_code: plan.location_code,
                invoice_number: invoiceNumber,
                period_start_date: periodStartDate,
                period_end_date: periodEndDate,
                gross_amount: gross,
                discount_amount: discount,
                net_amount: net,
                due_date: dueDate,
                status: net <= 0 ? 'PAID' : 'UNPAID',
                generated_date: generatedDate,
                created_by: userId,
                creation_date: new Date(),
                updated_by: userId,
                updation_date: new Date()
            }, items);

            generated.push(invoiceNumber);
        } catch (err) {
            console.error(`PlatformBillingService: failed to generate invoice for ${plan.location_code}:`, err);
            skipped.push({ location_code: plan.location_code, reason: 'Error: ' + err.message });
        }
    }

    return { generated, skipped };
}

/**
 * Record a payment and allocate it across invoices.
 * @param {object} payment  { location_code, payment_date, amount, payment_mode, reference_number, remarks, created_by }
 * @param {{invoice_id:number, allocated_amount:number}[]} allocations  explicit allocation (manual mode)
 */
async function recordPayment(payment, allocations) {
    const totalAllocated = allocations.reduce((s, a) => s + Number(a.allocated_amount), 0);
    if (totalAllocated > Number(payment.amount) + 0.01) {
        throw new Error('Allocated amount exceeds payment amount');
    }

    const created = await PlatformBillingDao.createPayment({
        location_code: payment.location_code,
        payment_date: payment.payment_date,
        amount: payment.amount,
        payment_mode: payment.payment_mode || 'MANUAL_CASH',
        reference_number: payment.reference_number || null,
        status: 'CONFIRMED',
        remarks: payment.remarks || null,
        created_by: payment.created_by,
        creation_date: new Date(),
        updated_by: payment.created_by,
        updation_date: new Date()
    }, allocations);

    for (const a of allocations) {
        await recalculateInvoiceStatus(a.invoice_id, payment.created_by);
    }

    // If this location has an active distributor assignment, this creates
    // the commission entry owed to that distributor. No-op otherwise.
    await DistributorService.maybeCreateCommission({
        payment_id: created.payment_id,
        location_code: payment.location_code,
        payment_date: payment.payment_date,
        amount: payment.amount,
        created_by: payment.created_by
    });

    return created;
}

/**
 * Bulk payment: given a lump sum for a location, auto-allocate it across
 * that location's outstanding invoices oldest-first until exhausted.
 * This is the "pay for several months/invoices in one go" path.
 */
async function recordBulkPayment(payment) {
    const outstanding = await PlatformBillingDao.findOutstandingInvoicesForLocation(payment.location_code);
    let remaining = Number(payment.amount);
    const allocations = [];

    for (const inv of outstanding) {
        if (remaining <= 0) break;
        const alreadyPaid = Number(await PlatformBillingDao.getAllocatedAmount(inv.invoice_id)) || 0;
        const balance = Number(inv.net_amount) - alreadyPaid;
        if (balance <= 0) continue;
        const applied = Math.min(balance, remaining);
        allocations.push({ invoice_id: inv.invoice_id, allocated_amount: applied });
        remaining -= applied;
    }

    return recordPayment(payment, allocations);
}

async function recalculateInvoiceStatus(invoiceId, userId) {
    const invoice = await PlatformBillingDao.findInvoiceById(invoiceId);
    if (!invoice) return;
    const allocated = Number(await PlatformBillingDao.getAllocatedAmount(invoiceId)) || 0;
    const net = Number(invoice.net_amount);
    let status = 'UNPAID';
    if (allocated >= net && net > 0) status = 'PAID';
    else if (allocated > 0) status = 'PARTIAL';
    else if (net <= 0) status = 'PAID';
    await PlatformBillingDao.updateInvoiceStatus(invoiceId, status, userId);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function computeDiscount(gross, discountType, discountValue) {
    const value = Number(discountValue) || 0;
    if (discountType === 'PERCENT') return Math.min(gross, gross * value / 100);
    if (discountType === 'FIXED') return Math.min(gross, value);
    return 0;
}

function buildInvoiceNumber(locationCode, periodStartDate) {
    const ym = periodStartDate.replace(/-/g, '').slice(0, 6); // YYYYMM
    return `PM-${ym}-${locationCode}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return dateFormat(d, 'yyyy-mm-dd');
}

function addMonthsMinusOneDay(dateStr, months) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMonth(d.getMonth() + months);
    d.setDate(d.getDate() - 1);
    return dateFormat(d, 'yyyy-mm-dd');
}

module.exports = {
    generateInvoicesForPeriod,
    recordPayment,
    recordBulkPayment,
    recalculateInvoiceStatus
};
