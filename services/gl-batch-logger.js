// services/gl-batch-logger.js
// Lightweight in-memory logger for GL batch runs.
// GL_LOG_LEVEL controls verbosity: DEBUG (all) | INFO (summaries+errors) | ERROR (errors only)

const LEVEL_RANK = { DEBUG: 0, INFO: 1, ERROR: 2 };

class GlBatchLogger {
    constructor(minLevel) {
        this._minLevel = LEVEL_RANK[minLevel] ?? LEVEL_RANK.INFO;
        this._lines    = [];
    }

    log(level, msg) {
        if ((LEVEL_RANK[level] ?? 0) >= this._minLevel) {
            const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
            this._lines.push(`[${ts}] [${level}] ${msg}`);
        }
    }

    debug(msg) { this.log('DEBUG', msg); }
    info(msg)  { this.log('INFO',  msg); }
    error(msg) { this.log('ERROR', msg); }

    getText() { return this._lines.join('\n'); }
}

module.exports = GlBatchLogger;
