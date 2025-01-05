require('dotenv').config(); // Load environment variables from .env file

module.exports = {
  // Database config
  HOST: process.env.DB_HOST || "localhost",
  PORT: process.env.DB_PORT || "3306",
  USER: process.env.DB_USER || "root",
  PASSWORD: process.env.DB_PASSWORD || "welcome123",
  DB: process.env.DB_NAME || "petrolpumpv1",
  DIALECT: process.env.DB_DIALECT || "mysql",
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  // Server config
  SERVER_PORT: process.env.SERVER_PORT || 3000,
};