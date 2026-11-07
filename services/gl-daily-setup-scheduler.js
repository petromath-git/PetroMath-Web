// services/gl-daily-setup-scheduler.js
//
// 00:10 IST every day, for every active location:
// - creates the financial year today falls in, if none covers today. Only 1 April
//   normally has anything to do.
// - maps products added in the last few days to their sales, purchase and GST
//   ledgers, the same way onboarding does.
// Running daily, and once at startup, means a server that was down at midnight
// on 1 April still catches up.
//
// Runs only on prod (ENVIRONMENT=prod). Re-running is harmless: both only fill gaps.
const cron = require('node-cron');
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');
const setupService = require('./gl-accounting-setup-service');

const CRON_EXPRESSION = '10 0 * * *';   // 00:10 IST
const CREATED_BY = 'SCHEDULER';

let running = null;

async function runDailySetup(trigger) {
    if (running) return running;
    running = (async () => {
        try {
            const locations = await db.sequelize.query(
                `SELECT location_code FROM m_location WHERE effective_end_date >= CURDATE()`,
                { type: QueryTypes.SELECT });
            for (const { location_code } of locations) {
                try {
                    const fy = await setupService.ensureCurrentFinancialYear(location_code, CREATED_BY);
                    if (fy) console.log(`GlDailySetup: ${trigger} ${location_code} — created ${fy.fy_name}, current ${fy.is_current}`);
                    const maps = await setupService.mapNewProducts(location_code, CREATED_BY);
                    if (maps.length) console.log(`GlDailySetup: ${trigger} ${location_code} — mapped ${[...new Set(maps.map(m => m.product_name))].join(', ')}`);
                } catch (err) {
                    console.error(`GlDailySetup: ${location_code} failed:`, err.message);
                }
            }
        } catch (err) {
            console.error('GlDailySetup: run failed:', err);
        } finally {
            running = null;
        }
    })();
    return running;
}

function start() {
    if (process.env.ENVIRONMENT !== 'prod') {
        console.log('GlDailySetup: off (prod only)');
        return;
    }
    cron.schedule(CRON_EXPRESSION, () => runDailySetup('SCHEDULED'), { timezone: 'Asia/Kolkata' });
    console.log(`GlDailySetup: scheduled (${CRON_EXPRESSION} IST)`);
    setTimeout(() => runDailySetup('STARTUP'), 90 * 1000);
}

module.exports = { start, runDailySetup };
