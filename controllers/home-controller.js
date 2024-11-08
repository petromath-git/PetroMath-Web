const PersonDao = require("../dao/person-dao");
const ProductDao = require("../dao/product-dao");
const PumpDao = require("../dao/pump-dao");
const TxnReadDao = require("../dao/txn-read-dao");
const CreditDao = require("../dao/credits-dao");
const utils = require("../utils/app-utils");
const dbMapping = require("../db/ui-db-field-mapping");
const txnController = require("./txn-common-controller");
const ExpenseDao = require("../dao/expense-dao");
const config = require("../config/app-config");
const dateFormat = require('dateformat');
const saveController = require("./closing-save-controller");
const deleteController = require("./closing-delete-controller");
const security = require("../utils/app-security");

module.exports = {

    // Getting home data
    getHomeDataFn: (req, res, next) => {
        getHomeData(req, res, next);
    },

    getNewData: (req, res, next) => {
        const locationCode = req.user.location_code;
        getDraftsCount(locationCode).then(data => {
            if(data < config.APP_CONFIGS.maxAllowedDrafts) {
                Promise.allSettled([personDataPromise(locationCode),
                    productDataPromise(locationCode),
                    txnController.pumpDataPromise(locationCode),
                    txnController.creditCompanyDataPromise(locationCode),
                    txnController.suspenseDataPromise(locationCode),
                    expenseDataPromise(locationCode),
                    personAttendanceDataPromise(locationCode)])
                    .then((values) => {
                        res.render('new-closing', {
                            user: req.user,
                            config: config.APP_CONFIGS,
                            cashiers: values[0].value.cashiers,
                            minDateForNewClosing: utils.restrictToPastDate(config.APP_CONFIGS.maxDaysAllowedToGoBackForNewClosing),
                            currentDate: utils.currentDate(), productValues: values[1].value.products,
                            product2TValues: values[1].value.products2T,
                            testingValues: values[1].value.products,
                            productIdAliasMapping: JSON.stringify(values[1].value.productIdAliasMapping),
                            pumps: values[2].value,
                            creditCompanyValues: values[3].value,
                            suspenseValues: values[4].value,
                            expenseValues: values[5].value.expenses,
                            usersList: values[6].value.allUsers
                        });
                    }).catch((err) => {
                    console.warn("Error while getting data using promises " + err.toString());
                    Promise.reject(err);
                });
            } else {
                getHomeData(req, res, next);
            }
        })

    },

    saveClosingData: (req, res, next) => {
        const closingData = req.body;
        saveController.txnWriteClosingPromise(closingData)
            .then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved closing data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
    },

    saveAttendanceData: (req, res, next) => {
        const attendanceData = req.body;
        if (attendanceData && attendanceData[0] && attendanceData[0].closing_id) {
            //console.log(attendanceData);
            saveController.txnWriteAttendancePromise(attendanceData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved Attendance data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },


    saveReadingData: (req, res, next) => {
        const readingData = req.body;
        if (readingData && readingData[0] && readingData[0].closing_id) {
            saveController.txnWriteReadingPromise(readingData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved reading data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    save2TSalesData: (req, res, next) => {
        const saleData = req.body;
        if(saleData && saleData[0] && saleData[0].closing_id) {
            saveController.txnWrite2TSalesPromise(saleData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved 2T oil data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    saveCashSalesData: (req, res, next) => {
        const salesData = req.body;
        if (salesData) {
            saveController.txnWriteCashSalesPromise(salesData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved cash sales data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    saveCreditSalesData: (req, res, next) => {
        const salesData = req.body;
        if (salesData) {
            saveController.txnWriteCreditSalesPromise(salesData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved credit sales data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    saveExpensesData: (req, res, next) => {
        const expensesData = req.body;
        if (expensesData) {
            saveController.txnWriteExpensesPromise(expensesData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved expenses data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    getExcessShortage: (req, res, next) => {
        const closingId = req.query.id;
        if (closingId) {
            saveController.getExcessShortage(closingId).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved expenses data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    saveDenomsData: (req, res, next) => {
        const denomsData = req.body;
        if (denomsData) {
            saveController.txnWriteDenomsPromise(denomsData).then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved denoms data successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        }
    },

    deleteTxnReading: ((req, res, next) => {
        const readingId = req.query.id;
        if (readingId) {
            deleteController.txnDeleteReadingPromise(readingId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    }),

    deleteTxnCashSale: ((req, res, next) => {
        const saleId = req.query.id;
        if (saleId) {
            deleteController.txnDeleteCashSalePromise(saleId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    }),

    deleteTxnCreditSale: ((req, res, next) => {
        const saleId = req.query.id;
        if (saleId) {
            deleteController.txnDeleteCreditSalePromise(saleId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    }),

    deleteTxnExpense: ((req, res, next) => {
        const expenseId = req.query.id;
        if (expenseId) {
            deleteController.txnDeleteExpensePromise(expenseId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    }),

    deleteAttendanceData: ((req, res, next) => {
        const attendanceId = req.query.id;
        if (attendanceId) {
            deleteController.txnDeleteAttendancePromise(attendanceId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    }),

    productDataPromise: (locationCode, productNames) => {
        return productDataPromise(locationCode, productNames);
    },

    personDataPromise: (locationCode) => {
        return personDataPromise(locationCode);
    },

    formProductAliasMap: (product, productAlias) => {
        return formProductAliasMap(product, productAlias);
    },

    expenseDataPromise: (locationCode) => {
        return expenseDataPromise(locationCode)
    },

    personAttendanceDataPromise: (locationCode) => {
        return personAttendanceDataPromise(locationCode);
    }
};

const getHomeData = (req, res, next) => {
    const locationCode = req.user.location_code;
    let closingQueryFromDate = req.query.fromClosingDate;
    let closingQueryToDate = req.query.toClosingDate;
    if(closingQueryFromDate === undefined) closingQueryFromDate = dateFormat(new Date(), "yyyy-mm-dd");
    if(closingQueryToDate === undefined) closingQueryToDate = dateFormat(new Date(), "yyyy-mm-dd");
    if(req.user.isAdmin) {
        Promise.allSettled([getClosingDataByDate(locationCode, closingQueryFromDate, closingQueryToDate),
            getDraftsCount(locationCode),
            getDraftsCountBeforeDays(locationCode, config.APP_CONFIGS.maxAllowedDraftsDays),
            getDeadlineWarningMessage(locationCode)])
            .then(values => {
                res.render('home', {
                    title: 'Shift Closing',
                    user: req.user,
                    config: config.APP_CONFIGS,
                    closingValues: values[0].value,
                    currentDate: utils.currentDate(),
                    fromClosingDate: closingQueryFromDate,
                    toClosingDate: closingQueryToDate,
                    draftsCnt: values[1].value,
                    draftDaysCnt: values[2].value,
                    deadlineMessage: values[3].value
                });
                
            });
    } else {
        // TODO: fix after person id is added to view
        getUsersClosingDataByDate(req.user.Person_Name, locationCode, closingQueryFromDate, closingQueryToDate)
            .then(data => {
            res.render('home', {
                user: req.user,
                config: config.APP_CONFIGS,
                closingValues: data,
                currentDate: utils.currentDate(),
                fromClosingDate: closingQueryFromDate,
                toClosingDate: closingQueryToDate,
            });
        });
    }
};

// Home page: Get closings order by closing  id
const getUsersClosingDataByDate = (personName, locationCode, closingQueryFromDate,closingQueryToDate) => {
    return new Promise((resolve, reject) => {
        let closings = [];
        TxnReadDao.getPersonsClosingDetailsByDate(personName, locationCode, closingQueryFromDate, closingQueryToDate)
            .then(data => {
                data.forEach((closingData) => {
                    closings.push({closingId: closingData.closing_id,
                        cashierName: closingData.person_name,
                        closingDate: closingData.closing_date_formatted,
                        msData: closingData.MS,
                        hsdData: closingData.HSD,
                        xmsData: closingData.XMS,
                        l2tData: closingData.l_2t,
                        p2tData: closingData.p_2t,
                        expenseData: closingData.ex_short,
                        period: closingData.period,
                        closingStatus: closingData.closing_status
                    });
                });
                resolve(closings);
            });
    });
}

// Home page: Get closings order by closing  id
const getClosingDataByDate = (locationCode, closingQueryFromDate,closingQueryToDate) => {
    return new Promise((resolve, reject) => {
        let closings = [];
        TxnReadDao.getClosingDetailsByDate(locationCode, closingQueryFromDate,closingQueryToDate)
            .then(data => {
                data.forEach((closingData) => {
                    closings.push({closingId: closingData.closing_id,
                        cashierName: closingData.person_name,
                        closingDate: closingData.closing_date_formatted,
                        msData: closingData.MS,
                        hsdData: closingData.HSD,
                        xmsData: closingData.XMS,
                        l2tData: closingData.l_2t,
                        p2tData: closingData.p_2t,
                        expenseData: closingData.ex_short,
                        period: closingData.period,
                        closingStatus: closingData.closing_status
                    });
                });
                resolve(closings);
            });
    });
}

const getDraftsCount = (locationCode) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDraftClosingsCount(locationCode)
            .then(data => {
                resolve(data);
            });
    });
}

const getDraftsCountBeforeDays = (locationCode, noOfDays) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDraftClosingsCountBeforeDays(locationCode, noOfDays)
            .then(data => {
                resolve(data);
            });
    });
}

const getDeadlineWarningMessage = (locationCode) => {
    return new Promise((resolve, reject) => {
        let deadlineMessage =[];
        TxnReadDao.getDeadlineWarningMessage(locationCode)
            .then(data => {
                data.forEach((deadlineData) => {
                    deadlineMessage.push({deadlineDate: deadlineData.dataValues.deadline_date,
                        message: deadlineData.message
                    });
                });
                resolve(deadlineMessage);
            });
    });
}

// Add new flow: Get person data
const personDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let cashiers = [];
        PersonDao.findUsers(locationCode)
            .then(data => {
                data.forEach((person) => {
                    cashiers.push({personName: person.Person_Name, personId: person.Person_id});
                });
                resolve({cashiers: cashiers});
            });
    });
}

// Add new flow: Get product data
const productDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let products = [], productIdAliasMapping = [], products2T = [];
        const productMap = config.PRODUCT_DETAILS_MAPPING;
        ProductDao.findProducts(locationCode)
            .then(data => {
                data.forEach((product) => {
                    const mapData = productMap.get(product.product_name);
                    const productAlias = mapData ?  mapData.label ? mapData.label : product.product_name : product.product_name;
                    const textName = mapData ? mapData.tag ? mapData.tag : product.product_name : product.product_name;
                    products.push(formProductData(product, productAlias, textName));
                    productIdAliasMapping.push(formProductAliasMap(product, productAlias));
                    if(product.product_name === config.POUCH_DESC ||
                        product.product_name === config.LOOSE_DESC) {
                        products2T.push(formProductData(product, textName, textName));
                    }
                });
                resolve({products: products, productIdAliasMapping: productIdAliasMapping,
                products2T: products2T});
            });
    });
}

function formProductData(product, productAlias, textName) {
    return {
        productId: product.product_id,
        productAlias: productAlias,
        textName: textName,
        productPrice: product.price,
        productName: product.product_name,
        returnedQty: 0,
        givenQty: 0
    };
}

function formProductAliasMap(product, productAlias) {
    return {
        productAlias: productAlias,
        productId: product.product_id
    };
}

// Add new flow: Get expense data
const expenseDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let expenses = [];
        ExpenseDao.findExpenses(locationCode)
            .then(data => {
                if (data) {
                    data.forEach((expense) => {
                        expenses.push({
                            expenseId: expense.Expense_id,
                            expenseName: expense.Expense_name,
                            amount: 0,
                            defaultAmt: expense.Expense_default_amt
                        });
                    });
                }
                resolve({expenses: expenses});
            });
    });
}
const personAttendanceDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let allUsers = [];
        PersonDao.findUsers(locationCode)
            .then(data => {
                data.forEach((person) => {
                    allUsers.push({personName: person.Person_Name, personId: person.Person_id});
                });
                resolve({allUsers: allUsers});
            });
    });
}