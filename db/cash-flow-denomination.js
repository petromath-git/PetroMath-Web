const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var CashFlowDenom = sequelize.define(config.TXN_CASH_FLOW_DENOMINATION_TABLE, {
        cashdenom_id: {
            field: 'cashdenom_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        cashflow_id: {
            field: 'cashflow_id',
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

    return CashFlowDenom;
};
