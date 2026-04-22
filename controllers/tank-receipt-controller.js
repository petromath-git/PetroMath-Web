const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const db = require("../db/db-connection");
const fs = require('fs');
const PersonDao = require("../dao/person-dao");
const TxnReadDao = require("../dao/txn-read-dao");
const TxnTankRcptDao = require ("../dao/txn-tankrcpt-dao");
const TxnStkRcptDtlDao = require("../dao/txn-stkrcpt-dtl-dao");
const TankDao = require("../dao/tank-dao");
const TruckDao = require("../dao/truck-dao");
const LookupDao = require("../dao/lookup-dao");
const locationConfig = require("../utils/location-config");
const LocationDao = require("../dao/location-dao");
const InvoiceParserService = require("../services/invoice-parser-service");
const TankInvoiceDao = require("../dao/tank-invoice-dao");
const InvoiceProductMapDao = require("../dao/invoice-product-map-dao");
const { v4: uuidv4 } = require('uuid');

// Temp store for uploaded PDF buffers pending user product confirmation (in-memory, short-lived)
const tempInvoiceStore = new Map();


module.exports = {

    // Getting home data
    getTankReceipts: (req, res, next) => {
        getHomeData(req, res, next);
    },


    // Create Tank receipt - one at a time
    saveTankReceipts: (req, res, next) => {
        const receiptData = req.body;
        txnWriteReceiptPromise(receiptData)
            .then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved decant header successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
    },

    //function to load the decant header
    getNewData: async (req, res, next) => {
        const locationCode = req.user.location_code;
        const maxDecantLines = Number(await locationConfig.getLocationConfigValue(
            locationCode, 'MAX_DECANT_LINES', 3
        ));
        getDraftsCount(locationCode).then(data => {
            if(data < config.APP_CONFIGS.maxAllowedDrafts) {
                Promise.allSettled([personDataPromise(locationCode),
                getDriverHelper(locationCode),
                tankCodePromise(locationCode),
                truckDataPromise(locationCode),
                getLocationId(locationCode),
                LookupDao.getLookupByType('TANK_QUANTITY', locationCode)])
                    .then((values) => {
                        res.render('new-decant', {
                            user: req.user,
                            config: config.APP_CONFIGS,
                            inchargers: values[0].value.inchargers,
                            currentDate: utils.currentDate(),
                            drivers: values[1].value.drivers,
                            tanks: values[2].value.tanks,
                            trucks: values[3].value.trucks,
                            location: values[4].value.location_id,
                            tankQuantities: values[5].value || [],
                            maxDecantLines: maxDecantLines
                        });
                    }).catch((err) => {
                        console.warn("Error while getting data using promises " + err.toString());
                        Promise.reject(err);
                    });
            } else {
                getTankReceipts(req, res, next);
            }
        })

    },
    // delete tank receipts
    deleteTankReceipts: (req, res,next)  => {
        TxnTankRcptDao.deletetankReceipt(req.query.id).then(() => {
            // TODO: fix the data check later, not finding proper documentation on it.
            res.status(200).send({message: 'The Tank receipt is deleted successfully.'});
        }).error((err) => {
            res.status(500).send({error: 'Error while deleting the Tank Receipt.'});
        });

    },

    // Delete Decant Line
    deleteDecantLines: (req, res, next) => {
        const decantLineId = req.query.id;
        if (decantLineId) {
            txnDeleteDecantLinePromise(decantLineId).then((result) => {
                if (!result.error) {
                    res.status(200).send({
                        message: result.message
                    });
                } else {
                    res.status(500).send({error: result.error});
                }
            });
        } else {
            res.status(302).send();
        }
    },
    //save decant lines
    saveDecantLines: (req, res, next) => {
        const decantLineData=req.body;
        txnWriteDecantLinesPromise(decantLineData)
            .then((result) => {
                if (!result.error) {
                    res.status(200).send({message: 'Saved Decant Lines successfully.', rowsData: result});
                } else {
                    res.status(500).send({error: result.error});
                }
            });
    },

    parseInvoicePdf: async (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No PDF file uploaded.' });
            }
            const locationCode = req.user.location_code;
            const location = await LocationDao.findByLocationCode(locationCode);
            const companyName = location && location.company_name ? location.company_name : null;

            if (!companyName) {
                return res.status(400).json({ success: false, error: `No oil company configured for location ${locationCode}. Check m_location.company_name.` });
            }

            const pdfBuffer = fs.readFileSync(req.file.path);
            fs.unlink(req.file.path, () => {});

            const result = await InvoiceParserService.parseInvoice(pdfBuffer, companyName);

            // Validate dealer code if configured — catches wrong-location uploads (e.g. MC invoice at MC2)
            const dealerCode = location.oil_co_dealer_code ? String(location.oil_co_dealer_code).trim() : null;
            if (dealerCode && !result.rawText.includes(dealerCode)) {
                return res.status(400).json({
                    success: false,
                    error: `Invoice does not belong to this outlet. Expected dealer code ${dealerCode} not found in the PDF.`
                });
            }

            // Resolve supplier_id — mandatory
            const supplierRow = await db.sequelize.query(
                `SELECT supplier_id, supplier_name FROM m_supplier WHERE UPPER(supplier_short_name) = UPPER(:code) AND location_code = :loc LIMIT 1`,
                { replacements: { code: result.supplier, loc: locationCode }, type: db.Sequelize.QueryTypes.SELECT }
            ).then(r => r[0] || null);

            if (!supplierRow) {
                return res.status(400).json({
                    success: false,
                    error: `Supplier "${result.supplier}" not found in supplier master for this location. Please add it under Supplier Master first.`
                });
            }

            // Stash buffer temporarily — saved to DB only after user confirms products
            const tempId = uuidv4();
            const originalFileName = req.file ? req.file.originalname : 'invoice.pdf';
            tempInvoiceStore.set(tempId, { buffer: pdfBuffer, supplierId: supplierRow.supplier_id, originalFileName, expires: Date.now() + 30 * 60 * 1000 });
            for (const [k, v] of tempInvoiceStore) { if (v.expires < Date.now()) tempInvoiceStore.delete(k); }

            const [products, mappings] = await Promise.all([
                getTankProductsForLocation(locationCode),
                InvoiceProductMapDao.getMappings(locationCode, supplierRow.supplier_id)
            ]);

            const linesWithCharges = result.lines.map(l => {
                const charges = [];
                if (l.vat_pct != null || l.vat_amount != null)
                    charges.push({ charge_type: 'VAT', charge_pct: l.vat_pct || null, charge_amount: l.vat_amount || null });
                if (l.additional_vat_amount != null)
                    charges.push({ charge_type: 'ADDITIONAL_VAT', charge_pct: null, charge_amount: l.additional_vat_amount });
                if (l.delivery_charge != null)
                    charges.push({ charge_type: 'DELIVERY_CHARGE', charge_pct: null, charge_amount: l.delivery_charge });
                return { ...l, charges };
            });

            return res.json({
                success: true,
                supplier: result.supplier,
                supplierId: supplierRow.supplier_id,
                supplierName: supplierRow.supplier_name,
                tempId,
                products,
                mappings,
                data: { header: result.header, lines: linesWithCharges }
            });
        } catch (err) {
            console.error('Error parsing invoice PDF:', err);
            return res.status(500).json({ success: false, error: 'Failed to read invoice: ' + err.message });
        }
    },

    saveInvoiceWithProducts: async (req, res, next) => {
        try {
            const { tempId, supplierId, supplier, header, lines } = req.body;
            const locationCode = req.user.location_code;

            if (!supplierId) {
                return res.status(400).json({ success: false, error: 'Supplier is required.' });
            }
            if (!lines || lines.some(l => !l.product_id)) {
                return res.status(400).json({ success: false, error: 'All invoice lines must have a product selected.' });
            }

            const temp = tempInvoiceStore.get(tempId);
            const pdfBuffer = temp ? temp.buffer : null;
            const originalFileName = temp ? temp.originalFileName : 'invoice.pdf';
            if (temp) tempInvoiceStore.delete(tempId);

            const headerData = {
                location_id: locationCode,
                supplier_id: Number(supplierId),
                supplier,
                invoice_number: header.invoice_number || null,
                invoice_date: header.invoice_date || null,
                truck_number: header.truck_number || null,
                delivery_doc_no: header.delivery_doc_no || null,
                seal_lock_no: header.seal_lock_no || null,
                total_invoice_amount: header.total_invoice_amount || null
            };

            const lineData = lines.map(l => {
                const charges = [];
                if (l.vat_pct != null || l.vat_amount != null)
                    charges.push({ charge_type: 'VAT', charge_pct: l.vat_pct || null, charge_amount: l.vat_amount || null });
                if (l.additional_vat_amount != null)
                    charges.push({ charge_type: 'ADDITIONAL_VAT', charge_pct: null, charge_amount: l.additional_vat_amount });
                if (l.delivery_charge != null)
                    charges.push({ charge_type: 'DELIVERY_CHARGE', charge_pct: null, charge_amount: l.delivery_charge });
                return {
                    product_id: Number(l.product_id),
                    product_name: l.product_name || null,
                    quantity: l.quantity || null,
                    rate_per_kl: l.rate_per_kl || null,
                    density: l.density || null,
                    hsn_code: l.hsn_code || null,
                    total_line_amount: l.total_line_amount || null,
                    charges
                };
            });

            const invoice = await TankInvoiceDao.saveInvoice(headerData, lineData, pdfBuffer, locationCode, Number(supplierId), originalFileName);
            return res.json({ success: true, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number });
        } catch (err) {
            console.error('Error saving invoice:', err);
            return res.status(500).json({ success: false, error: 'Failed to save invoice: ' + err.message });
        }
    },

    invoicePreview: async (req, res, next) => {
        try {
            const invoiceNumber = (req.query.invoiceNumber || '').trim();
            if (!invoiceNumber) return res.status(400).json({ success: false, error: 'invoiceNumber required' });

            const locationCode = req.user.location_code;
            const invoice = await TankInvoiceDao.findByInvoiceNumber(locationCode, invoiceNumber);
            if (!invoice) return res.json({ success: false, error: 'No invoice found for this invoice number.' });

            return res.json({ success: true, invoice });
        } catch (err) {
            console.error('Error fetching invoice preview:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    closeData: (req, res, next) => {
     TxnTankRcptDao.finishClosing(req.query.id)
        .then(() => {
            res.status(200).send({ message: 'The decant record is made final.' });
        })
        .catch((err) => {   // ← change only this
            console.error(err);
            res.status(500).send({ error: 'Error while closing the Tank Receipt.' });
        });
}

}
const getTankProductsForLocation = (locationCode) => {
    return db.sequelize.query(
        `SELECT product_id, product_name FROM m_product WHERE location_code = :locationCode AND is_tank_product = 1 ORDER BY product_name`,
        { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
    ).catch(() => []);
};

const getDraftsCount = (locationCode) => {
    return new Promise((resolve, reject) => {
        return TxnReadDao.getDraftClosingsCount(locationCode)
            .then(data => {
                resolve(data);
            });
    });
}

// Add new flow: Get person data
const personDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let inchargers = [];
        PersonDao.findUsers(locationCode)
            .then(data => {
                const now = new Date();
                const nowDate = dateFormat(now, "yyyy-mm-dd");
                data.forEach((person) => {
                    if (person.effective_end_date > nowDate && person.effective_end_date != nowDate) {
                        inchargers.push({ personName: person.Person_Name, personId: person.Person_id });
                    }
                });
                resolve({ inchargers: inchargers });
            });
    });
}

