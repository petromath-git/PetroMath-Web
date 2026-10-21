// controllers/deadline-controller.js — Deadlines & Renewals page (/deadline)
// and the bank holiday calendar on the same page.
const moment = require('moment');
const DeadlineDao = require('../dao/deadline-dao');
const pushService = require('../services/push-service');
const BankHolidays = require('../services/bank-holiday-service');

const MAX_TITLE = 200;
const MAX_REFERENCE = 100;
const MAX_NOTES = 2000;
const MAX_NOTE = 500;
const MAX_REMIND_DAYS = 365;
const REPEAT_OPTIONS = [
    { months: 0,   label: 'One-time' },
    { months: 1,   label: 'Every month' },
    { months: 3,   label: 'Every 3 months' },
    { months: 6,   label: 'Every 6 months' },
    { months: 12,  label: 'Every year' },
    { months: 24,  label: 'Every 2 years' },
    { months: 36,  label: 'Every 3 years' },
    { months: 60,  label: 'Every 5 years' },
    { months: 120, label: 'Every 10 years' },
];

const fmtDate = (d) => (d ? moment(d, 'YYYY-MM-DD').format('DD-MMM-YYYY') : '');
const clean = (v) => String(v == null ? '' : v).trim();

function parseDate(v) {
    const s = clean(v);
    const m = moment(s, 'YYYY-MM-DD', true);
    if (!m.isValid() || m.year() < 2000 || m.year() > 2100) return null;
    return m.format('YYYY-MM-DD');
}

