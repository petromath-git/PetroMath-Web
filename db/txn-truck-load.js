const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnTruckLoad = sequelize.define(config.TXN_TRUCK_LOAD, {
        truck_load_id: {
            field: 'truck_load_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        invoice_number: {
            field: 'invoice_number',
            type: DataTypes.STRING,
        },
        invoice_date: {
            field: 'invoice_date',
            type: DataTypes.DATE
        },
        decant_date: {
            field: 'decant_date',
            type: DataTypes.DATE
        },
        decant_time: {
            field: 'decant_time',
            type: DataTypes.DECIMAL
        },
        truck_id: {
            field: 'truck_id',
            type: DataTypes.INTEGER
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER,
        },
        driver_id: {
            field: 'driver_id',
            type: DataTypes.INTEGER
        },
        helper_id: {
            field: 'helper_id',
            type: DataTypes.INTEGER
        },
        created_by: {
            field: 'created_by',
            type: DataTypes.STRING
        },
        updated_by: {
            field: 'updated_by',
            type: DataTypes.STRING
        },
        creation_date: {
            field: 'creation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        updation_date: {
            field: 'updation_date',
            type: DataTypes.DATE,
            defaultValue: sequelize.fn('NOW')
        },
        odometer_reading: {
            field: 'odometer_reading',
            type: DataTypes.INTEGER
        },
        ttank_id: {
            field: 'ttank_id',
            type: DataTypes.INTEGER
        },
        MS: {
            field: 'MS',
            type: DataTypes.INTEGER
        },
        HSD: {
            field: 'HSD',
            type: DataTypes.INTEGER
        },
        XMS: {
            field: 'XMS',
            type: DataTypes.INTEGER
        }
             
     
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnTruckLoad;
};