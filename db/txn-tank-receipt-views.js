const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnTankReceiptView = sequelize.define(config.TXN_TANK_RECEIPT_VIEW, {
        ttank_id: {
            field: 'ttank_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
        },
        invoice_number: {
            field: 'invoice_number',
            type: DataTypes.STRING,
        },
        invoice_date: {
            field: 'invoice_date',
            type: DataTypes.DATE
        },
        fomratted_inv_date: {
            field: 'fomratted_inv_date',
            type: DataTypes.STRING
        },

        fomratted_decant_date:{
            field: 'fomratted_decant_date',
            type: DataTypes.STRING
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

        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        },

        truck_number: {
            field: 'truck_number',
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
        
        closing_status: {
            field: 'closing_status',
            type: DataTypes.STRING,
            defaultValue: 'DRAFT'
       },

        driver: {
            field: 'driver',
            type: DataTypes.STRING
        },
        helper: {
            field: 'helper',
            type: DataTypes.STRING
        },
       
        decant_incharge: {
            field: 'decant_incharge',
            type: DataTypes.STRING
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

    return TxnTankReceiptView;
};