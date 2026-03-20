const LookupDao = require('../dao/lookup-dao');
const LocationDao = require('../dao/location-dao');

module.exports = {

    // GET /masters/lookup-admin
    getPage: async (req, res, next) => {
        try {
            const { Role: userRole, location_code: locationCode } = req.user;
            const isSuperUser = userRole === 'SuperUser';
            const [lookupTypes, allLocations] = await Promise.all([
                LookupDao.getAllLookupTypes(userRole, locationCode),
                isSuperUser ? LocationDao.findAllLocations() : Promise.resolve([])
            ]);
            res.render('lookup-admin', {
                title: 'Lookup Admin',
                user: req.user,
                lookupTypes,
                isSuperUser,
                allLocations,
                userLocationCode: locationCode
            });
        } catch (err) {
            next(err);
        }
    },

    // GET /masters/lookup-admin/values?type=TANK_QUANTITY
    getValues: async (req, res) => {
        try {
            const { Role: userRole, location_code: locationCode } = req.user;
            const { type } = req.query;
            if (!type) return res.status(400).json({ error: 'type is required' });

            const values = await LookupDao.getValuesForAdmin(type, userRole, locationCode);
            const today = new Date();
            const mapped = values.map(v => ({
                lookup_id: v.lookup_id,
                description: v.description,
                tag: v.tag,
                attribute1: v.attribute1,
                attribute2: v.attribute2,
                attribute3: v.attribute3,
                location_code: v.location_code,
                scope: v.location_code ? v.location_code : 'Global',
                is_global: !v.location_code,
                start_date_active: v.start_date_active ? new Date(v.start_date_active).toISOString().split('T')[0] : null,
                end_date_active: v.end_date_active ? new Date(v.end_date_active).toISOString().split('T')[0] : null,
                is_active: (!v.start_date_active || v.start_date_active <= today) && (!v.end_date_active || v.end_date_active >= today)
            }));
            res.json({ values: mapped });
        } catch (err) {
            console.error('Error fetching lookup values:', err);
            res.status(500).json({ error: 'Failed to fetch values' });
        }
    },

    // POST /masters/lookup-admin/values
    addValue: async (req, res) => {
        try {
            const { Role: userRole, location_code: userLocationCode, User_Name: createdBy } = req.user;
            const { lookup_type, description, tag, attribute1, attribute2, attribute3, scope, start_date_active, end_date_active } = req.body;

            if (!lookup_type || !description) {
                return res.status(400).json({ error: 'lookup_type and description are required' });
            }

            // Resolve locationCode from scope
            let locationCode = null;
            if (scope === 'global') {
                if (userRole !== 'SuperUser') {
                    return res.status(403).json({ error: 'Only SuperUser can create global lookup values' });
                }
                locationCode = null;
            } else if (!scope || scope === 'location') {
                // Non-superuser always saves to their own location
                locationCode = userLocationCode;
            } else {
                // scope is an actual location code — SuperUser only
                if (userRole !== 'SuperUser') {
                    return res.status(403).json({ error: 'Only SuperUser can create values for other locations' });
                }
                locationCode = scope;
            }

            await LookupDao.createLookupValue({
                lookup_type,
                description: description.trim(),
                tag: tag || null,
                attribute1: attribute1 || null,
                attribute2: attribute2 || null,
                attribute3: attribute3 || null,
                location_code: locationCode,
                start_date_active: start_date_active || new Date(),
                end_date_active: end_date_active || new Date('2099-12-31'),
                created_by: createdBy
            });

            res.json({ success: true, message: 'Value added successfully' });
        } catch (err) {
            console.error('Error adding lookup value:', err);
            res.status(500).json({ error: 'Failed to add value' });
        }
    },

    // PUT /masters/lookup-admin/values/:id/deactivate
    deactivateValue: async (req, res) => {
        try {
            const { Role: userRole, location_code: userLocationCode, User_Name: updatedBy } = req.user;
            const lookupId = req.params.id;

            if (userRole !== 'SuperUser') {
                const valid = await _ownsLookup(lookupId, userLocationCode);
                if (!valid) return res.status(403).json({ error: 'You can only deactivate your own location values' });
            }

            await LookupDao.deactivateLookupValue(lookupId, updatedBy);
            res.json({ success: true, message: 'Value deactivated' });
        } catch (err) {
            console.error('Error deactivating lookup value:', err);
            res.status(500).json({ error: 'Failed to deactivate value' });
        }
    },

    // PUT /masters/lookup-admin/values/:id/reactivate
    reactivateValue: async (req, res) => {
        try {
            const { Role: userRole, location_code: userLocationCode, User_Name: updatedBy } = req.user;
            const lookupId = req.params.id;

            if (userRole !== 'SuperUser') {
                const valid = await _ownsLookup(lookupId, userLocationCode);
                if (!valid) return res.status(403).json({ error: 'You can only reactivate your own location values' });
            }

            await LookupDao.reactivateLookupValue(lookupId, updatedBy);
            res.json({ success: true, message: 'Value reactivated' });
        } catch (err) {
            console.error('Error reactivating lookup value:', err);
            res.status(500).json({ error: 'Failed to reactivate value' });
        }
    }
};

// Returns true if the lookup row belongs to the given locationCode (not global)
async function _ownsLookup(lookupId, locationCode) {
    const db = require('../db/db-connection');
    const rows = await db.sequelize.query(
        `SELECT location_code FROM m_lookup WHERE lookup_id = :lookupId`,
        { replacements: { lookupId }, type: db.Sequelize.QueryTypes.SELECT }
    );
    if (!rows.length) return false;
    return rows[0].location_code === locationCode;
}
