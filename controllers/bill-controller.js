// controllers/bill-controller.js
const db = require("../db/db-connection");
const ProductDao = require("../dao/product-dao");
const CreditDao = require("../dao/credits-dao");
const CreditVehicleDao = require("../dao/credit-vehicles-dao");
const utils = require("../utils/app-utils");
const msg = require("../config/app-messages");
const Sequelize = require('sequelize');
const pug = require('pug');
const path = require('path');
const { getBrowser } = require('../utils/browserHelper');
const BillNumberingService = require('../services/bill-numbering-service');


module.exports = {
    getNewBill: async (req, res, next) => {
        try {
            // Get active shifts
            // Get active shifts with cashier name
                const activeShifts = await db.sequelize.query(`
                    SELECT c.closing_id, c.creation_date, c.cashier_id,
                        p.Person_Name as cashier_name
                    FROM t_closing c
                    LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                    WHERE c.location_code = :locationCode 
                    AND c.closing_status != 'CLOSED'
                    ORDER BY c.creation_date DESC
                `, {
                    replacements: { locationCode: req.user.location_code },
                    type: Sequelize.QueryTypes.SELECT
                });

            let selectedShift = null;
                if (activeShifts.length === 1) {
                    selectedShift = activeShifts[0].closing_id;
                }        

            // Get products for the location
            const products = await ProductDao.findProducts(req.user.location_code);


            // Get credit customers for the location
            const credits = await CreditDao.findCreditsExcludeDigital(req.user.location_code);

             


            const vehicleData = await CreditVehicleDao.findAllVehiclesForLocation(req.user.location_code);

                


            // Group vehicles by creditlist_id for easier access
            const vehiclesByCredit = {};
            vehicleData.forEach(vehicle => {
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


             res.render('bills/create', {
                title: 'Create New Bill',
                user: req.user,
                shifts: activeShifts,
                selectedShift: selectedShift,  // Add this
                products: products,
                credits: credits,
                vehicleData: vehiclesByCredit,
                messages: req.flash()
            });
        } catch (error) {
            next(error);
        }
    },
    // createBill: async (req, res, next) => {
    //     const transaction = await db.sequelize.transaction();

    //       try {
    //     // Validate bill items FIRST
    //         const validation = await validateBillItems(req.body.items, req.user.location_code);
    //         if (!validation.valid) {
    //             req.flash('error', validation.errors.join('. '));
    //             return res.redirect('/bills/new');
    //     }
        
        
    //         // First validate closing status
    //         const closing = await db.sequelize.query(`
    //             SELECT closing_status 
    //             FROM t_closing 
    //             WHERE closing_id = :closingId
    //             AND location_code = :locationCode
    //         `, {
    //             replacements: { 
    //                 closingId: req.body.closing_id,
    //                 locationCode: req.user.location_code 
    //             },
    //             type: Sequelize.QueryTypes.SELECT
    //         });

    //         if (!closing.length || closing[0].closing_status === 'CLOSED') {
    //             req.flash('error', 'Cannot create bills for closed or invalid shifts');
    //             return res.redirect('/bills/new');
    //         }

            
    //         // Get next bill number based on bill type
    //         const maxBillResult = await db.sequelize.query(`
    //             SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no, 4) AS UNSIGNED)), 0) as max_bill 
    //             FROM t_bills 
    //             WHERE location_code = :locationCode
    //             AND bill_no LIKE :prefix
    //         `, {
    //             replacements: { 
    //                 locationCode: req.user.location_code,
    //                 prefix: req.body.bill_type === 'CREDIT' ? 'CR/%' : 'CS/%'
    //             },
    //             type: Sequelize.QueryTypes.SELECT
    //         });
            
    //         const nextNumber = maxBillResult[0].max_bill + 1;
    //         const prefix = req.body.bill_type === 'CREDIT' ? 'CR/' : 'CS/';
    //         // Pad the number with leading zeros to ensure proper sorting
    //         const paddedNumber = String(nextNumber).padStart(6, '0');
    //         const nextBillNo = `${prefix}${paddedNumber}`;

    //         // Create bill
    //         const [billResult] = await db.sequelize.query(`
    //             INSERT INTO t_bills (
    //                 location_code, bill_no, bill_type, closing_id,
    //                 total_amount, created_by, creation_date
    //             ) VALUES (
    //                 :locationCode, :billNo, :billType, :closingId,
    //                 :totalAmount, :createdBy, NOW()
    //             )
    //         `, {
    //             replacements: {
    //                 locationCode: req.user.location_code,
    //                 billNo: nextBillNo,
    //                 billType: req.body.bill_type,
    //                 closingId: req.body.closing_id,
    //                 totalAmount: req.body.items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0),
    //                 createdBy: req.user.Person_id
    //             },
    //             type: Sequelize.QueryTypes.INSERT,
    //             transaction
    //         });

    //         const billId = billResult;

    //         // Create bill items
    //         for (const item of req.body.items) {
    //             if (req.body.bill_type === 'CREDIT') {
    //                     await db.sequelize.query(`
    //                         INSERT INTO t_credits (
    //                             closing_id, bill_no, bill_id, creditlist_id, vehicle_id,
    //                             product_id, price, price_discount, qty, amount,
    //                             base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
    //                             notes, odometer_reading, created_by, creation_date
    //                         ) VALUES (
    //                             :closingId, :billNo, :billId, :creditlistId, :vehicleId,
    //                             :productId, :price, :discount, :qty, :amount,
    //                             :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
    //                             :notes, :odometerReading, :createdBy, NOW()
    //                         )
    //                     `, {
    //                         replacements: {
    //                             closingId: req.body.closing_id,
    //                             billNo: nextBillNo,
    //                             billId: billId,
    //                             creditlistId: req.body.creditlist_id,
    //                             vehicleId: req.body.bill_vehicle_id || null,
    //                             odometerReading: parseFloat(req.body.bill_odometer_reading || 0) || null,   
    //                             productId: parseInt(item.product_id),
    //                             price: parseFloat(item.price),
    //                             discount: parseFloat(item.price_discount || 0),
    //                             qty: parseFloat(item.qty),
    //                             amount: parseFloat(item.amount),
    //                             baseAmount: parseFloat(item.base_amount),
    //                             cgstPercent: parseFloat(item.cgst_percent || 0),
    //                             sgstPercent: parseFloat(item.sgst_percent || 0),
    //                             cgstAmount: parseFloat(item.cgst_amount || 0),
    //                             sgstAmount: parseFloat(item.sgst_amount || 0),
    //                             notes: item.notes || '',
    //                             odometerReading: parseFloat(item.odometer_reading) || null,
    //                             createdBy: req.user.Person_id
    //                         },
    //                         type: Sequelize.QueryTypes.INSERT,
    //                         transaction
    //                     });
    //             } else {
    //                     // For CASH bills
    //                     await db.sequelize.query(`
    //                         INSERT INTO t_cashsales (
    //                             closing_id, bill_no, bill_id,
    //                             product_id, price, price_discount, qty, amount,
    //                             base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
    //                             notes, created_by, creation_date
    //                         ) VALUES (
    //                             :closingId, :billNo, :billId,
    //                             :productId, :price, :discount, :qty, :amount,
    //                             :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
    //                             :notes, :createdBy, NOW()
    //                         )
    //                     `, {
    //                         replacements: {
    //                             closingId: req.body.closing_id,
    //                             billNo: nextBillNo,
    //                             billId: billId,
    //                             vehicleNumber: req.body.bill_vehicle_number || null,
    //                             odometerReading: parseFloat(req.body.bill_odometer_reading || 0) || null,
    //                             productId: parseInt(item.product_id),
    //                             price: parseFloat(item.price),
    //                             discount: parseFloat(item.price_discount || 0),
    //                             qty: parseFloat(item.qty),
    //                             amount: parseFloat(item.amount),
    //                             baseAmount: parseFloat(item.base_amount),
    //                             cgstPercent: parseFloat(item.cgst_percent || 0),
    //                             sgstPercent: parseFloat(item.sgst_percent || 0),
    //                             cgstAmount: parseFloat(item.cgst_amount || 0),
    //                             sgstAmount: parseFloat(item.sgst_amount || 0),
    //                             notes: item.notes || '',
    //                             createdBy: req.user.Person_id
    //                         },
    //                         type: Sequelize.QueryTypes.INSERT,
    //                         transaction
    //                     });
    //                 }
    //         }

    //         await transaction.commit();
    //         req.flash('success', `Bill ${nextBillNo} created successfully`);
    //         res.redirect('/bills');
            
    //     } catch (error) {
    //         await transaction.rollback();
    //         console.error('Bill creation error details:', {
    //             error: error.message,
    //             items: req.body.items,
    //             billType: req.body.bill_type
    //         });
    //         req.flash('error', 'Error creating bill: ' + error.message);
    //         res.redirect('/bills/new');
    //     }
    // },

    

    // getBills: async (req, res, next) => {
    //     try {
    //         const bills = await db.sequelize.query(`
    //             SELECT b.*, 
    //                 CASE 
    //                     WHEN b.bill_type = 'CREDIT' THEN c.Company_Name
    //                     ELSE NULL
    //                 END as customer_name,
    //                 p.Person_Name as cashier_name
    //             FROM t_bills b
    //             LEFT JOIN t_credits tc ON b.bill_id = tc.bill_id
    //             LEFT JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id
    //             LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
    //             LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
    //             WHERE b.location_code = :locationCode
    //             ORDER BY b.creation_date DESC
    //         `, {
    //             replacements: { locationCode: req.user.location_code },
    //             type: Sequelize.QueryTypes.SELECT
    //         });
    
    //         res.render('bills/list', {
    //             title: 'Bills',
    //             user: req.user,
    //             bills: bills,
    //             messages: req.flash()
    //         });
    //     } catch (error) {
    //         next(error);
    //     }
    // },

// Replace the getBills query in your bill-controller.js with this:


createBill: async (req, res, next) => {
        const transaction = await db.sequelize.transaction();

        try {
            // Validate bill items FIRST
            const validation = await validateBillItems(req.body.items, req.user.location_code);
            if (!validation.valid) {
                req.flash('error', validation.errors.join('. '));
                return res.redirect('/bills/new');
            }

           await validateShiftForBillOperation(req.body.closing_id, req.user.location_code, 'create');
           await validateProductPumpReadings(req.user.location_code, req.body.closing_id, req.body.items);

            // *** NEW CONFIGURABLE BILL NUMBER GENERATION ***
            const nextBillNo = await BillNumberingService.generateNextBillNumber(
                req.user.location_code, 
                req.body.bill_type
            );

            


            const customerName = req.body.bill_type === 'CASH' ? (req.body.customer_name || null) : null;
      

            // Create bill
            const [billResult] = await db.sequelize.query(`
                INSERT INTO t_bills (
                    location_code, bill_no, bill_type, closing_id,
                    customer_name, total_amount, created_by, creation_date
                ) VALUES (
                    :locationCode, :billNo, :billType, :closingId,
                    :customerName, :totalAmount, :createdBy, NOW()
                )
            `, {
                replacements: {
                    locationCode: req.user.location_code,
                    billNo: nextBillNo,
                    billType: req.body.bill_type,
                    closingId: req.body.closing_id,
                    customerName: req.body.bill_type === 'CASH' ? (req.body.customer_name || null) : null,
                    totalAmount: req.body.items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0),
                    createdBy: req.user.Person_id
                },
                type: Sequelize.QueryTypes.INSERT,
                transaction
            });

             console.log('After T Bills');

            const billId = billResult;

            
            // Create bill items (existing logic remains the same)
            for (const item of req.body.items) {
                if (req.body.bill_type === 'CREDIT') {
                    await db.sequelize.query(`
                        INSERT INTO t_credits (
                            closing_id, bill_no, bill_id, creditlist_id, vehicle_id,
                            product_id, price, price_discount, qty, amount,
                            base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                            notes, created_by, creation_date, vehicle_number, indent_number,
                            odometer_reading
                        ) VALUES (
                            :closingId, :billNo, :billId, :creditlistId, :vehicleId,
                            :productId, :price, :priceDiscount, :qty, :amount,
                            :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                            :notes, :createdBy, NOW(), :vehicleNumber, :indentNumber,
                            :odometerReading
                        )
                    `, {
                        replacements: {
                            closingId: req.body.closing_id,
                            billNo: nextBillNo,
                            billId: billId,
                            creditlistId: req.body.creditlist_id || req.body.creditlist_id_mobile || null,
                            vehicleId: req.body.bill_vehicle_id || req.body.bill_vehicle_id_mobile || null,  // ← FIXED
                            productId: item.product_id,
                            price: item.price,
                            priceDiscount: item.price_discount || 0,
                            qty: item.qty,
                            amount: item.amount,
                            baseAmount: item.base_amount || item.amount,
                            cgstPercent: item.cgst_percent || 0,
                            sgstPercent: item.sgst_percent || 0,
                            cgstAmount: item.cgst_amount || 0,
                            sgstAmount: item.sgst_amount || 0,
                            notes: item.notes || '',
                            createdBy: req.user.Person_id,
                            vehicleNumber: item.vehicle_number || '',
                            indentNumber: item.indent_number || '',
                            odometerReading: req.body.bill_odometer_reading || req.body.bill_odometer_reading_mobile || null  // ← FIXED
                        },
                        type: Sequelize.QueryTypes.INSERT,
                        transaction
                    });
                } else {
                    // Cash sales
                    await db.sequelize.query(`
                        INSERT INTO t_cashsales (
                            closing_id, bill_no, bill_id, customer_name, product_id, price, price_discount,
                            qty, amount, base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                            notes, vehicle_number, odometer_reading, created_by, creation_date
                        ) VALUES (
                            :closingId, :billNo, :billId, :customerName, :productId, :price, :priceDiscount,
                            :qty, :amount, :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                            :notes, :vehicleNumber, :odometerReading, :createdBy, NOW()
                        )
                    `, {
                        replacements: {
                            closingId: req.body.closing_id,
                            billNo: nextBillNo,
                            billId: billId,
                            customerName: req.body.customer_name || req.body.customer_name_mobile || null,  // ← Handle mobile
                            productId: item.product_id,
                            price: item.price,
                            priceDiscount: item.price_discount || 0,
                            qty: item.qty,
                            amount: item.amount,
                            baseAmount: item.base_amount || item.amount,
                            cgstPercent: item.cgst_percent || 0,
                            sgstPercent: item.sgst_percent || 0,
                            cgstAmount: item.cgst_amount || 0,
                            sgstAmount: item.sgst_amount || 0,
                            notes: item.notes || '',
                            vehicleNumber: req.body.bill_vehicle_number || req.body.bill_vehicle_number_mobile || null,  // ← FIXED
                            odometerReading: parseFloat(req.body.bill_odometer_reading || req.body.bill_odometer_reading_mobile || 0) || null,  // ← FIXED
                            createdBy: req.user.Person_id
                        },
                        type: Sequelize.QueryTypes.INSERT,
                        transaction
                    });
                }
            }

            console.log('After Insert lines');

            await transaction.commit();
            req.flash('success', `Bill ${nextBillNo} created successfully`);
            res.redirect('/bills');

        } catch (error) {
            await transaction.rollback();
            console.error('Error creating bill:', error);
            req.flash('error', 'Error creating bill: ' + error.message);
            res.redirect('/bills/new');
        }
    },

    // Add a new method to show bill numbering configuration
    getBillNumberingConfig: async (req, res, next) => {
        try {
            const config = await BillNumberingService.getConfigSummary(req.user.location_code);
            
            res.render('bills/numbering-config', {
                title: 'Bill Numbering Configuration',
                user: req.user,
                config: config,
                messages: req.flash()
            });
        } catch (error) {
            next(error);
        }
    },

    // Add method to update bill numbering configuration
    updateBillNumberingConfig: async (req, res, next) => {
        try {
            const { locationCode } = req.params;
            const {
                creditPrefix, cashPrefix, padding, resetFrequency,
                includeYear, yearFormat, useUnifiedSequence,
                unifiedPrefix, creditStartNumber, cashStartNumber,
                unifiedStartNumber
            } = req.body;

            // Set each configuration setting
            if (creditPrefix) await locationConfigDao.setSetting(locationCode, 'BILL_PREFIX_CREDIT', creditPrefix, req.user.Person_id);
            if (cashPrefix) await locationConfigDao.setSetting(locationCode, 'BILL_PREFIX_CASH', cashPrefix, req.user.Person_id);
            if (padding) await locationConfigDao.setSetting(locationCode, 'BILL_NUMBER_PADDING', padding, req.user.Person_id);
            if (resetFrequency) await locationConfigDao.setSetting(locationCode, 'BILL_RESET_FREQUENCY', resetFrequency, req.user.Person_id);
            if (includeYear) await locationConfigDao.setSetting(locationCode, 'BILL_INCLUDE_YEAR', includeYear, req.user.Person_id);
            if (yearFormat) await locationConfigDao.setSetting(locationCode, 'BILL_YEAR_FORMAT', yearFormat, req.user.Person_id);
            if (useUnifiedSequence) await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_SEQUENCE', useUnifiedSequence, req.user.Person_id);
            if (unifiedPrefix) await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_PREFIX', unifiedPrefix, req.user.Person_id);
            if (creditStartNumber) await locationConfigDao.setSetting(locationCode, 'BILL_CREDIT_START_NUMBER', creditStartNumber, req.user.Person_id);
            if (cashStartNumber) await locationConfigDao.setSetting(locationCode, 'BILL_CASH_START_NUMBER', cashStartNumber, req.user.Person_id);
            if (unifiedStartNumber) await locationConfigDao.setSetting(locationCode, 'BILL_UNIFIED_START_NUMBER', unifiedStartNumber, req.user.Person_id);

            req.flash('success', 'Bill numbering configuration updated successfully');
            res.redirect(`/bills/config/${locationCode}`);

        } catch (error) {
            console.error('Error updating bill numbering config:', error);
            req.flash('error', 'Error updating configuration: ' + error.message);
            res.redirect('back');
        }
    },



getBills: async (req, res, next) => {
    try {
        const bills = await db.sequelize.query(`
            SELECT DISTINCT
                b.bill_id, b.location_code, b.bill_no, b.bill_type, b.closing_id,
                b.bill_status, b.print_count, b.total_amount, b.creation_date,
                b.updation_date,
                -- Check if bill can be deleted
                CASE 
                    WHEN cl.closing_status = 'CLOSED' THEN 0
                    WHEN b.print_count > 0 THEN 0
                    WHEN b.bill_status = 'CANCELLED' THEN 0
                    ELSE 1
                END as can_delete,
                cl.closing_status,
                -- Customer name logic (existing)
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT c.Company_Name 
                        FROM t_credits tc 
                        JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id 
                        WHERE tc.bill_id = b.bill_id 
                        LIMIT 1
                    )
                    WHEN b.bill_type = 'CASH' THEN b.customer_name    
                    ELSE NULL
                END as customer_name,                
                p.Person_Name as cashier_name
            FROM t_bills b
            LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
            LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
            WHERE b.location_code = :locationCode
            ORDER BY b.creation_date DESC
        `, {
            replacements: { locationCode: req.user.location_code },
            type: Sequelize.QueryTypes.SELECT
        });

        res.render('bills/list', {
            title: 'Bills',
            user: req.user,
            bills: bills,
            messages: req.flash()
        });
    } catch (error) {
        next(error);
    }
},


    cancelBill: async (req, res, next) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            // Check if bill can be cancelled
            const bill = await db.sequelize.query(`
                SELECT * FROM t_bills 
                WHERE bill_id = :billId 
                AND print_count = 0 
                AND bill_status != 'CANCELLED'
            `, {
                replacements: { billId: req.params.billId },
                type: Sequelize.QueryTypes.SELECT
            });

            if (!bill.length) {
                throw new Error('Bill cannot be cancelled - either not found, already cancelled, or already printed');
            }

            await db.sequelize.query(`
                UPDATE t_bills 
                SET bill_status = 'CANCELLED',
                    cancelled_by = :cancelledBy,
                    cancelled_date = NOW(),
                    cancelled_reason = :reason,
                    updated_by = :updatedBy,
                    updation_date = NOW()
                WHERE bill_id = :billId
            `, {
                replacements: {
                    billId: req.params.billId,
                    cancelledBy: req.user.Person_id,
                    reason: req.body.reason,
                    updatedBy: req.user.Person_id
                },
                type: Sequelize.QueryTypes.UPDATE,
                transaction
            });

            await transaction.commit();
            req.flash('success', 'Bill cancelled successfully');
            res.redirect('/bills');
        } catch (error) {
            await transaction.rollback();
            req.flash('error', error.message);
            res.redirect('/bills');
        }
    },

    // In bill-controller.js add:

    getBillDetails: async (req, res, next) => {
        try {
            const billId = req.params.billId;
            
            // First get bill type
            const bill = await db.sequelize.query(`
                SELECT bill_type FROM t_bills WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });

            if (!bill.length) {
                return res.status(404).json({ error: 'Bill not found' });
            }

            let items;
            if (bill[0].bill_type === 'CREDIT') {
                items = await db.sequelize.query(`
                    SELECT c.*, p.product_name, cl.Company_Name as customer_name
                    FROM t_credits c
                    JOIN m_product p ON c.product_id = p.product_id
                    LEFT JOIN m_credit_list cl ON c.creditlist_id = cl.creditlist_id
                    WHERE c.bill_id = :billId
                `, {
                    replacements: { billId },
                    type: Sequelize.QueryTypes.SELECT
                });
            } else {
                items = await db.sequelize.query(`
                    SELECT c.*, p.product_name
                    FROM t_cashsales c
                    JOIN m_product p ON c.product_id = p.product_id
                    WHERE c.bill_id = :billId
                `, {
                    replacements: { billId },
                    type: Sequelize.QueryTypes.SELECT
                });
            }

            res.json({
                bill_type: bill[0].bill_type,
                items: items,
                customer_name: items[0]?.customer_name,
                vehicle_number: items[0]?.vehicle_number,
                indent_number: items[0]?.indent_number
            });
        } catch (error) {
            next(error);
        }
    },

    editBill: async (req, res, next) => {
        try {
            const billId = req.params.billId;

            // Fetch the bill details
            const bill = await db.sequelize.query(`
                SELECT *, COALESCE(total_amount, 0) as total_amount,
                (SELECT creditlist_id FROM t_credits WHERE bill_id = :billId LIMIT 1) as creditlist_id 
                FROM t_bills 
                WHERE bill_id = :billId 
                AND bill_status = 'DRAFT'
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
            if (!bill.length) {
                req.flash('error', 'Cannot edit this bill. It may not exist or is not in DRAFT status.');
                return res.redirect('/bills');
            }
    
            const billItems = bill[0].bill_type === 'CREDIT'
            ? await db.sequelize.query(`
                SELECT c.*, p.product_name, cl.Company_Name as customer_name
                FROM t_credits c
                JOIN m_product p ON c.product_id = p.product_id
                JOIN m_credit_list cl ON c.creditlist_id = cl.creditlist_id
                WHERE c.bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            })
            : await db.sequelize.query(`
                SELECT c.*, p.product_name 
                FROM t_cashsales c
                JOIN m_product p ON c.product_id = p.product_id
                WHERE c.bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
              // Get active shifts
              const activeShifts = await db.sequelize.query(`
                SELECT c.closing_id, c.creation_date, c.cashier_id,
                    p.Person_Name as cashier_name
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                WHERE c.location_code = :locationCode 
                AND c.closing_status != 'CLOSED'
                ORDER BY c.creation_date DESC
            `, {
                replacements: { locationCode: req.user.location_code },
                type: Sequelize.QueryTypes.SELECT
            });
          
            // Get products for the location
            const products = await ProductDao.findProducts(req.user.location_code);
            const credits = await CreditDao.findCreditsExcludeDigital(req.user.location_code);
            const vehicleData = await CreditVehicleDao.findAllVehiclesForLocation(req.user.location_code);
            
            const vehiclesByCredit = {};
                vehicleData.forEach(vehicle => {
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
                          
            // Get vehicle info from first bill item for display
                let billVehicleInfo = {};
                if (billItems.length > 0) {
                    billVehicleInfo = {
                        vehicle_number: billItems[0].vehicle_number,
                        odometer_reading: billItems[0].odometer_reading,
                        vehicle_id: billItems[0].vehicle_id
                    };
                }    
                    
            res.render('bills/edit', {
                        title: 'Edit Bill',
                        user: req.user,
                        bill: { ...bill[0], ...billVehicleInfo },
                        items: billItems,  // ← Changed from 'billItems' to 'items'
                        shifts: activeShifts,
                        products: products,
                        credits: credits,
                        vehicleData: vehiclesByCredit,
                        messages: req.flash()
                    });
        } catch (error) {
            next(error);
        }
    },

    updateBill: async (req, res, next) => {

        
        const transaction = await db.sequelize.transaction();

        


     try {


        await validateShiftForBillOperation(req.body.closing_id, req.user.location_code, 'update');
        await validateProductPumpReadings(req.user.location_code, req.body.closing_id, req.body.items);

            const billId = req.params.billId;
            
            // Validate bill items FIRST
            const validation = await validateBillItems(req.body.items, req.user.location_code);
            if (!validation.valid) {
                req.flash('error', validation.errors.join('. '));
                return res.redirect(`/bills/edit/${billId}`);
    }
        

        // Validate the bill exists and is editable
        const bill = await db.sequelize.query(`
            SELECT * FROM t_bills 
            WHERE bill_id = :billId 
            AND bill_status = 'DRAFT'
        `, {
            replacements: { billId },
            type: Sequelize.QueryTypes.SELECT
        });

        if (!bill.length) {
            req.flash('error', 'Cannot update this bill. It may not exist or is not in DRAFT status.');
            return res.redirect('/bills');
        }  
            // For credit bills, ensure customer is selected
            if (bill[0].bill_type === 'CREDIT' && !req.body.creditlist_id) {
                req.flash('error', 'Customer is required for credit bills');
                return res.redirect(`/bills/edit/${billId}`);
            }
        
        // Delete existing items from both tables to handle type change
        await db.sequelize.query('DELETE FROM t_credits WHERE bill_id = :billId', {
            replacements: { billId },
            type: Sequelize.QueryTypes.DELETE,
            transaction
        });
        await db.sequelize.query('DELETE FROM t_cashsales WHERE bill_id = :billId', {
            replacements: { billId },
            type: Sequelize.QueryTypes.DELETE,
            transaction
        });

        // Recalculate total amount
        const totalAmount = req.body.items.reduce((sum, item) => 
            sum + parseFloat(item.amount || 0), 0);

        // Add detailed debugging
        console.log('=== TOTAL AMOUNT CALCULATION DEBUG ===');
        console.log('Items received:', req.body.items?.length || 0, 'items');
        req.body.items?.forEach((item, index) => {
            console.log(`Item ${index}:`, {
                product_id: item.product_id,
                amount: item.amount,
                parsed_amount: parseFloat(item.amount || 0)
            });
        });
        console.log('Calculated total amount:', totalAmount);
        console.log('Is total NaN?', isNaN(totalAmount));
        console.log('==========================================');

        // Update bill total amount and closing_id
        await db.sequelize.query(`
            UPDATE t_bills 
            SET closing_id = :closingId,
                total_amount = :totalAmount,
                customer_name = :customerName,
                updated_by = :updatedBy,
                updation_date = NOW()
            WHERE bill_id = :billId
        `, {
                    replacements: {
                        closingId: req.body.closing_id,
                        totalAmount,
                        customerName: req.body.bill_type === 'CASH' ? (req.body.customer_name || null) : null,
                        updatedBy: req.user.Person_id,
                        billId
                    },
                    type: Sequelize.QueryTypes.UPDATE,
                    transaction
                });

                // Insert new items based on current bill type
                for (const item of req.body.items) {
                    const insertQuery = req.body.bill_type === 'CREDIT'
                        ? `INSERT INTO t_credits (
                            closing_id, bill_no, bill_id, creditlist_id, vehicle_id,
                            product_id, price, price_discount, qty, amount,
                            base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                            notes, odometer_reading, created_by, creation_date
                        ) VALUES (
                            :closingId, :billNo, :billId, :creditlistId, :vehicleId,
                            :productId, :price, :discount, :qty, :amount,
                            :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                            :notes, :odometerReading, :createdBy, NOW()
                        )`
                        :  `INSERT INTO t_cashsales (
                            closing_id, bill_no, bill_id, customer_name,
                            product_id, price, price_discount, qty, amount,
                            base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                            notes, vehicle_number, odometer_reading, created_by, creation_date
                        ) VALUES (
                            :closingId, :billNo, :billId, :customerName,
                            :productId, :price, :discount, :qty, :amount,
                            :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                            :notes, :vehicleNumber, :odometerReading, :createdBy, NOW()
                        )`;

                    await db.sequelize.query(insertQuery, {
            replacements: {
                closingId: req.body.closing_id,
                billNo: bill[0].bill_no,
                billId: billId,
                customerName: req.body.bill_type === 'CASH' ? (req.body.customer_name || req.body.customer_name_mobile || null) : null,  // ← Added mobile
                creditlistId: req.body.bill_type === 'CREDIT' ? (req.body.creditlist_id || req.body.creditlist_id_mobile || null) : null,  // ← Added mobile
                vehicleId: req.body.bill_type === 'CREDIT' ? (req.body.bill_vehicle_id || req.body.bill_vehicle_id_mobile || null) : null,  // ← FIXED
                vehicleNumber: req.body.bill_type === 'CASH' ? (req.body.bill_vehicle_number || req.body.bill_vehicle_number_mobile || null) : null,  // ← FIXED
                odometerReading: parseFloat(req.body.bill_odometer_reading || req.body.bill_odometer_reading_mobile || 0) || null,  // ← FIXED
                productId: parseInt(item.product_id),
                price: parseFloat(item.price),
                discount: parseFloat(item.price_discount || 0),
                qty: parseFloat(item.qty),
                amount: parseFloat(item.amount),
                baseAmount: parseFloat(item.base_amount),
                cgstPercent: parseFloat(item.cgst_percent || 0),
                sgstPercent: parseFloat(item.sgst_percent || 0),
                cgstAmount: parseFloat(item.cgst_amount || 0),
                sgstAmount: parseFloat(item.sgst_amount || 0),
                notes: item.notes || '',
                createdBy: req.user.Person_id
            },
            type: Sequelize.QueryTypes.INSERT,
            transaction
        });


        }

        await transaction.commit();
        req.flash('success', `Bill ${bill[0].bill_no} updated successfully`);
        res.redirect('/bills');
    } catch (error) {
        await transaction.rollback();
        console.error('Bill update error:', error);
        req.flash('error', 'Error updating bill: ' + error.message);
        res.redirect(`/bills/edit/${req.params.billId}`);
    }
},

deleteBill: async (req, res, next) => {
    const transaction = await db.sequelize.transaction();
    
    try {
        const billId = req.params.billId;

        // Get bill info and validate shift access
        const bill = await db.sequelize.query(`
            SELECT bill_type, closing_id 
            FROM t_bills 
            WHERE bill_id = :billId 
            AND location_code = :locationCode
        `, {
            replacements: { 
                billId,
                locationCode: req.user.location_code 
            },
            type: Sequelize.QueryTypes.SELECT
        });

        if (!bill.length) {
            throw new Error('Bill not found or does not belong to this location');
        }

        // Validate shift status before deletion
        await validateShiftForBillOperation(
            bill[0].closing_id, 
            req.user.location_code, 
            'delete'
        );

        // Delete bill items based on bill type
        const deleteItemsQuery = bill[0].bill_type === 'CREDIT'
            ? 'DELETE FROM t_credits WHERE bill_id = :billId'
            : 'DELETE FROM t_cashsales WHERE bill_id = :billId';
        
        await db.sequelize.query(deleteItemsQuery, {
            replacements: { billId },
            type: Sequelize.QueryTypes.DELETE,
            transaction
        });

        // Delete bill from t_bills
        await db.sequelize.query(`
            DELETE FROM t_bills WHERE bill_id = :billId
        `, {
            replacements: { billId },
            type: Sequelize.QueryTypes.DELETE,
            transaction
        });

        await transaction.commit();
        req.flash('success', 'Bill deleted successfully');
        res.redirect('/bills');
    } catch (error) {
        await transaction.rollback();
        console.error('Bill deletion error:', error);
        req.flash('error', 'Error deleting bill: ' + error.message);
        res.redirect('/bills');  // Changed from edit redirect since bill might be deleted
    }
},

 

printBill: async (req, res, next) => {
    try {
        const billId = req.params.id;
        console.log('Print request for bill ID:', billId);
        
        // Get complete bill data with location details
        // Get complete bill data with location details
            const billData = await db.sequelize.query(`
                SELECT 
                    b.bill_id,
                    b.location_code,
                    b.bill_no,
                    b.bill_type,
                    b.bill_status,
                    b.print_count,
                    b.total_amount,
                    b.creation_date,                    
                     -- Location details WITH GST AND PHONE
                    l.location_name,
                    l.address as location_address,
                    l.gst_number as location_gst,
                    l.phone as location_phone,                    
                    -- Customer details (for credit bills)
                    CASE 
                        WHEN b.bill_type = 'CREDIT' THEN (
                            SELECT c.Company_Name 
                            FROM t_credits tc 
                            JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id 
                            WHERE tc.bill_id = b.bill_id 
                            LIMIT 1
                        )
                        WHEN b.bill_type = 'CASH' THEN COALESCE(b.customer_name, 'Cash Customer')    
                        ELSE 'Cash Customer'
                    END as customer_name,
                    
                    -- Vehicle information (from first item)
                    CASE 
                        WHEN b.bill_type = 'CREDIT' THEN (
                            SELECT CONCAT(v.vehicle_number, ' (', v.vehicle_type, ')')
                            FROM t_credits tc 
                            JOIN m_creditlist_vehicles v ON tc.vehicle_id = v.vehicle_id 
                            WHERE tc.bill_id = b.bill_id 
                            AND tc.vehicle_id IS NOT NULL
                            LIMIT 1
                        )
                        ELSE (
                            SELECT cs.vehicle_number
                            FROM t_cashsales cs 
                            WHERE cs.bill_id = b.bill_id 
                            AND cs.vehicle_number IS NOT NULL
                            AND cs.vehicle_number != ''
                            LIMIT 1
                        )
                    END as vehicle_info,
                    
                    -- Odometer reading (from first item)
                    COALESCE(
                        (SELECT tc.odometer_reading FROM t_credits tc WHERE tc.bill_id = b.bill_id AND tc.odometer_reading IS NOT NULL LIMIT 1),
                        (SELECT cs.odometer_reading FROM t_cashsales cs WHERE cs.bill_id = b.bill_id AND cs.odometer_reading IS NOT NULL LIMIT 1)
                    ) as odometer_reading,
                    
                    -- Cashier details
                    p.Person_Name as cashier_name
                    
                FROM t_bills b
                LEFT JOIN m_location l ON b.location_code = l.location_code
                LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
                LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
                WHERE b.bill_id = :billId
                AND b.location_code = :locationCode
            `, {
                replacements: { 
                    billId: billId,
                    locationCode: req.user.location_code 
                },
                type: Sequelize.QueryTypes.SELECT
            });

        if (!billData.length) {
            return res.status(404).send('Bill not found');
        }

        const bill = billData[0];
        console.log('Bill loaded:', bill.bill_no, bill.bill_type);

        // Get bill items based on bill type
        let billItems = [];
        
        if (bill.bill_type === 'CREDIT') {
                console.log('Loading credit bill items...');
                billItems = await db.sequelize.query(`
                    SELECT 
                        tc.product_id,
                        mp.product_name,
                        mp.unit,
                        tc.price,
                        COALESCE(tc.price_discount, 0) as discount,
                        tc.qty,
                        tc.amount,
                        COALESCE(tc.base_amount, tc.amount) as base_amount,
                        COALESCE(tc.cgst_percent, 0) as cgst_percent,
                        COALESCE(tc.sgst_percent, 0) as sgst_percent,
                        COALESCE(tc.cgst_amount, 0) as cgst_amount,
                        COALESCE(tc.sgst_amount, 0) as sgst_amount,
                        tc.notes,
                        tc.odometer_reading,
                        -- Vehicle information for credit bills
                        CASE 
                            WHEN tc.vehicle_id IS NOT NULL THEN 
                                CONCAT(v.vehicle_number, ' (', v.vehicle_type, ')')
                            ELSE NULL 
                        END as vehicle_info
                    FROM t_credits tc
                    JOIN m_product mp ON tc.product_id = mp.product_id
                    LEFT JOIN m_creditlist_vehicles v ON tc.vehicle_id = v.vehicle_id
                    WHERE tc.bill_id = :billId
                    ORDER BY tc.creation_date
                `, {
                    replacements: { billId: billId },
                    type: Sequelize.QueryTypes.SELECT
                });
        } else {
                console.log('Loading cash bill items...');
                billItems = await db.sequelize.query(`
                    SELECT 
                        tc.product_id,
                        mp.product_name,
                        mp.unit,
                        tc.price,
                        COALESCE(tc.price_discount, 0) as discount,
                        tc.qty,
                        tc.amount,
                        COALESCE(tc.base_amount, tc.amount) as base_amount,
                        COALESCE(tc.cgst_percent, 0) as cgst_percent,
                        COALESCE(tc.sgst_percent, 0) as sgst_percent,
                        COALESCE(tc.cgst_amount, 0) as cgst_amount,
                        COALESCE(tc.sgst_amount, 0) as sgst_amount,
                        tc.notes,
                        tc.vehicle_number,
                        tc.odometer_reading
                    FROM t_cashsales tc
                    JOIN m_product mp ON tc.product_id = mp.product_id
                    WHERE tc.bill_id = :billId
                    ORDER BY tc.creation_date
                `, {
                    replacements: { billId: billId },
                    type: Sequelize.QueryTypes.SELECT
                });
            }

        console.log('Items loaded:', billItems.length, 'items');

        // Calculate totals
        const subtotal = billItems.reduce((sum, item) => sum + parseFloat(item.base_amount || item.amount || 0), 0);
        const totalCgst = billItems.reduce((sum, item) => sum + parseFloat(item.cgst_amount || 0), 0);
        const totalSgst = billItems.reduce((sum, item) => sum + parseFloat(item.sgst_amount || 0), 0);
        const totalTax = totalCgst + totalSgst;
        const grandTotal = parseFloat(bill.total_amount || 0);

        console.log('Totals calculated:', { subtotal, totalCgst, totalSgst, grandTotal });

        // Increment print count (only when successfully printing)
        await db.sequelize.query(`
            UPDATE t_bills 
            SET print_count = print_count + 1,
                bill_status = 'ACTIVE',
                updation_date = NOW()
            WHERE bill_id = :billId
        `, {
            replacements: { billId: billId }
        });

        console.log('Print count updated');

        // Render the print template
        res.render('bills/print', {
            bill: bill,
            items: billItems,
            totals: {
                subtotal: subtotal,
                cgst: totalCgst,
                sgst: totalSgst,
                tax: totalTax,
                grandTotal: grandTotal
            },
            printDate: new Date(),
            user: req.user,
            layout: false // Don't use main layout for print
        });

    } catch (error) {
        console.error('Print bill error:', error);
        res.status(500).send(`
            <h2>Print Error</h2>
            <p><strong>Error:</strong> ${error.message}</p>
            <p><a href="/bills">← Back to Bills List</a></p>
        `);
    }
},

// Replace your PDF function with this bulletproof version

printBillPDF: async (req, res, next) => {
    const billId = req.params.id;
    let page = null;
    
    try {
        console.log('=== BULLETPROOF PDF START ===');
        console.log('Bill ID:', billId);
        
        // Get bill data (same as before)
        const billData = await db.sequelize.query(`
            SELECT 
                b.bill_id, b.location_code, b.bill_no, b.bill_type, b.bill_status,
                b.print_count, b.total_amount, b.creation_date,                
                l.location_name,
                l.address as location_address,
                l.gst_number as location_gst,
                l.phone as location_phone,
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT c.Company_Name 
                        FROM t_credits tc 
                        JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id 
                        WHERE tc.bill_id = b.bill_id 
                        LIMIT 1
                    )
                    WHEN b.bill_type = 'CASH' THEN COALESCE(b.customer_name, 'Cash Customer')    
                    ELSE 'Cash Customer'
                END as customer_name,
                p.Person_Name as cashier_name
            FROM t_bills b
            LEFT JOIN m_location l ON b.location_code = l.location_code
            LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
            LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
            WHERE b.bill_id = :billId AND b.location_code = :locationCode
        `, {
            replacements: { billId, locationCode: req.user.location_code },
            type: Sequelize.QueryTypes.SELECT
        });

        if (!billData.length) {
            return res.status(404).send('Bill not found');
        }

        const bill = billData[0];

        // Get items
        const itemTable = bill.bill_type === 'CREDIT' ? 't_credits' : 't_cashsales';
        const billItems = await db.sequelize.query(`
            SELECT 
                tc.product_id, mp.product_name, mp.unit, tc.price,
                COALESCE(tc.price_discount, 0) as discount, tc.qty, tc.amount,
                COALESCE(tc.base_amount, tc.amount) as base_amount,
                COALESCE(tc.cgst_amount, 0) as cgst_amount,
                COALESCE(tc.sgst_amount, 0) as sgst_amount,
                tc.notes
            FROM ${itemTable} tc
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tc.bill_id = :billId
            ORDER BY tc.creation_date
        `, {
            replacements: { billId },
            type: Sequelize.QueryTypes.SELECT
        });

        // Calculate totals
        const subtotal = billItems.reduce((sum, item) => sum + parseFloat(item.base_amount || item.amount || 0), 0);
        const totalCgst = billItems.reduce((sum, item) => sum + parseFloat(item.cgst_amount || 0), 0);
        const totalSgst = billItems.reduce((sum, item) => sum + parseFloat(item.sgst_amount || 0), 0);
        const grandTotal = parseFloat(bill.total_amount || 0);

        console.log('Data loaded. Items:', billItems.length, 'Total:', grandTotal);

        // Use simplified template
        const pug = require('pug');
        const path = require('path');
        
        // First try the simplified template
        let templatePath = path.join(__dirname, '..', 'views', 'bills', 'print-simple.pug');
        
        // Fallback to inline HTML if template missing
        let htmlContent;
        const fs = require('fs');
        
        if (fs.existsSync(templatePath)) {
            console.log('Using simplified template');
            htmlContent = pug.renderFile(templatePath, {
                bill, items: billItems,
                totals: { subtotal, cgst: totalCgst, sgst: totalSgst, grandTotal },
                printDate: new Date(), user: req.user
            });
        } else {
            console.log('Using inline HTML fallback');
            htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial; font-size: 10px; padding: 10px; }
                        table { width: 100%; border-collapse: collapse; }
                        th, td { border: 1px solid #000; padding: 3px; font-size: 9px; }
                        .header { text-align: center; font-size: 14px; font-weight: bold; margin-bottom: 10px; }
                        .total { font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="header">${bill.location_name || 'Petrol Pump'}</div>
                    <div>Bill: ${bill.bill_no} | Type: ${bill.bill_type} | Date: ${new Date(bill.creation_date).toLocaleDateString()}</div>
                    <div>Customer: ${bill.customer_name || 'Cash Customer'}</div>
                    <br>
                    <table>
                        <tr><th>Product</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
                        ${billItems.map(item => `
                            <tr>
                                <td>${item.product_name}</td>
                                <td>${parseFloat(item.qty).toFixed(2)} ${item.unit}</td>
                                <td>₹${parseFloat(item.price).toFixed(2)}</td>
                                <td>₹${parseFloat(item.amount).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </table>
                    <br>
                    <div class="total">GRAND TOTAL: ₹${grandTotal.toFixed(2)}</div>
                    <div>Thank you for your business!</div>
                </body>
                </html>
            `;
        }

        console.log('HTML generated, length:', htmlContent.length);

        // Generate PDF with minimal settings
        const { getBrowser } = require('../utils/browserHelper');
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // Set simple page settings
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle0',
            timeout: 15000
        });

        console.log('Content set, generating PDF...');

        // Simple PDF settings to avoid corruption
        const pdfBuffer = await page.pdf({
            width: '105mm',
            height: '148mm',
            margin: {
                top: '5mm',
                right: '5mm',
                bottom: '5mm',
                left: '5mm'
            },
            printBackground: true,
            preferCSSPageSize: false
        });

        await page.close();
        page = null;

        console.log('PDF generated successfully, size:', pdfBuffer.length);

        // Update print count
        await db.sequelize.query(`
            UPDATE t_bills SET print_count = print_count + 1, bill_status = 'ACTIVE', updation_date = NOW()
            WHERE bill_id = :billId
        `, { replacements: { billId } });

        // Send PDF with proper headers
        res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="Bill-${bill.bill_no}.pdf"`,
            'Content-Length': pdfBuffer.length,
            'Cache-Control': 'no-cache'
        });
        
        res.end(pdfBuffer, 'binary');

        console.log('=== PDF SENT SUCCESSFULLY ===');

    } catch (error) {
        console.error('PDF Error:', error);
        if (page) {
            try { await page.close(); } catch (e) { /* ignore */ }
        }
        res.status(500).send('PDF Error: ' + error.message);
    }
},


getBillsApi: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;
        
        // Optional query parameters for filtering
        const { fromDate, toDate, billType, billStatus } = req.query;

        // Build WHERE clause dynamically
        let whereConditions = ['b.location_code = :locationCode'];
        let replacements = { locationCode };

        if (fromDate) {
            whereConditions.push('DATE(b.creation_date) >= :fromDate');
            replacements.fromDate = fromDate;
        }

        if (toDate) {
            whereConditions.push('DATE(b.creation_date) <= :toDate');
            replacements.toDate = toDate;
        }

        if (billType) {
            whereConditions.push('b.bill_type = :billType');
            replacements.billType = billType;
        }

        if (billStatus) {
            whereConditions.push('b.bill_status = :billStatus');
            replacements.billStatus = billStatus;
        }

        const whereClause = whereConditions.join(' AND ');

        const bills = await db.sequelize.query(`
            SELECT 
                b.bill_id,
                b.bill_no,
                b.bill_type,
                b.bill_status,
                b.closing_id,
                b.total_amount,
                b.print_count,
                b.creation_date,
                b.created_by,
                
                -- Customer name (improved handling for both CREDIT and CASH)
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT DISTINCT c.Company_Name 
                        FROM t_credits tc 
                        JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id 
                        WHERE tc.bill_id = b.bill_id 
                        LIMIT 1
                    )
                    WHEN b.bill_type = 'CASH' THEN COALESCE(b.customer_name, 'Cash Customer')    
                    ELSE 'Cash Customer'
                END as customer_name,
                
                -- Vehicle information (from first item with vehicle info)
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT CONCAT(v.vehicle_number, ' (', v.vehicle_type, ')')
                        FROM t_credits tc 
                        JOIN m_creditlist_vehicles v ON tc.vehicle_id = v.vehicle_id 
                        WHERE tc.bill_id = b.bill_id 
                        AND tc.vehicle_id IS NOT NULL
                        LIMIT 1
                    )
                    ELSE (
                        SELECT cs.vehicle_number
                        FROM t_cashsales cs 
                        WHERE cs.bill_id = b.bill_id 
                        AND cs.vehicle_number IS NOT NULL
                        AND cs.vehicle_number != ''
                        LIMIT 1
                    )
                END as vehicle_info,
                
                -- Odometer reading (from first item with reading)
                COALESCE(
                    (SELECT tc.odometer_reading 
                     FROM t_credits tc 
                     WHERE tc.bill_id = b.bill_id 
                     AND tc.odometer_reading IS NOT NULL 
                     LIMIT 1),
                    (SELECT cs.odometer_reading 
                     FROM t_cashsales cs 
                     WHERE cs.bill_id = b.bill_id 
                     AND cs.odometer_reading IS NOT NULL 
                     LIMIT 1)
                ) as odometer_reading,
                
                -- Cashier details
                p.Person_Name as cashier_name,
                cl.creation_date as shift_date
                
            FROM t_bills b
            LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
            LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
            WHERE ${whereClause}
            ORDER BY b.creation_date DESC
        `, {
            replacements,
            type: Sequelize.QueryTypes.SELECT
        });

        res.status(200).json({
            success: true,
            count: bills.length,
            bills: bills,
            filters: {
                fromDate: fromDate || null,
                toDate: toDate || null,
                billType: billType || null,
                billStatus: billStatus || null
            }
        });

    } catch (error) {
        console.error("Error fetching bills:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch bills",
            error: error.message
        });
    }
},

// getNewBillApi: async (req, res, next) => {
//     try {
//         const locationCode = req.user.location_code;

//         if (!locationCode) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Location code missing in token"
//             });
//         }

//         // Get active shifts with cashier name
//         const activeShifts = await db.sequelize.query(`
//             SELECT c.closing_id, c.creation_date, c.cashier_id,
//                    p.Person_Name as cashier_name
//             FROM t_closing c
//             LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
//             WHERE c.location_code = :locationCode 
//             AND c.closing_status != 'CLOSED'
//             ORDER BY c.creation_date DESC
//         `, {
//             replacements: { locationCode },
//             type: Sequelize.QueryTypes.SELECT
//         });

//         // Get products for the location
//         const products = await ProductDao.findProducts(locationCode);

//         // Get credit customers for the location
//         const credits = await CreditDao.findCredits(locationCode);

//         // Return JSON response
//         res.status(200).json({
//             success: true,
//             locationCode,
//             shifts: activeShifts,
//             products,
//             credits
//         });

//     } catch (error) {
//         console.error(error);
//         res.status(203).json({
//             success: false,
//         });
//     }
// },



getNewBillApi: async (req, res, next) => {
    try {
        const locationCode = req.user.location_code;

        if (!locationCode) {
            return res.status(400).json({
                success: false,
                message: "Location code missing in token"
            });
        }

        // 1. Get active shifts with cashier name
        const activeShifts = await db.sequelize.query(`
            SELECT c.closing_id, c.creation_date, c.cashier_id,
                   p.Person_Name as cashier_name,
                   DATE_FORMAT(c.creation_date, '%Y-%m-%d %H:%i') as shift_date
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            WHERE c.location_code = :locationCode 
            AND c.closing_status != 'CLOSED'
            ORDER BY c.creation_date DESC
        `, {
            replacements: { locationCode },
            type: Sequelize.QueryTypes.SELECT
        });

        // 2. Get products for the location
        const products = await ProductDao.findProducts(locationCode);

        // 3. Get credit customers for the location (exclude digital-only)
        const credits = await CreditDao.findCredits(locationCode);

        // 4. Get ALL vehicles for the location (grouped by customer)
        const vehicleData = await CreditVehicleDao.findAllVehiclesForLocation(locationCode);

        // 5. Group vehicles by creditlist_id for easier Flutter consumption
        const vehiclesByCredit = {};
        vehicleData.forEach(vehicle => {
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

        // Return JSON response with all data needed to create a bill
        return res.status(200).json({
            success: true,
            locationCode: locationCode,
            shifts: activeShifts,
            products: products,
            credits: credits,
            vehiclesByCredit: vehiclesByCredit,  // ← NEW: Vehicles grouped by customer
            meta: {
                totalShifts: activeShifts.length,
                totalProducts: products.length,
                totalCustomers: credits.length,
                totalVehicles: vehicleData.length
            }
        });

    } catch (error) {
        console.error("Error in getNewBillApi:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bill requirements",
            error: error.message
        });
    }
},


// NEW METHOD: getBillDetailsApi
// Add this to bill-controller.js in module.exports

getBillDetailsApi: async (req, res, next) => {
    try {
        const billId = req.params.billId;
        const locationCode = req.user.location_code;

        if (!billId) {
            return res.status(400).json({
                success: false,
                message: "Bill ID is required"
            });
        }

        // 1. Get bill header information
        const billData = await db.sequelize.query(`
            SELECT 
                b.bill_id,
                b.bill_no,
                b.bill_type,
                b.bill_status,
                b.closing_id,
                b.total_amount,
                b.print_count,
                b.creation_date,
                b.created_by,
                b.updation_date,
                b.updated_by,
                
                -- Customer information
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT DISTINCT c.Company_Name 
                        FROM t_credits tc 
                        JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id 
                        WHERE tc.bill_id = b.bill_id 
                        LIMIT 1
                    )
                    WHEN b.bill_type = 'CASH' THEN COALESCE(b.customer_name, 'Cash Customer')    
                    ELSE 'Cash Customer'
                END as customer_name,
                
                -- Credit customer ID (for credit bills)
                (
                    SELECT DISTINCT tc.creditlist_id
                    FROM t_credits tc 
                    WHERE tc.bill_id = b.bill_id 
                    LIMIT 1
                ) as creditlist_id,
                
                -- Vehicle information
                CASE 
                    WHEN b.bill_type = 'CREDIT' THEN (
                        SELECT CONCAT(v.vehicle_number, ' (', v.vehicle_type, ')')
                        FROM t_credits tc 
                        JOIN m_creditlist_vehicles v ON tc.vehicle_id = v.vehicle_id 
                        WHERE tc.bill_id = b.bill_id 
                        AND tc.vehicle_id IS NOT NULL
                        LIMIT 1
                    )
                    ELSE (
                        SELECT cs.vehicle_number
                        FROM t_cashsales cs 
                        WHERE cs.bill_id = b.bill_id 
                        AND cs.vehicle_number IS NOT NULL
                        AND cs.vehicle_number != ''
                        LIMIT 1
                    )
                END as vehicle_info,
                
                -- Vehicle ID (for credit bills)
                (
                    SELECT tc.vehicle_id
                    FROM t_credits tc 
                    WHERE tc.bill_id = b.bill_id 
                    AND tc.vehicle_id IS NOT NULL
                    LIMIT 1
                ) as vehicle_id,
                
                -- Odometer reading
                COALESCE(
                    (SELECT tc.odometer_reading 
                     FROM t_credits tc 
                     WHERE tc.bill_id = b.bill_id 
                     AND tc.odometer_reading IS NOT NULL 
                     LIMIT 1),
                    (SELECT cs.odometer_reading 
                     FROM t_cashsales cs 
                     WHERE cs.bill_id = b.bill_id 
                     AND cs.odometer_reading IS NOT NULL 
                     LIMIT 1)
                ) as odometer_reading,
                
                -- Cashier details
                p.Person_Name as cashier_name,
                cl.creation_date as shift_date
                
            FROM t_bills b
            LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
            LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
            WHERE b.bill_id = :billId
            AND b.location_code = :locationCode
        `, {
            replacements: { billId, locationCode },
            type: Sequelize.QueryTypes.SELECT
        });

        if (!billData.length) {
            return res.status(404).json({
                success: false,
                message: "Bill not found or does not belong to this location"
            });
        }

        const bill = billData[0];

        // 2. Get bill items (line items) based on bill type
        let billItems = [];
        
        if (bill.bill_type === 'CREDIT') {
            billItems = await db.sequelize.query(`
                SELECT 
                    tc.product_id,
                    mp.product_name,
                    mp.unit,
                    tc.price,
                    COALESCE(tc.price_discount, 0) as price_discount,
                    tc.qty,
                    tc.amount,
                    COALESCE(tc.base_amount, tc.amount) as base_amount,
                    COALESCE(tc.cgst_percent, 0) as cgst_percent,
                    COALESCE(tc.sgst_percent, 0) as sgst_percent,
                    COALESCE(tc.cgst_amount, 0) as cgst_amount,
                    COALESCE(tc.sgst_amount, 0) as sgst_amount,
                    tc.notes,
                    tc.odometer_reading,
                    tc.vehicle_id,
                    CASE 
                        WHEN tc.vehicle_id IS NOT NULL THEN 
                            CONCAT(v.vehicle_number, ' (', v.vehicle_type, ')')
                        ELSE NULL 
                    END as vehicle_info
                FROM t_credits tc
                JOIN m_product mp ON tc.product_id = mp.product_id
                LEFT JOIN m_creditlist_vehicles v ON tc.vehicle_id = v.vehicle_id
                WHERE tc.bill_id = :billId
                ORDER BY tc.creation_date
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
        } else {
            // CASH bill
            billItems = await db.sequelize.query(`
                SELECT 
                    cs.product_id,
                    mp.product_name,
                    mp.unit,
                    cs.price,
                    COALESCE(cs.price_discount, 0) as price_discount,
                    cs.qty,
                    cs.amount,
                    COALESCE(cs.base_amount, cs.amount) as base_amount,
                    COALESCE(cs.cgst_percent, 0) as cgst_percent,
                    COALESCE(cs.sgst_percent, 0) as sgst_percent,
                    COALESCE(cs.cgst_amount, 0) as cgst_amount,
                    COALESCE(cs.sgst_amount, 0) as sgst_amount,
                    cs.notes,
                    cs.odometer_reading,
                    cs.vehicle_number as vehicle_info
                FROM t_cashsales cs
                JOIN m_product mp ON cs.product_id = mp.product_id
                WHERE cs.bill_id = :billId
                ORDER BY cs.creation_date
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
        }

        // 3. Calculate totals
        const summary = {
            subtotal: 0,
            totalDiscount: 0,
            totalCGST: 0,
            totalSGST: 0,
            totalTax: 0,
            grandTotal: bill.total_amount,
            itemCount: billItems.length
        };

        billItems.forEach(item => {
            const itemSubtotal = parseFloat(item.price) * parseFloat(item.qty);
            summary.subtotal += itemSubtotal;
            summary.totalDiscount += parseFloat(item.price_discount || 0);
            summary.totalCGST += parseFloat(item.cgst_amount || 0);
            summary.totalSGST += parseFloat(item.sgst_amount || 0);
        });

        summary.totalTax = summary.totalCGST + summary.totalSGST;

        // 4. Return complete bill details
        return res.status(200).json({
            success: true,
            bill: {
                // Header info
                billId: bill.bill_id,
                billNo: bill.bill_no,
                billType: bill.bill_type,
                billStatus: bill.bill_status,
                closingId: bill.closing_id,
                
                // Customer info
                customerName: bill.customer_name,
                creditlistId: bill.creditlist_id,
                
                // Vehicle info
                vehicleInfo: bill.vehicle_info,
                vehicleId: bill.vehicle_id,
                odometerReading: bill.odometer_reading,
                
                // Amounts
                totalAmount: parseFloat(bill.total_amount),
                
                // Dates and audit
                createdDate: bill.creation_date,
                createdBy: bill.created_by,
                updatedDate: bill.updation_date,
                updatedBy: bill.updated_by,
                printCount: bill.print_count,
                
                // Cashier info
                cashierName: bill.cashier_name,
                shiftDate: bill.shift_date
            },
            items: billItems.map(item => ({
                productId: item.product_id,
                productName: item.product_name,
                unit: item.unit,
                price: parseFloat(item.price),
                discount: parseFloat(item.price_discount),
                qty: parseFloat(item.qty),
                amount: parseFloat(item.amount),
                baseAmount: parseFloat(item.base_amount),
                cgstPercent: parseFloat(item.cgst_percent),
                sgstPercent: parseFloat(item.sgst_percent),
                cgstAmount: parseFloat(item.cgst_amount),
                sgstAmount: parseFloat(item.sgst_amount),
                notes: item.notes,
                odometerReading: item.odometer_reading,
                vehicleInfo: item.vehicle_info,
                vehicleId: item.vehicle_id
            })),
            summary: summary
        });

    } catch (error) {
        console.error("Error in getBillDetailsApi:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch bill details",
            error: error.message
        });
    }
},



// UPDATED createBillApi - Replace in bill-controller.js
// This version includes ALL validations from the web version

createBillApi: async (req, res, next) => {
    const transaction = await db.sequelize.transaction();

    try {
        const locationCode = req.user.location_code;
        
        // 1. Validate bill items FIRST
        const validation = await validateBillItems(req.body.items, locationCode);
        if (!validation.valid) {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: 'Bill validation failed',
                errors: validation.errors
            });
        }

        // 2. Validate shift status
        await validateShiftForBillOperation(req.body.closing_id, locationCode, 'create');

        // 3. Validate pump readings for fuel products
        await validateProductPumpReadings(locationCode, req.body.closing_id, req.body.items);

        // 4. Generate next bill number using BillNumberingService
        const nextBillNo = await BillNumberingService.generateNextBillNumber(
            locationCode, 
            req.body.bill_type
        );

        // 5. Calculate total amount
        let totalAmount = 0;
        req.body.items.forEach(item => {
            if (item.product_id) {
                totalAmount += parseFloat(item.amount || 0);
            }
        });

        // 6. Prepare customer name (for cash bills)
        const customerName = req.body.bill_type === 'CASH' 
            ? (req.body.customer_name || req.body.customer_name_mobile || null) 
            : null;

        // 7. Create bill header
        const [billResult] = await db.sequelize.query(`
            INSERT INTO t_bills (
                location_code, bill_no, bill_type, closing_id,
                customer_name, total_amount, created_by, creation_date
            ) VALUES (
                :locationCode, :billNo, :billType, :closingId,
                :customerName, :totalAmount, :createdBy, NOW()
            )
        `, {
            replacements: {
                locationCode: locationCode,
                billNo: nextBillNo,
                billType: req.body.bill_type,
                closingId: req.body.closing_id,
                customerName: customerName,
                totalAmount: totalAmount,
                createdBy: req.user.person_id
            },
            type: Sequelize.QueryTypes.INSERT,
            transaction
        });

        const billId = billResult;

        // 8. Insert bill items based on bill type
        for (const item of req.body.items) {
            if (!item.product_id) continue; // Skip empty rows

            if (req.body.bill_type === 'CREDIT') {
                // Insert into t_credits
                await db.sequelize.query(`
                    INSERT INTO t_credits (
                        closing_id, bill_no, bill_id, creditlist_id, vehicle_id,
                        product_id, price, price_discount, qty, amount,
                        base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                        notes, odometer_reading, created_by, creation_date
                    ) VALUES (
                        :closingId, :billNo, :billId, :creditlistId, :vehicleId,
                        :productId, :price, :priceDiscount, :qty, :amount,
                        :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                        :notes, :odometerReading, :createdBy, NOW()
                    )
                `, {
                    replacements: {
                        closingId: req.body.closing_id,
                        billNo: nextBillNo,
                        billId: billId,
                        creditlistId: req.body.creditlist_id || req.body.creditlist_id_mobile,
                        vehicleId: req.body.bill_vehicle_id || req.body.bill_vehicle_id_mobile || null,
                        productId: parseInt(item.product_id),
                        price: parseFloat(item.price),
                        priceDiscount: parseFloat(item.price_discount || 0),
                        qty: parseFloat(item.qty),
                        amount: parseFloat(item.amount),
                        baseAmount: parseFloat(item.base_amount || item.amount),
                        cgstPercent: parseFloat(item.cgst_percent || 0),
                        sgstPercent: parseFloat(item.sgst_percent || 0),
                        cgstAmount: parseFloat(item.cgst_amount || 0),
                        sgstAmount: parseFloat(item.sgst_amount || 0),
                        notes: item.notes || '',
                        odometerReading: parseFloat(req.body.bill_odometer_reading || req.body.bill_odometer_reading_mobile || 0) || null,
                        createdBy: req.user.person_id
                    },
                    type: Sequelize.QueryTypes.INSERT,
                    transaction
                });
            } else {
                // Insert into t_cashsales
                await db.sequelize.query(`
                    INSERT INTO t_cashsales (
                        closing_id, bill_no, bill_id, customer_name,
                        product_id, price, price_discount, qty, amount,
                        base_amount, cgst_percent, sgst_percent, cgst_amount, sgst_amount,
                        notes, vehicle_number, odometer_reading, created_by, creation_date
                    ) VALUES (
                        :closingId, :billNo, :billId, :customerName,
                        :productId, :price, :priceDiscount, :qty, :amount,
                        :baseAmount, :cgstPercent, :sgstPercent, :cgstAmount, :sgstAmount,
                        :notes, :vehicleNumber, :odometerReading, :createdBy, NOW()
                    )
                `, {
                    replacements: {
                        closingId: req.body.closing_id,
                        billNo: nextBillNo,
                        billId: billId,
                        customerName: customerName,
                        productId: parseInt(item.product_id),
                        price: parseFloat(item.price),
                        priceDiscount: parseFloat(item.price_discount || 0),
                        qty: parseFloat(item.qty),
                        amount: parseFloat(item.amount),
                        baseAmount: parseFloat(item.base_amount || item.amount),
                        cgstPercent: parseFloat(item.cgst_percent || 0),
                        sgstPercent: parseFloat(item.sgst_percent || 0),
                        cgstAmount: parseFloat(item.cgst_amount || 0),
                        sgstAmount: parseFloat(item.sgst_amount || 0),
                        notes: item.notes || '',
                        vehicleNumber: req.body.bill_vehicle_number || req.body.bill_vehicle_number_mobile || null,
                        odometerReading: parseFloat(req.body.bill_odometer_reading || req.body.bill_odometer_reading_mobile || 0) || null,
                        createdBy: req.user.person_id
                    },
                    type: Sequelize.QueryTypes.INSERT,
                    transaction
                });
            }
        }

        await transaction.commit();

        return res.status(201).json({
            success: true,
            message: `Bill ${nextBillNo} created successfully`,
            billNo: nextBillNo,
            billId: billId,
            totalAmount: totalAmount
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Bill creation error:', error);

        // Friendly error messages
        let errorMessage = 'Error creating bill';
        if (error.message.includes('Shift')) {
            errorMessage = error.message;
        } else if (error.message.includes('pump readings')) {
            errorMessage = error.message;
        } else if (error.message.includes('validation')) {
            errorMessage = 'Invalid bill data';
        }

        return res.status(500).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
},

// NEW METHOD: deleteBillApi
// Add this to bill-controller.js in module.exports

deleteBillApi: async (req, res, next) => {
    const transaction = await db.sequelize.transaction();
    
    try {
        const billId = req.params.billId;
        const locationCode = req.user.location_code;

        if (!billId) {
            return res.status(400).json({
                success: false,
                message: "Bill ID is required"
            });
        }

        // 1. Get bill info and validate it belongs to this location
        const bill = await db.sequelize.query(`
            SELECT bill_id, bill_no, bill_type, closing_id, bill_status
            FROM t_bills 
            WHERE bill_id = :billId 
            AND location_code = :locationCode
        `, {
            replacements: { 
                billId,
                locationCode 
            },
            type: Sequelize.QueryTypes.SELECT,
            transaction
        });

        if (!bill.length) {
            await transaction.rollback();
            return res.status(404).json({
                success: false,
                message: 'Bill not found or does not belong to this location'
            });
        }

        const billInfo = bill[0];

        // 2. Only allow deletion of DRAFT bills (optional - remove if you want to allow all)
        // Uncomment if you want to restrict deletion to DRAFT bills only
        /*
        if (billInfo.bill_status !== 'DRAFT') {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot delete ${billInfo.bill_status} bills. Only DRAFT bills can be deleted.`
            });
        }
        */

        // 3. Validate shift status before deletion (CRITICAL - prevents deletion on closed shifts)
        await validateShiftForBillOperation(
            billInfo.closing_id, 
            locationCode, 
            'delete'
        );

        // 4. Delete bill items based on bill type
        if (billInfo.bill_type === 'CREDIT') {
            await db.sequelize.query(`
                DELETE FROM t_credits 
                WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.DELETE,
                transaction
            });
        } else {
            await db.sequelize.query(`
                DELETE FROM t_cashsales 
                WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.DELETE,
                transaction
            });
        }

        // 5. Delete bill header
        await db.sequelize.query(`
            DELETE FROM t_bills 
            WHERE bill_id = :billId
        `, {
            replacements: { billId },
            type: Sequelize.QueryTypes.DELETE,
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            success: true,
            message: `Bill ${billInfo.bill_no} deleted successfully`,
            deletedBillNo: billInfo.bill_no,
            deletedBillId: billId
        });

    } catch (error) {
        await transaction.rollback();
        console.error('Bill deletion error:', error);

        // Friendly error messages
        let errorMessage = 'Error deleting bill';
        let statusCode = 500;

        if (error.message.includes('Shift')) {
            // Shift-related errors (closed shift, etc.)
            errorMessage = error.message;
            statusCode = 400;
        } else if (error.message.includes('not found')) {
            errorMessage = error.message;
            statusCode = 404;
        }

        return res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
},


    
};


const validateBillItems = async (items, locationCode) => {
    const errors = [];
    
    if (!items || items.length === 0) {
        errors.push('At least one item is required');
        return { valid: false, errors };
    }
    
    // Get products with units for validation
    const products = await db.sequelize.query(`
        SELECT product_id, product_name, unit, price, cgst_percent, sgst_percent
        FROM m_product 
        WHERE location_code = :locationCode
    `, {
        replacements: { locationCode },
        type: Sequelize.QueryTypes.SELECT
    });
    
    const productMap = {};
    products.forEach(p => {
        productMap[p.product_id] = p;
    });
    
    let hasValidItems = false;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const product = productMap[item.product_id];
        
        if (!item.product_id) {
            continue; // Skip empty rows
        }
        
        if (!product) {
            errors.push(`Invalid product selected in row ${i + 1}`);
            continue;
        }
        
        // Validate quantity
        const qty = parseFloat(item.qty || 0);
        if (qty <= 0) {
            errors.push(`Quantity must be greater than 0 for ${product.product_name}`);
            continue;
        }
        
        // Validate unit-based products (whole numbers only)
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        if (unitBasedProducts.includes(product.unit.toUpperCase()) && qty % 1 !== 0) {
            errors.push(`${product.product_name} must be sold in whole units only`);
            continue;
        }
        
        // Validate price
        const price = parseFloat(item.price || 0);
        if (price <= 0) {
            errors.push(`Price must be greater than 0 for ${product.product_name}`);
            continue;
        }
        
        // Validate discount
        const discount = parseFloat(item.price_discount || 0);
        const lineTotal = price * qty;
        if (discount < 0) {
            errors.push(`Discount cannot be negative for ${product.product_name}`);
            continue;
        }
        if (discount >= lineTotal) {
            errors.push(`Discount cannot be equal to or greater than line total for ${product.product_name}`);
            continue;
        }
        
        // Validate final amount
        const amount = parseFloat(item.amount || 0);
        if (amount <= 0) {
            errors.push(`Final amount must be greater than 0 for ${product.product_name}`);
            continue;
        }
        
        // Validate tax calculations (optional - ensures data integrity)
        const afterDiscount = lineTotal - discount;
        const totalTaxPercent = (product.cgst_percent || 0) + (product.sgst_percent || 0);
        const expectedBaseAmount = totalTaxPercent > 0 ? afterDiscount / (1 + totalTaxPercent / 100) : afterDiscount;
        const expectedAmount = Math.round(afterDiscount * 100) / 100; // Round to 2 decimal places
        
        if (Math.abs(amount - expectedAmount) > 0.10) { // Allow small rounding differences
            errors.push(`Amount calculation error for ${product.product_name}`);
            continue;
        }
        
        hasValidItems = true;
    }
    
    if (!hasValidItems) {
        errors.push('At least one valid item is required');
    }
    
    return { valid: errors.length === 0, errors };
};

// Add this before the main module.exports
const validateShiftForBillOperation = async (closingId, locationCode, operation) => {
    // Check if shift exists and get its status
    const shift = await db.sequelize.query(`
        SELECT closing_status, closing_date, cashier_id
        FROM t_closing 
        WHERE closing_id = :closingId
        AND location_code = :locationCode
    `, {
        replacements: { closingId, locationCode },
        type: Sequelize.QueryTypes.SELECT
    });

    if (!shift.length) {
        throw new Error(`Cannot ${operation} bill: Shift ${closingId} not found or does not belong to this location`);
    }

    if (shift[0].closing_status === 'CLOSED') {
        const closedDate = new Date(shift[0].closing_date).toLocaleDateString('en-IN');
        throw new Error(`Cannot ${operation} bills for closed shift (${closingId}). Shift was closed on ${closedDate}`);
    }

    return shift[0];
};

const validateProductPumpReadings = async (locationCode, closingId, items) => {
    for (const item of items) {
        if (!item.product_id) continue;

        // Check if this product has any pumps configured
        const productHasPumps = await db.sequelize.query(`
            SELECT COUNT(*) as pump_count
            FROM m_pump p
            JOIN m_product prod ON p.product_code = prod.product_name
            WHERE prod.product_id = :productId
            AND p.location_code = :locationCode
        `, {
            replacements: { 
                productId: item.product_id,
                locationCode 
            },
            type: Sequelize.QueryTypes.SELECT
        });

        // Only validate pump readings for products that have pumps
        if (productHasPumps[0].pump_count > 0) {
            const pumpReadings = await db.sequelize.query(`
                SELECT COUNT(*) as reading_count
                FROM t_reading tr
                JOIN m_pump p ON tr.pump_id = p.pump_id
                JOIN m_product prod ON p.product_code = prod.product_name
                WHERE tr.closing_id = :closingId 
                AND prod.product_id = :productId
                AND p.location_code = :locationCode
            `, {
                replacements: {
                    closingId,
                    productId: item.product_id,
                    locationCode
                },
                type: Sequelize.QueryTypes.SELECT
            });

            if (pumpReadings[0].reading_count === 0) {
                const product = await db.sequelize.query(`
                    SELECT product_name FROM m_product WHERE product_id = :productId
                `, {
                    replacements: { productId: item.product_id },
                    type: Sequelize.QueryTypes.SELECT
                });

                throw new Error(`No pump readings found for ${product[0].product_name} in this shift. Cannot create bill as this will affect closing calculations.`);
            }
        }
        // Products without pumps (retail items) pass validation automatically
    }
};