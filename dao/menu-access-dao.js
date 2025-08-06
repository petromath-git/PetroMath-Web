// dao/menu-access-dao.js
const db = require("../db/db-connection");
const { QueryTypes } = require('sequelize');



const getAllowedMenusForUser = async (role, locationCode) => {
  console.log("Fetching allowed menus for role:", role, "and location code:", locationCode);
  
  const results = await db.sequelize.query(
    `SELECT menu_code, menu_name, url_path, parent_code, sequence
     FROM user_menu_cache
     WHERE role = ? AND location_code = ?
     ORDER BY sequence`,
    {
      replacements: [role, locationCode],
      type: QueryTypes.SELECT,
    }
  );
  
  console.log("Query results:", results);
  return results;
};


module.exports = {
  getAllowedMenusForUser,
};
