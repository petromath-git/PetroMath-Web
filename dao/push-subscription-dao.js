// dao/push-subscription-dao.js — phones/browsers that turned on reminders (t_push_subscription)
// and the log of reminders sent (t_push_log).
const crypto = require('crypto');
const db = require("../db/db-connection");
const { QueryTypes } = require("sequelize");
const config = require("../config/app-config");

const hashEndpoint = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex');

module.exports = {
    hashEndpoint,

    // Same endpoint signing in as someone else on a shared phone moves to the new person
    save: (personId, sub, userAgent) =>
        db.sequelize.query(
            `INSERT INTO t_push_subscription (person_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
             VALUES (:personId, :endpoint, :hash, :p256dh, :auth, :userAgent)
             ON DUPLICATE KEY UPDATE person_id = VALUES(person_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
                                     user_agent = VALUES(user_agent), fail_count = 0`,
            { replacements: { personId, endpoint: sub.endpoint, hash: hashEndpoint(sub.endpoint),
                              p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: (userAgent || '').slice(0, 300) },
              type: QueryTypes.INSERT }),

    removeByEndpoint: (personId, endpoint) =>
        db.sequelize.query(
            `DELETE FROM t_push_subscription WHERE endpoint_hash = :hash AND person_id = :personId`,
            { replacements: { hash: hashEndpoint(endpoint), personId }, type: QueryTypes.BULKDELETE }),

    removeById: (subscriptionId) =>
        db.sequelize.query(`DELETE FROM t_push_subscription WHERE subscription_id = :subscriptionId`,
            { replacements: { subscriptionId }, type: QueryTypes.BULKDELETE }),

    findForPerson: (personId) =>
        db.sequelize.query(`SELECT * FROM t_push_subscription WHERE person_id = :personId`,
            { replacements: { personId }, type: QueryTypes.SELECT }),

    findByEndpoint: async (personId, endpoint) => {
        const rows = await db.sequelize.query(
            `SELECT subscription_id FROM t_push_subscription WHERE endpoint_hash = :hash AND person_id = :personId`,
            { replacements: { hash: hashEndpoint(endpoint), personId }, type: QueryTypes.SELECT });
        return rows[0] || null;
    },

    // Admin-type users (Manager, Admin, PowerUser, SuperUser — same as the page's access)
    // of this location: home location, or an active extra location with an admin role there.
    findAdminSubscriptionsForLocation: (locationCode) =>
        db.sequelize.query(
            `SELECT s.subscription_id, s.person_id, s.endpoint, s.p256dh, s.auth, s.fail_count
             FROM t_push_subscription s
             JOIN m_persons p ON p.Person_id = s.person_id
             WHERE (p.effective_end_date IS NULL OR p.effective_end_date > CURDATE())
               AND ( (p.location_code = :locationCode AND p.Role IN (:roles))
                  OR EXISTS (SELECT 1 FROM m_person_location pl
                             WHERE pl.person_id = p.Person_id AND pl.location_code = :locationCode
                               AND CURDATE() BETWEEN pl.effective_start_date AND pl.effective_end_date
                               AND pl.role IN (:roles)) )`,
            { replacements: { locationCode, roles: config.APP_CONFIGS.adminRoles }, type: QueryTypes.SELECT }),

    markSuccess: (subscriptionId) =>
        db.sequelize.query(`UPDATE t_push_subscription SET fail_count = 0, last_success_at = NOW() WHERE subscription_id = :subscriptionId`,
            { replacements: { subscriptionId }, type: QueryTypes.UPDATE }),

    markFailure: (subscriptionId) =>
        db.sequelize.query(`UPDATE t_push_subscription SET fail_count = fail_count + 1 WHERE subscription_id = :subscriptionId`,
            { replacements: { subscriptionId }, type: QueryTypes.UPDATE }),

    // Claims today's reminder for this phone + location. Returns the log id, or null when
    // it was already sent today (restart, or a second app process).
    claimDigest: async (digestDate, locationCode, sub, title, body) => {
        const [id, affected] = await db.sequelize.query(
            `INSERT IGNORE INTO t_push_log (digest_date, location_code, subscription_id, person_id, title, body)
             VALUES (:digestDate, :locationCode, :subscriptionId, :personId, :title, :body)`,
            { replacements: { digestDate, locationCode, subscriptionId: sub.subscription_id, personId: sub.person_id,
                              title: title.slice(0, 200), body: body.slice(0, 500) },
              type: QueryTypes.INSERT });
        return affected ? id : null;
    },

    finishLog: (logId, status, error) =>
        db.sequelize.query(`UPDATE t_push_log SET status = :status, error = :error WHERE log_id = :logId`,
            { replacements: { logId, status, error: error ? String(error).slice(0, 500) : null }, type: QueryTypes.UPDATE }),
};
