const db = require("../db/db-connection");
const moment = require('moment');
const Sequelize = require("sequelize");
const utils = require("../utils/app-utils");
const { Op } = require("sequelize");
const config = require("../config/app-config");

const TxnTruckLoads = db.txn_truck_load;
const TruckLoc=db.m_truck_location;
const Location=db.location;
const Decantlocview = db.decant_out_loc;


module.exports = {
    getTruckLoadByDate: (locationCode, QueryFromDate, QueryToDate) => {
       return TxnTruckLoads.findAll({
        where: { [Op.and]: [


                {
                    invoice_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), ">=",  QueryFromDate)
                },
                {
                    invoice_date: Sequelize.where(
                        Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), "<=",  QueryToDate)
                },
            ] },
           
        order: [Sequelize.literal('truck_load_id')],
         
        include: [
            {
            model: TruckLoc,
            required: true,
            attributes: ['truck_id','location_id'],
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
        }],        
        
        
    });

    },

    getLocationId: () =>{
        return Location.findAll({
            attributes: ['location_id','location_code']
        })

    },

    getDecantLoc: (locationCode) =>{
        return Decantlocview.findAll({
            where :{location_code: locationCode},     
          
        });
    },

    create: (loadData) => {
        return TxnTruckLoads.create(loadData)
    },

    delete: (tload_Id) => {
        const deleteStatus = TxnTruckLoads.destroy({ where: { truck_load_id: tload_Id } });
        return deleteStatus;
    },

}