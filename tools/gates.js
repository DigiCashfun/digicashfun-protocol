'use strict';
// Gate suite. `npm run build` first, then `npm run gates`. Exit code 0 only if every gate passes.
//
// Branch gates run against three outputs: the real dist/, a build with every mint/social record forced to
// `stated`, and a build with every one forced to `absent`. The mutation harness reads the live state of each
// record at run time and flips it, so no anchor depends on what the register currently says.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, readImage, pixelAt, hex } = require('./pixels');
const { PNG } = require('pngjs');
const R = require('./render');
const B = require('./build');

const DIST = path.join(ROOT, 'dist');
const TMP = path.join(ROOT, '.tmp');
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ───────── helpers ───────── */
const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  let n = BigInt('0x' + buf.toString('hex')), s = '';
  while (n > 0n) { s = B58_ALPHA[Number(n % 58n)] + s; n /= 58n; }
  return s;
}
const TEST_MINT = b58(crypto.createHash('sha256').update('digicash-gate-fixture').digest()).padStart(44, '1').slice(0, 44);
const TEST_URL = { x: 'https://x.com/digicashtest', github: 'https://github.com/digicashtest' };
const B58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_RE = /\b0x[0-9a-fA-F]{40}\b/g;
const ENT = { '&nbsp;': ' ', '&mdash;': '—', '&middot;': '·', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' };

function visibleText(html, { keepSlot = true } = {}) {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  if (!keepSlot) h = h.replace(/<div class="ca-addr"[^>]*>[\s\S]*?<\/div>/g, ' ');
  const attrs = [...h.matchAll(/\s(?:aria-label|title|alt|placeholder|content|value)="([^"]*)"/g)].map((m) => m[1]);
  const text = h.replace(/<[^>]+>/g, ' ');
  return (text + ' ' + attrs.join(' ')).replace(/&[a-z]+;/g, (e) => ENT[e] || ' ').replace(/\s+/g, ' ');
}
function loadCtx(dir, reg) {
  const html = read(path.join(dir, 'index.html'));
  return { dir, reg, html, css: read(path.join(dir, 'assets/styles.css')), js: read(path.join(dir, 'assets/app.js')) };
}
function forceStates(reg, state) {
  const r = clone(reg);
  for (const id of ['ca', 'x', 'github']) {
    const rec = r.records.find((q) => q.id === id);
    delete rec.value; delete rec.url;
    rec.state = state;
    if (state === 'stated') { if (id === 'ca') rec.value = TEST_MINT; else rec.url = TEST_URL[id]; }
  }
  return r;
}
// Flip one record to whatever it is not right now.
function flipRecord(reg, id) {
  const r = clone(reg);
  const rec = r.records.find((q) => q.id === id);
  if (rec.state === 'stated') { delete rec.value; delete rec.url; rec.state = 'absent'; }
  else { rec.state = 'stated'; if (id === 'ca') rec.value = TEST_MINT; else rec.url = TEST_URL[id]; }
  return r;
}
function buildTo(name, reg) {
  const out = path.join(TMP, name);
  B.build({ register: reg, outDir: out, reuseImagesFrom: DIST });
  return loadCtx(out, reg);
}

/* ───────── pure checkers: each returns a list of problems ───────── */
const INERT_KEYS = new Set(['id', 'label', 'state', 'source', 'scope', 'recorded']);
function checkRegister(reg) {
  const p = [];
  const need = ['ca', 'x', 'github', 'chain', 'market-source'];
  const ids = reg.records.map((r) => r.id);
  need.forEach((id) => { if (!ids.includes(id)) p.push('missing record ' + id); });
  if (new Set(ids).size !== ids.length) p.push('duplicate record id');
  for (const r of reg.records) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) p.push(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      Object.keys(r).filter((k) => !INERT_KEYS.has(k)).forEach((k) => p.push(`${r.id}: inert record carries ${k}`));
    } else if (!r.value && !r.url) p.push(`${r.id}: stated record has neither value nor url`);
    if (r.id === 'ca' && r.state === 'stated' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.value || '')) p.push('ca: not a Solana base58 address');
    if ((r.id === 'x' || r.id === 'github') && r.state === 'stated' && !/^https:\/\/(x\.com|github\.com)\/[\w.-]+\/?$/.test(r.url || '')) p.push(`${r.id}: url does not look like a profile url`);
    if (r.id === 'chain' && r.state === 'stated' && (!r.rpc || r.value !== 'Solana' || !r.source || !r.scope)) p.push('chain: needs value Solana, rpc, source, scope');
    if (r.id === 'chain' && r.rpc && r.rpc !== 'https://solana-rpc.publicnode.com') p.push('chain: rpc differs from the statement');
    if (r.id === 'market-source' && r.state === 'stated') {
      if (r.url !== 'https://api.dexscreener.com/token-boosts/top/v1') p.push('market-source: url differs from the statement');
      if (r.pairsUrl !== 'https://api.dexscreener.com/tokens/v1/solana/{addresses}') p.push('market-source: pairsUrl differs from the statement');
    }
  }
  return p;
}

