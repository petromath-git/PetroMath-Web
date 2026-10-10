// routes/products-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const ProductDao = require('../dao/product-dao');
const ProductLedgerMapDao = require('../dao/product-ledger-map-dao');
const db        = require('../db/db-connection');
const dbMapping = require("../db/ui-db-field-mapping")
const config = require('../config/app-config');
const locationConfigDao = require('../dao/location-config-dao');
const { getLedgersByGroup } = require('./gl-routes');
const openingStockDao = require('../dao/product-opening-stock-dao');

const PRODUCT_NAME_EDITABLE_SETTING = 'PRODUCT_NAME_EDITABLE';
const PRODUCT_UNITS = config.APP_CONFIGS.productUnits; // LIT, NOS

// Product names are stored uppercase with single spaces and no leading or
// trailing spaces/tabs (the browser uppercases, but the server must not rely on it)
const normalizeProductName = (name) => String(name || '').replace(/\s+/g, ' ').trim().toUpperCase();

// Lube / non-fuel and tank products carry stock (same set as Stock Adjustment)
const isStockTracked = (product) => Number(product.is_lube_product) === 1 || Number(product.is_tank_product) === 1;

const isTruthySetting = (value) => {
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(normalized);
};

// Route to display the products page (GET)
router.get('/', [isLoginEnsured, security.isAdmin()], async function (req, res, next) {
    const locationCode = req.user.location_code;
    let products = [];
    try {
        const [data, editableSetting, pumpLinkedNames, salesLedgers, purchaseLedgers, deletableIds, openingStatus, usedIds] = await Promise.all([
            ProductDao.findProducts(locationCode),
            locationConfigDao.getSetting(locationCode, PRODUCT_NAME_EDITABLE_SETTING),
            ProductDao.findPumpLinkedProductNames(locationCode),
            getLedgersByGroup(locationCode, 'Sales Accounts'),
            getLedgersByGroup(locationCode, 'Purchase Accounts'),
            ProductDao.findDeletableProductIds(locationCode),
            openingStockDao.getLocationStatus(locationCode),
            ProductDao.findUsedProductIds(locationCode)
        ]);
        const canEditProductName = isTruthySetting(editableSetting);
        const pumpLinkedSet = new Set(pumpLinkedNames);

        data.forEach((product) => {
            const canEditNameForRow = canEditProductName && !pumpLinkedSet.has(product.product_name);
            products.push({
                id: product.product_id,
                name: product.product_name,
                unit: product.unit,
                qty: product.qty,
                price: product.price,
                ledger_name: product.ledger_name,
                purchase_ledger_name: product.purchase_ledger_name,
                cgst_percent: product.cgst_percent,
                sgst_percent: product.sgst_percent,
                sku_name: product.sku_name,
                sku_number: product.sku_number,
                hsn_code: product.hsn_code,
                is_tank_product: product.is_tank_product,
                is_lube_product: product.is_lube_product,
                can_edit_name: canEditNameForRow,
                can_delete: deletableIds.has(Number(product.product_id)),
                // unit can't change once the product has entries (SuperUser excepted)
                unit_locked: usedIds.has(Number(product.product_id)) && req.user.Role !== 'SuperUser',
                stock_tracked: isStockTracked(product),
                opening: openingStatus[product.product_id] || { state: 'MISSING', entry: null, entries: [] }
            });
        });

        res.render('products', {
            title: 'Products',
            user: req.user,
            mobileReady: true,   // body.mobile-ready: drops the global phone hacks (50px body padding etc.)
            products: products,
            config: config.APP_CONFIGS,
            canEditProductName: canEditProductName,
            salesLedgers: salesLedgers,
            purchaseLedgers: purchaseLedgers,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Error loading products page:', error);
        req.flash('error', 'Failed to load products: ' + error.message);
        res.redirect('/home');
    }
});

// API endpoint for getting products data (JSON)
router.get('/api/data', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    const locationCode = req.user.location_code;
    
    ProductDao.findProducts(locationCode)
        .then(data => {
            const products = data.map(product => ({
                id: product.product_id,
                name: product.product_name,
                unit: product.unit,
                qty: product.qty,
                price: product.price,
                ledger_name: product.ledger_name,
                purchase_ledger_name: product.purchase_ledger_name,
                cgst_percent: product.cgst_percent,
                sgst_percent: product.sgst_percent,
                sku_name: product.sku_name,
                sku_number: product.sku_number,
                hsn_code: product.hsn_code,
                is_tank_product: product.is_tank_product,
                is_lube_product: product.is_lube_product
            }));
            
            res.json({
                success: true,
                data: {
                    products: products,
                    totalCount: products.length
                }
            });
        })
        .catch(error => {
            console.error('Error fetching products API data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch products data: ' + error.message
            });
        });
});

