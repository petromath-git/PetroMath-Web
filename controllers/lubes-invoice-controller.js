const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const lubesInvoiceDao = require("../dao/lubes-invoice-dao");
const supplierDao = require("../dao/supplier-dao");
const config = require("../config/app-config").APP_CONFIGS;
const appCache = require("../utils/app-cache");
// Add these imports
const db = require("../db/db-connection");
const LubesInvoiceHeader = db.t_lubes_inv_hdr;
const LubesInvoiceLine = db.t_lubes_inv_lines;


module.exports = {
    getLubesInvoiceHome: (req, res, next) => {
        gatherLubesInvoices(
            req.query.invoice_fromDate, 
            req.query.invoice_toDate,
            req.query.supplier_id, 
            req.user, 
            res, 
            next, 
            {}
        );
    },
    
    getLubesInvoiceEntry: (req, res, next) => {
        lubesInvoiceDao.findLubesInvoice(req.user.location_code, req.query.id).then(data => {
            if (data) {
                getLubesInvoiceDetailsPromise(data, req, res, next);
            } else {
                res.status(404).send("Invoice not found");
            }
        }).catch(err => {
            console.error("Error fetching invoice:", err);
            next(err);
        });
    },
    
    createNewInvoice: (req, res, next) => {
        // First, get the location ID for the user's location code
        lubesInvoiceDao.getLocationId(req.user.location_code)
            .then(location => {
                // Ensure we have a valid location
                if (!location) {
                    throw new Error(`No location found for code: ${req.user.location_code}`);
                }
    
                // Now proceed with fetching products and suppliers
                return Promise.all([
                    lubesInvoiceDao.getProducts(req.user.location_code),
                    lubesInvoiceDao.getSuppliers(req.user.location_code),
                    location
                ]);
            })
            .then(values => {
                res.render('lubes-invoice', {
                    title: "New Lubes Invoice",
                    user: req.user,
                    config: config,
                    products: values[0],
                    suppliers: values[1],
                    location_id: values[2].location_id, // Pass the location ID
                    invoiceStatus: 'DRAFT',
                    isNew: true,
                    dateFormat: dateFormat
                });
            })
            .catch(err => {
                console.error("Error loading form data:", err);
                next(err);
            });
    },
    saveLubesInvoice: (req, res, next) => {
        const { 
            invoice_date, invoice_number, supplier_id, location_id, location_code,
            invoice_amount, notes, items, lubes_hdr_id
        } = req.body;
        
        const saveInvoice = async () => {
            try {
                let headerData;
                
                if (lubes_hdr_id) {
                    // Update existing invoice
                    await LubesInvoiceHeader.update({
                        invoice_date,
                        invoice_number,
                        supplier_id,
                        invoice_amount,
                        notes,
                        updated_by: req.user.Person_id,
                        updation_date: new Date()
                    }, {
                        where: { lubes_hdr_id: lubes_hdr_id }
                    });
                    headerData = { lubes_hdr_id };
                    
                    // Delete existing lines to replace with new ones
                    await LubesInvoiceLine.destroy({ 
                        where: { lubes_hdr_id: lubes_hdr_id }
                    });
                } else {
                    // Create new invoice
                    headerData = await lubesInvoiceDao.addNew({
                        invoice_date,
                        invoice_number,
                        supplier_id,
                        invoice_amount,
                        notes,
                        location_id,
                        location_code,
                        closing_status: 'DRAFT',
                        created_by: req.user.Person_id,
                        creation_date: new Date()
                    });
                }
                
                // Prepare and save line items
                if (items && items.length > 0) {
                    const lineItems = items.map(item => ({
                        lubes_hdr_id: headerData.lubes_hdr_id,
                        product_id: item.product_id,
                        qty: item.qty,
                        mrp: item.mrp || 0,
                        net_rate: item.net_rate || 0,
                        amount: item.amount,
                        notes: item.notes,
                        created_by: req.user.Person_id,
                        creation_date: new Date()
                    }));
                    
                    await lubesInvoiceDao.saveLubesInvoiceLines(lineItems);
                    
                    // Update product quantities
                    for (const item of items) {
                        await lubesInvoiceDao.updateProductQuantity(
                            item.product_id, 
                            item.qty, 
                            req.user.Person_id
                        );
                    }
                }
                
                return { success: true, lubes_hdr_id: headerData.lubes_hdr_id };
            } catch (error) {
                console.error("Error saving invoice:", error);
                return { success: false, error: error.message };
            }
        };
        
        // Execute transaction
        saveInvoice().then(result => {
            if (result.success) {
                res.status(200).json({ 
                    success: true, 
                    message: 'Invoice saved successfully', 
                    lubes_hdr_id: result.lubes_hdr_id 
                });
            } else {
                res.status(500).json({ 
                    success: false, 
                    message: 'Failed to save invoice', 
                    error: result.error 
                });
            }
        });
    }    
,
    
deleteLubesInvoice: (req, res, next) => {
    if(req.query.id) {
        // First, check the invoice status
        lubesInvoiceDao.findLubesInvoice(req.user.location_code, req.query.id)
            .then(invoice => {
                // Check if invoice exists and is in DRAFT status
                if (!invoice) {
                    return res.status(404).send({error: 'Invoice not found.'});
                }

                if (invoice.closing_status !== 'DRAFT') {
                    return res.status(400).send({error: 'Only draft invoices can be deleted.'});
                }

                // If invoice is in DRAFT, proceed with deletion
                return lubesInvoiceDao.deleteLubesInvoice(req.query.id)
                    .then(data => {
                        if (data == 1) {
                            res.status(200).send({message: 'Invoice successfully deleted.'});
                        } else {
                            res.status(500).send({error: 'Invoice deletion failed or not available to delete.'});
                        }
                    });
            })
            .catch(err => {
                console.error("Error deleting invoice:", err);
                res.status(500).send({error: 'Error during invoice deletion: ' + err.message});
            });
    } else {
        res.status(400).send({error: 'Invoice ID is required'});
    }
},
    
finishInvoice: (req, res, next) => {
    lubesInvoiceDao.finishInvoice(req.query.id).then(
        (data) => {
            if(data == 1) {
                // Check if this is an AJAX request
                if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                    // Respond with JSON for AJAX requests
                    res.status(200).json({
                        success: true,
                        message: 'The invoice has been closed.'
                    });
                } else {
                    // Redirect for normal requests
                    req.flash('success', 'The invoice has been closed.'); // If you use flash messages
                    res.redirect('/lubes-invoice-home');
                }
            } else {
                if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                    res.status(500).json({
                        success: false,
                        message: 'Error while closing the invoice.'
                    });
                } else {
                    req.flash('error', 'Error while closing the invoice.'); // If you use flash messages
                    res.redirect('/lubes-invoice-home');
                }
            }
        }).catch(err => {
            console.error("Error finishing invoice:", err);
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                res.status(500).json({
                    success: false,
                    message: 'Error during invoice closing: ' + err.message
                });
            } else {
                req.flash('error', 'Error during invoice closing: ' + err.message); // If you use flash messages
                res.redirect('/lubes-invoice-home');
            }
        });
},
    // Add this to your controller module.exports
