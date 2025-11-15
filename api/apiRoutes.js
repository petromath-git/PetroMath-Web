const express = require("express");
const passport = require("passport");
const { generateToken, verifyToken, apiLoginLimiter, isCustomerOnly, hasPermission } = require("./apiAuthConfig");
require("./apiAuthConfig"); // Load API strategy
const router = express.Router();
const LoginLogDao = require("../dao/login-log-dao");
const masterController = require("../controllers/master-data-controller");
const billController = require("../controllers/bill-controller");

// API Logins with logging
router.post("/login", apiLoginLimiter, async (req, res, next) => {
    console.log(`📨 POST /api/login received for: ${req.body.username} from ${req.ip}`);

    // If rate-limited (shouldn’t pass if properly blocked)
    if (req.rateLimit && req.rateLimit.remaining === 0) {
        console.log(`❌ Should be rate limited but got through: ${req.ip}`);
    }

    passport.authenticate('local-api', { session: false }, async (err, user, info) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }

        // Common login info
        const loginInfo = {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            attempted_username: req.body.username
        };

        if (!user) {
            // Log failed attempt
            try {
                await LoginLogDao.create({
                    Person_id: info?.Person_id || null,
                    ip_address: loginInfo.ip_address,
                    user_agent: loginInfo.user_agent,
                    attempted_username: loginInfo.attempted_username,
                    login_status: 'failed',
                    failure_reason: info?.message || 'Invalid username or password',
                    location_code: info?.location_code || null,
                    created_by: 'SYSTEM'
                });
            } catch (error) {
                console.error("Error logging failed API login:", error);
            }

            return res.status(203).json({
                success: false,
                message: info?.message || "Invalid username or password"
            });
        }

        // Success — generate token
        const token = generateToken(user);

        // Log successful login
        try {
            await LoginLogDao.create({
                Person_id: user.Person_id,
                ip_address: loginInfo.ip_address,
                user_agent: loginInfo.user_agent,
                attempted_username: loginInfo.attempted_username,
                login_status: 'success',
                location_code: user.location_code,
                created_by: user.Person_id.toString()
            });
        } catch (error) {
            console.error("Error logging API login:", error);
        }

        // Send JSON response for API
        return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            userId:user.Person_id,
            userName:user.User_Name,
            personName:user.Person_Name,
            location_code:user.location_code,
            userRole:user.Role,
            creditId:user.creditlist_id ?? '',
        });
    })(req, res, next);
});

router.get('/users', verifyToken, async (req, res) => {
    try {
        const { location_code } = req.query;
        const data = await masterController.findUsers(location_code);

        return res.status(200).json({
            success: true,
            user: req.user, // This comes from verifyToken decoded JWT
            list: data
        });
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch users",
            error: error.message
        });
    }
});

// // Billing routes
// router.get('/bills', verifyToken, (req, res, next) => {
//     req.location_code = req.user.location_code;
//     billController.getBillsApi(req, res, next);
// });

// router.get('/bills/needs', verifyToken, (req, res, next) => {
//     req.location_code = req.user.location_code;
//     billController.getNewBillApi(req, res, next);
// });

// router.post('/bills/create', verifyToken, (req, res, next) => {
//     req.location_code = req.user.location_code;
//     billController.createBillApi(req, res, next);
// });


// Import permission middleware (should already exist at top of file)
// const { verifyToken, hasPermission, isStaffOnly } = require('./apiAuthConfig');

/**
 * BILLING PERMISSIONS NEEDED:
 * - VIEW_BILLS: List and view bills
 * - CREATE_BILLS: Create new bills  
 * - EDIT_BILLS: Update existing bills
 * - DELETE_BILLS: Delete bills
 * - PRINT_BILLS: Generate bill PDFs
 * 
 * Note: These permissions should exist in m_role_permissions table
 * If not present, run the permission setup SQL first
 */

// ============================================
// 1. LIST BILLS
// ============================================
// GET /api/bills
// Query params: 
//   - fromDate (optional)
//   - toDate (optional)  
//   - billType (optional): 'CREDIT' or 'CASH'
//   - billStatus (optional): 'DRAFT' or 'ACTIVE'
// Returns: Array of bills with customer info, vehicle info, cashier info
router.get('/bills', 
    verifyToken, 
    hasPermission('VIEW_BILLS'),
    (req, res, next) => {
        billController.getBillsApi(req, res, next);
    }
);

