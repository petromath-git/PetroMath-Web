const dsmEntryDao = require("../dao/dsm-entry-dao");
const DocumentStoreDao = require("../dao/document-store-dao");
const { getLocationConfigValue } = require("../utils/location-config");

const PHOTO_ENTITY_TYPE = 'CREDIT_BILL';
const PHOTO_DOC_CATEGORY = 'BILL_PHOTO';

module.exports = {

    // GET /dsm-entry
    // Renders the mobile entry page
    getPage: async (req, res, next) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;

            const allowBillPhoto = (await getLocationConfigValue(locationCode, 'ALLOW_DSM_BILL_PHOTO', 'N')) === 'Y';
            // Separate from allowBillPhoto: a location can capture photos without
            // OCR auto-fill (e.g. handwritten bills, or before the regex extraction
            // has been tuned against a sample from that location's bill format).
            const allowBillOcr = allowBillPhoto && (await getLocationConfigValue(locationCode, 'ALLOW_DSM_BILL_OCR', 'N')) === 'Y';
            // Separate gate again: loads a heavy (~8-10MB) client-side CV library
            // (OpenCV.js + jscanify) to auto-detect/crop the bill's edges. Kept
            // independent so it can be switched off per-location without
            // affecting photo capture or OCR if it misbehaves on a device.
            const allowBillAutoCrop = allowBillPhoto && (await getLocationConfigValue(locationCode, 'ALLOW_DSM_BILL_AUTOCROP', 'N')) === 'Y';

            // Check for active shift
            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);

            if (!activeClosing) {
                // Still fetch today's entries from closed shifts so cashier can see them
                const entries = await dsmEntryDao.getEntriesByClosing(null, cashierId, locationCode);
                return res.render("dsm-entry", {
                    title: "Credit Entry",
                    user,
                    activeClosing: null,
                    products: [],
                    credits: [],
                    entries,
                    allowBillPhoto,
                    allowBillOcr,
                    allowBillAutoCrop,
                    pageData: JSON.stringify({
                        activeClosing: null,
                        products: [],
                        credits: [],
                        entries,
                        allVehicles: [],
                        allowBillPhoto,
                        allowBillOcr,
                        allowBillAutoCrop
                    })
                });
            }

            const [products, credits, entries, allVehicles] = await Promise.all([
                dsmEntryDao.getTankProducts(locationCode),
                dsmEntryDao.getCreditCustomers(locationCode),
                dsmEntryDao.getEntriesByClosing(activeClosing.closing_id, cashierId, locationCode),
                dsmEntryDao.getAllVehicles(locationCode)
            ]);

            const pageData = {
                activeClosing,
                products,
                credits,
                entries,
                allVehicles,
                allowBillPhoto,
                allowBillOcr,
                allowBillAutoCrop
            };

            return res.render("dsm-entry", {
                title: "Credit Entry",
                user,
                activeClosing,
                products,
                credits,
                entries,
                allowBillPhoto,
                allowBillOcr,
                allowBillAutoCrop,
                pageData: JSON.stringify(pageData)
            });

        } catch (err) {
            console.error("DSM entry page error:", err);
            next(err);
        }
    },

    // POST /dsm-entry
    // Save a new credit entry
    saveEntry: async (req, res) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;

            const { creditlist_id, vehicle_id, product_id, qty, amount, bill_no, credit_bill_date, notes } = req.body;

            // Validate required fields
            if (!creditlist_id || !product_id || !qty || !amount) {
                return res.status(400).json({ success: false, message: "Customer, product, quantity and amount are required." });
            }

            if (parseFloat(qty) <= 0 || parseFloat(amount) <= 0) {
                return res.status(400).json({ success: false, message: "Quantity and amount must be greater than zero." });
            }

            if (!credit_bill_date) {
                return res.status(400).json({ success: false, message: "Credit bill date is required." });
            }

            // Re-verify active closing on save (don't trust client-side closing_id)
            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);
            if (!activeClosing) {
                return res.status(400).json({ success: false, message: "No active shift found. Cannot save entry." });
            }

            const closingDateStr = new Date(activeClosing.closing_date).toISOString().slice(0, 10);
            const selectedDateStr = new Date(credit_bill_date).toISOString().slice(0, 10);
            const previousDateStr = addDays(closingDateStr, -1);
            const nextDateStr = addDays(closingDateStr, 1);
            const systemDateStr = new Date().toISOString().slice(0, 10);

            if (![previousDateStr, closingDateStr, nextDateStr].includes(selectedDateStr)) {
                return res.status(400).json({ success: false, message: "Credit bill date must be closing date, previous day, or next day." });
            }
            if (selectedDateStr === nextDateStr && systemDateStr < nextDateStr) {
                return res.status(400).json({ success: false, message: "Next-day credit bill date is allowed only when system date has reached that day." });
            }

            const insertId = await dsmEntryDao.saveEntry({
                closing_id:    activeClosing.closing_id,
                creditlist_id: parseInt(creditlist_id),
                vehicle_id:    vehicle_id ? parseInt(vehicle_id) : null,
                product_id:    parseInt(product_id),
                qty:           parseFloat(qty),
                amount:        parseFloat(amount),
                bill_no:       bill_no || null,
                credit_bill_date: credit_bill_date,
                notes:         notes || null,
                created_by:    user.User_Name
            });

            // Return updated entries list
            const entries = await dsmEntryDao.getEntriesByClosing(activeClosing.closing_id, cashierId, locationCode);

            return res.json({ success: true, message: "Entry saved.", insertId, entries });

        } catch (err) {
            console.error("DSM save entry error:", err);
            return res.status(500).json({ success: false, message: "Server error while saving entry." });
        }
    },

    // DELETE /dsm-entry/:tcreditId
    // Delete an entry belonging to the cashier's active closing
    deleteEntry: async (req, res) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;
            const tcreditId = parseInt(req.params.tcreditId);

            if (!tcreditId) {
                return res.status(400).json({ success: false, message: "Invalid entry ID." });
            }

            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);
            if (!activeClosing) {
                return res.status(400).json({ success: false, message: "No active shift found." });
            }

            await dsmEntryDao.deleteEntry(tcreditId, activeClosing.closing_id);

            // Return updated entries list
            const entries = await dsmEntryDao.getEntriesByClosing(activeClosing.closing_id, cashierId, locationCode);

            return res.json({ success: true, message: "Entry deleted.", entries });

        } catch (err) {
            console.error("DSM delete entry error:", err);
            return res.status(500).json({ success: false, message: "Server error while deleting entry." });
        }
    },

    // GET /dsm-entry/vehicles/:creditlistId
    // Returns vehicles for a selected customer (used by dropdown AJAX)
    getVehicles: async (req, res) => {
        try {
            const creditlistId = parseInt(req.params.creditlistId);
            if (!creditlistId) {
                return res.status(400).json({ success: false, message: "Invalid customer ID." });
            }

            const vehicles = await dsmEntryDao.getVehiclesForCustomer(creditlistId);
            return res.json({ success: true, vehicles });

        } catch (err) {
            console.error("DSM get vehicles error:", err);
            return res.status(500).json({ success: false, message: "Server error." });
        }
    },

    // GET /dsm-entry/all-vehicles
    // Returns all vehicles across all customers for this location (vehicle-first mode)
    getAllVehicles: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const vehicles = await dsmEntryDao.getAllVehicles(locationCode);
            return res.json({ success: true, vehicles });
        } catch (err) {
            console.error("DSM get all vehicles error:", err);
            return res.status(500).json({ success: false, message: "Server error." });
        }
    },

    // POST /dsm-entry/:tcreditId/photo
    // Attach (or swap) the printed-bill photo for a credit entry.
    // Only entries in the cashier's own active (DRAFT) closing can be touched here —
    // matches the existing delete-entry ownership rule on this screen.
    uploadPhoto: async (req, res) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;

            const allowBillPhoto = (await getLocationConfigValue(locationCode, 'ALLOW_DSM_BILL_PHOTO', 'N')) === 'Y';
            if (!allowBillPhoto) {
                return res.status(403).json({ success: false, message: "Bill photo capture is not enabled for this location." });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, message: "No photo uploaded." });
            }

            const tcreditId = parseInt(req.params.tcreditId);

            if (!tcreditId) {
                return res.status(400).json({ success: false, message: "Invalid entry ID." });
            }

            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);
            if (!activeClosing) {
                return res.status(400).json({ success: false, message: "No active shift found." });
            }

            const belongs = await dsmEntryDao.entryBelongsToClosing(tcreditId, activeClosing.closing_id);
            if (!belongs) {
                return res.status(403).json({ success: false, message: "Entry not found in your active shift." });
            }

            // Enforce configurable size limit (DOC_MAX_UPLOAD_MB, default 2) — same key/pattern as employee photos
            const maxMb = parseFloat(await getLocationConfigValue(locationCode, 'DOC_MAX_UPLOAD_MB', '2'));
            const maxBytes = maxMb * 1024 * 1024;
            if (req.file.size > maxBytes) {
                return res.status(400).json({ success: false, message: `Photo must be ${maxMb} MB or smaller.` });
            }

            const captureSource = req.body.capture_source === 'CAMERA' ? 'CAMERA' : 'UPLOAD';

            // If a photo is already linked, this is a swap: create the new one, then
            // flip the old row to REPLACED (kept for audit trail, not deleted).
            const existing = await DocumentStoreDao.findActiveByEntity(PHOTO_ENTITY_TYPE, tcreditId, PHOTO_DOC_CATEGORY);

            const newDoc = await DocumentStoreDao.create({
                entity_type:    PHOTO_ENTITY_TYPE,
                entity_id:      tcreditId,
                doc_category:   PHOTO_DOC_CATEGORY,
                file_name:      req.file.originalname,
                mime_type:      req.file.mimetype,
                file_size:      req.file.size,
                file_data:      req.file.buffer,
                capture_source: captureSource,
                location_code:  locationCode,
                created_by:     user.User_Name
            });

            if (existing) {
                await DocumentStoreDao.markReplaced(existing.doc_id, newDoc.doc_id);
            }

            return res.json({ success: true, photo: { doc_id: newDoc.doc_id, url: `/documents/${newDoc.doc_id}` } });

        } catch (err) {
            console.error("DSM upload photo error:", err);
            return res.status(500).json({ success: false, message: "Server error while uploading photo." });
        }
    },

    // DELETE /dsm-entry/:tcreditId/photo/:docId
    // Soft-unlink — the row and blob stay in t_document_store (status=UNLINKED)
    // for search/relink; only the link to this bill is removed.
    deletePhoto: async (req, res) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;
            const tcreditId = parseInt(req.params.tcreditId);
            const docId = parseInt(req.params.docId);

            if (!tcreditId || !docId) {
                return res.status(400).json({ success: false, message: "Invalid request." });
            }

            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);
            if (!activeClosing) {
                return res.status(400).json({ success: false, message: "No active shift found." });
            }

            const belongs = await dsmEntryDao.entryBelongsToClosing(tcreditId, activeClosing.closing_id);
            if (!belongs) {
                return res.status(403).json({ success: false, message: "Entry not found in your active shift." });
            }

            const doc = await DocumentStoreDao.findMetaById(docId);
            if (!doc || doc.entity_type !== PHOTO_ENTITY_TYPE || doc.entity_id !== tcreditId) {
                return res.status(404).json({ success: false, message: "Photo not found." });
            }

            await DocumentStoreDao.unlink(docId, user.User_Name);
            return res.json({ success: true });

        } catch (err) {
            console.error("DSM delete photo error:", err);
            return res.status(500).json({ success: false, message: "Server error while removing photo." });
        }
    }

};

function addDays(dateStr, days) {
    const date = new Date(dateStr + "T00:00:00");
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}