getLubesInvoiceLines: (req, res, next) => {
    if (!req.query.id) {
        return res.status(400).json({
            success: false,
            message: 'Invoice ID is required'
        });
    }

    lubesInvoiceDao.findLubesInvoiceLines(req.query.id)
        .then(lines => {
            if (!lines) {

              
                return res.status(404).json({
                    success: false,
                    message: 'No lines found for this invoice'
                });
            }

            console.log(lines);

            // Transform the data to ensure we handle missing Product properly
            const transformedLines = lines.map(line => {
                const lineData = line.toJSON();
                return {
                    ...lineData,
                    amount: parseFloat(lineData.amount) || 0,
                    mrp: parseFloat(lineData.mrp) || 0,
                    net_rate: parseFloat(lineData.net_rate) || 0,
                    qty: parseFloat(lineData.qty) || 0,
                    // Ensure product data is safely accessed
                    product_name: lineData.m_product ? lineData.m_product.product_name : 'Unknown Product',
                    unit: lineData.Product ? lineData.Product.unit : '',
                    price: lineData.Product ? lineData.Product.price : 0
                };
            });

            res.json({
                success: true,
                lines: transformedLines
            });
        })
        .catch(err => {
            console.error("Error fetching invoice lines:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching invoice lines',
                error: err.message
            });
        });
},
getHistoricalData: (req, res, next) => {
    const productId = req.query.productId;
    if (!productId) {
        return res.status(400).json({
            success: false,
            message: 'Product ID is required'
        });
    }

    lubesInvoiceDao.getHistoricalPurchaseData(req.user.location_code, productId)
        .then(history => {
            res.json({
                success: true,
                history: history
            });
        })
        .catch(err => {
            console.error("Error fetching historical data:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching historical data',
                error: err.message
            });
        });
},
// Get suppliers active on a specific date
getSuppliersActiveOnDate: (req, res, next) => {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const locationCode = req.user.location_code;
    
    supplierDao.findSuppliersActiveOnDate(locationCode, date)
        .then(suppliers => {
            res.json({
                success: true,
                suppliers: suppliers
            });
        })
        .catch(err => {
            console.error("Error fetching suppliers for date:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching suppliers for the specified date',
                error: err.message
            });
        });
},

