const createError = require('http-errors');
const express = require('express');
const path = require('path');
const logger = require('morgan');
const login = require('connect-ensure-login');
const security = require("./utils/app-security");
const UserData = require("./value/UserData");
const msg = require("./config/app-messages");
const config = require("./config/app-config");
require('dotenv').config();
const dateFormat = require("dateformat");

// Passport - configuration - start....
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
passport.use(new LocalStrategy(
    function (username, password, done) {
        Person.findOne({ where: { 'User_name': username } })
            .then(data => {
                if (data && password === (data.Password)) {
                    let now = new Date();
                    const today_date = dateFormat(now, "yyyy-mm-dd");
                    if (data.effective_end_date > today_date) {
                        var userInfo = new UserData(data, security.isAdminChk(data));
                        done(null, userInfo);
                    } else {
                        done(null, false, { message: `${data.User_Name} Your User Account is Disabled` });
                    }
                } else {
                    done(null, false, { message: 'User name or password is incorrect' });
                }
            })
            .catch(err => {
                console.warn("err in app :::: " + err + err.toString());
                done(null, false, { message: err.toString() });
            });
    }));

passport.serializeUser((userData, done) => {
    done(null, userData);
});

passport.deserializeUser(function (userInfo, done) {
    Person.findOne({where: {'User_Name': userInfo.User_Name}})
        .then(function (user) {
            done(null, userInfo);
        })
        .catch(function (err) {
            done(err);
        });
});
// Passport - configuration - end

// App cache - start
const appCache = require('./utils/app-cache')
appCache.initializeCache();
// App cache - end

// ORM DB - start
const db = require("./db/db-connection");
const dbMapping = require("./db/ui-db-field-mapping")
const Person = db.person;
const ProductDao = require("./dao/product-dao");
const PersonDao = require("./dao/person-dao");
var CreditDao = require("./dao/credits-dao");
db.sequelize.sync();
// ORM DB - end

// Router business
const HomeController = require("./controllers/home-controller");
const ClosingEditController = require("./controllers/closing-edit-controller");
const ClosingDeleteController = require("./controllers/closing-delete-controller");
const receiptController = require("./controllers/credit-receipt-controller");
const tankReceiptController = require("./controllers/tank-receipt-controller");
const masterController = require("./controllers/master-data-controller");
const cashflowController = require("./controllers/cash-flow-controller");
const utilitiesController = require("./controllers/utilities-controller");
const reportsController = require("./controllers/reports-controller");
const decantEditController = require("./controllers/decant-edit-controller");
const truckLoadController = require("./controllers/truck-load-controller");
const bankAccountController = require("./controllers/bankaccount-mgmt-controller");
const dashBoardController = require("./controllers/dashboard-controller");
const deadlineController = require("./controllers/deadline-master-controller");
const creditController = require("./controllers/credit-controller");

const flash = require('express-flash');
const bodyParser = require('body-parser');

// app configurations - start
const deploymentConfig = "./config/app-deployment-" + process.env.ENVIRONMENT;
const serverConfig = require(deploymentConfig);
const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(flash());
app.use(express.static('public'));
app.use(require('cookie-parser')('keyboard cat'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(require('express-session')({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const isLoginEnsured = login.ensureLoggedIn({});
//const isLoginEnsured = login.ensureNotLoggedIn({});     // enable for quick development only

// Routes - start
app.get('/', isLoginEnsured, function (req, res) {
    res.redirect('/home');
});

app.post('/creditreceipts', [isLoginEnsured, security.isAdmin()], function (req, res) {
    receiptController.saveReceipts(req, res);   // response returned inside controller
});

app.get('/creditreceipts', [isLoginEnsured, security.isAdmin()], function (req, res) {
    receiptController.getReceipts(req, res);    // response returned inside controller
});

app.put('/receipt/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    receiptController.updateReceipts(req, res);
});

app.delete('/delete-receipt', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    receiptController.deleteReceipts(req, res, next);
});

app.get('/products', [isLoginEnsured, security.isAdmin()], function (req, res) {
    let locationCode = req.user.location_code;
    let products = [];
    ProductDao.findProducts(locationCode)
        .then(data => {
            data.forEach((product) => {
                products.push({
                    id: product.product_id,
                    name: product.product_name,
                    unit: product.unit,
                    qty: product.qty,
                    price: product.price,
                    ledger_name: product.ledger_name,
                    cgst_percent: product.cgst_percent,
                    sgst_percent: product.sgst_percent
                });
            });
            res.render('products', { title: 'Products', user: req.user, products: products, config: config.APP_CONFIGS, });
        });
});

// TODO: fix for multiple products
app.post('/products', [isLoginEnsured, security.isAdmin()], function (req, res) {
    ProductDao.create(dbMapping.newProduct(req));
    res.redirect('/products');
});


app.put('/product/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    ProductDao.update({
        product_id: req.params.id,
        price: req.body.m_product_price,
        unit: req.body.m_product_unit,
        ledger_name: req.body.m_product_ledger_name,
        cgst_percent: req.body.m_product_cgst,
        sgst_percent: req.body.m_product_sgst
    }).then(data => {
        if (data == 1 || data == 0) {
            res.status(200).send({ message: 'Saved product data successfully.' });
        } else {
            res.status(500).send({ error: 'Error while saving data.' });
        }
    });
});