const getDriverHelper = (locationCode) => {
    return new Promise((resolve, reject) => {
        let drivers = [];
        PersonDao.findDrivers(locationCode)
            .then(data => {
                const now = new Date();
                const nowDate = dateFormat(now, "yyyy-mm-dd");
                data.forEach((person) => {
                    if (person.effective_end_date > nowDate && person.effective_end_date != nowDate) {
                        drivers.push({ personName: person.Person_Name, personId: person.Person_id });
                    }
                });
                resolve({ drivers: drivers });
            });
    });
};

const getDraftsCountBeforeDays = (locationCode, noOfDays) => {
    return new Promise((resolve, reject) => {
        TxnReadDao.getDraftClosingsCountBeforeDays(locationCode, noOfDays)
            .then(data => {
                resolve(data);
            });
    });
}


const txnWriteReceiptPromise = (receiptData) => {
    return new Promise((resolve, reject) => {
        TxnTankRcptDao.saveReceiptData(receiptData)
            .then(data => {
                resolve(data);
            }).catch((err) => {
                console.error("Error while saving Decant Header " + err.toString());
            resolve({error: err.toString()});
            });
    });
}

const tankCodePromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let tanks = [];
        TankDao.findActiveTanks(locationCode)
            .then(data => {
                data.forEach((tank) => {
                    tanks.push({
                        tankId: tank.tank_id,
                        productCode: tank.product_code,
                        tankCode: tank.tank_code,
                    });
                });
                resolve({tanks: tanks});
            });

    });
}

