// services/oil-invoice-email-service.js — IOCL Invoices: import from email (tkt #484).
//
// Each bunk auto-forwards IOCL's mails (sender B2BPRD@indianoil.in) to a Gmail mailbox. This reads
// that mailbox over IMAP with a Gmail App Password and, for every PDF attachment:
//   - not an IOCL charge invoice (fuel invoice, payment receipt, payment advice ...) -> NOT_INVOICE
//   - a charge invoice -> the bunk is the one of this mailbox's bunks whose GSTIN is the invoice's
//     recipient GSTIN (bunks sharing one: by the LFR payer code, else by the printed name), then it is saved
//     with OilInvoiceService.saveFiles, the same path as an upload: same checks, same duplicate block.
// Every PDF read gets a row in t_oil_invoice_email_log, so it is never read twice; a mail whose PDFs
// are all logged gets the Gmail label "PetroMath-Read" and later searches leave it out; a refused PDF is
// tried again when that label is taken off its mail. Nothing is
// deleted or marked read in the mailbox. A failure that may pass (DB error, connection drop) is not
// logged, so the next run tries that PDF again.
const { ImapFlow } = require('imapflow');
const secretBox = require('../utils/secret-box');
const MailboxDao = require('../dao/oil-invoice-mailbox-dao');
const OilInvoiceDao = require('../dao/oil-invoice-dao');
const OilInvoiceService = require('./oil-invoice-service');
const GstConfigDao = require('../dao/gst-config-dao');
const { parseOilChargeInvoice } = require('./oil-charge-invoice-parser');
const pdfParse = require('pdf-parse');
const { isIoclCngText, parseIoclCngText } = require('./iocl-cng-invoice-parser');
const CngInvoiceService = require('./cng-invoice-service');

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

// "Name <a@b.in>" -> a@b.in; null for IOCL's own address (an auto-forwarded mail keeps it, so it tells nothing).
function forwarder(mailFrom) {
    const m = /<([^>]+)>/.exec(String(mailFrom || ''));
    const addr = (m ? m[1] : String(mailFrom || '')).trim().toLowerCase();
    return addr.includes('@') && !/@(.+\.)?indianoil\.in$/.test(addr) ? addr : null;
}

// Bunk for a parsed invoice among the mailbox's bunks. src: { mailboxId, mailFrom }. Returns { location, reason }.
async function pickLocation(parsed, locations, src) {
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
    const shared = `Bunks ${hits.join(', ')} share GSTIN ${gstin}.`;
    if (parsed.payer_code) return { location: null, reason: `${shared} IOCL customer ${parsed.payer_code} is none of their SAP accounts. Upload it at the right bunk.` };
    const named = await OilInvoiceService.bunkByName(parsed, hits);
    if (!named.location) return { location: null, reason: `${shared} ${named.reason} Upload it at the right bunk.` };
    // forwarded by hand from a bunk's own address: that address must not be another bunk's
    const sender = src && forwarder(src.mailFrom);
    if (sender) {
        const from = await MailboxDao.getLfrLocationsBySender(src.mailboxId, sender, hits);
        if (from.length === 1 && from[0] !== named.location) {
            return { location: null, reason: `${shared} The name on the invoice (${parsed.recipient_name}) is ${named.location}'s, but the mail came from ${from[0]}'s address. Upload it at the right bunk.` };
        }
    }
    return { location: named.location };
}

// The one bunk (of the mailbox's) whose GSTIN is among those printed on a PDF; null if none or several.
async function locationByGstins(gstins, locations) {
    if (!gstins || !gstins.length) return null;
    const hits = [];
    for (const loc of locations) {
        const cfg = await GstConfigDao.findByLocationCode(loc);
        if (cfg && gstins.includes(String(cfg.gstin || '').trim().toUpperCase())) hits.push(loc);
    }
    return hits.length === 1 ? hits[0] : null;
}

