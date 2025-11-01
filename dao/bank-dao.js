// dao/bank-dao.js
const db = require("../db/db-connection");
const Bank = db.m_bank;
const { Op } = require('sequelize');
const dateFormat = require('dateformat');

module.exports = {
    
    // Find all active banks for a location
    findAll: (locationCode) => {
        return Bank.findAll({
            where: {
                location_code: locationCode,
                active_flag: 'Y'
            },
            order: [['bank_name', 'ASC']]
        });
    },

    // Find all banks including inactive
    findAllIncludingInactive: (locationCode) => {
        return Bank.findAll({
            where: {
                location_code: locationCode
            },
            order: [['active_flag', 'DESC'], ['bank_name', 'ASC']]
        });
    },

    // Find disabled/inactive banks
    findDisabledBanks: (locationCode) => {
        return Bank.findAll({
            where: {
                location_code: locationCode,
                active_flag: 'N'
            },
            order: [['bank_name', 'ASC']]
        });
    },

    // Find bank by ID
    findById: (bankId) => {
        return Bank.findOne({
            where: { bank_id: bankId }
        });
    },

    
    // Check if bank name already exists in location
findByNameAndLocation: async (bankName, locationCode, excludeBankId = null) => {
    try {
        const whereClause = {
            bank_name: bankName,
            location_code: locationCode
        };
        
        // IMPORTANT: Exclude the current bank being edited
        if (excludeBankId) {
            whereClause.bank_id = { [Op.ne]: excludeBankId };
        }
        
        console.log('findByNameAndLocation query:', whereClause);
        
        const bank = await Bank.findOne({ where: whereClause });
        
        console.log('findByNameAndLocation result:', bank);
        
        return bank;
    } catch (error) {
        console.error('Error finding bank by name:', error);
        throw error;
    }
},

    // Create new bank
    create: (bankData) => {
        return Bank.create(bankData);
    },

    // Update bank
    update: (bankId, updateData) => {
        return Bank.update(updateData, {
            where: { bank_id: bankId }
        });
    },

    // Disable bank (soft delete)
        disableBank: (bankId, updatedBy) => {
            return Bank.update({
                active_flag: 'N',
                updated_by: updatedBy,
                updation_date: new Date()
            }, {
                where: { bank_id: bankId }
            });
        },
        
    // Enable bank
    enableBank: (bankId) => {
        return Bank.update({
            active_flag: 'Y',
            updated_by: null,
            updation_date: new Date()
        }, {
            where: { bank_id: bankId }
        });
    }
};