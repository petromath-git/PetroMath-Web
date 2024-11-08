const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnTankstkrcpt = sequelize.define(config.TXN_TANK_STK_RECEIPT_TABLE, {
        ttank_id: {
            field: 'ttank_id',
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
        driver_id: {
            field: 'driver_id',
            type: DataTypes.INTEGER
        },
        helper_id: {
            field: 'helper_id',
            type: DataTypes.INTEGER
        },
        truck_number: {
            field: 'truck_number',
            type: DataTypes.STRING
        },
        decant_incharge: {
            field: 'decant_incharge',
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
        notes: {
            field: 'notes',
            type: DataTypes.STRING
        },
        odometer_reading: {
            field: 'odometer_reading',
            type: DataTypes.INTEGER
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING
        },
        invoice_date_fmt1: {
            field: 'invoice_date',
            type: DataTypes.DATE        // Dummy fields for UI date formats (summary tab)
        },
        decant_date_fmt1: {
            field: 'decant_date',
            type: DataTypes.DATE        // Dummy fields for UI date formats (summary tab)
        },
        
        closing_status: {
            field: 'closing_status',
            type: DataTypes.STRING,
            defaultValue: 'DRAFT'
       },
       decant_time: {
            field: 'decant_time',
            type: DataTypes.DECIMAL
        },
        truck_halt_flag: {
            field: 'truck_halt_flag',
            type: DataTypes.STRING
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },
        truck_id: {
            field: 'truck_id',
            type: DataTypes.INTEGER
        },
     
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnTankstkrcpt;
};