const db = require("../db/db-connection");
const moment = require('moment');
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const config = require("../config/app-config");
const TxnTankReceipts = db.txn_tank_stkrcpt;
const TxnTankRcptViewDao = db.txn_tank_receipt_views;
const Location = db.location;

module.exports = {
    getTankRcptByDate: (locationCode, QueryFromDate, QueryToDate) => {
       return TxnTankRcptViewDao.findAll({
        where: { [Op.and]: [
                { location_code: locationCode },
                {
                    invoice_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), ">=",  QueryFromDate)
                },
                {
                    invoice_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), "<=",  QueryToDate)
                }
            ] },
        order: [Sequelize.literal('ttank_id')]
    });

    },

    saveReceiptData: (data) => {
        const receiptTxn = TxnTankReceipts.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["ttank_id", "invoice_number", "invoice_date","decant_date","driver_id","helper_id","truck_id",
                "decant_incharge", "odometer_reading","decant_time","truck_halt_flag", "updated_by", "updation_date"]
        });
        return receiptTxn;
    },

    getReceiptDetails: (ttank_id) => {
        return TxnTankReceipts.findByPk(ttank_id,
            {
                attributes: [
                    'ttank_id',
                    'invoice_date',
                    'invoice_number',
                    'decant_date',
                    'decant_incharge',
                    'truck_number',
                    'driver_id',
                    'helper_id',
                    'closing_status',
                    'odometer_reading',
                    [Sequelize.fn('date_format', Sequelize.col('invoice_date'), '%d-%b-%Y'), 'invoice_date_fmt1'],
                    [Sequelize.fn('date_format', Sequelize.col('decant_date'), '%d-%b-%Y'), 'decant_date_fmt1'],
                    'decant_time',
                    'truck_halt_flag',
                    'truck_id',
                    'location_id'
                ]
            });
    },

    deletetankReceipt: (ttank_id) => {
        const receiptTxn = db.sequelize.query(
            'CALL delete_tankreceipt(' + ttank_id + ');', null, { raw: true }
        );
        return receiptTxn;
    },

    finishClosing: (ttank_id) => {
        const receiptTxn = db.sequelize.query(
            'CALL close_tankreceipt(' + ttank_id + ');', null, { raw: true }
        );
        return receiptTxn;
    },

    getLocationId: (locationCode) => {
        return Location.findOne({
            attributes: ['location_id'],
            where: {'location_code': locationCode}
        });
    }
}