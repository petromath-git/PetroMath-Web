// controllers/password-reset-controller.js
const bcrypt = require('bcrypt');
const { Person } = require('../db/db-connection');
const PersonDao = require('../dao/person-dao');
const RolePermissionsDao = require('../dao/role-permissions-dao');

// Render the password reset form
exports.getPasswordResetPage = async (req, res, extraData = {}) => {
    const locationCode = req.user.location_code;
    const userRole = req.user.Role;

    try {
        // Get roles that this user can reset from database
        const allowedRoles = await RolePermissionsDao.getRolesUserCanReset(userRole, locationCode);
        const roleNames = allowedRoles.map(r => r.role);
        
        let usersQuery;
        
        if (roleNames.length === 0) {
            // User can only reset their own password
            usersQuery = PersonDao.findUsersAndCreditList(locationCode).then(users => {
                return users.filter(user => user.Person_id === req.user.Person_id);
            });
        } else {
            // Check if user can reset customers (to decide which DAO method to use)
            const includesCustomers = roleNames.includes('Customer');
            const daoMethod = includesCustomers ? 
                PersonDao.findUsersAndCreditList : PersonDao.findUsers;
                
            usersQuery = daoMethod(locationCode).then(users => {
                return users.filter(user => 
                    roleNames.includes(user.Role) ||
                    user.Person_id === req.user.Person_id // Always include own account
                );
            });
        }

        const users = await usersQuery;
        
        // Sort users: Staff first, then customers
        const sortedUsers = users.sort((a, b) => {
            const roleOrder = {
                'SuperUser': 1, 'Admin': 2, 'Manager': 3, 'Cashier': 4, 
                'Driver': 5, 'Helper': 6, 'Customer': 7
            };
            const aOrder = roleOrder[a.Role] || 999;
            const bOrder = roleOrder[b.Role] || 999;
            
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return a.Person_Name.localeCompare(b.Person_Name);
        });

        // Map users to include formatted name and username for customers
        const formattedUsers = sortedUsers.map(user => {
            let displayName;
            if (user.Role === 'Customer') {
                displayName = `${user.Person_Name} - ${user.User_Name} (${user.Role})`;
            } else {
                displayName = `${user.Person_Name} (${user.Role})`;
            }
            
            return {
                ...user.toJSON(),
                fullName: displayName
            };
        });

        res.render('reset-password', {
            title: 'Reset Password',
            users: formattedUsers,
            userRole: userRole,
            allowedRoles: roleNames,
            ...extraData
        });

    } catch (error) {
        console.error('Error fetching role permissions:', error);
        res.render('reset-password', {
            title: 'Reset Password',
            users: [],
            message: 'Error loading permissions. Please try again.',
            ...extraData
        });
    }
};

// Handle password reset logic with role-based access
exports.resetPassword = async (req, res) => {
    const { username, newPassword, confirmPassword } = req.body;
    const requestingUser = req.user;

    // Validate if the passwords match
    if (newPassword !== confirmPassword) {
        return exports.getPasswordResetPage(req, res, { message: 'Passwords do not match.' });
    }

    try {
        const userToReset = await PersonDao.findUserById(username);

        if (!userToReset) {
            return exports.getPasswordResetPage(req, res, { message: 'User not found.' });
        }

        // Check permission using database
        const canReset = await RolePermissionsDao.canResetPassword(
            requestingUser.Role,
            userToReset.Role,
            requestingUser.location_code,
            userToReset.location_code
        );

        const isOwnAccount = requestingUser.Person_id === userToReset.Person_id;

        if (canReset || isOwnAccount) {
            await updatePassword(userToReset, newPassword);
            
            // Check if user reset their own password
            if (isOwnAccount) {
                // If user reset their own password, log them out
                return res.render('login', { 
                    message: 'Your password has been reset successfully. Please log in with your new password.' 
                });
            } else {
                // If admin reset someone else's password, stay in admin interface
                const successMessage = `Password reset successfully for ${userToReset.Person_Name}!\n` +
                                     `Username: ${userToReset.User_Name || 'N/A'}\n` +
                                     `New Password: ${newPassword}`;
                
                return exports.getPasswordResetPage(req, res, { 
                    success: successMessage 
                });
            }
        } else {
            return exports.getPasswordResetPage(req, res, { 
                message: 'Permission denied: You cannot reset this user\'s password.' 
            });
        }

    } catch (error) {
        console.error('Error resetting password:', error);
        return exports.getPasswordResetPage(req, res, { 
            message: 'An error occurred while resetting the password.' 
        });
    }
};

// Helper function to update the password (bcrypt hashing)
const updatePassword = async (user, newPassword) => {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // For admin resets, we don't need to verify current password
    // Use direct database update instead of changePwd
    const result = await PersonDao.updatePassword(user.Person_id, hashedPassword);
    
    if (!result) {
        throw new Error('Failed to update password');
    }
};

// Method to handle the actual password change (if needed separately)
exports.changePassword = (req, res, next) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.Person_id;

    Person.findOne({ where: { Person_id: userId } })
        .then(user => {
            bcrypt.compare(currentPassword, user.Password, (err, isMatch) => {
                if (err || !isMatch) {
                    return res.render('change-pwd', { message: 'Incorrect current password.' });
                }

                bcrypt.hash(newPassword, 12, (err, hashedPassword) => {
                    if (err) {
                        return res.render('change-pwd', { message: 'Error hashing password.' });
                    }

                    user.Password = hashedPassword;
                    user.save()
                        .then(() => {
                            res.render('login', { message: 'Password changed successfully. Please log in with your new password.' });
                        })
                        .catch(err => {
                            console.error(err);
                            res.render('change-pwd', { message: 'Error changing password.' });
                        });
                });
            });
        })
        .catch(err => {
            console.error(err);
            res.render('change-pwd', { message: 'Error changing password.' });
        });
};

// Render the change password page (for self-service)
exports.getChangePasswordPage = (req, res, extraData = {}) => {
    res.render('change-pwd', {
        title: 'Change Password',
        user: req.user,
        ...extraData
    });
};


exports.changeSelfPassword = async (req, res) => {
    try {
        const { password: currentPassword, new_password: newPassword } = req.body;
        const userId = req.user.Person_id;

        // Basic validation
        if (!currentPassword || !newPassword) {
            return exports.getChangePasswordPage(req, res, {
                messages: { error: "Both current and new password are required." }
            });
        }

        if (newPassword.length < 6) {
            return exports.getChangePasswordPage(req, res, {
                messages: { error: "New password must be at least 6 characters long." }
            });
        }

        // Hash the new password
        const bcrypt = require('bcrypt');
        const hashedNewPassword = await bcrypt.hash(newPassword, 12);

        // Use the DAO method to change password
        const result = await PersonDao.changePwd(
            { Password: hashedNewPassword, Person_id: userId }, 
            currentPassword
        );

        if (result === true) {
            req.flash('success', 'Password changed successfully');
            res.redirect('/');
        } else {
            return exports.getChangePasswordPage(req, res, {
                messages: { error: "Current password is incorrect." }
            });
        }

    } catch (error) {
        console.error('Error changing password:', error);
        
        // Handle specific error messages
        let errorMessage = "Error while changing password.";
        if (error.message === 'Current password is incorrect') {
            errorMessage = "Current password is incorrect.";
        } else if (error.message === 'User not found') {
            errorMessage = "User account not found.";
        }

        return exports.getChangePasswordPage(req, res, {
            messages: { error: errorMessage }
        });
    }
};