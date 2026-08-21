const db = require('../db/db-connection');
const DocumentStore = db.document_store;

module.exports = {

    /**
     * Store a new document. Returns the created record (with doc_id).
     * data: { entity_type, entity_id, doc_category, file_name, mime_type,
     *         file_size, file_data (Buffer), location_code, notes, created_by,
     *         capture_source }
     * status defaults to ACTIVE via the DB column default — not set here.
     */
    create: async (data) => {
        return DocumentStore.create({
            entity_type:    data.entity_type,
            entity_id:      data.entity_id,
            doc_category:   data.doc_category,
            file_name:      data.file_name,
            mime_type:      data.mime_type,
            file_size:      data.file_size,
            file_data:      data.file_data,
            capture_source: data.capture_source || null,
            location_code:  data.location_code || null,
            notes:          data.notes         || null,
            created_by:     data.created_by,
            creation_date:  new Date()
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
                         'file_name', 'mime_type', 'file_size', 'status',
                         'capture_source', 'location_code',
                         'created_by', 'creation_date'],
            where: { doc_id: docId }
        });
    },

    /**
     * Delete a document by ID.
     * Hard delete — use only for entities with no soft-delete requirement
     * (e.g. employee profile photo replace/remove). For entities that need
     * an audit trail / relink search, use unlink() instead.
     */
    deleteById: async (docId) => {
        return DocumentStore.destroy({ where: { doc_id: docId } });
    },

    /**
     * List all ACTIVE documents for an entity (metadata only, no blob).
     */
    findByEntity: async (entityType, entityId) => {
        return DocumentStore.findAll({
            attributes: ['doc_id', 'doc_category', 'file_name', 'mime_type',
                         'file_size', 'notes', 'created_by', 'creation_date'],
            where: { entity_type: entityType, entity_id: entityId, status: 'ACTIVE' },
            order: [['creation_date', 'DESC']]
        });
    },

    /**
     * Fetch the single ACTIVE document for an entity/category, if any.
     * Bill photos are 1-per-entity — a new upload while one is ACTIVE is a swap.
     */
    findActiveByEntity: async (entityType, entityId, docCategory) => {
        return DocumentStore.findOne({
            where: { entity_type: entityType, entity_id: entityId, doc_category: docCategory, status: 'ACTIVE' }
        });
    },

    /**
     * Soft-unlink: remove the link without destroying the row or the blob.
     * entity_id/entity_type are left as-is so the row stays searchable for
     * relinking; status flips to UNLINKED so normal queries stop seeing it.
     */
    unlink: async (docId, unlinkedBy) => {
        const [count] = await DocumentStore.update(
            { status: 'UNLINKED', unlinked_by: unlinkedBy, unlinked_at: new Date() },
            { where: { doc_id: docId, status: 'ACTIVE' } }
        );
        return count > 0;
    },

    /**
     * Mark a document as superseded by a newer one (incorrect-photo swap).
     * Old row is kept — not mutated beyond status — for audit history.
     */
    markReplaced: async (docId, replacedByDocId) => {
        const [count] = await DocumentStore.update(
            { status: 'REPLACED', replaced_by_doc_id: replacedByDocId },
            { where: { doc_id: docId, status: 'ACTIVE' } }
        );
        return count > 0;
    }
};
