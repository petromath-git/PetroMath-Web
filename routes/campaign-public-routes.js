const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const campaignPublicController = require('../controllers/campaign-public-controller');

// Limit answer submissions per IP. Kept generous because customers on the same
// mobile network / station Wi-Fi can share an IP - this only stops scripted spamming.
const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            error: 'Too many attempts from this network. Please try again in a few minutes.'
        });
    }
});

// GET route - Public campaign page (no login required)
router.get('/:campaignCode',
    (req, res, next) => {
        campaignPublicController.getPublicCampaignPage(req, res, next);
    }
);

// POST route - Submit answer (no login required)
router.post('/:campaignCode/submit',
    submitLimiter,
    (req, res, next) => {
        campaignPublicController.submitPublicAnswer(req, res, next);
    }
);

module.exports = router;
