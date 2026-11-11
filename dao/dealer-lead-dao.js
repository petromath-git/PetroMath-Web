const db = require("../db/db-connection");

const OPEN_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'DEMO', 'ONBOARDING'];

// Builds the WHERE clause for the admin list / CSV export from the filter bar.
// ownerId (TeleCaller) limits everything to leads assigned to that person.
const buildLeadFilter = (filters, currentPersonId, ownerId) => {
    const where = [];
    const replacements = { openStatuses: OPEN_STATUSES };

    if (ownerId) {
        where.push('l.assigned_to = :ownerId');
        replacements.ownerId = ownerId;
    }
    if (filters.event) {
        where.push('l.event_name = :event');
        replacements.event = filters.event;
    }
    if (filters.status === 'OPEN') {
        where.push('l.status IN (:openStatuses)');
    } else if (filters.status === 'CLOSED') {
        where.push('l.status NOT IN (:openStatuses)');
    } else if (filters.status) {
        where.push('l.status = :status');
        replacements.status = filters.status;
    }
    if (filters.owner === 'me') {
        where.push('l.assigned_to = :me');
        replacements.me = currentPersonId;
    } else if (filters.owner === 'none') {
        where.push('l.assigned_to IS NULL');
    } else if (filters.owner) {
        where.push('l.assigned_to = :owner');
        replacements.owner = parseInt(filters.owner, 10) || 0;
    }
    if (filters.priority === 'Y') {
        where.push("l.is_priority = 'Y'");
    }
    if (filters.district) {
        where.push('l.district = :district');
        replacements.district = filters.district;
    }
    if (filters.oil_company) {
        where.push('l.oil_company = :oilCompany');
        replacements.oilCompany = filters.oil_company;
    }
    if (filters.due === 'overdue') {
        where.push('l.status IN (:openStatuses) AND l.next_followup_date < CURDATE()');
    } else if (filters.due === 'today') {
        where.push('l.status IN (:openStatuses) AND l.next_followup_date = CURDATE()');
    } else if (filters.due === 'week') {
        where.push('l.status IN (:openStatuses) AND l.next_followup_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY');
    } else if (filters.due === 'none') {
        where.push('l.status IN (:openStatuses) AND l.next_followup_date IS NULL');
    }
    if (filters.q) {
        where.push(`(l.bunk_name LIKE :q OR l.contact_person_name LIKE :q OR l.phone_number LIKE :q
                     OR l.place LIKE :q OR l.notes LIKE :q)`);
        replacements.q = `%${filters.q}%`;
    }

    return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', replacements };
};

