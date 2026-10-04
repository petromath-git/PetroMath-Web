// Go-live guard for screens that save dated bank entries.
// Go-live = the location's first shift (see locationDao.getGoLiveDate); the
// golive-date-guard.sql triggers enforce the same rule in the database.
const moment = require('moment');
const locationDao = require('../dao/location-dao');

/**
 * Returns an error message if any of the given dates (YYYY-MM-DD) is before
 * the location's go-live date, otherwise null. Check all rows before saving
 * any, so a multi-row save is all-or-nothing.
 */
async function beforeGoLiveError(locationCode, dates) {
    const goLive = await locationDao.getGoLiveDate(locationCode);
    if (!goLive) return null;

    const early = dates.map(d => String(d || '').slice(0, 10)).filter(d => d && d < goLive).sort();
    if (early.length === 0) return null;

    return `${moment(early[0]).format('DD-MMM-YYYY')} is before this location's PetroMath go-live date ` +
           `(${moment(goLive).format('DD-MMM-YYYY')}). Bank entries before go-live are already covered ` +
           `by the opening balances. Nothing was saved.`;
}

module.exports = { beforeGoLiveError };
