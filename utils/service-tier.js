const db = require("../db/db-connection");

let tierCache = null;

module.exports = {
    // Load all tiers into cache
    loadTiers: async function() {
        try {
            const tiers = await db.sequelize.query(
                "SELECT tier_name, delay_ms FROM m_service_tiers",
                { type: db.Sequelize.QueryTypes.SELECT }
            );
            
            tierCache = {};
            tiers.forEach(tier => {
                tierCache[tier.tier_name] = tier.delay_ms;
            });
            
            console.log("Service tiers loaded:", tierCache);
            return tierCache;
        } catch (error) {
            console.error("Error loading service tiers:", error);
            tierCache = { standard: 0, priority: 0 };
            return tierCache;
        }
    },

    // Get delay for a tier (returns 0 if not found)
    getDelay: async function(tierName) {
        if (!tierCache) {
            await this.loadTiers();
        }
        return tierCache[tierName] || 0;
    },

    // Apply delay if needed (returns a promise)
    applyThrottle: async function(tierName) {
        if (tierName === 'standard' || tierName === 'priority') {
            return; // No delay, no DB lookup
        }
        
        const delayMs = await this.getDelay(tierName);    
        console.log("in delay",delayMs)    
        if (delayMs > 0) {
            
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
};