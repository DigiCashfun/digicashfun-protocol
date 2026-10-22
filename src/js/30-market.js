// Live Solana board. Driven only by the market-source record, nothing else in the register.
const market = { list: [], sort: 'volume', failures: 0, loaded: false, listeners: [] };

(function marketBoard() {
  const src = rec('market-source');
  const rowsEl = $('rows'), tickerEl = $('ticker'), pill = $('pill'), pillT = $('pill-t'), mnote = $('mnote');
  const addrByRow = new WeakMap();
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

  const setStatus = (s, t) => { pill.dataset.status = s; pillT.textContent = t; };
  const note = (t) => { mnote.hidden = !t; mnote.textContent = t || ''; };

  if (!isStated(src) || !src.url || !src.pairsUrl) {
    setStatus('idle', 'pending');
    return;
  }

  /* ---------- fetch ---------- */
  let ctl = null, timer = 0, busy = false;
  async function getJson(url) {
    const t = setTimeout(() => ctl && ctl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }
  async function pull() {
    ctl = new AbortController();
    const boosts = await getJson(src.url);
    const seen = new Set();
    const addrs = [];
    (Array.isArray(boosts) ? boosts : []).forEach((b) => {
      if (b && b.chainId === 'solana' && b.tokenAddress && !seen.has(b.tokenAddress)) { seen.add(b.tokenAddress); addrs.push(b.tokenAddress); }
    });
    if (!addrs.length) throw new Error('no solana entries');
    const pairs = await getJson(src.pairsUrl.replace('{addresses}', addrs.slice(0, 30).join(',')));
    const best = new Map();
    (Array.isArray(pairs) ? pairs : []).forEach((p) => {
      if (!p || p.chainId !== 'solana' || !p.baseToken || !seen.has(p.baseToken.address)) return;
      const liq = Number(p.liquidity && p.liquidity.usd) || 0;
      const cur = best.get(p.baseToken.address);
      if (!cur || liq > cur._liq) best.set(p.baseToken.address, Object.assign({ _liq: liq }, p));
    });
    const list = [...best.values()].map((p) => ({
      address: p.baseToken.address,
      name: p.baseToken.name || p.baseToken.symbol || 'Unknown',
      symbol: p.baseToken.symbol || '?',
      image: (p.info && p.info.imageUrl) || '',
      price: Number(p.priceUsd),
      change: Number(p.priceChange && p.priceChange.h24),
      volume: Number(p.volume && p.volume.h24),
      liquidity: Number(p.liquidity && p.liquidity.usd),
    })).filter((t) => Number.isFinite(t.volume));
    if (!list.length) throw new Error('no pairs');
    list.sort((a, b) => b.volume - a.volume);
    return list.slice(0, 10);
  }

  async function load() {
    if (busy || document.hidden) return;
    busy = true;
    clearTimeout(timer);
    if (!market.loaded) setStatus('sync', 'Syncing');
    let delay = 60000;
    try {
      const list = await pull();
      market.list = list; market.loaded = true; market.failures = 0;
      note('');
      setStatus('live', 'Live');
      render();
    } catch (err) {
      market.failures += 1;
      delay = Math.min(60000, 2000 * Math.pow(2, market.failures - 1)) * (0.85 + Math.random() * 0.3);
      setStatus('down', 'Feed lost');
      if (market.loaded) note('Feed unreachable. Showing the last good reading, retrying shortly.');
      else { note('Feed unreachable. Retrying with a growing pause.'); renderDashes(); }
    } finally {
      busy = false;
      if (!document.hidden) timer = setTimeout(load, delay);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); if (ctl) ctl.abort(); busy = false; }
    else load();
  });

  /* ---------- render ---------- */
  const sorted = () => {
    const l = market.list.slice();
    if (market.sort === 'change') l.sort((a, b) => (b.change || -Infinity) - (a.change || -Infinity));
    else if (market.sort === 'liquidity') l.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
    else l.sort((a, b) => b.volume - a.volume);
    return l;
  };
  const cls = (v) => (Number.isFinite(v) ? (v >= 0 ? 'up' : 'down') : '');
  const arrow = (v) => (Number.isFinite(v) ? (v >= 0 ? '▲ ' : '▼ ') : '');
  const chgText = (v) => arrow(v) + fmtChange(v);

  function tile(t, sym) {
    if (t.image) {
      const img = new Image();
      img.className = 'logo'; img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.replaceWith(letter(sym));
      img.src = t.image;
      return img;
    }
    return letter(sym);
  }
  function letter(sym) {
    const s = document.createElement('span');
    s.className = 'letter'; s.setAttribute('aria-hidden', 'true');
    s.textContent = (sym || '?').trim().charAt(0).toUpperCase() || '?';
    return s;
  }

  function buildRow(row, t, i) {
    addrByRow.set(row, t.address);
    row.className = 'mrow data-in';
    row.style.setProperty('--i', String(i));
    row.setAttribute('data-spot', '');
    row.replaceChildren();
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
    const tok = document.createElement('div'); tok.className = 'tok';
    tok.append(tile(t, t.symbol));
    const nm = document.createElement('div'); nm.className = 'nm';
    const b = document.createElement('b'); b.textContent = t.name;
    const s = document.createElement('span'); s.textContent = t.symbol;
    nm.append(b, s); tok.append(nm);
    const mk = (c) => { const e = document.createElement('span'); e.className = c; return e; };
    const px = mk('num px'), chg = mk('num chg'), vol = mk('num vol'), liq = mk('num liq');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost cp'; btn.innerHTML = COPY_ICON;
    btn.setAttribute('aria-label', 'Copy address for ' + t.symbol);
    btn.addEventListener('click', async () => {
      const ok = await copyText(addrByRow.get(row));
      toast(ok ? 'Address on clipboard' : 'Copy failed');
      if (!ok) return;
      btn.innerHTML = CHECK_ICON; btn.dataset.done = 'true';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.innerHTML = COPY_ICON; btn.dataset.done = ''; }, 1600);
    });
    const sub = mk('sub');
    const sc = mk('sc'), sv = mk('sv'), sl = mk('sl');
    sub.append(sc, sv, sl);
    row.append(n, tok, px, chg, vol, liq, btn, sub);
    fill(row, t, true);
  }
  function fill(row, t, first) {
    const q = (c) => row.querySelector('.' + c);
    const px = q('px'), chg = q('chg'), vol = q('vol'), liq = q('liq');
    if (first) {
      px.textContent = fmtPrice(t.price); px._v = t.price;
      chg.textContent = chgText(t.change); chg._v = t.change;
      vol.textContent = fmtCompact(t.volume); vol._v = t.volume;
      liq.textContent = fmtCompact(t.liquidity); liq._v = t.liquidity;
    } else {
      countTo(px, t.price, fmtPrice, px);
      countTo(chg, t.change, chgText, chg);
      countTo(vol, t.volume, fmtCompact, vol);
      countTo(liq, t.liquidity, fmtCompact, liq);
    }
    chg.className = 'num chg ' + cls(t.change);
    q('sc').textContent = chgText(t.change); q('sc').className = 'sc ' + cls(t.change);
    q('sv').textContent = 'Vol ' + fmtCompact(t.volume);
    q('sl').textContent = 'Liq ' + fmtCompact(t.liquidity);
  }

  function renderRows() {
    const list = sorted();
    [...rowsEl.children].forEach((row, i) => {
      const t = list[i];
      if (!t) return;
      if (addrByRow.get(row) === t.address) fill(row, t, false);
      else buildRow(row, t, i);
    });
  }

  function renderDashes() {
    [...rowsEl.children].forEach((row) => {
      if (addrByRow.get(row)) return;
      row.className = 'mrow';
      row.replaceChildren();
      const cells = ['n', 'tok', 'num px', 'num chg', 'num vol', 'num liq'];
      cells.forEach((c) => { const e = document.createElement('span'); e.className = c; e.textContent = DASH; row.append(e); });
    });
    ['t-count', 't-vol', 't-liq', 't-top'].forEach((id) => { $(id).textContent = DASH; });
  }

  function renderTicker() {
    const list = market.list;
    const key = list.map((t) => t.address).join(',');
    const text = (t) => ({ px: fmtPrice(t.price), chg: chgText(t.change) });
    if (tickerEl._key !== key) {
      tickerEl._key = key;
      tickerEl.replaceChildren();
      for (let copy = 0; copy < 2; copy++) {
        list.forEach((t) => {
          const el = document.createElement('span');
          el.className = 'tk' + (copy ? ' dup' : '');
          if (copy) el.setAttribute('aria-hidden', 'true');
          el.dataset.i = String(list.indexOf(t));
          el.innerHTML = '<span class="sym"></span><span class="px"></span><span class="chg"></span>';
          el.querySelector('.sym').textContent = t.symbol;
          tickerEl.append(el);
        });
      }
    }
    [...tickerEl.children].forEach((el) => {
      const t = list[Number(el.dataset.i)];
      if (!t) return;
      const x = text(t);
      el.querySelector('.px').textContent = x.px;
      const c = el.querySelector('.chg'); c.textContent = x.chg; c.className = 'chg ' + cls(t.change);
    });
  }

  function renderTiles() {
    const list = market.list;
    const sum = (k) => list.reduce((a, t) => a + (Number.isFinite(t[k]) ? t[k] : 0), 0);
    countTo($('t-count'), list.length, (v) => String(Math.round(v)), $('t-count').closest('.tile'));
    countTo($('t-vol'), sum('volume'), fmtCompact, $('t-vol').closest('.tile'));
    countTo($('t-liq'), sum('liquidity'), fmtCompact, $('t-liq').closest('.tile'));
    const top = list.filter((t) => Number.isFinite(t.change)).sort((a, b) => b.change - a.change)[0];
    if (top) {
      $('t-top').textContent = top.symbol;
      const s = $('t-top-s'); s.textContent = chgText(top.change); s.className = 's ' + cls(top.change);
    }
  }

  function render() {
    renderRows(); renderTicker(); renderTiles();
    market.listeners.forEach((fn) => fn(market.list));
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      market.sort = tab.dataset.sort;
      document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      if (market.loaded) {
        [...rowsEl.children].forEach((r) => addrByRow.delete(r));
        renderRows();
      }
    });
  });

  load();
})();
