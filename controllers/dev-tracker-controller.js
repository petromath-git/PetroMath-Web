// controllers/dev-tracker-controller.js
const devTrackerDao = require('../dao/dev-tracker-dao');
const DocumentStoreDao = require('../dao/document-store-dao');
const security = require('../utils/app-security');
const moment = require('moment');
const path = require('path');

/**
 * Support Tickets (/dev-tracker)
 *
 * Access is by menu grant, not by role:
 * - DEV_TRACKER        raise tickets, see tickets for your stations, comment
 * - DEV_TRACKER_MANAGE triage (status/priority/assignee/scope), tasks, work log, delete
 *
 * Reporters never see due dates, hours, assignee or internal tasks/comments, so
 * granting DEV_TRACKER to station users later doesn't set expectations we can't meet.
 */

const TYPES = ['Bug', 'Feature', 'Enhancement', 'Task'];
const REPORTER_TYPES = ['Bug', 'Feature', 'Enhancement'];
const STATUSES = ['Open', 'In Progress', 'Testing', 'Complete', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const { HOURS_RANGES, TOKEN_RANGES } = devTrackerDao;

// Attachments: screenshots / photos / PDFs in t_document_store
// (entity_type SUPPORT_TICKET, entity_id = tracker_id).
const ATTACHMENT_ENTITY = 'SUPPORT_TICKET';
const ATTACHMENT_MAX_FILES = 2;
const ATTACHMENT_MAX_MB = 5;
const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXTENSION = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

// The real type from the file's first bytes; the browser-declared type can be
// anything. Returns null for anything that isn't a JPEG / PNG / WebP / PDF.
const sniffType = (buf) => {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
    return null;
};

// Plain file name for storage and the download header: no path, no quotes or
// control characters, extension matching the real type.
const safeFileName = (original, mimeType) => {
    const base = path.basename(original || 'attachment')
        .replace(/\.[^.]*$/, '')
        .replace(/[^\w\- ()]+/g, '_')
        .trim()
        .slice(0, 80) || 'attachment';
    return base + EXTENSION[mimeType];
};

// Validates uploaded files against what the ticket already has.
// Returns { error } or { files: [{ file_name, mime_type, buffer }] }.
const checkAttachments = (req, existingCount) => {
    if (req.uploadError) return { error: req.uploadError };
    const uploaded = req.files || [];
    if (existingCount + uploaded.length > ATTACHMENT_MAX_FILES) {
        return { error: `A ticket can have at most ${ATTACHMENT_MAX_FILES} attachments` };
    }
    const files = [];
    for (const f of uploaded) {
        const mimeType = sniffType(f.buffer);
        if (!mimeType) return { error: `${path.basename(f.originalname)} is not a valid photo or PDF` };
        files.push({ file_name: safeFileName(f.originalname, mimeType), mime_type: mimeType, buffer: f.buffer });
    }
    return { files };
};

const saveAttachments = (files, tracker, userName) => Promise.all(files.map(f =>
    DocumentStoreDao.create({
        entity_type: ATTACHMENT_ENTITY,
        entity_id: tracker.tracker_id,
        doc_category: 'ATTACHMENT',
        file_name: f.file_name,
        mime_type: f.mime_type,
        file_size: f.buffer.length,
        file_data: f.buffer,
        capture_source: 'UPLOAD',
        location_code: tracker.location_code,
        created_by: userName
    })
));

const fmtSize = (bytes) => (bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

const getAccess = (user) => ({
    locations: security.getAccessibleLocations(user),
    canManage: security.hasMenuChk(user, 'DEV_TRACKER_MANAGE'),
    isSuperUser: !!user && user.Role === 'SuperUser'
});

// Claude conversation links (SuperUser only): one per line, each an https://
// link or a Claude Code session id. Returns { error } or { value } for saving.
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const checkClaudeLinks = (text) => {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const l of lines) {
        if (!SESSION_ID.test(l) && !/^https:\/\/[^\s"'<>]+$/.test(l)) {
            return { error: `Not a link or session id: ${l.slice(0, 60)}` };
        }
    }
    return { value: lines.length ? lines.join('\n').slice(0, 4000) : null };
};

// For display: [{ url } | { sessionId }]
const parseClaudeLinks = (text) => String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    .map(l => (l.startsWith('https://') ? { url: l } : { sessionId: l }));

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const fmtDate = (d) => (d ? moment(d).format('DD-MMM-YYYY') : '');

const wantsJson = (req) => req.xhr || (req.headers['content-type'] || '').includes('application/json');

const sendError = (req, res, status, message, redirectTo) => {
    if (wantsJson(req)) return res.status(status).json({ success: false, error: message });
    req.flash('error', message);
    res.redirect(redirectTo);
};

// Station + scope from the form. Manage users may leave the station blank for a
// platform ticket (scope ALL); everyone else must pick one of their stations.
const resolveStation = (req, access) => {
    const locationCode = (req.body.location_code || '').trim() || null;
    if (!locationCode) {
        if (!access.canManage) return { error: 'Please choose the station this ticket is for' };
        return { location_code: null, scope: 'ALL' };
    }
    if (!security.canAccessLocation(req.user, locationCode)) {
        return { error: 'You cannot raise tickets for station ' + locationCode };
    }
    const scope = access.canManage ? pick(req.body.scope, ['LOCATION', 'ALL'], 'LOCATION') : 'LOCATION';
    return { location_code: locationCode, scope };
};

module.exports = {
    ATTACHMENT_MAX_FILES,
    ATTACHMENT_MAX_MB,
    ATTACHMENT_MIME_TYPES,

    // GET /dev-tracker
    getDevTrackerPage: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const filters = {
                status: pick(req.query.status, STATUSES, null),
                type: pick(req.query.type, TYPES, null),
                priority: pick(req.query.priority, PRIORITIES, null),
                scope: access.canManage ? pick(req.query.scope, ['LOCATION', 'ALL'], null) : null,
                location_code: req.query.location_code || null,
                search: (req.query.search || '').trim() || null,
                // Hours are shown to manage users, Claude tokens to SuperUser only
                hours: access.canManage ? pick(req.query.hours, Object.keys(HOURS_RANGES), null) : null,
                tokens: access.isSuperUser ? pick(req.query.tokens, Object.keys(TOKEN_RANGES), null) : null
            };

            const [trackers, locations] = await Promise.all([
                devTrackerDao.findTrackers(access, filters),
                devTrackerDao.getLocations(access.locations)
            ]);

            const docs = await DocumentStoreDao.findByEntities(ATTACHMENT_ENTITY, trackers.map(t => t.tracker_id));
            const attachmentCount = {};
            docs.forEach(d => { attachmentCount[d.entity_id] = (attachmentCount[d.entity_id] || 0) + 1; });

            const stats = {
                open: trackers.filter(t => t.status === 'Open').length,
                inProgress: trackers.filter(t => t.status === 'In Progress').length,
                testing: trackers.filter(t => t.status === 'Testing').length,
                complete: trackers.filter(t => t.status === 'Complete').length
            };

            res.render('dev-tracker', {
                title: 'Support Tickets',
                user: req.user,
                mobileReady: true,
                trackers,
                attachmentCount,
                stats,
                filters,
                locations,
                canManage: access.canManage,
                isSuperUser: access.isSuperUser,
                hoursRanges: HOURS_RANGES,
                tokenRanges: TOKEN_RANGES,
                fmtDate,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getDevTrackerPage:', error);
            req.flash('error', 'Failed to load tickets: ' + error.message);
            res.redirect('/home');
        }
    },

    // GET /dev-tracker/new
    getNewTrackerPage: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const locations = await devTrackerDao.getLocations(access.locations);
            res.render('dev-tracker-new', {
                title: 'Support Tickets',
                user: req.user,
                mobileReady: true,
                locations,
                canManage: access.canManage,
                types: access.canManage ? TYPES : REPORTER_TYPES,
                currentLocation: req.user.location_code,
                maxFiles: ATTACHMENT_MAX_FILES,
                maxMb: ATTACHMENT_MAX_MB,
                messages: req.flash()
            });
        } catch (error) {
            next(error);
        }
    },

    // GET /dev-tracker/:id
    getTrackerDetailsPage: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const tracker = await devTrackerDao.findTrackerById(req.params.id, access);
            if (!tracker) {
                req.flash('error', 'Ticket not found');
                return res.redirect('/dev-tracker');
            }

            const attachments = (await DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, tracker.tracker_id)).reverse();

            res.render('dev-tracker-details', {
                title: 'Support Tickets',
                user: req.user,
                mobileReady: true,
                tracker,
                attachments,
                maxFiles: ATTACHMENT_MAX_FILES,
                maxMb: ATTACHMENT_MAX_MB,
                fmtSize,
                claudeLinks: access.isSuperUser ? parseClaudeLinks(tracker.claude_links) : [],
                isSuperUser: access.isSuperUser,
                canManage: access.canManage,
                fmtDate,
                fmtDateTime: (d) => (d ? moment(d).format('DD-MMM-YYYY hh:mm A') : ''),
                today: moment().format('YYYY-MM-DD'),
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getTrackerDetailsPage:', error);
            req.flash('error', 'Failed to load ticket: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // GET /dev-tracker/:id/edit (manage)
    getEditTrackerPage: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const [tracker, locations] = await Promise.all([
                devTrackerDao.findTrackerById(req.params.id, access),
                devTrackerDao.getLocations(access.locations)
            ]);
            if (!tracker) {
                req.flash('error', 'Ticket not found');
                return res.redirect('/dev-tracker');
            }

            res.render('dev-tracker-edit', {
                title: 'Support Tickets',
                user: req.user,
                mobileReady: true,
                tracker,
                locations,
                isSuperUser: access.isSuperUser,
                types: TYPES,
                statuses: STATUSES,
                priorities: PRIORITIES,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getEditTrackerPage:', error);
            req.flash('error', 'Failed to load ticket for editing: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // POST /dev-tracker
    createTracker: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const userName = req.user.User_Name;
            const title = (req.body.title || '').trim();
            if (!title) return sendError(req, res, 400, 'Title is required', '/dev-tracker/new');

            const station = resolveStation(req, access);
            if (station.error) return sendError(req, res, 400, station.error, '/dev-tracker/new');

            // Check the files before creating anything
            const upload = checkAttachments(req, 0);
            if (upload.error) return sendError(req, res, 400, upload.error, '/dev-tracker/new');

            const trackerData = {
                title,
                description: req.body.description,
                type: pick(req.body.type, access.canManage ? TYPES : REPORTER_TYPES, 'Bug'),
                priority: pick(req.body.priority, PRIORITIES, 'Medium'),
                status: 'Open',
                location_code: station.location_code,
                scope: station.scope,
                created_by: userName,
                updated_by: userName
            };
            if (access.canManage) {
                Object.assign(trackerData, {
                    assigned_to: req.body.assigned_to || null,
                    due_date: req.body.due_date || null,
                    tags: req.body.tags || null,
                    estimated_hours: req.body.estimated_hours || null
                });
            }

            const newTracker = await devTrackerDao.createTracker(trackerData);

            if (upload.files.length) {
                try {
                    await saveAttachments(upload.files, newTracker, userName);
                } catch (err) {
                    // The ticket is saved; the files can be added again from its page
                    console.error('Error saving ticket attachments:', err);
                    req.flash('error', 'Ticket created, but the attachments could not be saved. Please attach them again.');
                    return res.redirect(`/dev-tracker/${newTracker.tracker_id}`);
                }
            }

            if (wantsJson(req)) {
                return res.json({ success: true, message: 'Ticket created', tracker: newTracker });
            }
            req.flash('success', `Ticket #${newTracker.tracker_id} created`);
            res.redirect(`/dev-tracker/${newTracker.tracker_id}`);
        } catch (error) {
            console.error('Error in createTracker:', error);
            sendError(req, res, 500, 'Failed to create ticket: ' + error.message, '/dev-tracker/new');
        }
    },

    // PUT /dev-tracker/:id (manage)
    updateTracker: async (req, res, next) => {
        const trackerId = req.params.id;
        try {
            const access = getAccess(req.user);
            const existing = await devTrackerDao.findTrackerById(trackerId, access);
            if (!existing) return sendError(req, res, 404, 'Ticket not found', '/dev-tracker');

            const station = resolveStation(req, access);
            if (station.error) return sendError(req, res, 400, station.error, `/dev-tracker/${trackerId}/edit`);

            // Only SuperUser sees the field, so only a SuperUser save may change it
            const extra = {};
            if (access.isSuperUser && req.body.claude_links !== undefined) {
                const links = checkClaudeLinks(req.body.claude_links);
                if (links.error) return sendError(req, res, 400, links.error, `/dev-tracker/${trackerId}/edit`);
                extra.claude_links = links.value;
            }
            if (access.isSuperUser && req.body.dev_notes !== undefined) {
                extra.dev_notes = String(req.body.dev_notes).replace(/\r\n/g, '\n').trim().slice(0, 20000) || null;
            }

            await devTrackerDao.updateTracker(trackerId, {
                ...extra,
                title: (req.body.title || existing.title).trim(),
                description: req.body.description,
                type: pick(req.body.type, TYPES, existing.type),
                status: pick(req.body.status, STATUSES, existing.status),
                priority: pick(req.body.priority, PRIORITIES, existing.priority),
                location_code: station.location_code,
                scope: station.scope,
                assigned_to: req.body.assigned_to || null,
                due_date: req.body.due_date || null,
                tags: req.body.tags || null,
                estimated_hours: req.body.estimated_hours || null,
                updated_by: req.user.User_Name
            });

            if (wantsJson(req)) return res.json({ success: true, message: 'Ticket updated' });
            req.flash('success', 'Ticket updated');
            res.redirect(`/dev-tracker/${trackerId}`);
        } catch (error) {
            console.error('Error in updateTracker:', error);
            sendError(req, res, 500, 'Failed to update ticket: ' + error.message, `/dev-tracker/${trackerId}/edit`);
        }
    },

    // DELETE /dev-tracker/:id (manage) - soft delete
    deleteTracker: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const existing = await devTrackerDao.findTrackerById(req.params.id, access);
            if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });

            await devTrackerDao.deleteTracker(req.params.id, req.user.User_Name);
            res.json({ success: true, message: 'Ticket deleted' });
        } catch (error) {
            console.error('Error in deleteTracker:', error);
            res.status(500).json({ success: false, error: 'Failed to delete ticket: ' + error.message });
        }
    },

    // POST /dev-tracker/:id/comments
    addComment: async (req, res, next) => {
        const trackerId = req.params.id;
        try {
            const access = getAccess(req.user);
            const tracker = await devTrackerDao.findTrackerById(trackerId, access);
            if (!tracker) return sendError(req, res, 404, 'Ticket not found', '/dev-tracker');

            const text = (req.body.comment_text || '').trim();
            if (!text) return sendError(req, res, 400, 'Comment cannot be empty', `/dev-tracker/${trackerId}`);

            await devTrackerDao.addComment({
                tracker_id: trackerId,
                comment_text: text,
                is_internal: access.canManage && (req.body.is_internal === 'on' || req.body.is_internal === true) ? 1 : 0,
                created_by: req.user.User_Name
            });

            if (wantsJson(req)) return res.json({ success: true });
            res.redirect(`/dev-tracker/${trackerId}#comments`);
        } catch (error) {
            console.error('Error in addComment:', error);
            sendError(req, res, 500, 'Failed to add comment: ' + error.message, `/dev-tracker/${trackerId}`);
        }
    },

    // POST /dev-tracker/:id/attachments - anyone who can see the ticket
    addAttachments: async (req, res, next) => {
        const trackerId = req.params.id;
        const back = `/dev-tracker/${trackerId}#attachments`;
        try {
            const tracker = await devTrackerDao.findTrackerById(trackerId, getAccess(req.user));
            if (!tracker) return sendError(req, res, 404, 'Ticket not found', '/dev-tracker');

            const existing = await DocumentStoreDao.findByEntity(ATTACHMENT_ENTITY, tracker.tracker_id);
            const upload = checkAttachments(req, existing.length);
            if (upload.error) return sendError(req, res, 400, upload.error, back);
            if (!upload.files.length) return sendError(req, res, 400, 'Choose a file to attach', back);

            await saveAttachments(upload.files, tracker, req.user.User_Name);
            if (wantsJson(req)) return res.json({ success: true });
            req.flash('success', upload.files.length === 1 ? 'File attached' : 'Files attached');
            res.redirect(back);
        } catch (error) {
            console.error('Error in addAttachments:', error);
            sendError(req, res, 500, 'Failed to attach file: ' + error.message, back);
        }
    },

    // GET /dev-tracker/:id/attachments/:docId - only if this user can see the ticket
    getAttachment: async (req, res, next) => {
        try {
            const tracker = await devTrackerDao.findTrackerById(req.params.id, getAccess(req.user));
            const doc = tracker && await DocumentStoreDao.findById(req.params.docId);
            if (!doc || doc.entity_type !== ATTACHMENT_ENTITY || String(doc.entity_id) !== String(tracker.tracker_id) || doc.status !== 'ACTIVE') {
                return res.status(404).send('Attachment not found');
            }
            const download = req.query.download === '1';
            res.set({
                'Content-Type': doc.mime_type,
                'Content-Length': doc.file_size,
                'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFileName(doc.file_name, doc.mime_type)}"`,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, max-age=86400'
            });
            res.send(doc.file_data);
        } catch (error) {
            console.error('Error in getAttachment:', error);
            res.status(500).send('Failed to load attachment');
        }
    },

    // DELETE /dev-tracker/:id/attachments/:docId - the person who attached it, or manage users
    deleteAttachment: async (req, res, next) => {
        try {
            const access = getAccess(req.user);
            const tracker = await devTrackerDao.findTrackerById(req.params.id, access);
            const doc = tracker && await DocumentStoreDao.findMetaById(req.params.docId);
            if (!doc || doc.entity_type !== ATTACHMENT_ENTITY || String(doc.entity_id) !== String(tracker.tracker_id)) {
                return res.status(404).json({ success: false, error: 'Attachment not found' });
            }
            if (!access.canManage && doc.created_by !== req.user.User_Name) {
                return res.status(403).json({ success: false, error: 'Only the person who attached it can remove it' });
            }
            // Hard delete: frees the slot without leaving blobs behind
            await DocumentStoreDao.deleteById(doc.doc_id);
            res.json({ success: true });
        } catch (error) {
            console.error('Error in deleteAttachment:', error);
            res.status(500).json({ success: false, error: 'Failed to remove attachment: ' + error.message });
        }
    },

    // POST /dev-tracker/:id/worklog (manage)
    addWorklog: async (req, res, next) => {
        const trackerId = req.params.id;
        try {
            const access = getAccess(req.user);
            const tracker = await devTrackerDao.findTrackerById(trackerId, access);
            if (!tracker) return sendError(req, res, 404, 'Ticket not found', '/dev-tracker');

            const hours = parseFloat(req.body.hours);
            if (!(hours > 0 && hours <= 24)) {
                return sendError(req, res, 400, 'Hours must be between 0 and 24', `/dev-tracker/${trackerId}`);
            }

            await devTrackerDao.addWorklog({
                tracker_id: trackerId,
                work_date: req.body.work_date || moment().format('YYYY-MM-DD'),
                hours,
                note: (req.body.note || '').trim().slice(0, 500) || null,
                source: pick(req.body.source, ['Manual', 'Claude'], 'Manual'),
                created_by: req.user.User_Name
            });

            if (wantsJson(req)) return res.json({ success: true });
            res.redirect(`/dev-tracker/${trackerId}#worklog`);
        } catch (error) {
            console.error('Error in addWorklog:', error);
            sendError(req, res, 500, 'Failed to log hours: ' + error.message, `/dev-tracker/${trackerId}`);
        }
    },

    // DELETE /dev-tracker/worklog/:worklogId (manage)
    deleteWorklog: async (req, res, next) => {
        try {
            const row = await devTrackerDao.deleteWorklog(req.params.worklogId);
            if (!row) return res.status(404).json({ success: false, error: 'Entry not found' });
            res.json({ success: true });
        } catch (error) {
            console.error('Error in deleteWorklog:', error);
            res.status(500).json({ success: false, error: 'Failed to delete entry: ' + error.message });
        }
    },

    // GET /dev-tracker/hours (manage) - where the hours went
    getHoursPage: async (req, res, next) => {
        try {
            const fromDate = req.query.from || moment().startOf('month').format('YYYY-MM-DD');
            const toDate = req.query.to || moment().format('YYYY-MM-DD');
            const rows = await devTrackerDao.getWorklogReport(fromDate, toDate);

            const sumBy = (keyFn) => {
                const map = {};
                rows.forEach(r => {
                    const k = keyFn(r);
                    map[k] = (map[k] || 0) + Number(r.hours);
                });
                return Object.entries(map).sort((a, b) => b[1] - a[1]);
            };

            res.render('dev-tracker-hours', {
                title: 'Ticket Hours',
                user: req.user,
                mobileReady: true,
                fromDate,
                toDate,
                rows,
                total: rows.reduce((s, r) => s + Number(r.hours), 0),
                byType: sumBy(r => r.type),
                byScope: sumBy(r => (r.scope === 'ALL' ? 'All locations' : 'Station request')),
                byStation: sumBy(r => r.location_code || 'Platform'),
                byTicket: sumBy(r => `#${r.tracker_id} ${r.title}`),
                fmtDate,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getHoursPage:', error);
            req.flash('error', 'Failed to load hours: ' + error.message);
            res.redirect('/dev-tracker');
        }
    },

    // ============================================================================
    // TASKS (manage) - internal breakdown, never shown to reporters
    // ============================================================================

    // POST /dev-tracker/:id/tasks
    createTask: async (req, res, next) => {
        const trackerId = req.params.id;
        try {
            const tracker = await devTrackerDao.findTrackerById(trackerId, getAccess(req.user));
            if (!tracker) return sendError(req, res, 404, 'Ticket not found', '/dev-tracker');

            const userName = req.user.User_Name;
            const newTask = await devTrackerDao.createTask({
                tracker_id: trackerId,
                task_title: req.body.task_title,
                task_description: req.body.task_description,
                task_priority: pick(req.body.task_priority, ['Low', 'Medium', 'High'], 'Medium'),
                assigned_to: req.body.assigned_to,
                due_date: req.body.due_date || null,
                estimated_hours: req.body.estimated_hours || null,
                notes: req.body.notes,
                sequence_order: (tracker.tasks || []).length + 1,
                created_by: userName,
                updated_by: userName
            });

            if (wantsJson(req)) return res.json({ success: true, task: newTask });
            res.redirect(`/dev-tracker/${trackerId}`);
        } catch (error) {
            console.error('Error in createTask:', error);
            sendError(req, res, 500, 'Failed to create task: ' + error.message, `/dev-tracker/${trackerId}`);
        }
    },

    // PUT /dev-tracker/tasks/:taskId - status change from the task list
    updateTask: async (req, res, next) => {
        try {
            const task = await devTrackerDao.findTaskById(req.params.taskId);
            const tracker = task && await devTrackerDao.findTrackerById(task.tracker_id, getAccess(req.user));
            if (!tracker) return res.status(404).json({ success: false, error: 'Task not found' });

            await devTrackerDao.updateTask(req.params.taskId, {
                task_status: pick(req.body.task_status, ['To Do', 'In Progress', 'Done', 'Blocked'], task.task_status),
                updated_by: req.user.User_Name
            });
            res.json({ success: true });
        } catch (error) {
            console.error('Error in updateTask:', error);
            res.status(500).json({ success: false, error: 'Failed to update task: ' + error.message });
        }
    },

    // DELETE /dev-tracker/tasks/:taskId - soft delete
    deleteTask: async (req, res, next) => {
        try {
            const task = await devTrackerDao.findTaskById(req.params.taskId);
            const tracker = task && await devTrackerDao.findTrackerById(task.tracker_id, getAccess(req.user));
            if (!tracker) return res.status(404).json({ success: false, error: 'Task not found' });

            await devTrackerDao.deleteTask(req.params.taskId, req.user.User_Name);
            res.json({ success: true });
        } catch (error) {
            console.error('Error in deleteTask:', error);
            res.status(500).json({ success: false, error: 'Failed to delete task: ' + error.message });
        }
    }
};
