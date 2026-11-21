// services/oil-invoice-email-service.js — IOCL Invoices: import from email (tkt #484).
//
// Each bunk auto-forwards IOCL's mails (sender B2BPRD@indianoil.in) to a Gmail mailbox. This reads
// that mailbox over IMAP with a Gmail App Password and, for every PDF attachment:
//   - not an IOCL charge invoice (fuel invoice, payment receipt, payment advice ...) -> NOT_INVOICE
//   - a charge invoice -> the bunk is the one of this mailbox's bunks whose GSTIN is the invoice's
//     recipient GSTIN (the LFR payer code decides between bunks sharing a GSTIN), then it is saved
//     with OilInvoiceService.saveFiles, the same path as an upload: same checks, same duplicate block.
// Every PDF read gets a row in t_oil_invoice_email_log, so it is never read twice; a mail whose PDFs
// are all logged gets the Gmail label "PetroMath-Read" and later searches leave it out. Nothing is
// deleted or marked read in the mailbox. A failure that may pass (DB error, connection drop) is not
// logged, so the next run tries that PDF again.
const { ImapFlow } = require('imapflow');
const secretBox = require('../utils/secret-box');
const MailboxDao = require('../dao/oil-invoice-mailbox-dao');
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const OilInvoiceService = require('./oil-invoice-service');
const GstConfigDao = require('../dao/gst-config-dao');
const { parseOilChargeInvoice } = require('./oil-charge-invoice-parser');

const DONE_LABEL = 'PetroMath-Read';
const MAX_MAILS_PER_RUN = 150;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

const running = new Set(); // mailbox ids being read right now (never two runs on one mailbox)

// PDF attachments in a message's body structure (forwarded mails nest them; walk the whole tree).
function pdfParts(node, out = []) {
    if (!node) return out;
    const type = String(node.type || '').toLowerCase();
    const name = (node.dispositionParameters && node.dispositionParameters.filename)
        || (node.parameters && node.parameters.name) || '';
    if (node.part && (type === 'application/pdf' || (/\.pdf$/i.test(name) && !type.startsWith('multipart/')))) {
        out.push({ part: node.part, file_name: name || `attachment-${node.part}.pdf`, size: node.size || 0 });
    }
    (node.childNodes || []).forEach(c => pdfParts(c, out));
    return out;
}

async function streamToBuffer(stream, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of stream) {
        size += c.length;
        if (size > limit) throw Object.assign(new Error('PDF larger than 5 MB'), { permanent: true });
        chunks.push(c);
    }
    return Buffer.concat(chunks);
}

// Bunk for a parsed invoice among the mailbox's bunks. Returns { location, reason }.
async function pickLocation(parsed, locations) {
    const gstin = String(parsed.recipient_gstin || '').toUpperCase();
    if (!gstin) return { location: null, reason: 'The invoice has no recipient GSTIN.' };
    const hits = [];
    for (const loc of locations) {
        const cfg = await GstConfigDao.findByLocationCode(loc);
        if (cfg && String(cfg.gstin || '').trim().toUpperCase() === gstin) hits.push(loc);
    }
    if (!hits.length) {
        return { location: null, reason: `The invoice is for GSTIN ${gstin}${parsed.recipient_name ? ' (' + parsed.recipient_name + ')' : ''}, which is not the GSTIN of any bunk this mailbox serves (${locations.join(', ')}).` };
    }
    if (hits.length === 1) return { location: hits[0] };
    if (parsed.payer_code) {
        for (const loc of hits) {
            const acct = await OilInvoiceDao.getIoclAccount(loc);
            if (acct && String(acct.account_number || '').trim().endsWith(parsed.payer_code)) return { location: loc };
        }
    }
    return { location: null, reason: `Bunks ${hits.join(', ')} share GSTIN ${gstin}, so PetroMath cannot tell which one this invoice is for. Upload it at the right bunk.` };
}

