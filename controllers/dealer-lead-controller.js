const dealerLeadDao = require('../dao/dealer-lead-dao');
const DocumentStoreDao = require('../dao/document-store-dao');
const attachmentUpload = require('../utils/attachment-upload');
const moment = require('moment');

// Attachments (visiting card, bunk photo, quote PDF...) in t_document_store
// (entity_type DEALER_LEAD, entity_id = lead_id). Served only via /dealer-leads/admin/:id/attachments.
const ATTACHMENT_ENTITY = 'DEALER_LEAD';
const ATTACHMENT_MAX_FILES = 2;
const ATTACHMENT_MAX_MB = 5;
const ATTACHMENT_COUNT_ERROR = `A lead can have at most ${ATTACHMENT_MAX_FILES} attachments`;

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

const OIL_COMPANIES = ['IOCL', 'BPCL', 'HPCL', 'Shell', 'Nayara Energy', 'Reliance', 'Other', 'Not noted'];

// How a lead added from the leads page reached us (stall leads come from the public form)
const LEAD_MODES = [
    { code: 'PHONE', label: 'Phone call' },
    { code: 'WHATSAPP', label: 'WhatsApp' },
    { code: 'WEBSITE', label: 'Website' },
    { code: 'STALL', label: 'Stall / event' }
];

const labelOf = (list, code) => (list.find(x => x.code === code) || {}).label || code;

// A TeleCaller works only the leads assigned to her: returns her Person_id to
// scope the list by, or null for everyone else (sees all leads)
const ownLeadsOf = (user) => (user.Role === 'TeleCaller' ? user.Person_id : null);
const canSeeLead = (user, lead) => !ownLeadsOf(user) || lead.assigned_to === user.Person_id;

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

// The lead's attachment, or null if it isn't this lead's
const findLeadAttachment = async (lead, docId, withData) => {
    const doc = withData ? await DocumentStoreDao.findById(docId) : await DocumentStoreDao.findMetaById(docId);
    if (!doc || doc.entity_type !== ATTACHMENT_ENTITY || Number(doc.entity_id) !== Number(lead.lead_id) || doc.status !== 'ACTIVE') return null;
    return doc;
};

// The lead, if this user may work it
const findVisibleLead = async (req) => {
    const lead = await dealerLeadDao.getLeadById(parseInt(req.params.leadId, 10) || 0);
    return lead && canSeeLead(req.user, lead) ? lead : null;
};

