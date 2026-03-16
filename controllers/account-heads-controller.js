// controllers/account-heads-controller.js
const AccountHeadsDao    = require("../dao/account-heads-dao");
const LedgerRulesDao     = require("../dao/ledger-rules-dao");
const BankDao            = require("../dao/bank-dao");
const rolePermissionsDao = require("../dao/role-permissions-dao");

module.exports = {

    listPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const role         = req.user.Role;
            const activeTab    = req.query.tab || 'heads';

            const [accountHeads, allRules, banks,
                   canEdit, canAdd, canDisable] = await Promise.all([
                AccountHeadsDao.getAccountHeads(locationCode),
                LedgerRulesDao.getAllRules(locationCode),
                BankDao.findAll(locationCode),
                rolePermissionsDao.hasPermission(role, locationCode, 'EDIT_ACCOUNT_HEADS'),
                rolePermissionsDao.hasPermission(role, locationCode, 'ADD_ACCOUNT_HEADS'),
                rolePermissionsDao.hasPermission(role, locationCode, 'DISABLE_ACCOUNT_HEADS'),
            ]);

            res.render("account-heads", {
                title: "Accounting Masters",
                user: req.user,
                accountHeads,
                allRules,
                banks,
                canEdit,
                canAdd,
                canDisable,
                activeTab
            });
        } catch (err) {
            console.error("Error rendering Account Heads page:", err);
            next(err);
        }
    },

    // ── Account Heads ─────────────────────────────────────────────────────

    create: async (req, res, next) => {
        try {
            const data = {
                location_code:        req.user.location_code,
                account_head_name:    req.body.account_head_name.trim().toUpperCase(),
                account_head_type:    req.body.account_head_type,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag || 'N',
                active_flag:          'Y',
                effective_start_date: req.body.effective_start_date || new Date().toISOString().split('T')[0],
                effective_end_date:   req.body.effective_end_date   || '2400-01-01',
                created_by:           req.user.username || req.user.Person_id
            };

            await AccountHeadsDao.createAccountHead(data);
            req.flash("success", "Account head created successfully");
            res.redirect("/account-heads");
        } catch (err) {
            console.error("Error creating account head:", err);
            req.flash("error", "Error creating account head");
            res.redirect("/account-heads");
        }
    },

    update: async (req, res, next) => {
        try {
            const data = {
                account_head_id:      req.body.account_head_id,
                account_head_name:    req.body.account_head_name.trim().toUpperCase(),
                account_head_type:    req.body.account_head_type,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag || 'N',
                active_flag:          req.body.active_flag          || 'Y',
                effective_start_date: req.body.effective_start_date,
                effective_end_date:   req.body.effective_end_date   || '2400-01-01',
                updated_by:           req.user.username || req.user.Person_id
            };

            await AccountHeadsDao.updateAccountHead(data);
            req.flash("success", "Account head updated successfully");
            res.redirect("/account-heads");
        } catch (err) {
            console.error("Error updating account head:", err);
            req.flash("error", "Error updating account head");
            res.redirect("/account-heads");
        }
    },

    deactivate: async (req, res, next) => {
        try {
            const id   = req.params.id;
            const user = req.user.username || req.user.Person_id;

            await AccountHeadsDao.deactivateAccountHead(id, user);
            req.flash("success", "Account head deactivated successfully");
            res.redirect("/account-heads");
        } catch (err) {
            console.error("Error deactivating account head:", err);
            req.flash("error", "Error deactivating account head");
            res.redirect("/account-heads");
        }
    },

    // ── Static Ledger Rules ───────────────────────────────────────────────
    // source_type is always 'Static'; external_id = account_head_id;
    // ledger_name = account_head_name. Credit/Supplier rules are trigger-managed.

    createRule: async (req, res, next) => {
        try {
            // external_id and ledger_name come from the account head dropdown selection
            const data = {
                location_code:        req.user.location_code,
                bank_id:              req.body.bank_id,
                external_id:          req.body.account_head_id,
                ledger_name:          req.body.ledger_name,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag  || 'N',
                max_amount:           req.body.max_amount            || null,
                effective_start_date: req.body.effective_start_date  || null,
                effective_end_date:   req.body.effective_end_date    || null,
                created_by:           req.user.username || req.user.Person_id
            };

            await LedgerRulesDao.createStaticRule(data);
            req.flash("success", "Ledger rule created successfully");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error creating ledger rule:", err);
            const msg = err.original?.code === 'ER_DUP_ENTRY'
                ? "A rule for this Bank + Account Head combination already exists"
                : (err.original?.sqlMessage || "Error creating ledger rule");
            req.flash("error", msg);
            res.redirect("/account-heads?tab=rules");
        }
    },

    updateRule: async (req, res, next) => {
        try {
            const data = {
                rule_id:              req.body.rule_id,
                bank_id:              req.body.bank_id,
                external_id:          req.body.account_head_id,
                ledger_name:          req.body.ledger_name,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag  || 'N',
                max_amount:           req.body.max_amount            || null,
                effective_start_date: req.body.effective_start_date  || null,
                effective_end_date:   req.body.effective_end_date    || null,
                updated_by:           req.user.username || req.user.Person_id
            };

            await LedgerRulesDao.updateStaticRule(data);
            req.flash("success", "Ledger rule updated successfully");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error updating ledger rule:", err);
            const msg = err.original?.code === 'ER_DUP_ENTRY'
                ? "A rule for this Bank + Account Head combination already exists"
                : (err.original?.sqlMessage || "Error updating ledger rule");
            req.flash("error", msg);
            res.redirect("/account-heads?tab=rules");
        }
    },

    deleteRule: async (req, res, next) => {
        try {
            await LedgerRulesDao.deleteStaticRule(req.params.id);
            req.flash("success", "Ledger rule deleted");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error deleting ledger rule:", err);
            req.flash("error", "Error deleting ledger rule");
            res.redirect("/account-heads?tab=rules");
        }
    },

    // ── Credit / Supplier — entry type override only ──────────────────────

    updateEntryType: async (req, res, next) => {
        try {
            await LedgerRulesDao.updateEntryType({
                rule_id:           req.params.id,
                allowed_entry_type: req.body.allowed_entry_type,
                updated_by:        req.user.username || req.user.Person_id
            });
            req.flash("success", "Entry type updated");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error updating entry type:", err);
            req.flash("error", "Error updating entry type");
            res.redirect("/account-heads?tab=rules");
        }
    }
};