// IOCL CNG tax invoice (tkt #481) -> saved as a CNG Purchase Invoice of the bunk whose IOCL SAP account
// ends with the invoice's customer code (CNG invoices carry no buyer GSTIN). null when the PDF is not one.
// invoice_id stays empty: on the log it points at t_oil_co_invoice, and this lands in t_tank_invoice.
async function importCngIfCng(buffer, fileName, locations) {
    let text;
    try {
        text = (await pdfParse(buffer)).text || '';
    } catch (e) {
        return null;
    }
    if (!isIoclCngText(text)) return null;
    let cng;
    try {
        cng = parseIoclCngText(text);
    } catch (e) {
        return { status: 'BLOCKED', detail: 'CNG invoice: ' + e.message };
    }
    const no = cng.header.invoice_number;
    const hits = [];
    for (const loc of locations) {
        const acct = await OilInvoiceDao.getIoclAccount(loc);
        if (acct && cng.customer_code && String(acct.account_number || '').trim().endsWith(cng.customer_code)) hits.push(loc);
    }
    if (hits.length !== 1) {
        return { status: 'BLOCKED', invoice_no: no, detail: hits.length
            ? `CNG invoice for IOCL customer ${cng.customer_code}: bunks ${hits.join(', ')} all have that SAP account.`
            : `CNG invoice for IOCL customer ${cng.customer_code || '?'}, which is not the SAP account of any bunk this mailbox serves (${locations.join(', ')}).` };
    }
    const r = await CngInvoiceService.importCngPdf(hits[0], buffer, fileName); // DB trouble throws: retried next run
    if (r.status === 'IMPORTED') return { status: 'IMPORTED', location_code: hits[0], invoice_no: no, detail: 'Saved as a CNG purchase invoice.' };
    if (r.status === 'EXISTS') return { status: 'EXISTS', location_code: hits[0], invoice_no: no, detail: 'CNG purchase invoice already entered.' };
    if (r.status === 'CANCELLED') return { status: 'EXISTS', location_code: hits[0], invoice_no: no, detail: 'CNG invoice ' + r.detail };
    return { status: 'BLOCKED', location_code: hits[0], invoice_no: no, detail: 'CNG invoice: ' + r.detail };
}

