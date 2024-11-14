const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnDenom = sequelize.define(config.TXN_DENOMINATION_TABLE, {
        denom_id: {
            field: 'denom_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        denomination: {
            field: 'denomination',
            type: DataTypes.INTEGER
        },
        denomcount: {
            field: 'denomcount',
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
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return TxnDenom;
};