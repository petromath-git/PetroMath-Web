const db = require("../db/db-connection");
const Supplier = db.m_supplier;
const { Op } = require("sequelize");
const utils = require("../utils/app-utils");
const Sequelize = require("sequelize");
const dateFormat = require("dateformat");

module.exports = {
    findSuppliers: (locationCode) => {
        const currentDate = dateFormat(new Date(), "yyyy-mm-dd");
        if (locationCode) {
            return Supplier.findAll({
                where: {
                    [Op.and]: [
                        { 'location_code': locationCode },
                        { 'effective_end_date': { [Op.gte]: currentDate } }
                    ]
                },
                order: [
                    ['effective_start_date', 'ASC']
                ]
            });
        } else {
            return Supplier.findAll();
        }
    },

    findSupplierByName: (supplierName, locationCode) => {
        if (locationCode) {
            return Supplier.findAll({
                where: {
                    [Op.and]: {
                        'supplier_name': supplierName,
                        'location_code': locationCode
                    }
                }
            });
        } else {
            return Supplier.findAll({
                where: {
                    'supplier_name': supplierName
                }
            });
        }
    },

    findSupplierByShortName: (shortName, locationCode) => {
        if (locationCode) {
            return Supplier.findAll({
                where: {
                    [Op.and]: {
                        'supplier_short_name': shortName,
                        'location_code': locationCode
                    }
                }
            });
        } else {
            return Supplier.findAll({
                where: {
                    'supplier_short_name': shortName
                }
            });
        }
    },

    create: (supplier) => {
        return Supplier.create(supplier);
    },

    update: (supplier) => {
        return Supplier.update(supplier, {
            where: { 'supplier_id': supplier.supplier_id }
        });
    },

    disableSupplier: (supplierId, updatedBy) => {
        const currentDate = dateFormat(new Date(), "yyyy-mm-dd");
        return Supplier.update({
            effective_end_date: currentDate,
            updated_by: updatedBy,
            updation_date: new Date()
        }, {
            where: { 'supplier_id': supplierId }
        });
    },

    enableSupplier: (supplierId, updatedBy) => {
        return Supplier.update({
            effective_end_date: '9999-12-31',
            updated_by: updatedBy,
            updation_date: new Date()
        }, {
            where: { supplier_id: supplierId }
        });
    },

    findDisabledSuppliers: (locationCode) => {
        const currentDate = dateFormat(new Date(), "yyyy-mm-dd");
        return Supplier.findAll({
            where: {
                [Op.and]: [
                    { location_code: locationCode },
                    { effective_end_date: { [Op.lt]: currentDate } }
                ]
            },
            order: [
                ['effective_end_date', 'DESC']
            ]
        });
    },

    findById: (supplierId) => {
        return Supplier.findOne({
            where: { supplier_id: supplierId }
        });
    },

    // Find all active suppliers (not disabled)
    findActiveSuppliers: (locationCode) => {
        const now = new Date();
        if (locationCode) {
            return Supplier.findAll({
                where: {
                    [Op.and]: [
                        { location_code: locationCode },
                        { effective_end_date: { [Op.gt]: now } }
                    ]
                },
                order: [
                    ['supplier_name', 'ASC']
                ]
            });
        } else {
            return Supplier.findAll({
                where: {
                    effective_end_date: { [Op.gt]: now }
                },
                order: [
                    ['supplier_name', 'ASC']
                ]
            });
        }
    },
    // Add this to your existing supplier DAO file

// Find suppliers active on a specific date
findSuppliersActiveOnDate: (locationCode, date) => {
    const formattedDate = dateFormat(date, "yyyy-mm-dd");
    
    if (locationCode) {
        return Supplier.findAll({
            where: {
                [Op.and]: [
                    { location_code: locationCode },
                    { effective_start_date: { [Op.lte]: formattedDate } },
                    { effective_end_date: { [Op.gte]: formattedDate } }
                ]
            },
            order: [
                ['supplier_name', 'ASC']
            ]
        });
    } else {
        return Supplier.findAll({
            where: {
                [Op.and]: [
                    { effective_start_date: { [Op.lte]: formattedDate } },
                    { effective_end_date: { [Op.gte]: formattedDate } }
                ]
            },
            order: [
                ['supplier_name', 'ASC']
            ]
        });
    }
},

// Get all suppliers with their effective dates for client-side filtering
getAllSuppliersWithDates: (locationCode) => {
    if (locationCode) {
        return Supplier.findAll({
            attributes: [
                'supplier_id', 
                'supplier_name', 
                'effective_start_date', 
                'effective_end_date'
            ],
            where: {
                location_code: locationCode
            },
            order: [
                ['supplier_name', 'ASC']
            ]
        });
    } else {
        return Supplier.findAll({
            attributes: [
                'supplier_id', 
                'supplier_name', 
                'effective_start_date', 
                'effective_end_date'
            ],
            order: [
                ['supplier_name', 'ASC']
            ]
        });
    }
},

    // Find suppliers with pagination
    findSuppliersWithPagination: (locationCode, page = 1, limit = 10) => {
        const offset = (page - 1) * limit;
        if (locationCode) {
            return Supplier.findAndCountAll({
                where: {
                    location_code: locationCode
                },
                order: [['supplier_name', 'ASC']],
                limit: limit,
                offset: offset
            });
        } else {
            return Supplier.findAndCountAll({
                order: [['supplier_name', 'ASC']],
                limit: limit,
                offset: offset
            });
        }
    }
};