// One PDF -> log row fields (status, location_code, invoice_no, invoice_id, detail).
async function importPdf(buffer, fileName, locations, by, src) {
    let parsed;
    try {
        parsed = await parseOilChargeInvoice(buffer);
    } catch (e) {
        if (e.code === 'NOT_CHARGE_INVOICE') {
            const cng = await importCngIfCng(buffer, fileName, locations);
            if (cng) return cng;
            return { status: 'NOT_INVOICE', location_code: await locationByGstins(e.gstins, locations),
                detail: 'Not an IOCL charge invoice (fuel invoice, payment receipt …) - left alone.' };
        }
        return { status: 'ERROR', detail: e.message };
    }
    const { location, reason } = await pickLocation(parsed, locations, src);
    if (!location) return { status: 'BLOCKED', invoice_no: parsed.invoice_no, recipient_gstin: parsed.recipient_gstin, detail: reason };

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
                        result = await importPdf(buffer, p.file_name, locations, by === 'AUTO' ? 'EMAIL' : by,
                            { mailboxId, mailFrom: from });
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

// ── SCRIPT mailboxes: the Google Apps Script in the Gmail account posts each mail's PDFs ──
// payload: { message_id, subject, from, date, attachments: [{ part, name, data (base64) }] } or { ping: true }.
// Returns { done } — done = every PDF of the mail is logged, so the script may label the mail read.
async function receiveFromScript(box, payload) {
    if (box.active_flag !== 'Y') return { done: false, status: 'OFF', message: 'This mailbox is switched off in PetroMath.' };
    if (payload && payload.ping) {
        await MailboxDao.setRunResult(box.mailbox_id, 'OK', `Google script checked in${payload.sent ? `, sent ${Number(payload.sent)} mail(s)` : ''}.`);
        return { done: true };
    }
    const key = String((payload && payload.message_id) || '').trim();
    const files = Array.isArray(payload && payload.attachments) ? payload.attachments.slice(0, 20) : [];
    if (!key) return { done: false, status: 'BAD', message: 'message_id missing' };
    const locations = (await MailboxDao.getIoclLocations(box.locations)).map(r => r.location_code);
    if (!locations.length) return { done: false, status: 'BAD', message: 'None of the ticked bunks has an IOCL SAP account.' };

    const logged = await MailboxDao.getLoggedParts(box.mailbox_id, [key]);
    const mailDate = payload.date && !isNaN(new Date(payload.date)) ? new Date(payload.date) : null;
    const results = [];
    let done = true;
    for (const f of files) {
        const part = String(f.part || '').substring(0, 30) || '1';
        const fileName = String(f.name || `attachment-${part}.pdf`).substring(0, 200);
        if (logged.has(`${key}|${part}`)) { results.push({ file: fileName, status: 'ALREADY_READ' }); continue; }
        let result;
        try {
            const buffer = Buffer.from(String(f.data || ''), 'base64');
            result = buffer.length > MAX_PDF_BYTES ? { status: 'ERROR', detail: 'PDF larger than 5 MB' }
                : await importPdf(buffer, fileName, locations, 'EMAIL', { mailboxId: box.mailbox_id, mailFrom: payload.from });
        } catch (e) {
            console.error(`OilInvoiceEmail: script mailbox ${box.email_address} ${fileName}:`, e.message);
            done = false; // DB trouble: the script sends the mail again next hour
            results.push({ file: fileName, status: 'RETRY' });
            continue;
        }
        await MailboxDao.addLog({ mailbox_id: box.mailbox_id, message_key: key, part_id: part, mail_date: mailDate,
            mail_from: payload.from, subject: payload.subject, file_name: fileName, created_by: 'SCRIPT', ...result });
        results.push({ file: fileName, status: result.status });
    }
    return { done, results };
}

// The Apps Script the user pastes at script.google.com (signed in as the mailbox's Gmail).
function buildScript(url, token, lookbackDays) {
    return `// PetroMath — sends IOCL invoice PDFs from this Gmail to PetroMath.
// One-time: paste this whole file, Save, choose "setup" in the toolbar and press Run, then Allow.
// After that it runs by itself every hour. Mails it has sent get the label ${DONE_LABEL}.
// Keep this file private: the key below lets it post invoices to your bunks.
var PETROMATH_URL = ${JSON.stringify(url)};
var PETROMATH_KEY = ${JSON.stringify(token)};
var LABEL = ${JSON.stringify(DONE_LABEL)};
var SEARCH = 'has:attachment filename:pdf newer_than:${Number(lookbackDays) || 30}d -label:' + LABEL;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendInvoices') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendInvoices').timeBased().everyHours(1).create();
  sendInvoices();
}

function post_(body) {
  var r = UrlFetchApp.fetch(PETROMATH_URL, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'X-PetroMath-Key': PETROMATH_KEY }, muteHttpExceptions: true, followRedirects: false
  });
  var text = r.getContentText();
  if (r.getResponseCode() !== 200) throw new Error('PetroMath answered ' + r.getResponseCode() + ': ' + text.substring(0, 200));
  return JSON.parse(text);
}

function sendInvoices() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(SEARCH, 0, 40);
  var sent = 0;
  threads.forEach(function (thread) {
    var allDone = true;
    thread.getMessages().forEach(function (m) {
      var pdfs = m.getAttachments().filter(function (a) {
        return /pdf/i.test(a.getContentType()) || /\\.pdf$/i.test(a.getName());
      });
      if (!pdfs.length) return;
      var id = m.getHeader('Message-ID') || m.getId();
      pdfs.forEach(function (a, i) { // one PDF per request keeps each one small
        try {
          var res = post_({
            message_id: id, subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(),
            attachments: [{ part: String(i + 1), name: a.getName(), data: Utilities.base64Encode(a.getBytes()) }]
          });
          if (!res.done) allDone = false;
        } catch (e) {
          allDone = false;
          console.log('Not sent: ' + m.getSubject() + ' / ' + a.getName() + ' - ' + e.message);
        }
      });
      sent++;
    });
    if (allDone) thread.addLabel(label);
  });
  post_({ ping: true, sent: sent });
  console.log('Sent ' + sent + ' mail(s) to PetroMath.');
}
`;
}

module.exports = { runMailbox, runAll, testLogin, receiveFromScript, buildScript, pdfParts, DONE_LABEL };
