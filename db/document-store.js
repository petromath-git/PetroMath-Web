"use strict";

module.exports = function(sequelize, DataTypes) {
    const DocumentStore = sequelize.define('t_document_store', {
        doc_id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        entity_type:    DataTypes.STRING(50),
        entity_id:      DataTypes.INTEGER,
        doc_category:   DataTypes.STRING(50),
        file_name:      DataTypes.STRING(255),
        mime_type:      DataTypes.STRING(50),
        file_size:      DataTypes.INTEGER,
        file_data:      DataTypes.BLOB('medium'),
        location_code:  DataTypes.STRING(50),
        notes:          DataTypes.STRING(255),
        created_by:     DataTypes.STRING(45),
        creation_date:  DataTypes.DATE
    }, {
        timestamps: false,
        freezeTableName: true
    });

    return DocumentStore;
};
