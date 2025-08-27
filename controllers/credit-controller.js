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
    findCreditCustomersOnly: (locationCode) => {
        return new Promise((resolve, reject) => {
            let credits = [];
    
            // Fetch all credits for the given locationCode
            CreditDao.findAll(locationCode)
                .then(data => {
                    // Use map to create promises for fetching related user details for each credit
                    let promises = data.map((credit) => {
                        return PersonDao.findPersonByCreditlistId(credit.creditlist_id)  // Use PersonDao method
                            .then(person => {
                                // Only process non-digital customers (card_flag !== 'Y')
                                if (person && credit.card_flag !== 'Y') {
                                    credits.push({
                                        id: credit.creditlist_id,
                                        name: credit.Company_Name,
                                        type: credit.type,
                                        address: credit.address,
                                        phoneno: credit.phoneno,
                                        gst: credit.gst,
                                        short_name: credit.short_name,
                                        balance: credit.Opening_Balance,
                                        username: person.User_Name || 'Not Available'
                                    });
                                } else if (!person) {
                                    // If no matching person is found, log and provide fallback values
                                    console.log(`No person found for creditlist_id: ${credit.creditlist_id}`);
                                    credits.push({
                                        id: credit.creditlist_id,
                                        name: credit.Company_Name,
                                        type: credit.type,
                                        address: credit.address,
                                        phoneno: credit.phoneno,
                                        gst: credit.gst,
                                        short_name: credit.short_name,
                                        balance: credit.Opening_Balance,
                                        username: 'Not Available'
                                    });
                                }
                            })
                            .catch(err => {
                                // Handle errors when fetching person details
                                console.error('Error fetching user data:', err);
                                credits.push({
                                    id: credit.creditlist_id,
                                    name: credit.Company_Name,
                                    type: credit.type,
                                    address: credit.address,
                                    phoneno: credit.phoneno,
                                    gst: credit.gst,
                                    short_name: credit.short_name,
                                    balance: credit.Opening_Balance,
                                    username: 'N/A'
                                });
                            });
                    });
    
                    // Wait for all promises to resolve
                    Promise.all(promises)
                        .then(() => {
                            resolve(credits);  // Return the list of credits with user details
                        })
                        .catch(err => {
                            reject(err);  // Reject if any error occurs
                        });
                })
                .catch(err => {
                    reject(err);  // Reject if there is an error with CreditDao
                });
        });
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