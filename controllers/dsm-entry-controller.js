const dsmEntryDao = require("../dao/dsm-entry-dao");

module.exports = {

    // GET /dsm-entry
    // Renders the mobile entry page
    getPage: async (req, res, next) => {
        try {
            const user = req.user;
            const locationCode = user.location_code;
            const cashierId = user.Person_id;

            // Check for active shift
            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);

            if (!activeClosing) {
                return res.render("dsm-entry", {
                    title: "Credit Entry",
                    user,
                    activeClosing: null,
                    products: [],
                    credits: [],
                    entries: [],
                    pageData: JSON.stringify({
                        activeClosing: null,
                        products: [],
                        credits: [],
                        entries: []
                    })
                });
            }

            const [products, credits, entries] = await Promise.all([
                dsmEntryDao.getTankProducts(locationCode),
                dsmEntryDao.getCreditCustomers(locationCode),
                dsmEntryDao.getEntriesByClosing(activeClosing.closing_id, cashierId, locationCode)
            ]);

            const pageData = {
                activeClosing,
                products,
                credits,
                entries
            };

            return res.render("dsm-entry", {
                title: "Credit Entry",
                user,
                activeClosing,
                products,
                credits,
                entries,
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

            const { creditlist_id, vehicle_id, product_id, qty, amount, bill_no, notes } = req.body;

            // Validate required fields
            if (!creditlist_id || !product_id || !qty || !amount) {
                return res.status(400).json({ success: false, message: "Customer, product, quantity and amount are required." });
            }

            if (parseFloat(qty) <= 0 || parseFloat(amount) <= 0) {
                return res.status(400).json({ success: false, message: "Quantity and amount must be greater than zero." });
            }

            // Re-verify active closing on save (don't trust client-side closing_id)
            const activeClosing = await dsmEntryDao.getActiveClosing(cashierId, locationCode);
            if (!activeClosing) {
                return res.status(400).json({ success: false, message: "No active shift found. Cannot save entry." });
            }

            const insertId = await dsmEntryDao.saveEntry({
                closing_id:    activeClosing.closing_id,
                creditlist_id: parseInt(creditlist_id),
                vehicle_id:    vehicle_id ? parseInt(vehicle_id) : null,
                product_id:    parseInt(product_id),
                qty:           parseFloat(qty),
                amount:        parseFloat(amount),
                bill_no:       bill_no || null,
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
    }

};