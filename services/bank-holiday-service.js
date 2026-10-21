// services/bank-holiday-service.js
//
// Bank holidays for each location, filled automatically:
//   1. Which state's list: banks close on their state's holidays under the
//      Negotiable Instruments Act, and RBI publishes one list per regional office.
//      A location's state comes from its GST number (first 2 digits); else a state
//      named in its address; else the IFSC branch state of its own bank accounts
//      (looked up at ifsc.razorpay.com); else an admin picks the office on the
//      Bank Holidays tab.
//   2. The list itself: RBI's holiday matrix page, per office + year
//      (https://www.rbi.org.in/Scripts/HolidayMatrixDisplay.aspx). Fetched
//      monthly for the offices in use, this year and next (RBI publishes next
//      year's list in December). Stored in m_bank_holiday_rbi.
//   3. 2nd and 4th Saturdays (all banks, all states since 2015) are worked out,
//      not stored.
// Hand-entered holidays (m_bank_holiday) are added on top; a hand row with
// hidden_flag = 'Y' removes an automatic holiday on that date.
const cron = require('node-cron');
const moment = require('moment');
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

const RBI_URL = 'https://www.rbi.org.in/Scripts/HolidayMatrixDisplay.aspx';
const IFSC_URL = 'https://ifsc.razorpay.com/';
const FETCH_TIMEOUT_MS = 30000;
const REFETCH_AFTER_DAYS = 25;          // monthly cron; skip offices fetched more recently than this
const CRON_EXPRESSION = '30 6 1 * *';   // 06:30 IST on the 1st of each month
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// GSTIN state code → state
const GST_STATES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
    '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

// State → RBI regional office whose list covers it
const STATE_OFFICE = {
    'andaman and nicobar islands': 'Kolkata', 'andhra pradesh': 'Vijayawada', 'arunachal pradesh': 'Itanagar',
    'assam': 'Guwahati', 'bihar': 'Patna', 'chandigarh': 'Chandigarh', 'chhattisgarh': 'Raipur',
    'dadra and nagar haveli and daman and diu': 'Ahmedabad', 'delhi': 'New Delhi', 'goa': 'Panaji',
    'gujarat': 'Ahmedabad', 'haryana': 'Chandigarh', 'himachal pradesh': 'Shimla',
    'jammu and kashmir': 'Jammu', 'jharkhand': 'Ranchi', 'karnataka': 'Bengaluru', 'kerala': 'Thiruvananthapuram',
    'ladakh': 'Jammu', 'lakshadweep': 'Kochi', 'madhya pradesh': 'Bhopal', 'maharashtra': 'Mumbai',
    'manipur': 'Imphal', 'meghalaya': 'Shillong', 'mizoram': 'Aizawl', 'nagaland': 'Kohima',
    'odisha': 'Bhubaneswar', 'puducherry': 'Chennai', 'punjab': 'Chandigarh', 'rajasthan': 'Jaipur',
    'sikkim': 'Gangtok', 'tamil nadu': 'Chennai', 'telangana': 'Hyderabad', 'tripura': 'Agartala',
    'uttar pradesh': 'Lucknow', 'uttarakhand': 'Dehradun', 'west bengal': 'Kolkata',
};

// Every office on RBI's page, for the hand-pick list
const RBI_OFFICES = ['Agartala', 'Ahmedabad', 'Aizawl', 'Belapur', 'Bengaluru', 'Bhopal', 'Bhubaneswar',
    'Chandigarh', 'Chennai', 'Dehradun', 'Gangtok', 'Guwahati', 'Hyderabad', 'Imphal', 'Itanagar', 'Jaipur',
    'Jammu', 'Kanpur', 'Kochi', 'Kohima', 'Kolkata', 'Lucknow', 'Mumbai', 'Nagpur', 'New Delhi', 'Panaji',
    'Patna', 'Raipur', 'Ranchi', 'Shillong', 'Shimla', 'Srinagar', 'Thiruvananthapuram', 'Vijayawada'];

const q = (sql, replacements, type = QueryTypes.SELECT) => db.sequelize.query(sql, { replacements, type });