app.put('/disable-user/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    let loginUserId = req.user.Person_id;
    const userId = req.params.id;
    if (userId == loginUserId) {
        res.status(400).send({ error: 'Cannot disable ' + req.user.Person_Name + ' as you are logged in as' + req.user.Person_Name });
    } else {
        PersonDao.disableUser(userId).then(data => {
            if (data == 1) {
                res.status(200).send({ message: 'User disabled successfully.' });
            } else {
                res.status(500).send({ error: 'Error disabling user.' });
            }
        })
    }
});

app.get('/enable_user', [isLoginEnsured, security.isAdmin()], function (req, res) {
    masterController.findDisableUsers(req.user.location_code)
        .then(data => {
            res.render('enable_user', {
                title: 'Disabled Users',
                user: req.user,
                users: data
            });
        })
        .catch(err => {
            console.error("Error fetching users:", err);
            res.status(500).send("An error occurred.");
        });
});

app.get('/enable_credit', [isLoginEnsured, security.isAdmin()], function (req, res) {
    creditController.findDisableCredits(req.user.location_code)
        .then(data => {
            res.render('enable_credit', {
                title: 'Disabled Credits',
                user: req.user,
                users: data
            });
        })
        .catch(err => {
            console.error("Error fetching users:", err);
            res.status(500).send("An error occurred.");
        });
});

app.put('/enable-credit/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const creditID = req.params.id;
    CreditDao.enableCredit(creditID)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ success: true, message: 'Credit enabled successfully.' });
            } else {
                res.status(400).send({ success: false, error: 'Error enabling user.' });
            }
        })
});

app.put('/enable-user/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const userId = req.params.id;
    PersonDao.enableUser(userId)
        .then(data => {
            if (data == 1) {
                res.status(200).send({ success: true, message: 'User enabled successfully.' });
            } else {
                res.status(400).send({ success: false, error: 'Error enabling user.' });
            }
        })
});

// Disable Credit
app.put('/disable-credit/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const creditID = req.params.id;
    CreditDao.disableCredit(creditID).then(data => {
        if (data == 1) {
            res.status(200).send({ message: 'Credit disabled successfully.' });
        } else {
            res.status(500).send({ error: 'Error disabling user.' });
        }
    })
});

app.get('/users', [isLoginEnsured, security.isAdmin()], function (req, res) {
    masterController.findUsers(req.user.location_code).then(data => {
        res.render('users', { title: 'Users', user: req.user, users: data });
    });
});

app.post('/users', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const newUser = dbMapping.newUser(req);
    PersonDao.findUserByName(newUser.Person_Name, newUser.User_Name, newUser.location_code).then(
        (data) => {
            if (data && data.length > 0) {
                masterController.findUsers(newUser.location_code).then((data) => {
                    res.status(400).render('users', {
                        title: 'Users',
                        user: req.user,
                        users: data,
                        messages: { warning: msg.WARN_USER_DUPLICATE }
                    });
                });
            } else {
                PersonDao.create(dbMapping.newUser(req));
                res.redirect('/users');
            }
        }
    )
});

app.get('/credits', [isLoginEnsured, security.isAdmin()], function (req, res) {
    creditController.findCredits(req.user.location_code).then(data => {
        res.render('credits', { title: 'Credits', user: req.user, credits: data });
    });
});

app.post('/credits', [isLoginEnsured, security.isAdmin()], function (req, res) {
    CreditDao.create(dbMapping.newCredit(req));
    res.redirect('/credits');
});


app.get('/home', isLoginEnsured, function (req, res, next) {
    HomeController.getHomeDataFn(req, res, next); // response returned inside controller
});

app.get('/reports', isLoginEnsured, function (req, res, next) {
    let locationCode = req.user.location_code;
    let credits = [];
    CreditDao.findAll(locationCode)
        .then(data => {
            data.forEach((credit) => {
                credits.push({
                    id: credit.creditlist_id,
                    name: credit.Company_Name
                });
            });

            res.render('reports', { title: 'Reports', user: req.user, credits: credits });

        });
});

