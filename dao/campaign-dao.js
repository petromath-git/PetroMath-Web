const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

module.exports = {
    
    /**
     * Get all campaigns with location and question count
     */
    getAllCampaigns: async () => {
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
            GROUP BY c.id, c.campaign_code, c.name, c.description, c.start_date, 
                     c.end_date, c.status, c.prize_description, c.created_at,
                     l.location_name, l.location_code, p.Person_Name
            ORDER BY c.created_at DESC
        `;
        
        return await db.sequelize.query(query, {
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
     * Get all locations for dropdown
     */
    getAllLocations: async () => {
        const query = `
            SELECT 
                location_id,
                location_name,
                location_code
            FROM m_location
            ORDER BY location_name
        `;
        
        return await db.sequelize.query(query, {
            type: QueryTypes.SELECT
        });
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
            return await this.generateCampaignCode();
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
     * Check if question date already exists for campaign
     */
    checkQuestionDateExists: async (campaignId, questionDate) => {
        const query = `
            SELECT COUNT(*) as count 
            FROM m_campaign_questions 
            WHERE campaign_id = :campaignId 
            AND question_date = :questionDate
        `;
        
        const result = await db.sequelize.query(query, {
            replacements: { campaignId, questionDate },
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