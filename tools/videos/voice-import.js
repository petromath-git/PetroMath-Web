// Use a voice made by hand on the ElevenLabs website (one paste per video, lines separated by blank lines) as the
// video's voiceover. Splits the download into one clip per caption and installs them in out/voice/<lang>/manual/,
// where record.js --lang=<lang> picks them up instead of generated clips.
//
//   node voice-import.js text <video>                      print the paste text for a video
//   node voice-import.js check <file.mp3>                  speech-to-text, grouped by pauses (finds skipped lines)
//   node voice-import.js split <video> <file.mp3>          split a whole-video download into its lines
//   node voice-import.js line <video> <n> <file.mp3>       install one line generated on its own (1 = first)
// Options: --lang=ta (default). `check` needs Speech to Text allowed on ELEVENLABS_API_KEY (.env).
//
// The split picks, from the pauses in the audio, the set whose segment lengths best fit each line's length (the
// voice pauses about as long inside a line as between lines, so the longest pauses alone are not enough). The
// voice sometimes skips a line in a long paste: run `check`, then regenerate that line alone and use `line`.
require('dotenv').config({ path: `${__dirname}/.env` });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LANG = (process.argv.find((a) => a.startsWith('--lang=')) || '--lang=ta').slice(7);
const SCRIPT = JSON.parse(fs.readFileSync(path.join(__dirname, 'voice', `${LANG}.json`), 'utf8'));
const MANUAL = path.join(__dirname, 'out', 'voice', LANG, 'manual');
const caption = (k) => (typeof SCRIPT[k] === 'string' ? SCRIPT[k] : SCRIPT[k].show);

// The video's captions in the order it says them: the lines under its "_video <name>" key in voice/<lang>.json
// (keep that order the same as the video's; captions often come from shared helpers, so the code can't tell).
function linesOf(video) {
  const keys = Object.keys(SCRIPT);
  const at = keys.indexOf(`_video ${video}`);
  if (at < 0) throw new Error(`No "_video ${video}" section in voice/${LANG}.json`);
  const end = keys.findIndex((k, i) => i > at && k.startsWith('_video '));
  return keys.slice(at + 1, end < 0 ? keys.length : end).filter((k) => !k.startsWith('_'));
}

const install = (k, run) => {
  fs.mkdirSync(MANUAL, { recursive: true });
  const f = path.join(MANUAL, `${crypto.createHash('sha1').update(caption(k)).digest('hex').slice(0, 16)}.mp3`);
  run(f);
  return f;
};
const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05';

function split(video, input) {
  const keys = linesOf(video);
  const lines = keys.map(caption);
  const err = spawnSync(ffmpeg, ['-hide_banner', '-i', input, '-af', 'silencedetect=n=-35dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const total = +m[1] * 3600 + +m[2] * 60 + +m[3];
  const gaps = [];
  let s = null;
  for (const l of err.split('\n')) {
    let x = l.match(/silence_start: ([\d.]+)/); if (x) s = +x[1];
    x = l.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/); if (x) gaps.push({ a: s, b: +x[1], d: +x[2] });
  }
  const first = gaps[0] && gaps[0].a < 0.05 ? gaps.shift().b : 0;
  const last = gaps.length && Math.abs(gaps[gaps.length - 1].b - total) < 0.1 ? gaps.pop().a : total;
  const w = lines.map((t) => t.replace(/\s+/g, ' ').length);
  const n = lines.length;
  const G = gaps.length;
  if (G < n - 1) throw new Error(`Only ${G} pauses for ${n} lines: is this the right file?`);
  const rate = (last - first - gaps.reduce((x, g) => x + g.d, 0) * 0.5) / w.reduce((x, y) => x + y, 0);
  const cost = (i, a, b) => Math.log((b - a) / (w[i] * rate)) ** 2;
  const bonus = (g) => -0.6 * g.d; // breaks between lines tend to be a little longer
  const dp = Array.from({ length: n - 1 }, () => Array(G).fill(Infinity));
  const from = Array.from({ length: n - 1 }, () => Array(G).fill(-1));
  for (let j = 0; j < G; j++) dp[0][j] = cost(0, first, gaps[j].a) + bonus(gaps[j]);
  for (let i = 1; i < n - 1; i++) {
    for (let j = i; j < G; j++) {
      for (let k = i - 1; k < j; k++) {
        const c = dp[i - 1][k] + cost(i, gaps[k].b, gaps[j].a) + bonus(gaps[j]);
        if (c < dp[i][j]) { dp[i][j] = c; from[i][j] = k; }
      }
    }
  }
  let bj = -1;
  let best = Infinity;
  for (let j = n - 2; j < G; j++) {
    const c = dp[n - 2][j] + cost(n - 1, gaps[j].b, last);
    if (c < best) { best = c; bj = j; }
  }
  const cuts = [];
  for (let i = n - 2, j = bj; i >= 0; j = from[i][j], i--) cuts.unshift(gaps[j]);
  const bounds = [first, ...cuts.flatMap((g) => [g.a, g.b]), last];
  const rows = keys.map((k, i) => {
    const a = Math.max(0, bounds[2 * i] - 0.03);
    const b = bounds[2 * i + 1] + 0.05;
    install(k, (f) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', input, '-ss', a.toFixed(3), '-to', b.toFixed(3), '-ac', '1', '-b:a', '96k', f]));
    const ratio = (b - a) / (w[i] * rate);
    return { line: i + 1, from: +a.toFixed(2), sec: +(b - a).toFixed(2), fit: ratio < 0.7 || ratio > 1.4 ? 'CHECK' : 'ok', text: lines[i].slice(0, 40) };
  });
  console.table(rows);
  console.log('Installed. A CHECK row may be a skipped or merged line: run `check` on the file to see what was said.');
}

async function check(input) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY missing in .env');
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('language_code', LANG);
  form.append('timestamps_granularity', 'word');
  form.append('file', new Blob([fs.readFileSync(input)], { type: 'audio/mpeg' }), path.basename(input));
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${JSON.stringify(j.detail || j).slice(0, 300)}`);
  const ws = j.words.filter((x) => x.type === 'word');
  let line = [];
  let t0 = null;
  ws.forEach((x, i) => {
    if (t0 === null) t0 = x.start;
    line.push(x.text);
    if (!ws[i + 1] || ws[i + 1].start - x.end > 0.3) { console.log(t0.toFixed(1).padStart(6), line.join(' ')); line = []; t0 = null; }
  });
}

(async () => {
  const [cmd, a, b, c] = args;
  if (cmd === 'text') console.log(linesOf(a).map(caption).join('\n\n'));
  else if (cmd === 'split') split(a, b);
  else if (cmd === 'check') await check(a);
  else if (cmd === 'line') {
    const k = linesOf(a)[+b - 1];
    if (!k) throw new Error(`${a} has no line ${b}`);
    install(k, (f) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', c, '-af', `${trim},areverse,${trim},areverse`, '-ac', '1', '-b:a', '96k', f]));
    console.log(`Installed line ${b}: ${caption(k)}`);
  } else console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 13).join('\n'));
})().catch((e) => { console.error(e.message); process.exit(1); });
