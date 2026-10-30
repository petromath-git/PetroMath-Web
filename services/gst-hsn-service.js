// HSN code used for a product in the returns, so locations do not have to keep HSN on
// every product themselves:
//   1. the product's own HSN, when it is in the HSN list (m_gst_hsn)
//   2. else the HSN a product of the same name has at the reference locations
//      (the outlets whose returns the auditor files and whose codes were checked)
//   3. else the default for its category (m_gst_hsn_default: petrol, diesel, lube, ...)
//   4. else the product's own code as it is (shown as a warning / error on the GSTR-1 page)
const GstFilingDao = require('../dao/gst-filing-dao');

const REFERENCE_LOCATIONS = ['MUE', 'MC', 'MC2', 'MME'];

// Day-bill / fuel family: XP95 / E20 go with petrol, Xtra Green (GD / XG) with diesel.
function fuelFamily(productName) {
    const name = String(productName).toUpperCase();
    if (/CNG/.test(name)) return 'CNG';
    if (/HSD|DIESEL|^GD$|^XG|GREEN/.test(name)) return 'DIESEL';
    return 'PETROL';
}

// p: { product_name, is_fuel, is_lube_product, gst_rate }
function categoryOf(p) {
    const name = String(p.product_name).toUpperCase();
    if (p.is_fuel) return fuelFamily(name);
    if (/CYLINDER/.test(name)) return 'CYLINDER';
    if (/ACID/.test(name)) return 'ACID';
    if (/DISTILLED|WATER/.test(name)) return 'WATER';
    if (Number(p.is_lube_product) === 1 || Number(p.gst_rate) === 18) return 'LUBE';
    return null;
}

const norm = (name) => String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');

// Loads the lists once per return; resolve(product) -> { code, source }.
async function loadResolver() {
    const [master, reference, defaults] = await Promise.all([
        GstFilingDao.getHsnMaster(),
        GstFilingDao.getReferenceHsn(REFERENCE_LOCATIONS),
        GstFilingDao.getHsnDefaults()
    ]);
    const inMaster = new Set(master.map(h => h.hsn_code));
    const refByName = new Map();
    reference.forEach(r => { if (!refByName.has(norm(r.product_name))) refByName.set(norm(r.product_name), r); });
    const byCategory = new Map(defaults.filter(d => inMaster.has(d.hsn_code)).map(d => [d.category, d.hsn_code]));

    return {
        resolve(p) {
            const own = String(p.hsn_code || '').trim();
            if (inMaster.has(own)) return { code: own, source: 'product' };
            const ref = refByName.get(norm(p.product_name));
            if (ref) return { code: ref.hsn_code, source: `same product at ${ref.location_code}` };
            const category = categoryOf(p);
            if (category && byCategory.has(category)) return { code: byCategory.get(category), source: `${category.toLowerCase()} default` };
            return { code: own, source: own ? 'product (not in HSN list)' : 'none' };
        }
    };
}

module.exports = { REFERENCE_LOCATIONS, fuelFamily, categoryOf, loadResolver };
