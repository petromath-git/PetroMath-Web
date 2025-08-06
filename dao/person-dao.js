const db = require("../db/db-connection");
const Person = db.person;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");
const dateFormat = require("dateformat");

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
    changePwd: (user, currentPassword) => {
        return new Promise((resolve, reject) => {
            Person.update({
                Password: user.Password
            }, {
                where: {'Password': currentPassword, 'Person_id': user.Person_id},
            }).then(function (result) {
                const firstElement = result.shift();
                if (firstElement === 1) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });

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



};