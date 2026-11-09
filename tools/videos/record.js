// Records PetroMath's how-to videos on beta in a desktop browser window (ticket #471).
// Each video is a short script: captions, a mouse pointer, clicks and typing at a natural speed.
// Re-run after a screen changes.
//
//   node demo-location.js              (reset the DEMO location first; needs pm-tunnel beta db)
//   node record.js shift-closing       (one video)
//   node record.js --list
//
// Signs in as the DEMO manager (made-up data only). Writes out/<name>/ (raw frames) and
// ../../public/videos/<name>.mp4 + .jpg (what the Help page plays).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const { makeSamples } = require('./samples');

const BASE = process.env.BASE_URL || 'https://beta.petromath.co.in';
const OUT = path.join(__dirname, 'out');
const PUBLIC = path.join(__dirname, '..', '..', 'public', 'videos');
const VIEW = { width: 1280, height: 720 };
const SCALE = 1.5; // captured at 1920x1080, saved at 1280x720: sharp text, small file

// Runs in every page: hides beta-only markers, draws the caption bar, the mouse pointer and the click ring.
// Caption text and pointer position survive page loads via sessionStorage.
function overlayScript() {
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const css = `
    body { padding-bottom: 180px !important; } /* lets buttons at the end of a page scroll clear of the caption */
    #__vcap { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); max-width: 860px; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.92); color: #fff; border-radius: 12px; padding: 12px 22px; pointer-events: none;
      font: 600 21px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center;
      box-shadow: 0 6px 24px rgba(0,0,0,.35); transition: opacity .25s; }
    #__vptr { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none;
      transition: transform .55s cubic-bezier(.4,0,.2,1); }
    .__vring { position: fixed; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; pointer-events: none;
      z-index: 2147483646; background: rgba(250, 204, 21, 0.45); border: 3px solid rgba(234, 179, 8, 0.95); }
    #__vconfirm { position: fixed; inset: 0; z-index: 2147483645; background: rgba(0,0,0,.25); display: flex; justify-content: center; align-items: flex-start; }
    #__vconfirm > div { margin-top: 18px; width: 440px; background: #fff; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.35);
      padding: 20px 22px 16px; font: 14px/1.45 system-ui, "Segoe UI", sans-serif; color: #202124; }
    #__vconfirm .t { font-size: 13px; color: #5f6368; margin-bottom: 8px; }
    #__vconfirm .b { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    #__vconfirm button { border-radius: 16px; padding: 6px 18px; font: 600 14px system-ui, "Segoe UI", sans-serif; border: 1px solid #dadce0; background: #fff; color: #1a73e8; }
    #__vconfirm button.ok { background: #1a73e8; color: #fff; border-color: #1a73e8; }
    #__vdoc { position: fixed; inset: 0; z-index: 2147483644; background: rgba(32,33,36,.82); display: flex; flex-direction: column; align-items: center; }
    #__vdoc .bar { color: #fff; font: 600 15px system-ui, "Segoe UI", sans-serif; padding: 10px 0 8px; }
    #__vdoc .page { width: 620px; height: 600px; overflow: hidden; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
    #__vdoc img { width: 620px; display: block; transition: transform 5s ease-in-out; }
    #__vpick { position: fixed; inset: 0; z-index: 2147483643; background: rgba(0,0,0,.18); display: flex; justify-content: center; align-items: center;
      font: 13px "Segoe UI", system-ui, sans-serif; color: #1b1b1b; }
    #__vpick .win { width: 820px; height: 500px; background: #fff; border: 1px solid #b9b9b9; border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.35);
      display: flex; flex-direction: column; overflow: hidden; }
    #__vpick .tb { height: 34px; display: flex; align-items: center; padding: 0 12px; background: #f3f3f3; font-size: 12px; }
    #__vpick .tb .x { margin-left: auto; letter-spacing: 18px; color: #555; }
    #__vpick .addr { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e5e5e5; background: #f9f9f9; }
    #__vpick .addr .path { flex: 1; border: 1px solid #d4d4d4; border-radius: 4px; padding: 4px 8px; background: #fff; }
    #__vpick .addr .search { width: 200px; border: 1px solid #d4d4d4; border-radius: 4px; padding: 4px 8px; color: #888; background: #fff; }
    #__vpick .body { flex: 1; display: flex; min-height: 0; }
    #__vpick .nav { width: 170px; border-right: 1px solid #e5e5e5; padding: 8px 0; }
    #__vpick .nav div { padding: 5px 16px; }
    #__vpick .nav .on { background: #cce4f7; }
    #__vpick .list { flex: 1; padding: 4px 0; }
    #__vpick .hd, #__vpick .f { display: grid; grid-template-columns: 1fr 150px 120px 70px; padding: 5px 14px; }
    #__vpick .hd { color: #555; border-bottom: 1px solid #eee; font-size: 12px; }
    #__vpick .f .n::before { content: 'PDF'; display: inline-block; width: 26px; margin-right: 8px; font: 700 8px/14px sans-serif; text-align: center;
      color: #fff; background: #d93025; border-radius: 2px; vertical-align: 1px; }
    #__vpick .f.sel { background: #cce4f7; }
    #__vpick .ft { border-top: 1px solid #e5e5e5; padding: 10px 14px; display: flex; align-items: center; gap: 8px; background: #f9f9f9; }
    #__vpick .ft .name { flex: 1; border: 1px solid #d4d4d4; border-radius: 4px; padding: 5px 8px; background: #fff; min-height: 28px; }
    #__vpick .ft .type { width: 160px; border: 1px solid #d4d4d4; border-radius: 4px; padding: 5px 8px; background: #fff; }
    #__vpick .ft button { width: 90px; padding: 5px 0; border-radius: 4px; border: 1px solid #c4c4c4; background: #fff; font: 13px "Segoe UI", sans-serif; }
    #__vpick .ft button.open { background: #0067c0; color: #fff; border-color: #0067c0; }`;
  const POINTER = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 20 L9 15.5 L12.5 22.5 L15.5 21 L12 14 L19 14 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  // Beta-only markers hidden by CSS from the very first paint (the clean-up in ready() runs only after the
  // page has loaded, and the screencast can catch a frame before that): prod's sidebar header is yellow,
  // and the CANARY badge and "Development Environment" banner don't exist there.
  const early = document.createElement('style');
  early.textContent = `
    .sidebar-header.canary-instance { background: linear-gradient(135deg, #f4d03f 0%, #f7dc6f 100%) !important; }
    .sidebar-user span[style*="orange"] { display: none !important; }
    .alert-warning[style*="ff9800"] { display: none !important; }
    #loginInfoPassword { filter: blur(6px) !important; } /* never show a default password in a shared video */`;
  if (document.documentElement) document.documentElement.appendChild(early);
  else {
    const mo = new MutationObserver(() => {
      if (document.documentElement) { document.documentElement.appendChild(early); mo.disconnect(); }
    });
    mo.observe(document, { childList: true });
  }

  function ready() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    // Beta-only markers: the blue sidebar header (prod's is yellow), the "Development Environment" banner, the CANARY badge.
    document.querySelectorAll('.canary-instance').forEach((e) => e.classList.remove('canary-instance'));
    document.querySelectorAll('.alert').forEach((a) => { if (/Development Environment/.test(a.textContent)) a.remove(); });
    document.querySelectorAll('.sidebar-user span').forEach((s) => {
      if (s.textContent.trim() === 'CANARY') { if (s.previousElementSibling && s.previousElementSibling.tagName === 'BR') s.previousElementSibling.remove(); s.remove(); }
    });
    const ptr = document.createElement('div');
    ptr.id = '__vptr';
    ptr.innerHTML = POINTER;
    document.documentElement.appendChild(ptr);
    const [x, y] = (store.get('__vptr') || '640,400').split(',').map(Number);
    ptr.style.transition = 'none';
    ptr.style.transform = `translate(${x}px, ${y}px)`;
    window.__vSay(store.get('__vcap') || '');
  }
  window.__vSay = (text) => {
    store.set('__vcap', text || '');
    let el = document.getElementById('__vcap');
    if (!el) { el = document.createElement('div'); el.id = '__vcap'; document.documentElement.appendChild(el); }
    el.textContent = text || '';
    el.style.opacity = text ? '1' : '0';
  };
  window.__vMove = (x, y) => {
    store.set('__vptr', `${x},${y}`);
    const p = document.getElementById('__vptr');
    if (!p) return;
    p.style.transition = '';
    p.style.transform = `translate(${x}px, ${y}px)`;
  };
  window.__vRing = (x, y) => {
    const r = document.createElement('div');
    r.className = '__vring';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.documentElement.appendChild(r);
    r.animate([{ transform: 'scale(0.5)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 650 });
    setTimeout(() => r.remove(), 650);
  };
  // Look-alike of the browser's confirm box: a screencast can't capture the real one.
  window.__vConfirm = (msg, host, okOnly) => {
    const d = document.createElement('div');
    d.id = '__vconfirm';
    d.innerHTML = `<div><div class="t">${host} says</div><div>${msg}</div><div class="b">${okOnly ? '' : '<button>Cancel</button>'}<button class="ok">OK</button></div></div>`;
    document.documentElement.appendChild(d);
  };
  // Look-alike of the computer's "Open" file window (a screencast can't capture the real one).
  // files: [{ name, date, size }]
  window.__vPicker = (files) => {
    const d = document.createElement('div');
    d.id = '__vpick';
    const rows = files.map((f, i) => `<div class="f" data-i="${i}"><span class="n">${f.name}</span><span>${f.date}</span><span>PDF Document</span><span>${f.size}</span></div>`).join('');
    d.innerHTML = `<div class="win"><div class="tb">Open<span class="x">–▢✕</span></div>
      <div class="addr"><div class="path">This PC  ›  Downloads</div><div class="search">Search Downloads</div></div>
      <div class="body"><div class="nav"><div>Home</div><div>Desktop</div><div class="on">Downloads</div><div>Documents</div><div>Pictures</div><div>This PC</div></div>
      <div class="list"><div class="hd"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>${rows}</div></div>
      <div class="ft"><span>File name:</span><div class="name"></div><div class="type">PDF files (*.pdf)</div><button class="open">Open</button><button>Cancel</button></div></div>`;
    document.documentElement.appendChild(d);
  };
  window.__vPickerSelect = (i) => {
    document.querySelectorAll('#__vpick .f').forEach((r) => r.classList.toggle('sel', r.dataset.i === String(i)));
    const r = document.querySelector(`#__vpick .f[data-i="${i}"] .n`);
    document.querySelector('#__vpick .name').textContent = r ? r.textContent : '';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
}

function makeHelpers(page, t0) {
  const marks = { start: 0 };
  const now = () => (Date.now() - t0) / 1000;
  const pause = (ms) => page.waitForTimeout(ms);
  const loc = (l) => (typeof l === 'string' ? page.locator(l).first() : l);
  const h = {
    marks,
    pause,
    async go(url) { await page.goto(BASE + url, { waitUntil: 'networkidle' }); },
    async begin() { marks.start = now(); },
    async say(text, ms = 1800) {
      await page.evaluate((t) => window.__vSay(t), text);
      if (ms) await pause(ms);
    },
    async show(l, ms = 500) {
      const el = loc(l);
      await el.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await pause(ms);
      return el;
    },
    // Glide the pointer to the element's centre.
    async point(l, ms = 650) {
      const el = await h.show(l, 350);
      const b = await el.boundingBox();
      const x = b.x + Math.min(b.width / 2, 60);
      const y = b.y + b.height / 2;
      await page.evaluate(([px, py]) => window.__vMove(px, py), [x, y]);
      await pause(ms);
      return { el, x, y };
    },
    async tap(l, ms = 700, opts = {}) {
      const { el, x, y } = await h.point(l);
      await page.evaluate(([px, py]) => window.__vRing(px, py), [x, y]);
      await pause(250);
      if (!opts.noClick) await el.click();
      await pause(ms);
    },
    async type(l, text, delay = 70) {
      const { el } = await h.point(l, 450);
      await el.click();
      await el.fill(''); // clear first: Ctrl+A then typing can drop the first digit in a number box
      await el.pressSequentially(String(text), { delay });
      await pause(350);
    },
    async pick(l, label, ms = 700) {
      const { el, x, y } = await h.point(l, 450);
      await page.evaluate(([px, py]) => window.__vRing(px, py), [x, y]);
      await pause(250);
      await el.selectOption({ label });
      await pause(ms);
    },
    async scrollBy(px, ms = 1200) {
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), px);
      await pause(ms);
    },
    async top(ms = 600) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await pause(ms);
    },
    // Show the look-alike browser dialog and click its OK (a screencast can't capture the real one).
    async dialog(message, caption, okOnly = false) {
      await page.evaluate(([m, o]) => window.__vConfirm(m, location.host.replace(/^beta\./, ''), o), [message, okOnly]);
      if (caption) await h.say(caption, 1600); else await h.pause(1200);
      await h.tap('#__vconfirm button.ok', 300, { noClick: true });
      await page.evaluate(() => document.getElementById('__vconfirm').remove());
    },
    // Click something that opens the computer's file window, show the look-alike, pick the file, click Open.
    async choosePdf(trigger, file, caption) {
      const name = path.basename(file);
      const kb = `${Math.max(1, Math.round(fs.statSync(file).size / 1024))} KB`;
      const day = new Date(Date.now() + 5.5 * 3600e3);
      const stamp = (n) => { const x = new Date(day - n * 864e5); return `${String(x.getUTCDate()).padStart(2, '0')}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${x.getUTCFullYear()} 10:2${n}`; };
      const files = [
        { name: 'Bank_Statement_Oct.pdf', date: stamp(6), size: '84 KB' },
        { name, date: stamp(0), size: kb },
        { name: 'EB_Bill_Oct.pdf', date: stamp(9), size: '61 KB' },
        { name: 'GST_Return_Sep.pdf', date: stamp(12), size: '132 KB' },
      ];
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), h.tap(trigger, 0)]);
      await page.evaluate((f) => window.__vPicker(f), files);
      await h.say(caption, 900);
      const row = page.locator('#__vpick .f[data-i="1"]');
      await h.tap(row, 300, { noClick: true });
      await page.evaluate(() => window.__vPickerSelect(1));
      await h.pause(900);
      await h.tap('#__vpick button.open', 300, { noClick: true });
      await page.evaluate(() => document.getElementById('__vpick').remove());
      await chooser.setFiles(file);
    },
    // Show a document page (an image) as if opened, pan down it, then close it.
    async showDoc(png, title, captions) {
      const src = `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
      await page.evaluate(([s, t]) => {
        const d = document.createElement('div');
        d.id = '__vdoc';
        d.innerHTML = `<div class="bar">${t}</div><div class="page"><img src="${s}"></div>`;
        document.documentElement.appendChild(d);
      }, [src, title]);
      await h.say(captions[0], 2600);
      await page.evaluate(() => {
        const img = document.querySelector('#__vdoc img');
        img.style.transform = `translateY(-${Math.max(0, img.offsetHeight - 600)}px)`;
      });
      await h.say(captions[1], 5400);
      await page.evaluate(() => document.getElementById('__vdoc').remove());
    },
    // Click a Next / tab button and wait for the draft to save.
    async next(paneSel, ms = 900) {
      await h.say('', 0); // the next tab brings its own caption
      await h.tap(page.locator(`${paneSel} button.btn-primary`, { hasText: 'Next' }), 0);
      await page.waitForLoadState('networkidle');
      await pause(ms);
    },
  };
  return h;
}

// Beta DB (through pm-tunnel), for figures the video needs to look right, e.g. how much cash to count.
async function betaDb() {
  if (Number(process.env.BETA_DB_PORT) === 33307) throw new Error('BETA_DB_PORT points at the prod tunnel.');
  return mysql.createConnection({
    host: process.env.BETA_DB_HOST, port: Number(process.env.BETA_DB_PORT), user: process.env.BETA_DB_USER,
    password: process.env.BETA_DB_PASSWORD, database: process.env.BETA_DB_NAME,
  });
}

// A believable cash bundle for an amount: mostly 500s, some 200s/100s/50s, the rest in small notes and coins.
function cashInNotes(amount) {
  const notes = { 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 2: 0, 1: 0 };
  let left = amount;
  for (const [n, share] of [[500, 0.72], [200, 0.12], [100, 0.09], [50, 0.04]]) {
    notes[n] = Math.floor((amount * share) / n);
    left -= notes[n] * n;
  }
  for (const n of [500, 200, 100, 50, 20, 10, 5, 2, 1]) { const c = Math.floor(left / n); notes[n] += c; left -= c * n; }
  return notes;
}

// DEMO bank_id by bank name (ids differ between databases).
// A real purchase invoice PDF the station already has in PetroMath (the owner chose real invoices for these
// videos). Copied from the beta DB into out/real/ at record time and never committed. kind: 'fuel' | 'lube'.
async function realInvoicePdf(kind) {
  const loc = process.env.REAL_SOURCE_LOC;
  const number = kind === 'fuel' ? process.env.REAL_FUEL_INVOICE : process.env.REAL_LUBE_INVOICE;
  const sql = kind === 'fuel'
    ? `SELECT d.file_name, d.file_data FROM t_document_store d JOIN t_tank_invoice t ON t.id = d.entity_id
        WHERE d.entity_type = 'TANK_INVOICE' AND d.location_code = ? AND t.invoice_number = ? ORDER BY d.doc_id DESC LIMIT 1`
    : `SELECT d.file_name, d.file_data FROM t_document_store d JOIN t_lubes_inv_hdr h ON h.lubes_hdr_id = d.entity_id
        WHERE d.entity_type = 'LUBE_INVOICE' AND d.location_code = ? AND h.location_code = ? AND h.invoice_number = ? ORDER BY d.doc_id DESC LIMIT 1`;
  const db = await betaDb();
  try {
    const [[row]] = await db.query(sql, kind === 'fuel' ? [loc, number] : [loc, loc, number]);
    if (!row) throw new Error(`No ${kind} invoice ${number} with a PDF at ${loc} on the beta DB`);
    const dir = path.join(OUT, 'real');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, row.file_name.replace(/[^\w.-]+/g, '_'));
    fs.writeFileSync(file, row.file_data);
    return { file, number };
  } finally { await db.end(); }
}

// Areas blurred on the real SERVO distributor invoice (fractions of page 1): supplier phone/GSTIN line,
// Bill To + Place of Supply (buyer address, customer ID, GSTIN, phone), order/salesman/vehicle details,
// bank details, IRN/Ack numbers, QR code.
const LUBE_INVOICE_BLUR = [[0.1978, 0.0653, 0.5934, 0.0186], [0.0242, 0.1166, 0.4868, 0.1678], [0.511, 0.1305, 0.1978, 0.0746],
  [0.2143, 0.5361, 0.2912, 0.0715], [0.0242, 0.6247, 0.5165, 0.0404], [0.756, 0.6076, 0.2154, 0.1461]];

// Page 1 of a PDF as a PNG with the given areas blurred (x, y, w, h as fractions of the page).
function blurredPage(pdf, areas, out) {
  const raw = out.replace(/\.png$/, '-raw');
  execFileSync(process.env.PDFTOPPM_PATH || 'pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', pdf, raw]);
  const ihdr = fs.readFileSync(`${raw}.png`); // PNG width/height live at bytes 16-23
  const W = ihdr.readUInt32BE(16);
  const H = ihdr.readUInt32BE(20);
  const px = ([x, y, w, h]) => [x * W, y * H, w * W, h * H].map((v) => Math.round(v / 2) * 2);
  // Mosaic (shrink 10x, enlarge in blocks) then a light blur: unreadable at any size.
  const parts = areas.map((a, i) => {
    const [x, y, w, h] = px(a);
    return `[0:v]crop=${w}:${h}:${x}:${y},scale=${Math.max(2, Math.round(w / 10))}:${Math.max(2, Math.round(h / 10))},scale=${w}:${h}:flags=neighbor,boxblur=2:1[b${i}]`;
  });
  let chain = '[0:v]';
  const lays = areas.map((a, i) => { const [x, y] = px(a); const outL = i === areas.length - 1 ? '' : `[o${i}]`; const s = `${chain}[b${i}]overlay=${x}:${y}${outL}`; chain = `[o${i}]`; return s; });
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', `${raw}.png`, '-filter_complex', [...parts, ...lays].join(';'), out]);
  return out;
}

async function bankId(name) {
  const db = await betaDb();
  try {
    const [[row]] = await db.query("SELECT bank_id FROM m_bank WHERE location_code = 'DEMO' AND bank_name = ?", [name]);
    return row.bank_id;
  } finally { await db.end(); }
}

// Today in IST as yyyy-mm-dd (the shift date the page defaults to).
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

// Upload Transactions walkthrough, shared by the bank and SAP videos.
// v: { bankLabel, file, intro[], ledgers[] (one per statement line, in order), listUrl, listCaption }
async function uploadWalkthrough(h, page, v) {
  await h.go('/home');
  await h.begin();
  for (const line of v.intro) await h.say(line, 2400);
  await h.say('Open Daily Operations, then Upload Transactions.', 700);
  await h.tap('.sidebar a[href="/transaction-upload"]', 0);
  await page.waitForURL(/\/transaction-upload/);
  await page.waitForLoadState('networkidle');
  await h.pause(500);

  // Step 1
  await h.say('Step 1: choose the account this statement belongs to.', 500);
  await h.pick('#bank_id', v.bankLabel, 900);
  await h.say('Then choose the statement file (Excel or PDF).', 500);
  await h.tap('#transactionFile', 300, { noClick: true });
  await page.setInputFiles('#transactionFile', v.file);
  await h.pause(1400);
  await h.say('Click Next: Preview Transactions.', 500);
  await h.tap('#btnUpload', 0);
  await page.locator('#step2-summary').waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await h.pause(600);

  // Step 2
  await h.top(300);
  await h.say('Step 2: PetroMath reads every line of the statement.', 600);
  await h.point('#step2-summary', 2000);
  await h.say('Lines already uploaded before are marked as duplicates and skipped.', 2400);
  await h.say('Choose a ledger for each line: who paid, or what the money was for.', 600);
  for (let i = 0; i < v.ledgers.length; i++) {
    const sel = page.locator(`.ledger-select[data-index="${i}"]`);
    await page.waitForFunction((n) => document.querySelector(`.ledger-select[data-index="${n}"]`)?.options.length > 1, i);
    if (i === 2) await h.say('The ledger list shows only what is allowed for this account.', 300);
    if (i === 4) await h.say(v.midCaption, 300);
    await h.pick(sel, v.ledgers[i], i < 3 ? 700 : 350);
  }
  await h.say('Next time, PetroMath suggests the ledger from what you chose before.', 2600);
  await h.say('When every line has a ledger, click Next.', 500);
  await h.tap('#btnProceedToStep3', 900);

  // Step 3
  await h.top(300);
  await h.say('Step 3: check the count and the account, then Save All Transactions.', 600);
  await h.point('#step3-summary', 1800);
  const save = page.locator('#btnFinalSave');
  await h.tap(save, 300, { noClick: true });
  await page.evaluate(() => {
    window.confirm = () => true;
    window.alert = (m) => { try { sessionStorage.setItem('__valert', m); } catch (e) { /* ignore */ } };
  });
  await h.dialog(`Save ${v.ledgers.length} transactions?`, 'Confirm with OK.');
  await Promise.all([page.waitForEvent('load', { timeout: 60000 }), save.click()]);
  await page.waitForLoadState('networkidle');
  const saved = await page.evaluate(() => sessionStorage.getItem('__valert'));
  if (!/^Success/.test(saved || '')) throw new Error(`Save did not succeed: ${saved}`);
  await h.dialog(saved, 'Saved.', true);

  // Where the lines are now
  await h.say(v.listCaption, 600);
  await h.go(v.listUrl);
  await h.pause(800);
  await h.point(page.locator('table tbody tr').first(), 2600);
  await h.say('From here they are used for reconciliation and the accounts.', 2600);
}

const weekAgoIST = () => new Date(Date.now() + 5.5 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);

const VIDEOS = {
  'bank-upload': {
    title: 'Upload a bank statement',
    async run(h, page) {
      await uploadWalkthrough(h, page, {
        bankLabel: 'IOB - IOB CA 1234',
        file: makeSamples().iob,
        intro: ['Upload your bank statement to bring every bank credit and debit into PetroMath.',
          'First download the statement from your internet banking as an Excel file.'],
        ledgers: ['CARD SWIPE', 'PAYTM', 'CASH', 'SRI LAKSHMI TRANSPORTS', 'IOCL-SOA (SAP-001234)',
          'KAVERI ROADWAYS', 'ELECTRICITY EXPENSES', 'BANK CHARGES'],
        midCaption: 'A payment to IOCL goes to your SAP account.',
        listCaption: 'The lines are now in Bank Transactions.',
        listUrl: `/bank-statement?tbankfromDate=${weekAgoIST()}&tbanktoDate=${todayIST()}&bank_id=${await bankId('IOB')}`,
      });
    },
  },

  'sap-upload': {
    title: 'Upload the oil company (SAP) statement',
    async run(h, page) {
      await uploadWalkthrough(h, page, {
        bankLabel: 'IOCL-SOA - SAP-001234',
        file: makeSamples().sap,
        intro: ['The oil company statement (SAP) is uploaded the same way as a bank statement.',
          'Download your account statement from the oil company portal as an Excel file.'],
        ledgers: ['PURCHASE INVOICE', 'IOB (IOB CA 1234)', 'FLEET CARD', 'IOCL LICENSE FEE RECOVERY', 'PURCHASE INVOICE'],
        midCaption: 'Product invoices go to Purchase Invoice.',
        listCaption: 'The lines are now in SAP Transactions.',
        listUrl: `/oil-company-statement?fromDate=${weekAgoIST()}&toDate=${todayIST()}&bank_id=${await bankId('IOCL-SOA')}`,
      });
    },
  },

  'customer-statement': {
    title: "Run a customer's credit statement",
    async run(h, page) {
      await h.go('/home');
      await h.begin();
      await h.say("The Customer Detailed Report is a credit customer's statement: every bill and payment.", 2800);
      await h.say('Open Reports, then Customer Detailed Report.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /reports/i }).first(), 700);
      await h.tap('.sidebar a[href="/reports"]', 0);
      await page.waitForURL(/\/reports$/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await h.say('Choose the period. Here, last month.', 400);
      await h.pick('#dateRange', 'Last Month', 600);
      await h.say('You can also pick This Month, a month and year, a financial year, or your own dates.', 2600);
      await h.say('Then choose the customer.', 400);
      await h.pick('#company_id', 'SRI LAKSHMI TRANSPORTS', 600);
      await h.say('Click Go.', 400);
      await h.tap('#goButton', 0);
      await page.waitForLoadState('networkidle');
      await h.pause(700);

      await h.say('The Period Summary: opening balance, bills, payments and closing balance.', 600);
      await h.point('.period-summary', 3200);
      await h.say('Below it, every bill: date, bill number, product, vehicle, quantity and amount.', 600);
      await h.point(page.locator('table.credit-stmt-table tbody tr').nth(2), 2600);
      await h.say('Payments appear as credits, and the balance runs line by line.', 600);
      await h.point(page.locator('table.credit-stmt-table tbody tr.stmt-credit').first(), 3000);
      await h.scrollBy(900, 1600);
      await h.say('The statement ends with the totals and the closing balance.', 600);
      await h.point('table.credit-stmt-table tr.stmt-balance-row >> nth=-1', 2600);

      await h.top(700);
      await h.say('To send it to the customer, click the green Download PDF button.', 600);
      const btn = page.locator('button[title="Download PDF"]');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), h.tap(btn, 300)]);
      const dir = path.join(OUT, 'customer-statement-pdf');
      fs.mkdirSync(dir, { recursive: true });
      const pdf = path.join(dir, 'statement.pdf');
      await dl.saveAs(pdf);
      execFileSync(process.env.PDFTOPPM_PATH || 'pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(dir, 'page1')]);
      await h.showDoc(path.join(dir, 'page1.png'), dl.suggestedFilename(), [
        'The PDF has your station name and address at the top.',
        'Share it on WhatsApp or print it. The blue Print button opens it ready to print.']);
      await h.say('PetroMath: every customer, every bill, accounted for.', 2400);
    },
  },

  'add-customer': {
    title: 'Add a credit customer, with opening balance and login',
    user: 'admin', // only Admins can add customers
    async run(h, page) {
      const NAME = 'MURUGAN TRAVELS';
      await h.go('/home');
      await h.begin();
      await h.say('Adding a credit customer: their details, what they owed from your old books, and a login.', 3000);
      await h.say('Customers are added by the owner (Admin). Open Masters, then Customers.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /masters/i }).first(), 700);
      await h.tap('.sidebar a[href="/credit-master"]', 0);
      await page.waitForURL(/\/credit-master/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await h.say('Every customer is listed with their opening balance and login.', 600);
      await h.point('#customers-master-table tbody tr >> nth=0', 2400);
      await h.say('Click Add Customer.', 400);
      await h.tap('#addCustomerBtn', 900);
      await page.locator('#addCustomerModal.show').waitFor();

      await h.say('Enter the company name, a short name for bills, and the phone number.', 400);
      await h.type('#addCustomerModal input[name=m_credit_name_0]', NAME);
      await h.type('#addCustomerModal input[name=m_credit_short_name_0]', 'MURUGAN TRAVELS', 50);
      await h.type('#addCustomerModal input[name=m_credit_phoneno_0]', '98400 66666');
      await h.say('The address, and the GST number if they need tax invoices.', 400);
      await h.type('#addCustomerModal textarea[name=m_credit_address_0]', 'BHAVANI ROAD, ERODE', 45);
      await h.say('Remittance Bank: the account they pay into.', 400);
      await h.pick('#addCustomerModal select[name=m_credit_remittance_bank_id_0]', 'IOB CA 1234', 400);
      await h.say('Their payments then appear under this customer when you upload that bank statement.', 2600);

      await h.say('Opening Balance: what they owed before their first bill in PetroMath.', 600);
      await h.point('#addCustomerModal input[name=ob_date]', 400);
      await h.say('"As on" is filled in: the day before you started on PetroMath.', 2400);
      await h.say('Enter the amount from your old ledger. Leave 0 for a brand-new customer.', 300);
      await h.type('#addCustomerModal input[name=ob_amount]', '18500');
      await h.pause(600);
      await h.say('Click Save Customer.', 400);
      await Promise.all([page.waitForNavigation(), h.tap(page.locator('#addCustomerModal button[type=submit]'), 0)]);
      await page.waitForLoadState('networkidle');
      await h.pause(600);
      await h.say('Saved.', 1400);

      await h.say('Search for the customer.', 300);
      await h.type('#searchInput', 'MURUGAN', 90);
      await h.pause(800);
      const row = page.locator('#customers-master-table tbody tr', { hasText: NAME }).first();
      await h.say('The opening balance is set, as on that date.', 400);
      await h.point(row.locator('td.ob-cell'), 2600);
      await h.say('PetroMath also made a login, so the customer can see their own bills and statement.', 600);
      await h.point(row.locator('td', { has: page.locator('.show-login-btn') }), 2600);
      await h.say('To see the login details, click the key.', 400);
      await h.tap(row.locator('.show-login-btn'), 1200);
      await page.locator('#loginInfoModal.show').waitFor();
      await page.waitForLoadState('networkidle');
      await h.say('The username, and the password (hidden in this video).', 500);
      await h.point('#loginInfoUsername', 2200);
      await h.say('Copy them and send them to the customer, for example on WhatsApp.', 2600);
      await h.say('Reset Password gives a new one if they forget it. You can also switch the login off here.', 400);
      await h.point('#resetPasswordBtn', 2600);
      await h.tap(page.locator('#loginInfoModal .modal-footer button.btn-secondary'), 900);
      await h.say("Add their vehicles with the truck button. They're ready for credit bills.", 600);
      await h.point(row.locator('a[title="Manage Vehicles"]'), 2600);
    },
  },

  'fuel-invoice': {
    title: 'Upload a fuel (tanker) invoice PDF',
    async run(h, page) {
      const fuel = await realInvoicePdf('fuel');
      await h.go('/home');
      await h.begin();
      await h.say("When a tanker arrives, enter the oil company's invoice from its PDF. No typing.", 2800);
      await h.say('Open Transactions, then Purchase Invoice.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /transactions/i }).first(), 700);
      await h.tap('.sidebar a[href="/lubes-invoice-home"]', 0);
      await page.waitForURL(/lubes-invoice-home/);
      await page.waitForLoadState('networkidle');
      await h.pause(500);
      await h.say('Click New Purchase, then Fuel Invoice.', 500);
      await h.tap(page.getByRole('button', { name: 'New Purchase' }), 700);
      await h.tap(page.locator('.dropdown-menu a[href="/purchases/fuel-invoice/new"]'), 0);
      await page.waitForURL(/fuel-invoice\/new/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await h.say('Click Choose File and pick the invoice PDF you downloaded.', 400);
      await h.choosePdf('#fuelInvoicePdfUpload', fuel.file, 'Your Downloads folder: select the invoice PDF and click Open.');
      await h.say('PetroMath reads the invoice…', 0);
      await page.waitForFunction(() => /read successfully/i.test(document.getElementById('fuelParseStatus').textContent), null, { timeout: 60000 });
      await h.pause(800);

      await h.say('Everything is filled in from the PDF: invoice number, date, tanker number and total.', 600);
      await h.point('#fi_invoice_number', 1500);
      await h.point('#fi_truck_number', 1300);
      await h.point('#fi_total_amount', 1800);
      await h.say('And each product: quantity, rate, density and HSN code, with the VAT charges below.', 600);
      await h.point('#fi_lines_body tr >> nth=0', 2800);
      await h.say('The first time only, tell PetroMath which of your products each invoice product is.', 600);
      await h.pick(page.locator('#fi_lines_body .fi-product-id').nth(0), 'MS', 600);
      await h.pick(page.locator('#fi_lines_body .fi-product-id').nth(1), 'HSD', 600);
      await h.say('PetroMath remembers this, so next time it is picked for you.', 2400);
      await h.say('Check the figures against the paper invoice, then click Save Mapping.', 600);
      await Promise.all([page.waitForURL(/fuel-invoice\/\d+/, { timeout: 60000 }), h.tap(page.locator('button[onclick="fuelInvoiceSave()"]'), 0)]);
      await page.waitForLoadState('networkidle');
      await h.pause(700);
      await h.say('Saved. The PDF is kept with the invoice, so you can open it any time.', 2800);
      await h.say('Purchases, stock and accounts now include this tanker.', 2400);
    },
  },

  'lube-invoice': {
    title: 'Upload a lube purchase invoice PDF',
    async run(h, page) {
      const lube = await realInvoicePdf('lube');
      await h.go('/home');
      await h.begin();
      await h.say("Lube purchases are entered the same way: from the distributor's invoice PDF.", 2800);
      await h.say('Open Transactions, then Purchase Invoice.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /transactions/i }).first(), 700);
      await h.tap('.sidebar a[href="/lubes-invoice-home"]', 0);
      await page.waitForURL(/lubes-invoice-home/);
      await page.waitForLoadState('networkidle');
      await h.pause(500);
      await h.say('Click New Purchase, then Lube Invoice.', 500);
      await h.tap(page.getByRole('button', { name: 'New Purchase' }), 700);
      await h.tap(page.locator('.dropdown-menu a[href="/lubes-invoice/new"]'), 0);
      await page.waitForURL(/lubes-invoice\/new/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await page.evaluate(() => { window.confirm = () => true; }); // "replace the empty line?" on a new invoice
      await h.say('Click Fill from invoice PDF.', 400);
      await h.choosePdf('#pi-pdf-btn', lube.file, 'Select the invoice PDF and click Open.');
      await h.say('PetroMath reads the invoice…', 0);
      await page.waitForFunction(() => document.getElementById('invoice_number').value.length > 0, null, { timeout: 60000 });
      await page.waitForLoadState('networkidle');
      await h.pause(900);

      await h.say('The supplier, invoice number and date are filled in.', 600);
      await h.point('#supplier_id', 1400);
      await h.point('#invoice_number', 1400);
      await h.say('Every product line too: quantity, rate, discount and GST.', 600);
      await h.point(page.locator('.pi-src').first(), 2400);
      await h.say('Each line is linked to your product: Matched. Check any marked Suggested or Pick.', 2800);
      // The invoice it read, with the buyer's and supplier's private details blurred (owner's choice).
      const page1 = blurredPage(lube.file, LUBE_INVOICE_BLUR, path.join(OUT, 'real', 'lube-page1.png'));
      await h.showDoc(page1, 'The invoice PDF it read', [
        'Here is the invoice PDF. Private details are blurred in this video.',
        'Same products, quantities and amounts as the screen.']);
      await h.say('The figures from the PDF are locked, so they match the invoice exactly.', 2400);
      await h.scrollBy(500, 1200);
      await h.say('The total matches the invoice total.', 400);
      await h.point('#close-btn', 1600);
      await h.say('When it is right, click Save & Close Invoice.', 500);
      const closeBtn = page.locator('#close-btn');
      await page.waitForFunction(() => !document.getElementById('close-btn').disabled, null, { timeout: 30000 });
      await h.tap(closeBtn, 300, { noClick: true });
      await h.dialog('Close this invoice? Stock and accounts will use it, and it cannot be changed afterwards.', 'Confirm with OK.');
      await Promise.all([page.waitForURL(/lubes-invoice-home/, { timeout: 60000 }), closeBtn.click()]);
      await page.waitForLoadState('networkidle');
      await h.pause(700);
      await h.say('Saved. The stock of each product goes up, and the invoice PDF is attached.', 600);
      await h.point(page.locator('tr', { hasText: lube.number }).first(), 2800);
    },
  },

  'add-product': {
    title: 'Add a product (lube or other item) with opening stock',
    user: 'admin',
    async run(h, page) {
      const NAME = 'CHAIN LUBE SPRAY 150 ML';
      await h.go('/home');
      await h.begin();
      await h.say('Adding a product you sell: lubes, coolant, or any other item.', 2600);
      await h.say('Open Masters, then Products.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /masters/i }).first(), 700);
      await h.tap('.sidebar a[href="/products"]', 0);
      await page.waitForURL(/\/products/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await h.say('Every product is listed with its unit, price and opening stock.', 2600);
      await h.say('Click Add Product.', 400);
      await h.tap('#addProductBtn', 900);
      await page.locator('#addProductModal.show').waitFor();

      await h.say('Enter the product name as you want it on bills, with the pack size.', 400);
      await h.type('#addProductForm input[name=product_name]', NAME, 55);
      await h.say('The HSN code from the supplier invoice.', 400);
      await h.type('#addProductForm input[name=hsn_code]', '27101973');
      await h.say('The unit: NOS for packs and bottles, LIT for loose oil.', 400);
      await h.pick('#addProductForm select[name=unit]', 'NOS (pieces)', 600);
      await h.say('The selling price, with GST.', 400);
      await h.type('#addProductForm input[name=price]', '180');
      await h.say('The GST rate: half as CGST, half as SGST. 18% is 9 and 9.', 400);
      await h.type('#addProductForm input[name=cgst_percent]', '9');
      await h.type('#addProductForm input[name=sgst_percent]', '9');
      await h.say('Non-Fuel Product is ticked, so PetroMath tracks its stock.', 400);
      await h.point('#is_lube_product', 2200);
      await h.say('Click Add Product.', 400);
      await Promise.all([page.waitForEvent('load', { timeout: 30000 }), h.tap('#addProductModal button[type=submit]', 0)]);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      const row = page.locator('tr', { hasText: NAME }).first();
      await h.say('The product is added. Cashiers can now pick it in Lube Sales and Credit Sales.', 600);
      await h.point(row, 2600);
      await h.say('Its opening stock is not set yet. Click Set.', 400);
      await h.tap(row.locator('.opening-stock-btn'), 1000);
      await page.locator('#openingStockModal.show #osBody').waitFor({ state: 'visible', timeout: 30000 });
      await h.pause(500);
      await h.say('Opening stock: how many you have in hand when you start selling it in PetroMath.', 500);
      await h.point('#osDate', 2400);
      await h.say('Enter the quantity from a physical count.', 300);
      await h.type('#osQty', '24');
      await h.type('#osNote', 'Physical count', 60);
      await h.say('Click Save.', 400);
      await Promise.all([page.waitForEvent('load', { timeout: 30000 }), h.tap('#osSaveBtn', 0)]);
      await page.waitForLoadState('networkidle');
      await h.pause(600);
      const row2 = page.locator('tr', { hasText: NAME }).first();
      await h.say('Opening stock is set. Purchases add to it, and every sale takes from it.', 600);
      await h.point(row2.locator('td', { has: page.locator('.opening-stock-btn') }), 2800);
      await h.say('To change a price later, use the edit button on the product.', 600);
      await h.point(row2.locator('button.btn-primary').first(), 2400);
    },
  },

  'paytm-recon': {
    title: 'Reconcile Paytm (digital reconciliation)',
    async run(h, page) {
      await h.go('/home');
      await h.begin();
      await h.say('Every day cashiers enter Paytm collections in the shift, and Paytm pays them into your bank.', 2800);
      await h.say('Reconciliation checks that every rupee collected was paid to you.', 2400);
      await h.say('Open Reports, then Digital Reconciliation.', 600);
      await h.tap(page.locator('.sidebar .menu-section-title', { hasText: /reports/i }).first(), 700);
      await h.tap('.sidebar a[href="/reports-digital-recon"]', 0);
      await page.waitForURL(/\/reports-digital-recon/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      await h.say('Choose the period and the digital vendor: here, last month and PAYTM.', 400);
      await h.pick('#dateRange', 'Last Month', 500);
      await h.pick('#company_id', 'PAYTM', 500);
      await h.say('Click Go.', 400);
      await h.tap('#goButton', 0);
      await page.waitForLoadState('networkidle');
      await page.locator('#creditstmt-table-container table').waitFor({ timeout: 60000 });
      await h.pause(800);

      await h.say('Debits are the Paytm sales from your shifts. Credits are Paytm payments into your bank.', 600);
      await h.point('#creditstmt-table-container table tbody tr >> nth=0', 3000);
      await h.say("PetroMath matches them for you: each day's sales with the next day's payment.", 600);
      await h.scrollBy(500, 1400);
      await h.say('Lines with the same Match ID belong together.', 2600);
      await h.top(500);

      // The page alerts and reloads after a manual match: catch the message, show it after the reload.
      const catchAlert = () => page.evaluate(() => {
        try { sessionStorage.removeItem('__valert'); } catch (e) { /* ignore */ }
        window.alert = (m) => { try { sessionStorage.setItem('__valert', m); } catch (e) { /* ignore */ } };
      });
      const showAlert = async (caption) => {
        await page.waitForLoadState('networkidle');
        await page.locator('#creditstmt-table-container table').waitFor({ timeout: 60000 });
        const msg = await page.evaluate(() => sessionStorage.getItem('__valert'));
        if (!msg) throw new Error('Manual match showed no message');
        await h.dialog(msg, caption, true);
      };
      const unreconciled = async () => {
        if (!(await page.isChecked('#showUnreconciled'))) await h.tap('#showUnreconciled', 1000);
        return page.locator('#creditstmt-table-container table tbody tr:visible');
      };

      await h.say('Tick Show Only Unreconciled to see what is left.', 500);
      let rows = await unreconciled();
      await h.say('Two days were paid together in one payment, so they could not match one-to-one.', 3000);
      await h.say('Select the two sales and the payment.', 400);
      for (const i of [2, 3, 4]) await h.tap(rows.nth(i).locator('.row-select'), 450);
      await h.say('The difference is zero.', 400);
      await h.point('#selected-summary', 1800);
      await h.say('Click Manual Match.', 400);
      await catchAlert();
      await Promise.all([page.waitForEvent('load', { timeout: 60000 }), h.tap(page.getByRole('button', { name: /Manual Match/ }), 0)]);
      await showAlert('Matched.');

      rows = await unreconciled();
      await h.say('One payment came ₹47 short of the sale.', 2400);
      await h.say('Select the sale and the payment.', 400);
      for (const i of [0, 1]) await h.tap(rows.nth(i).locator('.row-select'), 450);
      await h.point('#selected-summary', 1800);
      await h.say('Click Manual Match.', 400);
      await h.tap(page.getByRole('button', { name: /Manual Match/ }), 900);
      await page.locator('#differenceNotesModal.show').waitFor();
      await h.say('A difference needs a note: say why it is short.', 500);
      await h.type('#differenceNotes', 'Paytm refund of Rs 47 to a customer', 45);
      await h.say('Click Save & Match.', 400);
      await catchAlert();
      await Promise.all([page.waitForEvent('load', { timeout: 60000 }), h.tap('#saveDifferenceBtn', 0)]);
      await showAlert('Saved, with your note.');

      rows = await unreconciled();
      await h.say('Nothing left to reconcile for the month.', 2400);
      await h.tap('#showUnreconciled', 900);
      await h.say('Your manual matches keep their Match ID. The red ✕ next to it unmatches a group.', 600);
      await h.point(page.locator('#creditstmt-table-container button[title="Unmatch this group"]').first(), 2800);
      await h.say('Do this every month, for every digital vendor.', 2400);
    },
  },

  'shift-closing': {
    title: 'Enter and close a shift',
    async run(h, page) {
      const day = todayIST();
      await h.go('/home');
      await h.begin();
      await h.say('This is the Cashier Shift screen. Every shift is listed here.', 2600);
      await h.say('To start a new shift, click Add New.', 900);
      await h.tap(page.getByRole('button', { name: 'Add New' }), 0);
      await page.waitForURL(/\/new-closing/);
      await page.waitForLoadState('networkidle');
      await h.pause(600);

      // ── Closing ──
      await h.say('The shift has a tab for each part. Start with Closing.', 2400);
      await h.say('Choose the cashier for this shift.', 500);
      await h.pick('#cashierId', 'ARUN KUMAR');
      await h.say('The date is today. You can pick an earlier day if needed.', 500);
      await h.point('#cashierDate', 1600);
      await h.say('Enter the opening cash given to the cashier.', 500);
      await h.type('#cashGiven', '2000');
      await h.say("Today's selling rates are filled in from the last shift. Check them.", 600);
      await h.point('#gasoline-prices', 2400);
      await h.say('Click Next. PetroMath saves the shift as a draft.', 700);
      await h.next('#new_closing');

      // ── Attendance ──
      await h.say('Attendance: add everyone who worked this shift.', 800);
      await h.tap(page.locator('#new_attendance button', { hasText: 'Add' }).first(), 600);
      await h.pick('#attendance-personId-0', 'ARUN KUMAR', 400);
      await h.say('Choose the shift, then the in and out time.', 400);
      await h.pick('#attendance-shift-0', 'Morning', 300);
      await h.point('#attendance-INtime-0', 300);
      await page.fill('#attendance-INtime-0', `${day}T06:00`);
      await h.pause(500);
      await h.point('#attendance-OUTtime-0', 300);
      await page.fill('#attendance-OUTtime-0', `${day}T14:00`);
      await h.pause(700);
      await h.say('Click Add for each person.', 400);
      await h.tap(page.locator('#new_attendance button', { hasText: 'Add' }).first(), 500);
      await h.pick('#attendance-personId-1', 'SELVI M', 300);
      await h.pick('#attendance-shift-1', 'Morning', 300);
      await page.fill('#attendance-INtime-1', `${day}T06:00`);
      await page.fill('#attendance-OUTtime-1', `${day}T14:00`);
      await h.pause(800);
      await h.next('#new_attendance');

      // ── Reading ──
      await h.say('Reading: first choose the time the meter readings were taken.', 500);
      await h.pick('#closeReadingTime', '2:00 PM');
      await h.say('Click Add All Nozzles. Opening readings come from the last shift.', 600);
      await h.tap(page.getByRole('button', { name: 'Add All Nozzles' }), 1600);
      await h.say('Type the closing meter reading of each nozzle.', 500);
      const closing = { 'MS-1': '246155.700', 'MS-2': '188254.600', 'HSD-1': '414026.250', 'HSD-2': '299393.000', 'XP-1': '56386.700' };
      for (const [nozzle, reading] of Object.entries(closing)) {
        await h.type(`#f_${nozzle}pump_closing`, reading, 55);
        await page.keyboard.press('Tab');
        await h.pause(300);
        if (nozzle === 'MS-2') await h.say('Sale (litres) and Amount work themselves out.', 400);
      }
      await h.say('Enter testing litres, if any, so they are not counted as sale.', 500);
      await h.type('#f_MS-1pump_testing', '5');
      await page.keyboard.press('Tab');
      await h.point('#f_MS-1pump_sale', 1800);
      await h.next('#new_readings');

      // ── Lube Sales ──
      await h.say('Lube Sales: oils and other products sold for cash.', 600);
      await h.tap(page.getByRole('button', { name: 'Add Lube Sales' }), 500);
      await h.pick('#cash-sale-product-0', 'ENGINE OIL 4T 1 LTR', 400);
      await h.say('Pick the product and enter the quantity. The price comes from the product list.', 400);
      await h.type('#cash-sale-qty-0', '2');
      await page.keyboard.press('Tab');
      await h.pause(1200);
      await h.next('#new_cash_sales');

      // ── Credit Sales ──
      await h.say('Credit Sales: one entry for each credit bill.', 600);
      await h.tap(page.getByRole('button', { name: 'Add credits' }), 900);
      await h.say('Enter the product, bill number, company and vehicle.', 300);
      await h.pick('#credit-product-0', 'HSD', 300);
      await h.type('#credit-billno-0', '1201');
      await h.pick('#credit-creditparty-0', 'SRI LAKSHMI TRANSPORTS', 500);
      await h.tap(page.locator('#credit-vehicle-0 + .select2 .select2-selection'), 400);
      await page.locator('.select2-search__field').pressSequentially('1234', { delay: 90 });
      await h.pause(500);
      await page.keyboard.press('Enter');
      await h.pause(600);
      await h.say('Enter the quantity in litres. The amount is calculated.', 300);
      await h.type('#credit-qty-0', '120');
      await page.keyboard.press('Tab');
      await h.pause(800);
      await h.tap(page.locator('.modal.show').getByRole('button', { name: 'Save' }), 1200);
      await h.say('The bill is added to the list. Add the next bill the same way.', 2400);
      await h.next('#new_credit_sales');

      // ── Digital Sales ──
      await h.say('Digital Sales: UPI, card and fleet card payments.', 600);
      await h.tap(page.getByRole('button', { name: 'Add Digital Sales' }), 500);
      await h.pick('#digital-sales-vendor-0', 'PAYTM', 300);
      await h.type('#digital-sales-amt-0', '18450');
      await page.keyboard.press('Tab');
      await h.tap(page.getByRole('button', { name: 'Add Digital Sales' }), 500);
      await h.pick('#digital-sales-vendor-1', 'CARD SWIPE', 300);
      await h.type('#digital-sales-amt-1', '6200');
      await page.keyboard.press('Tab');
      await h.say('The total is shown below the list.', 1600);
      await h.next('#new_digital_sales');

      // ── Expenses ──
      await h.say('Expenses: money paid out of the cash during the shift.', 600);
      await h.tap(page.getByRole('button', { name: 'Add new expense' }), 500);
      await h.pick('#exp-expense-0', 'Tea', 400);
      await h.say('The usual amount is filled in. Change it if needed.', 1800);
      await h.next('#new_expenses');

      // ── Cash Count ──
      // The draft is saved by now, so the DB knows how much cash the shift should hand over.
      const closingId = await page.inputValue('#closing_hiddenId');
      const db = await betaDb();
      const [[{ x }]] = await db.query('SELECT calculate_exshortage(?) AS x', [closingId]);
      await db.end();
      const notes = cashInNotes(Math.max(0, Math.floor(-Number(x))));
      await h.say('Cash Count: count the cash being handed over.', 600);
      await h.say('Enter how many of each note and coin.', 300);
      for (const [n, cnt] of Object.entries(notes).sort((a, b) => b[0] - a[0])) {
        if (!cnt) continue;
        await h.type(`#denom-${n}-cnt`, String(cnt), 90);
        await page.keyboard.press('Tab');
        await h.pause(200);
      }
      await h.say('The total is worked out for you.', 400);
      await h.point('#denominations_total', 1600);
      await h.next('#new_denoms');

      // ── Summary and Close ──
      await h.top(300);
      await h.say('Summary: the whole shift on one page. Check it before closing.', 2600);
      await h.say('Excess / Shortage compares the cash counted with what was due.', 600);
      await h.point('#excess_storage', 2600);
      await h.scrollBy(420, 1400);
      await h.say('Sales, credit, digital, expenses and cash, all in one place.', 2200);
      await h.scrollBy(900, 1400);
      await h.say('When everything is right, click CLOSE.', 600);
      const close = page.getByRole('button', { name: /CLOSE/ });
      await h.tap(close, 300, { noClick: true });
      await page.evaluate(() => window.__vConfirm('Please confirm if you want to freeze the closing?', location.host.replace(/^beta\./, '')));
      await h.say('Confirm with OK. A closed shift can no longer be edited.', 1600);
      await h.tap('#__vconfirm button.ok', 300, { noClick: true });
      await page.evaluate(() => { document.getElementById('__vconfirm').remove(); window.confirm = () => true; });
      await close.click();
      await page.waitForURL(/\/home/, { timeout: 30000 });
      await page.waitForLoadState('networkidle');
      await h.pause(600);
      await h.say('Done. The shift is listed as Closed, with its shortage or excess.', 600);
      await h.point(page.locator('tr', { hasText: 'ARUN KUMAR' }).first(), 2400);
      await h.say("Its closing readings become the next shift's opening readings.", 3000);
      await h.say('PetroMath: every shift, accounted for.', 2200);
    },
  },
};

