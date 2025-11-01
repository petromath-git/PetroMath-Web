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
        return CashFlowClosing.findOne({
            where: { 
                cashflow_id: cashflowId,
                location_code: locationCode 
            }
        });
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

    NewBunk: (locationCode) => {
        return CashFlowClosing.findAll({
            where: { location_code: locationCode }
        });
    },

    findClosingsByCashflowId: (locationCode, cashflowId) => {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    c.closing_id,
                    c.closing_date,
                    c.cashier_id,
                    c.cash,
                    c.notes,
                    c.closing_status,
                    c.cashflow_id,
                    p.Person_Name as cashier_name,
                    get_closing_collection(c.closing_id, c.location_code) as total_collection
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                WHERE c.location_code = ? 
                AND c.cashflow_id = ?
                ORDER BY c.closing_date ASC
            `;
            
            db.sequelize.query(query, {
                replacements: [locationCode, cashflowId],
                type: db.sequelize.QueryTypes.SELECT
            }).then(results => {
                resolve(results);
            }).catch(err => {
                console.error('Error fetching closings by cashflow_id:', err);
                reject(err);
            });
        });
    },
};
