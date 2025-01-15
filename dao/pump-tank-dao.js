const db = require("../db/db-connection");
const PumpTank = db.pump_tank;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

function PumpTankDao() {
    this.findActiveMappings = async function(locationCode, date = new Date()) {
        const result = await db.sequelize.query(
            `
            SELECT 
                pt.*,
                p.pump_code, 
                p.pump_make, 
                p.product_code,
                t.tank_code, 
                t.product_code AS tank_product_code, 
                t.tank_orig_capacity, 
                t.dead_stock
            FROM 
                m_pump_tank pt
            INNER JOIN 
                m_pump p ON pt.pump_id = p.pump_id
            INNER JOIN 
                m_tank t ON pt.tank_id = t.tank_id
            WHERE 
                pt.location_code = :locationCode
                AND pt.effective_start_date <= :date
                AND pt.effective_end_date >= :date
            ORDER BY 
                t.tank_code ASC, 
                p.pump_code ASC;
            `,
            {
                replacements: { locationCode, date },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return result;
    };

    this.findByTankId = async function(tankId, date = new Date()) {
        return await PumpTank.findAll({
            where: {
                tank_id: tankId,
                effective_start_date: { [Op.lte]: date },
                effective_end_date: { [Op.gte]: date }
            },
            include: [{
                model: db.pump,
                attributes: ['pump_code', 'pump_make', 'product_code']
            }],
            order: [[db.pump, 'pump_code', 'ASC']]
        });
    };

    this.findByPumpId = async function(pumpId, date = new Date()) {
        return await PumpTank.findAll({
            where: {
                pump_id: pumpId,
                effective_start_date: { [Op.lte]: date },
                effective_end_date: { [Op.gte]: date }
            },
            include: [{
                model: db.tank,
                attributes: ['tank_code', 'product_code', 'tank_orig_capacity', 'dead_stock']
            }],
            order: [[db.tank, 'tank_code', 'ASC']]
        });
    };

    // New methods for pump master functionality
    this.create = async function(pumpTankData, transaction) {
        console.log('Creating pump-tank mapping:', pumpTankData);
        try {
            const result = await PumpTank.create(pumpTankData, {
                transaction: transaction
            });
            console.log('Create result:', result);
            return result;
        } catch (error) {
            console.error('Error creating pump-tank mapping:', error);
            throw error;
        }
    };

    this.update = async function(pumpTankId, pumpTankData, transaction) {
        return await PumpTank.update(pumpTankData, {
            where: { pump_tank_id: pumpTankId },
            transaction: transaction
        });
    };

    this.deactivate = async function(pumpTankId, deactivateData, transaction) {
        return await PumpTank.update(deactivateData, {
            where: { 
                pump_tank_id: pumpTankId,
                effective_end_date: '2900-01-01'  // Only update if it's active
            },
            transaction: transaction
        });
    };

    this.checkDateOverlap = async function(pumpId, tankId, startDate, locationCode) {
        const result = await db.sequelize.query(
            `
            SELECT 
                COUNT(*) as count
            FROM 
                m_pump_tank
            WHERE 
                pump_id = :pumpId
                AND tank_id = :tankId
                AND location_code = :locationCode
                AND effective_start_date <= :startDate
                AND effective_end_date >= :startDate
            `,
            {
                replacements: { 
                    pumpId,
                    tankId,
                    locationCode,
                    startDate
                },
                type: Sequelize.QueryTypes.SELECT
            }
        );

        return result[0].count > 0;
    };

    this.findById = async function(pumpTankId) {
        return await PumpTank.findOne({
            where: { pump_tank_id: pumpTankId }
        });
    };
}

module.exports = new PumpTankDao();