// "TAMIL NADU", "Orissa", "NCT of Delhi" → STATE_OFFICE key
function normaliseState(name) {
    let s = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s === 'orissa') s = 'odisha';
    if (s === 'pondicherry') s = 'puducherry';
    if (s.includes('delhi')) s = 'delhi';
    if (s.includes('dadra') || s.includes('daman')) s = 'dadra and nagar haveli and daman and diu';
    if (s.includes('andaman')) s = 'andaman and nicobar islands';
    return s;
}

// The IFSC data still files pre-2014 Telangana branches under Andhra Pradesh
const TELANGANA_DISTRICTS = ['adilabad', 'bhadradri', 'kothagudem', 'hanumakonda', 'hanamkonda', 'hyderabad', 'jagtial',
    'jangaon', 'jayashankar', 'bhupalpally', 'jogulamba', 'gadwal', 'kamareddy', 'karimnagar', 'khammam', 'komaram',
    'mahabubabad', 'mahbubnagar', 'mahabubnagar', 'mancherial', 'medak', 'medchal', 'mulugu', 'nagarkurnool', 'nalgonda',
    'narayanpet', 'nirmal', 'nizamabad', 'peddapalli', 'rajanna', 'sircilla', 'rangareddy', 'ranga reddy', 'sangareddy',
    'siddipet', 'suryapet', 'vikarabad', 'wanaparthy', 'warangal', 'yadadri', 'bhuvanagiri', 'secunderabad'];

// A state named in free text (the location's address); only when exactly one is named
function stateInText(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const found = Object.keys(STATE_OFFICE).filter(k => t.includes(' ' + k + ' '));
    if (/ (tamilnadu|t nadu) /.test(t) && !found.includes('tamil nadu')) found.push('tamil nadu');
    if (/ (pondicherry) /.test(t) && !found.includes('puducherry')) found.push('puducherry');
    if (/ (orissa) /.test(t) && !found.includes('odisha')) found.push('odisha');
    return found.length === 1 ? found[0] : null;
}

const titleCase = (s) => s.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bAnd\b/g, 'and');

// ---------------------------------------------------------------- region

