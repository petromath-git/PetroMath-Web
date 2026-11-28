// Thumbnail (poster) for each Help video: a title card with the topic number and title in the video's language,
// PetroMath's icon, the length, and a screen from the video. Writes public/videos/<name>[.<lang>].jpg, the poster
// the Help page shows before a video plays.
//   node thumbnails.js                 every video, every language that has a recording
//   node thumbnails.js day-close intro just these
// record.js calls this after each recording too.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const PUBLIC = path.join(__dirname, '..', '..', 'public', 'videos');
const ICON = path.join(__dirname, '..', '..', 'public', 'images', 'app-icons', 'icon-512.png');
const LANGS = ['en', 'ta', 'hi'];

// Help-page number (same order as views/help.pug), the screen shown (fraction of the video), and titles.
const THUMBS = {
  'getting-started': { n: 1, at: 0.45, en: 'Getting started: fill in your bunk details', ta: 'தொடக்கம்: உங்க பங்க் details போடுங்க', hi: 'शुरुआत: अपने पंप की details भरें' },
  intro: { n: 2, at: 0.2, en: 'A quick tour of PetroMath', ta: 'PetroMath ஒரு சின்ன tour', hi: 'PetroMath का छोटा सा tour' },
  'phone-app': { n: 3, at: 0.75, phone: true, en: 'Install PetroMath on your phone', ta: 'உங்க phone-ல PetroMath install பண்ணுங்க', hi: 'अपने phone पर PetroMath install करें' },
  'add-user': { n: 4, at: 0.55, en: 'Add staff logins: Admin, Manager and Cashier', ta: 'Staff login சேர்க்கிறது: Admin, Manager, Cashier', hi: 'Staff के login जोड़ें: Admin, Manager और Cashier' },
  'add-product': { n: 5, at: 0.35, en: 'Add a product, with opening stock', ta: 'Product சேர்க்கிறது, opening stock-ஓட', hi: 'Product जोड़ें, opening stock के साथ' },
  'add-customer': { n: 6, at: 0.35, en: 'Add a credit customer, with opening balance and login', ta: 'Credit customer சேர்க்கிறது: opening balance, login', hi: 'Credit customer जोड़ें: opening balance और login' },
  'shift-closing': { n: 7, at: 0.3, en: 'Enter and close a shift', ta: 'Shift entry பண்ணி close பண்றது', hi: 'Shift भरें और close करें' },
  'day-close': { n: 8, at: 0.25, en: 'Close the day, and read the Day-Close Report', ta: 'Day Close பண்றது, Day-Close Report படிக்கிறது', hi: 'दिन close करें, Day-Close Report पढ़ें' },
  'fuel-invoice': { n: 9, at: 0.6, en: 'Upload a fuel (tanker) invoice PDF', ta: 'Fuel (tanker) invoice PDF upload பண்றது', hi: 'Fuel (tanker) invoice PDF upload करें' },
  'lube-invoice': { n: 10, at: 0.5, en: 'Upload a lube purchase invoice PDF', ta: 'Lube purchase invoice PDF upload பண்றது', hi: 'Lube purchase invoice PDF upload करें' },
  'bank-upload': { n: 11, at: 0.45, en: 'Upload a bank statement', ta: 'Bank statement upload பண்றது', hi: 'Bank statement upload करें' },
  'sap-upload': { n: 12, at: 0.45, en: 'Upload the oil company (SAP) statement', ta: 'Oil company (SAP) statement upload பண்றது', hi: 'Oil company (SAP) statement upload करें' },
  'paytm-recon': { n: 13, at: 0.3, en: 'Reconcile Paytm', ta: 'Paytm reconcile பண்றது', hi: 'Paytm reconcile करें' },
  'customer-statement': { n: 14, at: 0.55, en: "Run a customer's credit statement", ta: 'Customer credit statement எடுக்கிறது', hi: 'Customer का credit statement निकालें' },
  'customer-phone': { n: 15, at: 0.4, phone: true, en: 'Your customer sees their statement on their phone', ta: 'Customer தன் statement-ஐ phone-ல பார்க்கலாம்', hi: 'Customer अपना statement phone पर देखें' },
  accounting: { n: 16, at: 0.6, en: 'Create the accounts and read the Profit & Loss', ta: 'Accounts உருவாக்கி, Profit & Loss பார்க்கிறது', hi: 'Accounts बनाएँ, Profit & Loss देखें' },
};
const WORDS = {
  en: { how: 'How-to video', start: 'Start here', lang: 'English' },
  ta: { how: 'எப்படி செய்வது', start: 'இங்க தொடங்குங்க', lang: 'தமிழ்' },
  hi: { how: 'कैसे करें', start: 'यहाँ से शुरू करें', lang: 'हिन्दी' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

// Length of a video in seconds (ffmpeg prints it when given no output, and exits 1).
function duration(mp4) {
  let info = '';
  try { execFileSync(ffmpeg, ['-i', mp4], { stdio: 'pipe' }); } catch (e) { info = String(e.stderr); }
  const m = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// One frame of the video, cropped above the caption bar.
function frame(mp4, at, phone, out) {
  const t = Math.max(1, duration(mp4) * at).toFixed(2);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', t, '-i', mp4, '-frames:v', '1', '-vf', 'crop=iw:ih*0.80:0:0', out]);
  return out;
}

function html(t, lang, shot, secs, phone) {
  const w = WORDS[lang];
  const len = `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  const badge = t.n ? `${esc(w.how)} &nbsp;${t.n}` : esc(w.start);
  const title = esc(t[lang]);
  const css = `
    * { box-sizing: border-box; margin: 0; }
    body { width: ${phone ? 720 : 1280}px; height: ${phone ? 1504 : 720}px; overflow: hidden;
      font-family: "Segoe UI", "Nirmala UI", "Noto Sans Tamil", "Noto Sans Devanagari", system-ui, sans-serif;
      background: radial-gradient(circle at 15% 10%, #1e293b 0%, #0f172a 55%, #0b1120 100%); color: #fff; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand img { width: 64px; height: 64px; border-radius: 14px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    .brand b { font-size: 34px; font-weight: 700; letter-spacing: .3px; }
    .badge { display: inline-block; background: #facc15; color: #111827; font-weight: 700; font-size: 26px;
      padding: 6px 18px; border-radius: 999px; }
    h1 { font-weight: 700; line-height: 1.22; }
    .meta { display: flex; align-items: center; gap: 14px; font-size: 24px; color: #cbd5e1; }
    .play { width: 64px; height: 64px; border-radius: 50%; background: #facc15; display: flex; align-items: center;
      justify-content: center; box-shadow: 0 4px 18px rgba(250,204,21,.35); }
    .play::after { content: ''; border-left: 22px solid #111827; border-top: 14px solid transparent;
      border-bottom: 14px solid transparent; margin-left: 6px; }
    .chip { border: 2px solid #475569; border-radius: 8px; padding: 2px 12px; }
    .shot { border-radius: 14px; overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.55); border: 3px solid #334155; background: #fff; }
    .shot img { display: block; width: 100%; }`;
  const layout = phone ? `
    .wrap { padding: 56px 56px 0; display: flex; flex-direction: column; gap: 26px; height: 100%; }
    h1 { font-size: ${title.length > 40 ? 50 : 56}px; }
    .shot { width: 500px; height: 840px; margin: 20px auto 0; border-radius: 34px; border: 10px solid #1f2937; }
    .shot img { object-fit: cover; object-position: top; height: 100%; }` : `
    .wrap { display: grid; grid-template-columns: 560px 1fr; gap: 40px; padding: 56px 0 56px 60px; height: 100%; }
    .left { display: flex; flex-direction: column; gap: 28px; justify-content: center; }
    h1 { font-size: ${title.length > 42 ? 46 : title.length > 28 ? 54 : 62}px; }
    .shot { align-self: center; width: 760px; transform: perspective(1400px) rotateY(-9deg); transform-origin: left center; }`;
  const text = `
      <div class="brand"><img src="${dataUri(ICON, 'image/png')}"><b>PetroMath</b></div>
      <div><span class="badge">${badge}</span></div>
      <h1>${title}</h1>
      <div class="meta"><span class="play"></span><span>${len}</span><span class="chip">${esc(w.lang)}</span></div>`;
  const pic = `<div class="shot"><img src="${dataUri(shot, 'image/png')}"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}${layout}</style></head><body>
    <div class="wrap">${phone ? text + pic : `<div class="left">${text}</div>${pic}`}</div></body></html>`;
}

// Makes the thumbnails of the given videos (all when empty), with an open Playwright browser.
async function makeThumbnails(browser, names) {
  const tmp = path.join(__dirname, 'out', 'thumbs');
  fs.mkdirSync(tmp, { recursive: true });
  const made = [];
  for (const name of names.length ? names : Object.keys(THUMBS)) {
    const t = THUMBS[name];
    if (!t) { console.log(`thumbnail: no title for ${name}, kept the plain poster`); continue; }
    for (const lang of LANGS) {
      const base = lang === 'en' ? name : `${name}.${lang}`;
      const mp4 = path.join(PUBLIC, `${base}.mp4`);
      if (!fs.existsSync(mp4)) continue;
      const shot = frame(mp4, t.at, t.phone, path.join(tmp, `${base}.png`));
      // Same shape as the video, so the poster fills the player (phone videos are 720x1504).
      const page = await browser.newPage({ viewport: t.phone ? { width: 720, height: 1504 } : { width: 1280, height: 720 } });
      await page.setContent(html(t, lang, shot, duration(mp4), t.phone), { waitUntil: 'load' });
      const jpg = path.join(PUBLIC, `${base}.jpg`);
      await page.screenshot({ path: jpg, type: 'jpeg', quality: 82 });
      await page.close();
      made.push(jpg);
    }
  }
  return made;
}

module.exports = { makeThumbnails };

if (require.main === module) {
  (async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    try {
      const made = await makeThumbnails(browser, process.argv.slice(2));
      made.forEach((f) => console.log(`thumbnail: ${path.basename(f)} (${Math.round(fs.statSync(f).size / 1024)} KB)`));
    } finally {
      await browser.close();
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
