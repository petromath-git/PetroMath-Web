const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const campaignController = require('../controllers/campaign-controller');

// GET route - Render campaigns list page
router.get('/', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.getCampaignListPage(req, res, next);
    }
);

// GET route - New campaign form
router.get('/new', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.getNewCampaignPage(req, res, next);
    }
);

// POST route - Create new campaign
router.post('/', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.createCampaign(req, res, next);
    }
);

// GET route - Campaign questions page
router.get('/:id/questions', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.getCampaignQuestionsPage(req, res, next);
    }
);

// POST route - Create new question
router.post('/:id/questions', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.createQuestion(req, res, next);
    }
);

// DELETE route - Delete question
router.delete('/:id/questions/:questionId', 
    isLoginEnsured,
    (req, res, next) => {
        campaignController.deleteQuestion(req, res, next);
    }
);

module.exports = router;