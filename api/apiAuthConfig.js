const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ORM DB - start
const db = require("../db/db-connection");
const Person = db.person;
db.sequelize.sync();
// ORM DB - end


// Limiter and log start
const rateLimit = require("express-rate-limit");
const LoginLogDao = require("../dao/login-log-dao"); 
// end

// Local strategy for API
passport.use('local-api', new LocalStrategy(
    {
        usernameField: 'username',
        passwordField: 'password',
        session: false
    },
    async (username, password, done) => {
        try {
            const user = await Person.findOne({ where: { User_name: username } });
            if (!user) {
                return done(null, false, { message: 'Invalid username or password' });
            }

            const isPasswordValid = await bcrypt.compare(password, user.Password);
            if (!isPasswordValid) {
                return done(null, false, { message: 'Invalid username or password' });
            }

            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

// Function to generate JWT token
module.exports.generateToken = (user) => {
    return jwt.sign(
        {
            person_id: user.Person_id,
            username: user.User_name,
            role: user.Role,
            location_code: user.location_code,
            creditlist_id: user.creditlist_id
        },
        process.env.JWT_SECRET,
        // { expiresIn: "1d" }
    );
};

// Middleware to verify JWT
module.exports.verifyToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
        return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid token" });
        req.user = decoded;
        next();
    });
};

// Middleware to ensure only customers can access customer API routes
module.exports.isCustomerOnly = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized: No user in request" });
    }

    if (req.user.role !== 'Customer') {  // use lowercase 'role' from token payload
        return res.status(403).json({
            success: false,
            message: 'Access denied. This feature is only available for customers.'
        });
    }

    next();
};


module.exports.apiLoginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,
    message: {
        success: false,
        error: 'Too many login attempts from this IP',
        retryAfter: '5 minutes',
        hint: 'Please wait 5 minutes before trying again'
    },
    handler: (req, res) => {
        LoginLogDao.create({
            Person_id: null,
            ip_address: req.ip,
            user_agent: req.get('User-Agent'),
            attempted_username: req.body.username,
            login_status: 'rate_limited',
            failure_reason: 'Rate limit exceeded - too many attempts',
            location_code: 'DEMOSYSTEM',
            created_by: 'SYSTEM'
        }).catch(err => console.error("Error logging rate limit:", err));

        return res.status(429).json({
            success: false,
            message: 'Too many login attempts from this IP. Please wait 5 minutes.'
        });
    }
});

