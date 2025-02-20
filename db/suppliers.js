"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var Supplier = sequelize.define("m_supplier", {
        supplier_id: {
            autoIncrement: true,
            field: 'supplier_id',
            type: DataTypes.INTEGER,
            primaryKey: true,
        },
        supplier_name: {
            field: 'supplier_name',
            type: DataTypes.STRING(300)
        },
        supplier_short_name: {
            field: 'supplier_short_name',
            type: DataTypes.STRING(300)
        },
        location_id: {
            field: 'location_id',
            type: DataTypes.INTEGER
        },
        location_code: {
            field: 'location_code',
            type: DataTypes.STRING(10)
        },
        created_by: DataTypes.STRING,
        updated_by: DataTypes.STRING,
        creation_date: DataTypes.DATE,
        updation_date: DataTypes.DATE,
    }, {
        timestamps: false,
        freezeTableName: true
    });
    return Supplier;
};