// controllers/bill-controller.js
const db = require("../db/db-connection");
const ProductDao = require("../dao/product-dao");
const utils = require("../utils/app-utils");
const msg = require("../config/app-messages");
const Sequelize = require('sequelize');

module.exports = {
    getNewBill: async (req, res, next,billType) => {
        try {

            // First check for draft bills
            const draftBills = await db.sequelize.query(`
                SELECT COUNT(*) as draft_count
                FROM t_bills 
                WHERE location_code = :locationCode 
                AND bill_status = 'DRAFT'
            `, {
                replacements: { locationCode: req.user.location_code },
                type: Sequelize.QueryTypes.SELECT
            });

            if (draftBills[0].draft_count > 0) {
                req.flash('error', `There are draft bills pending. Please complete or delete existing draft bills before creating a new one.
                    புதிய பில் உருவாக்குவதற்கு முன், நிலுவையில் உள்ள பில்களை முடிக்கவும் அல்லது நீக்கவும்`);
                return res.redirect('/bills');
            }

         // Get active shifts - Add cashier restriction

            let shiftsQuery = `
            SELECT c.closing_id, c.creation_date, c.cashier_id,
                p.Person_Name as cashier_name
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            WHERE c.location_code = :locationCode 
            AND c.closing_status = 'DRAFT'
        `;

        if (!req.user.isAdmin) {
            shiftsQuery += ' AND c.cashier_id = :cashierId';
        }

        shiftsQuery += ' ORDER BY c.creation_date DESC';

        const activeShifts = await db.sequelize.query(shiftsQuery, {
            replacements: { 
                locationCode: req.user.location_code,
                cashierId: !req.user.isAdmin ? req.user.Person_id : null
            },
            type: Sequelize.QueryTypes.SELECT
        });

        // Get products
        const products = await ProductDao.findProducts(req.user.location_code);

        // Get credit and digital customers queries remain the same
        const creditCustomers = await db.sequelize.query(`
            SELECT creditlist_id, Company_Name
            FROM m_credit_list 
            WHERE location_code = :locationCode
            AND coalesce(card_flag,'N') = 'N'                
            AND (effective_end_date IS NULL OR effective_end_date >= CURRENT_DATE())
            ORDER BY Company_Name
        `, {
            replacements: { locationCode: req.user.location_code },
            type: Sequelize.QueryTypes.SELECT
        });

        const digitalCustomers = await db.sequelize.query(`
            SELECT creditlist_id, Company_Name
            FROM m_credit_list 
            WHERE location_code = :locationCode
            AND card_flag = 'Y'
            AND type = 'Credit'
            AND (effective_end_date IS NULL OR effective_end_date >= CURRENT_DATE())
            ORDER BY Company_Name
        `, {
            replacements: { locationCode: req.user.location_code },
            type: Sequelize.QueryTypes.SELECT
        });

         console.log('billType' + billType);

        res.render('bills/create', {
            title: 'Create New Bill',
            user: req.user,
            shifts: activeShifts,
            products: products,
            creditCustomers: creditCustomers,
            digitalCustomers: digitalCustomers,
            billType: billType, // Pass billType to the template
            messages: req.flash()
        });
    } catch (error) {
        next(error);
    }
},

checkDraftBills: async (req, res, next) => {
    try {
        const draftBills = await db.sequelize.query(`
            SELECT 
                b.bill_no,
                p.Person_Name as cashier_name
            FROM t_bills b
            JOIN t_closing c ON b.closing_id = c.closing_id
            JOIN m_persons p ON c.cashier_id = p.person_id
            WHERE b.location_code = :locationCode 
            AND b.bill_status = 'DRAFT'
            ORDER BY b.creation_date DESC
        `, {
            replacements: { locationCode: req.user.location_code },
            type: Sequelize.QueryTypes.SELECT
        });

        res.json({
            hasDrafts: draftBills.length > 0,
            draftBills: draftBills
        });
    } catch (error) {
        next(error);
    }
},
 

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
                SELECT COALESCE(MAX(CAST(SUBSTRING(bill_no, 4) AS UNSIGNED)), 0) AS max_bill
                FROM t_bills
                WHERE location_code = :locationCode
                AND bill_no LIKE CONCAT(:prefix, '%');
            `, {
                replacements: { 
                    locationCode: req.user.location_code,
                    prefix: (req.body.bill_type === 'CREDIT' || req.body.bill_type === 'DIGITAL') ? 'CR/' : 'CS/'
                },
                type: Sequelize.QueryTypes.SELECT
            });
            
       
           
            // Get the next bill number by incrementing the max_bill result
            const nextNumber = parseInt(maxBillResult[0].max_bill, 10) + 1;

            console.log('nextNumber'+nextNumber);

            // Pad the incremented number with leading zeros (6 digits)
            const paddedNumber = String(nextNumber).padStart(6, '0');


            console.log('paddedNumber'+paddedNumber);
            
            // Determine the bill prefix based on the bill type
            const prefix = (req.body.bill_type === 'CREDIT' || req.body.bill_type === 'DIGITAL') ? 'CR/' : 'CS/';

            // Construct the next bill number
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
                if (req.body.bill_type === 'CREDIT' || req.body.bill_type === 'DIGITAL') {
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
                billType: req.body.bill_type,
                errorDetails: error.errors ? error.errors : 'No specific validation error details available'
            });
            req.flash('error', 'Error creating bill: ' + error.message);
            res.redirect('/bills/new');
        }
    },

    getBills: async (req, res, next) => {
        try {
            // Shifts query remains the same
            let shiftsQuery = `
                SELECT tc.closing_id, 
                CONCAT(mp.Person_Name, ' (', tc.closing_id, ')') as shift_display
                from t_closing tc,m_persons mp where 
                closing_status = 'DRAFT'
                and tc.location_code = :locationCode 
                and mp.person_id = tc.cashier_id
            `;
            
            if (!req.user.isAdmin) {
                shiftsQuery += ' and tc.cashier_id = :cashierId';
            }
            
            shiftsQuery += ' ORDER BY tc.closing_id DESC';
    
            const shifts = await db.sequelize.query(shiftsQuery, {
                replacements: { 
                    locationCode: req.user.location_code,
                    cashierId: !req.user.isAdmin ? req.user.Person_id : null
                },
                type: Sequelize.QueryTypes.SELECT
            });
    
            // Modified bills query to handle both active and cancelled bills
            let billsQuery = `
                SELECT DISTINCT b.*, 
                    cl.closing_status,  
                    CASE 
                        WHEN b.bill_type IN ('CREDIT', 'DIGITAL') THEN 
                            CASE 
                                WHEN b.bill_status = 'CANCELLED' THEN 
                                    (SELECT mcl.Company_Name 
                                    FROM t_credits_cancelled tc 
                                    JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id 
                                    WHERE tc.bill_id = b.bill_id LIMIT 1)
                                ELSE 
                                    (SELECT mcl.Company_Name 
                                    FROM t_credits tc 
                                    JOIN m_credit_list mcl ON tc.creditlist_id = mcl.creditlist_id 
                                    WHERE tc.bill_id = b.bill_id LIMIT 1)
                            END
                        ELSE NULL
                    END as customer_name,
                    p.Person_Name as cashier_name
                FROM t_bills b
                LEFT JOIN t_closing cl ON b.closing_id = cl.closing_id
                LEFT JOIN m_persons p ON cl.cashier_id = p.Person_id
                WHERE b.location_code = :locationCode
            `;
    
            if (!req.user.isAdmin) {
                billsQuery += ' AND cl.cashier_id = :cashierId';
            }
    
            billsQuery += ' ORDER BY b.creation_date DESC';
    
            const bills = await db.sequelize.query(billsQuery, {
                replacements: { 
                    locationCode: req.user.location_code,
                    cashierId: !req.user.isAdmin ? req.user.Person_id : null
                },
                type: Sequelize.QueryTypes.SELECT
            });
    
            res.render('bills/list', {
                title: 'Bills',
                user: req.user,
                bills: bills,
                shifts: shifts,
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
            
            // Get both bill type and status
            const bill = await db.sequelize.query(`
                SELECT bill_type, bill_status FROM t_bills WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
            if (!bill.length) {
                return res.status(404).json({ error: 'Bill not found' });
            }
    
            let items;
            if (bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL') {
                const query = bill[0].bill_status === 'CANCELLED' ? `
                    SELECT c.*, p.product_name, cl.Company_Name as customer_name
                    FROM t_credits_cancelled c
                    JOIN m_product p ON c.product_id = p.product_id
                    LEFT JOIN m_credit_list cl ON c.creditlist_id = cl.creditlist_id
                    WHERE c.bill_id = :billId
                ` : `
                    SELECT c.*, p.product_name, cl.Company_Name as customer_name
                    FROM t_credits c
                    JOIN m_product p ON c.product_id = p.product_id
                    LEFT JOIN m_credit_list cl ON c.creditlist_id = cl.creditlist_id
                    WHERE c.bill_id = :billId
                `;
    
                items = await db.sequelize.query(query, {
                    replacements: { billId },
                    type: Sequelize.QueryTypes.SELECT
                });
            } else {
                const query = bill[0].bill_status === 'CANCELLED' ? `
                    SELECT c.*, p.product_name
                    FROM t_cashsales_cancelled c
                    JOIN m_product p ON c.product_id = p.product_id
                    WHERE c.bill_id = :billId
                ` : `
                    SELECT c.*, p.product_name
                    FROM t_cashsales c
                    JOIN m_product p ON c.product_id = p.product_id
                    WHERE c.bill_id = :billId
                `;
    
                items = await db.sequelize.query(query, {
                    replacements: { billId },
                    type: Sequelize.QueryTypes.SELECT
                });
            }
    
            res.json({
                bill_type: bill[0].bill_type,
                bill_status: bill[0].bill_status,  // Added status to response
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
    
            const billItems = (bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL')
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
    
              // Get active shifts with cashier restriction
                    let shiftsQuery = `
                    SELECT c.closing_id, c.creation_date, c.cashier_id,
                        p.Person_Name as cashier_name
                    FROM t_closing c
                    LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                    WHERE c.location_code = :locationCode 
                    AND c.closing_status = 'DRAFT'
                `;

                if (!req.user.isAdmin) {
                    shiftsQuery += ' AND c.cashier_id = :cashierId';
                }

                shiftsQuery += ' ORDER BY c.creation_date DESC';

                const activeShifts = await db.sequelize.query(shiftsQuery, {
                    replacements: { 
                        locationCode: req.user.location_code,
                        cashierId: !req.user.isAdmin ? req.user.Person_id : null
                    },
                    type: Sequelize.QueryTypes.SELECT
                });
          
            // Get products for the location
            const products = await ProductDao.findProducts(req.user.location_code);
            const creditCustomers = await db.sequelize.query(`
                SELECT creditlist_id, Company_Name
                FROM m_credit_list 
                WHERE location_code = :locationCode
                AND coalesce(card_flag,'N') = 'N'                
                AND (effective_end_date IS NULL OR effective_end_date >= CURRENT_DATE())
                ORDER BY Company_Name
            `, {
                replacements: { locationCode: req.user.location_code },
                type: Sequelize.QueryTypes.SELECT
            });
            
            // Get digital customers (card_flag = 'Y')
            const digitalCustomers = await db.sequelize.query(`
                SELECT creditlist_id, Company_Name
                FROM m_credit_list 
                WHERE location_code = :locationCode
                AND card_flag = 'Y'
                AND type = 'Credit'
                AND (effective_end_date IS NULL OR effective_end_date >= CURRENT_DATE())
                ORDER BY Company_Name
            `, {
                replacements: { locationCode: req.user.location_code },
                type: Sequelize.QueryTypes.SELECT
            });
            

            
            
    
            res.render('bills/edit', {  // Change this to 'bills/edit'
                title: 'Edit Bill',
                user: req.user,
                bill: bill[0],
                items: billItems,
                shifts: activeShifts,  // Add this
                products: products,
                creditCustomers: creditCustomers,
                digitalCustomers: digitalCustomers,
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
                if ((bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL') && !req.body.creditlist_id) {
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
                const insertQuery = (req.body.bill_type === 'CREDIT' || req.body.bill_type === 'DIGITAL')
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
                        creditlistId: req.body.bill_type === 'CREDIT' || req.body.bill_type === 'DIGITAL' ? req.body.creditlist_id : null,
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
            const deleteItemsQuery = billType[0].bill_type === 'CREDIT' || billType[0].bill_type === 'DIGITAL' 
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

    printBill: async (req, res, next) => {
        try {
            const billId = req.body.billId; // Extract the billId from the request body
    
            // Fetch the bill details
            const bill = await db.sequelize.query(`
                SELECT *, COALESCE(total_amount, 0) as total_amount,
                (SELECT Company_Name FROM m_credit_list mcl, t_credits tc WHERE mcl.creditlist_id = tc.creditlist_id
                 AND tc.bill_id = tb.bill_id  LIMIT 1) as customer_name
                FROM t_bills tb
                WHERE bill_id = :billId
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
            if (!bill.length) {
                req.flash('error', 'Cannot find this bill. It may not exist.');
                return res.redirect('/bills');
            }
    
            const billItems = (bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL')
                ? await db.sequelize.query(`
                    SELECT c.*, p.product_name
                    FROM t_credits c
                    JOIN m_product p ON c.product_id = p.product_id
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
    
           
            
    
            // Format the data for the template
            const formattedBill = {
                date: '',  // You can add the date if available
                customer: {
                    name: bill[0].customer_name || 'Walk-in Customer'
                },
                type: bill[0].bill_type,
                items: billItems.map(item => ({
                    product_name: item.product_name,
                    quantity: parseFloat(item.qty).toFixed(2),
                    price: parseFloat(item.price).toFixed(2),
                    discount: parseFloat(item.price_discount || 0).toFixed(2),
                    total: parseFloat(item.amount).toFixed(2)
                })),
        };

            console.log('formattedBill',formattedBill);

            let renderData = {};

                   // Prepare the render data
                   renderData ={
                    title: `Bill #${billId}`,
                     bill: formattedBill
                  }

               // Wrap res.render in a Promise to ensure `htmlContent` can be returned
        const htmlContent = await new Promise((resolve, reject) => {
            res.render('bills/print', renderData, async (err, html) => {
                if (err) {
                    console.error('BillPrint: Error in res.render:', err);
                    reject(err); // Reject the Promise if there's an error
                } else {
                    console.log('BillPrint: Successfully rendered HTML');

                    try {
                        // Update the bill status and print count
                        await db.sequelize.query(`
                            UPDATE t_bills
                            SET bill_status = 'ACTIVE',
                                print_count = COALESCE(print_count, 0) + 1
                            WHERE bill_id = :billId
                        `, {
                            replacements: { billId }
                        });

                        console.log('BillPrint: Successfully updated bill status and print count');
                        resolve(html); // Resolve the Promise with the HTML content
                    } catch (updateError) {
                        console.error('BillPrint: Error updating bill status and print count:', updateError);
                        reject(updateError); // Reject the Promise if the update fails
                    }
                }
            });
        });

        return htmlContent; // Return the rendered HTML content
          



        } catch (error) {
            console.error('Error generating print view:', error);
            next(error);
        }
    },   

    // cancelBill: async (req, res, next) => {
    //     const transaction = await db.sequelize.transaction();
        
    //     try {
    //         const billId = req.params.billId;
    
    //         // Check if bill exists and is active
    //         const bill = await db.sequelize.query(`
    //             SELECT b.*, c.closing_status
    //             FROM t_bills b
    //             JOIN t_closing c ON b.closing_id = c.closing_id
    //             WHERE b.bill_id = :billId
    //             AND b.bill_status = 'ACTIVE'
    //         `, {
    //             replacements: { billId },
    //             type: Sequelize.QueryTypes.SELECT
    //         });
    
    //         if (!bill.length) {
    //             throw new Error('Bill not found or is not in active status');
    //         }
    
    //         if (bill[0].closing_status !== 'DRAFT') {
    //             throw new Error('Cannot cancel bill. Shift is not in draft status');
    //         }

    //         // Move records to cancelled tables before deletion
    //             if(bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL') {
    //                 await db.sequelize.query(`
    //                     INSERT INTO t_credits_cancelled 
    //                     SELECT * FROM t_credits WHERE bill_id = :billId
    //                 `, {
    //                     replacements: { billId },
    //                     type: Sequelize.QueryTypes.INSERT,
    //                     transaction
    //                 });

    //                 await db.sequelize.query(`
    //                     DELETE FROM t_credits WHERE bill_id = :billId
    //                 `, {
    //                     replacements: { billId },
    //                     type: Sequelize.QueryTypes.DELETE,
    //                     transaction
    //                 });
    //             } else {
    //                 await db.sequelize.query(`
    //                     INSERT INTO t_cashsales_cancelled 
    //                     SELECT * FROM t_cashsales WHERE bill_id = :billId
    //                 `, {
    //                     replacements: { billId },
    //                     type: Sequelize.QueryTypes.INSERT,
    //                     transaction
    //                 });

    //                 await db.sequelize.query(`
    //                     DELETE FROM t_cashsales WHERE bill_id = :billId
    //                 `, {
    //                     replacements: { billId },
    //                     type: Sequelize.QueryTypes.DELETE,
    //                     transaction
    //                 });
    //             }
           
    //         // Update bill status
    //         await db.sequelize.query(`
    //             UPDATE t_bills 
    //             SET bill_status = 'CANCELLED',
    //                 cancelled_by = :cancelledBy,
    //                 cancelled_date = NOW(),
    //                 cancelled_reason = :reason,
    //                 updated_by = :updatedBy,
    //                 updation_date = NOW()
    //             WHERE bill_id = :billId
    //         `, {
    //             replacements: {
    //                 billId,
    //                 cancelledBy: req.user.Person_id,
    //                 reason: req.body.reason,
    //                 updatedBy: req.user.Person_id
    //             },
    //             type: Sequelize.QueryTypes.UPDATE,
    //             transaction
    //         });
    
    //         await transaction.commit();
    //         req.flash('success', 'Bill cancelled successfully');
    //         res.redirect('/bills');
    //     } catch (error) {
    //         await transaction.rollback();
    //         console.error('Bill cancellation error:', error);
    //         req.flash('error', error.message);
    //         res.redirect('/bills');
    //     }
    // },


    // In bill-controller.js -- called bu shift closing JS finishClosing
    
    
  
    
    
    
    
    cancelBill: async (req, res, next) => {
        const transaction = await db.sequelize.transaction();
        
        try {
            const billId = req.params.billId;
    
            // Check if bill exists and is active
            const bill = await db.sequelize.query(`
                SELECT b.*, c.closing_status
                FROM t_bills b
                JOIN t_closing c ON b.closing_id = c.closing_id
                WHERE b.bill_id = :billId
                AND b.bill_status = 'ACTIVE'
            `, {
                replacements: { billId },
                type: Sequelize.QueryTypes.SELECT
            });
    
            if (!bill.length) {
                return res.status(400).json({
                    success: false,
                    error: 'Bill not found or is not in active status'
                });
            }
    
            if (bill[0].closing_status !== 'DRAFT') {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot cancel bill. Shift is not in draft status'
                });
            }
    
            // Rest of your transaction code remains the same...
            if(bill[0].bill_type === 'CREDIT' || bill[0].bill_type === 'DIGITAL') {
                // Your credit/digital handling code...
            } else {
                // Your cash sales handling code...
            }
           
            // Update bill status
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
                    billId,
                    cancelledBy: req.user.Person_id,
                    reason: req.body.reason,
                    updatedBy: req.user.Person_id
                },
                type: Sequelize.QueryTypes.UPDATE,
                transaction
            });
    
            await transaction.commit();
            
            // Return success JSON instead of redirect
            return res.json({
                success: true,
                message: 'Bill cancelled successfully'
            });
    
        } catch (error) {
            await transaction.rollback();
            console.error('Bill cancellation error:', error);
            
            // Return error JSON instead of redirect
            return res.status(500).json({
                success: false,
                error: error.message || 'An error occurred while cancelling the bill'
            });
        }
    },
    
    checkDraftsForShift: async (req, res, next) => {
            try {
                const shiftId = req.params.shiftId;
                
                const draftBills = await db.sequelize.query(`
                    SELECT COUNT(*) as draft_count
                    FROM t_bills 
                    WHERE closing_id = :shiftId
                    AND bill_status = 'DRAFT'
                `, {
                    replacements: { shiftId },
                    type: Sequelize.QueryTypes.SELECT
                });

                res.json({
                    hasDraftBills: draftBills[0].draft_count > 0
                });
            } catch (error) {
                next(error);
            }
        },

        // In bill-controller.js -- called before deleting a shift          
        checkBillsForShift: async (req, res, next) => {
            try {
                const shiftId = req.params.shiftId;

                console.log('shiftId'+shiftId);
                
                const bills = await db.sequelize.query(`
                    SELECT COUNT(*) as bill_count
                    FROM t_bills 
                    WHERE closing_id = :shiftId
                `, {
                    replacements: { shiftId },
                    type: Sequelize.QueryTypes.SELECT
                });
        
                res.json({
                    hasBills: bills[0].bill_count > 0
                });
            } catch (error) {
                next(error);
            }
        },

        // Check for shifts before allowing to create a Bill.
        checkDraftShifts: async (req, res, next) => {
            try {
                let query = `
                    SELECT COUNT(*) as draft_count
                    FROM t_closing 
                    WHERE location_code = :locationCode 
                    AND closing_status = 'DRAFT'
                `;

                // Add cashier check for non-admin users
                if (!req.user.isAdmin) {
                    query += ` AND cashier_id = :cashierId`;
                }

                const draftShifts = await db.sequelize.query(query, {
                    replacements: { 
                        locationCode: req.user.location_code,
                        cashierId: !req.user.isAdmin ? req.user.Person_id : null
                    },
                    type: Sequelize.QueryTypes.SELECT
                });

                res.json({
                    hasDraftShifts: draftShifts[0].draft_count > 0
                });
            } catch (error) {
                next(error);
            }
        }

    
    
};