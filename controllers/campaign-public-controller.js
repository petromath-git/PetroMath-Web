const campaignDao = require("../dao/campaign-dao");
const moment = require('moment');

module.exports = {
    
    /**
     * GET - Public campaign page (no login required)
     */
    getPublicCampaignPage: async (req, res) => {
        try {
            const campaignCode = req.params.campaignCode;
            
            // Get campaign by code
            const campaign = await campaignDao.getCampaignByCode(campaignCode);
            
            if (!campaign) {
                return res.render('campaigns/campaign-not-found', {
                    title: 'Campaign Not Found',
                    message: 'This campaign is not active or has ended.',
                    moment: moment
                });
            }
            
            // Get today's question
            const question = await campaignDao.getTodaysQuestion(campaign.id);
            
            if (!question) {
                return res.render('campaigns/campaign-no-question', {
                    title: campaign.name,
                    campaign: campaign,
                    message: 'No question available for today. Please check back tomorrow!',
                    moment: moment
                });
            }
            
            // Get today's stats
            const stats = await campaignDao.getTodaysQuestionStats(question.id);
            
            res.render('campaigns/campaign-public', {
                title: campaign.name,
                campaign: campaign,
                question: question,
                stats: stats,
                moment: moment
            });

        } catch (error) {
            console.error('Error in getPublicCampaignPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaign',
                error: error
            });
        }
    },
    
    /**
     * POST - Submit answer (no login required)
     */
    submitPublicAnswer: async (req, res) => {
        try {
            const campaignCode = req.params.campaignCode;
            
            // Get campaign
            const campaign = await campaignDao.getCampaignByCode(campaignCode);
            
            if (!campaign) {
                return res.status(404).json({
                    success: false,
                    error: 'Campaign not found or inactive'
                });
            }
            
            // Get today's question
            const question = await campaignDao.getTodaysQuestion(campaign.id);
            
            if (!question) {
                return res.status(404).json({
                    success: false,
                    error: 'No question available for today'
                });
            }
            
            // Validate phone number (10 digits)
            const phone = req.body.phone.trim();
            if (!/^\d{10}$/.test(phone)) {
                return res.status(400).json({
                    success: false,
                    error: 'Please enter a valid 10-digit phone number'
                });
            }
            
            // Check if already answered
            const alreadyAnswered = await campaignDao.checkAlreadyAnswered(question.id, phone);
            
            if (alreadyAnswered) {
                return res.status(400).json({
                    success: false,
                    error: 'You have already answered today\'s question. Please try again tomorrow!'
                });
            }
            
            // Check if answer is correct
            const selectedAnswer = req.body.answer;
            const isCorrect = (selectedAnswer === question.correct_answer);
            
            // Get IP address for fraud prevention
            const ipAddress = req.ip || req.connection.remoteAddress || null;
            
            // Submit answer
            const answerData = {
                question_id: question.id,
                participant_name: req.body.name.trim(),
                participant_phone: phone,
                selected_answer: selectedAnswer,
                is_correct: isCorrect ? 1 : 0,
                ip_address: ipAddress
            };
            
            await campaignDao.submitAnswer(answerData);
            
            // Get updated stats
            const stats = await campaignDao.getTodaysQuestionStats(question.id);
            
            res.json({
                success: true,
                is_correct: isCorrect,
                correct_answer: question.correct_answer,
                explanation: question.explanation,
                stats: stats
            });

        } catch (error) {
            console.error('Error in submitPublicAnswer:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to submit answer. Please try again.'
            });
        }
    }
};