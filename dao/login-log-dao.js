const db = require("../db/db-connection");
const LoginLog = db.loginLog;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");
const useragent = require('useragent');
const dateFormat = require("dateformat");

module.exports = {
    create: (loginData) => {
        const agent = useragent.parse(loginData.user_agent);
        const now = new Date();
        
        return LoginLog.create({
            Person_id: loginData.Person_id,
            ip_address: loginData.ip_address,
            user_agent: loginData.user_agent,
            device_type: agent.device.family,
            browser: agent.family,
            operating_system: agent.os.family,
            device_version: agent.device.major,
            attempted_username: loginData.attempted_username,  // Added this field
            login_status: loginData.login_status,
            failure_reason: loginData.failure_reason,
            location_code: loginData.location_code,
            created_by: loginData.created_by,
            creation_date: dateFormat(now, "yyyy-mm-dd HH:MM:ss")
        });
    },

    findByPersonId: (Person_id, location_code) => {
        return LoginLog.findAll({
            where: {
                Person_id,
                location_code
            },
            order: [['login_timestamp', 'DESC']],
            limit: 50
        });
    },

    findByUsername: (attempted_username, location_code) => {
        return LoginLog.findAll({
            where: {
                attempted_username,
                location_code
            },
            order: [['login_timestamp', 'DESC']],
            limit: 50
        });
    },

    findFailedAttempts: (location_code, startDate, endDate) => {
        return LoginLog.findAll({
            where: {
                location_code,
                login_status: 'failed',
                login_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            },
            order: [['login_timestamp', 'DESC']]
        });
    },

    getLoginStats: async (location_code, startDate, endDate) => {
        return LoginLog.findAll({
            attributes: [
                'login_status',
                'attempted_username',
                [Sequelize.fn('COUNT', Sequelize.col('log_id')), 'count']
            ],
            where: {
                location_code,
                login_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            },
            group: ['login_status', 'attempted_username'],
            order: [['attempted_username', 'ASC']]
        });
    }
};