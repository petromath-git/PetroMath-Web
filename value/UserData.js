
var UserData = function UserData(user, isAdmin) {
    this.Person_id = user.Person_id;
    this.Person_Name = user.Person_Name;
    this.User_Name = user.User_Name;
    this.Role = user.Role;
    this.location_code = user.location_code;
    this.isAdmin = isAdmin;
}

module.exports = UserData;