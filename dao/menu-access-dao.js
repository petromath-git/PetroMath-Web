// dao/menu-access-dao.js
const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');

const getAllowedMenusForUser = async (role, locationCode) => {
  const results = await db.sequelize.query(
  `SELECT menu_code, menu_name, icon, url_path, parent_code, sequence, 
          group_code, group_name, group_sequence
   FROM user_menu_cache
   WHERE role = ? AND location_code = ?
   ORDER BY group_sequence, sequence`,
  {
    replacements: [role, locationCode],
    type: QueryTypes.SELECT,
  }
);

  
  return results;
};

module.exports = {
  getAllowedMenusForUser,
};