const MONTHS = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_RES = [
  [/\b(19|20)\d{2}\b/, 'year'],
  [/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/, 'numeric date'],
  [new RegExp('\\b' + MONTHS + '\\s+\\d{1,2}\\b', 'i'), 'month day'],
  [new RegExp('\\b\\d{1,2}\\s+' + MONTHS + '\\b', 'i'), 'day month'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/i, 'clock'],
  [/\b(as of|checked|updated|last seen|timestamp|ago|today|yesterday)\b/i, 'time word'],
];
function checkNoDates(ctx) {
  const t = visibleText(ctx.html);
  const p = DATE_RES.filter(([re]) => re.test(t)).map(([, n]) => 'visible ' + n + ' in page text');
  if (/\b(toLocale(Time|Date)String|toISOString|toUTCString|getHours|getMinutes|DateTimeFormat|new Date)\b/.test(ctx.js)) p.push('script renders time');
  if (/"recorded"/.test(ctx.html)) p.push('register dates leaked into page');
  return p;
}
function checkAddressScan(ctx, reg = ctx.reg) {
  const known = new Set(reg.records.filter((r) => r.state === 'stated').flatMap((r) => [r.value, r.url, r.rpc].filter(Boolean)));
  const t = visibleText(ctx.html, { keepSlot: false });
  const hits = [...(t.match(B58_RE) || []), ...(t.match(EVM_RE) || [])];
  return hits.filter((a) => ![...known].some((k) => k.includes(a))).map((a) => 'unregistered address-shaped string ' + a.slice(0, 10) + '...');
}
function checkSocials(ctx) {
  const p = [];
  const nav = (ctx.html.match(/<nav class="socials"[\s\S]*?<\/nav>/) || [''])[0];
  if (!nav) return ['socials nav missing'];
  for (const id of ['x', 'github']) {
    const r = R.rec(ctx.reg, id);
    const m = nav.match(new RegExp(`<(a|span) class="soc" data-social="${id}"[^>]*>[\\s\\S]*?</\\1>`));
    if (!m) { p.push(id + ' icon missing'); continue; }
    const el = m[0];
    const path_ = id === 'x' ? R.X_PATH : R.GH_PATH;
    if (!el.includes(path_)) p.push(id + ' icon is not the official mark');
    if (R.stated(r)) {
      if (!el.includes(`href="${r.url}"`)) p.push(id + ' stated but href missing');
      if (!el.includes(R.deriveHandle(r.url))) p.push(id + ' handle not derived from url');
    } else {
      if (/href=/.test(el)) p.push(id + ' inert but has href');
      if (!/aria-disabled="true"/.test(el)) p.push(id + ' inert but not marked disabled');
      if (/<a\b/.test(el)) p.push(id + ' inert but is an anchor');
    }
    if (el.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim()) p.push(id + ' icon carries a text label');
  }
  return p;
}
function checkCaSlot(ctx) {
  const p = [];
  const r = R.rec(ctx.reg, 'ca');
  const slot = (ctx.html.match(/<div class="ca-addr"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  if (slot === undefined) return ['ca slot missing'];
  const btn = (ctx.html.match(/<button class="btn btn-copy" id="copy"[^>]*>/) || [''])[0];
  if (R.stated(r)) {
    if (slot.trim() !== r.value) p.push('stated: slot is not the full address');
    if (/disabled/.test(btn)) p.push('stated: copy button disabled');
    if (/…|\.\.\./.test(slot)) p.push('stated: address truncated');
  } else {
    if (!/pending/.test(slot) || slot.replace(/<[^>]+>/g, '').trim() !== 'pending') p.push('inert: slot must read pending only');
    if (!/disabled/.test(btn)) p.push('inert: copy button must be disabled');
    if ((slot.match(B58_RE) || []).length || (slot.match(EVM_RE) || []).length) p.push('inert: slot carries an address');
  }
  const headPos = ctx.html.indexOf('id="ca"'), mainPos = ctx.html.indexOf('<main');
  if (headPos < 0 || headPos > mainPos) p.push('slot is not above the main content');
  if (!/\.top\s*\{[^}]*position:\s*sticky/.test(ctx.css)) p.push('top block is not sticky');
  const fs_ = /\.ca-addr\s*\{[^}]*font-size:\s*clamp\((\d+)px/.exec(ctx.css);
  if (!fs_ || Number(fs_[1]) < 20) p.push('slot font is not large');
  return p;
}
function checkLinks(ctx) {
  const p = [];
  const hrefs = [...ctx.html.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
  hrefs.forEach((h) => { if (h === '' || h === '#') p.push('empty href'); });
  const allowed = new Set(ctx.reg.records.filter((r) => r.state === 'stated' && r.url).map((r) => r.url));
  hrefs.filter((h) => /^https?:/.test(h)).forEach((h) => {
    const derived = R.stated(R.rec(ctx.reg, 'ca')) && h === 'https://dexscreener.com/solana/' + R.rec(ctx.reg, 'ca').value;
    if (!allowed.has(h) && !derived) p.push('link not backed by a stated record: ' + h);
  });
  if (/<(span|button|div)\b[^>]*\shref=/.test(ctx.html)) p.push('href on a non-anchor');
  if (/(x\.com|twitter\.com|github\.com)\//.test(visibleText(ctx.html)) ) p.push('profile url shown as text');
  ['x', 'github'].forEach((id) => { if (!R.stated(R.rec(ctx.reg, id)) && new RegExp(id === 'x' ? 'x\\.com|twitter\\.com' : 'github\\.com').test(ctx.html.replace(/<path[^>]*>/g, ''))) p.push(id + ' unstated but a url exists in the page'); });
  return p;
}
function checkInertNoValue(ctx) {
  const p = [];
  for (const r of ctx.reg.records) {
    if (r.state === 'stated') continue;
    const m = ctx.html.match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/);
    const pub = JSON.parse(m[1].replace(/\\u003c/g, '<')).records.find((q) => q.id === r.id);
    if (!pub) { p.push(r.id + ' missing from page register'); continue; }
    if ('value' in pub || 'url' in pub) p.push(r.id + ' inert record carries value or url in page');
  }
  return p;
}

/* ───────── gate table ───────── */
const gates = [];
const gate = (name, fn, { branches = false } = {}) => gates.push({ name, fn, branches });

gate('dist layout and hygiene of dist contents', () => {
  const p = [];
  ['index.html', 'favicon.svg', 'assets/styles.css', 'assets/app.js', 'assets/logo.png', 'assets/logo-96.png', 'assets/logo-192.png'].forEach((f) => { if (!exists(path.join(DIST, f))) p.push('missing dist/' + f); });
  ['README.md', 'LICENSE', 'docs', 'CLAUDE.md', '.claude', 'package.json', 'src', 'tools'].forEach((f) => { if (exists(path.join(DIST, f))) p.push('dist must not contain ' + f); });
  return p;
});
gate('every local reference in index.html resolves inside dist', () => {
  const html = read(path.join(DIST, 'index.html'));
  const p = [];
  [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|#|data:|mailto:)/.test(u)).forEach((u) => {
    if (u.startsWith('/')) p.push('absolute path ' + u);
    else if (!exists(path.join(DIST, u))) p.push('unresolved ' + u);
  });
  return p;
});
gate('logo is explicitly in dist and referenced with the right relative path', () => {
  const html = read(path.join(DIST, 'index.html'));
  const p = [];
  if (!/<img class="coin" src="assets\/logo\.png"/.test(html)) p.push('hero img does not reference assets/logo.png');
  if (!/<img src="assets\/logo-96\.png"/.test(html)) p.push('header img does not reference assets/logo-96.png');
  if (!/href="assets\/logo-192\.png"/.test(html)) p.push('touch icon not referenced');
  if (!/rel="icon" type="image\/svg\+xml" href="favicon\.svg"/.test(html)) p.push('favicon not referenced');
  if (!/express|\bcopyFileSync|PNG\.sync\.write/.test(read(path.join(ROOT, 'tools/build.js')))) p.push('build script does not write the logo');
  return p;
});
gate('logo png: RGBA, transparent field, no dark fringe from premultiplication', () => {
  const buf = fs.readFileSync(path.join(DIST, 'assets/logo.png'));
  const p = [];
  if (buf[25] !== 6) p.push('colour type is ' + buf[25] + ', want 6');
  const png = PNG.sync.read(buf), d = png.data;
  if (d[3] !== 0) p.push('corner is not transparent');
  const c = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
  if (d[c + 3] !== 255) p.push('centre is not opaque');
  let semi = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0 && d[i + 3] < 255) { semi++; if (Math.max(d[i], d[i + 1], d[i + 2]) < 16) dark++; }
  }
  if (semi && dark / semi > 0.02) p.push(`dark fringe: ${dark}/${semi} semi-transparent pixels are near black`);
  // the master really has the pure-black transparent region this guards against
  const m = readImage(B.MASTER);
  let pb = 0;
  for (let i = 0; i < m.data.length; i += 4) if (m.data[i + 3] === 0 && m.data[i] + m.data[i + 1] + m.data[i + 2] === 0) pb++;
  if (!pb) p.push('master has no pure-black transparent pixels; premultiplied path untested');
  return p;
});
gate('favicon: 32x32 svg, traced from the logo pixel grid, no comments, no double hyphen', () => {
  const svg = read(path.join(DIST, 'favicon.svg'));
  const p = [];
  if (!/viewBox="0 0 32 32"/.test(svg) || !/width="32" height="32"/.test(svg)) p.push('not 32x32');
  if (/<!--/.test(svg) || /--/.test(svg)) p.push('comment or double hyphen present');
  if (/<\?xml/.test(svg)) p.push('xml prolog present');
  const pal = new Set(JSON.parse(read(path.join(ROOT, 'src/palette.json'))).map((s) => s.hex));
  [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].forEach((m) => { if (!pal.has(m[1])) p.push('fill off palette ' + m[1]); });
  const again = B.traceFavicon(B.cropToCoin(readImage(B.MASTER)), JSON.parse(read(path.join(ROOT, 'src/palette.json'))));
  if (again !== svg) p.push('favicon does not match a fresh trace of the logo grid');
  return p;
});
gate('palette provenance: every swatch equals the real pixel at its coordinate', () => {
  const pal = JSON.parse(read(path.join(ROOT, 'src/palette.json')));
  const cache = {};
  return pal.flatMap((s) => {
    cache[s.source] = cache[s.source] || readImage(s.source);
    const got = hex(pixelAt(cache[s.source], s.x, s.y));
    return got === s.hex ? [] : [`${s.name}: ${s.hex} != ${got} at ${s.x},${s.y}`];
  });
});
gate('tokens.css holds exactly the palette, nothing else', () => {
  const pal = new Set(JSON.parse(read(path.join(ROOT, 'src/palette.json'))).map((s) => s.hex));
  const tok = new Set([...read(path.join(ROOT, 'src/tokens.css')).matchAll(/--[\w-]+:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]));
  const p = [];
  tok.forEach((h) => { if (!pal.has(h)) p.push('token off palette ' + h); });
  pal.forEach((h) => { if (!tok.has(h)) p.push('palette swatch unused in tokens ' + h); });
  return p;
});
gate('colour literals live in the tokens file only', () => {
  const files = ['src/styles.css', 'src/index.html', ...fs.readdirSync(path.join(ROOT, 'src/js')).map((f) => 'src/js/' + f), 'tools/render.js'];
  const p = [];
  files.forEach((f) => {
    const t = read(path.join(ROOT, f)).replace(/&#\d+;|&#x[0-9a-f]+;/gi, '');
    if (/#[0-9a-fA-F]{3,8}\b/.test(t.replace(/href="#\w+"|"#top"|#[a-z-]+\s*[{,]/gi, '').replace(/[#.][a-z][\w-]*/gi, (m) => (/^#[0-9a-f]{3,8}$/i.test(m) ? m : '')))) p.push(f + ': hex literal');
    if (/\b(rgba?|hsla?)\(/.test(t)) p.push(f + ': rgb/hsl literal');
  });
  const pal = new Set(JSON.parse(read(path.join(ROOT, 'src/palette.json'))).map((s) => s.hex));
  ['index.html', 'assets/styles.css', 'assets/app.js', 'favicon.svg'].forEach((f) => {
    [...read(path.join(DIST, f)).matchAll(/#[0-9a-fA-F]{6}\b/g)].forEach((m) => { if (!pal.has(m[0].toLowerCase())) p.push(`dist/${f}: off-palette ${m[0]}`); });
  });
  return p;
});
gate('register schema: states, inert records carry no value or url', () => checkRegister(JSON.parse(read(path.join(ROOT, 'src/register.json')))));
gate('page register is the public view and inert records stay empty', () => checkInertNoValue(loadCtx(DIST, JSON.parse(read(path.join(ROOT, 'src/register.json'))))));
gate('no dates, timestamps or clock strings in the page', (ctx) => checkNoDates(ctx), { branches: true });
gate('social icons: both present, official marks, icon only, inert without href', (ctx) => checkSocials(ctx), { branches: true });
gate('mint slot: top of page, large, full address when stated, pending only when not', (ctx) => checkCaSlot(ctx), { branches: true });
gate('link rule: no href without a stated record', (ctx) => checkLinks(ctx), { branches: true });
gate('address scan: every address-shaped string matches the stated register (mint slot exempt)', (ctx) => checkAddressScan(ctx), { branches: true });
gate('address scan is not a blanket 0x reject', () => {
  const p = [];
  const evm = '0x' + 'ab12cd34ef'.repeat(4);
  const mk = (txt) => ({ html: `<p>${txt}</p>` });
  const regWith = { records: [{ id: 'ca', state: 'stated', value: evm }] };
  const regNone = { records: [{ id: 'ca', state: 'absent' }] };
  if (checkAddressScan(mk('mint ' + evm), regWith).length) p.push('registered 0x address was rejected');
  if (!checkAddressScan(mk('mint ' + evm), regNone).length) p.push('unregistered 0x address was accepted');
  if (checkAddressScan(mk('flag 0x1F and 0xdead'), regNone).length) p.push('short 0x constant was rejected');
  const sol = TEST_MINT;
  if (checkAddressScan(mk(sol), { records: [{ id: 'ca', state: 'stated', value: sol }] }).length) p.push('registered base58 address was rejected');
  if (!checkAddressScan(mk(sol), regNone).length) p.push('unregistered base58 address was accepted');
  return p;
});
gate('market is independent of mint state (identical market markup and script in both branches)', (_, c) => {
  const p = [];
  const grab = (ctx, re) => (ctx.html.match(re) || ['none'])[0];
  const parts = [/<section class="ticker"[\s\S]*?<\/section>/, /<section class="wrap statement"[\s\S]*?<\/section>/, /<section class="wrap market"[\s\S]*?<\/section>/];
  parts.forEach((re, i) => { if (grab(c.stated, re) !== grab(c.absent, re) || grab(c.stated, re) === 'none') p.push('market markup part ' + i + ' differs or is missing'); });
  if (c.stated.js !== c.absent.js) p.push('app.js differs between branches');
  const m = read(path.join(ROOT, 'src/js/30-market.js'));
  if (/rec\('ca'\)|"ca"|'ca'|B58|addressShaped|mint/i.test(m)) p.push('market module reads mint state');
  if (!/rec\('market-source'\)/.test(m)) p.push('market module does not read the market-source record');
  const strip = (reg) => JSON.stringify(reg.records.filter((r) => r.id === 'market-source'));
  if (strip(c.stated.reg) !== strip(c.absent.reg)) p.push('market-source record differs between branches');
  return p;
}, { meta: true });
gate('market contract: endpoints, solana filter, top 10, backoff, poll, visibility, fallbacks', () => {
  const js = read(path.join(DIST, 'assets/app.js'));
  const reg = JSON.parse(read(path.join(ROOT, 'src/register.json')));
  const need = [
    [/chainId === 'solana'/, 'solana filter'], [/slice\(0, 10\)/, 'top 10'], [/volume\.h24/, 'sorted on 24h volume'],
    [/imageUrl/, 'imageUrl'], [/onerror/, 'logo failure fallback'], [/className = 'letter'/, 'letter tile'],
    [/Math\.pow\(2, market\.failures - 1\)/, 'exponential backoff'], [/60000/, '60s poll'],
    [/visibilitychange/, 'visibility handling'], [/document\.hidden/, 'hidden check'], [/AbortController/, 'abort/timeout'],
    [/addrs\.slice\(0, 30\)/, '30 address cap'], [/Feed unreachable/, 'error message'], [/last good/, 'last good data kept'],
  ];
  const p = need.filter(([re]) => !re.test(js)).map(([, n]) => 'missing: ' + n);
  if (/api\.dexscreener/.test(js)) p.push('endpoint hard-coded in script, must come from the record');
  if (!reg.records.find((r) => r.id === 'market-source' && r.state === 'stated')) p.push('market-source not stated');
  const html = read(path.join(DIST, 'index.html'));
  if (!/class="[^"]*sk/.test(html) || !/.sk/.test(read(path.join(DIST, "assets/styles.css")))) p.push("skeleton markup or style missing");
  if ((html.match(/<div class="mrow" aria-hidden="true">/g) || []).length !== 10) p.push('want 10 skeleton rows');
  if (!/data-reveal/.test(html) || !/\.data-in/.test(read(path.join(DIST, 'assets/styles.css')))) p.push('stagger fade-in missing');
  return p;
});
gate('motion layer present with a full reduced-motion fallback', () => {
  const css = read(path.join(DIST, 'assets/styles.css')), js = read(path.join(DIST, 'assets/app.js'));
  const p = [];
  const need = [[/function spring\(/, 'spring solver'], [/stiffness/, 'stiffness'], [/damping/, 'damping'], [/IntersectionObserver/, 'scroll reveal'],
    [/dataset.depth/, 'parallax layers'], [/pointermove/, 'pointer parallax'], [/scaleX/, 'progress bar'], [/--mx/, 'spotlight'],
    [/flash-up/, 'value flash'], [/function countTo\(/, 'count-up'], [/prefers-reduced-motion: reduce/, 'reduced-motion query in script']];
  need.forEach(([re, n]) => { if (!re.test(js)) p.push('script missing ' + n); });
  const cssNeed = [[/@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion block'], [/animation: none !important/, 'animations off'], [/transition: none !important/, 'transitions off'],
    [/\.pill\[data-status="live"\] \.dot::after/, 'pulsing live dot'], [/\.mesh i/, 'gradient mesh'], [/@keyframes shimmer/, 'skeleton shimmer'], [/\.progress/, 'progress bar'], [/\[data-spot\]::before/, 'spotlight']];
  cssNeed.forEach(([re, n]) => { if (!re.test(css)) p.push('css missing ' + n); });
  return p;
});
gate('no ch units; tap targets declared at 44px', () => {
  const css = read(path.join(DIST, 'assets/styles.css'));
  const p = [];
  if (/[\d.]ch\b/.test(css)) p.push('ch unit in css');
  if (!/--tap:\s*44px/.test(css)) p.push('--tap is not 44px');
  const need = ['.btn', '.soc', '.tab', '.cp'];
  need.forEach((sel) => { const m = css.match(new RegExp('\\n' + sel.replace('.', '\\.') + '\\s*\\{[^}]*\\}')); if (!m && sel !== '.cp') p.push(sel + ' rule missing'); });
  if (!/\.soc\s*\{[^}]*width:\s*var\(--tap\)[^}]*height:\s*var\(--tap\)/.test(css)) p.push('.soc not 44x44');
  if (!/\.cp\s*\{[^}]*width:\s*var\(--tap\)[^}]*height:\s*var\(--tap\)/.test(css)) p.push('.cp not 44x44');
  if (!/\.btn\s*\{[^}]*min-height:\s*var\(--tap\)/.test(css)) p.push('.btn min-height');
  return p;
});
gate('copy is original: no shared 2-grams, no shared content words with the reference', () => {
  const STOP = new Set('a an the of to in on at for and or but is are be it its this that with as by from any you your we our not no can will has have into than then so if up out all one now new here there what when who which was were do does each them they their how'.split(' '));
  const DOMAIN = new Set(['solana', 'sol', 'wallet', 'address', 'copy', 'exchange', 'fun', 'https']);
  const tok = (s) => s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9$]+/g) || [];
  const refT = tok(read(path.join(ROOT, 'tools/fixtures/reference-copy.txt')));
  const html = read(path.join(DIST, 'index.html')).replace(/<meta name="viewport"[^>]*>/, '');
  const js = read(path.join(ROOT, 'src/js/20-register.js')) + read(path.join(ROOT, 'src/js/30-market.js')) + read(path.join(ROOT, 'src/js/40-terminal.js'));
  const strings = [...js.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]).filter((s) => / /.test(s) && /^[A-Za-z>]/.test(s) && !/[<>{}=()+;]/.test(s.replace(/^>/, '')) && !/^[.#\w-]+$/.test(s));
  const ours = tok((visibleText(html) + ' ' + strings.join(' ')).replace(/https?:\/\/\S+/g, ' '));
  const grams = (t) => { const s = new Set(); for (let i = 0; i < t.length - 1; i++) if (!(STOP.has(t[i]) && STOP.has(t[i + 1]))) s.add(t[i] + ' ' + t[i + 1]); return s; };
  const rg = grams(refT), og = grams(ours);
  const p = [];
  og.forEach((g) => { if (rg.has(g)) p.push('shared 2-gram: ' + g); });
  const rw = new Set(refT.filter((w) => !STOP.has(w) && w.length > 2 && !DOMAIN.has(w)));
  new Set(ours).forEach((w) => { if (rw.has(w)) p.push('shared word: ' + w); });
  return p;
});
gate('repo hygiene: no agent files, no attribution, repo files present', () => {
  const p = [];
  ['CLAUDE.md', '.claude', 'AGENTS.md', '.cursorrules', '.cursor'].forEach((f) => { if (exists(path.join(ROOT, f))) p.push('forbidden ' + f); });
  const bad = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'chat' + 'gpt', 'open' + 'ai', '\\bA' + 'I\\b', 'artificial intel', 'co-authored', 'generated (by|with)', 'gemi' + 'ni'].join('|'), 'i');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) return ['node_modules', 'brand', 'reference', '.tmp', 'fixtures', '.git'].includes(e.name) ? [] : walk(f);
    return /\.(md|json|js|css|html|svg|txt)$|LICENSE$/.test(e.name) && e.name !== 'package-lock.json' && e.name !== 'gates.js' ? [f] : [];
  });
  [...walk(ROOT)].forEach((f) => { if (bad.test(read(f))) p.push('attribution-like text in ' + path.relative(ROOT, f)); });
  ['README.md', 'docs/whitepaper.md', 'LICENSE'].forEach((f) => { if (!exists(path.join(ROOT, f))) p.push('missing ' + f); });
  if (exists(path.join(ROOT, 'LICENSE')) && !/MIT License[\s\S]*Copyright \(c\) 2026 Digicash/.test(read(path.join(ROOT, 'LICENSE')))) p.push('LICENSE is not MIT / Digicash / 2026');
  const rd = exists(path.join(ROOT, 'README.md')) ? read(path.join(ROOT, 'README.md')) : '';
  ['## Overview', '## Features', '## Links', 'Solana', 'digicash.fun', 'pending'].forEach((s) => { if (!rd.includes(s)) p.push('README lacks ' + s); });
  const wp = exists(path.join(ROOT, 'docs/whitepaper.md')) ? read(path.join(ROOT, 'docs/whitepaper.md')) : '';
  ['## Vision', '## Mission', '## Tokenomics', '## Roadmap', '## Team'].forEach((s) => { if (!wp.includes(s)) p.push('whitepaper lacks ' + s); });
  const phases = (wp.match(/^### Phase \d/gm) || []).length;
  if (phases < 3 || phases > 4) p.push('whitepaper wants 3-4 phases, has ' + phases);
  return p;
});

/* ───────── mutation harness ───────── */
gate('mutation: flipping each record at run time flips the rendered output', (_, c) => {
  const p = [];
  for (const id of ['ca', 'x', 'github']) {
    const was = R.stated(R.rec(c.live.reg, id));
    const flipped = flipRecord(c.live.reg, id);
    const now = R.stated(R.rec(flipped, id));
    if (was === now) { p.push(id + ': flip did not change state'); continue; }
    const f = buildTo('flip-' + id, flipped);
    const probs = [...checkRegister(flipped), ...checkSocials(f), ...checkCaSlot(f), ...checkLinks(f), ...checkAddressScan(f), ...checkInertNoValue(f), ...checkNoDates(f)];
    probs.forEach((x) => p.push(`flip ${id} (${was ? 'stated' : 'inert'} to ${now ? 'stated' : 'inert'}): ${x}`));
    const html = f.html;
    if (id === 'ca' && now && !html.includes(TEST_MINT)) p.push('ca flipped to stated but address not rendered');
    if (id === 'ca' && !now && html.replace(/<script[\s\S]*?<\/script>/g, '').includes(R.rec(c.live.reg, 'ca').value)) p.push('ca flipped to inert but value still rendered');
    if (id !== 'ca') {
      const hasHref = new RegExp(`data-social="${id}"[^>]*href=`).test(html);
      if (hasHref !== now) p.push(`${id}: href presence does not follow state`);
    }
  }
  return p;
}, { meta: true });
gate('mutation: the gates catch deliberate breakage', (_, c) => {
  const p = [];
  const expectFail = (label, probs) => { if (!probs.length) p.push('not caught: ' + label); };
  const live = c.live;
  // register: give the first inert record a value and a url; strip the first stated record bare
  const inert = live.reg.records.find((r) => r.state !== 'stated');
  const stated = live.reg.records.find((r) => r.state === 'stated');
  if (inert) { const r = clone(live.reg); const q = r.records.find((x) => x.id === inert.id); q.value = 'x'; q.url = 'https://example.com'; expectFail('inert record with value and url', checkRegister(r)); }
  { const r = clone(live.reg); const q = r.records.find((x) => x.id === stated.id); delete q.value; delete q.url; expectFail('stated record with nothing', checkRegister(r)); }
  { const r = clone(live.reg); const q = r.records.find((x) => x.id === 'ca'); q.state = 'stated'; q.value = 'not-an-address'; expectFail('malformed mint', checkRegister(r)); }
  // dist mutations on the absent branch so each anchor is the current empty state, not a fixed string
  const base = c.absent;
  const mutate = (fn) => Object.assign({}, base, { html: fn(base.html) });
  expectFail('date text injected', checkNoDates(mutate((h) => h.replace('</footer>', '<p>Updated 12:30</p></footer>'))));
  expectFail('year injected', checkNoDates(mutate((h) => h.replace('</footer>', '<p>2026</p></footer>'))));
  expectFail('foreign address injected', checkAddressScan(mutate((h) => h.replace('</footer>', `<p>${TEST_MINT}</p></footer>`))));
  expectFail('0x address injected', checkAddressScan(mutate((h) => h.replace('</footer>', `<p>0x${'a1'.repeat(20)}</p></footer>`))));
  expectFail('href on inert social', checkSocials(mutate((h) => h.replace(/(<span class="soc" data-social="x")/, '$1 href="https://x.com/anyone"'))));
  expectFail('inert social as anchor', checkSocials(mutate((h) => h.replace(/<span class="soc" data-social="github"([^>]*)>/, '<a class="soc" data-social="github"$1>').replace(/(data-social="github"[\s\S]*?<\/svg>)<\/span>/, '$1</a>'))));
  expectFail('text label on icon', checkSocials(mutate((h) => h.replace(/(data-social="x"[^>]*>)/, '$1Follow us'))));
  expectFail('slot carries address while inert', checkCaSlot(mutate((h) => h.replace('<span class="pending">pending</span>', TEST_MINT))));
  expectFail('copy enabled while inert', checkCaSlot(mutate((h) => h.replace(/(id="copy" type="button") disabled aria-disabled="true"/, '$1'))));
  expectFail('dead anchor', checkLinks(mutate((h) => h.replace('</footer>', '<a href="#">x</a></footer>'))));
  expectFail('unbacked external link', checkLinks(mutate((h) => h.replace('</footer>', '<a href="https://example.org/">x</a></footer>'))));
  const st = c.stated;
  expectFail('stated slot truncated', checkCaSlot(Object.assign({}, st, { html: st.html.replace(R.rec(st.reg, 'ca').value, R.rec(st.reg, 'ca').value.slice(0, 8) + '…') })));
  expectFail('stated social loses href', checkSocials(Object.assign({}, st, { html: st.html.replace(/(data-social="github"[^>]*) href="[^"]*"/, '$1') })));
  return p;
}, { meta: true });

/* ───────── runner ───────── */
function main() {
  if (!exists(path.join(DIST, 'index.html'))) { console.error('dist/ is missing. Run npm run build first.'); process.exit(2); }
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const reg = JSON.parse(read(path.join(ROOT, 'src/register.json')));
  const live = loadCtx(DIST, reg);
  const absent = buildTo('absent', forceStates(reg, 'absent'));
  const stated = buildTo('stated', forceStates(reg, 'stated'));
  const cases = { live, absent, stated };
  const states = (ctx) => ['ca', 'x', 'github'].map((id) => R.rec(ctx.reg, id).state).join('/');
  console.log(`branches: live(${states(live)})  absent(${states(absent)})  stated(${states(stated)})\n`);

  let pass = 0, assertions = 0;
  const failures = [];
  gates.forEach((g, i) => {
    let probs = [];
    try {
      if (g.branches) {
        for (const [k, ctx] of Object.entries(cases)) probs.push(...g.fn(ctx).map((x) => `[${k}] ${x}`));
      } else probs = g.fn(live, cases);
    } catch (e) { probs = ['threw: ' + (e && e.stack || e)]; }
    const ok = probs.length === 0;
    if (ok) pass++; else failures.push([g.name, probs]);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2, '0')}  ${g.name}`);
    if (!ok) probs.slice(0, Number(process.env.GATES_ALL ? 999 : 12)).forEach((x) => console.log('        - ' + x));
  });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\ngates: ${pass}/${gates.length} passed`);
  process.exit(failures.length ? 1 : 0);
}
main();
