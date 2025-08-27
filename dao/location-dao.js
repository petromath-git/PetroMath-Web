const db = require("../db/db-connection");
const Location = db.location;



module.exports = {
    // Method to fetch all locations from the database
    findAllLocations: async function () {
        try {
            // Query the location table to get all locations
            const locations = await Location.findAll({
                attributes: ['location_id', 'location_code', 'location_name']  // Adjust attributes if necessary
            });

            return locations; // Return the fetched locations
        } catch (error) {
            console.error("Error fetching locations:", error);
            throw error;  // Rethrow the error to be handled in the controller
        }
    }
};
