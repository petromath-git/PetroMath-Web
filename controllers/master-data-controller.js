const PersonDao = require("../dao/person-dao");
var dateFormat = require('dateformat');
const dbMapping = require("../db/ui-db-field-mapping");
const msg = require("../config/app-messages");
const config = require("../config/app-config");

module.exports = {
    findUsers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let users = [];
            PersonDao.findUsers(locationCode)
                .then(data => {
                    data.forEach((user) => {
                        users.push({
                            id: user.Person_id,
                            name: user.Person_Name,
                            username: user.User_Name,
                            role: user.Role,
                            effective_start_date: dateFormat(user.effective_start_date, "dd-mmm-yyyy"),
                        });
                    });
                    resolve(users);
                });
        });
    },

    findDisableUsers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let users = [];
            PersonDao.findDisableUsers(locationCode)
                .then(data => {
                    data.forEach(user => {
                        users.push({
                            id: user.Person_id,
                            name: user.Person_Name,
                            username: user.User_Name,
                            role: user.Role,
                            effective_end_date: dateFormat(user.effective_end_date, "dd-mmm-yyyy"),
                        });
                    });
                    resolve(users);
                })
                .catch(err => {
                    console.error("Error in masterController:", err);
                    reject(err);
                });
        });
    },

    // Can the logged-in user disable/enable this person? Same location and a role below theirs.
    checkCanManageUser: async (reqUser, targetId) => {
        if (String(targetId) === String(reqUser.Person_id)) {
            return { ok: false, status: 400, error: 'You cannot change your own login.' };
        }
        const target = await PersonDao.findUserById(targetId);
        if (!target || target.creditlist_id) {
            return { ok: false, status: 404, error: 'User not found.' };
        }
        if (reqUser.Role !== 'SuperUser') {
            const manageableRoles = config.APP_CONFIGS.manageableRoles[reqUser.Role] || [];
            if (target.location_code !== reqUser.location_code) {
                return { ok: false, status: 403, error: 'This user belongs to another location.' };
            }
            if (!manageableRoles.includes(target.Role)) {
                return { ok: false, status: 403, error: `You are not allowed to change ${target.Role} users.` };
            }
        }
        return { ok: true };
    },

    // Users page: active list + disabled list (view = 'active' | 'disabled')
    renderUsersPage: async (req, res, { status = 200, messages, view = 'active' } = {}) => {
        const locationCode = req.user.location_code;
        const [activeUsers, disabledUsers] = await Promise.all([
            module.exports.findUsers(locationCode),
            module.exports.findDisableUsers(locationCode)
        ]);
        // A user disabled today has end date = today, so the DAO returns them in both lists
        const disabledIds = new Set(disabledUsers.map(u => u.id));
        res.status(status).render('users', {
            title: 'Users',
            mobileReady: true,   // tables stack into cards on phones (m-stack)
            user: req.user,
            users: activeUsers.filter(u => !disabledIds.has(u.id)),
            disabledUsers,
            view: view === 'disabled' ? 'disabled' : 'active',
            manageableRoles: config.APP_CONFIGS.manageableRoles[req.user.Role] || [],
            ...(messages && { messages })
        });
    },

createUser: async (req, res) => {
    const newUser = dbMapping.newUser(req);
    const manageableRoles = config.APP_CONFIGS.manageableRoles[req.user.Role] || [];
    const renderError = (status, messages) => module.exports.renderUsersPage(req, res, { status, messages });

    if (!newUser.Person_Name || newUser.Person_Name.trim() === '') {
        return renderError(400, { warning: 'Name cannot be empty or contain only spaces' });
    }

    if (!manageableRoles.includes(newUser.Role)) {
        return renderError(403, { warning: `You are not allowed to create users with role "${newUser.Role}"` });
    }

    try {
        // Resolve username conflicts with sequential numbering
        newUser.User_Name = await module.exports.resolveUsernameConflict(newUser.User_Name);

        // Check for duplicate person name only (not username since we resolve conflicts)
        const db = require("../db/db-connection");
        const Person = db.person;

        const existingUsers = await Person.findAll({
            where: {
                Person_Name: newUser.Person_Name,
                location_code: newUser.location_code
            }
        });

        if (existingUsers && existingUsers.length > 0) {
            renderError(400, { warning: `User "${newUser.Person_Name}" already exists in location ${newUser.location_code}` });
        } else {
            await PersonDao.create(newUser);
            res.redirect('/users');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        renderError(500, { error: 'Error creating user. Please try again.' });
    }
},
    resolveUsernameConflict: async (proposedUsername) => {
        let finalUsername = proposedUsername;
        let counter = 1;
        
        while (await module.exports.usernameExists(finalUsername)) {
            // Extract base and location parts
            const lastDash = proposedUsername.lastIndexOf('-');
            const base = proposedUsername.substring(0, lastDash);
            const location = proposedUsername.substring(lastDash);
            
            finalUsername = base + counter + location;
            counter++;
            
            // Safety limit
            if (counter > 99) break;
        }
        
        return finalUsername;
    },

    usernameExists: async (username) => {
        try {
            const PersonDao = require("../dao/person-dao");
            return await PersonDao.usernameExists(username);
        } catch (error) {
            console.error('Error checking username existence:', error);
            return false;
        }
    }
    
}
