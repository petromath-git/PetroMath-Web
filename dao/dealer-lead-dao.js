const db = require("../db/db-connection");

module.exports = {

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

    getAllLeads: async () => {
        return db.sequelize.query(`
            SELECT lead_id, bunk_name, place, district, phone_number, oil_company,
                   contact_person_name, contact_role, lead_mode, generated_by, notes, creation_date
            FROM t_dealer_lead
            ORDER BY creation_date DESC
        `, {
            type: db.Sequelize.QueryTypes.SELECT
        });
    }
};
