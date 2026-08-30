// controllers/account-heads-controller.js
const AccountHeadsDao    = require("../dao/account-heads-dao");
const LedgerRulesDao     = require("../dao/ledger-rules-dao");
const BankDao            = require("../dao/bank-dao");
const CreditsDao         = require("../dao/credits-dao");
const SupplierDao        = require("../dao/supplier-dao");
const rolePermissionsDao = require("../dao/role-permissions-dao");
const { getLedgersByGroup } = require('../routes/gl-routes');
const { getLocationConfigValue } = require('../utils/location-config');
const db = require('../db/db-connection');
const { QueryTypes } = require('sequelize');

// Credit Party rules default to CREDIT-only, Supplier rules to DEBIT-only —
// each location can loosen its own via these location config settings.
const CREDIT_ENTRY_TYPE_OVERRIDE_SETTING   = 'LEDGER_RULES_CREDIT_PARTY_ENTRY_TYPE_OVERRIDE';
const SUPPLIER_ENTRY_TYPE_OVERRIDE_SETTING = 'LEDGER_RULES_SUPPLIER_ENTRY_TYPE_OVERRIDE';

async function getAllGlGroups(locationCode) {
    return db.sequelize.query(`
        SELECT group_id, group_name, group_nature
        FROM gl_ledger_groups
        WHERE location_code = :locationCode AND active_flag = 'Y'
        ORDER BY group_nature, group_name
    `, { replacements: { locationCode }, type: QueryTypes.SELECT });
}

