'use strict';
const moment = require('moment');

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Turns per-day bowser movements (sorted by date, up to toDate) into a day-wise stock
// statement: Opening + Fill In - Out = Closing.
// openingBalance { qty, date } comes from the bowser master: the balance starts from qty
// at the start of date, and entries before that date are ignored. Without one the
// balance starts from zero at the bowser's first entry.
function buildStockStatement(movements, fromDate, toDate, capacity, openingBalance) {
    const openingDate = openingBalance && openingBalance.date ? openingBalance.date : null;
    const statement = { opening: 0, closing: 0, days: [], totals: { fill: 0, credit: 0, cash: 0, digital: 0, out: 0 }, negativeDays: 0, overCapacityDays: 0, draftDays: 0, beforeOpeningDate: false };

    if (openingDate && openingDate > toDate) {
        statement.beforeOpeningDate = true;
        return statement;
    }

    const counted = openingDate ? movements.filter(m => m.movement_date >= openingDate) : movements;
    const inPeriod = new Map();
    let opening = openingDate ? round3(openingBalance.qty) : 0;

    for (const m of counted) {
        const fill    = round3(m.fill_qty);
        const credit  = round3(m.credit_qty);
        const cash    = round3(m.cash_qty);
        const digital = round3(m.digital_qty);
        const out     = round3(credit + cash + digital);

        if (m.movement_date < fromDate) {
            opening = round3(opening + fill - out);
        } else if (m.movement_date <= toDate) {
            inPeriod.set(m.movement_date, {
                fill, credit, cash, digital, out,
                bowser_closing_id: m.bowser_closing_id || null,
                status: m.status || null
            });
        }
    }

    const { totals, days } = statement;
    let balance = opening;

    // Nothing to show before the balance starts, so a long period doesn't list empty days
    const firstDay = openingDate || (counted.length ? counted[0].movement_date : null);
    if (firstDay && firstDay <= toDate) {
        const start = firstDay > fromDate ? firstDay : fromDate;
        const cursor = moment(start, 'YYYY-MM-DD');
        const last = moment(toDate, 'YYYY-MM-DD');

        while (cursor.isSameOrBefore(last)) {
            const date = cursor.format('YYYY-MM-DD');
            const m = inPeriod.get(date) || { fill: 0, credit: 0, cash: 0, digital: 0, out: 0, bowser_closing_id: null, status: null };
            const dayOpening = balance;
            balance = round3(balance + m.fill - m.out);

            const isNegative = balance < 0;
            const isOverCapacity = capacity > 0 && balance > capacity;
            if (isNegative) statement.negativeDays++;
            if (isOverCapacity) statement.overCapacityDays++;
            if (m.status === 'DRAFT') statement.draftDays++;

            ['fill', 'credit', 'cash', 'digital', 'out'].forEach(k => { totals[k] = round3(totals[k] + m[k]); });
            days.push({
                ...m,
                date,
                opening: dayOpening,
                closing: balance,
                has_movement: m.fill !== 0 || m.out !== 0,
                is_negative: isNegative,
                is_over_capacity: isOverCapacity
            });
            cursor.add(1, 'day');
        }
    }

    statement.opening = opening;
    statement.closing = balance;
    return statement;
}

// One day's deliveries grouped by type for the Total Out popup. Group totals use the
// same sums as the statement's row (amount / rate on the whole group), so they tie to it.
function buildOutBreakup(creditItems, cashItems, digitalItems, rate) {
    const litresOf = amount => (rate > 0 ? round3(Number(amount) / rate) : 0);
    const sum = (items, key) => items.reduce((s, i) => s + (Number(i[key]) || 0), 0);

    const groups = [
        {
            label: 'Credit',
            litres: round3(sum(creditItems, 'quantity')),
            amount: sum(creditItems, 'amount'),
            lines: creditItems.map(i => ({
                party: i.customer_name, vehicle: i.vehicle_number, ref: i.bill_no,
                litres: round3(i.quantity), amount: Number(i.amount) || 0
            }))
        },
        {
            label: 'Cash',
            litres: litresOf(sum(cashItems, 'amount')),
            amount: sum(cashItems, 'amount'),
            lines: cashItems.map(i => ({
                party: null, vehicle: null, ref: null,
                litres: litresOf(i.amount), amount: Number(i.amount) || 0
            }))
        },
        {
            label: 'Digital',
            litres: litresOf(sum(digitalItems, 'amount')),
            amount: sum(digitalItems, 'amount'),
            lines: digitalItems.map(i => ({
                party: i.digital_vendor_name, vehicle: null, ref: i.digital_ref,
                litres: litresOf(i.amount), amount: Number(i.amount) || 0
            }))
        }
    ].filter(g => g.lines.length > 0);

    return {
        groups,
        total_litres: round3(groups.reduce((s, g) => s + g.litres, 0)),
        total_amount: groups.reduce((s, g) => s + g.amount, 0)
    };
}

module.exports = { buildStockStatement, buildOutBreakup };
