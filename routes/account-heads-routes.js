// routes/account-heads-routes.js
const express = require("express");
const router = express.Router();
const login = require("connect-ensure-login");
const appSecurity = require("../utils/app-security");
const AccountHeadsController = require("../controllers/account-heads-controller");

const isLoggedIn = login.ensureLoggedIn({});

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

module.exports = router;