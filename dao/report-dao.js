const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {
    getBalance: (creditId, closingQueryFromDate,closingQueryToDate) => {     
        return db.sequelize.query(
            "select get_opening_credit_balance("+ creditId + ",'"+ closingQueryFromDate+ "') as OpeningData,get_closing_credit_balance("+ creditId + ",'"+ closingQueryToDate+ "') as ClosingData",
            { type: Sequelize.QueryTypes.SELECT }
        );
    },
    getCreditStmt: (locationCode, closingQueryFromDate, closingQueryToDate,creditId) => {
        if(creditId==-1){               
            return TxnCreditStmtViews.findAll({
                where: { [Op.and]: [
                    { location_code: locationCode },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            });
        }
        else{
            return TxnCreditStmtViews.findAll({
                where: { [Op.and]: [
                    { location_code: locationCode },
                    { creditlist_id: creditId},
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), ">=",  closingQueryFromDate)
                    },
                    {
                        tran_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("tran_date"), '%Y-%m-%d'), "<=",  closingQueryToDate)
                    }
                ] },
            });

        }
    }
}