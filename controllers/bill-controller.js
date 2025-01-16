// controllers/bill-controller.js
const db = require("../db/db-connection");
const ProductDao = require("../dao/product-dao");
const CreditDao = require("../dao/credits-dao");
const utils = require("../utils/app-utils");
const msg = require("../config/app-messages");
const Sequelize = require('sequelize');

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
            // Get products for the location
            const products = await ProductDao.findProducts(req.user.location_code);


            // Get credit customers for the location
            const credits = await CreditDao.findCredits(req.user.location_code);

            res.render('bills/create', {
                title: 'Create New Bill',
                user: req.user,
                shifts: activeShifts,
                products: products,
                credits: credits,
                messages: req.flash()
            });
        } catch (error) {
            next(error);
        }
    },

 // In bill-controller.js, update the createBill method:

// In bill-controller.js, update the createBill method:

    createBill: async (req, res, next) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            // First validate closing status
            const closing = await db.sequelize.query(`
                SELECT closing_status 
                FROM t_closing 
                WHERE closing_id = :closingId
                AND location_code = :locationCode
            `, {
                replacements: { 
                    closingId: req.body.closing_id,
                    locationCode: req.user.location_code 
                },
                type: Sequelize.QueryTypes.SELECT
            });

            if (!closing.length || closing[0].closing_status === 'CLOSED') {
                req.flash('error', 'Cannot create bills for closed or invalid shifts');
                return res.redirect('/bills/new');
            }

            
            // Get next bill number based on bill type
            const maxBillResult = await db.sequelize.query(`
                SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no, 4) AS UNSIGNED)), 0) as max_bill 
                FROM t_bills 
                WHERE location_code = :locationCode
                AND bill_no LIKE :prefix
            `, {
                replacements: { 
                    locationCode: req.user.location_code,
                    prefix: req.body.bill_type === 'CREDIT' ? 'CR/%' : 'CS/%'
                },
                type: Sequelize.QueryTypes.SELECT
            });
            
            const nextNumber = maxBillResult[0].max_bill + 1;
            const prefix = req.body.bill_type === 'CREDIT' ? 'CR/' : 'CS/';
            // Pad the number with leading zeros to ensure proper sorting
            const paddedNumber = String(nextNumber).padStart(6, '0');
            const nextBillNo = `${prefix}${paddedNumber}`;

            // Create bill
            const [billResult] = await db.sequelize.query(`
                INSERT INTO t_bills (
                    location_code, bill_no, bill_type, closing_id,
                    total_amount, created_by, creation_date
                ) VALUES (
                    :locationCode, :billNo, :billType, :closingId,
                    :totalAmount, :createdBy, NOW()
                )
            `, {
                replacements: {
                    locationCode: req.user.location_code,
                    billNo: nextBillNo,
                    billType: req.body.bill_type,
                    closingId: req.body.closing_id,
                    totalAmount: req.body.items.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0),
                    createdBy: req.user.Person_id
                },
                type: Sequelize.QueryTypes.INSERT,
                transaction
            });

            const billId = billResult;

            // Create bill items
            for (const item of req.body.items) {
                if (req.body.bill_type === 'CREDIT') {
                    await db.sequelize.query(`
                        INSERT INTO t_credits (
                            closing_id, bill_no, bill_id, creditlist_id,
                            product_id, price, price_discount, qty, amount,
                            notes, created_by, creation_date
                        ) VALUES (
                            :closingId, :billNo, :billId, :creditlistId,
                            :productId, :price, :discount, :qty, :amount,
                            :notes, :createdBy, NOW()
                        )
                    `, {
                        replacements: {
                            closingId: req.body.closing_id,
                            billNo: nextBillNo,
                            billId: billId,
                            creditlistId: req.body.creditlist_id,
                            productId: parseInt(item.product_id),
                            price: parseFloat(item.price),
                            discount: parseFloat(item.price_discount || 0),
                            qty: parseFloat(item.qty),
                            amount: parseFloat(item.amount),
                            notes: item.notes || '',  // Add default empty string for notes
                            createdBy: req.user.Person_id
                        },
                        type: Sequelize.QueryTypes.INSERT,
                        transaction
                    });
                } else {
                    await db.sequelize.query(`
                        INSERT INTO t_cashsales (
                            closing_id, bill_no, bill_id,
                            product_id, price, price_discount, qty, amount,
                            notes, created_by, creation_date
                        ) VALUES (
                            :closingId, :billNo, :billId,
                            :productId, :price, :discount, :qty, :amount,
                            :notes, :createdBy, NOW()
                        )
                    `, {
                        replacements: {
                            closingId: req.body.closing_id,
                            billNo: nextBillNo,
                            billId: billId,
                            productId: parseInt(item.product_id),
                            price: parseFloat(item.price),
                            discount: parseFloat(item.price_discount || 0),
                            qty: parseFloat(item.qty),
                            amount: parseFloat(item.amount),
                            notes: item.notes || '',  // Add default empty string for notes
                            createdBy: req.user.Person_id
                        },
                        type: Sequelize.QueryTypes.INSERT,
                        transaction
                    });
                }
            }

            await transaction.commit();
            req.flash('success', `Bill ${nextBillNo} created successfully`);
            res.redirect('/bills');
        } catch (error) {
            await transaction.rollback();
            console.error('Bill creation error details:', {
                error: error.message,
                items: req.body.items,
                billType: req.body.bill_type
            });
            req.flash('error', 'Error creating bill: ' + error.message);
            res.redirect('/bills/new');
        }
    },

    getBills: async (req, res, next) => {
        try {
            const bills = await db.sequelize.query(`
                SELECT b.*, 
                    CASE 
                        WHEN b.bill_type = 'CREDIT' THEN c.Company_Name
                        ELSE NULL
                    END as customer_name,
                    p.Person_Name as cashier_name
                FROM t_bills b
                LEFT JOIN t_credits tc ON b.bill_id = tc.bill_id
                LEFT JOIN m_credit_list c ON tc.creditlist_id = c.creditlist_id
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
            const credits = await CreditDao.findCredits(req.user.location_code);

            console.log('Bill details:', {
                bill_type: bill[0].bill_type,
                creditlist_id: bill[0].creditlist_id
            });
            
            console.log('Credits:', credits.map(c => ({
                creditlist_id: c.creditlist_id,
                Company_Name: c.Company_Name
            })));
    
            res.render('bills/edit', {  // Change this to 'bills/edit'
                title: 'Edit Bill',
                user: req.user,
                bill: bill[0],
                items: billItems,
                shifts: activeShifts,  // Add this
                products: products,
                credits: credits,
                messages: req.flash()
            });
        } catch (error) {
            next(error);
        }
    },

    updateBill: async (req, res, next) => {
        const transaction = await db.sequelize.transaction();
    
        try {
            const billId = req.params.billId;
    
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

                    // Ensure bill type hasn't been tampered with
                if (req.body.bill_type !== bill[0].bill_type) {
                    req.flash('error', 'Bill type cannot be changed');
                    return res.redirect(`/bills/edit/${billId}`);
                }

                // For credit bills, ensure customer is selected
                if (bill[0].bill_type === 'CREDIT' && !req.body.creditlist_id) {
                    req.flash('error', 'Customer is required for credit bills');
                    return res.redirect(`/bills/edit/${billId}`);
                }
            
            // Update bill header first if bill type is changing
            if (req.body.bill_type !== bill[0].bill_type) {
                await db.sequelize.query(`
                    UPDATE t_bills 
                    SET bill_type = :billType,
                        updated_by = :updatedBy,
                        updation_date = NOW()
                    WHERE bill_id = :billId
                `, {
                    replacements: {
                        billType: req.body.bill_type,
                        updatedBy: req.user.Person_id,
                        billId
                    },
                    type: Sequelize.QueryTypes.UPDATE,
                    transaction
                });
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
    
            // Update bill total amount and closing_id
            await db.sequelize.query(`
                UPDATE t_bills 
                SET closing_id = :closingId,
                    total_amount = :totalAmount,
                    updated_by = :updatedBy,
                    updation_date = NOW()
                WHERE bill_id = :billId
            `, {
                replacements: {
                    closingId: req.body.closing_id,
                    totalAmount,
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
                        closing_id, bill_no, bill_id, creditlist_id,
                        product_id, price, price_discount, qty, amount,
                        notes, created_by, creation_date
                    ) VALUES (
                        :closingId, :billNo, :billId, :creditlistId,
                        :productId, :price, :discount, :qty, :amount,
                        :notes, :createdBy, NOW()
                    )`
                    : `INSERT INTO t_cashsales (
                        closing_id, bill_no, bill_id,
                        product_id, price, price_discount, qty, amount,
                        notes, created_by, creation_date
                    ) VALUES (
                        :closingId, :billNo, :billId,
                        :productId, :price, :discount, :qty, :amount,
                        :notes, :createdBy, NOW()
                    )`;
    
                await db.sequelize.query(insertQuery, {
                    replacements: {
                        closingId: req.body.closing_id,
                        billNo: bill[0].bill_no,
                        billId: billId,
                        creditlistId: req.body.bill_type === 'CREDIT' ? req.body.creditlist_id : null,
                        productId: parseInt(item.product_id),
                        price: parseFloat(item.price),
                        discount: parseFloat(item.price_discount || 0),
                        qty: parseFloat(item.qty),
                        amount: parseFloat(item.amount),
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
    
            // Determine bill type
            const billType = await db.sequelize.query(`
                SELECT bill_type 
                FROM t_bills 
                WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
            // Delete bill items based on bill type
            const deleteItemsQuery = billType[0].bill_type === 'CREDIT'
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
            res.redirect(`/bills/edit/${req.params.billId}`);
        }
    },
    
};