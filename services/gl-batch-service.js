// services/gl-batch-service.js
// Oracle-style concurrent request wrapper for GL batch operations.
// Lifecycle: PENDING → RUNNING → COMPLETED | ERROR
// Log verbosity controlled by GL_LOG_LEVEL in m_location_config.

const db                    = require('../db/db-connection');
const { QueryTypes }        = require('sequelize');
const GlBatchLogger         = require('./gl-batch-logger');
const { getLocationConfigValue } = require('../utils/location-config');

async function submitRequest(requestType, locationCode, fromDate, toDate, params, submittedBy) {
    const [requestId] = await db.sequelize.query(`
        INSERT INTO gl_batch_requests
            (request_type, location_code, from_date, to_date, params, status, submitted_by)
        VALUES (:requestType, :locationCode, :fromDate, :toDate, :params, 'PENDING', :submittedBy)
    `, {
        replacements: {
            requestType, locationCode,
            fromDate, toDate,
            params: params ? JSON.stringify(params) : null,
            submittedBy
        },
        type: QueryTypes.INSERT
    });
    return requestId;
}

async function runRequest(requestId, locationCode, fn) {
    const logLevel = await getLocationConfigValue(locationCode, 'GL_LOG_LEVEL', 'INFO');
    const logger   = new GlBatchLogger(logLevel);

    await db.sequelize.query(`
        UPDATE gl_batch_requests SET status='RUNNING', started_at=NOW() WHERE request_id=:requestId
    `, { replacements: { requestId }, type: QueryTypes.UPDATE });

    let resultSummary = null;
    try {
        resultSummary = await fn(logger);

        await db.sequelize.query(`
            UPDATE gl_batch_requests
            SET status='COMPLETED', completed_at=NOW(),
                result_summary=:summary, log_text=:log
            WHERE request_id=:requestId
        `, {
            replacements: {
                requestId,
                summary: JSON.stringify(resultSummary),
                log: logger.getText()
            },
            type: QueryTypes.UPDATE
        });

        return { success: true, summary: resultSummary };
    } catch (err) {
        logger.error('Fatal: ' + err.message);

        await db.sequelize.query(`
            UPDATE gl_batch_requests
            SET status='ERROR', completed_at=NOW(),
                result_summary=:summary, log_text=:log
            WHERE request_id=:requestId
        `, {
            replacements: {
                requestId,
                summary: JSON.stringify({ error: err.message }),
                log: logger.getText()
            },
            type: QueryTypes.UPDATE
        });

        throw err;
    }
}

async function recoverStaleRequests(locationCode) {
    await db.sequelize.query(`
        UPDATE gl_batch_requests
        SET status       = 'ERROR',
            completed_at = NOW(),
            log_text     = CONCAT(COALESCE(log_text,''), '\n[RECOVERED] Server restarted during processing — run did not complete.')
        WHERE location_code = :locationCode
          AND status        = 'RUNNING'
    `, { replacements: { locationCode }, type: QueryTypes.UPDATE });
}

async function getRecentRequests(locationCode, limit) {
    // Pick the ids first, then fetch only those rows, and sort them here: any SQL sort of
    // whole rows (result_summary holds per-event JSON, hundreds of KB per run) runs out of
    // sort memory.
    const rows = await db.sequelize.query(`
        SELECT b.request_id, b.request_type, b.from_date, b.to_date, b.status,
               b.submitted_by, b.submitted_at, b.started_at, b.completed_at,
               b.result_summary
        FROM gl_batch_requests b
        JOIN (
            SELECT request_id FROM gl_batch_requests
            WHERE location_code = :locationCode
            ORDER BY submitted_at DESC
            LIMIT :limit
        ) recent ON recent.request_id = b.request_id
    `, { replacements: { locationCode, limit: limit || 20 }, type: QueryTypes.SELECT });
    // The list shows only the counts; drop the per-event details (up to ~1 MB a run).
    for (const r of rows) {
        try {
            const s = typeof r.result_summary === 'string' ? JSON.parse(r.result_summary) : r.result_summary;
            if (s && s.details) { delete s.details; r.result_summary = s; }
        } catch (e) { /* leave as is */ }
    }
    return rows.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at) || b.request_id - a.request_id);
}

async function getRequestLog(requestId, locationCode) {
    const rows = await db.sequelize.query(`
        SELECT request_id, request_type, from_date, to_date, status,
               submitted_by, submitted_at, started_at, completed_at,
               result_summary, log_text
        FROM gl_batch_requests
        WHERE request_id = :requestId AND location_code = :locationCode
    `, { replacements: { requestId, locationCode }, type: QueryTypes.SELECT });
    return rows[0] || null;
}

module.exports = { submitRequest, runRequest, recoverStaleRequests, getRecentRequests, getRequestLog };
