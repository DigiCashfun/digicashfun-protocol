'use strict';
// Register-driven markup. Shared by the build and by the gates so both read records the same way.

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
const ICONS = {
  x: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${X_PATH}"/></svg>`,
  github: `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${GH_PATH}"/></svg>`,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rec = (reg, id) => reg.records.find((r) => r.id === id);
const stated = (r) => !!r && r.state === 'stated';

// Handle is derived from the stored URL, never stored on its own.
function deriveHandle(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch (e) { return ''; }
}

// The page gets the public view: dates stay in register.json only.
function publicRegister(reg) {
  return { records: reg.records.map((r) => { const c = Object.assign({}, r); delete c.recorded; return c; }) };
}

function renderSocials(reg) {
  return ['x', 'github'].map((id) => {
    const r = rec(reg, id);
    const name = id === 'x' ? 'X' : 'GitHub';
    if (stated(r)) {
      const h = deriveHandle(r.url);
      const label = id === 'x' ? `${name} @${h}` : `${name} ${h}`;
      return `<a class="soc" data-social="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}">${ICONS[id]}</a>`;
    }
    return `<span class="soc" data-social="${id}" data-state="${esc(r ? r.state : 'absent')}" role="img" aria-disabled="true" aria-label="${name}, pending" title="${name} · pending">${ICONS[id]}</span>`;
  }).join('');
}

const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';

function renderCa(reg) {
  const r = rec(reg, 'ca');
  const chain = rec(reg, 'chain');
  const on = stated(r);
  const addr = on ? esc(r.value) : '<span class="pending">pending</span>';
  const btn = on
    ? `<button class="btn btn-copy" id="copy" type="button" aria-label="Copy mint address">${COPY_SVG}<span>Copy</span></button>`
    : `<button class="btn btn-copy" id="copy" type="button" disabled aria-disabled="true" aria-label="Copy mint address, pending">${COPY_SVG}<span>Copy</span></button>`;
  return `<section class="ca" id="ca" data-state="${on ? 'stated' : esc(r ? r.state : 'absent')}" aria-label="Mint address">
    <div class="ca-head"><span class="ca-chain">${esc(chain && stated(chain) ? chain.value : '')}</span><h2 class="ca-label">Mint address</h2></div>
    <div class="ca-row"><div class="ca-addr" id="ca-addr" data-slot="ca">${addr}</div>${btn}</div>
    <div class="copied" id="copied" role="status" aria-live="polite"></div>
  </section>`;
}

function renderChips(reg) {
  const items = [
    ['chain', 'Chain', (r) => r.value],
    ['domain', 'Site', (r) => r.value],
    ['ca', 'Mint', () => 'stated'],
    ['x', 'X', (r) => '@' + deriveHandle(r.url)],
    ['github', 'GitHub', (r) => deriveHandle(r.url)],
  ];
  return items.map(([id, label, val]) => {
    const r = rec(reg, id);
    if (stated(r)) return `<li class="chip" data-record="${id}" data-state="stated"><span class="chip-k">${label}</span><span class="chip-v">${esc(val(r))}</span></li>`;
    return `<li class="chip" data-record="${id}" data-state="${esc(r ? r.state : 'absent')}"><span class="chip-k">${label}</span><span class="chip-v">pending</span></li>`;
  }).join('');
}

function renderCta(reg) {
  const r = rec(reg, 'ca');
  if (stated(r)) return `<a class="btn btn-ghost" data-derived="chart" href="https://dexscreener.com/solana/${esc(r.value)}" target="_blank" rel="noopener noreferrer">Pair page</a>`;
  return '<span class="btn btn-ghost" data-derived="chart" aria-disabled="true">Pair page · pending</span>';
}

function renderRows() {
  const row = '<div class="mrow" aria-hidden="true"><span class="n sk"></span><div class="tok"><span class="sk c"></span><span class="sk" style="width:55%"></span></div><span class="num px sk r"></span><span class="num chg sk r"></span><span class="num vol sk r"></span><span class="num liq sk r"></span><span class="cp"></span></div>';
  return row.repeat(10);
}
function renderTicker() {
  return '<span class="tk"><span class="sk tk-sk"></span></span>'.repeat(10);
}

module.exports = { ICONS, X_PATH, GH_PATH, deriveHandle, publicRegister, renderSocials, renderCa, renderChips, renderCta, renderRows, renderTicker, rec, stated, esc };
