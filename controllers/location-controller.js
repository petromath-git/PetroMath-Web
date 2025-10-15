const locationDao = require('../dao/location-dao');
const lookupDao = require('../dao/lookup-dao');
const moment = require('moment');

module.exports = {
    /**
     * GET /location-master
     * Display the location master page with all locations
     */
    getLocationMasterPage: async (req, res, next) => {
        try {
            // Fetch all locations and oil companies
            const [locations, oilCompanies] = await Promise.all([
                locationDao.findAllLocations(),
                lookupDao.getOilCompanies()
            ]);

            // Add active status to each location
            const currentDate = new Date();
            const locationsWithStatus = locations.map(loc => {
                const locationData = loc.toJSON ? loc.toJSON() : loc;
                return {
                    ...locationData,
                    is_active: new Date(locationData.start_date) <= currentDate && 
                              new Date(locationData.effective_end_date) > currentDate
                };
            });

            res.render('location-master', {
                title: 'Location Master',
                user: req.user,
                locations: locationsWithStatus,
                oilCompanies: oilCompanies,
                messages: req.flash()
            });
        } catch (error) {
            console.error('Error in getLocationMasterPage:', error);
            req.flash('error', 'Failed to load locations');
            res.redirect('/home');
        }
    },

    /**
     * POST /location-master
     * Create a new location
     */
    createLocation: async (req, res, next) => {
        try {
            const { location_code, location_name, address, company_name, 
                    gst_number, phone, start_date } = req.body;

            // Validate location code format
            if (!locationDao.validateLocationCode(location_code)) {
                req.flash('error', 'Location code must be 4-5 characters, uppercase alphanumeric only, no spaces');
                return res.redirect('/location-master');
            }

            // Check for duplicate location code
            const isDuplicate = await locationDao.checkDuplicateCode(location_code);
            if (isDuplicate) {
                req.flash('error', 'Location code already exists');
                return res.redirect('/location-master');
            }

            // Validate phone number (10 digits)
            if (!phone || !/^\d{10}$/.test(phone)) {
                req.flash('error', 'Phone number must be exactly 10 digits');
                return res.redirect('/location-master');
            }

            // Create location
            await locationDao.create({
                location_code: location_code.toUpperCase(),
                location_name,
                address,
                company_name,
                gst_number,
                phone,
                start_date: start_date || new Date(),
                created_by: req.user.Person_id.toString()
            });

            req.flash('success', 'Location created successfully');
            res.redirect('/location-master');
        } catch (error) {
            console.error('Error creating location:', error);
            req.flash('error', 'Failed to create location: ' + error.message);
            res.redirect('/location-master');
        }
    },

    /**
     * PUT /location-master/:id
     * Update existing location
     */
   updateLocation: async (req, res, next) => {
    try {
        const locationId = req.params.id;
        const { location_name, company_name, gst_number, phone, start_date } = req.body;

        // Validate phone number (10 digits)
        if (!phone || !/^\d{10}$/.test(phone)) {
            return res.json({ success: false, error: 'Phone number must be exactly 10 digits' });
        }

        // Update location
        await locationDao.update(locationId, {
            location_name,
            company_name,
            gst_number,
            phone,
            start_date,
            effective_end_date: '9999-12-31', // Keep active
            updated_by: req.user.Person_id.toString()
        });

        res.json({ success: true, message: 'Location updated successfully' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.json({ success: false, error: error.message });
    }
},

    /**
     * PUT /location-master/:id/deactivate
     * Deactivate a location
     */
    deactivateLocation: async (req, res, next) => {
    try {
        const locationId = req.params.id;
        
        await locationDao.deactivate(
            locationId, 
            req.user.Person_id.toString()
        );

        res.json({ success: true, message: 'Location deactivated successfully' });
    } catch (error) {
        console.error('Error deactivating location:', error);
        res.json({ success: false, error: error.message });
    }
},

reactivateLocation: async (req, res, next) => {
    try {
        const locationId = req.params.id;
        
        await locationDao.reactivate(
            locationId, 
            req.user.Person_id.toString()
        );

        res.json({ success: true, message: 'Location reactivated successfully' });
    } catch (error) {
        console.error('Error reactivating location:', error);
        res.json({ success: false, error: error.message });
    }
},
    /**
     * PUT /location-master/:id/reactivate
     * Reactivate a location
     */
    reactivateLocation: async (req, res, next) => {
        try {
            const locationId = req.params.id;
            
            await locationDao.reactivate(
                locationId, 
                req.user.Person_id.toString()
            );

            req.flash('success', 'Location reactivated successfully');
            res.redirect('/location-master');
        } catch (error) {
            console.error('Error reactivating location:', error);
            req.flash('error', 'Failed to reactivate location: ' + error.message);
            res.redirect('/location-master');
        }
    },

    /**
     * GET /location-master/validate-code
     * Validate location code for duplicate check (AJAX)
     */
    validateLocationCode: async (req, res, next) => {
        try {
            const { location_code, location_id } = req.query;

            // Format validation
            if (!locationDao.validateLocationCode(location_code)) {
                return res.json({
                    valid: false,
                    message: 'Location code must be 4-5 characters, uppercase alphanumeric only'
                });
            }

            // Duplicate check
            const isDuplicate = await locationDao.checkDuplicateCode(
                location_code, 
                location_id ? parseInt(location_id) : null
            );

            if (isDuplicate) {
                return res.json({
                    valid: false,
                    message: 'Location code already exists'
                });
            }

            res.json({ valid: true });
        } catch (error) {
            console.error('Error validating location code:', error);
            res.status(500).json({
                valid: false,
                message: 'Error validating location code'
            });
        }
    }
};