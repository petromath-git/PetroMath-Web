const PersonDao = require("../dao/person-dao");
var dateFormat = require('dateformat');
const dbMapping = require("../db/ui-db-field-mapping");
const msg = require("../config/app-messages");

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
                            effective_start_date: dateFormat(user.effective_start_date, "dd-mm-yyyy"),
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
                            effective_end_date: dateFormat(user.effective_end_date, "dd-mm-yyyy"),
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

createUser: async (req, res) => {
    const newUser = dbMapping.newUser(req);

     if (!newUser.Person_Name || newUser.Person_Name.trim() === '') {
        const users = await module.exports.findUsers(req.user.location_code);
        return res.status(400).render('users', {
            title: 'Users',
            user: req.user,
            users: users,
            messages: { warning: 'Name cannot be empty or contain only spaces' }
        });
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
            const users = await module.exports.findUsers(newUser.location_code);
            res.status(400).render('users', {
                title: 'Users',
                user: req.user,
                users: users,
                messages: { warning: `User "${newUser.Person_Name}" already exists in location ${newUser.location_code}` }
            });
        } else {
            await PersonDao.create(newUser);
            res.redirect('/users');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        const users = await module.exports.findUsers(newUser.location_code);
        res.status(500).render('users', {
            title: 'Users',
            user: req.user,
            users: users,
            messages: { error: 'Error creating user. Please try again.' }
        });
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
