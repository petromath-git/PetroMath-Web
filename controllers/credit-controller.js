const CreditDao = require("../dao/credits-dao");
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



}