app.post('/reports', isLoginEnsured, function (req, res, next) {
    reportsController.getCreditReport(req, res, next);
});


app.get('/reports-creditsummary', isLoginEnsured, function (req, res, next) {
    //res.render('reports-creditsummary', { title: 'Credit Summary Reports', user: req.user });
    req.body.toClosingDate = new Date(Date.now());
    reportsController.getCreditSummaryReport(req, res, next);

});

app.post('/reports-creditsummary', isLoginEnsured, function (req, res, next) {
    reportsController.getCreditSummaryReport(req, res, next);
});



app.get('/new-closing', isLoginEnsured, function (req, res, next) {
    HomeController.getNewData(req, res, next);  // response returned inside controller
});

app.post('/new-closing', isLoginEnsured, function (req, res, next) {
    HomeController.saveClosingData(req, res, next);  // response returned inside controller
});

app.post('/new-attendance', isLoginEnsured, function (req, res, next) {
    HomeController.saveAttendanceData(req, res, next);  // response returned inside controller
});

app.delete('/remove-attendance', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    HomeController.deleteAttendanceData(req, res, next);  // response returned inside controller
});

app.post('/new-readings', isLoginEnsured, function (req, res, next) {
    HomeController.saveReadingData(req, res, next);  // response returned inside controller
});

app.delete('/remove-reading', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    HomeController.deleteTxnReading(req, res, next);  // response returned inside controller
});

app.post('/new-2t-sales', isLoginEnsured, function (req, res, next) {
    HomeController.save2TSalesData(req, res, next);  // response returned inside controller
});

app.post('/new-cash-sales', isLoginEnsured, function (req, res, next) {
    HomeController.saveCashSalesData(req, res, next);  // response returned inside controller
});

app.delete('/remove-cash-sale', isLoginEnsured, function (req, res, next) {
    HomeController.deleteTxnCashSale(req, res, next);  // response returned inside controller
});

app.post('/new-credit-sales', isLoginEnsured, function (req, res, next) {
    HomeController.saveCreditSalesData(req, res, next);  // response returned inside controller
});

app.delete('/remove-credit-sale', isLoginEnsured, function (req, res, next) {
    HomeController.deleteTxnCreditSale(req, res, next);  // response returned inside controller
});

app.post('/new-expenses', isLoginEnsured, function (req, res, next) {
    HomeController.saveExpensesData(req, res, next);
});

app.delete('/remove-expense', isLoginEnsured, function (req, res, next) {
    HomeController.deleteTxnExpense(req, res, next);  // response returned inside controller
});

app.post('/new-denoms', isLoginEnsured, function (req, res, next) {
    HomeController.saveDenomsData(req, res, next);  // response returned inside controller
});

app.get('/edit-draft-closing', isLoginEnsured, function (req, res, next) {
    ClosingEditController.getDataToEdit(req, res, next, false);  // response returned inside controller
});

app.post('/close-closing', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    ClosingEditController.closeData(req, res, next);  // response returned inside controller
});

app.delete('/delete-closing', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    ClosingDeleteController.deleteClosingRecord(req, res, next);  // response returned inside controller
});

app.get('/get-excess-shortage', isLoginEnsured, function (req, res, next) {
    HomeController.getExcessShortage(req, res, next);
});

app.get('/login', function (req, res) {
    res.render('login', { title: 'Login' });
});

app.post('/login', function (req, res, next) {
    passport.authenticate('local', {
        successRedirect: '/home',
        failureRedirect: '/login',
        failureFlash: true
    })(req, res, req.body.username, req.body.password, next);
});

app.get('/changepwd', isLoginEnsured, function (req, res) {
    res.render('change-pwd', { title: 'Change Password', user: req.user });
});

app.post('/changepwd', isLoginEnsured, function (req, res) {
    const promiseResponse = PersonDao.changePwd(dbMapping.changePwd(req), req.body.password);
    promiseResponse.then((result) => {
        if (result === true) {
            res.render('change-pwd', {
                title: 'Change Password',
                user: req.user,
                messages: { success: "Password changed successfully" }
            });
        } else {
            res.render('change-pwd', {
                title: 'Change Password',
                user: req.user,
                messages: { error: "Error while changing password." }
            });
        }
    });
});

