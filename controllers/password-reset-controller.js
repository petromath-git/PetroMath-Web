const bcrypt = require('bcrypt');
const { Person } = require('../db/db-connection');
const PersonDao = require('../dao/person-dao'); 

// Render the password reset form
exports.getPasswordResetPage = (req, res) => {
    const locationCode = req.user.location_code;  // Get the logged-in user's location code
    const userRole = req.user.Role;  // Get the logged-in user's role

    // Determine the filtering logic based on the user's role
    let usersQuery;

    // SuperUser can see all users
    if (userRole === 'SuperUser') {
        usersQuery = PersonDao.findUsers(locationCode);
    }

    // Admin can see all users except SuperUser
    else if (userRole === 'Admin') {
        usersQuery = PersonDao.findUsers(locationCode).then(users => {
            return users.filter(user => user.Role !== 'SuperUser'); // Exclude SuperUser
        });
    }

   // Manager can see all Cashiers in the same location
   else if (userRole === 'Manager') {
    usersQuery = PersonDao.findUsers(locationCode).then(users => {
        // Filter out SuperUser, Admin, and Auditor, and include Manager, Cashier, and Customer
        return users.filter(user =>             
            user.Role !== 'SuperUser' && 
            user.Role !== 'Admin' && 
            user.Role !== 'Auditor'
            );
        });
    }   

    else {
        usersQuery = PersonDao.findUsers(locationCode).then(users => {
            return users.filter(user => user.Person_id === req.user.Person_id); // Only logged-in user
        });
    }

    // Fetch users based on the role
    usersQuery
        .then(users => {
            // Map users to include formatted name
            const formattedUsers = users.map(user => ({
                ...user.toJSON(),
                fullName: `${user.Person_Name} (${user.Role})`
            }));

            res.render('reset-password', {
                title: 'Reset Password',
                users: formattedUsers  // Pass the formatted list of users to the template
            });
        })
        .catch(err => {
            console.error('Error fetching users:', err);
            res.render('reset-password', { message: 'Error fetching users.' });
        });
};

// Handle password reset logic with role-based access
exports.resetPassword = async (req, res) => {
    const { username, newPassword, confirmPassword } = req.body;
    const requestingUser = req.user; // Logged-in user

    
    console.log("User ID to reset:", req.body);

    // Validate if the passwords match
    if (newPassword !== confirmPassword) {
        return res.render('reset-password', { message: 'Passwords do not match.' });
    }

    try {
        // Find the user whose password is to be reset
        const userToReset = await PersonDao.findUserById(username);
        

        if (!userToReset) {
            return res.render('reset-password', { message: 'User not found.' });
        }

        // Check if the requesting user has the right role to reset passwords
        if (requestingUser.Role === 'SuperUser') {
            // SuperUser can reset anyone's password            
            await updatePassword(userToReset, newPassword);
            return res.render('login', { message: 'Password reset successfully. Please log in with your new password.' });
        }

        if (requestingUser.Role === 'Admin') {
            // Admin can reset passwords for Manager, Cashier, and Customers in the same location
            if (userToReset.Role === 'Manager' || userToReset.Role === 'Cashier' || userToReset.Role === 'Customer') {
                if (requestingUser.location_code === userToReset.location_code) {
                    await updatePassword(userToReset, newPassword);
                    return res.render('login', { message: 'Password reset successfully. Please log in with your new password.' });
                } else {
                    return res.render('reset-password', { message: 'Permission denied: User from different location.' });
                }
            }
        }

        if (requestingUser.Role === 'Manager') {
            // Manager can reset passwords for Cashier and Customers in the same location
            if (userToReset.Role === 'Cashier' || userToReset.Role === 'Customer') {
                if (requestingUser.location_code === userToReset.location_code) {
                    await updatePassword(userToReset, newPassword);
                    return res.render('login', { message: 'Password reset successfully. Please log in with your new password.' });
                } else {
                    return res.render('reset-password', { message: 'Permission denied: User from different location.' });
                }
            }
        }

        // If the user is not authorized to reset the password
        return res.render('reset-password', { message: 'You do not have permission to reset this user\'s password.' });

    } catch (error) {
        console.error('Error resetting password:', error);
        return res.render('reset-password', { message: 'An error occurred while resetting the password.' });
    }
};

// Helper function to update the password (bcrypt hashing)
const updatePassword = async (user, newPassword) => {
    // Hash the new password
    const saltRounds = 12; // bcrypt salt rounds
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update the user's password in the database
    await PersonDao.changePwd({ Password: hashedPassword, Person_id: user.Person_id }, user.Password);
};

// Method to handle the actual password change (if needed separately)
exports.changePassword = (req, res, next) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.Person_id; // Assuming the user is logged in

    // Check if the current password is correct
    Person.findOne({ where: { Person_id: userId } })
        .then(user => {
            bcrypt.compare(currentPassword, user.Password, (err, isMatch) => {
                if (err || !isMatch) {
                    return res.render('change-pwd', { message: 'Incorrect current password.' });
                }

                // Hash and update the new password
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
