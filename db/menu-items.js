// db/menu-items.js
"use strict";

module.exports = function(sequelize, DataTypes) {
    const MenuItems = sequelize.define('m_menu_items', {
        menu_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        menu_code: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },
        menu_name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        url_path: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        parent_code: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        sequence: {
            type: DataTypes.INTEGER,
            defaultValue: 1
        },
        group_code: {
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
        tableName: 'm_menu_items'
    });

    return MenuItems;
};