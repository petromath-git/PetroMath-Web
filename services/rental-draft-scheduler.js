// services/rental-draft-scheduler.js
//
// 07:00 IST every day: for each location with rental invoices set up, if today is
// its invoice day (Settings → Invoice day, capped to the month end), create this
// month's rent drafts — the same as pressing "Create drafts" — and send a phone
// notification to the location's admins: "MC: 3 rent drafts for October ready".
// Finalising stays manual (it takes the invoice number and can't be undone).
//
// Runs only on prod (ENVIRONMENT=prod), so beta / standby copies don't create
// drafts. Re-running the same day is harmless: tenants that already have a draft
// for the month are skipped, and t_push_log (key "<LOC>:RENT") stops a second
// notification. The phone notification also needs PUSH_REMINDERS_ENABLED=Y.
const cron = require('node-cron');
const moment = require('moment');
const RentalDao = require('../dao/rental-dao');
const RentalService = require('./rental-service');
const PushDao = require('../dao/push-subscription-dao');
const pushService = require('./push-service');

const CRON_EXPRESSION = '0 7 * * *';   // 07:00 IST
const CATCH_UP_UNTIL_HOUR = 20;        // restarted after 7 AM on the day: still run
const CREATED_BY = 'SCHEDULER';

const pushEnabled = () => process.env.PUSH_REMINDERS_ENABLED === 'Y' && pushService.isConfigured();

function isInvoiceDay(today, invoiceDay) {
    const day = Math.min(Number(invoiceDay) || 26, today.daysInMonth());
    return today.date() === day;
}

async function notify(locationCode, ym, created) {
    if (!pushEnabled() || !created.length) return 0;
    const total = created.reduce((s, c) => s + Number(c.total_amount), 0);
    const monthName = RentalService.MONTHS[Number(ym.split('-')[1]) - 1];
    const payload = {
        title: `${locationCode}: ${created.length} rent draft${created.length > 1 ? 's' : ''} for ${monthName[0]}${monthName.slice(1).toLowerCase()} ready`,
        body: `₹${total.toLocaleString('en-IN')} — ${created.map(c => c.tenant_name).join(', ')}. Review and finalise.`.slice(0, 500),
        url: `/rental?month=${ym}`,
        tag: `rental-${locationCode}-${ym}`,
    };
    const digestDate = moment().utcOffset(330).format('YYYY-MM-DD');
    const subs = await PushDao.findAdminSubscriptionsForLocation(locationCode);
    let sent = 0;
    for (const sub of subs) {
        const logId = await PushDao.claimDigest(digestDate, `${locationCode}:RENT`, sub, payload.title, payload.body);
        if (!logId) continue;
        const result = await pushService.sendTo(sub, payload);
        await PushDao.finishLog(logId, result.status, result.error);
        if (result.status === 'SENT') sent++;
    }
    return sent;
}

let running = null;

async function runInvoiceDay(trigger) {
    if (running) return running;
    running = (async () => {
        const today = moment().utcOffset(330);
        const ym = today.format('YYYY-MM');
        try {
            const locations = await RentalDao.getAllSettings();
            for (const { location_code, invoice_day } of locations) {
                if (!isInvoiceDay(today, invoice_day)) continue;
                try {
                    const created = await RentalService.createDraftsForMonth(location_code, ym, CREATED_BY);
                    const sent = await notify(location_code, ym, created);
                    console.log(`RentalDrafts: ${trigger} ${location_code} ${ym} — ${created.length} draft(s), ${sent} notification(s)`);
                } catch (err) {
                    console.error(`RentalDrafts: ${location_code} failed:`, err.message);
                }
            }
        } catch (err) {
            console.error('RentalDrafts: run failed:', err);
        } finally {
            running = null;
        }
    })();
    return running;
}

function start() {
    if (process.env.ENVIRONMENT !== 'prod') {
        console.log('RentalDrafts: off (prod only)');
        return;
    }
    cron.schedule(CRON_EXPRESSION, () => runInvoiceDay('SCHEDULED'), { timezone: 'Asia/Kolkata' });
    console.log(`RentalDrafts: scheduled (${CRON_EXPRESSION} IST)`);

    const hour = moment().utcOffset(330).hour();
    if (hour >= 7 && hour < CATCH_UP_UNTIL_HOUR) {
        setTimeout(() => runInvoiceDay('STARTUP'), 90 * 1000);
    }
}

module.exports = { start, runInvoiceDay };
