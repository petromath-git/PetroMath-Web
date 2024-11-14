const PersonDao = require("../dao/person-dao");

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
                            role: user.Role
                        });
                    });
                    resolve(users);
                });
        });
    },
}
