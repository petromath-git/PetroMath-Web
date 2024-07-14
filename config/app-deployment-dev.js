module.exports = {
  // DB config
  //HOST: "ec2-35-174-200-24.compute-1.amazonaws.com",
  HOST: "54.160.7.3",
  PORT: "3306",
  // USER: "dev_admin",   // Not working: failing with Access denied for user 'dev_admin'@'c-98-210-183-1.hsd1.ca.comcast.net' (using password: YES)
  USER: "root",
  PASSWORD: "welcome123",
  DB: "petrolpump_dev",
  DIALECT: "mysql",
  pool: {
    max: 1,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  // Server config
  SERVER_PORT: 5000,

};
