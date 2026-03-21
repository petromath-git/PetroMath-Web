/**
 * Document Store serving routes
 * GET /documents/:doc_id  — streams the BLOB with correct Content-Type.
 *
 * Authentication: session cookie is sent automatically by the browser,
 * so <img src="/documents/42"> works without any extra JS.
 *
 * Caching: 1-day Cache-Control + ETag based on doc_id.
 * When a new photo is uploaded a new doc_id is created so the URL
 * changes naturally, busting any cached version.
 */
const express = require('express');
const router  = express.Router();
const login   = require('connect-ensure-login');
const DocumentStoreDao = require('../dao/document-store-dao');

const isLoginEnsured = login.ensureLoggedIn({});

router.get('/:doc_id', isLoginEnsured, async (req, res) => {
    try {
        const docId = parseInt(req.params.doc_id);
        if (isNaN(docId)) return res.status(400).send('Invalid document ID');

        const doc = await DocumentStoreDao.findById(docId);
        if (!doc) return res.status(404).send('Document not found');

        // ETag: doc_id is stable for a given file — a replacement creates a new doc_id
        const etag = `"doc-${doc.doc_id}"`;
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        res.set({
            'Content-Type':        doc.mime_type,
            'Content-Length':      doc.file_size,
            'Content-Disposition': `inline; filename="${doc.file_name}"`,
            'Cache-Control':       'private, max-age=86400',
            'ETag':                etag
        });

        res.send(doc.file_data);
    } catch (err) {
        console.error('document-routes serve error:', err);
        res.status(500).send('Failed to retrieve document');
    }
});

module.exports = router;
