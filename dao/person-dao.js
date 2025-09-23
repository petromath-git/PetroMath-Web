const db = require("../db/db-connection");
const Person = db.person;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");
const dateFormat = require("dateformat");
const bcrypt = require('bcrypt');

module.exports = {
    findUsers: (locationCode) => {
        if (locationCode) {
            return Person.findAll({
                where: {
                    [Op.and]: [
                        { 'location_code': locationCode }, 
                        { 'effective_end_date': { [Op.gte]: utils.currentDate() } },
                        { 'creditlist_id': null }

                    ]
                }, order: [
                    ['role', 'ASC']
                ]
            });
        } else {
            return Person.findAll();
        }
    },
    findUserByName: (personName, userName, locationCode) => {
        if (locationCode) {
            return Person.findAll({
                where: {
                    [Op.and]: {
                        [Op.or]: {
                            'Person_Name': personName,
                            'User_Name': userName,
                        },
                        'location_code': locationCode
                    },
                }
            });
        } else {
            return Person.findAll({
                where: {
                    'Person_Name': personName,
                    'User_Name': userName
                }
            });
        }
    },
    findUserLocations: async (personId) => {
        const result = await db.sequelize.query(`
            SELECT location_code FROM m_persons WHERE person_id = :personId
            UNION
            SELECT location_code FROM m_person_location WHERE person_id = :personId AND now() BETWEEN effective_start_date AND effective_end_date
        `, {
            replacements: { personId: personId },
            type: Sequelize.QueryTypes.SELECT
        });
        return result;
    },
    findUserLocationRoleAccess: async (personId) => {
        const result = await db.sequelize.query(`
            SELECT 'PRIMARY' as source, location_code, role, 'Primary Location' as access_type
            FROM m_persons 
            WHERE Person_id = :personId
            UNION
            SELECT 'ADDITIONAL' as source, location_code, role, 'Additional Access' as access_type
            FROM m_person_location 
            WHERE person_id = :personId 
            AND CURDATE() BETWEEN effective_start_date AND effective_end_date
            ORDER BY source, location_code
        `, {
            replacements: { personId: personId },
            type: db.sequelize.QueryTypes.SELECT
        });
        
        return result;
    },
    // Helper method to check if user has access to multiple locations
hasMultipleLocationAccess: async (personId) => {
    try {
        const locations = await module.exports.findUserLocationRoleAccess(personId);
        return locations.length > 1;
    } catch (error) {
        console.error('Error in hasMultipleLocationAccess:', error);
        return false;
    }
},

// Get user's accessible locations with location names
getUserAccessibleLocationsWithNames: async (personId) => {
    try {
        const result = await db.sequelize.query(`
            SELECT DISTINCT
                loc_access.source,
                loc_access.location_code,
                loc_access.role,
                loc_access.access_type,
                ml.location_name,
                loc_access.person_name,
                loc_access.person_id
            FROM (
                SELECT 
                    'PRIMARY' as source, 
                    location_code, 
                    role, 
                    'Primary Location' as access_type,
                    Person_Name as person_name,
                    Person_id as person_id
                FROM m_persons 
                WHERE Person_id = :personId
                UNION
                SELECT 
                    'ADDITIONAL' as source, 
                    pl.location_code, 
                    pl.role, 
                    'Additional Access' as access_type,
                    p.Person_Name as person_name,
                    p.Person_id as person_id
                FROM m_person_location pl
                JOIN m_persons p ON pl.person_id = p.Person_id
                WHERE pl.person_id = :personId 
                AND CURDATE() BETWEEN pl.effective_start_date AND pl.effective_end_date
            ) loc_access
            JOIN m_location ml ON loc_access.location_code = ml.location_code
            ORDER BY loc_access.source, ml.location_name
        `, {
            replacements: { personId: personId },
            type: db.sequelize.QueryTypes.SELECT
        });
        
        return result;
    } catch (error) {
        console.error('Error in getUserAccessibleLocationsWithNames:', error);
        throw error;
    }
},
    create: (user) => {
        return new Promise((resolve, reject) => {
            // Hash the user's password before saving
            bcrypt.hash(user.Password, 12, (err, hashedPassword) => {
                if (err) {
                    return reject('Error hashing password');
                }

                // Set the hashed password in the user object
                user.Password = hashedPassword;

                // Create the new user with the hashed password
                Person.create(user)
                    .then(createdUser => {
                        resolve(createdUser); // Return the created user
                    })
                    .catch(reject); // In case of an error during user creation
            });
        });
    },
   // dao/person-dao.js - Replace the existing changePwd method
    changePwd: async (user, currentPassword) => {
        try {
            // First, find the user and verify current password
            const existingUser = await Person.findOne({
                where: { Person_id: user.Person_id }
            });

            if (!existingUser) {
                throw new Error('User not found');
            }

            // Verify current password using bcrypt
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, existingUser.Password);
            
            if (!isCurrentPasswordValid) {
                throw new Error('Current password is incorrect');
            }

            // Update with new hashed password
            const result = await Person.update({
                Password: user.Password  // This should already be hashed
            }, {
                where: { Person_id: user.Person_id }
            });

            return result[0] === 1; // Return true if one record was updated
        } catch (error) {
            console.error('Error changing password:', error);
            throw error;
        }
    },

    // Also add a simpler method for admin resets (no current password check)
    updatePassword: async (userId, newHashedPassword) => {
        try {
            const result = await Person.update({
                Password: newHashedPassword
            }, {
                where: { Person_id: userId }
            });

            return result[0] === 1;
        } catch (error) {
            console.error('Error updating password:', error);
            throw error;
        }
    },


     usernameExists: async (username) => {
        try {
            const user = await Person.findOne({ where: { User_Name: username } });
            return user !== null;
        } catch (error) {
            console.error('Error checking username existence:', error);
            return false;
        }
    },
    findUserById: (userId) => {
        return Person.findOne({
            where: { Person_id: userId }
        });
    },
    findDrivers: (locationCode) => {
        return Person.findAll({
            where: {
                'location_code': locationCode,
                [Op.or]: [{'Role': 'Driver'}, {'Role': 'Helper'}]
            }
        });
    },
    // findAllUsers: (locationCode) => {
    //     if (locationCode) {
    //         return Person.findAll({
    //             where: {'location_code': locationCode}
    //         });
    //     } else {
    //         return Person.findAll();
    //     }
    // },

    disableUser: (personId) => {
        let now = new Date();
        const formattedDate = dateFormat(now, "yyyy-mm-dd");
        console.log(formattedDate);
        return Person.update({
            effective_end_date: formattedDate
        }, {
            where: { 'Person_id': personId }
        });
    },

    findDisableUsers: (locationCode) => {
        const now = new Date(); // Current date
        return Person.findAll({
            where: {
                [Op.and]: [
                    { location_code: locationCode }, // Match location code
                    { effective_end_date: { [Op.lt]: now } }, // effective_start_date < current date
                    { creditlist_id: null }
                ]    
            },order: [
                ['effective_end_date', 'DESC']
            ]
        });
    },

    enableUser: (personId) => {
        const UpdateDate = "2400-01-01"; // Use this fixed date
        return Person.update(
            { effective_end_date: UpdateDate },
            { where: { Person_id: personId } }
        );
    },
    findPersonByCreditlistId: (creditlist_id) => {
        return Person.findOne({
            where: { 
                creditlist_id: creditlist_id 
            }
        });
    },
    findUsersAndCreditList: (locationCode) => {
        if (locationCode) {
            return Person.findAll({
                where: {
                    [Op.and]: [
                        { 'location_code': locationCode },
                        { 'effective_end_date': { [Op.gte]: utils.currentDate() } }
                    ]
                },
                order: [
                    // Custom ordering: Role 'Customer' should come last
                    [Sequelize.literal(`CASE WHEN "Role" = 'Customer' THEN 1 ELSE 0 END`), 'ASC'],
                    ['role', 'ASC']
                ]
            });
        } else {
            return Person.findAll();
        }
    },
    // Add this method to your existing person-dao.js module.exports
