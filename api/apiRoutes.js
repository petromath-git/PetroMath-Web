const express = require("express");
const passport = require("passport");
const { generateToken, verifyToken,apiLoginLimiter } = require("./apiAuthConfig");
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
            userRole:user.Role
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

// Billing routes
router.get('/bills', verifyToken, (req, res, next) => {
    req.location_code = req.user.location_code;
    billController.getBillsApi(req, res, next);
});

router.get('/bills/needs', verifyToken, (req, res, next) => {
    req.location_code = req.user.location_code;
    billController.getNewBillApi(req, res, next);
});

router.post('/bills/create', verifyToken, (req, res, next) => {
    req.location_code = req.user.location_code;
    billController.createBillApi(req, res, next);
});

module.exports = router;