// Screencast frames -> MP4. Chrome sends a frame only when the screen changes, so each frame is held until the next one.
function toMp4(dir, frames, mp4, marks, total) {
  const list = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : total;
    list.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(3)}`);
  });
  list.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(dir, 'frames.txt'), list.join('\n'));
  const start = Math.max(0, marks.start - frames[0].t);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'),
    '-vf', `fps=30,trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS,scale=${VIEW.width}:-2:flags=lanczos,setsar=1`, '-r', '30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  // Poster frame for the Help page (shown before playing).
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '6', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-2',
    '-q:v', '4', mp4.replace(/\.mp4$/, '.jpg')]);
}

async function record(browser, name) {
  const v = VIDEOS[name];
  const ctxOpts = { viewport: VIEW, deviceScaleFactor: SCALE, locale: 'en-IN', timezoneId: 'Asia/Kolkata', acceptDownloads: true };

  // Sign in outside the recording.
  const login = await browser.newContext(ctxOpts);
  const lp = await login.newPage();
  await lp.goto(`${BASE}/login`);
  await lp.fill('#username', v.user === 'admin' ? process.env.DEMO_ADMIN_USER : process.env.DEMO_USER);
  await lp.fill('#pw', process.env.DEMO_PASSWORD);
  await Promise.all([lp.waitForNavigation(), lp.click('button[type=submit]')]);
  if (lp.url().includes('/login')) throw new Error('Demo sign-in failed. Run node demo-location.js first.');
  const state = await login.storageState();
  await login.close();

  const ctx = await browser.newContext({ ...ctxOpts, storageState: state });
  await ctx.addInitScript(overlayScript);
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { console.log(`  ${d.type()}: ${d.message()}`); await d.accept(); });
  page.on('pageerror', (e) => console.log('  page error:', e.message));

  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: (Date.now() - t0) / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 90, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE,
  });
  const h = makeHelpers(page, t0);
  let ok = false;
  try {
    await v.run(h, page);
    await h.pause(500);
    ok = true;
  } finally {
    const total = (Date.now() - t0) / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!ok) await page.screenshot({ path: path.join(OUT, `${name}-failed.png`) }).catch(() => {});
    await ctx.close();
    if (ok && frames.length) {
      const mp4 = path.join(PUBLIC, `${name}.mp4`);
      toMp4(dir, frames, mp4, h.marks, total);
      const kb = Math.round(fs.statSync(mp4).size / 1024);
      console.log(`${name}: ${mp4} (${kb} KB, ${Math.round(total - h.marks.start)} s, ${frames.length} frames)`);
    }
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--list') {
    Object.entries(VIDEOS).forEach(([k, v]) => console.log(`${k}  ${v.title}`));
    return;
  }
  for (const a of args) if (!VIDEOS[a]) throw new Error(`Unknown video: ${a}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const a of args) await record(browser, a);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
