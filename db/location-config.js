module.exports = (sequelize, DataTypes) => {
    const LocationConfig = sequelize.define('LocationConfig', {
        config_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        location_code: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'Location code or * for global settings'
        },
        setting_name: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: 'Configuration setting name'
        },
        setting_value: {
            type: DataTypes.STRING(100),
            allowNull: false,
            comment: 'Configuration setting value'
        },
        effective_start_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Date when setting becomes effective'
        },
        effective_end_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: '9999-12-31',
            comment: 'Date when setting expires'
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
        tableName: 'm_location_config',
        timestamps: false, // We handle timestamps manually
        indexes: [
            {
                name: 'idx_location_setting',
                fields: ['location_code', 'setting_name', 'effective_start_date']
            },
            {
                name: 'idx_setting_dates',
                fields: ['setting_name', 'effective_start_date', 'effective_end_date']
            }
        ],
        comment: 'Location-specific and global configuration settings'
    });

    return LocationConfig;
};