const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    const TxnClosing = sequelize.define(config.USER_LOCATION_TABLE, {
        userloc_id: {
            field: 'userloc_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        Person_id: {
            field: 'Person_id',
            type: DataTypes.INTEGER,
        },
        location_id: {
            field: 'location_id',
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
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return UserLocMap;
};