createUserForCredit: async (credit, currentUser) => {
    try {
        const bcrypt = require('bcrypt');
        
        // Check if user already exists for this creditlist_id
        const existingUser = await Person.findOne({
            where: { creditlist_id: credit.creditlist_id }
        });
        
        if (!existingUser) {
            // Use standard welcome password for all new credit customers
            const defaultPassword = 'welcome123';
            
            // Hash the password with 12 salt rounds (consistent with app)
            const hashedPassword = await bcrypt.hash(defaultPassword, 12);
            
            // Create the user
            const newUser = await Person.create({
                Person_Name: credit.Company_Name,
                User_Name: `${credit.location_code}${credit.creditlist_id}`,
                Password: hashedPassword,
                Role: 'Customer',
                location_code: credit.location_code,
                effective_start_date: credit.effective_start_date || new Date(),
                effective_end_date: credit.effective_end_date || new Date('2099-12-31'),
                created_by: currentUser.User_Name,
                updated_by: currentUser.User_Name,
                creditlist_id: credit.creditlist_id,
                creation_date: new Date(),
                updation_date: new Date()
            });
            
            console.log(`User created for credit customer: ${credit.Company_Name} (ID: ${credit.creditlist_id})`);
            return newUser;
        } else {
            console.log(`User already exists for creditlist_id: ${credit.creditlist_id}`);
            return existingUser;
        }
    } catch (error) {
        console.error('Error creating user for credit:', error);
        throw error; // Let the calling function decide how to handle the error
    }
},



};