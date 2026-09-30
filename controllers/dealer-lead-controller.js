const dealerLeadDao = require('../dao/dealer-lead-dao');
const moment = require('moment');

const VALID_ROLES = ['OWNER', 'MANAGER', 'OTHER'];

// Pipeline stages, in order. The last two close the lead.
const STATUSES = [
    { code: 'NEW', label: 'New', badge: 'secondary' },
    { code: 'CONTACTED', label: 'Contacted', badge: 'info' },
    { code: 'INTERESTED', label: 'Interested', badge: 'primary' },
    { code: 'DEMO', label: 'Demo', badge: 'warning' },
    { code: 'ONBOARDING', label: 'Onboarding', badge: 'warning' },
    { code: 'WON', label: 'Won', badge: 'success' },
    { code: 'NOT_INTERESTED', label: 'Not interested', badge: 'dark' },
    { code: 'INVALID', label: 'Invalid number', badge: 'danger' }
];

const ACTIVITY_TYPES = [
    { code: 'CALL', label: 'Call' },
    { code: 'WHATSAPP', label: 'WhatsApp' },
    { code: 'VISIT', label: 'Visit' },
    { code: 'DEMO', label: 'Demo' },
    { code: 'NOTE', label: 'Note' }
];

// suggestStatus — what the Log form pre-selects for this outcome (null = keep current)
const OUTCOMES = [
    { code: 'NO_ANSWER', label: 'No answer / switched off', suggestStatus: null },
    { code: 'CALL_BACK', label: 'Asked to call back', suggestStatus: 'CONTACTED' },
    { code: 'INTERESTED', label: 'Interested', suggestStatus: 'INTERESTED' },
    { code: 'DEMO_FIXED', label: 'Demo fixed', suggestStatus: 'DEMO' },
    { code: 'DEMO_DONE', label: 'Demo done', suggestStatus: 'DEMO' },
    { code: 'NOT_INTERESTED', label: 'Not interested', suggestStatus: 'NOT_INTERESTED' },
    { code: 'WRONG_NUMBER', label: 'Wrong number', suggestStatus: 'INVALID' },
    { code: 'OTHER', label: 'Other', suggestStatus: null }
];

const CLOSED_STATUSES = ['WON', 'NOT_INTERESTED', 'INVALID'];

const EDITABLE_FIELDS = [
    { field: 'bunk_name', label: 'Bunk name' },
    { field: 'place', label: 'Place' },
    { field: 'district', label: 'District' },
    { field: 'phone_number', label: 'Phone' },
    { field: 'oil_company', label: 'Oil company' },
    { field: 'contact_person_name', label: 'Contact' },
    { field: 'contact_role', label: 'Role' },
    { field: 'is_priority', label: 'Priority' },
    { field: 'notes', label: 'Notes' },
    { field: 'needs_verification', label: 'Needs verification' }
];

const labelOf = (list, code) => (list.find(x => x.code === code) || {}).label || code;

const FILTER_KEYS = ['event', 'status', 'owner', 'priority', 'district', 'oil_company', 'due', 'q'];

const readFilters = (query) => {
    const filters = {};
    FILTER_KEYS.forEach(key => {
        const value = (query[key] || '').toString().trim();
        if (value) filters[key] = value;
    });
    return filters;
};

// "wa.me" needs the country code; stall leads are 10-digit Indian mobiles
const whatsappNumber = (phone) => {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length === 10 ? '91' + digits : null;
};