// One PDF -> log row fields (status, location_code, invoice_no, invoice_id, detail).
async function importPdf(buffer, fileName, locations, by) {
    let parsed;
    try {
        parsed = await parseOilChargeInvoice(buffer);
    } catch (e) {
        if (e.code === 'NOT_CHARGE_INVOICE') return { status: 'NOT_INVOICE', detail: 'Not an IOCL charge invoice (fuel invoice, payment receipt …) - left alone.' };
        return { status: 'ERROR', detail: e.message };
    }
    const { location, reason } = await pickLocation(parsed, locations);
    if (!location) return { status: 'BLOCKED', invoice_no: parsed.invoice_no, detail: reason };

    let r;
    try {
        r = await OilInvoiceService.saveFiles(location, [{ originalname: fileName, buffer }], by);
    } catch (e) {
        if (e.userFacing) return { status: 'BLOCKED', location_code: location, invoice_no: parsed.invoice_no, detail: e.message };
        throw e; // DB trouble: not logged, tried again next run
    }
    const ids = await OilInvoiceDao.getExistingInvoiceNos(location, [parsed.invoice_no]);
    const invoiceId = ids.get(parsed.invoice_no) || null;
    if (r.saved.length) {
        return { status: 'IMPORTED', location_code: location, invoice_no: parsed.invoice_no, invoice_id: invoiceId,
            detail: r.linked ? 'Saved and linked to its SAP debit.' : 'Saved; SAP debit not found yet.' };
    }
    const reasonText = r.skipped.map(s => s.reason).join(' ');
    if (/already uploaded/i.test(reasonText)) {
        return { status: 'EXISTS', location_code: location, invoice_no: parsed.invoice_no, invoice_id: invoiceId, detail: 'Already in the register.' };
    }
    return { status: 'BLOCKED', location_code: location, invoice_no: parsed.invoice_no, detail: reasonText || 'Not saved.' };
}

