// Shared by password login (app.js) and Face ID / fingerprint login
// (routes/passkey-routes.js), so both apply the same checks and land the
// user on the same page.
const crypto = require("crypto");
const dateFormat = require("dateformat");
const security = require("./app-security");
const requestCache = require("./request-cache");
const UserData = require("../value/UserData");
const LocationDao = require("../dao/location-dao");
const MenuAccessDao = require("../dao/menu-access-dao");
const personLocationDao = require("../dao/person-location-dao");
const LoginLogDao = require("../dao/login-log-dao");
const { handleVersionRouting } = require("./version-routing");
const { isPhone } = require("./mobile-menu");

// Fingerprint of the stored password hash. Logins and passkeys remember it, so a
// password change by any route (self, admin reset, direct SQL) ends them.
function passwordSig(person) {
    return crypto.createHash('sha256').update(String(person.Password || '')).digest('hex');
}

// person: an m_persons row whose identity is already proven (password or passkey).
// Returns { user } on success, or { failure: { message, Person_id, location_code } }.
async function buildLoginUser(person) {
    const today_date = dateFormat(new Date(), "yyyy-mm-dd");
    if (!(person.effective_end_date > today_date)) {
        return { failure: {
            message: `${person.User_Name} Your User Account is Disabled`,
            Person_id: person.Person_id,
            location_code: person.location_code
        } };
    }

    // Check if user's location is active and get service tier
    const locationStatus = await LocationDao.isLocationActive(person.location_code);
    if (!locationStatus.isActive) {
        return { failure: { message: 'This location is currently inactive. Please contact your administrator.' } };
    }

    const isAdmin = security.isAdminChk(person);
    const menus = await MenuAccessDao.getAllowedMenusForUser(person.Role, person.location_code);
    const allowedMenus = menus.map(m => m.menu_code);

    // Locations this person is explicitly assigned to (m_person_location),
    // beyond their single home location_code above.
    const personLocations = await personLocationDao.getPersonLocations(person.Person_id);
    const assignedLocations = personLocations.map(pl => pl.location_code);

    const user = new UserData(person, isAdmin, allowedMenus, menus, locationStatus.service_tier, assignedLocations);
    user.pwd_sig = passwordSig(person); // checked on every request in deserializeUser
    // deserializeUser caches the account for a minute; drop it so a password
    // changed just before this login isn't compared against the old one
    requestCache.invalidate('person:' + person.User_Name);
    return { user };
}

// Runs after req.logIn succeeded: login log, beta access check, landing page.
// sendTo(url) delivers the destination: a redirect for the login form, JSON
// for the passkey login (which is called from JavaScript).
async function completeLogin(req, user, attemptedUsername, sendTo) {
    try {
        await LoginLogDao.create({
            Person_id: user.Person_id,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            attempted_username: attemptedUsername,
            login_status: 'success',
            location_code: user.location_code,
            created_by: user.Person_id.toString()
        });
    } catch (error) {
        console.error("Error logging login:", error);
    }

    // handleVersionRouting only ever calls res.redirect
    const shouldRedirect = await handleVersionRouting(user, req, { redirect: sendTo });
    if (shouldRedirect) {
        return; // Redirect happened, stop processing
    }

    // Cashier goes directly to credit entry page
    if (user.Role === 'Cashier') {
        return sendTo('/dsm-entry');
    }
    // TeleCaller only works dealer leads
    if (user.Role === 'TeleCaller') {
        return sendTo('/dealer-leads/admin');
    }
    // Superuser picks a location first
    if (user.Role === 'SuperUser') {
        return sendTo('/select-location');
    }
    if (user.Role === 'Customer') {
        return sendTo('/home-customer');
    }
    return sendTo(isPhone(req) ? '/m' : '/home');
}

async function logFailedLogin(req, attemptedUsername, failure) {
    try {
        await LoginLogDao.create({
            Person_id: failure.Person_id || null,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            attempted_username: attemptedUsername,
            login_status: 'failed',
            failure_reason: failure.message,
            location_code: failure.location_code || null,
            created_by: 'SYSTEM'
        });
    } catch (error) {
        console.error("Error logging failed login:", error);
    }
}

module.exports = { buildLoginUser, completeLogin, logFailedLogin, passwordSig };
