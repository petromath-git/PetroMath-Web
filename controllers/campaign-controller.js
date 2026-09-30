const campaignDao = require("../dao/campaign-dao");
const moment = require('moment');
const ExcelJS = require('exceljs');

const CAMPAIGN_STATUSES = ['draft', 'active', 'completed', 'cancelled'];
const ANSWER_OPTIONS = ['A', 'B', 'C', 'D'];

module.exports = {

    /**
     * Middleware - load the campaign in :id and make sure it belongs to the user's current location.
     * Campaigns of other locations are treated as not found. Sets req.campaign.
     */
    loadCampaign: async (req, res, next) => {
        try {
            const campaignId = parseInt(req.params.id);
            const campaign = campaignId ? await campaignDao.getCampaignById(campaignId) : null;

            if (!campaign || campaign.location_code !== req.user.location_code) {
                if (req.method === 'GET' && !req.xhr) {
                    return res.status(404).render('error', {
                        message: 'Campaign not found',
                        error: { status: 404 }
                    });
                }
                return res.status(404).json({
                    success: false,
                    error: 'Campaign not found'
                });
            }

            req.campaign = campaign;
            next();

        } catch (error) {
            console.error('Error in loadCampaign:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load campaign'
            });
        }
    },

    /**
     * GET - Campaign list page
     */
    getCampaignListPage: async (req, res) => {
        try {
            // Get campaigns of the user's current location with stats
            const campaigns = await campaignDao.getAllCampaigns(req.user.location_code);

            // Format dates and add status badges
            const formattedCampaigns = campaigns.map(campaign => {
                return {
                    ...campaign,
                    start_date_formatted: moment(campaign.start_date).format('DD-MMM-YYYY'),
                    end_date_formatted: moment(campaign.end_date).format('DD-MMM-YYYY'),
                    created_at_formatted: moment(campaign.created_at).format('DD-MMM-YYYY HH:mm'),
                    status_class: getStatusClass(campaign.status),
                    status_text: getStatusText(campaign.status),
                    is_expired: moment(campaign.end_date).isBefore(moment(), 'day')
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
            const location = await campaignDao.getLocationByCode(req.user.location_code);

            res.render('campaigns/campaign-new', {
                title: 'Create New Campaign',
                user: req.user,
                location: location,
                campaign: null,
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

            // Campaign always belongs to the user's current location
            const location = await campaignDao.getLocationByCode(req.user.location_code);

            if (!location) {
                return res.status(400).json({
                    success: false,
                    error: 'Your current location could not be found. Please log in again.'
                });
            }

            const validation = validateCampaignInput(req.body);

            if (validation.error) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            // Generate unique campaign code
            const campaignCode = await campaignDao.generateCampaignCode();

            // Create campaign (always starts as draft)
            const campaignId = await campaignDao.createCampaign({
                ...validation.data,
                campaign_code: campaignCode,
                location_id: location.location_id,
                status: 'draft',
                created_by: userId
            });

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
     * GET - Edit campaign form page
     */
    getEditCampaignPage: async (req, res) => {
        try {
            const campaign = req.campaign;

            res.render('campaigns/campaign-new', {
                title: 'Edit Campaign - ' + campaign.name,
                user: req.user,
                location: { location_name: campaign.location_name },
                campaign: {
                    ...campaign,
                    start_date_ymd: toYmd(campaign.start_date),
                    end_date_ymd: toYmd(campaign.end_date)
                },
                moment: moment
            });

        } catch (error) {
            console.error('Error in getEditCampaignPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaign form',
                error: error
            });
        }
    },

    /**
     * PUT - Update campaign details
     */
    updateCampaign: async (req, res) => {
        try {
            const campaign = req.campaign;

            const validation = validateCampaignInput(req.body, true);

            if (validation.error) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            const data = validation.data;

            // Questions must stay within the campaign dates
            const outside = await campaignDao.countQuestionsOutsideRange(campaign.id, data.start_date, data.end_date);

            if (outside > 0) {
                return res.status(400).json({
                    success: false,
                    error: outside + ' question(s) are dated outside the new start/end dates. Move or delete them first.'
                });
            }

            const statusError = checkStatusAllowed(data.status, data.end_date);

            if (statusError) {
                return res.status(400).json({
                    success: false,
                    error: statusError
                });
            }

            await campaignDao.updateCampaign(campaign.id, data);

            res.json({
                success: true,
                message: 'Campaign updated successfully'
            });

        } catch (error) {
            console.error('Error in updateCampaign:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update campaign'
            });
        }
    },

    /**
     * POST - Change campaign status (activate / complete / cancel / back to draft)
     */
    updateCampaignStatus: async (req, res) => {
        try {
            const campaign = req.campaign;
            const status = req.body.status;

            if (!CAMPAIGN_STATUSES.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }

            const statusError = checkStatusAllowed(status, toYmd(campaign.end_date));

            if (statusError) {
                return res.status(400).json({
                    success: false,
                    error: statusError
                });
            }

            await campaignDao.updateCampaignStatus(campaign.id, status);

            res.json({
                success: true,
                message: 'Campaign is now ' + getStatusText(status)
            });

        } catch (error) {
            console.error('Error in updateCampaignStatus:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to change campaign status'
            });
        }
    },

    /**
     * GET - Campaign questions page
     */
    getCampaignQuestionsPage: async (req, res) => {
        try {
            const campaign = req.campaign;

            // Get existing questions
            const questions = await campaignDao.getCampaignQuestions(campaign.id);

            res.render('campaigns/campaign-questions', {
                title: 'Manage Questions - ' + campaign.name,
                user: req.user,
                campaign: {
                    ...campaign,
                    start_date_ymd: toYmd(campaign.start_date),
                    end_date_ymd: toYmd(campaign.end_date)
                },
                questions: questions.map(q => ({
                    ...q,
                    question_date_formatted: moment(q.question_date).format('DD-MMM-YYYY'),
                    question_date_ymd: toYmd(q.question_date)
                })),
                moment: moment
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
            const campaign = req.campaign;

            const validation = validateQuestionInput(req.body, campaign);

            if (validation.error) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            // Check if question date already exists
            const dateExists = await campaignDao.checkQuestionDateExists(
                campaign.id,
                validation.data.question_date
            );

            if (dateExists) {
                return res.status(400).json({
                    success: false,
                    error: 'A question already exists for this date'
                });
            }

            // Create question
            const questionId = await campaignDao.createQuestion({
                ...validation.data,
                campaign_id: campaign.id
            });

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
     * PUT - Update question.
     * Once a question has responses, its date and correct answer are locked
     * (changing them would invalidate the stored is_correct of every response).
     */
    updateQuestion: async (req, res) => {
        try {
            const campaign = req.campaign;
            const questionId = parseInt(req.params.questionId);

            const question = await campaignDao.getCampaignQuestion(campaign.id, questionId);

            if (!question) {
                return res.status(404).json({
                    success: false,
                    error: 'Question not found for this campaign'
                });
            }

            const validation = validateQuestionInput(req.body, campaign);

            if (validation.error) {
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }

            const data = validation.data;
            const stats = await campaignDao.getTodaysQuestionStats(questionId);

            if (stats.total_responses > 0) {
                if (data.correct_answer !== question.correct_answer || data.question_date !== toYmd(question.question_date)) {
                    return res.status(400).json({
                        success: false,
                        error: 'This question already has responses - its date and correct answer cannot be changed'
                    });
                }
            }

            const dateExists = await campaignDao.checkQuestionDateExists(campaign.id, data.question_date, questionId);

            if (dateExists) {
                return res.status(400).json({
                    success: false,
                    error: 'A question already exists for this date'
                });
            }

            await campaignDao.updateQuestion(questionId, data);

            res.json({
                success: true,
                message: 'Question updated successfully'
            });

        } catch (error) {
            console.error('Error in updateQuestion:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update question'
            });
        }
    },

    /**
     * GET - Campaign responses page
     */
    getCampaignResponsesPage: async (req, res) => {
        try {
            const campaign = req.campaign;

            const filters = getResponseFilters(req.query);
            const responses = await campaignDao.getCampaignResponses(campaign.id, filters);

            const formattedResponses = responses.map(r => ({
                ...r,
                question_date_formatted: moment(r.question_date).format('DD-MMM-YYYY'),
                submitted_at_formatted: moment(r.submitted_at).format('DD-MMM-YYYY hh:mm A')
            }));

            const correctCount = responses.filter(r => r.is_correct == 1).length;
            const uniquePhones = new Set(responses.map(r => r.participant_phone)).size;

            const dailyWinners = (await campaignDao.getDailyWinnerSummary(campaign.id)).map(d => ({
                ...d,
                question_date_formatted: moment(d.question_date).format('DD-MMM-YYYY'),
                is_today: moment(d.question_date).isSame(moment(), 'day'),
                prize_claimed_at_formatted: d.prize_claimed_at ? moment(d.prize_claimed_at).format('DD-MMM-YYYY hh:mm A') : null
            }));

            res.render('campaigns/campaign-responses', {
                title: 'Responses - ' + campaign.name,
                user: req.user,
                campaign: campaign,
                responses: formattedResponses,
                dailyWinners: dailyWinners,
                filters: filters,
                summary: {
                    total: responses.length,
                    correct: correctCount,
                    wrong: responses.length - correctCount,
                    participants: uniquePhones
                },
                moment: moment
            });

        } catch (error) {
            console.error('Error in getCampaignResponsesPage:', error);
            res.status(500).render('error', {
                message: 'Error loading campaign responses',
                error: error
            });
        }
    },

    /**
     * GET - Export campaign responses to Excel
     */
    exportCampaignResponses: async (req, res) => {
        try {
            const campaign = req.campaign;

            const filters = getResponseFilters(req.query);
            const responses = await campaignDao.getCampaignResponses(campaign.id, filters);

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Responses');

            sheet.columns = [
                { header: 'Question Date', key: 'question_date', width: 15 },
                { header: 'Question', key: 'question_text', width: 50 },
                { header: 'Name', key: 'participant_name', width: 25 },
                { header: 'Mobile', key: 'participant_phone', width: 14 },
                { header: 'Answer', key: 'selected_answer', width: 9 },
                { header: 'Correct Answer', key: 'correct_answer', width: 15 },
                { header: 'Result', key: 'result', width: 10 },
                { header: 'Winner', key: 'winner', width: 9 },
                { header: 'Submitted At', key: 'submitted_at', width: 22 }
            ];
            sheet.getRow(1).font = { bold: true };

            responses.forEach(r => {
                sheet.addRow({
                    question_date: moment(r.question_date).format('DD-MMM-YYYY'),
                    question_text: r.question_text,
                    participant_name: r.participant_name,
                    participant_phone: r.participant_phone,
                    selected_answer: r.selected_answer,
                    correct_answer: r.correct_answer,
                    result: r.is_correct == 1 ? 'Correct' : 'Wrong',
                    winner: r.is_winner == 1 ? 'Yes' : '',
                    submitted_at: moment(r.submitted_at).format('DD-MMM-YYYY hh:mm A')
                });
            });

            const fileName = `campaign-${campaign.campaign_code}-responses.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            await workbook.xlsx.write(res);
            res.end();

        } catch (error) {
            console.error('Error in exportCampaignResponses:', error);
            res.status(500).send('Failed to export responses');
        }
    },

    /**
     * POST - Randomly draw a winner from correct answers for a question
     */
    drawWinner: async (req, res) => {
        try {
            const campaignId = req.campaign.id;
            const questionId = parseInt(req.params.questionId);

            const question = await campaignDao.getCampaignQuestion(campaignId, questionId);

            if (!question) {
                return res.status(404).json({
                    success: false,
                    error: 'Question not found for this campaign'
                });
            }

            const response = await campaignDao.getRandomCorrectResponse(questionId);

            if (!response) {
                return res.status(400).json({
                    success: false,
                    error: 'No correct answers for this day - cannot draw a winner'
                });
            }

            await campaignDao.setWinner(response);

            res.json({
                success: true,
                message: 'Winner drawn: ' + response.participant_name + ' (' + response.participant_phone + ')'
            });

        } catch (error) {
            console.error('Error in drawWinner:', error);
            res.status(500).json({
                success: false,
                error: error.message.includes('Prize already given') ? error.message : 'Failed to draw winner'
            });
        }
    },

    /**
     * POST - Manually mark a response as winner
     */
    markWinner: async (req, res) => {
        try {
            const campaignId = req.campaign.id;
            const responseId = parseInt(req.params.responseId);

            const response = await campaignDao.getCampaignResponse(campaignId, responseId);

            if (!response) {
                return res.status(404).json({
                    success: false,
                    error: 'Response not found for this campaign'
                });
            }

            if (response.is_correct != 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Only a correct answer can be marked as winner'
                });
            }

            await campaignDao.setWinner(response);

            res.json({
                success: true,
                message: 'Winner marked: ' + response.participant_name + ' (' + response.participant_phone + ')'
            });

        } catch (error) {
            console.error('Error in markWinner:', error);
            res.status(500).json({
                success: false,
                error: error.message.includes('Prize already given') ? error.message : 'Failed to mark winner'
            });
        }
    },

    /**
     * POST - Mark winner's prize as given
     */
    markPrizeClaimed: async (req, res) => {
        try {
            const campaignId = req.campaign.id;
            const winnerId = parseInt(req.params.winnerId);

            const winner = await campaignDao.getCampaignWinner(campaignId, winnerId);

            if (!winner) {
                return res.status(404).json({
                    success: false,
                    error: 'Winner not found for this campaign'
                });
            }

            await campaignDao.markPrizeClaimed(winnerId, String(req.body.notes || '').trim().substring(0, 1000) || null);

            res.json({
                success: true,
                message: 'Prize marked as given'
            });

        } catch (error) {
            console.error('Error in markPrizeClaimed:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark prize as given'
            });
        }
    },

    /**
     * DELETE - Remove a winner (prize not yet given)
     */
    removeWinner: async (req, res) => {
        try {
            const campaignId = req.campaign.id;
            const winnerId = parseInt(req.params.winnerId);

            const winner = await campaignDao.getCampaignWinner(campaignId, winnerId);

            if (!winner) {
                return res.status(404).json({
                    success: false,
                    error: 'Winner not found for this campaign'
                });
            }

            if (winner.prize_claimed == 1) {
                return res.status(400).json({
                    success: false,
                    error: 'Prize already given - cannot remove this winner'
                });
            }

            await campaignDao.removeWinner(winnerId);

            res.json({
                success: true,
                message: 'Winner removed'
            });

        } catch (error) {
            console.error('Error in removeWinner:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove winner'
            });
        }
    },

    /**
     * GET - Printable winners poster
     */
    getWinnersPosterPage: async (req, res) => {
        try {
            const campaign = req.campaign;

            const winners = await campaignDao.getCampaignWinners(campaign.id);

            res.render('campaigns/campaign-winners-print', {
                title: 'Winners - ' + campaign.name,
                campaign: campaign,
                winners: winners.map(w => ({
                    ...w,
                    question_date_formatted: moment(w.question_date).format('DD-MMM-YYYY')
                })),
                moment: moment
            });

        } catch (error) {
            console.error('Error in getWinnersPosterPage:', error);
            res.status(500).render('error', {
                message: 'Error loading winners poster',
                error: error
            });
        }
    },

    /**
     * DELETE - Delete question
     */
    deleteQuestion: async (req, res) => {
        try {
            const questionId = parseInt(req.params.questionId);

            const question = await campaignDao.getCampaignQuestion(req.campaign.id, questionId);

            if (!question) {
                return res.status(404).json({
                    success: false,
                    error: 'Question not found for this campaign'
                });
            }

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
 * Helper function to format a DATE value as YYYY-MM-DD (for date inputs and comparisons)
 */
function toYmd(date) {
    return date ? moment(date).format('YYYY-MM-DD') : null;
}

/**
 * Helper function to check a YYYY-MM-DD date string
 */
function isValidYmd(value) {
    return typeof value === 'string' && moment(value, 'YYYY-MM-DD', true).isValid();
}

/**
 * Helper function to trim a text field; returns null when empty
 */
function cleanText(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
}

/**
 * Helper function to validate campaign form input
 */
function validateCampaignInput(body, includeStatus) {
    const data = {
        name: cleanText(body.name),
        description: cleanText(body.description),
        start_date: body.start_date,
        end_date: body.end_date,
        prize_description: cleanText(body.prize_description)
    };

    if (!data.name) return { error: 'Campaign name is required' };
    if (data.name.length > 255) return { error: 'Campaign name is too long (max 255 characters)' };
    if (data.prize_description && data.prize_description.length > 255) return { error: 'Prize description is too long (max 255 characters)' };
    if (!isValidYmd(data.start_date) || !isValidYmd(data.end_date)) return { error: 'Valid start and end dates are required' };
    if (data.start_date > data.end_date) return { error: 'End date must be on or after start date' };

    if (includeStatus) {
        if (!CAMPAIGN_STATUSES.includes(body.status)) return { error: 'Invalid status' };
        data.status = body.status;
    }

    return { data };
}

/**
 * Helper function to validate question form input against the campaign dates
 */
function validateQuestionInput(body, campaign) {
    const data = {
        question_text: cleanText(body.question_text),
        question_image_url: cleanText(body.question_image_url),
        option_a: cleanText(body.option_a),
        option_b: cleanText(body.option_b),
        option_c: cleanText(body.option_c),
        option_d: cleanText(body.option_d),
        correct_answer: body.correct_answer,
        question_date: body.question_date,
        explanation: cleanText(body.explanation)
    };

    if (!data.question_text) return { error: 'Question text is required' };
    if (!data.option_a || !data.option_b || !data.option_c || !data.option_d) return { error: 'All four options are required' };
    if ([data.option_a, data.option_b, data.option_c, data.option_d].some(o => o.length > 255)) return { error: 'Options can be at most 255 characters' };
    if (!ANSWER_OPTIONS.includes(data.correct_answer)) return { error: 'Please select the correct answer (A, B, C or D)' };
    if (data.question_image_url && (!/^https?:\/\//i.test(data.question_image_url) || data.question_image_url.length > 500)) {
        return { error: 'Image URL must start with http:// or https:// (max 500 characters)' };
    }
    if (!isValidYmd(data.question_date)) return { error: 'A valid question date is required' };
    if (data.question_date < toYmd(campaign.start_date) || data.question_date > toYmd(campaign.end_date)) {
        return { error: 'Question date must be within the campaign dates' };
    }

    return { data };
}

/**
 * Helper function - a campaign can't be made active once its end date has passed
 */
function checkStatusAllowed(status, endDateYmd) {
    if (status === 'active' && endDateYmd < moment().format('YYYY-MM-DD')) {
        return 'The end date has already passed - extend the end date before activating';
    }
    return null;
}

/**
 * Helper function to read response filters from the query string
 */
function getResponseFilters(query) {
    return {
        fromDate: isValidYmd(query.from_date) ? query.from_date : null,
        toDate: isValidYmd(query.to_date) ? query.to_date : null,
        correctOnly: query.correct_only === '1'
    };
}

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
