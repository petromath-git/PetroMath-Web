// dao/bill-dao.js
const db = require("../db/db-connection");
const Bills = db.bills;
const { Op } = require("sequelize");
const utils = require('../utils/app-utils');
const dateFormat = require('dateformat');

module.exports = {
    getNextBillNumber: async (locationCode) => {
        const maxBill = await Bills.findOne({
            where: { location_code: locationCode },
            order: [['bill_no', 'DESC']]
        });
        return maxBill ? maxBill.bill_no + 1 : 1;
    },

    validateClosingStatus: async (closingId) => {
        const closing = await db.closing.findOne({
            where: { closing_id: closingId }
        });

        if (!closing) {
            return { valid: false, message: 'Invalid closing ID' };
        }

        if (closing.closing_status === 'CLOSED') {
            return { valid: false, message: 'Cannot create bills for closed shifts' };
        }

        return { valid: true };
    },

    create: async (billData) => {
        // Validate closing status first
        const validationResult = await module.exports.validateClosingStatus(billData.closing_id);
        if (!validationResult.valid) {
            throw new Error(validationResult.message);
        }

        try {
            // Start transaction
            const transaction = await db.sequelize.transaction();

            try {
                // Create bill
                const bill = await Bills.create(billData, { transaction });

                // If items exist, create them
                if (billData.items && billData.items.length > 0) {
                    if (billData.bill_type === 'CREDIT') {
                        for (const item of billData.items) {
                            await db.credits.create({
                                closing_id: bill.closing_id,
                                bill_no: bill.bill_no,
                                bill_id: bill.bill_id,
                                creditlist_id: item.creditlist_id,
                                product_id: item.product_id,
                                price: item.price,
                                price_discount: item.price_discount || 0,
                                qty: item.qty,
                                amount: item.amount,
                                created_by: billData.created_by
                            }, { transaction });
                        }
                    } else {
                        for (const item of billData.items) {
                            await db.cashsales.create({
                                closing_id: bill.closing_id,
                                bill_no: bill.bill_no,
                                bill_id: bill.bill_id,
                                product_id: item.product_id,
                                price: item.price,
                                price_discount: item.price_discount || 0,
                                qty: item.qty,
                                amount: item.amount,
                                created_by: billData.created_by
                            }, { transaction });
                        }
                    }
                }

                await transaction.commit();
                return bill;
            } catch (error) {
                await transaction.rollback();
                throw error;
            }
        } catch (error) {
            throw error;
        }
    },

    findAll: (locationCode) => {
        if (locationCode) {
            return Bills.findAll({
                where: { location_code: locationCode },
                order: [['creation_date', 'DESC']]
            });
        }
        return Bills.findAll({
            order: [['creation_date', 'DESC']]
        });
    },

    findByClosingId: (closingId) => {
        return Bills.findAll({
            where: { 
                closing_id: closingId,
                bill_status: {
                    [Op.ne]: 'CANCELLED'
                }
            },
            order: [['creation_date', 'DESC']]
        });
    },

    cancelBill: async (billId, userData) => {
        const bill = await Bills.findOne({
            where: { 
                bill_id: billId,
                print_count: 0,
                bill_status: {
                    [Op.ne]: 'CANCELLED'
                }
            }
        });

        if (!bill) {
            throw new Error('Bill cannot be cancelled - either not found, already cancelled, or already printed');
        }

        return await Bills.update({
            bill_status: 'CANCELLED',
            cancelled_by: userData.cancelled_by,
            cancelled_date: new Date(),
            cancelled_reason: userData.reason,
            updated_by: userData.cancelled_by,
            updation_date: new Date()
        }, {
            where: { bill_id: billId }
        });
    },

    incrementPrintCount: async (billId) => {
        const bill = await Bills.findOne({
            where: { 
                bill_id: billId,
                bill_status: {
                    [Op.ne]: 'CANCELLED'
                }
            }
        });

        if (!bill) {
            throw new Error('Bill not found or is cancelled');
        }

        return await Bills.update({
            print_count: bill.print_count + 1,
            bill_status: 'ACTIVE',
            updation_date: new Date()
        }, {
            where: { bill_id: billId }
        });
    }
};