async function lookupIfscState(ifsc) {
    try {
        const res = await fetch(IFSC_URL + encodeURIComponent(ifsc), { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.STATE) return null;
        if (normaliseState(data.STATE) === 'andhra pradesh') {
            const place = `${data.DISTRICT || ''} ${data.CITY || ''} ${data.CENTRE || ''}`.toLowerCase();
            if (TELANGANA_DISTRICTS.some(d => place.includes(d))) return 'Telangana';
        }
        return data.STATE;
    } catch (e) {
        return null;
    }
}

// Works out the office for one location. Never overrides a MANUAL choice.
async function resolveRegion(locationCode) {
    const [loc] = await q(`SELECT location_code, gst_number, address, place FROM m_location WHERE location_code = :locationCode`, { locationCode });
    if (!loc) return null;

    const gst = String(loc.gst_number || '').trim();
    const gstState = GST_STATES[gst.slice(0, 2)];
    if (gstState && STATE_OFFICE[normaliseState(gstState)]) {
        return { state: gstState, office: STATE_OFFICE[normaliseState(gstState)], source: 'GST', detail: `GSTIN ${gst.slice(0, 2)}…` };
    }

    const addrState = stateInText(loc.address);
    if (addrState) {
        return { state: titleCase(addrState), office: STATE_OFFICE[addrState], source: 'ADDRESS', detail: 'Location address' };
    }

    // Own bank accounts only: oil company accounts are the company's branch, not the dealer's
    const banks = await q(
        `SELECT DISTINCT UPPER(TRIM(ifsc_code)) AS ifsc FROM m_bank
         WHERE location_code = :locationCode AND COALESCE(active_flag, 'Y') = 'Y'
           AND COALESCE(is_oil_company, 'N') <> 'Y' AND ifsc_code IS NOT NULL`, { locationCode });
    const votes = {};
    const used = [];
    for (const { ifsc } of banks) {
        if (!IFSC_RE.test(ifsc)) continue;
        const state = await lookupIfscState(ifsc);
        const key = normaliseState(state);
        if (!STATE_OFFICE[key]) continue;
        votes[key] = (votes[key] || 0) + 1;
        used.push(ifsc);
    }
    const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
    if (best) {
        return { state: titleCase(best), office: STATE_OFFICE[best], source: 'IFSC', detail: `IFSC ${used.slice(0, 3).join(', ')}` };
    }
    return { state: null, office: null, source: 'NONE', detail: 'No GST number or bank IFSC to go by' };
}

async function saveRegion(locationCode, r, updatedBy) {
    await q(`INSERT INTO m_bank_holiday_region (location_code, state_name, rbi_office, source, detail, updated_by)
             VALUES (:locationCode, :state, :office, :source, :detail, :updatedBy)
             ON DUPLICATE KEY UPDATE state_name = VALUES(state_name), rbi_office = VALUES(rbi_office),
                 source = VALUES(source), detail = VALUES(detail), updated_by = VALUES(updated_by)`,
        { locationCode, state: r.state, office: r.office, source: r.source, detail: r.detail, updatedBy }, QueryTypes.INSERT);
}

async function getRegion(locationCode) {
    const [row] = await q(`SELECT location_code, state_name, rbi_office, source, detail, updated_at
                           FROM m_bank_holiday_region WHERE location_code = :locationCode`, { locationCode });
    return row || null;
}

// Region for a location, working it out (and fetching its list) the first time
async function ensureRegion(locationCode) {
    let row = await getRegion(locationCode);
    if (row) return row;
    const r = await resolveRegion(locationCode);
    if (!r) return null;
    await saveRegion(locationCode, r, 'system');
    if (r.office) await syncOffice(r.office).catch(() => {});
    return getRegion(locationCode);
}

// Admin picks an office by hand ('' = go back to automatic)
async function setRegion(locationCode, office, personId) {
    if (!office) {
        await q(`DELETE FROM m_bank_holiday_region WHERE location_code = :locationCode`, { locationCode }, QueryTypes.BULKDELETE);
        return ensureRegion(locationCode);
    }
    if (!RBI_OFFICES.includes(office)) throw new Error('Unknown RBI office.');
    const state = Object.keys(STATE_OFFICE).find(k => STATE_OFFICE[k] === office);
    await saveRegion(locationCode, { state: state ? titleCase(state) : null, office, source: 'MANUAL', detail: null }, String(personId));
    await syncOffice(office).catch(() => {});
    return getRegion(locationCode);
}

// ---------------------------------------------------------------- RBI list

const decode = (s) => s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();

const hidden = (html, name) => {
    const m = html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`)) || html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
    return m ? m[1].replace(/&amp;/g, '&') : '';
};

// Page is windows-1252, not UTF-8 (curly quotes in "New Year’s Day")
async function getText(res) {
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    return /utf-8/i.test(type) ? buf.toString('utf8') : new TextDecoder('windows-1252').decode(buf);
}

// Returns [{ date: 'YYYY-MM-DD', description, type }] for one office + year
async function fetchRbiHolidays(office, year) {
    const first = await fetch(RBI_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 PetroMath' } });
    if (!first.ok) throw new Error(`RBI page HTTP ${first.status}`);
    const page = await getText(first);
    const cookie = (first.headers.getSetCookie ? first.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');

    // Office ids come from the page's own dropdown, so a renumbering doesn't break us
    const officeSelect = (page.match(/<select[^>]*name="drRegionalOffice"[^>]*>([\s\S]*?)<\/select>/) || [])[1] || '';
    const opt = [...officeSelect.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)</g)].find(m => decode(m[2]) === office);
    if (!opt) throw new Error(`RBI office "${office}" not on the page`);
    const yearSelect = (page.match(/<select[^>]*name="drYear"[^>]*>([\s\S]*?)<\/select>/) || [])[1] || '';
    if (!new RegExp(`value="${year}"`).test(yearSelect)) return null;   // not published yet

    const body = new URLSearchParams({
        __EVENTTARGET: '', __EVENTARGUMENT: '',
        __VIEWSTATE: hidden(page, '__VIEWSTATE'),
        __VIEWSTATEGENERATOR: hidden(page, '__VIEWSTATEGENERATOR'),
        __EVENTVALIDATION: hidden(page, '__EVENTVALIDATION'),
        drRegionalOffice: opt[1], drMonth: '0', drYear: String(year), btnGo: 'GO',
    });
    const res = await fetch(RBI_URL, {
        method: 'POST', body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 PetroMath', 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
    });
    if (!res.ok) throw new Error(`RBI list HTTP ${res.status}`);
    const html = await getText(res);
    if (!new RegExp(`holiday list for the year ${year}`, 'i').test(html)) throw new Error('RBI list heading not found (page changed?)');

    // Rows: month header (<th> … January), then <tr><td> 1</td><td>Name</td><td>…<span class="HideText">Type</span></td></tr>
    const out = [];
    let month = null;
    for (const row of html.split(/<tr[\s>]/i).slice(1)) {
        const th = row.match(/class="dop_header"[^>]*>\s*([A-Za-z]+)/);
        if (th) { month = moment(th[1], 'MMMM', true).isValid() ? moment(th[1], 'MMMM').month() : null; continue; }
        if (month === null) continue;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
        if (cells.length < 2) continue;
        const day = parseInt(decode(cells[0]), 10);
        if (!day) continue;
        const date = moment({ year, month, day });
        if (!date.isValid()) continue;
        const typeMatch = (cells[2] || '').match(/class="HideText">([^<]*)</);
        out.push({ date: date.format('YYYY-MM-DD'), description: decode(cells[1]).slice(0, 300), type: typeMatch ? decode(typeMatch[1]).slice(0, 60) : null });
    }
    return out;
}

async function logFetch(office, year, status, rowCount, error) {
    await q(`INSERT INTO m_bank_holiday_rbi_fetch (rbi_office, holiday_year, status, row_count, error)
             VALUES (:office, :year, :status, :rowCount, :error)
             ON DUPLICATE KEY UPDATE status = VALUES(status), row_count = VALUES(row_count), error = VALUES(error), fetched_at = NOW()`,
        { office, year, status, rowCount, error: error ? String(error).slice(0, 500) : null }, QueryTypes.INSERT);
}

// Fetches this year and next for one office. A failed or empty fetch keeps the old rows.
async function syncOffice(office, { force = false } = {}) {
    const thisYear = moment().year();
    const results = [];
    for (const year of [thisYear, thisYear + 1]) {
        if (!force) {
            const [last] = await q(`SELECT status, fetched_at FROM m_bank_holiday_rbi_fetch WHERE rbi_office = :office AND holiday_year = :year`, { office, year });
            if (last && last.status === 'OK' && moment().diff(moment(last.fetched_at), 'days') < REFETCH_AFTER_DAYS) {
                results.push({ year, status: 'FRESH' });
                continue;
            }
        }
        try {
            const rows = await fetchRbiHolidays(office, year);
            if (rows === null) { results.push({ year, status: 'NOT_PUBLISHED' }); continue; }
            if (!rows.length) { await logFetch(office, year, 'EMPTY', 0, 'No rows parsed'); results.push({ year, status: 'EMPTY' }); continue; }
            await db.sequelize.transaction(async (transaction) => {
                await db.sequelize.query(`DELETE FROM m_bank_holiday_rbi WHERE rbi_office = :office AND YEAR(holiday_date) = :year`,
                    { replacements: { office, year }, type: QueryTypes.BULKDELETE, transaction });
                for (const r of rows) {
                    await db.sequelize.query(
                        `INSERT INTO m_bank_holiday_rbi (rbi_office, holiday_date, description, holiday_type) VALUES (:office, :date, :description, :type)
                         ON DUPLICATE KEY UPDATE description = CONCAT(description, ' / ', VALUES(description))`,
                        { replacements: { office, ...r }, type: QueryTypes.INSERT, transaction });
                }
            });
            await logFetch(office, year, 'OK', rows.length, null);
            results.push({ year, status: 'OK', count: rows.length });
        } catch (err) {
            await logFetch(office, year, 'FAILED', 0, err.message);
            console.error(`BankHolidays: RBI ${office} ${year} failed:`, err.message);
            results.push({ year, status: 'FAILED', error: err.message });
        }
    }
    return results;
}

// Monthly: work out regions for locations that have none, then refresh every office in use
async function syncAll(trigger) {
    try {
        const missing = await q(`SELECT l.location_code FROM m_location l
                                 LEFT JOIN m_bank_holiday_region r ON r.location_code = l.location_code
                                 WHERE r.location_code IS NULL AND (l.effective_end_date IS NULL OR l.effective_end_date > CURDATE())`);
        for (const { location_code } of missing) {
            const r = await resolveRegion(location_code);
            if (r) await saveRegion(location_code, r, 'system');
        }
        const offices = await q(`SELECT DISTINCT rbi_office FROM m_bank_holiday_region WHERE rbi_office IS NOT NULL`);
        for (const { rbi_office } of offices) await syncOffice(rbi_office);
        console.log(`BankHolidays: ${trigger} — ${missing.length} new location(s), ${offices.length} office(s)`);
    } catch (err) {
        console.error('BankHolidays: sync failed:', err.message);
    }
}

function start() {
    cron.schedule(CRON_EXPRESSION, () => syncAll('SCHEDULED'), { timezone: 'Asia/Kolkata' });
    // First run after deploy fills everything; later restarts only fetch what's stale
    setTimeout(() => syncAll('STARTUP'), 2 * 60 * 1000);
}

// ---------------------------------------------------------------- reading

// 2nd and 4th Saturdays between two dates (YYYY-MM-DD)
function secondFourthSaturdays(from, to) {
    const out = [];
    const d = moment(from, 'YYYY-MM-DD').startOf('month');
    const end = moment(to, 'YYYY-MM-DD');
    while (d.isSameOrBefore(end)) {
        const sat = d.clone().day(6);
        if (sat.month() !== d.month()) sat.add(7, 'days');       // first Saturday of the month
        [sat.clone().add(7, 'days'), sat.clone().add(21, 'days')].forEach((s, i) => {
            const ymd = s.format('YYYY-MM-DD');
            if (ymd >= from && ymd <= to) out.push({ date: ymd, description: i === 0 ? '2nd Saturday' : '4th Saturday' });
        });
        d.add(1, 'month');
    }
    return out;
}

// All holidays for a location between two dates, one per date:
//   [{ holiday_id|null, date, description, source: 'MANUAL'|'RBI'|'SATURDAY' }]
// Hand rows win over automatic ones; a hidden hand row removes the automatic one.
async function getHolidays(locationCode, from, to) {
    const region = await getRegion(locationCode);
    const [manual, rbi] = await Promise.all([
        q(`SELECT holiday_id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS date, description, hidden_flag
           FROM m_bank_holiday WHERE location_code = :locationCode AND holiday_date BETWEEN :from AND :to`, { locationCode, from, to }),
        region && region.rbi_office
            ? q(`SELECT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS date, description
                 FROM m_bank_holiday_rbi WHERE rbi_office = :office AND holiday_date BETWEEN :from AND :to`, { office: region.rbi_office, from, to })
            : Promise.resolve([]),
    ]);
    const byDate = new Map();
    secondFourthSaturdays(from, to).forEach(s => byDate.set(s.date, { holiday_id: null, date: s.date, description: s.description, source: 'SATURDAY' }));
    rbi.forEach(r => {
        const sat = byDate.get(r.date);
        byDate.set(r.date, { holiday_id: null, date: r.date, description: sat ? `${r.description} (${sat.description})` : r.description, source: 'RBI' });
    });
    manual.forEach(m => {
        if (m.hidden_flag === 'Y') {
            const auto = byDate.get(m.date);
            byDate.delete(m.date);
            if (auto) byDate.set('hidden:' + m.date, { ...auto, holiday_id: m.holiday_id, source: 'HIDDEN' });
            return;
        }
        byDate.set(m.date, { holiday_id: m.holiday_id, date: m.date, description: m.description, source: 'MANUAL' });
    });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
    RBI_OFFICES, start, syncAll, syncOffice, ensureRegion, setRegion, getRegion, getHolidays,
    fetchRbiHolidays, resolveRegion, secondFourthSaturdays,
};
