const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {
    getCreditStmt: (locationCode, closingQueryFromDate, closingQueryToDate,companyname) => {
        if(companyname=='all'){               
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
                    { Company_Name: companyname},
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