// ============================================
// 2. GET BILL CREATION REQUIREMENTS
// ============================================
// GET /api/bills/needs
// Returns: 
//   - shifts: Active shifts for current location
//   - products: Available products
//   - credits: Credit customers (if applicable)
router.get('/bills/needs', 
    verifyToken,
    hasPermission('CREATE_BILLS'),
    (req, res, next) => {
        billController.getNewBillApi(req, res, next);
    }
);

// ============================================
// 3. CREATE NEW BILL
// ============================================
// POST /api/bills
// Body:
//   - closing_id: Shift ID (required)
//   - bill_type: 'CREDIT' or 'CASH' (required)
//   - items: Array of bill items (required)
//   - creditlist_id: Customer ID (required for CREDIT bills)
//   - bill_vehicle_id: Vehicle ID (optional for CREDIT)
//   - bill_vehicle_number: Vehicle number (optional for CASH)
//   - bill_odometer_reading: Odometer reading (optional)
//   - customer_name: Customer name (optional for CASH)
// Returns: { success, message, bill_no, bill_id }
router.post('/bills', 
    verifyToken,
    hasPermission('CREATE_BILLS'),
    (req, res, next) => {
        billController.createBillApi(req, res, next);
    }
);

// ============================================
// 4. GET SINGLE BILL DETAILS
// ============================================
// GET /api/bills/:billId
// Returns: Complete bill with all line items
router.get('/bills/:billId', 
    verifyToken,
    hasPermission('VIEW_BILLS'),
    (req, res, next) => {
        billController.getBillDetailsApi(req, res, next);
    }
);

// ============================================
// 5. UPDATE EXISTING BILL
// ============================================
// PUT /api/bills/:billId
// Body: Same as create, but for existing DRAFT bill
// Returns: { success, message, bill_no }
// Note: Only DRAFT bills can be updated
router.put('/bills/:billId', 
    verifyToken,
    hasPermission('EDIT_BILLS'),
    (req, res, next) => {
        billController.updateBillApi(req, res, next);
    }
);

// ============================================
// 6. DELETE BILL
// ============================================
// DELETE /api/bills/:billId
// Returns: { success, message }
// Note: Only DRAFT bills can be deleted, shift must be open
router.delete('/bills/:billId', 
    verifyToken,
    hasPermission('DELETE_BILLS'),
    (req, res, next) => {
        billController.deleteBillApi(req, res, next);
    }
);

// ============================================
// 7. GET BILL PDF
// ============================================
// GET /api/bills/:billId/pdf
// Returns: PDF buffer as base64 string or download link
// For mobile apps, we'll return base64 encoded PDF
router.get('/bills/:billId/pdf', 
    verifyToken,
    hasPermission('PRINT_BILLS'),
    (req, res, next) => {
        billController.getBillPDFApi(req, res, next);
    }
);

// ============================================
// OPTIONAL: BILL STATISTICS (FOR DASHBOARD)
// ============================================
// GET /api/bills/stats
// Query params: fromDate, toDate
// Returns: Summary statistics (total bills, total amount, by type, etc.)
router.get('/bills/stats', 
    verifyToken,
    hasPermission('VIEW_BILLS'),
    (req, res, next) => {
        billController.getBillStatsApi(req, res, next);
    }
);













///Customer related api
const customerController = require('../controllers/customer-dashboard-controller');
const reportController = require('../controllers/reports-controller');

router.get('/customer/d_getCreditList', verifyToken,isCustomerOnly, (req, res, next) => {
    customerController.getCreditStatementDashboardApi(req, res, next);
});

router.get('/customer/getCreditList', verifyToken,isCustomerOnly, (req, res, next) => {
    customerController.getCreditStatementDataAPI(req, res, next);
});

router.post('/customer/creditReport', verifyToken,isCustomerOnly, (req, res, next) => {
    reportController.getApiCreditReport1(req, res, next);
});


///Mileage related api
const vehicleController = require('../controllers/mileage-controller');

router.get('/customer/d_mileage', verifyToken, (req, res, next) => {
    vehicleController.getMileageDashboardApi(req, res, next);
});

router.get('/customer/mileage', verifyToken, (req, res, next) => {
    vehicleController.getMileageDataAPI(req, res, next);
});

router.get('/customer/mileage/:vehicleId', verifyToken, (req, res, next) => {
    vehicleController.getVehicleMileageDetails(req, res, next);
});

///Transaction correction api

const transactionCorrectionsController = require('../controllers/transaction-corrections-controller');

router.get('/transactions/search',verifyToken, transactionCorrectionsController.searchTransactions);

router.get('/transactions/customers',verifyToken, transactionCorrectionsController.getCustomers);


module.exports = router;
