const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnDigitalSales = sequelize.define(config.TXN_DIGITAL_SALES_TABLE, {
        digital_sales_id: {
            field: 'digital_sales_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        vendor_id: {
            field: 'vendor_id',
            type: DataTypes.INTEGER
        },
        amount: {
            field: 'amount',
            type: DataTypes.DECIMAL
        },
        transaction_date: {
            field: 'transaction_date',
            type: DataTypes.DATEONLY
        },
        notes: {
            field: 'notes',
            type: DataTypes.TEXT
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
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnDigitalSales;
};