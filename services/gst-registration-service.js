// One GST registration (GSTIN) can cover more than one PetroMath location: MC and MC2
// (Muthu Corporation Unit I and II) share 33AFFPC6464C1ZX. The returns are filed once per
// GSTIN, so the GST Returns pages build them for every location on the GSTIN together.
//
//   units    the locations on the GSTIN (m_gst_config, active), in location-code order.
//            Each gets a unit prefix U1, U2, ... used on Table 13 day-bill series, as the
//            auditor numbers them (U1/OIL/MAR/..., U2/MS/MAR/...).
//   primary  the first unit: GSTR-2B lines, supplier ITC classes and the GSTR-3B inputs
//            (credit ledger, interest, late fee) are stored once, under this location.
const GstConfigDao = require('../dao/gst-config-dao');
const LocationDao = require('../dao/location-dao');

async function getRegistration(locationCode) {
    const own = await GstConfigDao.findByLocationCode(locationCode);
    if (!own) throw new Error('GSTIN is not set up for this location. Open GST Returns > Settings first.');
    const gstin = String(own.gstin).trim().toUpperCase();
    const configs = (await GstConfigDao.findAllActive())
        .filter(c => String(c.gstin).trim().toUpperCase() === gstin)
        .sort((a, b) => a.location_code.localeCompare(b.location_code));
    const locations = await Promise.all(configs.map(c => LocationDao.findByLocationCode(c.location_code)));
    const units = configs.map((c, i) => ({
        location_code: c.location_code,
        name: (locations[i] && locations[i].location_name) || c.location_code,
        prefix: `U${i + 1}`
    }));
    return {
        gstin,
        units,
        primary: units[0].location_code,
        combined: units.length > 1,
        label: units.map(u => u.location_code).join(' + ')
    };
}

module.exports = { getRegistration };
