var UserData = function UserData(user, isAdmin, allowedMenus, menuDetails, service_tier, assignedLocations) {
    this.Person_id = user.Person_id;
    this.Person_Name = user.Person_Name;
    this.User_Name = user.User_Name;
    this.Role = user.Role;
    this.location_code = user.location_code;
    this.isAdmin = isAdmin;
    this.creditlist_id = user.creditlist_id;
    this.allowedMenus = allowedMenus || [];
    this.menuDetails = menuDetails || [];
    this.service_tier = service_tier || 'standard';
    // Locations explicitly assigned via m_person_location, beyond location_code above.
    // Only meaningful for roles that operate across more than one location (e.g. PartnerAdmin).
    this.assignedLocations = assignedLocations || [];
};


module.exports = UserData;