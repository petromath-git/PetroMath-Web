// utils/statement-decrypt.js
//
// Shared by the bank statement uploads (transaction upload and bank
// reconciliation).

// ========== Password-protected workbook handling ==========
// Some banks (e.g. KVB) only export password-protected .xlsx files. An
// encrypted OOXML file is wrapped in an OLE container, so it passes
// isRealBinaryWorkbook() but XLSX.read() throws "File is password-protected".
// Decrypt it in memory with the password the user keyed in on upload; the
// password is never logged or stored.
// Returns { buffer } on success, or { errorType, error } for the caller to send.
async function decryptIfProtected(buffer, password) {
    const isOle = buffer.length >= 4 &&
        buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    if (!isOle) return { buffer };

    const officeCrypto = require('officecrypto-tool');
    let encrypted;
    try {
        encrypted = officeCrypto.isEncrypted(buffer);
    } catch (e) {
        return { buffer }; // not an encrypted container — let the normal parser handle it
    }
    if (!encrypted) return { buffer };

    if (!password) {
        return {
            errorType: 'PASSWORD_REQUIRED',
            error: 'This file is password-protected. Please enter the file password and try again.'
        };
    }

    try {
        return { buffer: await officeCrypto.decrypt(buffer, { password }) };
    } catch (e) {
        if (/password is incorrect/i.test(e.message)) {
            return {
                errorType: 'PASSWORD_INCORRECT',
                error: 'The file password is incorrect. Please check it and try again.'
            };
        }
        console.error('Failed to decrypt password-protected upload:', e.message);
        return {
            errorType: 'DECRYPT_FAILED',
            error: 'Could not open this password-protected file. Please remove the password in Excel and upload again.'
        };
    }
}

module.exports = { decryptIfProtected };
