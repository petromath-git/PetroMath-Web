const db = require("../db/db-connection");
const CashFlowClosing = db.cashflow_closing;
const CashFlowTxn = db.txn_cashflow;
const ClosingTxn = db.txn_closing;
const CashFlowDenoms = db.cashflow_denoms;
const Lookup = db.lookup;
const config = require("../config/app-config");
const { Sequelize, Op } = require("sequelize");

module.exports = {
    findCashflow: (locationCode, cashflowId) => {
        return CashFlowClosing.findByPk(cashflowId);
    },
    findCashflowClosings: (locationCode, fromDate, toDate) => {
        return CashFlowClosing.findAll({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), ">=",  fromDate)
                    },
                    {
                        closing_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "<=",  toDate)
                    }
                ] },
            order: [Sequelize.literal('cashflow_date')]
        });
    },
    // check if cash flow for a specific date is available
    findCashflowClosingsWithSpecificDate: (locationCode, cashflowDate) => {
        return CashFlowClosing.findAll({
                where: { [Op.and]: [
                        { location_code: locationCode },
                        {
                            cashflow_date: Sequelize.where(
                                Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "=",  cashflowDate)
                    }
                    ] }
        });
    },
    // TODO: fix below API, query is getting data, but not sequelize!
    findCashflowClosings_old: (locationCode, fromDate, toDate) => {
        return CashFlowClosing.findAll({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        cashflow_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), ">=",  fromDate)
                    },
                    {
                        cashflow_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("cashflow_date"), '%Y-%m-%d'), "<=",  toDate)
                    }
                ] },
            order: [ ['cashflow_date', 'DESC']],
            include: [
                {
                    model: ClosingTxn,
                    where: {
                        location_code: locationCode,
                    },
                    required: false
                }],
        });
    },
    addNew: (cashflowClosing) => {
        return CashFlowClosing.create(cashflowClosing)
    },
    findCashflowTxnById: (location, id, type) => {
        return Lookup.findAll({
            where: {
                location_code: location,
                tag: type
            },
            include: [
                {
                    model: CashFlowTxn,
                    where: {
                        cashflow_id: id,
                    },
                    required: false
                }],
        });
    },
    triggerGenerateCashflow : (cashflowId) => {
        const cashflowTxn = db.sequelize.query('CALL generate_cashflow(' + cashflowId + ');', null, { raw: true });
        return cashflowTxn;
    },
    saveCashflowTxns: (data) => {
        const txns = CashFlowTxn.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["description", "type", "amount", "updated_by", "updation_date"]});
        return txns;
    },
    delete: (id) => {
        const txn = CashFlowTxn.destroy({ where: { transaction_id: id } });
        return txn;
    },
    finishClosing: (cashflowId) => {
        const closingTxn = CashFlowClosing.update(
            { status: 'CLOSED' },
            { where: { cashflowId: cashflowId } }
        );
        return closingTxn;
    },
    deleteCashFlow: (cashflowId) => {
        return db.sequelize.query(
            'CALL delete_cashflow(' + cashflowId + ');', null, { raw: true }
        );
    },
    getDenomsByCashFlowId: (cashFlowId) => {
        return CashFlowDenoms.findAll({
            where: {'cashflow_id': cashFlowId}
        });
    },
    saveDenoms: (data) => {
        const denomTxn = CashFlowDenoms.bulkCreate(data, {returning: true,
            updateOnDuplicate: ["denomcount", "updated_by", "updation_date"]});
        return denomTxn;
    },
};
