"use strict";
const config = require("../config/app-config");

module.exports = function(sequelize, DataTypes) {
    var ImportantLinks = sequelize.define('m_important_links', {
        link_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        title: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        url: {
            type: DataTypes.STRING(500),
            allowNull: false
        },
        description: DataTypes.STRING(500),
        category_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        scope_type: {
            type: DataTypes.ENUM('GLOBAL', 'COMPANY', 'LOCATION'),
            allowNull: false
        },
        company_id: DataTypes.INTEGER,
        location_id: DataTypes.INTEGER,
        username: DataTypes.STRING(255),
        password_encrypted: DataTypes.STRING(500),
        is_published: {
            type: DataTypes.TINYINT,
            defaultValue: 0
        },
        display_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        created_at: DataTypes.DATE,
        updated_by: DataTypes.INTEGER,
        updated_at: DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return ImportantLinks;
};