// Reads one mailbox. by = 'AUTO' (scheduler) or the user name (Check now).
// Returns { status, message, counts: { IMPORTED, EXISTS, BLOCKED, ERROR, NOT_INVOICE }, mails }.
async function runMailbox(mailboxId, by) {
    if (running.has(mailboxId)) {
        return { status: 'BUSY', message: 'This mailbox is being read right now. Try again in a minute.' };
    }
    running.add(mailboxId);
    const counts = { IMPORTED: 0, EXISTS: 0, BLOCKED: 0, ERROR: 0, NOT_INVOICE: 0 };
    let client = null, mails = 0;
    try {
        const box = await MailboxDao.getMailboxSecret(mailboxId);
        const info = await MailboxDao.getMailbox(mailboxId);
        if (!box || !info) return { status: 'ERROR', message: 'Mailbox not found.' };
        if (!info.locations.length) return { status: 'ERROR', message: 'No bunk is ticked for this mailbox.' };
        // only bunks that still have an IOCL SAP account
        const locations = (await MailboxDao.getIoclLocations(info.locations)).map(r => r.location_code);
        if (!locations.length) return { status: 'ERROR', message: 'None of the ticked bunks has an IOCL SAP account.' };

        let password;
        try { password = secretBox.decrypt(box.password_enc); } catch (e) {
            const msg = 'The saved App Password cannot be read on this server. Save it again.';
            await MailboxDao.setRunResult(mailboxId, 'LOGIN_FAILED', msg);
            return { status: 'LOGIN_FAILED', message: msg };
        }

        client = new ImapFlow({
            host: box.imap_host, port: box.imap_port, secure: true,
            auth: { user: box.email_address, pass: password },
            logger: false, connectionTimeout: 30000, greetingTimeout: 15000, socketTimeout: 120000,
        });
        client.on('error', () => { /* reported through the awaited calls */ });
        try {
            await client.connect();
        } catch (e) {
            if (e.authenticationFailed) {
                const msg = 'Gmail refused the login. Check the address and create a new App Password (Google Account > Security > App passwords), then save it here.';
                await MailboxDao.setRunResult(mailboxId, 'LOGIN_FAILED', msg);
                return { status: 'LOGIN_FAILED', message: msg };
            }
            throw e;
        }

        // All Mail, so mails archived or moved to a label in Gmail are still found
        const list = await client.list();
        const all = list.find(m => m.specialUse === '\\All');
        const lock = await client.getMailboxLock(all ? all.path : 'INBOX');
        try {
            const gmail = client.capabilities.has('X-GM-EXT-1');
            const query = gmail
                ? { gmraw: `has:attachment filename:pdf newer_than:${Number(box.lookback_days) || 30}d -label:${DONE_LABEL}` }
                : { since: new Date(Date.now() - (Number(box.lookback_days) || 30) * 86400000) };
            const uids = ((await client.search(query, { uid: true })) || []).sort((a, b) => a - b).slice(-MAX_MAILS_PER_RUN);
            if (gmail && uids.length) {
                try { await client.mailboxCreate(DONE_LABEL); } catch (e) { /* already there */ }
            }

            const msgs = [];
            if (uids.length) {
                for await (const m of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) msgs.push(m);
            }
            const uidValidity = client.mailbox && client.mailbox.uidValidity ? String(client.mailbox.uidValidity) : '0';
            const keyOf = (m) => (m.envelope && m.envelope.messageId) || `uid:${uidValidity}:${m.uid}`;
            const logged = await MailboxDao.getLoggedParts(mailboxId, msgs.map(keyOf));

            for (const m of msgs) {
                const key = keyOf(m);
                const parts = pdfParts(m.bodyStructure);
                const env = m.envelope || {};
                const from = env.from && env.from[0] ? (env.from[0].address || env.from[0].name) : null;
                let allDone = true;
                for (const p of parts) {
                    if (logged.has(`${key}|${p.part}`)) continue;
                    let result;
                    try {
                        if (p.size && p.size > MAX_PDF_BYTES * 1.4) throw Object.assign(new Error('PDF larger than 5 MB'), { permanent: true });
                        const dl = await client.download(m.uid, p.part, { uid: true });
                        if (!dl || !dl.content) throw new Error('Attachment could not be downloaded');
                        const buffer = await streamToBuffer(dl.content, MAX_PDF_BYTES);
                        result = await importPdf(buffer, p.file_name, locations, by === 'AUTO' ? 'EMAIL' : by);
                    } catch (e) {
                        if (!e.permanent) { allDone = false; console.error(`OilInvoiceEmail: ${box.email_address} uid ${m.uid} part ${p.part}:`, e.message); continue; }
                        result = { status: 'ERROR', detail: e.message };
                    }
                    counts[result.status] = (counts[result.status] || 0) + 1;
                    await MailboxDao.addLog({ mailbox_id: mailboxId, message_key: key, part_id: p.part, mail_date: env.date || null,
                        mail_from: from, subject: env.subject, file_name: p.file_name, created_by: by, ...result });
                }
                mails++;
                if (gmail && allDone) {
                    try { await client.messageFlagsAdd(m.uid, [DONE_LABEL], { uid: true, useLabels: true }); } catch (e) { /* the log still stops a re-import */ }
                }
            }
        } finally {
            lock.release();
        }

        const message = `${mails} mail(s) read: ${counts.IMPORTED} imported, ${counts.EXISTS} already in, ${counts.BLOCKED + counts.ERROR} need attention, ${counts.NOT_INVOICE} other PDFs left alone.`;
        await MailboxDao.setRunResult(mailboxId, 'OK', message);
        return { status: 'OK', message, counts, mails };
    } catch (e) {
        const msg = `Could not read the mailbox: ${e.message}`;
        console.error(`OilInvoiceEmail: mailbox ${mailboxId} failed:`, e.message);
        await MailboxDao.setRunResult(mailboxId, 'ERROR', msg).catch(() => {});
        return { status: 'ERROR', message: msg, counts, mails };
    } finally {
        if (client) { try { await client.logout(); } catch (e) { /* closed already */ } }
        running.delete(mailboxId);
    }
}

// Scheduler: every active mailbox, one after another.
async function runAll(trigger) {
    const boxes = await MailboxDao.getMailboxesToRun();
    for (const b of boxes) {
        const r = await runMailbox(b.mailbox_id, 'AUTO');
        console.log(`OilInvoiceEmail (${trigger}): ${b.email_address} ${r.status} - ${r.message}`);
    }
}

// Logs in and logs out, nothing else: used when a mailbox is saved.
async function testLogin(email, password, host = 'imap.gmail.com', port = 993) {
    const client = new ImapFlow({ host, port, secure: true, auth: { user: email, pass: password }, logger: false,
        connectionTimeout: 30000, greetingTimeout: 15000 });
    client.on('error', () => {});
    try {
        await client.connect();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.authenticationFailed
            ? 'Gmail refused the login. Use an App Password (Google Account > Security > App passwords; 2-Step Verification must be on), not the normal Gmail password.'
            : `Could not reach Gmail: ${e.message}` };
    } finally {
        try { await client.logout(); } catch (e) { /* not connected */ }
    }
}

module.exports = { runMailbox, runAll, testLogin, pdfParts, DONE_LABEL };
