// services/deadline-reminder-scheduler.js
//
// 09:00 every morning: one phone notification per location to that location's
// admin-type users (Manager, Admin, PowerUser, SuperUser) who turned reminders on.
// "SFS: 1 overdue, 3 due soon" + the first few names; tapping opens /deadline.
//
// A location gets a reminder that day when something is overdue, or an open
// item is exactly remind_days / 7 / 3 / 1 / 0 days from its due date — so a
// 30-day window gives a heads-up, then 7, 3, 1, due day, then daily while overdue,
// instead of the same message every day for a month.
//
// Runs only when PUSH_REMINDERS_ENABLED=Y in .env (keep it off on copies of prod,
// e.g. the Mumbai standby, so phones don't get two of everything) and the VAPID
// keys are set (see push-service.js). t_push_log stops a second send the same day.
const cron = require('node-cron');
const moment = require('moment');
const DeadlineDao = require('../dao/deadline-dao');
const PushDao = require('../dao/push-subscription-dao');
const pushService = require('./push-service');

const CRON_EXPRESSION = '0 9 * * *';   // 09:00 IST
const MILESTONE_DAYS = [7, 3, 1, 0];
const MAX_NAMES = 3;
const CATCH_UP_UNTIL_HOUR = 20;        // restart after 9 AM: still send, but not late at night

const enabled = () => process.env.PUSH_REMINDERS_ENABLED === 'Y' && pushService.isConfigured();

function isMilestone(item) {
    const d = Number(item.days_left);
    if (d < 0) return true;
    return d === Number(item.remind_days) || MILESTONE_DAYS.includes(d);
}

function shortDue(d) {
    if (d < 0) return `overdue ${-d}d`;
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    return `in ${d}d`;
}

// Builds the notification for a location, or null when nothing hits a milestone today
async function buildDigest(locationCode, { force = false } = {}) {
    const items = await DeadlineDao.findAttentionItems(locationCode);
    if (!items.length || (!force && !items.some(isMilestone))) return null;

    const overdue = items.filter(i => Number(i.days_left) < 0).length;
    const soon = items.length - overdue;
    const parts = [];
    if (overdue) parts.push(`${overdue} overdue`);
    if (soon) parts.push(`${soon} due soon`);

    const names = items.slice(0, MAX_NAMES).map(i =>
        `${i.title}${i.reference_no ? ' ' + i.reference_no : ''} (${shortDue(Number(i.days_left))})`);
    if (items.length > MAX_NAMES) names.push(`+${items.length - MAX_NAMES} more`);

    return {
        title: `${locationCode}: ${parts.join(', ')}`,
        body: names.join(' · '),
        url: `/deadline?loc=${encodeURIComponent(locationCode)}`,
        tag: `deadline-${locationCode}`,   // replaces yesterday's reminder instead of stacking
    };
}

async function sendLocationDigest(locationCode, digestDate) {
    const digest = await buildDigest(locationCode);
    if (!digest) return { sent: 0, skipped: true };
    const subs = await PushDao.findAdminSubscriptionsForLocation(locationCode);
    let sent = 0;
    for (const sub of subs) {
        const logId = await PushDao.claimDigest(digestDate, locationCode, sub, digest.title, digest.body);
        if (!logId) continue;   // already sent today
        const result = await pushService.sendTo(sub, digest);
        await PushDao.finishLog(logId, result.status, result.error);
        if (result.status === 'SENT') sent++;
    }
    return { sent, phones: subs.length };
}

let running = null;

async function runDigest(trigger) {
    if (!enabled()) return null;
    if (running) return running;
    running = (async () => {
        const digestDate = moment().format('YYYY-MM-DD');
        try {
            const locations = await DeadlineDao.findLocationsNeedingAttention();
            let total = 0;
            for (const { location_code } of locations) {
                try {
                    const r = await sendLocationDigest(location_code, digestDate);
                    total += r.sent;
                } catch (err) {
                    console.error(`DeadlineReminders: ${location_code} failed:`, err.message);
                }
            }
            console.log(`DeadlineReminders: ${trigger} ${digestDate} — ${locations.length} location(s), ${total} sent`);
        } catch (err) {
            console.error('DeadlineReminders: run failed:', err);
        } finally {
            running = null;
        }
    })();
    return running;
}

function start() {
    if (!enabled()) {
        console.log('DeadlineReminders: off (needs PUSH_REMINDERS_ENABLED=Y and VAPID keys)');
        return;
    }
    cron.schedule(CRON_EXPRESSION, () => runDigest('SCHEDULED'), { timezone: 'Asia/Kolkata' });
    console.log(`DeadlineReminders: scheduled (${CRON_EXPRESSION} IST)`);

    // Restarted after 9 AM: send today's if it hasn't gone (t_push_log skips phones already sent)
    const hour = moment().utcOffset(330).hour();
    if (hour >= 9 && hour < CATCH_UP_UNTIL_HOUR) {
        setTimeout(() => runDigest('STARTUP'), 60 * 1000);
    }
}

module.exports = { start, runDigest, buildDigest };
