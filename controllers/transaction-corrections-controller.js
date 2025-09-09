// controllers/transaction-corrections-controller.js
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

            res.render('credit-transaction-corrections', {
                title: 'Credit Transaction Corrections',
                user: user,
                userRole: userRole,
                userLocation: userLocation
            });

        } catch (error) {
            console.error('Error rendering credit transaction corrections page:', error);
            res.status(500).send('Internal server error');
        }
    },

    // Search credit transactions
    searchTransactions: async (req, res) => {
        try {
            const { fromDate, toDate, customerFilter } = req.query;
            const user = req.session.user || req.user;
            const userRole = user?.Role || user?.role;
            const userLocation = user?.location_code || user?.location;
            
            // Build WHERE conditions based on user role
            let whereConditions = [];
            let replacements = { fromDate, toDate, userLocation };
            
            // Date range filter
            whereConditions.push('DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate');
            
            // Location filter
            whereConditions.push('tcl.location_code = :userLocation');
            
            // Role-based filtering
            if (userRole === 'Customer') {
                whereConditions.push('tc.creditlist_id = :customerCreditlistId');
                replacements.customerCreditlistId = user.creditlist_id;
            } else if (customerFilter) {
                whereConditions.push('tc.creditlist_id = :customerFilter');
                replacements.customerFilter = customerFilter;
            }
            
            // Only show closed transactions
            whereConditions.push("tcl.closing_status = 'CLOSED'");
            
            const query = `
                SELECT 
                    tc.tcredit_id,
                    tc.bill_no,
                    tc.creditlist_id,
                    tc.vehicle_number,
                    tc.odometer_reading,
                    tc.qty,
                    tc.amount,
                    tcl.closing_date,
                    mcl.Company_Name,
                    mp.product_name
                FROM t_credits tc
                JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
                JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id
                JOIN m_product mp ON tc.product_id = mp.product_id
                WHERE ${whereConditions.join(' AND ')}
                ORDER BY tcl.closing_date DESC, tc.bill_no DESC
                LIMIT 500
            `;
            
            const transactions = await db.sequelize.query(query, {
                replacements,
                type: db.Sequelize.QueryTypes.SELECT
            });
            
            res.json({ 
                success: true, 
                transactions: transactions 
            });
            
        } catch (error) {
            console.error('Error searching transactions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // Get customers for dropdown
    getCustomers: async (req, res) => {
        try {
            const user = req.session.user || req.user;
            const userLocation = user?.location_code || user?.location;
            
            const query = `
                SELECT creditlist_id, Company_Name
                FROM m_credit_list 
                WHERE location_code = :userLocation 
                AND coalesce(card_flag,'N') != 'Y'
                ORDER BY Company_Name
            `;
            
            const customers = await db.sequelize.query(query, {
                replacements: { userLocation },
                type: db.Sequelize.QueryTypes.SELECT
            });
            
            res.json(customers);
            
        } catch (error) {
            console.error('Error fetching customers:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // Update odometer reading
    updateOdometerReading: async (req, res) => {
        try {
            const { tcreditId } = req.params;
            const { odometerReading, reason } = req.body;
            const userId = req.user?.Person_id;

            // Validate inputs
            if (isNaN(odometerReading) || odometerReading < 0) {
                return res.status(400).json({ error: 'Valid odometer reading is required' });
            }

            // Check if the closing is actually closed
            const closingCheck = await db.sequelize.query(`
                SELECT tc.closing_id, tcl.closing_status, tcl.closing_date
                FROM t_credits tc
                JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
                WHERE tc.tcredit_id = :tcreditId
            `, {
                replacements: { tcreditId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (closingCheck.length === 0) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            if (closingCheck[0].closing_status !== 'CLOSED') {
                return res.status(400).json({ 
                    error: 'Can only edit odometer readings for closed shifts' 
                });
            }

            // Update the odometer reading
            await db.sequelize.query(`
                UPDATE t_credits 
                SET odometer_reading = :odometerReading,
                    updated_by = :userId,
                    updation_date = NOW()
                WHERE tcredit_id = :tcreditId
            `, {
                replacements: { 
                    odometerReading, 
                    tcreditId, 
                    userId 
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            res.json({ 
                success: true, 
                message: 'Odometer reading updated successfully',
                newReading: odometerReading
            });

        } catch (error) {
            console.error('Error updating odometer reading:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // Update credit party
    updateCreditParty: async (req, res) => {
        try {
            const { tcreditId } = req.params;
            const { newCreditlistId, reason } = req.body;
            const userId = req.user?.Person_id;

            // Validate inputs
            if (!newCreditlistId || newCreditlistId <= 0) {
                return res.status(400).json({ error: 'Valid credit party is required' });
            }

            // Check if the new credit party exists and is active
            const creditPartyCheck = await db.sequelize.query(`
                SELECT creditlist_id, Company_Name, location_code
                FROM m_credit_list 
                WHERE creditlist_id = :newCreditlistId                 
            `, {
                replacements: { newCreditlistId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (creditPartyCheck.length === 0) {
                return res.status(400).json({ error: 'Invalid or inactive credit party' });
            }

            // Check if the closing is actually closed
            const closingCheck = await db.sequelize.query(`
                SELECT tc.closing_id, tcl.closing_status, tcl.closing_date, tc.creditlist_id as current_creditlist_id
                FROM t_credits tc
                JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
                WHERE tc.tcredit_id = :tcreditId
            `, {
                replacements: { tcreditId },
                type: db.Sequelize.QueryTypes.SELECT
            });

            if (closingCheck.length === 0) {
                return res.status(404).json({ error: 'Transaction not found' });
            }

            if (closingCheck[0].closing_status !== 'CLOSED') {
                return res.status(400).json({ 
                    error: 'Can only edit credit party for closed shifts' 
                });
            }

            // Update the credit party
            await db.sequelize.query(`
                UPDATE t_credits 
                SET creditlist_id = :newCreditlistId,
                    updated_by = :userId,
                    updation_date = NOW()
                WHERE tcredit_id = :tcreditId
            `, {
                replacements: { 
                    newCreditlistId, 
                    tcreditId, 
                    userId 
                },
                type: db.Sequelize.QueryTypes.UPDATE
            });

            res.json({ 
                success: true, 
                message: 'Credit party updated successfully',
                newCreditParty: creditPartyCheck[0].Company_Name
            });

        } catch (error) {
            console.error('Error updating credit party:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
};