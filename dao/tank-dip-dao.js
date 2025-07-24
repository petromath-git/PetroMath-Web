const db = require("../db/db-connection");
const dateFormat = require("dateformat");
const TankDip = db.tank_dip;
const Tank = db.tank;
const TankReading = db.tank_reading;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

function TankDipDao() {

    this.create = async function(tankDipData,options = {}) {
       
        
        try {
            // Use direct query for insert
            const result = await db.sequelize.query(
                `INSERT INTO t_tank_dip 
                (tank_id, dip_date, dip_time, dip_reading, location_code, 
                 created_by,updated_by,creation_date, updation_date) 
                VALUES 
                (:tank_id, :dip_date, :dip_time, :dip_reading, :location_code,
                 :created_by,:updated_by,:creation_date, :updation_date)`,
                {
                    replacements: {
                        tank_id: tankDipData.tank_id,
                        dip_date: tankDipData.dip_date,
                        dip_time: tankDipData.dip_time,
                        dip_reading: tankDipData.dip_reading,
                        location_code: tankDipData.location_code,
                        created_by: tankDipData.created_by,
                        updated_by: tankDipData.created_by,
                        creation_date: new Date(), // Current timestamp
                        updation_date: new Date() // Current timestamp
                    },
                    transaction: options.transaction,
                    type: db.Sequelize.QueryTypes.INSERT
                }
            );

            console.log("TankDipDao Create completed, result:", result);
            
            // Return the inserted record ID
            return { tdip_id: result[0] };
        } catch (error) {
            console.error("Error in TankDipDao Create:", error);
            throw error;
        }
    };

    this.createPumpReading = async function(pumpReadingData,options = {}) {

        console.log("Creating pump reading with data:", pumpReadingData);
        
        
        
        
        try {
            // Use direct query for insert
            const result = await db.sequelize.query(
                `INSERT INTO t_tank_reading 
                    (tdip_id,
                    pump_id, 
                    reading,
                    created_by,
                    updated_by,
                    updation_date,
                    creation_date) 
                VALUES 
                    (:tdip_id, :pump_id, :reading,
                    :created_by,:updated_by,:creation_date, :updation_date)`,
                {
                    replacements: {
                        tdip_id: pumpReadingData.tdip_id,
                        pump_id: pumpReadingData.pump_id,
                        reading: pumpReadingData.reading,
                        created_by: pumpReadingData.created_by,
                        updated_by: pumpReadingData.created_by,
                        creation_date: new Date(), // Current timestamp
                        updation_date: new Date() // Current timestamp
                    },
                    transaction: options.transaction,
                    type: db.Sequelize.QueryTypes.INSERT
                }
            );

            console.log("TankDipDao Create completed, result:", result);
            
            // Return the inserted record ID
            return { tdip_id: result[0] };
        } catch (error) {
            console.error("Error in TankDipDao Create:", error);
            throw error;
        }
    };


    this.findByDateLocation = async function(locationCode, date) {

                    const result = await db.sequelize.query( `SELECT 
                    td.*,
                    t.tank_code, 
                    t.product_code, 
                    t.tank_orig_capacity, 
                    t.dead_stock,
                    tr.reading,    
                    p.pump_code, 
                    p.pump_make
                FROM 
                    t_tank_dip td
                LEFT JOIN 
                    t_tank_reading tr ON td.tdip_id = tr.tdip_id
                LEFT JOIN 
                    m_pump p ON tr.pump_id = p.pump_id
                INNER JOIN 
                    m_tank t ON td.tank_id = t.tank_id
                WHERE 
                    td.location_code = :locationCode
                    AND td.dip_date = :dip_date
                ORDER BY 
                    td.dip_time ASC`,                                                   
                    {
                        replacements: { locationCode: locationCode,                           
                                        dip_date: date
                                        },
                        type: Sequelize.QueryTypes.SELECT
                    }

            );




            return result;
        
    };

    this.getLatestPumpReadings = async function(tank_id) {
        try {
            const result = await db.sequelize.query(
                `SELECT tr.pump_id, tr.reading, p.pump_code, p.pump_make  
                 FROM t_tank_reading tr
                 JOIN t_tank_dip td ON tr.tdip_id = td.tdip_id
                 JOIN m_pump p ON tr.pump_id = p.pump_id
                 WHERE td.tank_id = :tank_id
                 AND td.tdip_id = (
                     SELECT tdip_id 
                     FROM t_tank_dip 
                     WHERE tank_id = :tank_id 
                     ORDER BY dip_date DESC, dip_time DESC 
                     LIMIT 1
                 )`,
                {
                    replacements: { tank_id: tank_id },
                    type: db.Sequelize.QueryTypes.SELECT
                }
            );
            return result;
        } catch (error) {
            console.error("Error getting latest pump readings:", error);
            throw error;
        }
    };

    this.delete = async function(tdip_id) {
        return await db.sequelize.transaction(async (t) => {
            // Delete tank readings first
            await TankReading.destroy({
                where: { 
                    tdip_id: tdip_id                   
                },
                transaction: t
            });

            // Then delete tank dip
            return await TankDip.destroy({
                where: { 
                    tdip_id: tdip_id                    
                },
                transaction: t
            });
        });
    };

    this.findExistingDip = async function(locationCode, tank_id, dip_date, dip_time) {
       
        console.log('Checking for existing dip with params:', {
            locationCode,
            tank_id,
            dip_date,
            dip_time
        });
    
        try {
            // Add a timeout option to the query
            // const result = await db.tank_dip.findOne({
            //     where: {
            //         location_code: locationCode,
            //         tank_id: tank_id,
            //         dip_date: dip_date,
            //         dip_time: dip_time
            //     },
            //     raw: true, // This can help with performance
            //     nest: true,
            //     // Add logging to see the generated SQL
            //     logging: console.log
            // });


                const result = await db.sequelize.query(`SELECT tdip_id
                                                                   FROM   t_tank_dip td
                                                                   WHERE  td.location_code = :locationCode
                                                                       AND Date(td.dip_date) = :dip_date
                                                                       AND td.dip_time = :dip_time
                                                                       AND td.tank_id = :tank_id  `,                                                   
                                                                       {
                                                                           replacements: { locationCode: locationCode,
                                                                                           tank_id: tank_id,
                                                                                           dip_date: dip_date,
                                                                                           dip_time: dip_time,},
                                                                           type: Sequelize.QueryTypes.SELECT
                                                                         }
                   
                          );


    
            console.log('Query result:', result);
            return result;
        } catch (error) {
            console.error('Error in findExistingDip:', error);
            // Re-throw the error to be handled by the controller
            throw error;
        }


    };

    this.searchDipByDateRange = async function(location_code, fromDate, toDate) {
        try {
            const results = await db.sequelize.query(
                `SELECT d.tdip_id, d.tank_id, t.tank_code, t.product_code, d.dip_date, d.dip_time, d.dip_reading
                 FROM t_tank_dip d
                 JOIN m_tank t ON d.tank_id = t.tank_id
                 WHERE d.location_code = :location_code
                 AND d.dip_date BETWEEN :fromDate AND :toDate
                 ORDER BY d.dip_date, d.dip_time`,
                {
                    replacements: { location_code, fromDate, toDate },
                    type: db.Sequelize.QueryTypes.SELECT
                }
            );
            return results;
        } catch (error) {
            console.error("Error in searchDipByDateRange:", error);
            throw error;
        }
    };
    
}

module.exports = new TankDipDao();