const campaignDao = require("../dao/campaign-dao");
const moment = require('moment');

module.exports = {
    
    /**
     * GET - Campaign list page
     */
    getCampaignListPage: async (req, res) => {
        try {
            // Get all campaigns with stats
            const campaigns = await campaignDao.getAllCampaigns();
            
            // Format dates and add status badges
            const formattedCampaigns = campaigns.map(campaign => {
                return {
                    ...campaign,
                    start_date_formatted: moment(campaign.start_date).format('DD/MM/YYYY'),
                    end_date_formatted: moment(campaign.end_date).format('DD/MM/YYYY'),
                    created_at_formatted: moment(campaign.created_at).format('DD/MM/YYYY HH:mm'),
                    status_class: getStatusClass(campaign.status),
                    status_text: getStatusText(campaign.status)
                };
            });

            res.render('campaigns/campaign-list', {
                title: 'Campaign Management',
                user: req.user,
                campaigns: formattedCampaigns,
                moment: moment
            });

        } catch (error) {
            console.error('Error in getCampaignListPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaigns',
                error: error
            });
        }
    },

    /**
     * GET - New campaign form page
     */
    getNewCampaignPage: async (req, res) => {
        try {
            // Get all locations for dropdown
            const locations = await campaignDao.getAllLocations();

            res.render('campaigns/campaign-new', {
                title: 'Create New Campaign',
                user: req.user,
                locations: locations,
                moment: moment
            });

        } catch (error) {
            console.error('Error in getNewCampaignPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaign form',
                error: error
            });
        }
    },

    /**
     * POST - Create new campaign
     */
    createCampaign: async (req, res) => {
        try {
            // Get user ID - matching your existing pattern
            const userId = req.user.Person_id;
            
            if (!userId) {
                console.error('User ID not found in req.user:', req.user);
                return res.status(400).json({
                    success: false,
                    error: 'User authentication error. Please log in again.'
                });
            }
            
            // Generate unique campaign code
            const campaignCode = await campaignDao.generateCampaignCode();
            
            // Prepare campaign data
            const campaignData = {
                campaign_code: campaignCode,
                location_id: parseInt(req.body.location_id),
                name: req.body.name,
                description: req.body.description || null,
                start_date: req.body.start_date,
                end_date: req.body.end_date,
                status: req.body.status || 'draft',
                prize_description: req.body.prize_description || null,
                created_by: userId
            };
            
            // Validate dates
            if (new Date(campaignData.start_date) > new Date(campaignData.end_date)) {
                return res.status(400).json({
                    success: false,
                    error: 'End date must be after start date'
                });
            }
            
            // Create campaign
            const campaignId = await campaignDao.createCampaign(campaignData);
            
            res.json({
                success: true,
                message: 'Campaign created successfully',
                campaignId: campaignId,
                campaignCode: campaignCode
            });

        } catch (error) {
            console.error('Error in createCampaign:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create campaign'
            });
        }
    },

    /**
     * GET - Campaign questions page
     */
    getCampaignQuestionsPage: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            
            // Get campaign details
            const campaign = await campaignDao.getCampaignById(campaignId);
            
            if (!campaign) {
                return res.status(404).render('error', {
                    message: 'Campaign not found',
                    error: { status: 404 }
                });
            }
            
            // Get existing questions
            const questions = await campaignDao.getCampaignQuestions(campaignId);

            res.render('campaigns/campaign-questions', {
                title: 'Manage Questions - ' + campaign.name,
                user: req.user,
                campaign: campaign,
                questions: questions,
                moment: moment  // ADD THIS
            });

        } catch (error) {
            console.error('Error in getCampaignQuestionsPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaign questions',
                error: error
            });
        }
    },

    /**
     * POST - Create new question
     */
    createQuestion: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            
            // Check if question date already exists
            const dateExists = await campaignDao.checkQuestionDateExists(
                campaignId, 
                req.body.question_date
            );
            
            if (dateExists) {
                return res.status(400).json({
                    success: false,
                    error: 'A question already exists for this date'
                });
            }
            
            // Prepare question data
            const questionData = {
                campaign_id: campaignId,
                question_text: req.body.question_text,
                question_image_url: req.body.question_image_url || null,
                option_a: req.body.option_a,
                option_b: req.body.option_b,
                option_c: req.body.option_c,
                option_d: req.body.option_d,
                correct_answer: req.body.correct_answer,
                question_date: req.body.question_date,
                explanation: req.body.explanation || null
            };
            
            // Create question
            const questionId = await campaignDao.createQuestion(questionData);
            
            res.json({
                success: true,
                message: 'Question created successfully',
                questionId: questionId
            });

        } catch (error) {
            console.error('Error in createQuestion:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create question'
            });
        }
    },

    /**
     * DELETE - Delete question
     */
    deleteQuestion: async (req, res) => {
        try {
            const questionId = parseInt(req.params.questionId);
            
            await campaignDao.deleteQuestion(questionId);
            
            res.json({
                success: true,
                message: 'Question deleted successfully'
            });

        } catch (error) {
            console.error('Error in deleteQuestion:', error);
            
            // Handle specific error messages
            let errorMsg = 'Failed to delete question';
            if (error.message.includes('existing responses')) {
                errorMsg = error.message;
            }
            
            res.status(500).json({
                success: false,
                error: errorMsg
            });
        }
    }
};

/**
 * Helper function to get Bootstrap class for status badge
 */
function getStatusClass(status) {
    const statusClasses = {
        'draft': 'badge-secondary',
        'active': 'badge-success',
        'completed': 'badge-info',
        'cancelled': 'badge-danger'
    };
    return statusClasses[status] || 'badge-secondary';
}

/**
 * Helper function to get display text for status
 */
function getStatusText(status) {
    const statusTexts = {
        'draft': 'Draft',
        'active': 'Active',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
    };
    return statusTexts[status] || status;
}