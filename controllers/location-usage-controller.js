const dateFormat = require("dateformat");
const LocationUsageDao = require("../dao/location-usage-dao");

const ACTIVE_THRESHOLD_DAYS = 7;
const DORMANT_THRESHOLD_DAYS = 30;

function usageStatus(row) {
    if (!row.total_shifts || row.total_shifts === 0) {
        return { code: 'NEVER_USED', label: 'Never Used', badgeClass: 'badge-secondary' };
    }
    if (row.days_since_last_shift <= ACTIVE_THRESHOLD_DAYS) {
        return { code: 'ACTIVE', label: 'Active', badgeClass: 'badge-success' };
    }
    if (row.days_since_last_shift <= DORMANT_THRESHOLD_DAYS) {
        return { code: 'DORMANT', label: 'Dormant', badgeClass: 'badge-warning' };
    }
    return { code: 'INACTIVE', label: 'Inactive', badgeClass: 'badge-danger' };
}

module.exports = {
    getLocationUsageMatrix: async (req, res, next) => {
        try {
            const rows = await LocationUsageDao.getLocationUsageMatrix();

            const records = rows.map(row => {
                const status = usageStatus(row);
                return {
                    location_code: row.location_code,
                    location_name: row.location_name,
                    is_active_location: !!row.is_active_location,
                    total_shifts: row.total_shifts,
                    closed_shifts: row.closed_shifts,
                    draft_shifts: row.draft_shifts,
                    shifts_last_30_days: row.shifts_last_30_days,
                    first_shift_date: row.first_shift_date ? dateFormat(row.first_shift_date, 'dd-mmm-yyyy') : '-',
                    last_shift_date: row.last_shift_date ? dateFormat(row.last_shift_date, 'dd-mmm-yyyy') : '-',
                    days_since_last_shift: row.days_since_last_shift,
                    status
                };
            });

            const summary = {
                total: records.length,
                active: records.filter(r => r.status.code === 'ACTIVE').length,
                dormant: records.filter(r => r.status.code === 'DORMANT').length,
                inactive: records.filter(r => r.status.code === 'INACTIVE').length,
                neverUsed: records.filter(r => r.status.code === 'NEVER_USED').length
            };

            res.render('location-usage-matrix', {
                title: 'Location Usage Matrix',
                records,
                summary,
                activeThreshold: ACTIVE_THRESHOLD_DAYS,
                dormantThreshold: DORMANT_THRESHOLD_DAYS,
                user: req.user
            });
        } catch (err) {
            console.error('Error fetching location usage matrix:', err);
            res.status(500).send({ error: 'Error fetching location usage matrix.' });
        }
    }
};
