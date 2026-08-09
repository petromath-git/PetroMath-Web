// services/platform-billing-scheduler.js
//
// Automatic monthly invoice generation, matching the real invoicing
// cadence (invoices raised a few days into the following month, not on
// day 1) — see platform-billing-service's due-date policy for the same
// reasoning. Runs once at process start against the previous month too,
// in case a scheduled run was missed while the app was down.
//
const cron = require('node-cron');
const dateFormat = require('dateformat');
const PlatformBillingService = require('./platform-billing-service');

const CRON_EXPRESSION = '0 6 3 * *'; // 06:00 on the 3rd of every month

function previousMonthStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    return dateFormat(d, 'yyyy-mm-dd');
}

// The scheduled cron only ever fires on day 3, so this guard only matters
// for the boot-time catch-up call below — without it, a restart on the
// 1st or 2nd would generate last month's invoices two days early (wrong
// generated/due dates relative to the real invoicing cadence).
function dueGenerationPeriod(now) {
    if (now.getDate() < 3) return null;
    return previousMonthStart(now);
}

async function runAutoGeneration() {
    const periodStartDate = dueGenerationPeriod(new Date());
    if (!periodStartDate) {
        console.log('PlatformBillingScheduler: not due yet this month (before the 3rd), skipping');
        return;
    }
    console.log(`PlatformBillingScheduler: auto-generating invoices for period ${periodStartDate}`);
    try {
        const result = await PlatformBillingService.generateInvoicesForPeriod(periodStartDate, 'system-cron');
        console.log(`PlatformBillingScheduler: generated=${result.generated.length} skipped=${result.skipped.length}`);
    } catch (err) {
        console.error('PlatformBillingScheduler: auto-generation failed:', err);
    }
}

function start() {
    cron.schedule(CRON_EXPRESSION, runAutoGeneration);
    console.log(`PlatformBillingScheduler: scheduled (${CRON_EXPRESSION})`);

    // Catch-up run at boot: generation is idempotent (skips locations
    // already invoiced for the period), so this is safe to run on every
    // restart — it just closes the gap if the server was down when the
    // scheduled run above would have fired.
    runAutoGeneration();
}

module.exports = { start, runAutoGeneration };
