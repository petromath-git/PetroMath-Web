// routes/account-heads-routes.js
const express = require("express");
const router = express.Router();
const login = require("connect-ensure-login");
const appSecurity = require("../utils/app-security");
const AccountHeadsController = require("../controllers/account-heads-controller");

const isLoggedIn = login.ensureLoggedIn({});

// ── Account Heads ─────────────────────────────────────────────────────────

router.get(
    "/",
    isLoggedIn,
    appSecurity.hasPermission("VIEW_ACCOUNT_HEADS"),
    AccountHeadsController.listPage
);

router.post(
    "/",
    isLoggedIn,
    appSecurity.hasPermission("ADD_ACCOUNT_HEADS"),
    AccountHeadsController.create
);

router.post(
    "/update",
    isLoggedIn,
    appSecurity.hasPermission("EDIT_ACCOUNT_HEADS"),
    AccountHeadsController.update
);

router.post(
    "/:id/deactivate",
    isLoggedIn,
    appSecurity.hasPermission("DISABLE_ACCOUNT_HEADS"),
    AccountHeadsController.deactivate
);

// ── Ledger Rules ──────────────────────────────────────────────────────────
// Reuses ADD/EDIT/DISABLE_ACCOUNT_HEADS permissions — add dedicated
// LEDGER_RULES permissions to m_role_permissions if finer control is needed.

router.post(
    "/rules",
    isLoggedIn,
    appSecurity.hasPermission("ADD_ACCOUNT_HEADS"),
    AccountHeadsController.createRule
);

router.post(
    "/rules/update",
    isLoggedIn,
    appSecurity.hasPermission("EDIT_ACCOUNT_HEADS"),
    AccountHeadsController.updateRule
);

router.post(
    "/rules/:id/delete",
    isLoggedIn,
    appSecurity.hasPermission("DISABLE_ACCOUNT_HEADS"),
    AccountHeadsController.deleteRule
);

// Entry type override for Credit / Supplier rules (trigger-managed rules)
router.post(
    "/rules/:id/entry-type",
    isLoggedIn,
    appSecurity.hasPermission("EDIT_ACCOUNT_HEADS"),
    AccountHeadsController.updateEntryType
);

module.exports = router;
