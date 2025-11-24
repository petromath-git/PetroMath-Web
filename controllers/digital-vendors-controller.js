const CreditDao = require("../dao/credits-dao");
const db = require("../db/db-connection");
const dateFormat = require('dateformat');

module.exports = {
    // Get all digital vendors for a location
    findDigitalVendors: async (locationCode) => {
        try {
            const query = `
                SELECT 
                    mcl.creditlist_id,
                    mcl.Company_Name,
                    mcl.short_name,
                    mcl.ledger_name,
                    mcl.remittance_bank_id,
                    mcl.settlement_lookback_days,
                    mcl.gst,
                    mcl.phoneno,
                    mcl.address,
                    mb.account_nickname as bank_name,
                    mb.bank_name as full_bank_name
                FROM m_credit_list mcl
                LEFT JOIN m_bank mb ON mcl.remittance_bank_id = mb.bank_id
                WHERE mcl.location_code = :locationCode
                  AND mcl.card_flag = 'Y'
                  AND (mcl.effective_start_date IS NULL OR CURDATE() >= mcl.effective_start_date)
                  AND (mcl.effective_end_date IS NULL OR CURDATE() < mcl.effective_end_date)
                ORDER BY mcl.Company_Name
            `;

            const vendors = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: db.Sequelize.QueryTypes.SELECT
            });

            return vendors.map(vendor => ({
                id: vendor.creditlist_id,
                name: vendor.Company_Name,
                short_name: vendor.short_name,
                ledger_name: vendor.ledger_name,
                remittance_bank_id: vendor.remittance_bank_id,
                bank_name: vendor.bank_name || vendor.full_bank_name,
                settlement_lookback_days: vendor.settlement_lookback_days,
                gst: vendor.gst,
                phoneno: vendor.phoneno,
                address: vendor.address
            }));
        } catch (error) {
            console.error('Error fetching digital vendors:', error);
            throw error;
        }
    },

    // Get disabled digital vendors
    findDisabledDigitalVendors: async (locationCode) => {
        try {
            const query = `
                SELECT 
                    mcl.creditlist_id,
                    mcl.Company_Name,
                    mcl.short_name,
                    mcl.ledger_name,
                    mcl.remittance_bank_id,
                    mcl.settlement_lookback_days,
                    mcl.gst,
                    mcl.phoneno,
                    mcl.address,
                    mcl.effective_end_date,
                    mb.account_nickname as bank_name,
                    mb.bank_name as full_bank_name
                FROM m_credit_list mcl
                LEFT JOIN m_bank mb ON mcl.remittance_bank_id = mb.bank_id
                WHERE mcl.location_code = :locationCode
                  AND mcl.card_flag = 'Y'
                  AND mcl.effective_end_date IS NOT NULL 
                  AND mcl.effective_end_date <= CURDATE()
                ORDER BY mcl.effective_end_date DESC, mcl.Company_Name
            `;

            const vendors = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: db.Sequelize.QueryTypes.SELECT
            });

            return vendors.map(vendor => ({
                id: vendor.creditlist_id,
                name: vendor.Company_Name,
                short_name: vendor.short_name,
                ledger_name: vendor.ledger_name,
                remittance_bank_id: vendor.remittance_bank_id,
                bank_name: vendor.bank_name || vendor.full_bank_name,
                settlement_lookback_days: vendor.settlement_lookback_days,
                gst: vendor.gst,
                phoneno: vendor.phoneno,
                address: vendor.address,
                effective_end_date: dateFormat(vendor.effective_end_date, "dd-mm-yyyy")
            }));
        } catch (error) {
            console.error('Error fetching disabled digital vendors:', error);
            throw error;
        }
    },

    // Get all banks for dropdown
    findBanksByLocation: async (locationCode) => {
        try {
            const query = `
                SELECT 
                    bank_id,
                    bank_name,
                    account_nickname,
                    account_number
                FROM m_bank
                WHERE location_code = :locationCode
                ORDER BY account_nickname, bank_name
            `;

            const banks = await db.sequelize.query(query, {
                replacements: { locationCode },
                type: db.Sequelize.QueryTypes.SELECT
            });

            return banks;
        } catch (error) {
            console.error('Error fetching banks:', error);
            throw error;
        }
    },

    // Check if vendor name already exists at location
    checkDuplicateVendor: async (companyName, locationCode, excludeId = null) => {
        try {
            let query = `
                SELECT creditlist_id, Company_Name
                FROM m_credit_list
                WHERE UPPER(Company_Name) = UPPER(:companyName)
                  AND location_code = :locationCode
                  AND card_flag = 'Y'
            `;
            
            const replacements = {
                companyName: companyName,
                locationCode: locationCode
            };

            if (excludeId) {
                query += ' AND creditlist_id != :excludeId';
                replacements.excludeId = excludeId;
            }

            const result = await db.sequelize.query(query, {
                replacements: replacements,
                type: db.Sequelize.QueryTypes.SELECT
            });

            return result.length > 0;
        } catch (error) {
            console.error('Error checking duplicate vendor:', error);
            throw error;
        }
    },

    // Create new digital vendor
    createDigitalVendor: async (data) => {
        try {
            const query = `
                INSERT INTO m_credit_list (
                    location_code,
                    Company_Name,
                    short_name,
                    ledger_name,
                    remittance_bank_id,
                    settlement_lookback_days,
                    gst,
                    phoneno,
                    address,
                    card_flag,
                    type,
                    Opening_Balance,
                    effective_start_date,
                    effective_end_date,
                    created_by,
                    updated_by,
                    creation_date,
                    updation_date
                ) VALUES (
                    :location_code,
                    :company_name,
                    :short_name,
                    :ledger_name,
                    :remittance_bank_id,
                    :settlement_lookback_days,
                    :gst,
                    :phoneno,
                    :address,
                    'Y',
                    'Credit',
                    0,
                    CURDATE(),
                    '9999-12-31',
                    :created_by,
                    :updated_by,
                    NOW(),
                    NOW()
                )
            `;

            const result = await db.sequelize.query(query, {
                replacements: {
                    location_code: data.location_code,
                    company_name: data.company_name?.toUpperCase(),
                    short_name: data.short_name?.toUpperCase() || null,
                    ledger_name: data.ledger_name || null,
                    remittance_bank_id: data.remittance_bank_id || null,
                    settlement_lookback_days: data.settlement_lookback_days || null,
                    gst: data.gst?.toUpperCase() || null,
                    phoneno: data.phoneno || null,
                    address: data.address || null,
                    created_by: data.created_by,
                    updated_by: data.updated_by
                },
                type: db.Sequelize.QueryTypes.INSERT
            });

            return result[0]; // Return the inserted ID
        } catch (error) {
            console.error('Error creating digital vendor:', error);
            throw error;
        }
    },

    // Update digital vendor
    updateDigitalVendor: async (vendorId, data) => {
        try {
            // First check if vendor exists
            const checkQuery = `
                SELECT creditlist_id 
                FROM m_credit_list 
                WHERE creditlist_id = :vendor_id 
                  AND card_flag = 'Y'
            `;
            
            const exists = await db.sequelize.query(checkQuery, {
                replacements: { vendor_id: vendorId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (exists.length === 0) {
                return 0; // Vendor not found
            }

            const query = `
                UPDATE m_credit_list
                SET 
                    Company_Name = :company_name,
                    short_name = :short_name,
                    ledger_name = :ledger_name,
                    remittance_bank_id = :remittance_bank_id,
                    settlement_lookback_days = :settlement_lookback_days,
                    gst = :gst,
                    phoneno = :phoneno,
                    address = :address,
                    updated_by = :updated_by,
                    updation_date = NOW()
                WHERE creditlist_id = :vendor_id
                  AND card_flag = 'Y'
            `;

            await db.sequelize.query(query, {
                replacements: {
                    vendor_id: vendorId,
                    company_name: data.company_name?.toUpperCase(),
                    short_name: data.short_name?.toUpperCase() || null,
                    ledger_name: data.ledger_name || null,
                    remittance_bank_id: data.remittance_bank_id || null,
                    settlement_lookback_days: data.settlement_lookback_days || null,
                    gst: data.gst?.toUpperCase() || null,
                    phoneno: data.phoneno || null,
                    address: data.address || null,
                    updated_by: data.updated_by
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            return 1; // Success
        } catch (error) {
            console.error('Error updating digital vendor:', error);
            throw error;
        }
    },

    // Disable digital vendor
    disableDigitalVendor: async (vendorId, updatedBy) => {
        try {
            // First check if vendor exists
            const checkQuery = `
                SELECT creditlist_id 
                FROM m_credit_list 
                WHERE creditlist_id = :vendor_id 
                  AND card_flag = 'Y'
            `;
            
            const exists = await db.sequelize.query(checkQuery, {
                replacements: { vendor_id: vendorId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (exists.length === 0) {
                return 0; // Vendor not found
            }

            const query = `
                UPDATE m_credit_list
                SET 
                    effective_end_date = CURDATE(),
                    updated_by = :updated_by,
                    updation_date = NOW()
                WHERE creditlist_id = :vendor_id
                  AND card_flag = 'Y'
            `;

            await db.sequelize.query(query, {
                replacements: {
                    vendor_id: vendorId,
                    updated_by: updatedBy
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            return 1; // Success
        } catch (error) {
            console.error('Error disabling digital vendor:', error);
            throw error;
        }
    },

    // Enable digital vendor
    enableDigitalVendor: async (vendorId, updatedBy) => {
        try {
            // First check if vendor exists
            const checkQuery = `
                SELECT creditlist_id 
                FROM m_credit_list 
                WHERE creditlist_id = :vendor_id 
                  AND card_flag = 'Y'
            `;
            
            const exists = await db.sequelize.query(checkQuery, {
                replacements: { vendor_id: vendorId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (exists.length === 0) {
                return 0; // Vendor not found
            }

            const query = `
                UPDATE m_credit_list
                SET 
                    effective_start_date = CURDATE(),
                    effective_end_date = '9999-12-31',
                    updated_by = :updated_by,
                    updation_date = NOW()
                WHERE creditlist_id = :vendor_id
                  AND card_flag = 'Y'
            `;

            await db.sequelize.query(query, {
                replacements: {
                    vendor_id: vendorId,
                    updated_by: updatedBy
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            return 1; // Success
        } catch (error) {
            console.error('Error enabling digital vendor:', error);
            throw error;
        }
    }
};