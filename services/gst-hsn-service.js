// HSN code used for a product in the returns, so locations do not have to keep HSN on
// every product themselves:
//   1. the product's own HSN, when it is in the HSN list (m_gst_hsn)
//   2. fuel: the HSN on the oil company's latest invoice for that product
//   3. the product's own HSN when it is a full 8-digit code (lubes get theirs from the
//      supplier's invoice PDF on upload, see lubes-invoice-controller learnFromPdf)
//   4. else (not fuel) the HSN a product of the same name has at the reference locations
//      (the outlets whose returns the auditor files and whose codes were checked)
//   5. else the default for its category (m_gst_hsn_default: petrol, diesel, lube, ...)
//   6. else the product's own code as it is (shown as a warning / error on the GSTR-1 page)
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

const EIGHT_DIGITS = /^\d{8}$/;
const cleanHsn = (code) => String(code || '').replace(/\s+/g, '');

const norm = (name) => String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');

// Loads the lists once per return; resolve(product) -> { code, source }.
async function loadResolver(locationCode) {
    const [master, reference, defaults, fuelInvoices] = await Promise.all([
        GstFilingDao.getHsnMaster(),
        GstFilingDao.getReferenceHsn(REFERENCE_LOCATIONS),
        GstFilingDao.getHsnDefaults(),
        locationCode ? GstFilingDao.getFuelInvoiceHsn(locationCode) : []
    ]);
    const invoiceByProduct = new Map(fuelInvoices.filter(f => EIGHT_DIGITS.test(f.hsn_code)).map(f => [Number(f.product_id), f]));
    const inMaster = new Set(master.map(h => h.hsn_code));
    const refByName = new Map();
    reference.forEach(r => { if (!refByName.has(norm(r.product_name))) refByName.set(norm(r.product_name), r); });
    const byCategory = new Map(defaults.filter(d => inMaster.has(d.hsn_code)).map(d => [d.category, d.hsn_code]));

    return {
        resolve(p) {
            const own = cleanHsn(p.hsn_code);
            if (inMaster.has(own)) return { code: own, source: 'product' };
            const inv = p.is_fuel && invoiceByProduct.get(Number(p.product_id));
            if (inv) return { code: inv.hsn_code, source: `oil company invoice ${inv.invoice_number}` };
            if (EIGHT_DIGITS.test(own)) return { code: own, source: 'product' };
            // Fuel without an invoice code goes to the default (the codes the oil company prints), not to a
            // reference outlet whose product may carry another code.
            const ref = !p.is_fuel && refByName.get(norm(p.product_name));
            if (ref) return { code: ref.hsn_code, source: `same product at ${ref.location_code}` };
            const category = categoryOf(p);
            if (category && byCategory.has(category)) return { code: byCategory.get(category), source: `${category.toLowerCase()} default` };
            return { code: own, source: own ? 'product (not in HSN list)' : 'none' };
        }
    };
}

module.exports = { REFERENCE_LOCATIONS, fuelFamily, categoryOf, cleanHsn, loadResolver };
