// routes/products-routes.js
const express = require('express');
const router = express.Router();
const login = require('connect-ensure-login');
const isLoginEnsured = login.ensureLoggedIn({});
const security = require("../utils/app-security");
const ProductDao = require('../dao/product-dao');
const dbMapping = require("../db/ui-db-field-mapping")
const config = require('../config/app-config');
const locationConfigDao = require('../dao/location-config-dao');

const PRODUCT_NAME_EDITABLE_SETTING = 'PRODUCT_NAME_EDITABLE';

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
        const [data, editableSetting, pumpLinkedNames] = await Promise.all([
            ProductDao.findProducts(locationCode),
            locationConfigDao.getSetting(locationCode, PRODUCT_NAME_EDITABLE_SETTING),
            ProductDao.findPumpLinkedProductNames(locationCode)
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
                cgst_percent: product.cgst_percent,
                sgst_percent: product.sgst_percent,
                sku_name: product.sku_name,
                sku_number: product.sku_number,
                hsn_code: product.hsn_code,
                is_tank_product: product.is_tank_product,
                is_lube_product: product.is_lube_product,
                can_edit_name: canEditNameForRow
            });
        });

        res.render('products', { 
            title: 'Products', 
            user: req.user, 
            products: products, 
            config: config.APP_CONFIGS,
            canEditProductName: canEditProductName,
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
router.post('/api', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
    try {
        // Map the request body to match dbMapping.newProduct expectations
        const mappedReq = {
            body: {
                m_product_name_0: req.body.product_name,
                m_product_qty_0: req.body.qty || 0,
                m_product_unit_0: req.body.unit,
                m_product_price_0: req.body.price,
                m_product_ledger_name_0: req.body.ledger_name,
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
        const newProductName = (req.body.m_product_name || '').trim().toUpperCase();
        const isRenameRequested = Boolean(newProductName) && newProductName !== existingProduct.product_name;

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

        const data = await ProductDao.update({
            product_id: productId,
            product_name: isRenameRequested ? newProductName : undefined,
            price: req.body.m_product_price,
            unit: req.body.m_product_unit,
            ledger_name: req.body.m_product_ledger_name,
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

// Legacy route for form-based product creation (maintaining backward compatibility)
router.post('/', [isLoginEnsured, security.isAdmin()], function (req, res, next) {
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