module.exports = {

    OPEN_STATUSES,

    saveLead: async (data) => {
        await db.sequelize.query(`
            INSERT INTO t_dealer_lead
                (bunk_name, place, district, phone_number, oil_company,
                 contact_person_name, contact_role, lead_mode, generated_by, notes, ip_address, creation_date)
            VALUES
                (:bunkName, :place, :district, :phoneNumber, :oilCompany,
                 :contactPersonName, :contactRole, :leadMode, :generatedBy, :notes, :ipAddress, NOW())
        `, {
            replacements: {
                bunkName: data.bunk_name,
                place: data.place,
                district: data.district,
                phoneNumber: data.phone_number,
                oilCompany: data.oil_company,
                contactPersonName: data.contact_person_name || null,
                contactRole: data.contact_role,
                leadMode: data.lead_mode,
                generatedBy: data.generated_by || null,
                notes: data.notes || null,
                ipAddress: data.ip_address || null
            },
            type: db.Sequelize.QueryTypes.INSERT
        });
    },

    // Open leads first, soonest follow-up first; closed leads last
    getLeads: async (filters, currentPersonId, ownerId = null) => {
        const { whereSql, replacements } = buildLeadFilter(filters, currentPersonId, ownerId);
        return db.sequelize.query(`
            SELECT l.lead_id, l.bunk_name, l.place, l.district, l.phone_number, l.oil_company,
                   l.contact_person_name, l.contact_role, l.lead_mode, l.event_name, l.is_priority,
                   l.status, l.assigned_to, p.Person_Name AS assigned_to_name,
                   l.next_followup_date, l.last_contacted_at,
                   l.generated_by, l.notes, l.needs_verification, l.creation_date,
                   (SELECT COUNT(*) FROM t_dealer_lead_activity a WHERE a.lead_id = l.lead_id) AS activity_count
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            ${whereSql}
            ORDER BY (l.status IN (:openStatuses)) DESC,
                     (l.next_followup_date IS NULL), l.next_followup_date,
                     (l.is_priority = 'Y') DESC, l.lead_id
        `, {
            replacements,
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Counts for the summary tiles — across all leads (or ownerId's), ignoring the filter bar
    getSummary: async (ownerId = null) => {
        const rows = await db.sequelize.query(`
            SELECT
                COUNT(*) AS total,
                SUM(status IN (:openStatuses) AND next_followup_date < CURDATE()) AS overdue,
                SUM(status IN (:openStatuses) AND next_followup_date = CURDATE()) AS due_today,
                SUM(status = 'NEW') AS new_count,
                SUM(status = 'CONTACTED') AS contacted,
                SUM(status = 'INTERESTED') AS interested,
                SUM(status IN ('DEMO', 'ONBOARDING')) AS demo,
                SUM(status = 'WON') AS won,
                SUM(status IN ('NOT_INTERESTED', 'INVALID')) AS lost
            FROM t_dealer_lead
            ${ownerId ? 'WHERE assigned_to = :ownerId' : ''}
        `, {
            replacements: { openStatuses: OPEN_STATUSES, ownerId },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return rows[0];
    },

    getFilterOptions: async (ownerId = null) => {
        const mine = ownerId ? 'AND assigned_to = :ownerId' : '';
        const opts = { replacements: { ownerId }, type: db.Sequelize.QueryTypes.SELECT };
        const [events, districts, oilCompanies] = await Promise.all([
            db.sequelize.query(`SELECT DISTINCT event_name AS value FROM t_dealer_lead WHERE event_name IS NOT NULL ${mine} ORDER BY 1`, opts),
            db.sequelize.query(`SELECT DISTINCT district AS value FROM t_dealer_lead WHERE 1 = 1 ${mine} ORDER BY 1`, opts),
            db.sequelize.query(`SELECT DISTINCT oil_company AS value FROM t_dealer_lead WHERE 1 = 1 ${mine} ORDER BY 1`, opts)
        ]);
        return {
            events: events.map(r => r.value),
            districts: districts.map(r => r.value),
            oilCompanies: oilCompanies.map(r => r.value)
        };
    },

    // People a lead can be assigned to — whoever can open the leads page
    getAssignees: async () => {
        return db.sequelize.query(`
            SELECT Person_id, Person_Name, User_Name
            FROM m_persons
            WHERE Role IN ('SuperUser', 'PowerUser', 'TeleCaller')
              AND (effective_end_date IS NULL OR effective_end_date >= CURDATE())
            ORDER BY Person_Name
        `, {
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    getLeadById: async (leadId) => {
        const rows = await db.sequelize.query(`
            SELECT l.*, p.Person_Name AS assigned_to_name
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            WHERE l.lead_id = :leadId
        `, {
            replacements: { leadId },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return rows[0] || null;
    },

    findLeadByPhone: async (phoneNumber) => {
        const rows = await db.sequelize.query(`
            SELECT l.lead_id, l.bunk_name, l.contact_person_name, l.assigned_to, p.Person_Name AS assigned_to_name
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            WHERE l.phone_number = :phoneNumber
            ORDER BY l.lead_id
            LIMIT 1
        `, {
            replacements: { phoneNumber },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return rows[0] || null;
    },

    // Lead added from the leads page (not the public stall form); returns the new lead_id
    createLead: async (data, user) => {
        const [leadId] = await db.sequelize.query(`
            INSERT INTO t_dealer_lead
                (bunk_name, place, district, phone_number, oil_company,
                 contact_person_name, contact_role, lead_mode, event_name, is_priority,
                 status, assigned_to, next_followup_date, generated_by, notes,
                 updated_by, updation_date, creation_date)
            VALUES
                (:bunkName, :place, :district, :phoneNumber, :oilCompany,
                 :contactPersonName, :contactRole, :leadMode, :eventName, :isPriority,
                 'NEW', :assignedTo, :nextFollowupDate, :generatedBy, :notes,
                 :userName, NOW(), NOW())
        `, {
            replacements: {
                bunkName: data.bunk_name,
                place: data.place,
                district: data.district,
                phoneNumber: data.phone_number,
                oilCompany: data.oil_company,
                contactPersonName: data.contact_person_name || null,
                contactRole: data.contact_role,
                leadMode: data.lead_mode,
                eventName: data.event_name || null,
                isPriority: data.is_priority,
                assignedTo: data.assigned_to || null,
                nextFollowupDate: data.next_followup_date || null,
                generatedBy: data.generated_by || null,
                notes: data.notes || null,
                userName: user.User_Name
            },
            type: db.Sequelize.QueryTypes.INSERT
        });
        return leadId;
    },

    getActivities: async (leadId) => {
        return db.sequelize.query(`
            SELECT a.*, p.Person_Name AS created_by_name, ap.Person_Name AS assigned_to_after_name
            FROM t_dealer_lead_activity a
            LEFT JOIN m_persons p ON p.Person_id = a.created_by_id
            LEFT JOIN m_persons ap ON ap.Person_id = a.assigned_to_after
            WHERE a.lead_id = :leadId
            ORDER BY a.creation_date DESC, a.activity_id DESC
        `, {
            replacements: { leadId },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Records one call/visit/note and moves the lead to its new state
    logActivity: async (leadId, activity, user) => {
        await db.sequelize.transaction(async (transaction) => {
            await db.sequelize.query(`
                INSERT INTO t_dealer_lead_activity
                    (lead_id, activity_type, outcome, notes, status_after, assigned_to_after,
                     next_followup_date, created_by_id, created_by, creation_date)
                VALUES
                    (:leadId, :activityType, :outcome, :notes, :status, :assignedTo,
                     :nextFollowupDate, :personId, :userName, NOW())
            `, {
                replacements: {
                    leadId,
                    activityType: activity.activity_type,
                    outcome: activity.outcome,
                    notes: activity.notes || null,
                    status: activity.status,
                    assignedTo: activity.assigned_to || null,
                    nextFollowupDate: activity.next_followup_date || null,
                    personId: user.Person_id,
                    userName: user.User_Name
                },
                type: db.Sequelize.QueryTypes.INSERT,
                transaction
            });

            await db.sequelize.query(`
                UPDATE t_dealer_lead
                SET status = :status,
                    assigned_to = :assignedTo,
                    next_followup_date = :nextFollowupDate,
                    last_contacted_at = NOW(),
                    updated_by = :userName,
                    updation_date = NOW()
                WHERE lead_id = :leadId
            `, {
                replacements: {
                    leadId,
                    status: activity.status,
                    assignedTo: activity.assigned_to || null,
                    nextFollowupDate: activity.next_followup_date || null,
                    userName: user.User_Name
                },
                type: db.Sequelize.QueryTypes.UPDATE,
                transaction
            });
        });
    },

    // ── Daily leads report ──────────────────────────────────────────────
    // creation_date / last_contacted_at are stored in IST (Sequelize +05:30)
    // while MySQL runs on UTC, so "today" is passed in (IST) rather than CURDATE().

    // Hot = Interested / Demo / Onboarding, or starred (★) and still open.
    // Overdue first, then by days since the last contact.
    getHotLeads: async (today) => {
        return db.sequelize.query(`
            SELECT l.lead_id, l.bunk_name, l.place, l.district, l.phone_number, l.oil_company,
                   l.contact_person_name, l.status, l.is_priority, l.notes,
                   l.assigned_to, p.Person_Name AS assigned_to_name,
                   l.next_followup_date, l.last_contacted_at, l.creation_date,
                   DATEDIFF(:today, l.next_followup_date) AS days_overdue,
                   DATEDIFF(:today, DATE(COALESCE(l.last_contacted_at, l.creation_date))) AS days_since_contact,
                   (SELECT a.notes FROM t_dealer_lead_activity a
                     WHERE a.lead_id = l.lead_id AND a.activity_type <> 'EDIT' AND a.notes IS NOT NULL
                     ORDER BY a.creation_date DESC, a.activity_id DESC LIMIT 1) AS last_activity_note
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            WHERE l.status IN (:openStatuses)
              AND (l.status IN ('INTERESTED', 'DEMO', 'ONBOARDING') OR l.is_priority = 'Y')
            ORDER BY (l.next_followup_date IS NOT NULL AND l.next_followup_date <= :today) DESC,
                     FIELD(l.status, 'ONBOARDING', 'DEMO', 'INTERESTED') DESC,
                     days_since_contact DESC, l.lead_id
        `, {
            replacements: { today, openStatuses: OPEN_STATUSES },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // New / Contacted leads whose notes sound warm but which nobody has starred
    // or moved to Interested — the telecaller writes the outcome in notes only.
    getWarmByNotes: async (today) => {
        return db.sequelize.query(`
            SELECT l.lead_id, l.bunk_name, l.place, l.phone_number, l.contact_person_name,
                   l.status, l.notes, l.creation_date, l.next_followup_date,
                   p.Person_Name AS assigned_to_name,
                   DATEDIFF(:today, DATE(COALESCE(l.last_contacted_at, l.creation_date))) AS days_since_contact
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            WHERE l.status IN ('NEW', 'CONTACTED')
              AND COALESCE(l.is_priority, 'N') <> 'Y'
              AND l.notes REGEXP 'demo|install|interest|call (after|on|at|back|me)|after diwali|tuesday|monday|wednesday|thursday|friday|saturday|explain|visit|meet'
              AND l.notes NOT REGEXP 'not interest|no interest|not need|don.?t need|not required|already using'
            ORDER BY l.creation_date DESC
            LIMIT 30
        `, {
            replacements: { today },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Headline numbers for the report
    getReportCounts: async (today) => {
        const rows = await db.sequelize.query(`
            SELECT
                (SELECT COUNT(*) FROM t_dealer_lead WHERE status IN (:openStatuses)) AS open_leads,
                (SELECT COUNT(*) FROM t_dealer_lead WHERE status IN (:openStatuses)
                    AND next_followup_date < :today) AS overdue,
                (SELECT COUNT(*) FROM t_dealer_lead WHERE DATE(creation_date) > :today - INTERVAL 7 DAY) AS added_7d,
                (SELECT COUNT(*) FROM t_dealer_lead WHERE DATE(creation_date) = :today - INTERVAL 1 DAY) AS added_yesterday,
                (SELECT COUNT(*) FROM t_dealer_lead_activity WHERE activity_type <> 'EDIT'
                    AND DATE(creation_date) > :today - INTERVAL 7 DAY) AS calls_7d,
                (SELECT COUNT(*) FROM t_dealer_lead_activity WHERE activity_type <> 'EDIT'
                    AND DATE(creation_date) = :today - INTERVAL 1 DAY) AS calls_yesterday,
                (SELECT MAX(creation_date) FROM t_dealer_lead_activity WHERE activity_type <> 'EDIT') AS last_call_at,
                (SELECT MAX(creation_date) FROM t_dealer_lead) AS last_lead_at,
                (SELECT COUNT(*) FROM t_dealer_lead WHERE status = 'WON') AS won_total,
                (SELECT MAX(a.creation_date) FROM t_dealer_lead_activity a WHERE a.status_after = 'WON') AS last_won_at
        `, {
            replacements: { today, openStatuses: OPEN_STATUSES },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return rows[0];
    },

    // Per person, last 7 days: calls logged (Log call) and leads added (Add lead)
    getTeamActivity: async (today) => {
        return db.sequelize.query(`
            SELECT who, SUM(calls) AS calls, SUM(added) AS added, SUM(moved_up) AS moved_up,
                   SUM(closed) AS closed, MAX(last_at) AS last_at,
                   SUM(calls_yday) AS calls_yday, SUM(added_yday) AS added_yday
            FROM (
                SELECT CONVERT(COALESCE(p.Person_Name, a.created_by) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS who,
                       COUNT(*) AS calls, 0 AS added,
                       SUM(a.status_after IN ('INTERESTED', 'DEMO', 'ONBOARDING', 'WON')) AS moved_up,
                       SUM(a.status_after IN ('NOT_INTERESTED', 'INVALID')) AS closed,
                       MAX(a.creation_date) AS last_at,
                       SUM(DATE(a.creation_date) = :today - INTERVAL 1 DAY) AS calls_yday, 0 AS added_yday
                FROM t_dealer_lead_activity a
                LEFT JOIN m_persons p ON p.Person_id = a.created_by_id
                WHERE a.activity_type <> 'EDIT' AND DATE(a.creation_date) > :today - INTERVAL 7 DAY
                GROUP BY 1
                UNION ALL
                SELECT CONVERT(COALESCE(p.Person_Name, l.updated_by, 'Website / stall form') USING utf8mb4) COLLATE utf8mb4_unicode_ci AS who,
                       0, COUNT(*), 0, 0, MAX(l.creation_date),
                       0, SUM(DATE(l.creation_date) = :today - INTERVAL 1 DAY)
                FROM t_dealer_lead l
                -- the two columns have different collations on prod; compare bytes
                LEFT JOIN m_persons p ON BINARY p.User_Name = BINARY l.updated_by
                WHERE DATE(l.creation_date) > :today - INTERVAL 7 DAY
                GROUP BY 1
            ) x
            GROUP BY who
            ORDER BY who
        `, {
            replacements: { today },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Open leads per owner: how many, how many overdue, oldest overdue date
    getOwnerBacklog: async (today) => {
        return db.sequelize.query(`
            SELECT COALESCE(p.Person_Name, 'Unassigned') AS owner,
                   COUNT(*) AS open_leads,
                   SUM(l.next_followup_date < :today) AS overdue,
                   SUM(l.next_followup_date IS NULL) AS no_date,
                   MIN(CASE WHEN l.next_followup_date < :today THEN l.next_followup_date END) AS oldest_overdue
            FROM t_dealer_lead l
            LEFT JOIN m_persons p ON p.Person_id = l.assigned_to
            WHERE l.status IN (:openStatuses)
            GROUP BY 1
            ORDER BY overdue DESC
        `, {
            replacements: { today, openStatuses: OPEN_STATUSES },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },

    // Saves corrected lead details and logs what changed as an EDIT activity
    updateLeadDetails: async (lead, changes, changeSummary, user) => {
        await db.sequelize.transaction(async (transaction) => {
            await db.sequelize.query(`
                UPDATE t_dealer_lead
                SET bunk_name = :bunkName, place = :place, district = :district,
                    phone_number = :phoneNumber, oil_company = :oilCompany,
                    contact_person_name = :contactPersonName, contact_role = :contactRole,
                    is_priority = :isPriority, notes = :notes, needs_verification = :needsVerification,
                    updated_by = :userName, updation_date = NOW()
                WHERE lead_id = :leadId
            `, {
                replacements: {
                    leadId: lead.lead_id,
                    bunkName: changes.bunk_name,
                    place: changes.place,
                    district: changes.district,
                    phoneNumber: changes.phone_number,
                    oilCompany: changes.oil_company,
                    contactPersonName: changes.contact_person_name || null,
                    contactRole: changes.contact_role,
                    isPriority: changes.is_priority,
                    notes: changes.notes || null,
                    needsVerification: changes.needs_verification || null,
                    userName: user.User_Name
                },
                type: db.Sequelize.QueryTypes.UPDATE,
                transaction
            });

            await db.sequelize.query(`
                INSERT INTO t_dealer_lead_activity
                    (lead_id, activity_type, outcome, notes, status_after, assigned_to_after,
                     next_followup_date, created_by_id, created_by, creation_date)
                VALUES
                    (:leadId, 'EDIT', 'DETAILS_UPDATED', :notes, :status, :assignedTo,
                     :nextFollowupDate, :personId, :userName, NOW())
            `, {
                replacements: {
                    leadId: lead.lead_id,
                    notes: changeSummary.substring(0, 1000),
                    status: lead.status,
                    assignedTo: lead.assigned_to,
                    nextFollowupDate: lead.next_followup_date,
                    personId: user.Person_id,
                    userName: user.User_Name
                },
                type: db.Sequelize.QueryTypes.INSERT,
                transaction
            });
        });
    }
};
