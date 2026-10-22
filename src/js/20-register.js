// Register-driven slots. The page holds the public view of src/register.json; this module only reads it.
const REGISTER = JSON.parse($('register').textContent);
const rec = (id) => REGISTER.records.find((r) => r.id === id) || null;
const isStated = (r) => !!r && r.state === 'stated';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
const addressShaped = (s) => B58.test(s) || EVM.test(s);

// Mint slot: copy only works once the record is stated.
(function mintSlot() {
  const r = rec('ca');
  const btn = $('copy');
  const note = $('copied');
  if (!isStated(r)) return;
  btn.addEventListener('click', async () => {
    const ok = await copyText(r.value);
    note.textContent = ok ? 'On clipboard' : 'Copy failed. Select the address by hand.';
    btn.dataset.done = ok ? 'true' : 'false';
    toast(ok ? 'Mint on clipboard' : 'Copy failed');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { note.textContent = ''; btn.dataset.done = ''; }, 2200);
  });
})();

// Mint check: compares an input with the stated record. A 0x string is judged by the same match, never by shape alone.
(function mintCheck() {
  const input = $('probe');
  const out = $('out');
  const set = (verdict, text) => { out.dataset.verdict = verdict; out.textContent = text; };
  function run() {
    const v = input.value.trim();
    const r = rec('ca');
    if (!v) return set('idle', 'No input yet.');
    if (!addressShaped(v)) return set('miss', 'That does not read as an address.');
    if (!isStated(r)) return set('miss', 'No mint is stated on this page yet. Treat every address as unverified.');
    if (v === r.value) return set('match', 'Match. This is the stated mint.');
    return set('miss', 'No match. This is not the stated mint.');
  }
  $('run').addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  $('copy-out').addEventListener('click', async () => {
    if (out.dataset.verdict === 'idle') run();
    toast((await copyText(out.textContent)) ? 'Result on clipboard' : 'Copy failed');
  });
})();
