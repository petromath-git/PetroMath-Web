const db = require('../db/db-connection');
const DocumentStore = db.document_store;

module.exports = {

    /**
     * Store a new document. Returns the created record (with doc_id).
     * data: { entity_type, entity_id, doc_category, file_name, mime_type,
     *         file_size, file_data (Buffer), location_code, notes, created_by }
     */
    create: async (data) => {
        return DocumentStore.create({
            entity_type:   data.entity_type,
            entity_id:     data.entity_id,
            doc_category:  data.doc_category,
            file_name:     data.file_name,
            mime_type:     data.mime_type,
            file_size:     data.file_size,
            file_data:     data.file_data,
            location_code: data.location_code || null,
            notes:         data.notes         || null,
            created_by:    data.created_by,
            creation_date: new Date()
        });
    },

    /**
     * Fetch metadata + binary for serving.
     * Excludes file_data from metadata calls — use findById for streaming.
     */
    findById: async (docId) => {
        return DocumentStore.findOne({ where: { doc_id: docId } });
    },

    /**
     * Fetch only metadata (no file_data) — for listing, size checks, etc.
     */
    findMetaById: async (docId) => {
        return DocumentStore.findOne({
            attributes: ['doc_id', 'entity_type', 'entity_id', 'doc_category',
                         'file_name', 'mime_type', 'file_size', 'location_code',
                         'created_by', 'creation_date'],
            where: { doc_id: docId }
        });
    },

    /**
     * Delete a document by ID.
     */
    deleteById: async (docId) => {
        return DocumentStore.destroy({ where: { doc_id: docId } });
    },

    /**
     * List all documents for an entity (metadata only, no blob).
     */
    findByEntity: async (entityType, entityId) => {
        return DocumentStore.findAll({
            attributes: ['doc_id', 'doc_category', 'file_name', 'mime_type',
                         'file_size', 'notes', 'created_by', 'creation_date'],
            where: { entity_type: entityType, entity_id: entityId },
            order: [['creation_date', 'DESC']]
        });
    }
};
