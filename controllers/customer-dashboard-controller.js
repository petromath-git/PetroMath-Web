// controllers/customer-dashboard-controller.js
const ReportDao = require("../dao/report-dao");
const MileageDao = require("../dao/mileage-dao");

module.exports = {
    
    // ============================================
    // CREDIT STATEMENT METHODS
    // ============================================
    
    getCreditStatementDashboard: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const creditlistId = req.user.creditlist_id;
            
            // Fetch company name directly to ensure it's available
        const CreditDao = require("../dao/credits-dao");
        let companyName = 'Customer'; // fallback
        
        try {
            const creditDetails = await CreditDao.findCreditDetails(creditlistId);
            if (creditDetails && creditDetails.length > 0) {
                companyName = creditDetails[0].Company_Name;
                console.log('Dashboard using company name:', companyName);
            }
        } catch (error) {
            console.log('Could not fetch company name for dashboard:', error);
        }    


            
            // Get current date for default filtering (IST-aware)
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth(); // 0-based (0 = January)
            const currentDate = today.getDate();

            // First day of current month in IST
            const defaultFromDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;

            // Today's date in IST  
            const defaultToDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDate).padStart(2, '0')}`;

            res.render('customer-credit-statement', {
                title: 'Credit Statement',
                user: req.user,
                companyName: companyName,
                defaultFromDate: defaultFromDate,
                defaultToDate: defaultToDate,
                creditlistId: creditlistId
            });

        } catch (error) {
            console.error('Error in getCreditStatementDashboard:', error);
            res.status(500).render('error', {
                message: 'Error loading credit statement dashboard',
                error: error
            });
        }
    },

    getCreditStatementDataAPI: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const creditlistId = req.user.creditlist_id;
            const fromDate = req.query.fromDate;
            const toDate = req.query.toDate;

            // Get opening and closing balance
            const balanceData = await ReportDao.getBalance(creditlistId, fromDate, toDate);
            const openingBalance = balanceData[0]?.OpeningData || 0;
            const closingBalance = balanceData[0]?.ClosingData || 0;

            // Get credit statement transactions
            const transactions = await ReportDao.getCreditStmt(locationCode, fromDate, toDate, creditlistId);

            
             // Process transactions for dashboard display - use transaction_type from DAO
            const processedTransactions = transactions.map(txn => ({
                date: txn.tran_date,
                description: txn.bill_no || 'Transaction',
                product: txn.product_name || '',
                quantity: txn.qty || 0,
                rate: txn.price || 0,
                // Handle amount signs based on transaction_type:
                // RECEIPT and ADJUSTMENT_CREDIT reduce balance (negative)
                // SALE and ADJUSTMENT_DEBIT increase balance (positive)
                amount: (txn.transaction_type === 'RECEIPT' || txn.transaction_type === 'ADJUSTMENT_CREDIT') 
                    ? -(txn.amount || 0) 
                    : (txn.amount || 0),
                type: (txn.transaction_type === 'RECEIPT' || txn.transaction_type === 'ADJUSTMENT_CREDIT') 
                    ? 'credit' 
                    : 'debit',
                transaction_type: txn.transaction_type,
                notes: txn.notes || ''
            }));

          // Calculate totals based on transaction_type for summary cards
            const totalDebits = transactions
                .filter(txn => txn.transaction_type === 'SALE' || txn.transaction_type === 'ADJUSTMENT_DEBIT')
                .reduce((sum, txn) => sum + parseFloat(txn.amount), 0);

            const totalCredits = transactions
                .filter(txn => txn.transaction_type === 'RECEIPT' || txn.transaction_type === 'ADJUSTMENT_CREDIT')
                .reduce((sum, txn) => sum + parseFloat(txn.amount), 0);

            res.json({
                success: true,
                data: {
                    openingBalance: parseFloat(openingBalance),
                    closingBalance: parseFloat(closingBalance),
                    totalDebits: totalDebits,
                    totalCredits: totalCredits,
                    transactions: processedTransactions,
                    transactionCount: transactions.length,
                    period: {
                        fromDate: fromDate,
                        toDate: toDate
                    }
                }
            });

        } catch (error) {
            console.error('Error in getCreditStatementDataAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch credit statement data: ' + error.message
            });
        }
    },

    getAccountBalanceAPI: async (req, res) => {
        try {
            const creditlistId = req.user.creditlist_id;
            const today = new Date().toISOString().split('T')[0];

            // Get current balance
            const balanceData = await ReportDao.getBalance(creditlistId, today, today);
            const currentBalance = balanceData[0]?.ClosingData || 0;

            res.json({
                success: true,
                data: {
                    currentBalance: parseFloat(currentBalance),
                    asOfDate: today
                }
            });

        } catch (error) {
            console.error('Error in getAccountBalanceAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch account balance: ' + error.message
            });
        }
    },

    getRecentTransactionsAPI: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const creditlistId = req.user.creditlist_id;
            const limit = req.query.limit || 10;

            // Get last 30 days of transactions
            const today = new Date();
            const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
            const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
            const toDate = today.toISOString().split('T')[0];

            const transactions = await ReportDao.getCreditStmt(locationCode, fromDate, toDate, creditlistId);

            // Sort by date (most recent first) and limit
            const recentTransactions = transactions
                .sort((a, b) => new Date(b.tran_date) - new Date(a.tran_date))
                .slice(0, parseInt(limit))
                .map(txn => ({
                    date: txn.tran_date,
                    description: txn.bill_no || txn.receipt_no || 'Transaction',
                    amount: parseFloat(txn.amount),
                    type: txn.bill_no ? 'debit' : 'credit'
                }));

            res.json({
                success: true,
                data: {
                    transactions: recentTransactions,
                    totalCount: transactions.length
                }
            });

        } catch (error) {
            console.error('Error in getRecentTransactionsAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch recent transactions: ' + error.message
            });
        }
    },
};