module.exports = {

    listPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const role         = req.user.Role;
            const activeTab    = req.query.tab || 'heads';

            const [accountHeads, allRules, banks, glGroups, creditParties, suppliers,
                   canEdit, canAdd, canDisable,
                   creditEntryTypeOverride, supplierEntryTypeOverride] = await Promise.all([
                AccountHeadsDao.getAccountHeads(locationCode),
                LedgerRulesDao.getAllRules(locationCode),
                BankDao.findAll(locationCode),
                getAllGlGroups(locationCode),
                CreditsDao.findAll(locationCode),
                SupplierDao.findSuppliers(locationCode),
                rolePermissionsDao.hasPermission(role, locationCode, 'EDIT_ACCOUNT_HEADS'),
                rolePermissionsDao.hasPermission(role, locationCode, 'ADD_ACCOUNT_HEADS'),
                rolePermissionsDao.hasPermission(role, locationCode, 'DISABLE_ACCOUNT_HEADS'),
                getLocationConfigValue(locationCode, CREDIT_ENTRY_TYPE_OVERRIDE_SETTING, 'N'),
                getLocationConfigValue(locationCode, SUPPLIER_ENTRY_TYPE_OVERRIDE_SETTING, 'N'),
            ]);

            res.render("account-heads", {
                title: "Accounting Masters",
                user: req.user,
                accountHeads,
                allRules,
                banks,
                glGroups,
                creditParties,
                suppliers,
                canEdit,
                canAdd,
                canDisable,
                creditEntryTypeOverride:   creditEntryTypeOverride   === 'Y',
                supplierEntryTypeOverride: supplierEntryTypeOverride === 'Y',
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
                // Head Type / Entry Type are no longer surfaced in the UI (unused
                // elsewhere in the app — see gl_static_ledger_map for actual GL
                // posting resolution) — default to the same values the DB column
                // defaults to.
                account_head_type:    'OTHER',
                allowed_entry_type:   'BOTH',
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
            req.flash("error", err.message || "Error updating account head");
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
            req.flash("error", err.message || "Error deactivating account head");
            res.redirect("/account-heads");
        }
    },

    // ── Static Ledger Rules ───────────────────────────────────────────────
    // source_type is always 'Static'; external_id = account_head_id;
    // ledger_name = account_head_name. Credit/Supplier rules are trigger-managed.

    createRule: async (req, res, next) => {
        try {
            const appliesToCashflow = req.body.applies_to_cashflow === 'Y' ? 'Y' : 'N';

            if (appliesToCashflow === 'Y') {
                const dup = await LedgerRulesDao.findCashflowRuleByHead(req.user.location_code, req.body.account_head_id);
                if (dup) throw new Error("A Cashflow rule for this Account Head already exists");
            }

            // external_id and ledger_name come from the account head dropdown selection
            const data = {
                location_code:        req.user.location_code,
                bank_id:              appliesToCashflow === 'Y' ? null : req.body.bank_id,
                external_id:          req.body.account_head_id,
                ledger_name:          req.body.ledger_name,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag  || 'N',
                max_amount:           req.body.max_amount            || null,
                effective_start_date: req.body.effective_start_date  || null,
                effective_end_date:   req.body.effective_end_date    || null,
                allow_split_flag:     req.body.allow_split_flag      === 'Y' ? 'Y' : 'N',
                applies_to_cashflow:  appliesToCashflow,
                created_by:           req.user.username || req.user.Person_id
            };

            await LedgerRulesDao.createStaticRule(data);
            req.flash("success", "Ledger rule created successfully");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error creating ledger rule:", err);
            const msg = err.original?.code === 'ER_DUP_ENTRY'
                ? "A rule for this Bank + Account Head combination already exists"
                : (err.original?.sqlMessage || err.message || "Error creating ledger rule");
            req.flash("error", msg);
            res.redirect("/account-heads?tab=rules");
        }
    },

    updateRule: async (req, res, next) => {
        try {
            const appliesToCashflow = req.body.applies_to_cashflow === 'Y' ? 'Y' : 'N';

            if (appliesToCashflow === 'Y') {
                const dup = await LedgerRulesDao.findCashflowRuleByHead(req.user.location_code, req.body.account_head_id, req.body.rule_id);
                if (dup) throw new Error("A Cashflow rule for this Account Head already exists");
            }

            const data = {
                rule_id:              req.body.rule_id,
                bank_id:              appliesToCashflow === 'Y' ? null : req.body.bank_id,
                external_id:          req.body.account_head_id,
                ledger_name:          req.body.ledger_name,
                allowed_entry_type:   req.body.allowed_entry_type,
                notes_required_flag:  req.body.notes_required_flag  || 'N',
                max_amount:           req.body.max_amount            || null,
                effective_start_date: req.body.effective_start_date  || null,
                effective_end_date:   req.body.effective_end_date    || null,
                allow_split_flag:     req.body.allow_split_flag      === 'Y' ? 'Y' : 'N',
                applies_to_cashflow:  appliesToCashflow,
                updated_by:           req.user.username || req.user.Person_id
            };

            await LedgerRulesDao.updateStaticRule(data);
            req.flash("success", "Ledger rule updated successfully");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error updating ledger rule:", err);
            const msg = err.original?.code === 'ER_DUP_ENTRY'
                ? "A rule for this Bank + Account Head combination already exists"
                : (err.original?.sqlMessage || err.message || "Error updating ledger rule");
            req.flash("error", msg);
            res.redirect("/account-heads?tab=rules");
        }
    },

    // ── Credit Party / Supplier — manual extra Bank+Party mapping ──────────
    // Auto-created rules (one per bank, via DB trigger) cover a party the
    // moment it's created. This lets an admin add one more mapping — e.g. a
    // customer or supplier that also needs to post against a second bank
    // account. Entry type defaults to CREDIT (party) / DEBIT (supplier) and
    // is only overridable when the location config setting allows it.

    createPartyRule: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const sourceType   = req.body.source_type === 'SUPPLIER' ? 'Supplier' : 'Credit';
            const defaultEntryType = sourceType === 'Credit' ? 'CREDIT' : 'DEBIT';

            const overrideSetting = sourceType === 'Credit'
                ? CREDIT_ENTRY_TYPE_OVERRIDE_SETTING
                : SUPPLIER_ENTRY_TYPE_OVERRIDE_SETTING;
            const overrideEnabled = (await getLocationConfigValue(locationCode, overrideSetting, 'N')) === 'Y';

            const allowedEntryType = overrideEnabled && ['DEBIT', 'CREDIT', 'BOTH'].includes(req.body.allowed_entry_type)
                ? req.body.allowed_entry_type
                : defaultEntryType;

            const data = {
                location_code:        locationCode,
                bank_id:              req.body.bank_id,
                source_type:          sourceType,
                external_id:          req.body.party_id,
                ledger_name:          req.body.ledger_name,
                allowed_entry_type:   allowedEntryType,
                notes_required_flag:  req.body.notes_required_flag || 'N',
                max_amount:           req.body.max_amount           || null,
                effective_start_date: req.body.effective_start_date || null,
                effective_end_date:   req.body.effective_end_date   || null,
                allow_split_flag:     req.body.allow_split_flag     === 'Y' ? 'Y' : 'N',
                created_by:           req.user.username || req.user.Person_id
            };

            await LedgerRulesDao.createPartyRule(data);
            req.flash("success", `${sourceType} ledger rule created successfully`);
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error creating party ledger rule:", err);
            const msg = err.original?.code === 'ER_DUP_ENTRY'
                ? "A rule for this Bank + Party combination already exists"
                : (err.original?.sqlMessage || err.message || "Error creating ledger rule");
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

    // ── Allow Split flag — all rule types ────────────────────────────────

    updateSplitFlag: async (req, res, next) => {
        try {
            await LedgerRulesDao.updateSplitFlag({
                rule_id:         req.params.id,
                allow_split_flag: req.body.allow_split_flag === 'Y' ? 'Y' : 'N',
                updated_by:      req.user.username || req.user.Person_id
            });
            req.flash("success", "Split flag updated");
            res.redirect("/account-heads?tab=rules");
        } catch (err) {
            console.error("Error updating split flag:", err);
            req.flash("error", "Error updating split flag");
            res.redirect("/account-heads?tab=rules");
        }
    },

    // ── Credit / Supplier — entry type override only ──────────────────────

    updateGlGroup: async (req, res, next) => {
        try {
            const id       = req.params.id;
            const glGroupId = req.body.gl_group_id || null;
            const updatedBy = req.user.username || req.user.Person_id;
            await AccountHeadsDao.updateGlGroup(id, glGroupId, updatedBy);
            res.json({ success: true });
        } catch (err) {
            console.error('Error updating GL group:', err);
            res.status(500).json({ error: err.message });
        }
    },

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