// API endpoint for creating new product
router.post('/api', [isLoginEnsured, security.isAdmin()], async function (req, res, next) {
    try {
        // Same-name products break the m_pump/m_tank name joins and are usually
        // an onboarding slip (e.g. re-created just to change the unit).
        const newName = normalizeProductName(req.body.product_name);
        if (!newName) {
            return res.status(400).json({ success: false, error: 'Product name is required' });
        }
        const existing = await ProductDao.findByName(newName, req.user.location_code);
        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Product ${existing.product_name} already exists (unit ${existing.unit}). Edit the existing product instead of creating a new one.`
            });
        }

        const unit = String(req.body.unit || '').trim().toUpperCase();
        if (!PRODUCT_UNITS.includes(unit)) {
            return res.status(400).json({ success: false, error: `Unit must be one of ${PRODUCT_UNITS.join(', ')}` });
        }

        // Map the request body to match dbMapping.newProduct expectations
        const mappedReq = {
            body: {
                m_product_name_0: newName,
                m_product_qty_0: req.body.qty || 0,
                m_product_unit_0: unit,
                m_product_price_0: req.body.price,
                m_product_ledger_name_0: req.body.ledger_name,
                m_product_purchase_ledger_name_0: req.body.purchase_ledger_name,
                m_product_cgst_0: req.body.cgst_percent || 0,
                m_product_sgst_0: req.body.sgst_percent || 0,
                m_product_sku_name_0: req.body.sku_name || '',
                m_product_sku_number_0: req.body.sku_number || '',
                m_product_hsn_code_0: req.body.hsn_code || '',
                m_product_is_tank_product_0: req.body.is_tank_product || 0,
                m_product_is_lube_product_0: req.body.is_lube_product || 0
            },
            user: req.user
        };

        ProductDao.create(dbMapping.newProduct(mappedReq))
            .then(result => {
                res.json({
                    success: true,
                    message: 'Product created successfully',
                    data: result
                });
            })
            .catch(error => {
                console.error('Error creating product:', error);
                res.status(500).json({
                    success: false,
                    error: 'Failed to create product: ' + error.message
                });
            });
    } catch (error) {
        console.error('Error in product creation:', error);
        res.status(400).json({
            success: false,
            error: 'Invalid product data: ' + error.message
        });
    }
});

// API endpoint for updating product
router.put('/api/:id', [isLoginEnsured, security.isAdmin()], async function (req, res, next) {
    const productId = req.params.id;
    const locationCode = req.user.location_code;

    try {
        const [existingProduct, editableSetting] = await Promise.all([
            ProductDao.findById(productId, locationCode),
            locationConfigDao.getSetting(locationCode, PRODUCT_NAME_EDITABLE_SETTING)
        ]);
        if (!existingProduct) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const canEditProductName = isTruthySetting(editableSetting);
        const newProductName = normalizeProductName(req.body.m_product_name);
        // Older names may have lowercase or stray spaces/tabs ("1 Lt Servo MG
        // 20W40", "PRIDE 40 "). Only a real change of name counts as a rename —
        // otherwise a price edit is refused where name editing is off.
        const isRenameRequested = Boolean(newProductName)
            && newProductName !== normalizeProductName(existingProduct.product_name);

        if (isRenameRequested) {
            if (!canEditProductName) {
                return res.status(403).json({
                    success: false,
                    error: 'Product name editing is not enabled for this location'
                });
            }

            const isLinked = await ProductDao.isProductLinkedToPumpOrTank(locationCode, existingProduct.product_name);
            if (isLinked) {
                return res.status(400).json({
                    success: false,
                    error: 'Product is linked to pump/tank configuration and name cannot be changed'
                });
            }

            const duplicate = await ProductDao.findByName(newProductName, locationCode);
            if (duplicate && Number(duplicate.product_id) !== Number(productId)) {
                return res.status(400).json({
                    success: false,
                    error: 'Another product with this name already exists'
                });
            }
        }

        // Unit: one of the configured units; locked once the product has entries
        // (changing it would change what every past quantity means)
        let unit;
        const newUnit = String(req.body.m_product_unit || '').trim().toUpperCase();
        if (newUnit && newUnit !== existingProduct.unit) {
            if (!PRODUCT_UNITS.includes(newUnit)) {
                return res.status(400).json({ success: false, error: `Unit must be one of ${PRODUCT_UNITS.join(', ')}` });
            }
            if (req.user.Role !== 'SuperUser' && await ProductDao.isProductUsed(existingProduct.product_id)) {
                return res.status(400).json({
                    success: false,
                    error: 'Unit cannot be changed because this product already has sales, purchases or stock entries. Contact support.'
                });
            }
            unit = newUnit;
        }

        const data = await ProductDao.update({
            product_id: productId,
            product_name: isRenameRequested ? newProductName : undefined,
            price: req.body.m_product_price,
            unit,
            ledger_name: req.body.m_product_ledger_name,
            purchase_ledger_name: req.body.m_product_purchase_ledger_name,
            cgst_percent: req.body.m_product_cgst,
            sgst_percent: req.body.m_product_sgst,
            is_tank_product: req.body.m_product_is_tank_product,
            is_lube_product: req.body.m_product_is_lube_product
        });

        if (data == 1 || data == 0) {
            res.json({
                success: true,
                message: 'Product updated successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Unexpected response from database'
            });
        }
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update product: ' + error.message
        });
    }
});

// API endpoint for deleting a product (only when nothing references it)
router.delete('/api/:id', [isLoginEnsured, security.isAdmin()], async function (req, res, next) {
    const productId = req.params.id;
    const locationCode = req.user.location_code;

    try {
        const product = await ProductDao.findById(productId, locationCode);
        if (!product) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }

        const blockers = await ProductDao.getDeleteBlockers(product.product_id, locationCode, product.product_name);
        if (blockers.length) {
            const detail = blockers.map(b => `${b.count} ${b.label}`).join(', ');
            return res.status(400).json({
                success: false,
                error: `${product.product_name} cannot be deleted because it is used in: ${detail}.`
            });
        }

        await ProductDao.deleteProduct(product.product_id, req.user.username || String(req.user.Person_id));
        res.json({ success: true, message: `Product ${product.product_name} deleted` });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete product: ' + error.message
        });
    }
});

// ── Opening stock ─────────────────────────────────────────────────────────────

// Opening stock of one product, with its change history and date rules
router.get('/api/:id/opening-stock', [isLoginEnsured, security.isAdmin()], async function (req, res) {
    try {
        const locationCode = req.user.location_code;
        const product = await ProductDao.findById(req.params.id, locationCode);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        if (!isStockTracked(product)) return res.status(400).json({ success: false, error: 'Stock is not tracked for this product.' });

        const [status, dateRules] = await Promise.all([
            openingStockDao.getStatus(product.product_id, locationCode),
            openingStockDao.getDateRules(locationCode)
        ]);
        const history = status.entry ? await openingStockDao.getHistory(status.entry.adjustment_id) : [];

        res.json({
            success: true,
            productName: product.product_name,
            unit: product.unit,
            status,
            history,
            dateRules,
            canChange: openingStockDao.EDIT_ROLES.includes(req.user.Role)
        });
    } catch (error) {
        console.error('Error loading opening stock:', error);
        res.status(500).json({ success: false, error: 'Failed to load opening stock' });
    }
});

// Set a product's opening stock, or change it (Admin / PowerUser / SuperUser).
// Body: { date, qty, note, reason, confirmed }. When the date would leave
// earlier sales/purchases out of stock (late-start locations only) the first
// call answers { needsConfirm, warning } and the user resends with confirmed.
router.put('/api/:id/opening-stock', [isLoginEnsured, security.isAdmin()], async function (req, res) {
    try {
        const locationCode = req.user.location_code;
        const product = await ProductDao.findById(req.params.id, locationCode);
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
        if (!isStockTracked(product)) return res.status(400).json({ success: false, error: 'Stock is not tracked for this product.' });

        const status = await openingStockDao.getStatus(product.product_id, locationCode);
        if (status.state === 'MULTIPLE') {
            return res.status(400).json({ success: false, error: 'This product has more than one opening stock entry. Contact support to combine them.' });
        }

        let reason = null;
        if (status.entry) {
            if (!openingStockDao.EDIT_ROLES.includes(req.user.Role)) {
                return res.status(403).json({ success: false, error: 'Only Admin, PowerUser or SuperUser can change an opening stock once it is set.' });
            }
            reason = String(req.body.reason || '').trim().slice(0, 500);
            if (!reason) return res.status(400).json({ success: false, error: 'Please give a reason for the change.' });
        }

        const date = String(req.body.date || '').trim();
        const qtyText = String(req.body.qty === undefined || req.body.qty === null ? '' : req.body.qty).trim();
        const qty = Number(qtyText);
        if (qtyText === '' || !isFinite(qty) || qty < 0) {
            return res.status(400).json({ success: false, error: 'Enter the opening stock quantity (0 or more).' });
        }
        if (Math.round(qty * 100) / 100 !== qty) {
            return res.status(400).json({ success: false, error: 'Quantity can have at most 2 decimals.' });
        }
        if (ProductDao.isPieceUnit(product.unit) && !ProductDao.isWholeQty(qty)) {
            return res.status(400).json({ success: false, error: `${product.product_name} is counted in pieces (NOS), so the opening stock must be a whole number.` });
        }
        const note = String(req.body.note || '').trim();

        if (status.entry && status.entry.adjustment_date === date
            && Number(status.entry.qty) === qty
            && (status.entry.remarks || 'Opening Stock') === (note || 'Opening Stock')) {
            return res.status(400).json({ success: false, error: 'Nothing changed.' });
        }

        const check = await openingStockDao.validateDate(locationCode, product.product_id, date,
            status.entry ? status.entry.adjustment_date : null);
        if (check.error) return res.status(400).json({ success: false, error: check.error });
        if (check.warning && !req.body.confirmed) {
            return res.json({ success: false, needsConfirm: true, warning: check.warning });
        }

        await openingStockDao.save({
            locationCode,
            productId: product.product_id,
            date,
            qty,
            note,
            userName: req.user.User_Name,
            reason
        });

        res.json({ success: true, message: status.entry ? 'Opening stock updated' : 'Opening stock saved' });
    } catch (error) {
        console.error('Error saving opening stock:', error);
        res.status(500).json({ success: false, error: 'Failed to save opening stock' });
    }
});

// ── Product Ledger Map ────────────────────────────────────────────────────────

// Maps the attribute1 group key (from m_lookup) → actual GL ledger group name.
// Update this only if a new ledger category is added to m_lookup.
const GROUP_LEDGER_NAMES = {
    sales:    'Sales Accounts',
    purchase: 'Purchase Accounts',
    tax:      'Duties & Taxes'
};

router.get('/ledger-map', [isLoginEnsured, security.isAdmin()], async (req, res) => {
    const locationCode = req.user.location_code;
    try {
        const [products, rawMappings, mapTypes] = await Promise.all([
            ProductLedgerMapDao.getProducts(locationCode),
            ProductLedgerMapDao.getAllMappingsRaw(locationCode),
            ProductLedgerMapDao.getMapTypes()
        ]);

        // Fetch ledger lists for each distinct group used by the current map types
        const neededGroups = [...new Set(mapTypes.map(m => m.group))];
        const ledgerArrays = await Promise.all(
            neededGroups.map(g => getLedgersByGroup(locationCode, GROUP_LEDGER_NAMES[g] || g))
        );
        const ledgers = {};
        neededGroups.forEach((g, i) => { ledgers[g] = ledgerArrays[i]; });

        // Build { productId: { MAP_TYPE: ledgerId } } lookup for the modal
        const mappingLookup = {};
        rawMappings.forEach(m => {
            if (!mappingLookup[m.product_id]) mappingLookup[m.product_id] = {};
            mappingLookup[m.product_id][m.map_type] = m.ledger_id;
        });

        res.render('product-ledger-map', {
            title: 'Product GL Ledger Map',
            user: req.user,
            config: config.APP_CONFIGS,
            products,
            mappingLookup,
            mapTypes,
            ledgers
        });
    } catch (err) {
        console.error('Error loading product ledger map:', err);
        req.flash('error', 'Failed to load product ledger map: ' + err.message);
        res.redirect('/products');
    }
});

// POST /products/api/ledger-maps/:productId/copy-to
// Body: { target_product_ids: [id, id, ...] }
// Copies all map types from the source product to the specified targets.
// INSERT IGNORE — will not overwrite existing mappings on target products.
router.post('/api/ledger-maps/:productId/copy-to', [isLoginEnsured, security.isAdmin()], async (req, res) => {
    const locationCode       = req.user.location_code;
    const sourceId           = parseInt(req.params.productId);
    const { target_product_ids } = req.body;
    const user               = req.user.username || String(req.user.Person_id);

    if (!Array.isArray(target_product_ids) || !target_product_ids.length)
        return res.status(400).json({ success: false, error: 'No target products selected' });

    try {
        const sourceMaps = await db.sequelize.query(
            `SELECT map_type, ledger_id FROM gl_product_ledger_map
             WHERE location_code = :locationCode AND product_id = :sourceId`,
            { replacements: { locationCode, sourceId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        if (!sourceMaps.length)
            return res.status(400).json({ success: false, error: 'Source product has no mappings to copy' });

        const values       = [];
        const replacements = { locationCode, user };
        let idx = 0;
        for (const targetId of target_product_ids) {
            for (const m of sourceMaps) {
                replacements[`pid_${idx}`] = parseInt(targetId);
                replacements[`mt_${idx}`]  = m.map_type;
                replacements[`lid_${idx}`] = m.ledger_id;
                values.push(`(:locationCode, :pid_${idx}, :mt_${idx}, :lid_${idx}, :user, :user)`);
                idx++;
            }
        }

        await db.sequelize.query(
            `INSERT IGNORE INTO gl_product_ledger_map
             (location_code, product_id, map_type, ledger_id, created_by, updated_by)
             VALUES ${values.join(',')}`,
            { replacements, type: db.Sequelize.QueryTypes.INSERT }
        );

        res.json({ success: true, applied_to: target_product_ids.length });
    } catch (err) {
        console.error('copy-to error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/ledger-maps/:productId/:mapType', [isLoginEnsured, security.isAdmin()], async (req, res) => {
    const { productId, mapType } = req.params;
    const { ledger_id } = req.body;
    const locationCode = req.user.location_code;
    const updatedBy = req.user.username || req.user.Person_id;
    try {
        // trg_product_ledger_map_gl_update/_delete log any stale-voucher
        // fallout from this write directly (DB-level, catches this route,
        // raw SQL, and future migrations alike). Capture a DB-clock
        // timestamp first just to report back the count for the UI.
        const [{ ts: beforeTs }] = await db.sequelize.query(`SELECT NOW(6) AS ts`, { type: db.Sequelize.QueryTypes.SELECT });

        if (!ledger_id) {
            await ProductLedgerMapDao.deleteMapping(locationCode, productId, mapType);
        } else {
            await ProductLedgerMapDao.upsertMapping(locationCode, productId, mapType, ledger_id, updatedBy);
        }

        const mappingKey = `product:${productId}:${mapType}`;
        const [{ cnt: queuedCount }] = await db.sequelize.query(`
            SELECT COUNT(*) AS cnt FROM gl_correction_queue
            WHERE location_code = :locationCode AND mapping_key = :mappingKey AND creation_date >= :beforeTs
        `, { replacements: { locationCode, mappingKey, beforeTs }, type: db.Sequelize.QueryTypes.SELECT });

        res.json({ success: true, queuedCorrections: queuedCount });
    } catch (err) {
        console.error('Error saving product ledger map:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Legacy route for form-based product creation (maintaining backward compatibility)
router.post('/', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    req.body.m_product_name_0 = normalizeProductName(req.body.m_product_name_0);
    ProductDao.create(dbMapping.newProduct(req))
        .then(() => {
            req.flash('success', 'Product created successfully');
            res.redirect('/products');
        })
        .catch(error => {
            console.error('Error creating product:', error);
            req.flash('error', 'Failed to create product: ' + error.message);
            res.redirect('/products');
        });
});

module.exports = router;
