// services/platform-billing-service.js
//
// PetroMath's own subscription invoicing + payment tracking, per location.
// Not to be confused with fuel/oil-company billing (Day Bill, tank invoices).
//
const dateFormat = require('dateformat');
const PlatformBillingDao = require('../dao/platform-billing-dao');
const DistributorService = require('./distributor-service');

const DUE_DAYS_AFTER_GENERATION = 5; // payment is usually received within 5 days of the invoice being generated

const MAX_CATCH_UP_MONTHS = 12; // gap-filling never reaches further back than this

/**
 * Generate every invoice that is due today, for every location with a
 * billing plan in force — what the scheduler runs, and what "Bill everything
 * due" on the invoice page runs.
 *
 * Each plan's billing_timing decides the latest month that is due:
 *   ARREARS — the month that just ended (billed after it's over)
 *   ADVANCE — the current month (billed at its start)
 *
 * Also fills gaps: any month between the location's first invoice and that
 * latest due month with no invoice at all (e.g. a month skipped while
 * switching timing) is billed too, at most MAX_CATCH_UP_MONTHS back. A
 * location that has never been invoiced is only billed for the latest due
 * month — its first (often part) month is billed by hand.
 *
 * @param {string} userId
 * @param {object} [options]
 * @param {string} [options.locationCode]   restrict to one location
 * @param {string} [options.today]          YYYY-MM-DD, defaults to today
 * @returns {{ generated: string[], skipped: {location_code:string, reason:string}[] }}
 */
async function generateDueInvoices(userId, options = {}) {
    const today = options.today || dateFormat(new Date(), 'yyyy-mm-dd');
    const thisMonth = monthStart(today);
    const ctx = { userId, generatedDate: today, generated: [], skipped: [] };

    const plans = await PlatformBillingDao.getActiveBillingPlansForGeneration(today, options.locationCode);
    const seen = new Set();

    for (const plan of plans) {
        if (seen.has(plan.location_code)) continue;
        seen.add(plan.location_code);

        const lastDueMonth = plan.billing_timing === 'ADVANCE' ? thisMonth : addMonths(thisMonth, -1);

        const firstInvoiceStart = await PlatformBillingDao.findFirstInvoiceStartDate(plan.location_code);
        let month = firstInvoiceStart ? monthStart(dateFormat(firstInvoiceStart, 'yyyy-mm-dd')) : lastDueMonth;
        const earliestAllowed = addMonths(lastDueMonth, -(MAX_CATCH_UP_MONTHS - 1));
        if (month < earliestAllowed) month = earliestAllowed;

        for (; month <= lastDueMonth; month = addMonths(month, 1)) {
            const isGapMonth = month < lastDueMonth;
            await generateForLocationMonth(plan.location_code, month, ctx, {
                // A gap month that was billed and then cancelled stays
                // cancelled — only a month with no invoice at all is filled.
                includeCancelled: isGapMonth,
                // Already-billed / out-of-plan gap months are the normal
                // case, not worth reporting as skipped.
                reportSkips: !isGapMonth
            });
        }
    }

    return { generated: ctx.generated, skipped: ctx.skipped };
}

/**
 * Generate invoices for one specific service month (manual backfill from
 * the invoice page), regardless of billing timing. Months already billed
 * or still in trial are skipped.
 *
 * @param {string} periodStartDate  any YYYY-MM-DD inside the service month
 * @param {string} userId
 * @param {object} [options]
 * @param {string} [options.locationCode]   restrict generation to one location
 * @param {string} [options.generatedDate]  YYYY-MM-DD, defaults to today; due date is
 *                                          computed as generatedDate + 5 days, not
 *                                          relative to the period
 * @returns {{ generated: string[], skipped: {location_code:string, reason:string}[] }}
 */
async function generateInvoicesForPeriod(periodStartDate, userId, options = {}) {
    const generatedDate = options.generatedDate || dateFormat(new Date(), 'yyyy-mm-dd');
    const month = monthStart(periodStartDate);
    if (month > monthStart(generatedDate)) {
        throw new Error('Cannot bill a future month');
    }

    const ctx = { userId, generatedDate, generated: [], skipped: [] };
    const plans = await PlatformBillingDao.getActiveBillingPlansForGeneration(month, options.locationCode);
    const seen = new Set();
    for (const plan of plans) {
        if (seen.has(plan.location_code)) continue;
        seen.add(plan.location_code);
        await generateForLocationMonth(plan.location_code, month, ctx, { plan, reportSkips: true });
    }
    return { generated: ctx.generated, skipped: ctx.skipped };
}

/**
 * Create one location's invoice for the service month starting at `month`
 * (YYYY-MM-01), unless it's already billed, in trial, or has no plan in
 * force on the 1st. Results are pushed onto ctx.generated / ctx.skipped.
 */
