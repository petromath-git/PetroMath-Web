var UserData = function UserData(user, isAdmin, allowedMenus, menuDetails) {
    this.Person_id = user.Person_id;
    this.Person_Name = user.Person_Name;
    this.User_Name = user.User_Name;
    this.Role = user.Role;
    this.location_code = user.location_code;
    this.isAdmin = isAdmin;
    this.creditlist_id = user.creditlist_id;
    this.allowedMenus = allowedMenus || [];
    this.menuDetails = menuDetails || [];
};


module.exports = UserData;