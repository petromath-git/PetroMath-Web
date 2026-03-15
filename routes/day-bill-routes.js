// routes/day-bill-routes.js
const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/day-bill-controller');

// List: /day-bill
router.get('/', controller.getList);

// Detail by date: /day-bill/2026-03-14
router.get('/:date', controller.getByDate);

// Save bill numbers (AJAX): POST /day-bill/2026-03-14/save-bill-numbers
router.post('/:date/save-bill-numbers', controller.saveBillNumbers);

// Manual recalculate (admin recovery): POST /day-bill/2026-03-14/recalculate
router.post('/:date/recalculate', controller.recalculate);

module.exports = router;
