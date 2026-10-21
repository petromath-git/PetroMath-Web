// services/push-service.js — sends phone notifications (Web Push) to the installed app.
//
// Needs in .env (generate once with: npx web-push generate-vapid-keys):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: contact)
// Without the keys the "turn on reminders" card is hidden and nothing is sent.
// Keys must stay the same once phones have subscribed — new keys break every
// existing subscription (each phone would have to turn reminders on again).
const webpush = require('web-push');
const PushDao = require('../dao/push-subscription-dao');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://petromath.co.in';
const MAX_FAILURES = 10;   // drop a subscription after this many failed sends in a row

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
        configured = true;
    } catch (e) {
        console.error('PushService: VAPID keys rejected, push disabled:', e.message);
    }
}

// payload: { title, body, url, tag }. Returns 'SENT' | 'GONE' | 'FAILED' and an error text.
async function sendTo(sub, payload) {
    if (!configured) return { status: 'FAILED', error: 'Push not configured' };
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: 12 * 60 * 60 }   // phone off all day: drop it, tomorrow's reminder replaces it
        );
        await PushDao.markSuccess(sub.subscription_id);
        return { status: 'SENT' };
    } catch (err) {
        // 404/410: the phone unsubscribed, the app was removed, or browser data was cleared
        if (err.statusCode === 404 || err.statusCode === 410) {
            await PushDao.removeById(sub.subscription_id);
            return { status: 'GONE', error: `${err.statusCode}` };
        }
        await PushDao.markFailure(sub.subscription_id);
        if ((sub.fail_count || 0) + 1 >= MAX_FAILURES) await PushDao.removeById(sub.subscription_id);
        return { status: 'FAILED', error: `${err.statusCode || ''} ${err.body || err.message}`.trim() };
    }
}

module.exports = {
    isConfigured: () => configured,
    publicKey: () => PUBLIC_KEY,
    sendTo,
};
