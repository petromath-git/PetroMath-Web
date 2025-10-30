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
const locationConfig = require('../utils/location-config');
const dateFormat = require('dateformat');
const saveController = require("./closing-save-controller");
const deleteController = require("./closing-delete-controller");
const security = require("../utils/app-security");
const CreditVehicleDao = require("../dao/credit-vehicles-dao");
const db = require("../db/db-connection");
const rolePermissionsDao = require("../dao/role-permissions-dao");

module.exports = {

    // Getting home data
    getHomeDataFn: (req, res, next) => {
        getHomeData(req, res, next);
    },

    getNewData: async (req, res, next) => {
        const locationCode = req.user.location_code;


        const maxBackDateDays = Number( await locationConfig.getLocationConfigValue(
            locationCode, 
            'MAX_DAYS_ALLOWED_BACK_DATE_CLOSING', 
            config.APP_CONFIGS.maxDaysAllowedToGoBackForNewClosing
        ));

        const openingReadonlyConfig = await locationConfig.getLocationConfigValue(
        locationCode,
        'PUMP_OPENING_READING_READONLY',
        'N' // default value if not configured
     );

       const allowSecondaryPump = await locationConfig.getLocationConfigValue(
        locationCode,
        'ALLOW_SECONDARY_PUMP',
        'true' // default value
    );

      

        getDraftsCount(locationCode).then(data => {
            if(data < config.APP_CONFIGS.maxAllowedDrafts) {
                Promise.allSettled([personDataPromise(locationCode),
                    productDataPromise(locationCode),
                    pumpProductDataPromise(locationCode),
                    txnController.pumpDataPromise(locationCode),
                    txnController.creditCompanyDataPromise(locationCode),
                    txnController.suspenseDataPromise(locationCode),
                    expenseDataPromise(locationCode),
                    personAttendanceDataPromise(locationCode),
                    vehicleDataPromise(locationCode),
                //    digitalCompanyDataPromise(locationCode)
                ])
                    .then((values) => {
                        res.render('new-closing', {
                            user: req.user,
                            config: config.APP_CONFIGS,
                            cashiers: values[0].value.cashiers,
                            minDateForNewClosing: utils.restrictToPastDate(maxBackDateDays),
                            currentDate: utils.currentDate(),
                            productValues: values[1].value.products,                            
                            product2TValues: values[1].value.products2T,
                            testingValues: values[1].value.products,
                            productIdAliasMapping: JSON.stringify(values[1].value.productIdAliasMapping),
                            pumpProductValues: values[2].value.products,
                            pumps: values[3].value,
                            creditCompanyValues: values[4].value,
                            suspenseValues: values[5].value,
                            expenseValues: values[6].value.expenses,
                            usersList: values[7].value.allUsers,
                            vehicleData: values[8].value,
                            isOpeningReadonly: openingReadonlyConfig === 'Y',
                            allowSecondaryPump: allowSecondaryPump === 'true',
                  //          digitalCompanyValues: values[8].value,
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

    saveDigitalSalesData: (req, res, next) => {
    const salesData = req.body;
    if (salesData) {
        saveController.txnWriteDigitalSalesPromise(salesData).then((result) => {
            if (!result.error) {
                res.status(200).send({message: 'Saved digital sales data successfully.', rowsData: result});
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

deleteTxnDigitalSale: ((req, res, next) => {
    const saleId = req.query.id;
    if (saleId) {
        deleteController.txnDeleteDigitalSalePromise(saleId).then((result) => {
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

    pumpProductDataPromise: (locationCode) => {
        return pumpProductDataPromise(locationCode);
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
    let closingQueryFromDate = dateFormat(new Date(), "yyyy-mm-dd");
    let closingQueryToDate = dateFormat(new Date(), "yyyy-mm-dd");
    const locationCode = req.user.location_code;

    if(req.query.fromClosingDate) {
        closingQueryFromDate = req.query.fromClosingDate;
    }
    if(req.query.toClosingDate) {
        closingQueryToDate = req.query.toClosingDate;
    }

    if(req.user.isAdmin) {
        Promise.allSettled([
            getClosingData(locationCode, closingQueryFromDate, closingQueryToDate),
            getDraftsCount(locationCode),
            getDraftsCountBeforeDays(locationCode, config.APP_CONFIGS.maxAllowedDraftsDays),
            getDeadlineWarningMessage(locationCode),
            getLocationProductColumns(locationCode),
            rolePermissionsDao.hasPermission(req.user.Role, locationCode, 'SEARCH_CLOSINGS')
        ]).then(values => {
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
                deadlineMessage: values[3].value,
                productColumns: values[4].value,
                canSearchClosings: values[5].value
            });
        }).catch(error => {
            console.error('Error in getHomeData:', error);
            next(error);
        });
    } else {
        Promise.allSettled([
            getUsersClosingDataByDate(req.user.Person_Name, locationCode, closingQueryFromDate, closingQueryToDate,rolePermissionsDao.hasPermission(req.user.Role, locationCode, 'SEARCH_CLOSINGS')),
            getLocationProductColumns(locationCode)
        ]).then(values => {
            res.render('home', {
                title: 'Shift Closing',
                user: req.user,
                config: config.APP_CONFIGS,
                closingValues: values[0].value,
                currentDate: utils.currentDate(),
                fromClosingDate: closingQueryFromDate,
                toClosingDate: closingQueryToDate,
                productColumns: values[1].value,
                canSearchClosings: values[2].value
            });
        }).catch(error => {
            console.error('Error in getHomeData for non-admin:', error);
            next(error);
        });
    }
};

// Home page: Get closings order by closing  id
const getUsersClosingDataByDate = (personName, locationCode, closingQueryFromDate, closingQueryToDate) => {
    return new Promise((resolve, reject) => {
        let closings = [];
        TxnReadDao.getPersonsClosingDetailsByDate(personName, locationCode, closingQueryFromDate, closingQueryToDate)
            .then(data => {
                data.forEach((closingData) => {
                    const dynamicClosingData = {
                        closingId: closingData.closing_id,
                        cashierName: closingData.person_name,
                        closingDate: closingData.closing_date_formatted,
                        period: closingData.period,
                        closingStatus: closingData.closing_status,
                        expenseData: closingData.ex_short || 0
                    };

                    // Handle dynamic product columns
                    Object.keys(closingData).forEach((key) => {
                        if (!['closing_id', 'person_name', 'closing_date_formatted', 
                              'closing_date', 'period', 'closing_status', 'ex_short', 
                              'notes', 'location_code', 'loose', 'p_2t'].includes(key)) {
                            dynamicClosingData[key] = closingData[key] || 0;
                        }
                    });

                    // Handle 2T products
                    if (closingData.loose !== undefined) {
                        dynamicClosingData['2T_LOOSE'] = closingData.loose || 0;
                    }
                    if (closingData.p_2t !== undefined) {
                        dynamicClosingData['2T_POUCH'] = closingData.p_2t || 0;
                    }

                    closings.push(dynamicClosingData);
                });
                resolve(closings);
            })
            .catch(reject);
    });
}

const getLocationProductColumns = (locationCode) => {
    return new Promise((resolve, reject) => {
        const productQuery = `
            SELECT DISTINCT product_code 
            FROM m_pump 
            WHERE location_code = :locationCode 
            AND product_code IS NOT NULL 
            AND effective_end_date > NOW()
            ORDER BY product_code
        `;
        
        db.sequelize.query(productQuery, {
            replacements: { locationCode: locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        }).then(pumpProducts => {
            let productColumns = [];
            
            // Add pump products
            pumpProducts.forEach(product => {
                productColumns.push({
                    key: product.product_code,
                    label: product.product_code,
                    type: 'pump'
                });
            });
            
            // UPDATED: Only check for 2T LOOSE
            const twoTQuery = `
                SELECT COUNT(*) as count 
                FROM m_product 
                WHERE location_code = :locationCode 
                AND product_name = '2T LOOSE'
            `;
            
            db.sequelize.query(twoTQuery, {
                replacements: { locationCode: locationCode },
                type: db.Sequelize.QueryTypes.SELECT
            }).then(twoTResult => {
                // UPDATED: Only add 2T Loose if it exists
                if (twoTResult[0].count > 0) {
                    productColumns.push({
                        key: '2T_LOOSE',
                        label: '2T Loose',
                        type: '2t'
                    });
                }
                
                resolve(productColumns);
            }).catch(() => resolve(productColumns));
        }).catch(() => resolve([]));
    });
};

// Home page: Get closings order by closing  id
const getClosingDataByDate = (locationCode, closingQueryFromDate, closingQueryToDate) => {
    return new Promise((resolve, reject) => {
        let closings = [];
        TxnReadDao.getClosingDetailsByDate(locationCode, closingQueryFromDate, closingQueryToDate)
            .then(data => {
                data.forEach((closingData) => {
                    const dynamicClosingData = {
                        closingId: closingData.closing_id,
                        cashierName: closingData.person_name,
                        closingDate: closingData.closing_date_formatted,
                        period: closingData.period,
                        closingStatus: closingData.closing_status,
                        expenseData: closingData.ex_short || 0
                    };

                    // Handle dynamic product columns
                    Object.keys(closingData).forEach((key) => {
                        if (!['closing_id', 'person_name', 'closing_date_formatted', 
                              'closing_date', 'period', 'closing_status', 'ex_short', 
                              'notes', 'location_code', 'loose', 'p_2t'].includes(key)) {
                            dynamicClosingData[key] = closingData[key] || 0;
                        }
                    });

                    // Handle 2T products
                    if (closingData.loose !== undefined) {
                        dynamicClosingData['2T_LOOSE'] = closingData.loose || 0;
                    }
                    if (closingData.p_2t !== undefined) {
                        dynamicClosingData['2T_POUCH'] = closingData.p_2t || 0;
                    }

                    closings.push(dynamicClosingData);
                });
                resolve(closings);
            })
            .catch(reject);
    });
}




const getDraftsCount = (locationCode) => {
    return new Promise((resolve, reject) => {
        return TxnReadDao.getDraftClosingsCount(locationCode)
            .then(data => {
                resolve(data);
            });
    });
}

const getDraftsCountBeforeDays = (locationCode, noOfDays) => {
    return new Promise((resolve, reject) => {
        return TxnReadDao.getDraftClosingsCountBeforeDays(locationCode, noOfDays)
            .then(data => {
                resolve(data);
            });
    });
}

const getDeadlineWarningMessage = (locationCode) => {
    return new Promise((resolve, reject) => {
        let deadlineMessage =[];
        return TxnReadDao.getDeadlineWarningMessage(locationCode)
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
        return PersonDao.findUsers(locationCode)
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
        return ProductDao.findProducts(locationCode)
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


// Get pump-specific product data only
const pumpProductDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        // First get pump product codes for this location in correct order
        db.sequelize.query(
            `SELECT product_code, MIN(display_order) as min_order 
                FROM m_pump 
                WHERE location_code = :locationCode 
                GROUP BY product_code 
                ORDER BY min_order`,
            {
                replacements: { locationCode },
                type: db.sequelize.QueryTypes.SELECT,
            }
        ).then(pumpProductCodes => {
            // Get products and maintain the pump order
            ProductDao.findProducts(locationCode)
                .then(data => {
                    let products = [], productIdAliasMapping = [];
                    const productMap = config.PRODUCT_DETAILS_MAPPING;
                    
                    // Process products in pump order, not product table order
                    pumpProductCodes.forEach((pumpProduct) => {
                        const product = data.find(p => p.product_name === pumpProduct.product_code);
                        if (product) {
                            const mapData = productMap.get(product.product_name);
                            const productAlias = mapData ? mapData.label ? mapData.label : product.product_name : product.product_name;
                            const textName = mapData ? mapData.tag ? mapData.tag : product.product_name : product.product_name;
                            products.push(formProductData(product, productAlias, textName));
                            productIdAliasMapping.push(formProductAliasMap(product, productAlias));
                        }
                    });
                    
                    resolve({products: products, productIdAliasMapping: productIdAliasMapping});
                }).catch(reject);
        }).catch(reject);
    });
}

function formProductData(product, productAlias, textName) {
    return {
        productId: product.product_id,
        productAlias: productAlias,
        textName: textName,
        productPrice: product.price,
        productName: product.product_name,
        rgbColor: product.rgb_color,
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

const vehicleDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        CreditVehicleDao.findAllVehiclesForLocation(locationCode)
            .then(data => {
                // Group vehicles by creditlist_id for easier access
                const vehiclesByCredit = {};
                data.forEach(vehicle => {
                    if (!vehiclesByCredit[vehicle.creditlist_id]) {
                        vehiclesByCredit[vehicle.creditlist_id] = [];
                    }
                    vehiclesByCredit[vehicle.creditlist_id].push({
                        vehicleId: vehicle.vehicle_id,
                        vehicleNumber: vehicle.vehicle_number,
                        vehicleType: vehicle.vehicle_type,
                        companyName: vehicle.company_name
                    });
                });
                resolve(vehiclesByCredit);
            })
            .catch(err => {
                console.error("Error loading vehicles:", err);
                resolve({});
            });
    });
};


const digitalCompanyDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let companies = [];
        CreditDao.findDigitalCredits(locationCode)  // Need to create this DAO method
            .then(data => {
                data.forEach((credit) => {
                    companies.push({
                        creditorId: credit.creditlist_id, 
                        creditorName: credit.Company_Name, 
                        card_flag: credit.card_flag
                    });
                });
                resolve(companies);
            })
            .catch(err => {
                console.error("Error loading digital companies:", err);
                resolve([]);
            });
    });
};


const getClosingData = (locationCode, closingQueryFromDate, closingQueryToDate) => {
    return new Promise((resolve, reject) => {
        let closings = [];
        return TxnReadDao.getClosingDetailsByDate(locationCode, closingQueryFromDate, closingQueryToDate)
            .then(data => {
                data.forEach((closingData) => {
                    const dynamicClosingData = {
                        closingId: closingData.closing_id,
                        cashierName: closingData.person_name,
                        closingDate: closingData.closing_date_formatted,
                        period: closingData.period,
                        closingStatus: closingData.closing_status,
                        expenseData: parseFloat(closingData.ex_short) || 0
                    };

                    // Add dynamic product columns
                    Object.keys(closingData).forEach((key) => {
                        // UPDATED: Remove p_2t from the exclusion list since we don't want it
                        if (!['closing_id', 'person_name', 'closing_date_formatted', 
                              'closing_date', 'period', 'closing_status', 'ex_short', 
                              'notes', 'location_code', 'loose'].includes(key)) {
                            dynamicClosingData[key] = parseFloat(closingData[key]) || 0;
                        }
                    });

                    // UPDATED: Only handle 2T Loose, remove 2T Pouch
                    if (closingData.loose !== undefined) {
                        dynamicClosingData['2T_LOOSE'] = parseFloat(closingData.loose) || 0;
                    }

                    closings.push(dynamicClosingData);
                });
                
                resolve(closings);
            })
            .catch(reject);
    });
};



// Add API endpoint for dynamic vehicle loading
module.exports.getVehiclesByCreditId = (req, res, next) => {
    const creditListId = req.params.creditListId;
    CreditVehicleDao.findAll(creditListId)
        .then(data => {
            const vehicles = data.map(v => ({
                vehicleId: v.vehicle_id,
                vehicleNumber: v.vehicle_number,
                vehicleType: v.vehicle_type
            }));
            res.json({ success: true, vehicles });
        })
        .catch(err => {
            res.status(500).json({ success: false, error: err.toString() });
        });
};