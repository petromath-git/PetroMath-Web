const locationConfig = require('./location-config');

const _cache = new Map();
const CACHE_TTL = 60_000; // 1 minute

// Backend debug logger — gated by m_location_config key DEBUG_LOGGING = Y
// or process.env.DEBUG_LOGGING=true (env override, useful in dev).
// Pass null as locationCode to rely on env variable only (e.g. from DAOs).
async function debugLog(locationCode, ...args) {
    if (process.env.DEBUG_LOGGING === 'true') {
        console.log(...args);
        return;
    }
    if (!locationCode) return;

    if (!_cache.has(locationCode)) {
        try {
            const val = await locationConfig.getLocationConfigValue(locationCode, 'DEBUG_LOGGING', 'N');
            _cache.set(locationCode, val === 'Y');
        } catch {
            _cache.set(locationCode, false);
        }
        setTimeout(() => _cache.delete(locationCode), CACHE_TTL);
    }

    if (_cache.get(locationCode)) {
        console.log(...args);
    }
}

module.exports = { debugLog };