// Get all suppliers with their effective dates for client-side filtering
getSuppliersWithDates: (req, res, next) => {
    const locationCode = req.user.location_code;
    
    supplierDao.getAllSuppliersWithDates(locationCode)
        .then(suppliers => {
            res.json({
                success: true,
                suppliers: suppliers
            });
        })
        .catch(err => {
            console.error("Error fetching suppliers with dates:", err);
            res.status(500).json({
                success: false,
                message: 'Error fetching suppliers with dates',
                error: err.message
            });
        });
}
};

function getLubesInvoiceDetailsPromise(invoiceDetails, req, res, next) {
    Promise.all([
        invoiceDetails,
        lubesInvoiceDao.findLubesInvoiceLines(req.query.id),
        lubesInvoiceDao.getProducts(req.user.location_code),
        lubesInvoiceDao.getSuppliers(req.user.location_code)
    ]).then(values => {
        res.render('lubes-invoice', {
            title: "Lubes Invoice: " + values[0].invoice_number,
            user: req.user,
            config: config,
            invoice: values[0],
            invoiceLines: values[1],
            products: values[2],
            suppliers: values[3],            
            invoiceStatus: values[0].closing_status,
            isNew: false,
            dateFormat: dateFormat  // Add this line
        });
    }).catch(err => {
        console.error("Error loading invoice details:", err);
        next(err);
    });
}

function gatherLubesInvoices(fromDate, toDate, supplierId, user, res, next, messagesOptional) {
    // If no dates provided, use financial year dates
    if(fromDate === undefined || toDate === undefined) {
        const financialYearDates = getFinancialYearDates();
        fromDate = financialYearDates.fromDate;
        toDate = financialYearDates.toDate;
    }
    
    // Create promises for both data fetches
    const suppliersPromise = lubesInvoiceDao.getSuppliers(user.location_code);
    const invoicesPromise = lubesInvoiceDao.findLubesInvoices(
        user.location_code, 
        fromDate, 
        toDate, 
        supplierId
    );
    
    // Execute both promises together
    Promise.all([suppliersPromise, invoicesPromise])
        .then(([suppliers, invoices]) => {
            let invoiceValues = [];
            
            if(invoices && invoices.length > 0) {
                invoices.forEach(invoice => {
                    invoiceValues.push({
                        lubes_hdr_id: invoice.lubes_hdr_id,
                        invoice_number: invoice.invoice_number,
                        supplier_name: invoice.Supplier ? invoice.Supplier.supplier_name : 'N/A',
                        closing_status: invoice.closing_status,
                        notes: invoice.notes,
                        date: dateFormat(invoice.invoice_date, 'dd-mmm-yyyy'),
                        amount: parseFloat(invoice.invoice_amount) || 0,
                        total_lines: invoice.LubesInvoiceLines ? invoice.LubesInvoiceLines.length : 0
                    });
                });
            }
            
            res.render('lubes-invoice-home', {
                title: "Lubes Invoice: Home", 
                user: user,
                fromDate: fromDate, 
                toDate: toDate,
                selectedSupplierId: supplierId,
                suppliers: suppliers,
                invoiceValues: invoiceValues,
                currentDate: utils.currentDate(),
                messages: messagesOptional
            });
        })
        .catch(err => {
            console.error("Error gathering invoices:", err);
            next(err);
        });
}

function formatFinancialYearDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFinancialYearDates(date = new Date()) {
    const currentYear = date.getFullYear();
    const currentMonth = date.getMonth();

    let fromDate, toDate;

    // Financial year starts from April 1st
    if (currentMonth >= 3) { // April (3) to December
        fromDate = new Date(currentYear, 3, 1); // April 1st of current year
        toDate = new Date(currentYear + 1, 2, 31); // March 31st of next year
    } else { // January to March
        fromDate = new Date(currentYear - 1, 3, 1); // April 1st of previous year
        toDate = new Date(currentYear, 2, 31); // March 31st of current year
    }

    return {
        fromDate: formatFinancialYearDate(fromDate),
        toDate: formatFinancialYearDate(toDate)
    };
}