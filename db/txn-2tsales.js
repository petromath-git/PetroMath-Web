const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Txn2TSale = sequelize.define(config.TXN_2TSALES_TABLE, {
        oil_id: {
            field: 'oil_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        product_id: {
            field: 'product_id',
            type: DataTypes.INTEGER,
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER,
        },
        price: {
            field: 'price',
            type: DataTypes.DECIMAL
        },
        given_qty: {
            field: 'given_qty',
            type: DataTypes.DECIMAL
        },
        returned_qty: {
            field: 'returned_qty',
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

    return Txn2TSale;
};