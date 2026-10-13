// express-session store on t_web_sessions (db/migrations/web-sessions.sql), so
// logins survive deploys and PM2 restarts. Reads are one primary-key lookup
// per request; writes happen only when the session changes (the rolling
// middleware in app.js re-saves at most every 30 min), never on every request.
const session = require('express-session');
const { QueryTypes } = require('sequelize');
const db = require('../db/db-connection');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const FALLBACK_TTL_MS = 4 * 60 * 60 * 1000;

function expiryOf(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    const ms = exp ? new Date(exp).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Date.now() + FALLBACK_TTL_MS;
}

class DbSessionStore extends session.Store {
    constructor() {
        super();
        // Drop expired rows hourly; unref so it never keeps the process alive
        this.cleanupTimer = setInterval(() => {
            db.sequelize.query('DELETE FROM t_web_sessions WHERE expires_ms < :now', { replacements: { now: Date.now() } })
                .catch(err => console.error('Session cleanup failed:', err.message));
        }, CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref();
    }

    get(sid, cb) {
        db.sequelize.query(
            'SELECT data FROM t_web_sessions WHERE session_id = :sid AND expires_ms > :now',
            { replacements: { sid, now: Date.now() }, type: QueryTypes.SELECT })
            .then(rows => cb(null, rows.length ? JSON.parse(rows[0].data) : null))
            .catch(err => cb(err));
    }

    set(sid, sess, cb) {
        const user = sess.passport && sess.passport.user;
        db.sequelize.query(
            `INSERT INTO t_web_sessions (session_id, person_id, expires_ms, data)
             VALUES (:sid, :personId, :expires, :data)
             ON DUPLICATE KEY UPDATE person_id = VALUES(person_id), expires_ms = VALUES(expires_ms), data = VALUES(data)`,
            { replacements: { sid, personId: (user && user.Person_id) || null, expires: expiryOf(sess), data: JSON.stringify(sess) } })
            .then(() => cb && cb(null))
            .catch(err => cb && cb(err));
    }

    destroy(sid, cb) {
        db.sequelize.query('DELETE FROM t_web_sessions WHERE session_id = :sid', { replacements: { sid } })
            .then(() => cb && cb(null))
            .catch(err => cb && cb(err));
    }

    // Deliberately no write: expiry is extended by the rolling middleware's save
    touch(sid, sess, cb) {
        if (cb) cb(null);
    }
}

module.exports = DbSessionStore;
