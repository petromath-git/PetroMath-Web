// services/platform-billing-scheduler.js
//
// Automatic monthly invoice generation on the 3rd of every month. Which
// month each location is billed for depends on its plan's billing_timing
// (ARREARS = month just ended, ADVANCE = current month) — see
// PlatformBillingService.generateDueInvoices, which also fills any month
// that was skipped. Runs once at process start too, in case a scheduled
// run was missed while the app was down. Every run is recorded in the run
// log (/platform-billing/runs).
//
const cron = require('node-cron');
const PlatformBillingService = require('./platform-billing-service');

const CRON_EXPRESSION = '0 6 3 * *'; // 06:00 on the 3rd of every month
const GENERATION_DAY = 3;

// The scheduled cron only ever fires on day 3, so this guard only matters
// for the boot-time catch-up call below — without it, a restart on the
// 1st or 2nd would raise this month's invoices early (wrong generated/due
// dates relative to the real invoicing cadence).
function isGenerationDue(now) {
    return now.getDate() >= GENERATION_DAY;
}

async function runAutoGeneration(triggerType) {
    if (!isGenerationDue(new Date())) {
        console.log(`PlatformBillingScheduler: not due yet this month (before the ${GENERATION_DAY}rd), skipping`);
        return;
    }
    console.log(`PlatformBillingScheduler: auto-generating due invoices (${triggerType})`);
    try {
        const result = await PlatformBillingService.runGeneration({
            triggerType,
            requestedBy: 'system-cron',
            mode: 'DUE',
            // The startup catch-up runs on every restart — only keep its
            // log row when it actually billed something or hit an error
            logOnlyIfActive: triggerType === 'STARTUP'
        });
        console.log(`PlatformBillingScheduler: ${result.status} generated=${result.generated.length} skipped=${result.skipped.length}`
            + (result.generated.length ? ` (${result.generated.join(', ')})` : ''));
    } catch (err) {
        console.error('PlatformBillingScheduler: auto-generation failed:', err);
    }
}

function start() {
    cron.schedule(CRON_EXPRESSION, () => runAutoGeneration('SCHEDULED'));
    console.log(`PlatformBillingScheduler: scheduled (${CRON_EXPRESSION})`);

    // Catch-up run at boot: generation is idempotent (skips months already
    // invoiced), so this is safe to run on every restart — it just closes
    // the gap if the server was down when the scheduled run above would
    // have fired.
    runAutoGeneration('STARTUP');
}

module.exports = { start, runAutoGeneration, GENERATION_DAY };
