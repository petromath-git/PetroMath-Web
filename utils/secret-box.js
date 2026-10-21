// utils/secret-box.js
// AES-256-GCM encryption for stored third-party credentials (oil company portal logins).
// The key lives only in the server .env (PORTAL_CRED_KEY), never in the DB, so a DB dump
// alone cannot reveal the passwords. There is deliberately NO default key: if the env var
// is missing, encrypt/decrypt throw and the feature stays off.
//
// Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const crypto = require('crypto');

const VERSION = 'v1';

function getKey() {
    const raw = process.env.PORTAL_CRED_KEY;
    if (!raw) {
        throw new Error('PORTAL_CRED_KEY is not configured on this server');
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
        throw new Error('PORTAL_CRED_KEY must be 32 bytes, base64 encoded');
    }
    return key;
}

module.exports = {
    isConfigured: () => {
        try { getKey(); return true; } catch (e) { return false; }
    },

    encrypt: (plainText) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
        const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
    },

    decrypt: (stored) => {
        const [version, iv, tag, enc] = String(stored || '').split(':');
        if (version !== VERSION || !iv || !tag || !enc) {
            throw new Error('Stored credential has an unknown format');
        }
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
    }
};
