const db = require("../db/db-connection");
const CashReceipts = db.credit_receipts;
const Credit = db.credit;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");
const locationConfigDao = require('../dao/location-config-dao');


module.exports = {
    findCreditReceipts: (locationCode, fromDate, toDate) => {
        if (locationCode) {
          return CashReceipts.findAll({
            attributes: [
                'treceipt_id',
                'receipt_no',
                'creditlist_id',
                'digital_creditlist_id',
                'receipt_type',
                'amount',
                'notes',
                'receipt_date',
                [Sequelize.fn('date_format', Sequelize.col('receipt_date'), '%d-%m-%Y'), 'receipt_date_fmt'],
                'location_code',
                'cashflow_date',
            ],
          where: { [Op.and]: [
                  { location_code: locationCode },
                  {
                      receipt_date: Sequelize.where(
                          Sequelize.fn("date_format", Sequelize.col("receipt_date"), '%Y-%m-%d'), ">=",  fromDate)
                  },
                  {
                      receipt_date: Sequelize.where(
                          Sequelize.fn("date_format", Sequelize.col("receipt_date"), '%Y-%m-%d'), "<=",  toDate)
                  }
              ] },
           order: [
               ['receipt_date', 'ASC'],
           ],
            include: [
              {
                model: Credit,
                where: { location_code: locationCode, },
                required: false,
              },
            ],
          });
        }
    },

    
    create: async (receipt) => {

    // Apply only for manual receipts (no bank link)
    if (!receipt.source_txn_id) {

        const locationCode = receipt.location_code;

        const cashflowEnabledRaw = await locationConfigDao.getSetting(
            locationCode,
            'CASHFLOW_ENABLED'
        );

        const cashflowEnabled = String(cashflowEnabledRaw).toLowerCase() === 'true';

        // If cashflow process is NOT enabled → auto close
        if (!cashflowEnabled) {
            receipt.cashflow_date = new Date();
        }
        // else → leave cashflow_date NULL (Day Close will assign)
    }

    return CashReceipts.create(receipt);
},


    update: (receipt) => {
        return CashReceipts.update(receipt, {
            where: {'treceipt_id': receipt.treceipt_id},
        });
    },
    delete: (receiptId) => {
        const deleteStatus = CashReceipts.destroy({ where: { treceipt_id: receiptId } });
        return deleteStatus;
    }
};
