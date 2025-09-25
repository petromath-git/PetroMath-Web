"use strict";

module.exports = function(sequelize, DataTypes) {
    const MenuGroups = sequelize.define('m_menu_groups', {
        group_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        group_code: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true
        },
        group_name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        group_sequence: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        group_icon: {
            type: DataTypes.STRING(50),
            allowNull: true
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
        tableName: 'm_menu_groups'
    });

    return MenuGroups;
};