module.exports = {

    // GET - Public lead capture form (no login required)
    getPublicForm: (req, res) => {
        res.render('dealer-lead-form');
    },

    // POST - Submit a lead (no login required)
    submitLead: async (req, res) => {
        try {
            const bunkName = (req.body.bunk_name || '').trim();
            const place = (req.body.place || '').trim();
            const district = (req.body.district || '').trim();
            const phoneNumber = (req.body.phone_number || '').trim();
            const oilCompany = (req.body.oil_company || '').trim();
            const contactRole = (req.body.contact_role || '').trim().toUpperCase();
            const contactPersonName = (req.body.contact_person_name || '').trim();
            const generatedBy = (req.body.generated_by || '').trim();
            const notes = (req.body.notes || '').trim();

            if (!bunkName || !place || !district || !phoneNumber || !oilCompany || !contactRole) {
                return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
            }
            if (!/^\d{10}$/.test(phoneNumber)) {
                return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit phone number.' });
            }
            if (!VALID_ROLES.includes(contactRole)) {
                return res.status(400).json({ success: false, message: 'Please select whether you are the Owner, Manager, or Other.' });
            }

            await dealerLeadDao.saveLead({
                bunk_name: bunkName,
                place: place,
                district: district,
                phone_number: phoneNumber,
                oil_company: oilCompany,
                contact_person_name: contactPersonName,
                contact_role: contactRole,
                lead_mode: 'STALL',
                generated_by: generatedBy,
                notes: notes,
                ip_address: req.ip || null
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Error saving dealer lead:', error);
            res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
        }
    },

    // GET - Lead list with filters and summary tiles (MANAGE_DEALER_LEADS)
    getAdminList: async (req, res, next) => {
        try {
            const filters = readFilters(req.query);
            const [leads, summary, options, assignees] = await Promise.all([
                dealerLeadDao.getLeads(filters, req.user.Person_id),
                dealerLeadDao.getSummary(),
                dealerLeadDao.getFilterOptions(),
                dealerLeadDao.getAssignees()
            ]);

            const today = moment().startOf('day');
            leads.forEach(lead => {
                lead.wa_number = whatsappNumber(lead.phone_number);
                lead.is_open = !CLOSED_STATUSES.includes(lead.status);
                lead.is_overdue = lead.is_open && lead.next_followup_date && moment(lead.next_followup_date).isBefore(today);
                lead.is_due_today = lead.is_open && lead.next_followup_date && moment(lead.next_followup_date).isSame(today, 'day');
            });

            res.render('dealer-lead-admin', {
                title: 'Dealer Leads',
                user: req.user,
                leads,
                summary,
                options,
                assignees,
                filters,
                statuses: STATUSES,
                queryString: new URLSearchParams(filters).toString(),
                moment
            });
        } catch (error) {
            next(error);
        }
    },

    // GET - One lead: details, activity timeline, log form
    getLeadDetail: async (req, res, next) => {
        try {
            const lead = await dealerLeadDao.getLeadById(parseInt(req.params.leadId, 10) || 0);
            if (!lead) {
                req.flash('error', 'Lead not found.');
                return res.redirect('/dealer-leads/admin');
            }
            const [activities, assignees] = await Promise.all([
                dealerLeadDao.getActivities(lead.lead_id),
                dealerLeadDao.getAssignees()
            ]);
            activities.forEach(a => {
                a.activity_label = a.activity_type === 'EDIT' ? 'Details edited' : labelOf(ACTIVITY_TYPES, a.activity_type);
                a.outcome_label = a.activity_type === 'EDIT' ? '' : labelOf(OUTCOMES, a.outcome);
                a.status_label = labelOf(STATUSES, a.status_after);
            });

            res.render('dealer-lead-detail', {
                title: 'Dealer Lead',
                user: req.user,
                lead,
                activities,
                assignees,
                statuses: STATUSES,
                activityTypes: ACTIVITY_TYPES,
                outcomes: OUTCOMES,
                closedStatuses: CLOSED_STATUSES,
                oilCompanies: ['IOCL', 'BPCL', 'HPCL', 'Shell', 'Nayara Energy', 'Reliance', 'Other', 'Not noted'],
                roles: VALID_ROLES,
                waNumber: whatsappNumber(lead.phone_number),
                backQuery: (req.query.back || '').toString(),
                moment
            });
        } catch (error) {
            next(error);
        }
    },

    // POST - Log a call / visit / note against a lead
    logActivity: async (req, res, next) => {
        const leadId = parseInt(req.params.leadId, 10) || 0;
        const detailUrl = `/dealer-leads/admin/${leadId}`;
        try {
            const lead = await dealerLeadDao.getLeadById(leadId);
            if (!lead) {
                req.flash('error', 'Lead not found.');
                return res.redirect('/dealer-leads/admin');
            }

            const activityType = (req.body.activity_type || '').trim();
            const outcome = (req.body.outcome || '').trim();
            const status = (req.body.status || '').trim();
            const notes = (req.body.notes || '').trim();
            const assignedTo = parseInt(req.body.assigned_to, 10) || null;
            let nextFollowupDate = (req.body.next_followup_date || '').trim() || null;

            if (!ACTIVITY_TYPES.some(t => t.code === activityType) || !OUTCOMES.some(o => o.code === outcome)
                || !STATUSES.some(s => s.code === status)) {
                req.flash('error', 'Please choose the activity, outcome and status.');
                return res.redirect(detailUrl);
            }
            if (nextFollowupDate && !moment(nextFollowupDate, 'YYYY-MM-DD', true).isValid()) {
                req.flash('error', 'Next follow-up date is not a valid date.');
                return res.redirect(detailUrl);
            }
            if (CLOSED_STATUSES.includes(status)) {
                nextFollowupDate = null;
            } else if (!nextFollowupDate) {
                req.flash('error', 'Please set the next follow-up date (the lead is still open).');
                return res.redirect(detailUrl);
            }
            if (assignedTo) {
                const assignees = await dealerLeadDao.getAssignees();
                if (!assignees.some(a => a.Person_id === assignedTo)) {
                    req.flash('error', 'That person cannot be assigned leads.');
                    return res.redirect(detailUrl);
                }
            }

            await dealerLeadDao.logActivity(leadId, {
                activity_type: activityType,
                outcome,
                notes,
                status,
                assigned_to: assignedTo,
                next_followup_date: nextFollowupDate
            }, req.user);

            req.flash('success', 'Logged.');
            res.redirect(detailUrl);
        } catch (error) {
            next(error);
        }
    },

    // POST - Correct the lead's own details (phone, name, place...)
    updateLead: async (req, res, next) => {
        const leadId = parseInt(req.params.leadId, 10) || 0;
        const detailUrl = `/dealer-leads/admin/${leadId}`;
        try {
            const lead = await dealerLeadDao.getLeadById(leadId);
            if (!lead) {
                req.flash('error', 'Lead not found.');
                return res.redirect('/dealer-leads/admin');
            }

            const changes = {};
            EDITABLE_FIELDS.forEach(({ field }) => {
                changes[field] = (req.body[field] || '').toString().trim();
            });
            changes.is_priority = req.body.is_priority === 'Y' ? 'Y' : 'N';
            changes.contact_role = changes.contact_role.toUpperCase();

            if (!changes.bunk_name || !changes.place || !changes.district || !changes.oil_company) {
                req.flash('error', 'Bunk name, place, district and oil company cannot be empty (use "Not noted").');
                return res.redirect(detailUrl);
            }
            if (!VALID_ROLES.includes(changes.contact_role)) {
                req.flash('error', 'Please choose a valid role.');
                return res.redirect(detailUrl);
            }
            if (changes.phone_number.length > 15) {
                req.flash('error', 'Phone number is too long.');
                return res.redirect(detailUrl);
            }

            const changed = EDITABLE_FIELDS
                .filter(({ field }) => (lead[field] || '') !== (changes[field] || ''))
                .map(({ field, label }) => `${label}: "${lead[field] || ''}" → "${changes[field] || ''}"`);
            if (changed.length === 0) {
                req.flash('success', 'No changes.');
                return res.redirect(detailUrl);
            }

            await dealerLeadDao.updateLeadDetails(lead, changes, changed.join('; '), req.user);
            req.flash('success', 'Lead details updated.');
            res.redirect(detailUrl);
        } catch (error) {
            next(error);
        }
    },

    // GET - CSV export of the currently filtered leads (MANAGE_DEALER_LEADS)
    exportCsv: async (req, res, next) => {
        try {
            const leads = await dealerLeadDao.getLeads(readFilters(req.query), req.user.Person_id);
            const headers = ['Bunk Name', 'Place', 'District', 'Phone Number', 'Oil Company', 'Contact Person', 'Role',
                'Status', 'Owner', 'Next Follow-up', 'Last Contacted', 'Lead Mode', 'Event', 'Priority',
                'Generated By', 'Notes', 'Needs Verification', 'Collected On'];
            const escapeCsv = (value) => {
                const str = value === null || value === undefined ? '' : String(value);
                return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
            };
            const rows = leads.map(lead => [
                lead.bunk_name, lead.place, lead.district, lead.phone_number, lead.oil_company,
                lead.contact_person_name, lead.contact_role,
                labelOf(STATUSES, lead.status), lead.assigned_to_name,
                lead.next_followup_date ? moment(lead.next_followup_date).format('DD-MMM-YYYY') : '',
                lead.last_contacted_at ? moment(lead.last_contacted_at).format('DD-MMM-YYYY HH:mm') : '',
                lead.lead_mode, lead.event_name, lead.is_priority,
                lead.generated_by, lead.notes, lead.needs_verification,
                moment(lead.creation_date).format('DD-MMM-YYYY HH:mm')
            ].map(escapeCsv).join(','));

            const csv = [headers.join(','), ...rows].join('\n');
            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename="dealer-leads-${moment().format('YYYY-MM-DD')}.csv"`);
            res.send(csv);
        } catch (error) {
            next(error);
        }
    }
};
