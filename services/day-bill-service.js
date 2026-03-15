// services/day-bill-service.js
//
// Thin wrapper around the generate_day_bill stored procedure.
// All business logic lives in the DB procedure.
//
const DayBillDao = require('../dao/day-bill-dao');

/**
 * Generate / regenerate the Day Bill for a given location + date.
 * Picks all CLOSED shifts whose closing_date = billDate.
 *
 * @param {string} locationCode
 * @param {string} billDate     YYYY-MM-DD
 * @param {string} userId
 */
async function recalculateDayBill(locationCode, billDate, userId) {
    console.log(`DayBillService: generate loc=${locationCode} date=${billDate} user=${userId}`);
    try {
        await DayBillDao.generateDayBill(locationCode, billDate, userId);
        console.log(`DayBillService: done for ${locationCode} ${billDate}`);
    } catch (err) {
        // Non-fatal: day bill failure should not break the shift close flow
        console.error(`DayBillService: error for ${locationCode} ${billDate}:`, err);
    }
}

/**
 * Delete day bill items and headers (but keep the parent row + bill numbers)
 * when a shift is reopened. Items will be rebuilt on re-close.
 */
async function clearDayBillOnReopen(locationCode, billDate) {
    try {
        const dayBill = await DayBillDao.findByDate(locationCode, billDate);
        if (!dayBill) return;
        await DayBillDao.deleteHeadersAndItems(dayBill.day_bill_id);
        console.log(`DayBillService: cleared items for ${locationCode} ${billDate} on reopen`);
    } catch (err) {
        console.error(`DayBillService: error clearing for ${locationCode} ${billDate}:`, err);
    }
}

module.exports = { recalculateDayBill, clearDayBillOnReopen };