app.get('/logout', function (req, res) {
    req.logout(function (err) {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});

app.get('/cashflow', isLoginEnsured, function (req, res, next) {
    cashflowController.getCashFlowEntry(req, res, next);
});

app.post('/cashflow', isLoginEnsured, function (req, res, next) {
    cashflowController.triggerCashSalesByDate(req, res, next);
});

app.delete('/cashflow', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    cashflowController.deleteCashFlowClosing(req, res, next);  // response returned inside controller
});

app.delete('/remove-cashflow-txn', isLoginEnsured, function (req, res, next) {
    cashflowController.deleteCashFlow(req, res, next);
});

app.post('/save-cashflow-txns', isLoginEnsured, function (req, res, next) {
    cashflowController.saveCashflowTxnData(req, res, next);
});

app.post('/save-cashflow-denoms', isLoginEnsured, function (req, res, next) {
    cashflowController.saveCashflowDenomsData(req, res, next);
});

app.get('/cashflowhome', isLoginEnsured, function (req, res) {
    cashflowController.getCashFlowHome(req, res);
});

app.post('/close-cashflow', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    cashflowController.closeData(req, res, next);  // response returned inside controller
});

app.get('/tankreceipts', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    tankReceiptController.getTankReceipts(req, res, next);    // response returned inside controller
});


app.get('/edit-draft-tankrcpt', isLoginEnsured, function (req, res, next) {
    decantEditController.getDataToEdit(req, res, next);  // response returned inside controller
});


app.post('/close-receipt', isLoginEnsured, function (req, res, next) {
    tankReceiptController.closeData(req, res, next);
});

app.get('/new-decant', isLoginEnsured, function (req, res) {
    tankReceiptController.getNewData(req, res);
});

app.post('/new-decant', isLoginEnsured, function (req, res, next) {
    tankReceiptController.saveTankReceipts(req, res, next);  // response returned inside controller
});

app.post('/new-decant-lines', isLoginEnsured, function (req, res, next) {
    tankReceiptController.saveDecantLines(req, res, next);  // response returned inside controller
});

app.delete('/remove-decant-line', isLoginEnsured, function (req, res, next) {
    tankReceiptController.deleteDecantLines(req, res, next);
});

app.delete('/delete-tankReceipt', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    tankReceiptController.deleteTankReceipts(req, res, next);
});

app.get('/truck-load', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.getTruckData(req, res, next);  // response returned inside controller
});

app.post('/truck-load', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.saveTruckData(req, res, next);  // response returned inside controller
});

app.delete('/delete-truckload', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.deleteTruckLoad(req, res, next);
});

app.get('/truck-expense', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.getTruckExpenseData(req, res, next);  // response returned inside controller
});

app.post('/truck-expense', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.saveTruckExpenseData(req, res, next);  // response returned inside controller
});

app.delete('/delete-truckexpense', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    truckLoadController.deleteTruckExpense(req, res, next);
});

app.get('/utilities', isLoginEnsured, function (req, res) {
    utilitiesController.get(req, res);    // response returned inside controller
});

app.get('/density', isLoginEnsured, function (req, res) {
    utilitiesController.getDensity(req, res);    // response returned inside controller
});

app.get('/dip-chart', isLoginEnsured, function (req, res) {
    utilitiesController.getDipChart(req, res);    // response returned inside controller
});

app.post('/tally-export', isLoginEnsured, function (req, res) {
    utilitiesController.getTallyExport(req, res);    // response returned inside controller
});

app.get('/bank-transaction', isLoginEnsured, function (req, res) {
    bankAccountController.getAccountData(req, res);   // response returned inside controller
});

app.post('/bank-transaction', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    bankAccountController.saveTransactionData(req, res, next);  // response returned inside controller
});

app.delete('/delete-banktransaction', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    bankAccountController.deleteTransaction(req, res, next);
});

app.get('/account-type', isLoginEnsured, function (req, res) {
    bankAccountController.getAccountingType(req, res);    // response returned inside controller
});
app.get('/charts', isLoginEnsured, function (req, res) {
    res.render('charts', { user: req.user, location: req.user.location_code });    // response returned inside controller
});

// app.get('/charts/:id', isLoginEnsured, function (req, res) {
//     dashBoardController.getCharatData(req, res);    // response returned inside controller
// });
// routes - end

app.get('/deadline', isLoginEnsured, function (req, res, next) {
    deadlineController.getDeadlineData(req, res, next);  // response returned inside controller
});

app.post('/deadline', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    deadlineController.saveDeadlineData(req, res, next)
});

app.put('/deadline/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    deadlineController.updateDeadlineData(req, res);

});

// error handler - start.
app.use(function (req, res, next) {
    next(createError(403));
});

app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});
// error handler - end.

// port - start

app.listen(process.env.SERVER_PORT, function () {
    console.log('Express server listening on port ' + process.env.SERVER_PORT);
});

// port - end
module.exports = app;
// app configurations - end
