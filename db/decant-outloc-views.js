"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var decantlocview = sequelize.define(config.DECANT_OUT_LOC_VIEW, {
        decant_location: DataTypes.INTEGER,
        decant_location_code: DataTypes.STRING,
        location_id: DataTypes.INTEGER,
        location_code: DataTypes.STRING,
    }, {
        timestamps: false,
        freezeTableName: true
    });
    decantlocview.removeAttribute('id');
    return decantlocview;
};