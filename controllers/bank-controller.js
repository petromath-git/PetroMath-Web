// controllers/bank-controller.js
const BankDao = require('../dao/bank-dao');
const rolePermissionsDao = require('../dao/role-permissions-dao');
const db = require('../db/db-connection');  

module.exports = {
    
    // Get all active banks for location
    findActiveBanks: async (locationCode) => {
        try {
            return await BankDao.findAll(locationCode);
        } catch (error) {
            console.error('Error finding active banks:', error);
            throw error;
        }
    },

    // Get disabled banks
    findDisabledBanks: async (locationCode) => {
        try {
            return await BankDao.findDisabledBanks(locationCode);
        } catch (error) {
            console.error('Error finding disabled banks:', error);
            throw error;
        }
    },

    // Render main bank master page
    getBankMasterPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const banks = await BankDao.findAll(locationCode);
            
            // Check permissions
            const canEdit = await rolePermissionsDao.hasPermission(
                req.user.Role,
                locationCode,
                'EDIT_BANK_MASTER'
            );
            const canAdd = await rolePermissionsDao.hasPermission(
                req.user.Role,
                locationCode,
                'ADD_BANK_MASTER'
            );
            const canDisable = await rolePermissionsDao.hasPermission(
                req.user.Role,
                locationCode,
                'DISABLE_BANK_MASTER'
            );

            res.render('bank-master', {
                title: 'Bank Master',
                user: req.user,
                banks: banks,
                canEdit: canEdit,
                canAdd: canAdd,
                canDisable: canDisable
            });
        } catch (error) {
            console.error('Error loading bank master page:', error);
            res.status(500).send('Error loading bank master page');
        }
    },

    // Render disabled banks page
    getDisabledBanksPage: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const banks = await BankDao.findDisabledBanks(locationCode);

            res.render('bank-master-enable', {
                title: 'Disabled Banks',
                user: req.user,
                banks: banks
            });
        } catch (error) {
            console.error('Error loading disabled banks page:', error);
            res.status(500).send('Error loading disabled banks page');
        }
    },  


    // Update bank
    updateBank: async (req, res) => {
        try {
            const bankId = Number(req.params.id);
            const locationCode = req.user.location_code;
            const accountNumber = req.body.account_number;
            const ifscCode = req.body.ifsc_code;

            // Check for duplicate: same account number + same IFSC code (excluding current bank)
            if (accountNumber && ifscCode) {
                const query = `
                    SELECT bank_id, bank_name, account_number, ifsc_code 
                    FROM m_bank 
                    WHERE account_number = :accountNumber 
                      AND ifsc_code = :ifscCode
                      AND location_code = :locationCode 
                      AND bank_id != :bankId
                      AND active_flag = 'Y'
                    LIMIT 1
                `;
                
                const existing = await db.sequelize.query(query, {
                    replacements: { accountNumber, ifscCode, locationCode, bankId },
                    type: db.Sequelize.QueryTypes.SELECT
                });
                
                if (existing && existing.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: `Account number "${accountNumber}" with IFSC "${ifscCode}" already exists for ${existing[0].bank_name}`
                    });
                }
            }

            const updateData = {
                bank_name: req.body.bank_name,
                bank_branch: req.body.bank_branch,
                account_number: req.body.account_number,
                ifsc_code: req.body.ifsc_code,
                type: req.body.type || null,
                cc_limit: req.body.cc_limit ? parseInt(req.body.cc_limit, 10) : null,
                ledger_name: req.body.ledger_name || null,
                account_nickname: req.body.account_nickname || null,
                internal_flag: req.body.internal_flag || 'N',
                is_oil_company: req.body.is_oil_company || 'N',
                updated_by: req.user.Person_id,
                updation_date: new Date()
            };

            await BankDao.update(bankId, updateData);
            res.json({ success: true, message: 'Bank updated successfully' });
        } catch (error) {
            console.error('Error updating bank:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Error updating bank: ' + error.message 
            });
        }
    },

    // Create new bank
    createBank: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const accountNumber = req.body.account_number;
            const ifscCode = req.body.ifsc_code;

            // Check for duplicate: same account number + same IFSC code
            if (accountNumber && ifscCode) {
                const query = `
                    SELECT bank_id, bank_name, account_number, ifsc_code 
                    FROM m_bank 
                    WHERE account_number = :accountNumber 
                      AND ifsc_code = :ifscCode
                      AND location_code = :locationCode 
                      AND active_flag = 'Y'
                    LIMIT 1
                `;
                
                const existing = await db.sequelize.query(query, {
                    replacements: { accountNumber, ifscCode, locationCode },
                    type: db.Sequelize.QueryTypes.SELECT
                });
                
                if (existing && existing.length > 0) {
                    req.flash('error', `Account number "${accountNumber}" with IFSC "${ifscCode}" already exists for ${existing[0].bank_name}`);
                    return res.redirect('/bank-master');
                }
            }


            // GET THE LOCATION_ID FROM DATABASE
        const locationQuery = `
            SELECT location_id 
            FROM m_location 
            WHERE location_code = :locationCode
        `;
        
        const locationResult = await db.sequelize.query(locationQuery, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        const locationId = locationResult[0]?.location_id;

            const bankData = {
                bank_name: req.body.bank_name,
                bank_branch: req.body.bank_branch,
                account_number: req.body.account_number,
                ifsc_code: req.body.ifsc_code,
                location_code: locationCode,
                type: req.body.type || null,
                cc_limit: req.body.cc_limit || null,
                ledger_name: req.body.ledger_name || null,
                account_nickname: req.body.account_nickname || null,
                location_id:locationId,
                internal_flag: req.body.internal_flag || 'N',
                is_oil_company: req.body.is_oil_company || 'N',
                active_flag: 'Y',
                created_by: req.user.Person_id,
                updated_by: req.user.Person_id
            };

            await BankDao.create(bankData);
            req.flash('success', 'Bank created successfully');
            res.redirect('/bank-master');
        } catch (error) {
            console.error('Error creating bank:', error);
            req.flash('error', 'Error creating bank');
            res.redirect('/bank-master');
        }
    },

   

    // Disable bank
    disableBank: async (req, res) => {
        try {
            const bankId = req.params.id;
             await BankDao.disableBank(bankId, req.user.Person_id);
            res.json({ success: true, message: 'Bank disabled successfully' });
        } catch (error) {
            console.error('Error disabling bank:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Error disabling bank' 
            });
        }
    },

    // Enable bank
    enableBank: async (req, res) => {
        try {
            const bankId = req.params.id;
            await BankDao.enableBank(bankId);
            res.json({ success: true, message: 'Bank enabled successfully' });
        } catch (error) {
            console.error('Error enabling bank:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Error enabling bank' 
            });
        }
    }
};