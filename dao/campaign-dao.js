const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    
    /**
     * Get all campaigns for a location with question and response count
     */
    getAllCampaigns: async (locationCode) => {
        const query = `
            SELECT 
                c.id,
                c.campaign_code,
                c.name,
                c.description,
                c.start_date,
                c.end_date,
                c.status,
                c.prize_description,
                c.created_at,
                l.location_name,
                l.location_code,
                p.Person_Name as created_by_name,
                COUNT(DISTINCT q.id) as question_count,
                COUNT(DISTINCT r.id) as response_count
            FROM m_campaigns c
            INNER JOIN m_location l ON c.location_id = l.location_id
            LEFT JOIN m_persons p ON c.created_by = p.Person_id
            LEFT JOIN m_campaign_questions q ON c.id = q.campaign_id
            LEFT JOIN t_campaign_responses r ON q.id = r.question_id
            WHERE l.location_code = :locationCode
            GROUP BY c.id, c.campaign_code, c.name, c.description, c.start_date,
                     c.end_date, c.status, c.prize_description, c.created_at,
                     l.location_name, l.location_code, p.Person_Name
            ORDER BY c.created_at DESC
        `;

        return await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get campaign by ID
     */
    getCampaignById: async (campaignId) => {
        const query = `
            SELECT 
                c.*,
                l.location_name,
                l.location_code
            FROM m_campaigns c
            INNER JOIN m_location l ON c.location_id = l.location_id
            WHERE c.id = :campaignId
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { campaignId },
            type: QueryTypes.SELECT
        });
        
        return result[0] || null;
    },

    /**
     * Get a location by its code
     */
    getLocationByCode: async (locationCode) => {
        const query = `
            SELECT
                location_id,
                location_name,
                location_code
            FROM m_location
            WHERE location_code = :locationCode
        `;

        const result = await db.sequelize.query(query, {
            replacements: { locationCode },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Update campaign details
     */
    updateCampaign: async (campaignId, campaignData) => {
        const query = `
            UPDATE m_campaigns
            SET name = :name,
                description = :description,
                start_date = :start_date,
                end_date = :end_date,
                status = :status,
                prize_description = :prize_description
            WHERE id = :campaignId
        `;

        await db.sequelize.query(query, {
            replacements: { ...campaignData, campaignId },
            type: QueryTypes.UPDATE
        });

        return true;
    },

    /**
     * Update campaign status only
     */
    updateCampaignStatus: async (campaignId, status) => {
        const query = `
            UPDATE m_campaigns
            SET status = :status
            WHERE id = :campaignId
        `;

        await db.sequelize.query(query, {
            replacements: { campaignId, status },
            type: QueryTypes.UPDATE
        });

        return true;
    },

    /**
     * Count questions dated outside a date range (used before changing campaign dates)
     */
    countQuestionsOutsideRange: async (campaignId, startDate, endDate) => {
        const query = `
            SELECT COUNT(*) as count
            FROM m_campaign_questions
            WHERE campaign_id = :campaignId
            AND (question_date < :startDate OR question_date > :endDate)
        `;

        const result = await db.sequelize.query(query, {
            replacements: { campaignId, startDate, endDate },
            type: QueryTypes.SELECT
        });

        return result[0].count;
    },

    /**
     * Generate unique campaign code
     */
    generateCampaignCode: async () => {
        // Generate random 8-character code
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        
        // Check if code already exists
        const query = `
            SELECT COUNT(*) as count 
            FROM m_campaigns 
            WHERE campaign_code = :code
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { code },
            type: QueryTypes.SELECT
        });
        
        // If exists, generate again (recursive)
        if (result[0].count > 0) {
            return await module.exports.generateCampaignCode();
        }
        
        return code;
    },

    /**
     * Create new campaign
     */
    createCampaign: async (campaignData) => {
        const query = `
            INSERT INTO m_campaigns 
            (campaign_code, location_id, name, description, start_date, end_date, 
             status, prize_description, created_by)
            VALUES 
            (:campaign_code, :location_id, :name, :description, :start_date, :end_date,
             :status, :prize_description, :created_by)
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: campaignData,
            type: QueryTypes.INSERT
        });
        
        return result[0]; // Returns inserted ID
    },

    /**
     * Get campaign questions for a campaign
     */
    getCampaignQuestions: async (campaignId) => {
        const query = `
            SELECT 
                q.*,
                DATE_FORMAT(q.question_date, '%d/%m/%Y') as question_date_formatted,
                (SELECT COUNT(*) FROM t_campaign_responses WHERE question_id = q.id) as response_count,
                (SELECT COUNT(*) FROM t_campaign_responses WHERE question_id = q.id AND is_correct = 1) as correct_count
            FROM m_campaign_questions q
            WHERE q.campaign_id = :campaignId
            ORDER BY q.question_date ASC
        `;
        
        return await db.sequelize.query(query, {
            replacements: { campaignId },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Create new question
     */
    createQuestion: async (questionData) => {
        const query = `
            INSERT INTO m_campaign_questions 
            (campaign_id, question_text, question_image_url, option_a, option_b, 
             option_c, option_d, correct_answer, question_date, explanation)
            VALUES 
            (:campaign_id, :question_text, :question_image_url, :option_a, :option_b,
             :option_c, :option_d, :correct_answer, :question_date, :explanation)
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: questionData,
            type: QueryTypes.INSERT
        });
        
        return result[0]; // Returns inserted ID
    },

    /**
     * Update question
     */
    updateQuestion: async (questionId, questionData) => {
        const query = `
            UPDATE m_campaign_questions
            SET question_text = :question_text,
                question_image_url = :question_image_url,
                option_a = :option_a,
                option_b = :option_b,
                option_c = :option_c,
                option_d = :option_d,
                correct_answer = :correct_answer,
                question_date = :question_date,
                explanation = :explanation
            WHERE id = :questionId
        `;

        await db.sequelize.query(query, {
            replacements: { ...questionData, questionId },
            type: QueryTypes.UPDATE
        });

        return true;
    },

    /**
     * Check if question date already exists for campaign (optionally ignoring one question, for edits)
     */
    checkQuestionDateExists: async (campaignId, questionDate, excludeQuestionId) => {
        const query = `
            SELECT COUNT(*) as count
            FROM m_campaign_questions
            WHERE campaign_id = :campaignId
            AND question_date = :questionDate
            AND id <> :excludeQuestionId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { campaignId, questionDate, excludeQuestionId: excludeQuestionId || 0 },
            type: QueryTypes.SELECT
        });
        
        return result[0].count > 0;
    },

    /**
     * Delete question (only if no responses)
     */
    deleteQuestion: async (questionId) => {
        // First check if there are responses
        const checkQuery = `
            SELECT COUNT(*) as count 
            FROM t_campaign_responses 
            WHERE question_id = :questionId
        `;
        
        const checkResult = await db.sequelize.query(checkQuery, {
            replacements: { questionId },
            type: QueryTypes.SELECT
        });
        
        if (checkResult[0].count > 0) {
            throw new Error('Cannot delete question with existing responses');
        }
        
        const deleteQuery = `
            DELETE FROM m_campaign_questions 
            WHERE id = :questionId
        `;
        
        await db.sequelize.query(deleteQuery, {
            replacements: { questionId },
            type: QueryTypes.DELETE
        });
        
        return true;
    },

    /**
     * Get campaign by campaign code
     */
    getCampaignByCode: async (campaignCode) => {
        const query = `
            SELECT 
                c.*,
                l.location_name,
                l.location_code
            FROM m_campaigns c
            INNER JOIN m_location l ON c.location_id = l.location_id
            WHERE c.campaign_code = :campaignCode
            AND c.status = 'active'
            AND CURDATE() BETWEEN c.start_date AND c.end_date
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { campaignCode },
            type: QueryTypes.SELECT
        });
        
        return result[0] || null;
    },

    /**
     * Get today's question for a campaign
     */
    getTodaysQuestion: async (campaignId) => {
        const query = `
            SELECT 
                q.*
            FROM m_campaign_questions q
            WHERE q.campaign_id = :campaignId
            AND q.question_date = CURDATE()
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { campaignId },
            type: QueryTypes.SELECT
        });
        
        return result[0] || null;
    },

    /**
     * Check if phone number already answered today's question
     */
    checkAlreadyAnswered: async (questionId, phone) => {
        const query = `
            SELECT COUNT(*) as count
            FROM t_campaign_responses
            WHERE question_id = :questionId
            AND participant_phone = :phone
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { questionId, phone },
            type: QueryTypes.SELECT
        });
        
        return result[0].count > 0;
    },

    /**
     * Submit answer
     */
    submitAnswer: async (answerData) => {
        const query = `
            INSERT INTO t_campaign_responses
            (question_id, participant_name, participant_phone, selected_answer, is_correct, ip_address)
            VALUES
            (:question_id, :participant_name, :participant_phone, :selected_answer, :is_correct, :ip_address)
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: answerData,
            type: QueryTypes.INSERT
        });
        
        return result[0]; // Returns inserted ID
    },

    /**
     * Get participant responses for a campaign, with optional date / correct-only filters
     */
    getCampaignResponses: async (campaignId, filters) => {
        let where = 'WHERE q.campaign_id = :campaignId';
        const replacements = { campaignId };

        if (filters.fromDate) {
            where += ' AND q.question_date >= :fromDate';
            replacements.fromDate = filters.fromDate;
        }
        if (filters.toDate) {
            where += ' AND q.question_date <= :toDate';
            replacements.toDate = filters.toDate;
        }
        if (filters.correctOnly) {
            where += ' AND r.is_correct = 1';
        }

        const query = `
            SELECT
                r.id,
                q.question_date,
                q.question_text,
                q.correct_answer,
                r.participant_name,
                r.participant_phone,
                r.selected_answer,
                r.is_correct,
                r.submitted_at,
                r.ip_address,
                q.id as question_id,
                CASE WHEN w.id IS NULL THEN 0 ELSE 1 END as is_winner
            FROM t_campaign_responses r
            INNER JOIN m_campaign_questions q ON q.id = r.question_id
            LEFT JOIN t_campaign_winners w ON w.response_id = r.id
            ${where}
            ORDER BY q.question_date DESC, r.submitted_at ASC
        `;

        return await db.sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get per-day summary for a campaign: response counts and winner (if any)
     */
    getDailyWinnerSummary: async (campaignId) => {
        const query = `
            SELECT
                q.id as question_id,
                q.question_date,
                (SELECT COUNT(*) FROM t_campaign_responses WHERE question_id = q.id) as response_count,
                (SELECT COUNT(*) FROM t_campaign_responses WHERE question_id = q.id AND is_correct = 1) as correct_count,
                w.id as winner_id,
                w.response_id as winner_response_id,
                w.participant_name as winner_name,
                w.participant_phone as winner_phone,
                w.selected_at,
                w.prize_claimed,
                w.prize_claimed_at,
                w.notes
            FROM m_campaign_questions q
            LEFT JOIN t_campaign_winners w ON w.question_id = q.id
            WHERE q.campaign_id = :campaignId
            AND q.question_date <= CURDATE()
            ORDER BY q.question_date DESC
        `;

        return await db.sequelize.query(query, {
            replacements: { campaignId },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get winners for a campaign (for public page / poster) - phone is masked (e.g. 99444xxx53)
     */
    getCampaignWinners: async (campaignId, limit) => {
        const query = `
            SELECT
                q.question_date,
                w.participant_name,
                CONCAT(LEFT(w.participant_phone, 5), 'xxx', RIGHT(w.participant_phone, 2)) as phone_masked,
                w.prize_claimed
            FROM t_campaign_winners w
            INNER JOIN m_campaign_questions q ON q.id = w.question_id
            WHERE q.campaign_id = :campaignId
            ORDER BY q.question_date DESC
            ${limit ? 'LIMIT :limit' : ''}
        `;

        return await db.sequelize.query(query, {
            replacements: { campaignId, limit },
            type: QueryTypes.SELECT
        });
    },

    /**
     * Get a question only if it belongs to the campaign
     */
    getCampaignQuestion: async (campaignId, questionId) => {
        const query = `
            SELECT q.*
            FROM m_campaign_questions q
            WHERE q.id = :questionId
            AND q.campaign_id = :campaignId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { campaignId, questionId },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Get a response only if it belongs to the campaign
     */
    getCampaignResponse: async (campaignId, responseId) => {
        const query = `
            SELECT r.*, q.question_date
            FROM t_campaign_responses r
            INNER JOIN m_campaign_questions q ON q.id = r.question_id
            WHERE r.id = :responseId
            AND q.campaign_id = :campaignId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { campaignId, responseId },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Pick a random correct response for a question
     */
    getRandomCorrectResponse: async (questionId) => {
        const query = `
            SELECT r.*
            FROM t_campaign_responses r
            WHERE r.question_id = :questionId
            AND r.is_correct = 1
            ORDER BY RAND()
            LIMIT 1
        `;

        const result = await db.sequelize.query(query, {
            replacements: { questionId },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Get the winner for a question
     */
    getWinnerByQuestion: async (questionId) => {
        const query = `
            SELECT w.*
            FROM t_campaign_winners w
            WHERE w.question_id = :questionId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { questionId },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Set the winner for a question (replaces an existing unclaimed winner)
     */
    setWinner: async (response) => {
        const existing = await module.exports.getWinnerByQuestion(response.question_id);

        if (existing && existing.prize_claimed == 1) {
            throw new Error('Prize already given to the current winner - cannot change');
        }

        return await db.sequelize.transaction(async (t) => {
            if (existing) {
                await db.sequelize.query(
                    `DELETE FROM t_campaign_winners WHERE id = :id`,
                    { replacements: { id: existing.id }, type: QueryTypes.DELETE, transaction: t }
                );
            }

            const result = await db.sequelize.query(`
                INSERT INTO t_campaign_winners
                (question_id, response_id, participant_name, participant_phone)
                VALUES
                (:question_id, :response_id, :participant_name, :participant_phone)
            `, {
                replacements: {
                    question_id: response.question_id,
                    response_id: response.id,
                    participant_name: response.participant_name,
                    participant_phone: response.participant_phone
                },
                type: QueryTypes.INSERT,
                transaction: t
            });

            return result[0]; // Returns inserted ID
        });
    },

    /**
     * Get a winner only if it belongs to the campaign
     */
    getCampaignWinner: async (campaignId, winnerId) => {
        const query = `
            SELECT w.*
            FROM t_campaign_winners w
            INNER JOIN m_campaign_questions q ON q.id = w.question_id
            WHERE w.id = :winnerId
            AND q.campaign_id = :campaignId
        `;

        const result = await db.sequelize.query(query, {
            replacements: { campaignId, winnerId },
            type: QueryTypes.SELECT
        });

        return result[0] || null;
    },

    /**
     * Mark a winner's prize as given
     */
    markPrizeClaimed: async (winnerId, notes) => {
        const query = `
            UPDATE t_campaign_winners
            SET prize_claimed = 1,
                prize_claimed_at = NOW(),
                notes = :notes
            WHERE id = :winnerId
        `;

        await db.sequelize.query(query, {
            replacements: { winnerId, notes },
            type: QueryTypes.UPDATE
        });

        return true;
    },

    /**
     * Remove a winner (only if prize not yet given)
     */
    removeWinner: async (winnerId) => {
        const query = `
            DELETE FROM t_campaign_winners
            WHERE id = :winnerId
            AND prize_claimed = 0
        `;

        await db.sequelize.query(query, {
            replacements: { winnerId },
            type: QueryTypes.DELETE
        });

        return true;
    },

    /**
     * Get statistics for today's question
     */
    getTodaysQuestionStats: async (questionId) => {
        const query = `
            SELECT 
                COUNT(*) as total_responses,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_responses,
                SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong_responses
            FROM t_campaign_responses
            WHERE question_id = :questionId
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { questionId },
            type: QueryTypes.SELECT
        });
        
        return result[0] || { total_responses: 0, correct_responses: 0, wrong_responses: 0 };
    }
};