function parseIntIn(v, min, max) {
    const s = clean(v);
    if (s === '' || !/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n >= min && n <= max ? n : null;
}

// "Overdue by 3 days" / "Due today" / "Due in 12 days"
function dueText(daysLeft) {
    if (daysLeft < 0) return `Overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}`;
    if (daysLeft === 0) return 'Due today';
    if (daysLeft === 1) return 'Due tomorrow';
    return `Due in ${daysLeft} days`;
}

// OVERDUE / SOON (inside its reminder window) / LATER / DONE
function bucketOf(item) {
    if (item.status === 'DONE') return 'DONE';
    if (item.days_left < 0) return 'OVERDUE';
    if (item.days_left <= item.remind_days) return 'SOON';
    return 'LATER';
}

function decorate(item) {
    const daysLeft = Number(item.days_left);
    const it = { ...item, days_left: daysLeft, remind_days: Number(item.remind_days), renewal_count: Number(item.renewal_count) };
    it.bucket = bucketOf(it);
    it.due_display = fmtDate(it.due_date);
    it.closed_display = fmtDate(it.closed_date);
    it.due_text = it.bucket === 'DONE' ? 'Done' : dueText(daysLeft);
    const rep = REPEAT_OPTIONS.find(r => r.months === Number(it.repeat_months));
    it.repeat_label = rep ? rep.label : `Every ${it.repeat_months} months`;
    return it;
}

async function validateItem(body) {
    const categories = await DeadlineDao.getCategories();
    const categoryId = parseInt(body.category_id, 10);
    if (!categories.some(c => c.category_id === categoryId)) return { error: 'Pick a category.' };

    const title = clean(body.title).replace(/\s+/g, ' ');
    if (!title) return { error: 'Enter what this deadline is for.' };
    if (title.length > MAX_TITLE) return { error: `Name must be ${MAX_TITLE} characters or less.` };

    const referenceNo = clean(body.reference_no).replace(/\s+/g, ' ');
    if (referenceNo.length > MAX_REFERENCE) return { error: `Reference must be ${MAX_REFERENCE} characters or less.` };

    const dueDate = parseDate(body.due_date);
    if (!dueDate) return { error: 'Enter a valid due date.' };

    const repeatMonths = parseIntIn(body.repeat_months, 0, 120);
    if (repeatMonths === null) return { error: 'Pick how often this repeats.' };

    const remindDays = parseIntIn(body.remind_days, 0, MAX_REMIND_DAYS);
    if (remindDays === null) return { error: `Remind days must be a whole number from 0 to ${MAX_REMIND_DAYS}.` };

    const notes = clean(body.notes);
    if (notes.length > MAX_NOTES) return { error: `Notes must be ${MAX_NOTES} characters or less.` };

    return { categoryId, title, referenceNo: referenceNo || null, dueDate, repeatMonths, remindDays, notes: notes || null };
}

function decorateHoliday(h) {
    const m = moment(h.date, 'YYYY-MM-DD');
    return { ...h, date_display: fmtDate(h.date), day_name: m.format('ddd'), days_left: m.diff(moment().startOf('day'), 'days') };
}

const fail = (res, status, error) => res.status(status).json({ success: false, error });

module.exports = {
    fmtDate,
    dueText,

    getPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            // First visit works out the location's state (and fetches RBI's list); never blocks the page
            const region = await BankHolidays.ensureRegion(locationCode).catch(err => {
                console.error('Deadline page: bank holiday region failed:', err.message);
                return null;
            });
            const thisYear = moment().year();
            const [items, categories, holidays, references] = await Promise.all([
                DeadlineDao.findItems(locationCode),
                DeadlineDao.getCategories(),
                BankHolidays.getHolidays(locationCode, `${thisYear - 1}-01-01`, `${thisYear + 1}-12-31`),
                DeadlineDao.getReferenceSuggestions(locationCode),
            ]);
            const list = items.map(decorate);
            const counts = { OVERDUE: 0, SOON: 0, LATER: 0, DONE: 0 };
            list.forEach(i => counts[i.bucket]++);

            res.render('deadline', {
                title: 'Deadlines & Renewals',
                user: req.user,
                mobileReady: true,
                items: list,
                counts,
                categories,
                repeatOptions: REPEAT_OPTIONS,
                references: references.map(r => r.reference_no),
                holidays: holidays.map(decorateHoliday),
                holidayRegion: region,
                rbiOffices: BankHolidays.RBI_OFFICES,
                today: moment().format('YYYY-MM-DD'),
                // Reminder came from another location (multi-location admins)
                pushLocation: req.query.loc && req.query.loc !== locationCode ? String(req.query.loc).slice(0, 45) : null,
                pushReady: pushService.isConfigured(),
                maxTitle: MAX_TITLE, maxReference: MAX_REFERENCE, maxNotes: MAX_NOTES, maxNote: MAX_NOTE,
            });
        } catch (e) {
            next(e);
        }
    },

    getHistory: async (req, res) => {
        try {
            const item = await DeadlineDao.findItem(parseInt(req.params.id, 10), req.user.location_code);
            if (!item) return fail(res, 404, 'Deadline not found.');
            const rows = await DeadlineDao.getRenewals(item.item_id);
            res.json({ success: true, history: rows.map(r => ({
                previous_due: fmtDate(r.previous_due_date),
                done: fmtDate(r.done_date),
                next_due: fmtDate(r.next_due_date),
                note: r.note,
                by: r.done_by_name,
            })) });
        } catch (e) {
            console.error('Error loading deadline history:', e);
            fail(res, 500, 'Error loading history.');
        }
    },

    createItem: async (req, res) => {
        try {
            const input = await validateItem(req.body);
            if (input.error) return fail(res, 400, input.error);
            const id = await DeadlineDao.createItem(req.user.location_code, input, req.user.Person_id);
            res.json({ success: true, item_id: id });
        } catch (e) {
            console.error('Error creating deadline:', e);
            fail(res, 500, 'Error saving deadline.');
        }
    },

    updateItem: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const itemId = parseInt(req.params.id, 10);
            if (!(await DeadlineDao.findItem(itemId, locationCode))) return fail(res, 404, 'Deadline not found.');
            const input = await validateItem(req.body);
            if (input.error) return fail(res, 400, input.error);
            await DeadlineDao.updateItem(itemId, locationCode, input, req.user.Person_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Error updating deadline:', e);
            fail(res, 500, 'Error saving deadline.');
        }
    },

    // Body: done_date, next_due_date (blank + close=Y to close with no next date), note
    renewItem: async (req, res) => {
        try {
            const item = await DeadlineDao.findItem(parseInt(req.params.id, 10), req.user.location_code);
            if (!item) return fail(res, 404, 'Deadline not found.');

            const doneDate = parseDate(req.body.done_date);
            if (!doneDate) return fail(res, 400, 'Enter the date it was done.');
            if (doneDate > moment().format('YYYY-MM-DD')) return fail(res, 400, 'Done date can\'t be in the future.');

            const closing = req.body.close === 'Y';
            let nextDueDate = null;
            if (!closing) {
                nextDueDate = parseDate(req.body.next_due_date);
                if (!nextDueDate) return fail(res, 400, 'Enter the next due date.');
                if (nextDueDate <= doneDate) return fail(res, 400, 'Next due date must be after the done date.');
            }
            const note = clean(req.body.note);
            if (note.length > MAX_NOTE) return fail(res, 400, `Note must be ${MAX_NOTE} characters or less.`);

            await DeadlineDao.renewItem(item, doneDate, nextDueDate, note || null, req.user.Person_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Error renewing deadline:', e);
            fail(res, 500, 'Error saving renewal.');
        }
    },

    deleteItem: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const itemId = parseInt(req.params.id, 10);
            if (!(await DeadlineDao.findItem(itemId, locationCode))) return fail(res, 404, 'Deadline not found.');
            await DeadlineDao.deleteItem(itemId, locationCode);
            res.json({ success: true });
        } catch (e) {
            console.error('Error deleting deadline:', e);
            fail(res, 500, 'Error deleting deadline.');
        }
    },

    createHoliday: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const holidayDate = parseDate(req.body.holiday_date);
            if (!holidayDate) return fail(res, 400, 'Enter a valid date.');
            const description = clean(req.body.description).replace(/\s+/g, ' ') || 'Bank holiday';
            if (description.length > 200) return fail(res, 400, 'Description must be 200 characters or less.');
            if (await DeadlineDao.holidayExists(locationCode, holidayDate)) {
                return fail(res, 400, `${fmtDate(holidayDate)} is already in the calendar.`);
            }
            const auto = await BankHolidays.getHolidays(locationCode, holidayDate, holidayDate);
            if (auto.length) {
                return fail(res, 400, `${fmtDate(holidayDate)} is already a bank holiday (${auto[0].description}).`);
            }
            await DeadlineDao.createHoliday(locationCode, holidayDate, description, req.user.Person_id);
            res.json({ success: true });
        } catch (e) {
            console.error('Error adding bank holiday:', e);
            fail(res, 500, 'Error saving holiday.');
        }
    },

    // "Not a holiday here": hides an RBI / 2nd-4th Saturday holiday for this location
    hideHoliday: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const holidayDate = parseDate(req.body.holiday_date);
            if (!holidayDate) return fail(res, 400, 'Enter a valid date.');
            const auto = await BankHolidays.getHolidays(locationCode, holidayDate, holidayDate);
            if (!auto.length || auto[0].source === 'MANUAL' || auto[0].source === 'HIDDEN') {
                return fail(res, 400, 'Only automatic holidays can be hidden. Delete a hand-entered one instead.');
            }
            await DeadlineDao.createHoliday(locationCode, holidayDate, auto[0].description.slice(0, 200), req.user.Person_id, true);
            res.json({ success: true });
        } catch (e) {
            console.error('Error hiding bank holiday:', e);
            fail(res, 500, 'Error saving holiday.');
        }
    },

    // Body: rbi_office ('' = work it out automatically again)
    setHolidayRegion: async (req, res) => {
        try {
            const office = clean(req.body.rbi_office);
            if (office && !BankHolidays.RBI_OFFICES.includes(office)) return fail(res, 400, 'Pick an RBI office from the list.');
            const region = await BankHolidays.setRegion(req.user.location_code, office, req.user.Person_id);
            res.json({ success: true, region });
        } catch (e) {
            console.error('Error setting bank holiday region:', e);
            fail(res, 500, 'Error saving.');
        }
    },

    // Fetch RBI's list again now (normally monthly)
    refreshHolidays: async (req, res) => {
        try {
            const region = await BankHolidays.getRegion(req.user.location_code);
            if (!region || !region.rbi_office) return fail(res, 400, 'Pick the RBI office first.');
            const results = await BankHolidays.syncOffice(region.rbi_office, { force: true });
            const failed = results.filter(r => r.status === 'FAILED');
            if (failed.length === results.length) return fail(res, 502, 'Could not reach RBI: ' + failed[0].error);
            res.json({ success: true, results });
        } catch (e) {
            console.error('Error refreshing bank holidays:', e);
            fail(res, 500, 'Error fetching holidays.');
        }
    },

    deleteHoliday: async (req, res) => {
        try {
            const affected = await DeadlineDao.deleteHoliday(parseInt(req.params.id, 10), req.user.location_code);
            if (!affected) return fail(res, 404, 'Holiday not found.');
            res.json({ success: true });
        } catch (e) {
            console.error('Error deleting bank holiday:', e);
            fail(res, 500, 'Error deleting holiday.');
        }
    },

    // Home page / DSR widget: overdue + due-soon items, and bank holidays in the next 7 days
    getAttentionSummary: async (locationCode) => {
        const today = moment().format('YYYY-MM-DD');
        const [items, holidays] = await Promise.all([
            DeadlineDao.findAttentionItems(locationCode),
            BankHolidays.getHolidays(locationCode, today, moment().add(7, 'days').format('YYYY-MM-DD')),
        ]);
        return {
            items: items.map(decorate),
            holidays: holidays.filter(h => h.source !== 'HIDDEN').map(decorateHoliday),
        };
    },
};
