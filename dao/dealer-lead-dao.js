const db = require("../db/db-connection");

const OPEN_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'DEMO', 'ONBOARDING'];

// Builds the WHERE clause for the admin list / CSV export from the filter bar
const buildLeadFilter = (filters, currentPersonId) => {
    const where = [];
    const replacements = { openStatuses: OPEN_STATUSES };

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
    getLeads: async (filters, currentPersonId) => {
        const { whereSql, replacements } = buildLeadFilter(filters, currentPersonId);
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

    // Counts for the summary tiles — across all leads, ignoring the filter bar
    getSummary: async () => {
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
        `, {
            replacements: { openStatuses: OPEN_STATUSES },
            type: db.Sequelize.QueryTypes.SELECT
        });
        return rows[0];
    },

    getFilterOptions: async () => {
        const [events, districts, oilCompanies] = await Promise.all([
            db.sequelize.query(`SELECT DISTINCT event_name AS value FROM t_dealer_lead WHERE event_name IS NOT NULL ORDER BY 1`,
                { type: db.Sequelize.QueryTypes.SELECT }),
            db.sequelize.query(`SELECT DISTINCT district AS value FROM t_dealer_lead ORDER BY 1`,
                { type: db.Sequelize.QueryTypes.SELECT }),
            db.sequelize.query(`SELECT DISTINCT oil_company AS value FROM t_dealer_lead ORDER BY 1`,
                { type: db.Sequelize.QueryTypes.SELECT })
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
            WHERE Role IN ('SuperUser', 'PowerUser')
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
