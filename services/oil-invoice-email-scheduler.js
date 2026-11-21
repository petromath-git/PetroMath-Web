// services/oil-invoice-email-scheduler.js — IOCL Invoices email import (tkt #484).
// Every hour at :25 from 07:25 to 22:25 IST, reads each active mailbox (m_oil_invoice_mailbox) and
// imports the IOCL charge invoices in it — see services/oil-invoice-email-service.js.
// Only on the prod server (.env ENVIRONMENT=prod); on beta use "Check now" on /oil-invoices?tab=email.
// A mailbox whose login failed is skipped until its App Password is saved again.
const cron = require('node-cron');
const service = require('./oil-invoice-email-service');

const CRON_EXPRESSION = '25 7-22 * * *';
let run = null;

function runNow(trigger) {
    if (run) return run;
    run = service.runAll(trigger)
        .catch(err => console.error('OilInvoiceEmail: run failed:', err.message))
        .finally(() => { run = null; });
    return run;
}

function start() {
    if (process.env.ENVIRONMENT !== 'prod') {
        console.log(`OilInvoiceEmail: hourly mailbox import OFF (ENVIRONMENT=${process.env.ENVIRONMENT || 'unset'}, runs only on prod)`);
        return;
    }
    cron.schedule(CRON_EXPRESSION, () => runNow('SCHEDULED'), { timezone: 'Asia/Kolkata' });
    console.log(`OilInvoiceEmail: scheduled (${CRON_EXPRESSION} IST)`);
}

module.exports = { start, runNow };
