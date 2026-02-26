// controllers/account-heads-controller.js
const AccountHeadsDao = require("../dao/account-heads-dao");
const rolePermissionsDao = require("../dao/role-permissions-dao");

module.exports = {

    listPage: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const role = req.user.Role;

            const accountHeads = await AccountHeadsDao.getAccountHeads(locationCode);

            const canEdit    = await rolePermissionsDao.hasPermission(role, locationCode, 'EDIT_ACCOUNT_HEADS');
            const canAdd     = await rolePermissionsDao.hasPermission(role, locationCode, 'ADD_ACCOUNT_HEADS');
            const canDisable = await rolePermissionsDao.hasPermission(role, locationCode, 'DISABLE_ACCOUNT_HEADS');

            res.render("account-heads", {
                title: "Account Heads Master",
                user: req.user,
                accountHeads,
                canEdit,
                canAdd,
                canDisable
            });
        } catch (err) {
            console.error("Error rendering Account Heads page:", err);
            next(err);
        }
    },

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
    }
};