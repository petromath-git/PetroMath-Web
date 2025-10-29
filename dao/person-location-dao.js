// dao/person-location-dao.js
const db = require("../db/db-connection");
const { Op, QueryTypes } = require("sequelize");

module.exports = {
    // Get all persons excluding customers
    getAllPersons: async () => {
        try {
            const query = `
                SELECT 
                    p.Person_id as person_id,
                    p.Person_Name as person_name,
                    p.User_Name as username,
                    p.Role as role,
                    p.location_code as primary_location,
                    ml.location_name as primary_location_name
                FROM m_persons p
                LEFT JOIN m_location ml ON p.location_code = ml.location_code
                WHERE p.creditlist_id IS NULL
                AND p.effective_end_date >= CURDATE()
                ORDER BY p.Person_Name
            `;
            
            return await db.sequelize.query(query, {
                type: QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error in getAllPersons:', error);
            throw error;
        }
    },

    // Get all active locations
    getAllLocations: async () => {
        try {
            const query = `
                SELECT 
                    location_code,
                    location_name,
                    address
                FROM m_location
                WHERE start_date <= CURDATE()
                ORDER BY location_name
            `;
            
            return await db.sequelize.query(query, {
                type: QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error in getAllLocations:', error);
            throw error;
        }
    },

    // Get all active roles
    getAllRoles: async () => {
        try {
            const query = `
                SELECT 
                    role_id,
                    role_name,
                    role_display_name,
                    role_description
                FROM m_roles
                WHERE is_active = 1
                AND is_customer_role = 0
                AND CURDATE() BETWEEN effective_start_date AND effective_end_date
                ORDER BY role_level DESC, role_display_name
            `;
            
            return await db.sequelize.query(query, {
                type: QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error in getAllRoles:', error);
            throw error;
        }
    },

    // Get all location assignments for a specific person
    getPersonLocations: async (personId) => {
        try {
            const query = `
                SELECT 
                    pl.personloc_id,
                    pl.person_id,
                    pl.location_code,
                    ml.location_name,
                    pl.role,
                    pl.effective_start_date,
                    pl.effective_end_date,
                    pl.created_by,
                    pl.creation_date,
                    pl.updated_by,
                    pl.updation_date
                FROM m_person_location pl
                LEFT JOIN m_location ml ON pl.location_code = ml.location_code
                WHERE pl.person_id = :personId
                AND pl.effective_end_date >= CURDATE()
                ORDER BY ml.location_name
            `;
            
            return await db.sequelize.query(query, {
                replacements: { personId },
                type: QueryTypes.SELECT
            });
        } catch (error) {
            console.error('Error in getPersonLocations:', error);
            throw error;
        }
    },

    // Assign a location to a person
    assignLocation: async (locationData) => {
        try {
            const query = `
                INSERT INTO m_person_location 
                (person_id, location_code, role, effective_start_date, effective_end_date, 
                 created_by, updated_by, creation_date, updation_date)
                VALUES 
                (:person_id, :location_code, :role, :effective_start_date, :effective_end_date,
                 :created_by, :updated_by, NOW(), NOW())
            `;
            
            return await db.sequelize.query(query, {
                replacements: locationData,
                type: QueryTypes.INSERT
            });
        } catch (error) {
            console.error('Error in assignLocation:', error);
            throw error;
        }
    },

    // Check if location is already assigned to person
    checkExistingAssignment: async (personId, locationCode) => {
        try {
            const query = `
                SELECT personloc_id 
                FROM m_person_location
                WHERE person_id = :personId
                AND location_code = :locationCode
                AND effective_end_date >= CURDATE()
            `;
            
            const result = await db.sequelize.query(query, {
                replacements: { personId, locationCode },
                type: QueryTypes.SELECT
            });
            
            return result.length > 0;
        } catch (error) {
            console.error('Error in checkExistingAssignment:', error);
            throw error;
        }
    },

    // Remove a location assignment (soft delete by setting end date)
    removeAssignment: async (personlocId, updatedBy) => {
        try {
            const query = `
                UPDATE m_person_location
                SET effective_end_date = CURDATE() - INTERVAL 1 DAY,
                    updated_by = :updatedBy,
                    updation_date = NOW()
                WHERE personloc_id = :personlocId
            `;
            
            return await db.sequelize.query(query, {
                replacements: { personlocId, updatedBy },
                type: QueryTypes.UPDATE
            });
        } catch (error) {
            console.error('Error in removeAssignment:', error);
            throw error;
        }
    },

    // Update an existing assignment
    updateAssignment: async (personlocId, updateData) => {
        try {
            const query = `
                UPDATE m_person_location
                SET role = :role,
                    effective_start_date = :effective_start_date,
                    effective_end_date = :effective_end_date,
                    updated_by = :updated_by,
                    updation_date = NOW()
                WHERE personloc_id = :personlocId
            `;
            
            return await db.sequelize.query(query, {
                replacements: { ...updateData, personlocId },
                type: QueryTypes.UPDATE
            });
        } catch (error) {
            console.error('Error in updateAssignment:', error);
            throw error;
        }
    }
};