const SupplierDao = require("../dao/supplier-dao");
const dateFormat = require('dateformat');

module.exports = {
    findSuppliers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let suppliers = [];
            SupplierDao.findSuppliers(locationCode)
                .then(data => {
                    data.forEach((supplier) => {
                        suppliers.push({
                            id: supplier.supplier_id,
                            name: supplier.supplier_name,
                            shortName: supplier.supplier_short_name,
                            locationCode: supplier.location_code,
                            effective_start_date: dateFormat(supplier.effective_start_date, "dd-mm-yyyy"),
                            createdBy: supplier.created_by,
                            creation_date: dateFormat(supplier.creation_date, "dd-mm-yyyy")
                        });
                    });
                    resolve(suppliers);
                })
                .catch(err => {
                    console.error("Error in supplierController:", err);
                    reject(err);
                });
        });
    },

    findDisabledSuppliers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let suppliers = [];
            SupplierDao.findDisabledSuppliers(locationCode)
                .then(data => {
                    data.forEach(supplier => {
                        suppliers.push({
                            id: supplier.supplier_id,
                            name: supplier.supplier_name,
                            shortName: supplier.supplier_short_name,
                            locationCode: supplier.location_code,
                            effective_end_date: dateFormat(supplier.effective_end_date, "dd-mm-yyyy"),
                            updatedBy: supplier.updated_by,
                            updation_date: dateFormat(supplier.updation_date, "dd-mm-yyyy")
                        });
                    });
                    resolve(suppliers);
                })
                .catch(err => {
                    console.error("Error in supplierController:", err);
                    reject(err);
                });
        });
    },

    createSupplier: (supplierData, username) => {
        return new Promise((resolve, reject) => {
            const now = dateFormat(new Date(), "yyyy-mm-dd");
            const supplier = {
                supplier_name: supplierData.name,
                supplier_short_name: supplierData.shortName,
                location_code: supplierData.locationCode,
                location_id: supplierData.locationId,
                effective_start_date: supplierData.effectiveStartDate || now,
                effective_end_date: '9999-12-31',
                created_by: username,
                creation_date: new Date()
            };

            SupplierDao.create(supplier)
                .then(result => {
                    resolve(result);
                })
                .catch(err => {
                    console.error("Error creating supplier:", err);
                    reject(err);
                });
        });
    },

    updateSupplier: (supplierData, username) => {
        return new Promise((resolve, reject) => {
            const supplier = {
                supplier_id: supplierData.id,
                supplier_name: supplierData.name,
                supplier_short_name: supplierData.shortName,
                location_code: supplierData.locationCode,
                location_id: supplierData.locationId,
                updated_by: username,
                updation_date: new Date()
            };

            SupplierDao.update(supplier)
                .then(result => {
                    resolve(result);
                })
                .catch(err => {
                    console.error("Error updating supplier:", err);
                    reject(err);
                });
        });
    },

    disableSupplier: (supplierId, username) => {
        return new Promise((resolve, reject) => {
            SupplierDao.disableSupplier(supplierId, username)
                .then(result => {
                    resolve(result);
                })
                .catch(err => {
                    console.error("Error disabling supplier:", err);
                    reject(err);
                });
        });
    },

    enableSupplier: (supplierId, username) => {
        return new Promise((resolve, reject) => {
            SupplierDao.enableSupplier(supplierId, username)
                .then(result => {
                    resolve(result);
                })
                .catch(err => {
                    console.error("Error enabling supplier:", err);
                    reject(err);
                });
        });
    },

    findActiveSuppliers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let suppliers = [];
            SupplierDao.findActiveSuppliers(locationCode)
                .then(data => {
                    data.forEach(supplier => {
                        suppliers.push({
                            id: supplier.supplier_id,
                            name: supplier.supplier_name,
                            shortName: supplier.supplier_short_name,
                            locationCode: supplier.location_code,
                            effectiveStartDate: dateFormat(supplier.effective_start_date, "dd-mm-yyyy"),
                            createdBy: supplier.created_by
                        });
                    });
                    resolve(suppliers);
                })
                .catch(err => {
                    console.error("Error in supplierController:", err);
                    reject(err);
                });
        });
    },

    findSuppliersWithPagination: (locationCode, page, limit) => {
        return new Promise((resolve, reject) => {
            SupplierDao.findSuppliersWithPagination(locationCode, page, limit)
                .then(result => {
                    const suppliers = result.rows.map(supplier => ({
                        id: supplier.supplier_id,
                        name: supplier.supplier_name,
                        shortName: supplier.supplier_short_name,
                        locationCode: supplier.location_code,
                        effectiveStartDate: dateFormat(supplier.effective_start_date, "dd-mm-yyyy"),
                        createdBy: supplier.created_by
                    }));
                    
                    resolve({
                        suppliers: suppliers,
                        total: result.count,
                        page: page,
                        totalPages: Math.ceil(result.count / limit)
                    });
                })
                .catch(err => {
                    console.error("Error in supplierController pagination:", err);
                    reject(err);
                });
        });
    }
};