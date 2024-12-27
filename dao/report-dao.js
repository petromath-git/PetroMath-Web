const db = require("../db/db-connection");
const  TxnCreditStmtViews= db.txn_creditstmt_views;
const config = require("../config/app-config");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");


module.exports = {
    getBalance: (creditId, closingQueryFromDate,closingQueryToDate) => {     
        //console.log('in GetBalance')
        //console.log(closingQueryFromDate); 
        //console.log(closingQueryToDate); 
        return db.sequelize.query(
            "select get_opening_credit_balance("+ creditId + ",'"+ closingQueryFromDate+ "') as OpeningData,get_closing_credit_balance("+ creditId + ",'"+ closingQueryToDate+ "') as ClosingData",
            { type: Sequelize.QueryTypes.SELECT }           
        );
        
    },
    getDayBalance: (locationCode,closingQueryToDate) => {             
        return db.sequelize.query(
            `select upper(mcl.company_name) company_name,get_closing_credit_balance(mcl.creditlist_id,:closing_date) as ClosingData
             from m_credit_list mcl where location_code = :locationCode
             and  COALESCE(mcl.card_flag,'N') <> 'Y' order by 2 desc `,
            {   replacements: { locationCode: locationCode,closing_date: closingQueryToDate}, 
                 type: Sequelize.QueryTypes.SELECT }           
        );
        
    }    ,
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
    },
    getLocationDetails: (location_code) => {
        return db.sequelize.query(
            `SELECT location_name, address,location_id,location_code
             FROM m_location 
             WHERE location_code = :location_code`,
            {
                replacements: { location_code: location_code },
                type: Sequelize.QueryTypes.SELECT
            }
        ).then(results => {
            if (results.length > 0) {
                return results[0];
            } else {
                throw new Error("Location not found");
            }
        });
    }
}