module.exports = {
    ATTACHMENT_MAX_FILES,
    ATTACHMENT_MAX_MB,
    ATTACHMENT_COUNT_ERROR,

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
            const ownerId = ownLeadsOf(req.user);
            const [leads, summary, options, assignees] = await Promise.all([
                dealerLeadDao.getLeads(filters, req.user.Person_id, ownerId),
                dealerLeadDao.getSummary(ownerId),
                dealerLeadDao.getFilterOptions(ownerId),
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
                mobileReady: true,   // lead rows stack into cards on phones (m-stack)
                user: req.user,
                canExport: req.user.Role !== 'TeleCaller',
                ownLeadsOnly: !!ownerId,
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
            if (!lead || !canSeeLead(req.user, lead)) {
                req.flash('error', 'Lead not found.');
                return res.redirect('/dealer-leads/admin');
            }
            const [activities, assignees, attachments] = await Promise.all([
                dealerLeadDao.getActivities(lead.lead_id),
                dealerLeadDao.getAssignees(),
                DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, lead.lead_id)
            ]);
            activities.forEach(a => {
                a.activity_label = a.activity_type === 'EDIT' ? 'Details edited' : labelOf(ACTIVITY_TYPES, a.activity_type);
                a.outcome_label = a.activity_type === 'EDIT' ? '' : labelOf(OUTCOMES, a.outcome);
                a.status_label = labelOf(STATUSES, a.status_after);
            });

            res.render('dealer-lead-detail', {
                title: 'Dealer Lead',
                mobileReady: true,
                user: req.user,
                lead,
                activities,
                assignees,
                statuses: STATUSES,
                activityTypes: ACTIVITY_TYPES,
                outcomes: OUTCOMES,
                closedStatuses: CLOSED_STATUSES,
                oilCompanies: OIL_COMPANIES,
                roles: VALID_ROLES,
                waNumber: whatsappNumber(lead.phone_number),
                backQuery: (req.query.back || '').toString(),
                attachments,
                maxFiles: ATTACHMENT_MAX_FILES,
                maxMb: ATTACHMENT_MAX_MB,
                canRemoveAny: req.user.Role !== 'TeleCaller',
                fmtSize: attachmentUpload.fmtSize,
                moment
            });
        } catch (error) {
            next(error);
        }
    },

    // POST - Attach photos / PDFs to a lead (fetch from the detail page; JSON reply)
    addAttachments: async (req, res) => {
        try {
            const lead = await findVisibleLead(req);
            if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

            const existing = await DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, lead.lead_id);
            const upload = attachmentUpload.checkFiles(req, existing.length, ATTACHMENT_MAX_FILES, ATTACHMENT_COUNT_ERROR);
            if (upload.error) return res.status(400).json({ success: false, error: upload.error });
            if (!upload.files.length) return res.status(400).json({ success: false, error: 'Choose a file to attach' });

            const captureSource = req.body.capture_source === 'CAMERA' ? 'CAMERA' : 'UPLOAD';
            await Promise.all(upload.files.map(f => DocumentStoreDao.create({
                entity_type: ATTACHMENT_ENTITY,
                entity_id: lead.lead_id,
                doc_category: 'ATTACHMENT',
                file_name: f.file_name,
                mime_type: f.mime_type,
                file_size: f.buffer.length,
                file_data: f.buffer,
                capture_source: captureSource,
                created_by: req.user.User_Name
            })));
            res.json({ success: true });
        } catch (error) {
            console.error('Error attaching to dealer lead:', error);
            res.status(500).json({ success: false, error: 'Failed to attach file. Please try again.' });
        }
    },

    // GET - Show / download an attachment, only if this user can see the lead
    getAttachment: async (req, res) => {
        try {
            const lead = await findVisibleLead(req);
            const doc = lead && await findLeadAttachment(lead, parseInt(req.params.docId, 10), true);
            if (!doc) return res.status(404).send('Attachment not found');
            attachmentUpload.sendDocument(res, doc, req.query.download === '1');
        } catch (error) {
            console.error('Error loading dealer lead attachment:', error);
            res.status(500).send('Failed to load attachment');
        }
    },

    // DELETE - Remove an attachment: the person who attached it, or a non-TeleCaller
    deleteAttachment: async (req, res) => {
        try {
            const lead = await findVisibleLead(req);
            const doc = lead && await findLeadAttachment(lead, parseInt(req.params.docId, 10), false);
            if (!doc) return res.status(404).json({ success: false, error: 'Attachment not found' });
            if (req.user.Role === 'TeleCaller' && doc.created_by !== req.user.User_Name) {
                return res.status(403).json({ success: false, error: 'Only the person who attached it can remove it' });
            }
            await DocumentStoreDao.deleteById(doc.doc_id);
            res.json({ success: true });
        } catch (error) {
            console.error('Error removing dealer lead attachment:', error);
            res.status(500).json({ success: false, error: 'Failed to remove attachment' });
        }
    },

    // GET - Add a lead by hand (a call that came in, a referral...)
    getNewLeadForm: async (req, res, next) => {
        try {
            const [assignees, options] = await Promise.all([
                dealerLeadDao.getAssignees(),
                dealerLeadDao.getFilterOptions()
            ]);
            res.render('dealer-lead-new', {
                title: 'Add Dealer Lead',
                mobileReady: true,
                user: req.user,
                assignees,
                events: options.events,
                oilCompanies: OIL_COMPANIES,
                roles: VALID_ROLES,
                leadModes: LEAD_MODES,
                moment
            });
        } catch (error) {
            next(error);
        }
    },

    // POST - Save a hand-entered lead; blanks the dealer didn't give become "Not noted"
    createLead: async (req, res, next) => {
        const formUrl = '/dealer-leads/admin/new';
        try {
            const field = (name) => (req.body[name] || '').toString().trim();
            const phoneNumber = field('phone_number').replace(/\D/g, '');
            const contactPersonName = field('contact_person_name');
            const contactRole = field('contact_role').toUpperCase();
            const leadMode = field('lead_mode');
            const oilCompany = field('oil_company') || 'Not noted';
            const assignedTo = parseInt(req.body.assigned_to, 10) || null;
            const nextFollowupDate = field('next_followup_date') || null;

            if (!/^\d{10}$/.test(phoneNumber)) {
                req.flash('error', 'Please enter a valid 10-digit phone number.');
                return res.redirect(formUrl);
            }
            if (!contactPersonName && !field('bunk_name')) {
                req.flash('error', 'Please enter the contact person or the bunk name.');
                return res.redirect(formUrl);
            }
            if (!VALID_ROLES.includes(contactRole) || !LEAD_MODES.some(m => m.code === leadMode)
                || !OIL_COMPANIES.includes(oilCompany)) {
                req.flash('error', 'Please choose the role, oil company and how the lead came in.');
                return res.redirect(formUrl);
            }
            if (nextFollowupDate && !moment(nextFollowupDate, 'YYYY-MM-DD', true).isValid()) {
                req.flash('error', 'Next follow-up date is not a valid date.');
                return res.redirect(formUrl);
            }
            if (assignedTo) {
                const assignees = await dealerLeadDao.getAssignees();
                if (!assignees.some(a => a.Person_id === assignedTo)) {
                    req.flash('error', 'That person cannot be assigned leads.');
                    return res.redirect(formUrl);
                }
            }

            // Same number already on file → open that lead instead of adding a duplicate
            const existing = await dealerLeadDao.findLeadByPhone(phoneNumber);
            if (existing) {
                const name = existing.contact_person_name || existing.bunk_name;
                if (!canSeeLead(req.user, existing)) {
                    req.flash('warning', `This number is already a lead (${name}), handled by ${existing.assigned_to_name || 'the office'}.`);
                    return res.redirect(formUrl);
                }
                req.flash('warning', `This number is already a lead (${name}). Log your call here.`);
                return res.redirect(`/dealer-leads/admin/${existing.lead_id}`);
            }

            const leadId = await dealerLeadDao.createLead({
                bunk_name: field('bunk_name') || 'Not noted',
                place: field('place') || 'Not noted',
                district: field('district') || 'Not noted',
                phone_number: phoneNumber,
                oil_company: oilCompany,
                contact_person_name: contactPersonName,
                contact_role: contactRole,
                lead_mode: leadMode,
                event_name: field('event_name'),
                is_priority: req.body.is_priority === 'Y' ? 'Y' : 'N',
                assigned_to: assignedTo,
                next_followup_date: nextFollowupDate,
                generated_by: req.user.Person_Name,
                notes: field('notes').slice(0, 500)
            }, req.user);

            if (!canSeeLead(req.user, { assigned_to: assignedTo })) {
                req.flash('success', 'Lead added and handed over.');
                return res.redirect('/dealer-leads/admin');
            }
            req.flash('success', 'Lead added.');
            res.redirect(`/dealer-leads/admin/${leadId}`);
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
            if (!lead || !canSeeLead(req.user, lead)) {
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

            // TeleCaller handed the lead to someone else — it leaves her list
            if (!canSeeLead(req.user, { assigned_to: assignedTo })) {
                req.flash('success', 'Logged and handed over.');
                return res.redirect('/dealer-leads/admin');
            }
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
            if (!lead || !canSeeLead(req.user, lead)) {
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
    // GET - Daily leads report: hot leads to chase, who did what this week,
    // and a WhatsApp-ready text to send to the team
    getDailyReport: async (req, res, next) => {
        try {
            const today = moment().utcOffset('+05:30').format('YYYY-MM-DD');
            const [hot, warmByNotes, counts, team, backlog] = await Promise.all([
                dealerLeadDao.getHotLeads(today),
                dealerLeadDao.getWarmByNotes(today),
                dealerLeadDao.getReportCounts(today),
                dealerLeadDao.getTeamActivity(today),
                dealerLeadDao.getOwnerBacklog(today)
            ]);

            const daysSince = (dt) => (dt ? moment(today).diff(moment(moment(dt).format('YYYY-MM-DD')), 'days') : null);
            counts.days_since_call = daysSince(counts.last_call_at);
            counts.days_since_lead = daysSince(counts.last_lead_at);
            counts.days_since_won = daysSince(counts.last_won_at);

            hot.forEach(lead => {
                lead.wa_number = whatsappNumber(lead.phone_number);
                lead.status_label = labelOf(STATUSES, lead.status);
                lead.is_due = !lead.next_followup_date || lead.days_overdue >= 0;
                lead.latest_note = lead.last_activity_note || lead.notes || '';
            });
            warmByNotes.forEach(lead => { lead.wa_number = whatsappNumber(lead.phone_number); });

            // Everyone who owns open leads shows in team activity, even with zero calls
            backlog.forEach(b => {
                if (b.owner !== 'Unassigned' && !team.some(t => t.who === b.owner)) {
                    team.push({ who: b.owner, calls: 0, added: 0, moved_up: 0, closed: 0, last_at: null, calls_yday: 0, added_yday: 0 });
                }
            });
            const zeroCallers = team.filter(t => Number(t.calls) === 0).map(t => t.who);

            const dueHot = hot.filter(l => l.is_due);
            const fmt = (d) => moment(d).format('DD-MMM-YYYY');
            const short = (s, n) => (s && s.length > n ? s.substring(0, n - 1) + '…' : (s || ''));

            // WhatsApp text: *bold*, numbers become tappable
            const lines = [];
            lines.push(`*PetroMath – Leads report ${fmt(today)}*`);
            lines.push('');
            lines.push(`Hot leads open: *${hot.length}* · due or overdue: *${dueHot.length}*`);
            lines.push(`Calls logged yesterday: *${counts.calls_yesterday || 0}* · last 7 days: *${counts.calls_7d || 0}*`);
            lines.push(`New leads last 7 days: *${counts.added_7d || 0}*`);
            lines.push(`ROs won: *${counts.won_total || 0}*` +
                (counts.last_won_at ? ` · last win ${counts.days_since_won} days ago` : ' · none yet'));
            if (counts.days_since_call >= 2) {
                lines.push(`⚠️ No call logged for *${counts.days_since_call} days*`);
            }
            if (zeroCallers.length) {
                lines.push(`⚠️ No calls logged in 7 days: *${zeroCallers.join(', ')}*`);
            }
            lines.push('');
            if (dueHot.length) {
                lines.push('*🔥 Call today – hot leads*');
                const byOwner = {};
                dueHot.forEach(l => {
                    const owner = l.assigned_to_name || 'Unassigned';
                    (byOwner[owner] = byOwner[owner] || []).push(l);
                });
                Object.keys(byOwner).forEach(owner => {
                    lines.push('');
                    lines.push(`_${owner}_`);
                    byOwner[owner].forEach((l, i) => {
                        const due = !l.next_followup_date ? 'no follow-up date'
                            : (l.days_overdue > 0 ? `${l.days_overdue} days overdue` : 'due today');
                        lines.push(`${i + 1}. *${l.bunk_name}*, ${l.place}${l.contact_person_name ? ' – ' + l.contact_person_name : ''}`);
                        lines.push(`   📞 ${l.phone_number || '-'} · ${l.status_label} · ${due}`);
                        if (l.latest_note) lines.push(`   ${short(l.latest_note, 120)}`);
                    });
                });
                lines.push('');
            }
            if (warmByNotes.length) {
                const n = warmByNotes.length;
                lines.push(`*👀 ${n} more ${n === 1 ? 'lead sounds' : 'leads sound'} warm in the notes but ${n === 1 ? 'is' : 'are'} still New* – open the report and star or mark Interested.`);
                lines.push('');
            }
            lines.push('*After every call:* open the lead → *Log call* → set status + next follow-up date.');

            res.render('dealer-lead-report', {
                title: 'Leads Report',
                mobileReady: true,
                user: req.user,
                today,
                hot,
                dueHot,
                warmByNotes,
                counts,
                team,
                backlog,
                shareText: lines.join('\n'),
                moment
            });
        } catch (error) {
            next(error);
        }
    },

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
