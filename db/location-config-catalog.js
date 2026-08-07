module.exports = (sequelize, DataTypes) => {
    const LocationConfigCatalog = sequelize.define('LocationConfigCatalog', {
        setting_name: {
            type: DataTypes.STRING(50),
            primaryKey: true,
            allowNull: false,
            comment: 'Configuration setting name (matches m_location_config.setting_name)'
        },
        short_description: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        detailed_description: {
            type: DataTypes.TEXT,
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
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updation_date: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'm_location_config_catalog',
        timestamps: false,
        comment: 'One row per setting_name describing what a m_location_config setting does'
    });

    return LocationConfigCatalog;
};
