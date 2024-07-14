const db = require("../db/db-connection");
const moment = require('moment');
const Sequelize = require("sequelize");
const utils = require("../utils/app-utils");
const { Op } = require("sequelize");
const config = require("../config/app-config");

const Location=db.location;
const Lookup = db.lookup;
const TxnTruckExp = db.txn_truck_expense;
const TruckLoc=db.m_truck_location;


module.exports = {
    getExpenseType:() =>{
        return Lookup.findAll({
            attributes:['lookup_id','description'],
            where: {'lookup_type': 'Truck_Expense'}
        });
    },
    create: (loadData) => {
        return TxnTruckExp.create(loadData)
    },
    getPaymentMode:() =>{
        return Lookup.findAll({
            attributes:['lookup_id','description'],
            where: {'lookup_type': 'Truck_Paymode'}
        });
    },
    getTruckExpenseByDate: 
    (locationCode, QueryFromDate, QueryToDate) => {
        return TxnTruckExp.findAll({
            where: { [Op.and]: [
 
                {
                    expense_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("expense_date"), '%Y-%m-%d'), ">=",  QueryFromDate)
                },
                {
                    expense_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("expense_date"), '%Y-%m-%d'), "<=",  QueryToDate)
                },
            ] },
            
        order: [Sequelize.literal('truckexp_id')],
             
        include: [
            {
            model: TruckLoc,
            required: true,
            attributes: ['truck_id'],
            where: { [Op.and]: [
                    { own_location_flag: 'Y' },
                     {'eff_start_date': {[Op.lte] : utils.currentDate()}},
                    {'eff_end_date': {[Op.gte] : utils.currentDate()}} 
                    
            ] }, 
            include: [
                {        
                    model: Location,
                    attributes:['location_id'],
                    where: {location_code: locationCode},
                    required: true,
                        
                }]     
            }]

    });
 
    },
    
    delete: (texp_Id) => {
        const deleteStatus = TxnTruckExp.destroy({ where: { truckexp_id: texp_Id } });
        return deleteStatus;
    },
}
