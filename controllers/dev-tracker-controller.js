// controllers/dev-tracker-controller.js
const devTrackerDao = require('../dao/dev-tracker-dao');
const moment = require('moment');

/**
 * Dev Tracker Controller
 * Hybrid controller that serves both Pug templates (current) and JSON API responses (future)
 * 
 * Pattern:
 * - GET routes render Pug templates for UI
 * - POST/PUT/DELETE routes can return either JSON (for AJAX) or redirect (for forms)
 * - /api/ prefixed routes always return JSON
 */

module.exports = {

    // ============================================================================
    // PAGE ROUTES (Pug Templates)
    // ============================================================================

    // GET /dev-tracker - Main dashboard page
    getDevTrackerPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const filters = {
                status: req.query.status || null,
                type: req.query.type || null,
                priority: req.query.priority || null,
                assigned_to: req.query.assigned_to || null
            };

            const trackers = await devTrackerDao.findTrackers(locationCode, filters);
            
            // Calculate stats from the actual trackers data
            const stats = {
                open: trackers.filter(t => t.status === 'Open').length,
                inProgress: trackers.filter(t => t.status === 'In Progress').length,
                testing: trackers.filter(t => t.status === 'Testing').length,
                complete: trackers.filter(t => t.status === 'Complete').length,
                total: trackers.length
            };

            res.render('dev-tracker', {
                title: 'Dev Tracker',
                user: req.user,
                trackers,
                stats,
                filters,
                currentDate: moment().format('YYYY-MM-DD'),
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getDevTrackerPage:', error);
            req.flash('error', 'Failed to load dev tracker: ' + error.message);
            res.redirect('/home');
        }
    },

    // GET /dev-tracker/:id - View specific tracker with tasks
    getTrackerDetailsPage: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const tracker = await devTrackerDao.findTrackerById(trackerId);

            if (!tracker) {
                req.flash('error', 'Tracker not found');
                return res.redirect('/dev-tracker');
            }

            res.render('dev-tracker-details', {
                title: `Tracker: ${tracker.title}`,
                user: req.user,
                tracker,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getTrackerDetailsPage:', error);
            req.flash('error', 'Failed to load tracker details: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // GET /dev-tracker/new - New tracker form page
    getNewTrackerPage: (req, res) => {
        res.render('dev-tracker-new', {
            title: 'New Dev Tracker Item',
            user: req.user,
            currentDate: moment().format('YYYY-MM-DD'),
            messages: req.flash()
        });
    },

    // GET /dev-tracker/:id/edit - Edit tracker form page
    getEditTrackerPage: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const tracker = await devTrackerDao.findTrackerById(trackerId);

            if (!tracker) {
                req.flash('error', 'Tracker not found');
                return res.redirect('/dev-tracker');
            }

            res.render('dev-tracker-edit', {
                title: `Edit: ${tracker.title}`,
                user: req.user,
                tracker,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getEditTrackerPage:', error);
            req.flash('error', 'Failed to load tracker for editing: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // ============================================================================
    // FORM SUBMISSION ROUTES (Hybrid: Form redirect or AJAX JSON)
    // ============================================================================

    // POST /dev-tracker - Create new tracker
    createTracker: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const userName = req.user.User_Name;

            const trackerData = {
                title: req.body.title,
                description: req.body.description,
                type: req.body.type || 'Task',
                priority: req.body.priority || 'Medium',
                assigned_to: req.body.assigned_to,
                due_date: req.body.due_date || null,
                tags: req.body.tags,
                estimated_hours: req.body.estimated_hours || null,
                location_code: locationCode,
                created_by: userName,
                updated_by: userName
            };

            const newTracker = await devTrackerDao.createTracker(trackerData);

            // Check if it's an AJAX request
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Tracker created successfully',
                    tracker: newTracker
                });
            }

            // Form submission - redirect with flash message
            req.flash('success', 'Tracker created successfully');
            res.redirect(`/dev-tracker/${newTracker.tracker_id}`);

        } catch (error) {
            console.error('Error in createTracker:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create tracker: ' + error.message
                });
            }

            req.flash('error', 'Failed to create tracker: ' + error.message);
            res.redirect('/dev-tracker/new');
        }
    },

    // PUT /dev-tracker/:id - Update tracker
    updateTracker: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const userName = req.user.User_Name;

            const updateData = {
                title: req.body.title,
                description: req.body.description,
                type: req.body.type,
                status: req.body.status,
                priority: req.body.priority,
                assigned_to: req.body.assigned_to,
                due_date: req.body.due_date || null,
                tags: req.body.tags,
                estimated_hours: req.body.estimated_hours || null,
                actual_hours: req.body.actual_hours || null,
                updated_by: userName
            };

            await devTrackerDao.updateTracker(trackerId, updateData);

            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Tracker updated successfully'
                });
            }

            req.flash('success', 'Tracker updated successfully');
            res.redirect(`/dev-tracker/${trackerId}`);

        } catch (error) {
            console.error('Error in updateTracker:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update tracker: ' + error.message
                });
            }

            req.flash('error', 'Failed to update tracker: ' + error.message);
            res.redirect(`/dev-tracker/${req.params.id}/edit`);
        }
    },

    // DELETE /dev-tracker/:id - Soft delete tracker
    deleteTracker: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const userName = req.user.User_Name;

            await devTrackerDao.deleteTracker(trackerId, userName);

            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Tracker deleted successfully'
                });
            }

            req.flash('success', 'Tracker deleted successfully');
            res.redirect('/dev-tracker');

        } catch (error) {
            console.error('Error in deleteTracker:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to delete tracker: ' + error.message
                });
            }

            req.flash('error', 'Failed to delete tracker: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // ============================================================================
    // TASK MANAGEMENT ROUTES
    // ============================================================================

    // POST /dev-tracker/:id/tasks - Create new task
    createTask: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const userName = req.user.User_Name;

            const taskData = {
                tracker_id: trackerId,
                task_title: req.body.task_title,
                task_description: req.body.task_description,
                task_priority: req.body.task_priority || 'Medium',
                assigned_to: req.body.assigned_to,
                due_date: req.body.due_date || null,
                estimated_hours: req.body.estimated_hours || null,
                sequence_order: req.body.sequence_order || 1,
                created_by: userName,
                updated_by: userName
            };

            const newTask = await devTrackerDao.createTask(taskData);

            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Task created successfully',
                    task: newTask
                });
            }

            req.flash('success', 'Task created successfully');
            res.redirect(`/dev-tracker/${trackerId}`);

        } catch (error) {
            console.error('Error in createTask:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create task: ' + error.message
                });
            }

            req.flash('error', 'Failed to create task: ' + error.message);
            res.redirect(`/dev-tracker/${req.params.id}`);
        }
    },

    // PUT /dev-tracker/tasks/:taskId - Update task
    updateTask: async (req, res, next) => {
        try {
            const taskId = req.params.taskId;
            const userName = req.user.User_Name;

            const updateData = {
                task_title: req.body.task_title,
                task_description: req.body.task_description,
                task_status: req.body.task_status,
                task_priority: req.body.task_priority,
                assigned_to: req.body.assigned_to,
                due_date: req.body.due_date || null,
                estimated_hours: req.body.estimated_hours || null,
                actual_hours: req.body.actual_hours || null,
                completion_percentage: req.body.completion_percentage || 0,
                notes: req.body.notes,
                updated_by: userName
            };

            await devTrackerDao.updateTask(taskId, updateData);

            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Task updated successfully'
                });
            }

            // Get tracker ID for redirect
            const task = await devTrackerDao.findTaskById(taskId);
            req.flash('success', 'Task updated successfully');
            res.redirect(`/dev-tracker/${task.tracker_id}`);

        } catch (error) {
            console.error('Error in updateTask:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update task: ' + error.message
                });
            }

            req.flash('error', 'Failed to update task: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // DELETE /dev-tracker/tasks/:taskId - Soft delete task
    deleteTask: async (req, res, next) => {
        try {
            const taskId = req.params.taskId;
            const userName = req.user.User_Name;

            // Get task info before deletion for redirect
            const task = await devTrackerDao.findTaskById(taskId);
            await devTrackerDao.deleteTask(taskId, userName);

            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.json({
                    success: true,
                    message: 'Task deleted successfully'
                });
            }

            req.flash('success', 'Task deleted successfully');
            res.redirect(`/dev-tracker/${task.tracker_id}`);

        } catch (error) {
            console.error('Error in deleteTask:', error);
            
            if (req.xhr || req.headers['content-type'] === 'application/json') {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to delete task: ' + error.message
                });
            }

            req.flash('error', 'Failed to delete task: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // ============================================================================
    // API ROUTES (Always JSON responses)
    // ============================================================================

    // GET /api/dev-tracker - Get trackers list (JSON)
    getTrackersAPI: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const filters = {
                status: req.query.status || null,
                type: req.query.type || null,
                priority: req.query.priority || null,
                assigned_to: req.query.assigned_to || null,
                includeDeleted: req.query.includeDeleted === 'true'
            };

            const trackers = await devTrackerDao.findTrackers(locationCode, filters);
            const stats = await devTrackerDao.getTrackerStats(locationCode);

            res.json({
                success: true,
                data: {
                    trackers,
                    stats,
                    filters
                }
            });
        } catch (error) {
            console.error('Error in getTrackersAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch trackers: ' + error.message
            });
        }
    },

    // GET /api/dev-tracker/:id - Get tracker details (JSON)
    getTrackerAPI: async (req, res, next) => {
        try {
            const trackerId = req.params.id;
            const tracker = await devTrackerDao.findTrackerById(trackerId);

            if (!tracker) {
                return res.status(404).json({
                    success: false,
                    error: 'Tracker not found'
                });
            }

            res.json({
                success: true,
                data: tracker
            });
        } catch (error) {
            console.error('Error in getTrackerAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch tracker: ' + error.message
            });
        }
    },

    // POST /api/dev-tracker/search - Search trackers (JSON)
    searchTrackersAPI: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const searchTerm = req.body.searchTerm;

            if (!searchTerm || searchTerm.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    error: 'Search term must be at least 2 characters'
                });
            }

            const results = await devTrackerDao.searchTrackers(locationCode, searchTerm.trim());

            res.json({
                success: true,
                data: results
            });
        } catch (error) {
            console.error('Error in searchTrackersAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to search trackers: ' + error.message
            });
        }
    },

    // PUT /api/dev-tracker/tasks/:taskId/progress - Update task progress (JSON)
    updateTaskProgressAPI: async (req, res, next) => {
        try {
            const taskId = req.params.taskId;
            const completionPercentage = req.body.completion_percentage;

            if (completionPercentage < 0 || completionPercentage > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'Completion percentage must be between 0 and 100'
                });
            }

            await devTrackerDao.updateTaskProgress(taskId, completionPercentage);

            res.json({
                success: true,
                message: 'Task progress updated successfully'
            });
        } catch (error) {
            console.error('Error in updateTaskProgressAPI:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update task progress: ' + error.message
            });
        }
    }

};