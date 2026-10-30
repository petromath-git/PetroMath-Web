const express = require('express');
const router = express.Router();
const GstController = require('../controllers/gst-controller');
const GstFilingController = require('../controllers/gst-filing-controller');
const multer = require('multer');
const login = require('connect-ensure-login');

// Middleware to ensure login for all GST routes
const isLoginEnsured = login.ensureLoggedIn('/login');
// Filing returns is owner / admin work: Admin, PowerUser and SuperUser (not Manager)
const GST_ROLES = ['Admin', 'PowerUser', 'SuperUser'];
const isGstRole = (req, res, next) => {
    if (req.user && GST_ROLES.includes(req.user.Role)) return next();
    res.status(403).send('You do not have access to this page.');
};
const gstAccess = [isLoginEnsured, isGstRole];
const upload2b = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Dashboard - /gst
router.get('/', gstAccess, GstController.getDashboard);

// How to file - /gst/guide
router.get('/guide', gstAccess, GstController.getGuide);

// Configuration - /gst/config
router.get('/config', gstAccess, GstController.getConfigPage);
router.post('/config', gstAccess, GstController.saveConfig);

// GSTR-1 file built from the GST Summary - /gst/gstr1?period=MMYYYY
router.get('/gstr1', gstAccess, GstController.getGstr1);
router.get('/gstr1/download', gstAccess, GstController.downloadGstr1);

// HSN codes per product + HSN descriptions - /gst/hsn
router.get('/hsn', gstAccess, GstFilingController.getHsn);
router.post('/hsn/products', gstAccess, GstFilingController.saveProductHsn);
router.post('/hsn/master', gstAccess, GstFilingController.saveHsnMaster);
router.post('/hsn/defaults', gstAccess, GstFilingController.saveHsnDefaults);

// Reverse charge self-invoices (rent from an unregistered landlord) - /gst/rcm?period=MMYYYY
router.get('/rcm', gstAccess, GstFilingController.getRcm);
router.post('/rcm', gstAccess, GstFilingController.saveRcm);
router.post('/rcm/copy', gstAccess, GstFilingController.copyRcm);
router.post('/rcm/:id/delete', gstAccess, GstFilingController.deleteRcm);

// GSTR-2B upload, ITC classes and Rule 42 - /gst/itc?period=MMYYYY
router.get('/itc', gstAccess, GstFilingController.getItc);
router.post('/itc/upload', gstAccess, upload2b.single('file'), GstFilingController.upload2b);
router.post('/itc/class', gstAccess, GstFilingController.set2bClass);

// GSTR-3B worksheet - /gst/gstr3b?period=MMYYYY
router.get('/gstr3b', gstAccess, GstFilingController.getGstr3b);
router.post('/gstr3b', gstAccess, GstFilingController.saveGstr3b);

// GST Workings Excel (file by hand without the JSON) - /gst/workings?period=MMYYYY
router.get('/workings', gstAccess, GstFilingController.downloadWorkings);

// Older generator screens (GSTR-1 now redirects to /gst/gstr1)
router.get('/generate/:returnType', gstAccess, GstController.getGenerateReturnPage);
router.post('/preview', gstAccess, GstController.previewReturn);
router.post('/download', gstAccess, GstController.downloadReturn);

// History - /gst/history, /gst/return/:id
router.get('/history', gstAccess, GstController.getFilingHistory);
router.get('/return/:returnDataId', gstAccess, GstController.getReturnDetails);

module.exports = router;
