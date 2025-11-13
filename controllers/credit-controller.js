const CreditDao = require("../dao/credits-dao");
const PersonDao = require("../dao/person-dao");
var dateFormat = require('dateformat');


module.exports = {
    findCredits: (locationCode) => {
        return new Promise((resolve, reject) => {
            let credits = [];
            CreditDao.findAll(locationCode)
                .then(data => {
                    data.forEach((credit) => {
                        credits.push({
                            id: credit.creditlist_id,
                            name: credit.Company_Name,
                            type: credit.type,
                            address: credit.address,
                            phoneno: credit.phoneno,
                            gst: credit.gst,
                            short_name: credit.short_name,
                            balance: credit.Opening_Balance,
                            // effective_start_date: dateFormat(credit.effective_start_date, "dd-mm-yyyy"),
                        });
                    });
                    resolve(credits);
                });
        });
    },

    // NEW function specifically for credit master page (excludes digital)
findCreditCustomersOnly: async (locationCode) => {
    try {
        const query = `
            SELECT 
                mcl.creditlist_id,
                mcl.Company_Name,
                mcl.type,
                mcl.short_name,
                mcl.address,
                mcl.phoneno,
                mcl.gst,
                mcl.remittance_bank_id,
                mcl.Opening_Balance,
                mb.account_nickname as bank_name,
                mb.bank_name as full_bank_name
            FROM m_credit_list mcl
            LEFT JOIN m_bank mb ON mcl.remittance_bank_id = mb.bank_id
            WHERE mcl.location_code = :locationCode
              AND (mcl.card_flag IS NULL OR mcl.card_flag != 'Y')
              AND (mcl.effective_start_date IS NULL OR CURDATE() >= mcl.effective_start_date)
              AND (mcl.effective_end_date IS NULL OR CURDATE() < mcl.effective_end_date)
            ORDER BY mcl.Company_Name
        `;

        const credits = await require("../db/db-connection").sequelize.query(query, {
            replacements: { locationCode },
            type: require("sequelize").QueryTypes.SELECT
        });

        // Get usernames for each customer
        const creditsWithUsernames = await Promise.all(
            credits.map(async (credit) => {
                try {
                    const PersonDao = require('../dao/person-dao');
                    const person = await PersonDao.findPersonByCreditlistId(credit.creditlist_id);
                    
                    return {
                        creditlist_id: credit.creditlist_id,
                        Company_Name: credit.Company_Name,
                        type: credit.type,
                        short_name: credit.short_name,
                        address: credit.address,
                        phoneno: credit.phoneno,
                        gst: credit.gst,
                        remittance_bank_id: credit.remittance_bank_id,
                        bank_name: credit.bank_name || credit.full_bank_name,
                        Opening_Balance: credit.Opening_Balance,
                        username: person ? person.User_Name : 'No Login Account'
                    };
                } catch (err) {
                    console.error(`Error fetching user for creditlist_id ${credit.creditlist_id}:`, err);
                    return {
                        creditlist_id: credit.creditlist_id,
                        Company_Name: credit.Company_Name,
                        type: credit.type,
                        short_name: credit.short_name,
                        address: credit.address,
                        phoneno: credit.phoneno,
                        gst: credit.gst,
                        remittance_bank_id: credit.remittance_bank_id,
                        bank_name: credit.bank_name || credit.full_bank_name,
                        Opening_Balance: credit.Opening_Balance,
                        username: 'Error Loading'
                    };
                }
            })
        );
        
        return creditsWithUsernames;
    } catch (error) {
        console.error('Error in findCreditCustomersOnly:', error);
        throw error;
    }
},

    findDisableCredits: (locationCode) => {
        return new Promise((resolve, reject) => {
            let credits = [];
            CreditDao.findDisableCredits(locationCode)
                .then(data => {
                    data.forEach((credit) => {
                        credits.push({
                            id: credit.creditlist_id,
                            name: credit.Company_Name,
                            type: credit.type,
                            address: credit.address,
                            phoneno: credit.phoneno,
                            gst: credit.gst,
                            short_name: credit.short_name,
                            balance: credit.Opening_Balance,
                            // effective_end_date: dateFormat(credit.effective_end_date, "dd-mm-yyyy"),
                        });
                    });
                    resolve(credits);
                })
        });
    },

    // NEW function specifically for disabled credit customers only (excludes digital)
    findDisableCreditCustomersOnly: (locationCode) => {
        return new Promise((resolve, reject) => {
            let credits = [];
            CreditDao.findDisableCredits(locationCode)
                .then(data => {
                    data.forEach((credit) => {
                        // Only include non-digital customers
                        if (!(credit.card_flag === 'Y')) {
                            credits.push({
                                id: credit.creditlist_id,
                                name: credit.Company_Name,
                                type: credit.type,
                                address: credit.address,
                                phoneno: credit.phoneno,
                                gst: credit.gst,
                                short_name: credit.short_name,
                                balance: credit.Opening_Balance,
                                // effective_end_date: dateFormat(credit.effective_end_date, "dd-mm-yyyy"),
                            });
                        }
                    });
                    resolve(credits);
                })
        });
    },

    // New digital customer functions
    findDigitalCustomers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let digitalCustomers = [];
            CreditDao.findAll(locationCode)
                .then(data => {
                    data.forEach((credit) => {
                        // Only include digital customers (card_flag = 'Y')
                        if (credit.card_flag === 'Y') {
                            digitalCustomers.push({
                                id: credit.creditlist_id,
                                name: credit.Company_Name,
                                type: credit.type,
                                address: credit.address,
                                phoneno: credit.phoneno,
                                gst: credit.gst,
                                short_name: credit.short_name,
                                balance: credit.Opening_Balance,
                                // effective_start_date: dateFormat(credit.effective_start_date, "dd-mm-yyyy"),
                            });
                        }
                    });
                    resolve(digitalCustomers);
                })
                .catch(err => {
                    reject(err);
                });
        });
    },

    findDisableDigitalCustomers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let digitalCustomers = [];
            CreditDao.findDisableCredits(locationCode)
                .then(data => {
                    data.forEach((credit) => {
                        // Only include disabled digital customers
                        if (credit.card_flag === 'Y') {
                            digitalCustomers.push({
                                id: credit.creditlist_id,
                                name: credit.Company_Name,
                                type: credit.type,
                                address: credit.address,
                                phoneno: credit.phoneno,
                                gst: credit.gst,
                                short_name: credit.short_name,
                                balance: credit.Opening_Balance,
                                // effective_end_date: dateFormat(credit.effective_end_date, "dd-mm-yyyy"),
                            });
                        }
                    });
                    resolve(digitalCustomers);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}