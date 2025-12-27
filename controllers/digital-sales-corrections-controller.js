// controllers/digital-sales-corrections-controller.js
const db = require('../db/db-connection');
const rolePermissionsDao = require('../dao/role-permissions-dao');

module.exports = {
    // Render the main page
    renderPage: (req, res) => {
        try {
            const user = req.session.user || req.user;
            const userRole = user?.Role || user?.role;
            const userLocation = user?.location_code || user?.location;
            
            if (!user || !userRole) {
                return res.redirect('/login');
            }

            // Only allow SuperUser and Admin
            if (userRole !== 'SuperUser' && userRole !== 'Admin') {
                return res.status(403).send('Access denied. This feature is restricted to SuperUser and Admin roles only.');
            }

            res.render('digital-sales-corrections', {
                title: 'Digital Sales Corrections',
                user: user,
                userRole: userRole,
                userLocation: userLocation
            });

        } catch (error) {
            console.error('Error rendering digital sales corrections page:', error);
            res.status(500).send('Internal server error');
        }
    },

    // Search digital sales transactions
    searchTransactions: async (req, res) => {
        try {
            const { fromDate, toDate, vendorFilter, minAmount, maxAmount } = req.query;
            const user = req.session.user || req.user;
            const userRole = user?.Role || user?.role;
            const userLocation = user?.location_code || user?.location;
            
            // Build WHERE conditions
            let whereConditions = [];
            let replacements = { fromDate, toDate, userLocation };
            
            // Date range filter (mandatory)
            whereConditions.push('DATE(COALESCE(tds.transaction_date, tc.closing_date)) BETWEEN :fromDate AND :toDate');
            
            // Location filter
            whereConditions.push('tc.location_code = :userLocation');
            
            // Only show closed transactions
            whereConditions.push('tc.closing_status = "CLOSED"');
            
            // Vendor filter (optional)
            if (vendorFilter) {
                whereConditions.push('tds.vendor_id = :vendorFilter');
                replacements.vendorFilter = vendorFilter;
            }
            
            // Amount range filter (optional)
            if (minAmount) {
                whereConditions.push('tds.amount >= :minAmount');
                replacements.minAmount = minAmount;
            }
            if (maxAmount) {
                whereConditions.push('tds.amount <= :maxAmount');
                replacements.maxAmount = maxAmount;
            }
            
            const whereClause = whereConditions.join(' AND ');
            
            const transactions = await db.sequelize.query(`
                SELECT 
                    tds.digital_sales_id,
                    tds.closing_id,
                    tds.vendor_id,
                    tds.amount,
                    tds.transaction_date,
                    tds.notes,
                    tc.closing_date,
                    tc.closing_status,
                    mcl.company_name as vendor_name,
                    mcl.short_name as vendor_short_name,
                    COALESCE(tds.transaction_date, tc.closing_date) as display_date
                FROM t_digital_sales tds
                INNER JOIN t_closing tc ON tds.closing_id = tc.closing_id
                INNER JOIN m_credit_list mcl ON tds.vendor_id = mcl.creditlist_id
                WHERE ${whereClause}
                ORDER BY COALESCE(tds.transaction_date, tc.closing_date) DESC, tds.digital_sales_id DESC
                LIMIT 500
            `, {
                replacements: replacements,
                type: db.Sequelize.QueryTypes.SELECT
            });

            res.json({ 
                success: true, 
                transactions: transactions 
            });

        } catch (error) {
            console.error('Error searching digital sales transactions:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error' 
            });
        }
    },

    // Get digital vendors for dropdown
    getVendors: async (req, res) => {
        try {
            const user = req.session.user || req.user;
            const userLocation = user?.location_code || user?.location;

            

            const vendors = await db.sequelize.query(`
                SELECT 
                    creditlist_id,
                    company_name,
                    short_name
                FROM m_credit_list
                WHERE card_flag = 'Y'
                AND location_code = :userLocation
                ORDER BY company_name
            `, {
                replacements: { userLocation },
                type: db.Sequelize.QueryTypes.SELECT
            });

            res.json({ 
                success: true, 
                vendors: vendors 
            });

        } catch (error) {
            console.error('Error fetching digital vendors:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error' 
            });
        }
    },

    // Update vendor for a digital sales transaction
    updateVendor: async (req, res) => {
        try {
            const { digitalSalesId } = req.params;
            const { newVendorId, reason } = req.body;
            const userId = req.user?.Person_id;

            // Validate inputs
            if (!newVendorId || newVendorId <= 0) {
                return res.status(400).json({ error: 'Valid vendor is required' });
            }

            if (!reason || reason.trim().length === 0) {
                return res.status(400).json({ error: 'Reason for change is required' });
            }

            // Get current transaction details
            const currentTransaction = await db.sequelize.query(`
                SELECT 
                    tds.digital_sales_id,
                    tds.vendor_id as current_vendor_id,
                    tds.amount,
                    tds.closing_id,
                    tc.closing_date,
                    tc.closing_status,
                    mcl.company_name as current_vendor_name
                FROM t_digital_sales tds
                INNER JOIN t_closing tc ON tds.closing_id = tc.closing_id
                INNER JOIN m_credit_list mcl ON tds.vendor_id = mcl.creditlist_id
                WHERE tds.digital_sales_id = :digitalSalesId
            `, {
                replacements: { digitalSalesId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (!currentTransaction.length) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            const transaction = currentTransaction[0];

            // Check if shift is closed (only allow edits on closed shifts)
            if (transaction.closing_status !== 'CLOSED') {
                return res.status(400).json({ 
                    error: 'Can only edit vendor for closed shifts' 
                });
            }

            // Check if the new vendor exists and is a digital vendor
            const vendorCheck = await db.sequelize.query(`
                SELECT creditlist_id, company_name, card_flag
                FROM m_credit_list 
                WHERE creditlist_id = :newVendorId
                AND card_flag = 'Y'
            `, {
                replacements: { newVendorId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (vendorCheck.length === 0) {
                return res.status(400).json({ 
                    error: 'Invalid or inactive digital vendor' 
                });
            }

            // Update the vendor
            await db.sequelize.query(`
                UPDATE t_digital_sales 
                SET vendor_id = :newVendorId,
                    updated_by = :userId,
                    updation_date = NOW()
                WHERE digital_sales_id = :digitalSalesId
            `, {
                replacements: { 
                    newVendorId, 
                    digitalSalesId, 
                    userId 
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            // Log the change for audit purposes
            await db.sequelize.query(`
                INSERT INTO t_transaction_corrections_log
                (tcredit_id, field_changed, old_value, new_value, reason, changed_by, change_date)
                VALUES (:digitalSalesId, 'vendor_id', :oldValue, :newValue, :reason, :userId, NOW())
            `, {
                replacements: {
                    digitalSalesId,
                    fieldChanged: 'vendor_id',
                    oldValue: transaction.current_vendor_id,
                    newValue: newVendorId,
                    reason,
                    userId
                },
                type: db.Sequelize.QueryTypes.INSERT
            }).catch(err => {
                // If logging table doesn't exist, just log to console
                console.log('Vendor change log:', {
                    digitalSalesId,
                    oldVendorId: transaction.current_vendor_id,
                    newVendorId,
                    reason,
                    userId,
                    timestamp: new Date()
                });
            });

            res.json({ 
                success: true, 
                message: 'Vendor updated successfully',
                newVendorName: vendorCheck[0].company_name
            });

        } catch (error) {
            console.error('Error updating vendor:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
};