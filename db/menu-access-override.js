"use strict";

module.exports = function(sequelize, DataTypes) {
    const MenuAccessOverride = sequelize.define('m_menu_access_override', {
        access_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        role: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        menu_code: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        allowed: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        effective_start_date: {
            type: DataTypes.DATE,
            allowNull: false
        },
        effective_end_date: {
            type: DataTypes.DATE,
            allowNull: true
        },
        created_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        updated_by: {
            type: DataTypes.STRING(45),
            allowNull: true
        },
        creation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        timestamps: false,
        tableName: 'm_menu_access_override'
    });

    return MenuAccessOverride;
};