"use strict";

module.exports = function(sequelize, DataTypes) {
    return sequelize.define('t_invoice_product_map', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        location_code: { type: DataTypes.STRING(20) },
        supplier_id: { type: DataTypes.INTEGER, allowNull: false },
        invoice_product_name: { type: DataTypes.STRING(100) },
        product_id: { type: DataTypes.INTEGER },
        conversion_factor: { type: DataTypes.DECIMAL(10,4), allowNull: true }
    }, { timestamps: false, freezeTableName: true });
};
