const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const { uploadMiddleware } = require('../utils/attachment-upload');
const dealerLeadController = require('../controllers/dealer-lead-controller');

// Attachments: memory storage -> BLOB in t_document_store; the controller checks the actual bytes
const attachments = uploadMiddleware({
    maxFiles: dealerLeadController.ATTACHMENT_MAX_FILES,
    maxMb: dealerLeadController.ATTACHMENT_MAX_MB,
    countError: dealerLeadController.ATTACHMENT_COUNT_ERROR
});

// Lead list, follow-ups and export need MANAGE_DEALER_LEADS (SuperUser + PowerUser + TeleCaller)
const canManage = [isLoginEnsured, security.hasPermission('MANAGE_DEALER_LEADS')];

// TeleCallers work the leads but don't download the whole list
const notTeleCaller = (req, res, next) => {
    if (req.user.Role === 'TeleCaller') return res.status(403).send('You do not have access to this page.');
    next();
};

// GET / - Public lead capture form (no login required)
router.get('/', (req, res, next) => {
    dealerLeadController.getPublicForm(req, res, next);
});

// POST / - Submit a lead (no login required)
router.post('/', (req, res, next) => {
    dealerLeadController.submitLead(req, res, next);
});

// GET /admin - Lead list with filters and follow-up summary
router.get('/admin', canManage, (req, res, next) => {
    dealerLeadController.getAdminList(req, res, next);
});

// GET /admin/export - CSV export of the filtered leads
router.get('/admin/export', canManage, notTeleCaller, (req, res, next) => {
    dealerLeadController.exportCsv(req, res, next);
});

// GET /admin/report - Daily leads report (hot leads, team activity, WhatsApp text)
router.get('/admin/report', canManage, notTeleCaller, (req, res, next) => {
    dealerLeadController.getDailyReport(req, res, next);
});

// GET /admin/new - Add a lead by hand
router.get('/admin/new', canManage, (req, res, next) => {
    dealerLeadController.getNewLeadForm(req, res, next);
});

// POST /admin/new - Save the new lead
router.post('/admin/new', canManage, (req, res, next) => {
    dealerLeadController.createLead(req, res, next);
});

// GET /admin/:leadId - Lead detail, activity timeline, log form
router.get('/admin/:leadId(\\d+)', canManage, (req, res, next) => {
    dealerLeadController.getLeadDetail(req, res, next);
});

// POST /admin/:leadId/activity - Log a call / visit / note
router.post('/admin/:leadId(\\d+)/activity', canManage, (req, res, next) => {
    dealerLeadController.logActivity(req, res, next);
});

// Attachments (photos / PDFs), served only through the lead so its access check applies
router.post('/admin/:leadId(\\d+)/attachments', canManage, attachments, dealerLeadController.addAttachments);
router.get('/admin/:leadId(\\d+)/attachments/:docId(\\d+)', canManage, dealerLeadController.getAttachment);
router.delete('/admin/:leadId(\\d+)/attachments/:docId(\\d+)', canManage, dealerLeadController.deleteAttachment);

// POST /admin/:leadId - Correct the lead's details
router.post('/admin/:leadId(\\d+)', canManage, (req, res, next) => {
    dealerLeadController.updateLead(req, res, next);
});

module.exports = router;
