module.exports = {
  // Database config

  HOST: "54.86.175.252",
  PORT: "3306",
  USER: "root",
  PASSWORD: "welcome123",
  DB: "petrolpumpv1",
  DIALECT: "mysql",
  pool: {
    max: 1,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  // Server config

  SERVER_PORT: 3000,
  //  SERVER_PORT: 80,

};