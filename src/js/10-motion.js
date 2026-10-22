// Progress bar, spring reveals, hero parallax, spotlight.
(function motionLayer() {
  const bar = $('progress');
  let ticking = false;
  const paintProgress = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, scrollY / max) : 0) + ')';
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(paintProgress); } }, { passive: true });
  paintProgress();

  // Reveal: each element springs from an offset to rest. Siblings under one parent stagger by index.
  const targets = [...document.querySelectorAll('[data-reveal]')];
  targets.forEach((el) => {
    const sibs = [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
    el._idx = Math.max(0, sibs.indexOf(el));
  });
  const show = (el) => {
    if (el._shown) return;
    el._shown = true;
    setTimeout(() => {
      spring({
        from: 0, to: 1, stiffness: 150, damping: 17,
        onUpdate: (p) => {
          el.style.opacity = String(Math.max(0, Math.min(1, p * 1.2)));
          el.style.transform = 'translate3d(0,' + ((1 - p) * 34).toFixed(2) + 'px,0) scale(' + (0.97 + 0.03 * p).toFixed(4) + ')';
        },
        onDone: () => { el.style.opacity = ''; el.style.transform = ''; },
      });
    }, motion.reduced ? 0 : el._idx * 80);
  };
  if (motion.reduced || !('IntersectionObserver' in window)) {
    targets.forEach((el) => { el._shown = true; el.style.opacity = ''; });
    document.documentElement.classList.remove('motion');
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach((el) => io.observe(el));
  }

  // Parallax: pointer and scroll set targets; the applied offset eases toward them.
  const hero = document.querySelector('.hero');
  const layers = [...hero.querySelectorAll('.layer')];
  const tgt = { x: 0, y: 0, s: 0 }, cur = { x: 0, y: 0, s: 0 };
  let heroVisible = true, raf = 0;
  function kick() { if (!raf && !motion.reduced && heroVisible) raf = requestAnimationFrame(step); }
  function step() {
    raf = 0;
    cur.x += (tgt.x - cur.x) * 0.08; cur.y += (tgt.y - cur.y) * 0.08; cur.s += (tgt.s - cur.s) * 0.1;
    layers.forEach((l) => {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = 'translate3d(' + (cur.x * d).toFixed(2) + 'px,' + (cur.y * d * 0.6 + cur.s * d * 3).toFixed(2) + 'px,0)';
    });
    if (Math.abs(tgt.x - cur.x) + Math.abs(tgt.y - cur.y) + Math.abs(tgt.s - cur.s) > 0.002 && heroVisible) raf = requestAnimationFrame(step);
  }
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tgt.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    tgt.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    kick();
  });
  hero.addEventListener('pointerleave', () => { tgt.x = 0; tgt.y = 0; kick(); });
  addEventListener('scroll', () => { tgt.s = Math.min(scrollY, innerHeight) / innerHeight; kick(); }, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((e) => { heroVisible = e[0].isIntersecting; if (heroVisible) kick(); }).observe(hero);
  }

  // Spotlight follows the pointer inside any [data-spot]. Delegated so rebuilt rows keep working.
  document.addEventListener('pointermove', (e) => {
    const s = e.target.closest && e.target.closest('[data-spot]');
    if (!s) return;
    const r = s.getBoundingClientRect();
    s.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    s.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
})();
