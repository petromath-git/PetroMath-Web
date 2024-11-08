module.exports = {
  // DB config
  //HOST: "ec2-35-174-200-24.compute-1.amazonaws.com",
  //HOST: "localhost",
  HOST: "3.233.160.101",
  PORT: "3306",
  USER: "root",
  //PASSWORD: "localdbSQL1",
  PASSWORD: "welcome123",
  DB: "petrolpumpv1",
  //DB: "petrolpump_dev",
  DIALECT: "mysql",
  pool: {
    max: 1,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  // Server config
   SERVER_PORT: 3000,
//    SERVER_PORT: 80,

};
