// dao/dev-tracker-dao.js
const db = require("../db/db-connection");
const { Op, Sequelize } = require("sequelize");

const DevTracker = db.dev_tracker;
const DevTrackerTasks = db.dev_tracker_tasks;

module.exports = {
    // Find all trackers with optional filtering (exclude closed by default)
    findTrackers: (locationCode, filters = {}) => {
        const whereClause = {};
        
        if (locationCode) {
            whereClause.location_code = locationCode;
        }
        
        // Exclude closed trackers unless specifically requested
        if (!filters.includeCompleted) {
            whereClause.status = { [Op.ne]: 'Closed' };
        }
        
        // Add filters
        if (filters.status) whereClause.status = filters.status;
        if (filters.type) whereClause.type = filters.type;
        if (filters.priority) whereClause.priority = filters.priority;
        if (filters.assigned_to) whereClause.assigned_to = filters.assigned_to;
        
        return DevTracker.findAll({
            where: whereClause,
            include: [{
                model: DevTrackerTasks,
                as: 'tasks',
                required: false
            }],
            order: [
                ['priority', 'DESC'], // Critical, High, Medium, Low
                ['creation_date', 'DESC']
            ]
        });
    },

    // Find tracker by ID with all tasks
    findTrackerById: (trackerId) => {
        return DevTracker.findByPk(trackerId, {
            include: [{
                model: DevTrackerTasks,
                as: 'tasks',
                order: [['sequence_order', 'ASC'], ['creation_date', 'ASC']]
            }]
        });
    },

    // Create new tracker
    createTracker: (trackerData) => {
        const now = new Date();
        return DevTracker.create({
            ...trackerData,
            creation_date: now,
            updation_date: now
        });
    },

    // Update tracker
    updateTracker: (trackerId, trackerData) => {
        return DevTracker.update({
            ...trackerData,
            updation_date: new Date()
        }, {
            where: { tracker_id: trackerId }
        });
    },

    // Delete tracker (will cascade delete tasks due to FK constraint)
    deleteTracker: (trackerId) => {
        return DevTracker.destroy({
            where: { tracker_id: trackerId }
        });
    },

    // Get tracker summary stats
    getTrackerStats: (locationCode) => {
        const whereClause = locationCode ? { location_code: locationCode } : {};
        
        return DevTracker.findAll({
            attributes: [
                'status',
                'type',
                'priority',
                [Sequelize.fn('COUNT', Sequelize.col('tracker_id')), 'count']
            ],
            where: whereClause,
            group: ['status', 'type', 'priority'],
            raw: true
        });
    },

    // TASK METHODS
    
    // Find all tasks for a tracker
    findTasksByTrackerId: (trackerId) => {
        return DevTrackerTasks.findAll({
            where: { tracker_id: trackerId },
            order: [['sequence_order', 'ASC'], ['creation_date', 'ASC']]
        });
    },

    // Find task by ID
    findTaskById: (taskId) => {
        return DevTrackerTasks.findByPk(taskId, {
            include: [{
                model: DevTracker,
                as: 'tracker',
                attributes: ['tracker_id', 'title', 'type', 'status']
            }]
        });
    },

    // Create new task
    createTask: (taskData) => {
        const now = new Date();
        return DevTrackerTasks.create({
            ...taskData,
            creation_date: now,
            updation_date: now
        });
    },

    // Bulk create tasks
    bulkCreateTasks: (tasksData) => {
        const now = new Date();
        const tasksWithDates = tasksData.map(task => ({
            ...task,
            creation_date: now,
            updation_date: now
        }));
        return DevTrackerTasks.bulkCreate(tasksWithDates);
    },

    // Update task
    updateTask: (taskId, taskData) => {
        return DevTrackerTasks.update({
            ...taskData,
            updation_date: new Date()
        }, {
            where: { task_id: taskId }
        });
    },

    // Delete task
    deleteTask: (taskId) => {
        return DevTrackerTasks.destroy({
            where: { task_id: taskId }
        });
    },

    // Update task completion percentage
    updateTaskProgress: (taskId, completionPercentage) => {
        return DevTrackerTasks.update({
            completion_percentage: completionPercentage,
            updation_date: new Date()
        }, {
            where: { task_id: taskId }
        });
    },

    // Reorder tasks within a tracker
    reorderTasks: (trackerId, taskOrderData) => {
        const updatePromises = taskOrderData.map(({ task_id, sequence_order }) => {
            return DevTrackerTasks.update({
                sequence_order,
                updation_date: new Date()
            }, {
                where: { task_id, tracker_id: trackerId }
            });
        });
        return Promise.all(updatePromises);
    },

    // Get tasks by status across all trackers
    findTasksByStatus: (locationCode, taskStatus) => {
        const whereClause = { task_status: taskStatus };
        
        return DevTrackerTasks.findAll({
            where: whereClause,
            include: [{
                model: DevTracker,
                as: 'tracker',
                where: locationCode ? { location_code: locationCode } : {},
                attributes: ['tracker_id', 'title', 'type', 'status', 'priority']
            }],
            order: [
                [{ model: DevTracker, as: 'tracker' }, 'priority', 'DESC'],
                ['creation_date', 'ASC']
            ]
        });
    },

    // Restore soft deleted tracker
    restoreTracker: (trackerId, restoredBy) => {
        return DevTracker.update({
            is_deleted: 0,
            deleted_by: null,
            deleted_date: null,
            updated_by: restoredBy,
            updation_date: new Date()
        }, {
            where: { tracker_id: trackerId }
        });
    },

    // Restore soft deleted task
    restoreTask: (taskId, restoredBy) => {
        return DevTrackerTasks.update({
            is_deleted: 0,
            deleted_by: null,
            deleted_date: null,
            updated_by: restoredBy,
            updation_date: new Date()
        }, {
            where: { task_id: taskId }
        });
    },
    searchTrackers: (locationCode, searchTerm) => {
        const whereClause = {
            [Op.or]: [
                { title: { [Op.like]: `%${searchTerm}%` } },
                { description: { [Op.like]: `%${searchTerm}%` } },
                { tags: { [Op.like]: `%${searchTerm}%` } }
            ]
        };
        
        if (locationCode) {
            whereClause.location_code = locationCode;
        }
        
        return DevTracker.findAll({
            where: whereClause,
            include: [{
                model: DevTrackerTasks,
                as: 'tasks',
                where: {
                    [Op.or]: [
                        { task_title: { [Op.like]: `%${searchTerm}%` } },
                        { task_description: { [Op.like]: `%${searchTerm}%` } },
                        { notes: { [Op.like]: `%${searchTerm}%` } }
                    ]
                },
                required: false
            }],
            order: [['creation_date', 'DESC']]
        });
    }
};