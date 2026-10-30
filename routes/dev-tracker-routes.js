// routes/dev-tracker-routes.js
// Support Tickets. Access comes from Menu Management grants:
//   DEV_TRACKER        - raise / view / comment
//   DEV_TRACKER_MANAGE - triage, tasks, work log, delete, hours report
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const multer = require('multer');
const devTrackerController = require('../controllers/dev-tracker-controller');
const { ATTACHMENT_MAX_FILES, ATTACHMENT_MAX_MB, ATTACHMENT_MIME_TYPES } = devTrackerController;

const canRaise = [isLoginEnsured, security.hasMenu('DEV_TRACKER')];
const canManage = [isLoginEnsured, security.hasMenu('DEV_TRACKER_MANAGE')];

// Attachments: memory storage -> BLOB in t_document_store. The declared type is
// only a first filter; the controller checks the file's actual bytes.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: ATTACHMENT_MAX_FILES, fields: 30 },
    fileFilter: (req, file, cb) => {
        if (ATTACHMENT_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Only photos (JPEG, PNG, WebP) and PDF files can be attached'));
    }
});

// Runs multer, turning its errors into a message for the controller
// (req.uploadError) instead of an unhandled 500.
const attachments = (req, res, next) => {
    upload.array('attachments', ATTACHMENT_MAX_FILES)(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = `Each file must be ${ATTACHMENT_MAX_MB} MB or smaller`;
            else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') req.uploadError = `At most ${ATTACHMENT_MAX_FILES} files per ticket`;
            else req.uploadError = err.message;
            req.files = [];
        }
        next();
    });
};

// Pages (fixed paths before /:id)
router.get('/', canRaise, devTrackerController.getDevTrackerPage);
router.get('/new', canRaise, devTrackerController.getNewTrackerPage);
router.get('/hours', canManage, devTrackerController.getHoursPage);
router.get('/:id(\\d+)', canRaise, devTrackerController.getTrackerDetailsPage);
router.get('/:id(\\d+)/edit', canManage, devTrackerController.getEditTrackerPage);

// Tickets
router.post('/', canRaise, attachments, devTrackerController.createTracker);
router.put('/:id(\\d+)', canManage, devTrackerController.updateTracker);
router.delete('/:id(\\d+)', canManage, devTrackerController.deleteTracker);

// Conversation
router.post('/:id(\\d+)/comments', canRaise, devTrackerController.addComment);

// Attachments (max 2 per ticket), served only through the ticket so its access check applies
router.post('/:id(\\d+)/attachments', canRaise, attachments, devTrackerController.addAttachments);
router.get('/:id(\\d+)/attachments/:docId(\\d+)', canRaise, devTrackerController.getAttachment);
router.delete('/:id(\\d+)/attachments/:docId(\\d+)', canRaise, devTrackerController.deleteAttachment);

// Work log (hours)
router.post('/:id(\\d+)/worklog', canManage, devTrackerController.addWorklog);
router.delete('/worklog/:worklogId(\\d+)', canManage, devTrackerController.deleteWorklog);

// Internal tasks
router.post('/:id(\\d+)/tasks', canManage, devTrackerController.createTask);
router.put('/tasks/:taskId(\\d+)', canManage, devTrackerController.updateTask);
router.delete('/tasks/:taskId(\\d+)', canManage, devTrackerController.deleteTask);

module.exports = router;
