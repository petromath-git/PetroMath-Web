const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require('../utils/app-security');
const campaignController = require('../controllers/campaign-controller');

// All campaign admin pages need MANAGE_CAMPAIGNS
const canManage = [isLoginEnsured, security.hasPermission('MANAGE_CAMPAIGNS')];

// Routes on a single campaign also check the campaign belongs to the user's current location
const canManageCampaign = [...canManage, campaignController.loadCampaign];

// GET route - Render campaigns list page
router.get('/',
    canManage,
    (req, res, next) => {
        campaignController.getCampaignListPage(req, res, next);
    }
);

// GET route - New campaign form
router.get('/new',
    canManage,
    (req, res, next) => {
        campaignController.getNewCampaignPage(req, res, next);
    }
);

// POST route - Create new campaign
router.post('/',
    canManage,
    (req, res, next) => {
        campaignController.createCampaign(req, res, next);
    }
);

// GET route - Edit campaign form
router.get('/:id/edit',
    canManageCampaign,
    (req, res, next) => {
        campaignController.getEditCampaignPage(req, res, next);
    }
);

// PUT route - Update campaign
router.put('/:id',
    canManageCampaign,
    (req, res, next) => {
        campaignController.updateCampaign(req, res, next);
    }
);

// POST route - Change campaign status
router.post('/:id/status',
    canManageCampaign,
    (req, res, next) => {
        campaignController.updateCampaignStatus(req, res, next);
    }
);

// GET route - Campaign questions page
router.get('/:id/questions',
    canManageCampaign,
    (req, res, next) => {
        campaignController.getCampaignQuestionsPage(req, res, next);
    }
);

// POST route - Create new question
router.post('/:id/questions',
    canManageCampaign,
    (req, res, next) => {
        campaignController.createQuestion(req, res, next);
    }
);

// PUT route - Update question
router.put('/:id/questions/:questionId',
    canManageCampaign,
    (req, res, next) => {
        campaignController.updateQuestion(req, res, next);
    }
);

// GET route - Campaign responses page
router.get('/:id/responses',
    canManageCampaign,
    (req, res, next) => {
        campaignController.getCampaignResponsesPage(req, res, next);
    }
);

// GET route - Export campaign responses to Excel
router.get('/:id/responses/export',
    canManageCampaign,
    (req, res, next) => {
        campaignController.exportCampaignResponses(req, res, next);
    }
);

// POST route - Randomly draw a winner from correct answers for a question
router.post('/:id/questions/:questionId/draw-winner',
    canManageCampaign,
    (req, res, next) => {
        campaignController.drawWinner(req, res, next);
    }
);

// POST route - Manually mark a response as winner
router.post('/:id/responses/:responseId/mark-winner',
    canManageCampaign,
    (req, res, next) => {
        campaignController.markWinner(req, res, next);
    }
);

// POST route - Mark winner's prize as given
router.post('/:id/winners/:winnerId/claim',
    canManageCampaign,
    (req, res, next) => {
        campaignController.markPrizeClaimed(req, res, next);
    }
);

// DELETE route - Remove a winner (prize not yet given)
router.delete('/:id/winners/:winnerId',
    canManageCampaign,
    (req, res, next) => {
        campaignController.removeWinner(req, res, next);
    }
);

// GET route - Printable winners poster
router.get('/:id/winners/print',
    canManageCampaign,
    (req, res, next) => {
        campaignController.getWinnersPosterPage(req, res, next);
    }
);

// DELETE route - Delete question
router.delete('/:id/questions/:questionId',
    canManageCampaign,
    (req, res, next) => {
        campaignController.deleteQuestion(req, res, next);
    }
);

module.exports = router;
