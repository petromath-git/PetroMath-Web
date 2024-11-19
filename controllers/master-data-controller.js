const PersonDao = require("../dao/person-dao");
var dateFormat = require('dateformat');

module.exports = {
    findUsers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let users = [];
            PersonDao.findUsers(locationCode)
                .then(data => {
                    data.forEach((user) => {
                        users.push({
                            id: user.Person_id,
                            name: user.Person_Name,
                            username: user.User_Name,
                            role: user.Role,
                            effective_start_date: dateFormat(user.effective_start_date, "dd-mm-yyyy"),
                        });
                    });
                    resolve(users);
                });
        });
    },

    findDisableUsers: (locationCode) => {
        return new Promise((resolve, reject) => {
            let users = [];
            PersonDao.findDisableUsers(locationCode)
                .then(data => {
                    data.forEach(user => {
                        users.push({
                            id: user.Person_id,
                            name: user.Person_Name,
                            username: user.User_Name,
                            role: user.Role,
                            effective_end_date: dateFormat(user.effective_end_date, "dd-mm-yyyy"),
                        });
                    });
                    resolve(users);
                })
                .catch(err => {
                    console.error("Error in masterController:", err);
                    reject(err);
                });
        });
    },
    
}
