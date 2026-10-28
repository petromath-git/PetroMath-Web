// dao/dev-tracker-dao.js
const db = require("../db/db-connection");
const { Op, QueryTypes } = require("sequelize");

const DevTracker = db.dev_tracker;
const DevTrackerTasks = db.dev_tracker_tasks;
const DevTrackerComments = db.dev_tracker_comments;
const DevTrackerWorklog = db.dev_tracker_worklog;

// access = { locations: null (all) | [codes], canManage: bool }
// Reporters see tickets for their stations. Manage users also see platform
// tickets with no station (location_code NULL).
const visibilityWhere = (access) => {
    const where = { is_deleted: { [Op.or]: [0, null] } };
    if (access.locations === null) return where;
    const locs = access.locations.length ? access.locations : ['__none__'];
    if (access.canManage) {
        where[Op.or] = [{ location_code: { [Op.in]: locs } }, { location_code: null }];
    } else {
        where.location_code = { [Op.in]: locs };
    }
    return where;
};

const notDeleted = { is_deleted: { [Op.or]: [0, null] } };

// Keep the ticket's actual_hours = SUM of its work log
const syncActualHours = async (trackerId, transaction) => {
    const total = await DevTrackerWorklog.sum('hours', { where: { tracker_id: trackerId }, transaction });
    await DevTracker.update(
        { actual_hours: total || null },
        { where: { tracker_id: trackerId }, transaction, silent: true }
    );
};

module.exports = {
    visibilityWhere,

    // Ticket list for the dashboard. Closed tickets are hidden unless asked for.
    findTrackers: (access, filters = {}) => {
        const where = visibilityWhere(access);
        where.status = filters.status ? filters.status : { [Op.ne]: 'Closed' };
        if (filters.type) where.type = filters.type;
        if (filters.priority) where.priority = filters.priority;
        if (filters.scope) where.scope = filters.scope;
        if (filters.location_code === 'NONE') where.location_code = null;
        else if (filters.location_code) where.location_code = filters.location_code;
        if (filters.search) {
            const like = `%${filters.search}%`;
            where[Op.and] = [{
                [Op.or]: [
                    { title: { [Op.like]: like } },
                    { description: { [Op.like]: like } },
                    { tags: { [Op.like]: like } }
                ]
            }];
        }

        return DevTracker.findAll({
            where,
            include: [{
                model: DevTrackerTasks,
                as: 'tasks',
                where: notDeleted,
                required: false,
                attributes: ['task_id', 'task_status']
            }],
            order: [
                ['priority', 'DESC'], // ENUM index: Critical, High, Medium, Low
                ['creation_date', 'DESC']
            ]
        });
    },

    // One ticket with its tasks, comments and (for manage users) work log.
    // Returns null if it doesn't exist or this user can't see it.
    findTrackerById: (trackerId, access) => {
        const include = [{
            model: DevTrackerComments,
            as: 'comments',
            required: false,
            where: access.canManage ? undefined : { is_internal: 0 }
        }];
        const order = [[{ model: DevTrackerComments, as: 'comments' }, 'creation_date', 'ASC']];
        if (access.canManage) {
            include.push(
                { model: DevTrackerTasks, as: 'tasks', where: notDeleted, required: false },
                { model: DevTrackerWorklog, as: 'worklog', required: false }
            );
            order.push(
                [{ model: DevTrackerTasks, as: 'tasks' }, 'sequence_order', 'ASC'],
                [{ model: DevTrackerWorklog, as: 'worklog' }, 'work_date', 'DESC']
            );
        }
        return DevTracker.findOne({
            where: { tracker_id: trackerId, ...visibilityWhere(access) },
            include,
            order
        });
    },

    createTracker: (trackerData) => {
        const now = new Date();
        return DevTracker.create({
            ...trackerData,
            creation_date: now,
            updation_date: now
        });
    },

    updateTracker: (trackerId, trackerData) => {
        return DevTracker.update({
            ...trackerData,
            updation_date: new Date()
        }, {
            where: { tracker_id: trackerId }
        });
    },

    deleteTracker: (trackerId, deletedBy) => {
        return DevTracker.update({
            is_deleted: 1,
            deleted_by: deletedBy,
            deleted_date: new Date()
        }, {
            where: { tracker_id: trackerId }
        });
    },

    // TASKS (internal breakdown, manage users only)

    findTaskById: (taskId) => {
        return DevTrackerTasks.findOne({ where: { task_id: taskId, ...notDeleted } });
    },

    createTask: (taskData) => {
        const now = new Date();
        return DevTrackerTasks.create({
            ...taskData,
            creation_date: now,
            updation_date: now
        });
    },

    updateTask: (taskId, taskData) => {
        return DevTrackerTasks.update({
            ...taskData,
            updation_date: new Date()
        }, {
            where: { task_id: taskId }
        });
    },

    deleteTask: (taskId, deletedBy) => {
        return DevTrackerTasks.update({
            is_deleted: 1,
            deleted_by: deletedBy,
            deleted_date: new Date()
        }, {
            where: { task_id: taskId }
        });
    },

    // COMMENTS

    addComment: (commentData) => {
        return DevTrackerComments.create({ ...commentData, creation_date: new Date() });
    },

    // WORK LOG

    addWorklog: (worklogData) => {
        return db.sequelize.transaction(async (transaction) => {
            const row = await DevTrackerWorklog.create(
                { ...worklogData, creation_date: new Date() },
                { transaction }
            );
            await syncActualHours(worklogData.tracker_id, transaction);
            return row;
        });
    },

    deleteWorklog: (worklogId) => {
        return db.sequelize.transaction(async (transaction) => {
            const row = await DevTrackerWorklog.findByPk(worklogId, { transaction });
            if (!row) return null;
            await row.destroy({ transaction });
            await syncActualHours(row.tracker_id, transaction);
            return row;
        });
    },

    // Hours report: every work log row in the period with its ticket's type/scope/station
    getWorklogReport: (fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT w.worklog_id, w.work_date, w.hours, w.note, w.source, w.created_by,
                   t.tracker_id, t.title, t.type, t.scope, t.status, t.location_code
            FROM t_dev_tracker_worklog w
            JOIN t_dev_tracker t ON t.tracker_id = w.tracker_id
            WHERE w.work_date BETWEEN :fromDate AND :toDate
              AND COALESCE(t.is_deleted, 0) = 0
            ORDER BY w.work_date DESC, w.worklog_id DESC`,
            { replacements: { fromDate, toDate }, type: QueryTypes.SELECT }
        );
    },

    // Stations this user can file tickets for
    getLocations: (locations) => {
        const where = { [Op.or]: [{ effective_end_date: null }, { effective_end_date: { [Op.gt]: new Date() } }] };
        if (locations !== null) where.location_code = { [Op.in]: locations.length ? locations : ['__none__'] };
        return db.location.findAll({
            attributes: ['location_code', 'location_name'],
            where,
            order: [['location_code', 'ASC']],
            raw: true
        });
    }
};
