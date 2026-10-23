
var PersonDao = require("../dao/person-dao");
var appCache = require("global-cache"); // Use the npm in this file's scope

const personCacheName = 'personCache';

module.exports = {
    initializeCache: () => {
        loadPersonCache().catch((err) => {
            // e.g. MySQL still starting when PM2 comes up - ensurePersonCache() retries on first use
            console.warn("Person cache not loaded at startup: " + err.toString());
        });
    },
    getPersonCache: () => {
        return appCache.get(personCacheName);
    },
    // Resolves with the person list, loading it first if the startup load failed.
    ensurePersonCache: () => {
        const cached = appCache.get(personCacheName);
        return cached ? Promise.resolve(cached) : loadPersonCache();
    }
};

let pendingLoad = null;

const loadPersonCache = () => {
    if (!pendingLoad) {
        pendingLoad = PersonDao.findUsers()
            .then(data => {
                appCache.set(personCacheName, data);
                return data;
            })
            .finally(() => { pendingLoad = null; });
    }
    return pendingLoad;
};
