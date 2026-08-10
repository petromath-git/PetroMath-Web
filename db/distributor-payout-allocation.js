"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var DistributorPayoutAllocation = sequelize.define(config.DISTRIBUTOR_PAYOUT_ALLOCATION_TABLE, {
        allocation_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        payout_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        commission_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        allocated_amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATEONLY,
            allowNull: true
        }
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DistributorPayoutAllocation;
};
