// controllers/person-location-controller.js
const personLocationDao = require('../dao/person-location-dao');
const dateFormat = require('dateformat');

module.exports = {
    // Render the assign locations page
    renderPage: async (req, res, next) => {
        try {
            res.render('assign-person-locations', {
                title: 'Assign User Locations',
                user: req.user,
                location: req.user.location_code
            });
        } catch (error) {
            console.error('Error rendering assign locations page:', error);
            res.status(500).send('Error loading assign locations page');
        }
    },

    // GET: All persons (excluding customers)
    getPersons: async (req, res, next) => {
        try {
            const persons = await personLocationDao.getAllPersons();
            
            res.json({
                success: true,
                data: persons
            });
        } catch (error) {
            console.error('Error fetching persons:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch persons: ' + error.message
            });
        }
    },

    // GET: All locations
    getLocations: async (req, res, next) => {
        try {
            const locations = await personLocationDao.getAllLocations();
            
            res.json({
                success: true,
                data: locations
            });
        } catch (error) {
            console.error('Error fetching locations:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch locations: ' + error.message
            });
        }
    },

    // GET: All roles
    getRoles: async (req, res, next) => {
        try {
            const roles = await personLocationDao.getAllRoles();
            
            res.json({
                success: true,
                data: roles
            });
        } catch (error) {
            console.error('Error fetching roles:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch roles: ' + error.message
            });
        }
    },

    // GET: Get assigned locations for a person
    getPersonLocations: async (req, res, next) => {
        try {
            const personId = req.params.personId;
            const locations = await personLocationDao.getPersonLocations(personId);
            
            // Format dates for display
            const formattedLocations = locations.map(loc => ({
                ...loc,
                effective_start_date: dateFormat(loc.effective_start_date, 'dd-mm-yyyy'),
                effective_end_date: dateFormat(loc.effective_end_date, 'dd-mm-yyyy'),
                creation_date: loc.creation_date ? dateFormat(loc.creation_date, 'dd-mm-yyyy HH:MM') : null
            }));
            
            res.json({
                success: true,
                data: formattedLocations
            });
        } catch (error) {
            console.error('Error fetching person locations:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch person locations: ' + error.message
            });
        }
    },

    // POST: Assign multiple locations to a person
    assignLocations: async (req, res, next) => {
        try {
            const { person_id, locations } = req.body;
            const username = req.user.username;
            
            if (!person_id || !locations || locations.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Person ID and at least one location are required'
                });
            }

            const results = {
                assigned: [],
                skipped: [],
                errors: []
            };

            // Process each location assignment
            for (const loc of locations) {
                try {
                    // Check if already assigned
                    const exists = await personLocationDao.checkExistingAssignment(
                        person_id, 
                        loc.location_code
                    );

                    if (exists) {
                        results.skipped.push({
                            location_code: loc.location_code,
                            reason: 'Already assigned'
                        });
                        continue;
                    }

                    // Assign the location
                    await personLocationDao.assignLocation({
                        person_id: person_id,
                        location_code: loc.location_code,
                        role: loc.role,
                        effective_start_date: loc.effective_start_date,
                        effective_end_date: loc.effective_end_date,
                        created_by: username,
                        updated_by: username
                    });

                    results.assigned.push(loc.location_code);
                } catch (error) {
                    results.errors.push({
                        location_code: loc.location_code,
                        error: error.message
                    });
                }
            }

            res.json({
                success: true,
                message: `${results.assigned.length} location(s) assigned successfully`,
                data: results
            });

        } catch (error) {
            console.error('Error assigning locations:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to assign locations: ' + error.message
            });
        }
    },

    // DELETE: Remove a location assignment
    removeAssignment: async (req, res, next) => {
        try {
            const personlocId = req.params.personlocId;
            const username = req.user.username;

            await personLocationDao.removeAssignment(personlocId, username);

            res.json({
                success: true,
                message: 'Location assignment removed successfully'
            });
        } catch (error) {
            console.error('Error removing assignment:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove assignment: ' + error.message
            });
        }
    }
};