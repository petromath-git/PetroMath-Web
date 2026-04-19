// routes/gl-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const db = require('../db/db-connection');

// GET /gl/api/ledgers/search?location=&group=&q=
// Returns [{ledger_id, ledger_name}] — used by Select2 ajax typeahead on product ledger fields
router.get('/api/ledgers/search', [isLoginEnsured, security.isAdmin()], async function(req, res) {
    const locationCode = req.query.location || req.user.location_code;
    const group = req.query.group || null;
    const q = req.query.q || null;

    try {
        const rows = await db.sequelize.query(`
            SELECT l.ledger_id, l.ledger_name
            FROM gl_ledgers l
            JOIN gl_ledger_groups g ON g.group_id = l.group_id
            WHERE l.location_code = :locationCode
              AND l.active_flag = 'Y'
              AND (:group IS NULL OR g.group_name = :group)
              AND (:q IS NULL OR l.ledger_name LIKE :qLike)
            ORDER BY l.ledger_name
            LIMIT 30
        `, {
            replacements: {
                locationCode,
                group,
                q,
                qLike: q ? `%${q}%` : null
            },
            type: db.Sequelize.QueryTypes.SELECT
        });

        res.json(rows);
    } catch (error) {
        console.error('Error searching ledgers:', error);
        res.status(500).json({ error: 'Failed to search ledgers' });
    }
});

module.exports = router;

// Exported helper — used by products route to populate ledger dropdowns server-side
module.exports.getLedgersByGroup = async function(locationCode, groupName) {
    const rows = await db.sequelize.query(`
        SELECT l.ledger_id, l.ledger_name
        FROM gl_ledgers l
        JOIN gl_ledger_groups g ON g.group_id = l.group_id
        WHERE l.location_code = :locationCode
          AND l.active_flag = 'Y'
          AND g.group_name = :groupName
        ORDER BY l.ledger_name
    `, {
        replacements: { locationCode, groupName },
        type: db.Sequelize.QueryTypes.SELECT
    });
    return rows;
};
