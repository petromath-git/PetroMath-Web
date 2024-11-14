const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnExpense = sequelize.define(config.TXN_EXPENSE_TABLE, {
        texpense_id: {
            field: 'texpense_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER
        },
        expense_id: {
            field: 'expense_id',
            type: DataTypes.INTEGER
        },
        amount: {
            field: 'amount',
            type: DataTypes.INTEGER
        },
        notes: {
            field: 'notes',
            type: DataTypes.STRING
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

    return TxnExpense;
};