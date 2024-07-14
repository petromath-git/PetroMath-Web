
const AppError = require("../exception/AppException");
const msg = require("../config/app-messages");
var BreakException = {};

module.exports = {

    // Get previous days's midnight date for getting home page records
    getPreviousDay : () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0);
        return yesterday;
    },

    // Get current date for 'Add New' page
    currentDate : () => {
        let date = new Date(Date.now());
        return formDateFormat(date);
    },

    // Get date from
    restrictToPastDate : (noOfDays) => {
        let date = new Date(Date.now());
        date.setDate(date.getDate() - noOfDays);
        return formDateFormat(date);
    },

    noOfDaysDifference : (startDate, endDate) => {
        let start = new Date(startDate);
        let end = new Date(endDate);
        if(start.getTime() > end.getTime()) {
            throw new AppError(msg.ERR_START_DATE_GREATER_THAN_END_DATE);
        }
        return (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
    },

    // Get person's name by getting id and all of persons' data
    getPersonName : (id, personData) => {
        let name = null;
        try {
            personData.forEach((person) => {
                if(person.Person_id === id) {
                    name = person.Person_Name;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return name;
    },

    // Get product's name by getting id and (id, name) of product's data
    getProductName : (id, productData) => {
        let alias = null;
        try {
            productData.forEach((product) => {
                if(product.product_id === id) {
                    alias = product.product_name;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return alias;
    },

    // Get product using product_code and (product_code, <m_product>) of product's data
    getProduct : (productCode, productData) => {
        let data = null;
        try {
            productData.forEach((product) => {
                if(product.product_code === productCode) {
                    data = product;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return data;
    },

    // Get pump's code by getting id and (id, code) of pump's data
    getPumpCode : (id, pumpData) => {
        let code = null;
        try {
            pumpData.forEach((pump) => {
                if(pump.pump_id === id) {
                    code = pump.pump_code;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return code;
    },

    // Get credit's type using id and (id, companyName, creditType) of CreditList's data
    getCreditType : (id, creditLists) => {
        let code = null;
        try {
            creditLists.forEach((creditList) => {
                if(creditList.creditlist_id === id) {
                    code = creditList.type;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return code;
    },

    // Get company's name using id and (id, companyName, creditType) of CreditList's data
    getCompanyName : (id, creditLists) => {
        let code = null;
        try {
            creditLists.forEach((creditList) => {
                if(creditList.creditlist_id === id) {
                    code = creditList.Company_Name;
                    throw BreakException;
                }
            });
        } catch (e) {
            if (e !== BreakException) throw e;
        }
        return code;
    },

    getLastThreeMonths : (date) => {
        const d = new Date(date);
        return (d.getMonth() - 3);
    
    }
};

const formDateFormat = (date) => {
    let dateValue = date.getDate();
    let monthValue = date.getMonth() + 1;
    if (dateValue < 10) {
        dateValue = "0" + dateValue;
    }
    if (monthValue < 10) {
        monthValue = "0" + monthValue;
    }
    return date.getFullYear() + "-" + monthValue + "-" + dateValue;
};

