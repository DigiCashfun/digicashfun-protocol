// Feed terminal: lines type out in sequence and pick up the live leader when data exists.
(function terminal() {
  const term = $('term');
  const lead = () => {
    const t = market.list[0];
    return t ? '> leader: ' + t.symbol + ', daily volume ' + fmtCompact(t.volume) : '> first reading not in yet';
  };
  const lines = () => [
    ['feed', '> link up. reading the order books.'],
    ['feed', '> keeping Solana pairs, dropping the rest.'],
    ['feed', '> ranking by daily volume.'],
    ['me', 'who leads right now?'],
    ['feed', lead()],
    ['me', 'is that a signal?'],
    ['feed', '> no verdicts here, only numbers.'],
    ['feed', '> compare any address with the stated mint.'],
    ['feed', '> standing by_'],
  ];
  const paint = () => {
    term.innerHTML = '';
    lines().forEach(([who, t]) => {
      const p = document.createElement('p');
      if (who === 'me') p.className = 'me';
      p.textContent = t;
      term.append(p);
    });
  };
  if (motion.reduced) {
    paint();
    market.listeners.push(paint);
    return;
  }
  let li = 0, current = lines();
  const cursor = document.createElement('span');
  cursor.className = 'cursor'; cursor.innerHTML = '&nbsp;';
  function typeLine() {
    if (motion.reduced) { paint(); return; }
    if (li >= current.length) {
      setTimeout(() => { term.innerHTML = ''; li = 0; current = lines(); typeLine(); }, 6000);
      return;
    }
    const [who, text] = current[li++];
    const p = document.createElement('p');
    if (who === 'me') p.className = 'me';
    term.appendChild(p);
    p.appendChild(cursor);
    while (term.scrollHeight > term.clientHeight && term.children.length > 1) term.removeChild(term.firstChild);
    let i = 0;
    const speed = who === 'me' ? 45 : 22;
    (function tick() {
      p.insertBefore(document.createTextNode(text[i] || ''), cursor);
      i++;
      if (i < text.length) setTimeout(tick, speed);
      else setTimeout(typeLine, who === 'me' ? 700 : 1100);
    })();
  }
  setTimeout(typeLine, 900);
})();
