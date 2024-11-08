# Muthu's Gasoline App.

## Build step : install modules
`npm install --save`

## Run step : start server
`npm start` or  `node app`


## Production Setup

1.Modify app.js
Change the following line:

`const deploymentConfig = "./config/app-localhost";`

To:

`const deploymentConfig = "./config/app-deployment-" + process.env.ENVIRONMENT;`






