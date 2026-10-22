const $ = (id) => document.getElementById(id);
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const motion = { reduced: reduceQuery.matches };
reduceQuery.addEventListener('change', (e) => {
  motion.reduced = e.matches;
  document.documentElement.classList.toggle('motion', !e.matches);
});
document.documentElement.classList.toggle('motion', !motion.reduced);

// Damped spring, semi-implicit Euler at a fixed 1/120 s step. Settles when offset and speed are both tiny.
function spring({ from = 0, to = 1, stiffness = 170, damping = 20, mass = 1, onUpdate, onDone }) {
  if (motion.reduced) { onUpdate(to); if (onDone) onDone(); return () => {}; }
  let x = from, v = 0, last = performance.now(), raf = 0, live = true, acc = 0;
  const dt = 1 / 120;
  const frame = (now) => {
    if (!live) return;
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (acc >= dt) {
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * dt;
      x += v * dt;
      acc -= dt;
    }
    onUpdate(x);
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.0005) { onUpdate(to); if (onDone) onDone(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { live = false; cancelAnimationFrame(raf); };
}

const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
const nf0 = nf(0, 0), nf1 = nf(1, 1), nf2 = nf(2, 2), nf24 = nf(2, 4), nf4 = nf(4, 4);
const DASH = '—';

function fmtCompact(v) {
  if (!Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + nf2.format(v / 1e9) + 'B';
  if (a >= 1e6) return '$' + nf2.format(v / 1e6) + 'M';
  if (a >= 1e3) return '$' + nf1.format(v / 1e3) + 'K';
  return '$' + nf0.format(v);
}
function fmtPrice(v) {
  if (!Number.isFinite(v)) return DASH;
  if (v >= 1000) return '$' + nf0.format(v);
  if (v >= 1) return '$' + nf24.format(v);
  if (v >= 0.01) return '$' + nf4.format(v);
  if (v === 0) return '$0';
  return '$' + v.toFixed(Math.min(12, 3 - Math.floor(Math.log10(v))));
}
function fmtChange(v) {
  if (!Number.isFinite(v)) return DASH;
  return (v >= 0 ? '+' : '−') + nf2.format(Math.abs(v)) + '%';
}

// Tween a number into an element and flash its cell when the value moved.
function countTo(el, to, fmt, flashOn) {
  const prev = el._v;
  el._v = to;
  if (el._stop) el._stop();
  if (!Number.isFinite(to)) { el.textContent = DASH; return; }
  if (prev === undefined || !Number.isFinite(prev) || motion.reduced) { el.textContent = fmt(to); return; }
  if (prev === to) { el.textContent = fmt(to); return; }
  const cell = flashOn || el;
  cell.classList.remove('flash-up', 'flash-down');
  void cell.offsetWidth;
  cell.classList.add(to > prev ? 'flash-up' : 'flash-down');
  const start = performance.now(), dur = 650;
  let raf = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(prev + (to - prev) * e);
    if (t < 1) raf = requestAnimationFrame(tick); else el.textContent = fmt(to);
  };
  raf = requestAnimationFrame(tick);
  el._stop = () => cancelAnimationFrame(raf);
}

const toastEl = $('toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.dataset.show = 'false'; }, 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e2) { return false; }
  }
}
