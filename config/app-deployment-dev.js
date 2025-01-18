module.exports = {
  // Database config

  HOST: "54.86.175.252",
  PORT: "3306",
  USER: "root",
  PASSWORD: "welcome123",
  DB: "petrolpumpv1",
  DIALECT: "mysql",
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
    evict: 1000     // Run cleanup more frequentl
  },

  // Server config

  SERVER_PORT: 3000,
  //  SERVER_PORT: 80,

};