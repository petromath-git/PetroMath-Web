const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var CashSales = sequelize.define(config.TXN_CASHSALES_TABLE, {
        cashsales_id: {
            field: 'cashsales_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        Bill_no: {
            field: 'Bill_no',
            type: DataTypes.STRING
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
            type: DataTypes.STRING
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
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return CashSales;
};