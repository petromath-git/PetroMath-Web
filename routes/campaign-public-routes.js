const express = require('express');
const router = express.Router();
const campaignPublicController = require('../controllers/campaign-public-controller');

// GET route - Public campaign page (no login required)
router.get('/:campaignCode', 
    (req, res, next) => {
        campaignPublicController.getPublicCampaignPage(req, res, next);
    }
);

// POST route - Submit answer (no login required)
router.post('/:campaignCode/submit', 
    (req, res, next) => {
        campaignPublicController.submitPublicAnswer(req, res, next);
    }
);

module.exports = router;