const txnWriteDecantLinesPromise = (decantLineData) => {
    return new Promise((resolve, reject) => {
        TxnStkRcptDtlDao.saveDecantLineData(decantLineData)
            .then(data => {
                resolve(data);
            }).catch((err) => {
                console.error("Error while saving Decant Lines " + err.toString());
        resolve({error: err.toString()});
            });
    });
}

const txnDeleteDecantLinePromise = (decantLineId) => {
    return new Promise((resolve, reject) => {
        TxnStkRcptDtlDao.deleteDecantLineById(decantLineId)
            .then(status => {
                if (status > 0) {
                resolve({message: 'Data deletion success.'});
                } else {
                resolve({error: 'Data deletion failed.'});
                }
            }).catch((err) => {
                console.error("Error while deleting readings " + err.toString());
        resolve({error: err.toString()});
            });
    });
}

const getHomeData = (req, res, next) => {
    let locationCode = req.user.location_code;
    const now = new Date();
    let fromDate = dateFormat(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-mm-dd");
    let toDate = dateFormat(now, "yyyy-mm-dd");
    if(req.query.tankreceipts_fromDate) {
        fromDate = req.query.tankreceipts_fromDate;
    }
    if(req.query.tankreceipts_toDate) {
        toDate = req.query.tankreceipts_toDate;
    }
    Promise.allSettled([
        getTankRcptByDate(locationCode, fromDate, toDate),
        getTankProductColumns(locationCode),
        getTankProductQty(locationCode, fromDate, toDate),
        getInvoiceNumbersSet(locationCode)
    ]).then(values => {
            const receipts = values[0].value || [];
            const productColumns = values[1].value || [];
            const invoiceNumbers = values[3].value || new Set();
            const qtyMap = {};
            (values[2].value || []).forEach(row => {
                if (!qtyMap[row.ttank_id]) qtyMap[row.ttank_id] = {};
                qtyMap[row.ttank_id][row.product_code] = row.qty;
            });
            receipts.forEach(r => {
                Object.assign(r, qtyMap[r.ttank_id] || {});
                r.hasInvoice = invoiceNumbers.has(r.invoice_number);
            });

            res.render('tankreceipts', {
                title: 'Tank Receipts',
                user: req.user,
                config: config.APP_CONFIGS,
                tankReceiptsValues: receipts,
                productColumns: productColumns,
                currentDate: utils.currentDate(),
                fromDate: fromDate,
                toDate: toDate,
            });
        });
}

const getTankRcptByDate = (locationCode, fromDate, toDate) => {
    return new Promise((resolve, reject) => {
        let receipts = [];
        TxnTankRcptDao.getTankRcptByDate(locationCode, fromDate, toDate)
            .then(data => {
                data.forEach((receiptsData) => {
                    receipts.push({ttank_id: receiptsData.ttank_id,
                        invoice_date: receiptsData.fomratted_inv_date,
                        invoice_number: receiptsData.invoice_number,
                        decant_date: receiptsData.fomratted_decant_date,
                        decant_time: receiptsData.decant_time,
                        decant_incharge: receiptsData.decant_incharge,
                        truck_number: receiptsData.truck_number,
                        odometer_reading: receiptsData.odometer_reading,
                        amount:receiptsData.amount,
                        driver: receiptsData.driver,
                        helper: receiptsData.helper,
                        closingStatus: receiptsData.closing_status
                    });
                });
                resolve(receipts);
            });

    });
}
const truckDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let trucks = [];
        TruckDao.getAllTruckno(locationCode)
            .then(data => {
                data.forEach((truck) => {
                    trucks.push({truck_id: truck.truck_id, truck_number: truck.truck_number});
                });
                resolve({trucks: trucks});
            });

    });
}

