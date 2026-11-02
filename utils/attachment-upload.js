// utils/attachment-upload.js
// Shared checks for user attachments (photos / PDFs) stored in t_document_store.
// Used by support tickets and dealer leads.
const multer = require('multer');
const path = require('path');

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXTENSION = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

// The real type from the file's first bytes; the browser-declared type can be
// anything. Returns null for anything that isn't a JPEG / PNG / WebP / PDF.
const sniffType = (buf) => {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
    return null;
};

// Plain file name for storage and the download header: no path, no quotes or
// control characters, extension matching the real type.
const safeFileName = (original, mimeType) => {
    const base = path.basename(original || 'attachment')
        .replace(/\.[^.]*$/, '')
        .replace(/[^\w\- ()]+/g, '_')
        .trim()
        .slice(0, 80) || 'attachment';
    return base + EXTENSION[mimeType];
};

// Multer middleware for field `attachments`: memory storage -> BLOB. The declared
// type is only a first filter; checkFiles() checks the actual bytes. Errors become
// req.uploadError (a message for the controller) instead of an unhandled 500.
const uploadMiddleware = ({ maxFiles, maxMb, countError }) => {
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles, fields: 30 },
        fileFilter: (req, file, cb) => {
            if (MIME_TYPES.includes(file.mimetype)) return cb(null, true);
            cb(new Error('Only photos (JPEG, PNG, WebP) and PDF files can be attached'));
        }
    });
    return (req, res, next) => {
        upload.array('attachments', maxFiles)(req, res, (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = `Each file must be ${maxMb} MB or smaller`;
                else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') req.uploadError = countError;
                else req.uploadError = err.message;
                req.files = [];
            }
            next();
        });
    };
};

// Validates uploaded files against how many the record already has.
// Returns { error } or { files: [{ file_name, mime_type, buffer }] }.
const checkFiles = (req, existingCount, maxFiles, countError) => {
    if (req.uploadError) return { error: req.uploadError };
    const uploaded = req.files || [];
    if (existingCount + uploaded.length > maxFiles) return { error: countError };
    const files = [];
    for (const f of uploaded) {
        const mimeType = sniffType(f.buffer);
        if (!mimeType) return { error: `${path.basename(f.originalname)} is not a valid photo or PDF` };
        files.push({ file_name: safeFileName(f.originalname, mimeType), mime_type: mimeType, buffer: f.buffer });
    }
    return { files };
};

// Streams a stored document with headers that stop the browser guessing its type.
const sendDocument = (res, doc, download) => {
    res.set({
        'Content-Type': doc.mime_type,
        'Content-Length': doc.file_size,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFileName(doc.file_name, doc.mime_type)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400'
    });
    res.send(doc.file_data);
};

const fmtSize = (bytes) => (bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

module.exports = { MIME_TYPES, sniffType, safeFileName, uploadMiddleware, checkFiles, sendDocument, fmtSize };
