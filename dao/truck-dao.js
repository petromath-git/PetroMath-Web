const db = require("../db/db-connection");
const Sequelize = require("sequelize");
const utils = require("../utils/app-utils");
const { Op } = require("sequelize");
const config = require("../config/app-config");


const TankTruck=db.m_tank_truck;
const TruckLoc=db.m_truck_location;
const Location=db.location;


module.exports = {
    getTruckno: (locationCode) => {
        return TankTruck.findAll({
            attributes: ['truck_id','truck_number'],
          
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
                        },
                    ],
                },
            ],

            
        });
       
    },
    getAllTruckno: (locationCode) => {
        return TankTruck.findAll({
            attributes: ['truck_id','truck_number'],
          
            include: [
                {
                    model: TruckLoc,
                    required: true,
                    attributes: ['truck_id','location_id'],
                    where: { [Op.and]: [
                        
                        {'eff_start_date': {[Op.lte] : utils.currentDate()}},
                        {'eff_end_date': {[Op.gte] : utils.currentDate()}} 
                        
                    ] },
                    
                    include: [
                        {
                            model: Location,
                            attributes:['location_id'],
                            where: {location_code: locationCode},
                            required: true,
                        },
                    ],
                },
            ],

            
        });
       
    },
}