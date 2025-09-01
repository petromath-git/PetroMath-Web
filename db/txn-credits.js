const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnCredits = sequelize.define(config.TXN_CREDITS_TABLE, {
        tcredit_id: {
            field: 'tcredit_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        bill_no: {
            field: 'bill_no',
            type: DataTypes.STRING
        },
        creditlist_id: {
            field: 'creditlist_id',
            type: DataTypes.INTEGER
        },
        vehicle_id: {  
            field: 'vehicle_id',
            type: DataTypes.INTEGER
        },
        product_id: {
            field: 'product_id',
            type: DataTypes.INTEGER
        },
        price: {
            field: 'price',
            type: DataTypes.DECIMAL
        },
        price_discount: {
            field: 'price_discount',
            type: DataTypes.DECIMAL
        },
        qty: {
            field: 'qty',
            type: DataTypes.DECIMAL
        },
        notes: {
            field: 'notes',
            type: DataTypes.TEXT
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
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
        // ADD THESE MISSING FIELDS:
        vehicle_number: {
            field: 'vehicle_number',
            type: DataTypes.STRING(100)
        },
        indent_number: {
            field: 'indent_number',
            type: DataTypes.STRING(100)
        },
        settlement_date: {
            field: 'settlement_date',
            type: DataTypes.DATEONLY
        },
        recon_id: {
            field: 'recon_id',
            type: DataTypes.INTEGER
        },
        bill_id: {
            field: 'bill_id',
            type: DataTypes.INTEGER
        },
        odometer_reading: {
            field: 'odometer_reading',
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
            comment: 'Vehicle odometer reading at time of fuelling for mileage calculation'
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnCredits;
};