async function generateForLocationMonth(locationCode, month, ctx, opts = {}) {
    const skip = (reason) => { if (opts.reportSkips) ctx.skipped.push({ location_code: locationCode, reason }); };
    try {
        const plan = opts.plan
            || (await PlatformBillingDao.getActiveBillingPlansForGeneration(month, locationCode))[0];
        if (!plan) {
            skip(`No billing plan in force on ${month}`);
            return;
        }

        if (plan.trial_end_date && month < dateFormat(plan.trial_end_date, 'yyyy-mm-dd')) {
            skip('In trial period');
            return;
        }

        const covering = await PlatformBillingDao.findOverlappingInvoice(
            locationCode, month, addMonths(month, 1, -1), opts.includeCancelled);
        if (covering) {
            skip(`Already covered by invoice ${covering.invoice_number}`);
            return;
        }

        const periodEndDate = addMonths(month, plan.plan_duration_months, -1);

        const gross = Number(plan.plan_rate) || 0;
        const discount = computeDiscount(gross, plan.discount_type, plan.discount_value);
        const net = Math.max(0, gross - discount);

        const invoiceNumber = buildInvoiceNumber(locationCode, month);

        const items = [{
            description: plan.plan_duration_months >= 12 ? 'PetroMath platform subscription (Annual)' : 'PetroMath platform subscription (Monthly)',
            amount: gross
        }];
        if (discount > 0) {
            items.push({ description: 'Discount', amount: -discount });
        }

        await PlatformBillingDao.createInvoice({
            location_code: locationCode,
            invoice_number: invoiceNumber,
            period_start_date: month,
            period_end_date: periodEndDate,
            gross_amount: gross,
            discount_amount: discount,
            net_amount: net,
            due_date: addDays(ctx.generatedDate, DUE_DAYS_AFTER_GENERATION),
            status: net <= 0 ? 'PAID' : 'UNPAID',
            generated_date: ctx.generatedDate,
            created_by: ctx.userId,
            creation_date: new Date(),
            updated_by: ctx.userId,
            updation_date: new Date()
        }, items);

        ctx.generated.push(invoiceNumber);
    } catch (err) {
        console.error(`PlatformBillingService: failed to generate invoice for ${locationCode} ${month}:`, err);
        ctx.skipped.push({ location_code: locationCode, reason: 'Error: ' + err.message });
    }
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

/**
 * Update a location's billing plan (rate/discount/duration). Closes out the
 * current open-ended plan the day before newStartDate and inserts a new
 * one — same effective-dated pattern as m_location_config, so historical
 * invoices keep referencing the rate that was actually in force.
 */
async function updateBillingPlan(planData, userId) {
    const dayBefore = addDays(planData.effective_start_date, -1);
    await PlatformBillingDao.closeBillingPlan(planData.location_code, dayBefore);
    return PlatformBillingDao.upsertBillingPlan({
        location_code: planData.location_code,
        plan_duration_months: planData.plan_duration_months || 1,
        billing_timing: planData.billing_timing === 'ADVANCE' ? 'ADVANCE' : 'ARREARS',
        plan_rate: planData.plan_rate,
        discount_type: planData.discount_type || 'NONE',
        discount_value: planData.discount_value || 0,
        trial_end_date: planData.trial_end_date || null,
        effective_start_date: planData.effective_start_date,
        effective_end_date: '9999-12-31',
        remarks: planData.remarks || null,
        created_by: userId,
        creation_date: new Date(),
        updated_by: userId,
        updation_date: new Date()
    });
}

/**
 * Add a one-off adjustment line to an already-generated invoice (e.g. a
 * goodwill credit for one month). amount is signed: negative = discount,
 * positive = extra charge. Recalculates invoice status afterward since the
 * net amount — and therefore what counts as fully paid — changes.
 */
async function addInvoiceAdjustment(invoiceId, description, amount, userId) {
    await PlatformBillingDao.addInvoiceAdjustment(invoiceId, description, amount, userId);
    await recalculateInvoiceStatus(invoiceId, userId);
}

/** Chronological ledger for a location with a running balance. */
async function getLocationLedger(locationCode) {
    const rows = await PlatformBillingDao.getLedgerForLocation(locationCode);
    let balance = 0;
    return rows.map(r => {
        balance += r.entry_type === 'INVOICE' ? Number(r.amount) : -Number(r.amount);
        return { ...r, balance };
    });
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

// Day-1 dates only, so setMonth never overflows into the next month
function addMonths(dateStr, months, plusDays = 0) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setMonth(d.getMonth() + months);
    d.setDate(d.getDate() + plusDays);
    return dateFormat(d, 'yyyy-mm-dd');
}

function monthStart(dateStr) {
    return dateStr.slice(0, 7) + '-01';
}

module.exports = {
    generateDueInvoices,
    generateInvoicesForPeriod,
    recordPayment,
    recordBulkPayment,
    updateBillingPlan,
    addInvoiceAdjustment,
    getLocationLedger,
    recalculateInvoiceStatus
};
