const db = require("../db/db-connection");
const moment = require('moment');
const TxnClosing = db.txn_closing;
const TxnCashSales = db.txn_cashsales;
const TxnReading = db.txn_reading;
const Txn2TOil = db.txn_2t_oil;
const TxnCredits = db.txn_credits;
const TxnExpenses = db.txn_expense;
const TxnDenoms = db.txn_denom;
const TxnClosingViews = db.txn_closing_views;
const Pumps = db.pump;
const Products = db.product;
const Expenses = db.expense;
const TxnAttendance = db.txn_attendance;
const TxnDeadlineViews = db.txn_deadline_views;
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const config = require("../config/app-config");


module.exports = {
    getClosingDetailsByDate: (locationCode, closingQueryFromDate, closingQueryToDate) => {
        return TxnClosingViews.findAll({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            order: [Sequelize.literal('closing_id')]
        });
    },
    getPersonsClosingDetailsByDate: (personName, locationCode, closingQueryFromDate, closingQueryToDate) => {
        return TxnClosingViews.findAll({
            where: { [Op.and]: [
                    {
                        Person_Name: personName,
                        location_code: locationCode },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            order: [Sequelize.literal('closing_id')]
        });
    },
    getClosingDetailsByDateFormat: (locationCode, fromDate, toDate) => {
        return TxnClosing.findAll({
            attributes: [
                'closer_id',
                [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%Y-%m-%d'), 'closing_date_fmt1'],
            ],
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), ">=",  fromDate)
                    },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), "<=",  toDate)
                    }
                ] },
            order: [Sequelize.literal('closing_id')]
        });
    },
    getDraftClosingsCountBeforeDays: (locationCode, noOfDays) => {
        let start = moment().subtract(noOfDays, 'days').startOf('day');
        let date = new Date(start.valueOf());
        return TxnClosing.count({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    { closing_status: 'DRAFT' },
                    { closing_date:  {
                        [Op.lt] : date
                    }}
                ] },
        });
    },

    getDeadlineWarningMessage: (locationCode) => {
        return TxnDeadlineViews.findAll({
            attributes: ['message', 'deadline_date'],
             where: { [Op.and]: [
             { location_code: locationCode },
               { display_warning: 'Y'}
             ]}
        })
    },

    getDraftClosingsCount: (locationCode, noOfDays) => {
        return TxnClosing.count({
            where: {
                [Op.and]: [
                    {location_code: locationCode},
                    {closing_status: 'DRAFT'}
                ]
            },
        });
    },
    getClosingDetails: (closingId) => {
        return TxnClosing.findByPk(closingId,
            {
                attributes: [
                    'closing_id',
                    'closer_id',
                    'cashier_id',
                    'location_code',
                    'ex_short',
                    'closing_status',
                    'notes',
                    'cash',
                    [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%Y-%m-%d'), 'closing_date_fmt1'],
                    [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%d-%b-%Y'), 'closing_date_fmt2'],
                ]
            });
    },
    getCashSalesByClosingId: (closingId) => {
        return TxnCashSales.findAll({
            where: {'closing_id': closingId}
        });
    },
    getReadingsByClosingId: (closingId) => {
        return TxnReading.findAll({
            where: {'closing_id': closingId}
        });
    },
    getPumpAndReadingsByClosingId: (closingId, locationCode) => {
        return Pumps.findAll({
            where: {'location_code': locationCode},
            include: [
                {
                    model: TxnReading,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    required: false
                }],
        });
    },
    get2TSalesByClosingId: (closingId, locationCode) => {
        return Products.findAll({
            where: {'location_code': locationCode,
                'product_name': {
                    [Op.or]: [config.POUCH_DESC, config.LOOSE_DESC]
                },
            },
            include: [
                {
                    model: Txn2TOil,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    required: false
                }],
        });
    },
    getCreditsByClosingId: (closingId) => {
        return TxnCredits.findAll({
            where: {'closing_id': closingId}
        });
    },
    getExpensesByClosingId: (closingId) => {
        return TxnExpenses.findAll({
            where: {'closing_id': closingId}
        });
    },
    getTxnExpensesByClosingId: (closingId, locationCode) => {
        return Expenses.findAll({
            where: {
                'location_code': locationCode
            },
            include: [
                {
                    model: TxnExpenses,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    order: [Sequelize.literal('expense_id ASC')],
                    required: false
                }],
        });
    },
    getDenomsByClosingId: (closingId) => {
        return TxnDenoms.findAll({
            where: {'closing_id': closingId}
        });
    },
    getExcessShortage: (closingId) => {
        const closingTxn = db.sequelize.query(
            'select calculate_exshortage(' + closingId + ') as excess_shortage;'
        );
        return closingTxn;
    },

    getClosingSaleByMonth: (locationCode) => {
        return TxnClosingViews.findAll({
            attributes: [
                'location_code',
                [Sequelize.fn('YEAR', Sequelize.col('closing_date')), 'Year'],
                [Sequelize.fn('MONTH', Sequelize.col('closing_date')), 'Month'],
                [Sequelize.fn('sum', Sequelize.col('MS')), 'MS'],
                [Sequelize.fn('sum', Sequelize.col('XMS')), 'XMS'],
                [Sequelize.fn('sum', Sequelize.col('HSD')), 'HSD'],
            ],
            where: { location_code: locationCode  },
            group : [[Sequelize.fn('YEAR', Sequelize.col('closing_date'))],[Sequelize.fn('MONTH', Sequelize.col('closing_date'))]],
            //order: [Sequelize.literal('closing_id')]
        });
    },
    getAttendanceByClosingId: (closingId) => {
        return TxnAttendance.findAll({
            where: {'closing_id': closingId}
        });
    },
};
