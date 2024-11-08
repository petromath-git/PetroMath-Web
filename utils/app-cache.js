
var PersonDao = require("../dao/person-dao");
var appCache = require("global-cache"); // Use the npm in this file's scope

const personCacheName = 'personCache';

module.exports = {
    initializeCache: () => {
        Promise.allSettled([setPersonCache()])
            .then((values) => {
                appCache.set(personCacheName, values[0].value);
            }).catch((err) => {
            console.warn("Error while getting data using promises " + err.toString());
            Promise.reject(err);
        });
    },
    getPersonCache: () => {
        return appCache.get(personCacheName);
    }
};

const setPersonCache = () => {
    return new Promise((resolve, reject) => {
        PersonDao.findUsers().then(data => {
            resolve(data);
        });
    });
};
