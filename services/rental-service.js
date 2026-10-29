// services/rental-service.js — monthly rent drafts and rent escalation (tkt #35).
// Used by the Create drafts button (rental-controller) and the invoice-day
// scheduler (rental-draft-scheduler), so both price a month the same way.
const RentalDao = require('../dao/rental-dao');

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST',
    'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 'YYYY-MM' -> 'YYYY-MM-01' (or null)
function monthStart(ym) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || '')) ? `${ym}-01` : null;
}

// 'YYYY-MM-01' + n months -> 'YYYY-MM-01'
function addMonths(isoMonth, n) {
    const [y, m] = isoMonth.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

// 'YYYY-MM-01' -> 'Aug-2027'
function monthLabel(isoMonth) {
    const [y, m] = isoMonth.split('-');
    const name = MONTHS[Number(m) - 1];
    return `${name[0]}${name.slice(1, 3).toLowerCase()}-${y}`;
}

// "BUILDING RENT FOR THE MONTH OF OCTOBER-2026"
function defaultDescription(tenant, ym) {
    const [y, m] = ym.split('-');
    return `${tenant.rent_description} FOR THE MONTH OF ${MONTHS[Number(m) - 1]}-${y}`;
}

// The invoice date is the location's invoice day (26th) in the rent month, capped to the month end
function defaultInvoiceDate(ym, invoiceDay) {
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const day = Math.min(Number(invoiceDay) || 26, lastDay);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Intra-state rent: GST rate split equally into CGST + SGST
function computeAmounts(taxableValue, gstRate, tdsPercent) {
    const taxable = round2(taxableValue);
    const halfRate = round2(Number(gstRate) / 2);
    const cgst = round2(taxable * halfRate / 100);
    const sgst = cgst;
    return {
        taxable_value: taxable,
        cgst_rate: halfRate,
        sgst_rate: halfRate,
        cgst_amount: cgst,
        sgst_amount: sgst,
        total_amount: round2(taxable + cgst + sgst),
        tds_amount: round2(taxable * (Number(tdsPercent) || 0) / 100),
    };
}

// Adds the ESCALATION revisions that fall due on or before periodMonth and moves
// the tenant's next-escalation month on. Each step compounds on the rent in force
// at that month, rounded to the rupee. A revision already entered for that month
// (a fixed amount from the agreement) wins over the % rule.
async function applyDueEscalations(tenantId, periodMonth, by) {
    const rule = await RentalDao.getEscalation(tenantId);
    if (!rule || !Number(rule.escalation_percent) || !Number(rule.escalation_every_months) || !rule.escalation_next) return 0;
    const pct = Number(rule.escalation_percent);
    let next = rule.escalation_next;
    let added = 0;
    while (next <= periodMonth) {
        if (!(await RentalDao.revisionExists(tenantId, next))) {
            const base = await RentalDao.getRentForMonth(tenantId, next);
            if (base !== null) {
                await RentalDao.insertRevision(tenantId, next, Math.round(base * (1 + pct / 100)), 'ESCALATION', `+${pct}% escalation`, by);
                added++;
            }
        }
        next = addMonths(next, Number(rule.escalation_every_months));
    }
    if (next !== rule.escalation_next) {
        await RentalDao.setEscalation(tenantId, pct, Number(rule.escalation_every_months), next, by);
        await RentalDao.syncCurrentRent(tenantId);
    }
    return added;
}

// Rent for a tenant's month, after any escalation due by then
async function rentForMonth(tenant, periodMonth, by) {
    await applyDueEscalations(tenant.tenant_id, periodMonth, by);
    const rent = await RentalDao.getRentForMonth(tenant.tenant_id, periodMonth);
    return rent !== null ? rent : Number(tenant.monthly_rent);
}

// One draft per tenant active in the month that has none yet. Returns the drafts made.
async function createDraftsForMonth(locationCode, ym, createdBy) {
    const periodMonth = monthStart(ym);
    const settings = await RentalDao.getSettings(locationCode);
    const due = await RentalDao.getTenantsDueForMonth(locationCode, periodMonth);
    const created = [];
    for (const t of due) {
        const rent = await rentForMonth(t, periodMonth, createdBy);
        const amounts = computeAmounts(rent, t.gst_rate, t.tds_percent);
        await RentalDao.insertDraft(locationCode, {
            tenant_id: t.tenant_id,
            invoice_date: defaultInvoiceDate(ym, settings.invoice_day),
            period_month: periodMonth,
            description: defaultDescription(t, ym),
            sac_code: t.sac_code,
            ...amounts,
        }, createdBy);
        created.push({ tenant_name: t.tenant_name, total_amount: amounts.total_amount });
    }
    return created;
}

module.exports = {
    MONTHS, round2, monthStart, addMonths, monthLabel, defaultInvoiceDate, computeAmounts,
    applyDueEscalations, createDraftsForMonth,
};
