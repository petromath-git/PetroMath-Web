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
        const allCredits = await CreditDao.findAll(locationCode);
        const nonDigitalCredits = allCredits.filter(credit => credit.card_flag !== 'Y');
        
        const creditsWithUsernames = await Promise.all(
            nonDigitalCredits.map(async (credit) => {
                try {
                    const person = await PersonDao.findPersonByCreditlistId(credit.creditlist_id);
                    
                    return {
                        id: credit.creditlist_id,
                        name: credit.Company_Name,
                        type: credit.type,
                        address: credit.address,
                        phoneno: credit.phoneno,
                        gst: credit.gst,
                        short_name: credit.short_name,
                        balance: credit.Opening_Balance,
                        username: person ? person.User_Name : 'No Login Account'
                    };
                } catch (err) {
                    console.error(`Error fetching user for creditlist_id ${credit.creditlist_id}:`, err);
                    return {
                        id: credit.creditlist_id,
                        name: credit.Company_Name,
                        type: credit.type,
                        address: credit.address,
                        phoneno: credit.phoneno,
                        gst: credit.gst,
                        short_name: credit.short_name,
                        balance: credit.Opening_Balance,
                        username: 'Error Loading'
                    };
                }
            })
        );
        
        return creditsWithUsernames;
    } catch (error) {
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