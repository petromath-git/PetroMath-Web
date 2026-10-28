// routes/dev-tracker-routes.js
// Support Tickets. Access comes from Menu Management grants:
//   DEV_TRACKER        - raise / view / comment
//   DEV_TRACKER_MANAGE - triage, tasks, work log, delete, hours report
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const devTrackerController = require('../controllers/dev-tracker-controller');

const canRaise = [isLoginEnsured, security.hasMenu('DEV_TRACKER')];
const canManage = [isLoginEnsured, security.hasMenu('DEV_TRACKER_MANAGE')];

// Pages (fixed paths before /:id)
router.get('/', canRaise, devTrackerController.getDevTrackerPage);
router.get('/new', canRaise, devTrackerController.getNewTrackerPage);
router.get('/hours', canManage, devTrackerController.getHoursPage);
router.get('/:id(\\d+)', canRaise, devTrackerController.getTrackerDetailsPage);
router.get('/:id(\\d+)/edit', canManage, devTrackerController.getEditTrackerPage);

// Tickets
router.post('/', canRaise, devTrackerController.createTracker);
router.put('/:id(\\d+)', canManage, devTrackerController.updateTracker);
router.delete('/:id(\\d+)', canManage, devTrackerController.deleteTracker);

// Conversation
router.post('/:id(\\d+)/comments', canRaise, devTrackerController.addComment);

// Work log (hours)
router.post('/:id(\\d+)/worklog', canManage, devTrackerController.addWorklog);
router.delete('/worklog/:worklogId(\\d+)', canManage, devTrackerController.deleteWorklog);

// Internal tasks
router.post('/:id(\\d+)/tasks', canManage, devTrackerController.createTask);
router.put('/tasks/:taskId(\\d+)', canManage, devTrackerController.updateTask);
router.delete('/tasks/:taskId(\\d+)', canManage, devTrackerController.deleteTask);

module.exports = router;