const getTankProductQty = (locationCode, fromDate, toDate) => {
    return new Promise((resolve) => {
        db.sequelize.query(
            `SELECT d.ttank_id, mt.product_code, SUM(d.quantity) AS qty
             FROM t_tank_stk_rcpt_dtl d
             JOIN m_tank mt ON mt.tank_id = d.tank_id
             JOIN t_tank_stk_rcpt h ON h.ttank_id = d.ttank_id
             WHERE h.location_code = :locationCode
               AND DATE_FORMAT(h.invoice_date, '%Y-%m-%d') >= :fromDate
               AND DATE_FORMAT(h.invoice_date, '%Y-%m-%d') <= :toDate
             GROUP BY d.ttank_id, mt.product_code`,
            {
                replacements: { locationCode, fromDate, toDate },
                type: db.Sequelize.QueryTypes.SELECT
            }
        ).then(rows => resolve(rows)).catch(() => resolve([]));
    });
}

const getTankProductColumns = (locationCode) => {
    return new Promise((resolve) => {
        TankDao.findActiveTanks(locationCode)
            .then(data => {
                const seen = new Set();
                const productColumns = [];
                data.forEach(tank => {
                    if (tank.product_code && !seen.has(tank.product_code)) {
                        seen.add(tank.product_code);
                        productColumns.push({ key: tank.product_code, label: tank.product_code });
                    }
                });
                resolve(productColumns);
            })
            .catch(() => resolve([]));
    });
}

