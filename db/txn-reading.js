const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var TxnReading = sequelize.define(config.TXN_READING_TABLE, {
        reading_id: {
            field: 'reading_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        closing_id: {
            field: 'closing_id',
            type: DataTypes.INTEGER,
        },
        opening_reading: {
            field: 'opening_reading',
            type: DataTypes.DECIMAL
        },
        closing_reading: {
            field: 'closing_reading',
            type: DataTypes.DECIMAL
        },
        pump_id: {
            field: 'pump_id',
            type: DataTypes.INTEGER
        },
        price: {
            field: 'price',
            type: DataTypes.DECIMAL
        },
        testing: {
            field: 'testing',
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

    return TxnReading;
};