const getLocationId = (locationCode) => {
    return new Promise((resolve, reject) => {
        let location_id;
        TxnTankRcptDao.getLocationId(locationCode)
            .then(data => {
                location_id = data.location_id;
                resolve({location_id:location_id});
            });

    });
}

module.exports.checkInvoiceNumber = async (req, res) => {
    try {
        const { invoiceNumber, excludeId } = req.query;
        const locationCode = req.session.passport.user.location_code;
        if (!invoiceNumber || !invoiceNumber.trim()) return res.json({ duplicate: false });

        const sql = `SELECT ttank_id, invoice_number, decant_date
                     FROM t_tank_stk_rcpt
                     WHERE location_code = :locationCode
                       AND invoice_number = :invoiceNumber
                       ${excludeId ? 'AND ttank_id != :excludeId' : ''}
                     LIMIT 1`;
        const rows = await db.sequelize.query(sql, {
            replacements: { locationCode, invoiceNumber: invoiceNumber.trim(), excludeId: excludeId || null },
            type: db.Sequelize.QueryTypes.SELECT
        });
        if (rows.length === 0) return res.json({ duplicate: false });
        const r = rows[0];
        return res.json({ duplicate: true, receiptId: r.ttank_id, decantDate: r.decant_date });
    } catch (err) {
        console.error('checkInvoiceNumber error:', err);
        return res.json({ duplicate: false });
    }
};

const getInvoiceNumbersSet = (locationCode) => {
    return new Promise((resolve) => {
        db.sequelize.query(
            `SELECT invoice_number FROM t_tank_invoice WHERE location_id = :locationCode AND invoice_number IS NOT NULL`,
            { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
        ).then(rows => {
            resolve(new Set(rows.map(r => r.invoice_number)));
        }).catch(() => resolve(new Set()));
    });
}
