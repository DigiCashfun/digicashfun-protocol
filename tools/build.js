'use strict';
// Static build. Output goes to dist/ (or --out), register from src/register.json (or --register).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { ROOT, readImage } = require('./pixels');
const R = require('./render');

const MASTER = 'brand/LOGO DIGICASH PNG...png';   // RGBA, transparent field
const BANNER = 'reference/SAMPUL DIGICASH JPG.jpg.jpeg';

// Trim the transparent margin: square crop around the opaque bounding box with a 1.5% pad.
function cropToCoin(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.data[(y * img.w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const side = Math.round(Math.max(x1 - x0, y1 - y0) * 1.03);
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
  const ox = Math.max(0, Math.min(img.w - side, cx - (side >> 1))), oy = Math.max(0, Math.min(img.h - side, cy - (side >> 1)));
  const data = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) img.data.copy(data, y * side * 4, ((oy + y) * img.w + ox) * 4, ((oy + y) * img.w + ox + side) * 4);
  return { w: side, h: side, data };
}

// Premultiplied area-average resize. The master carries pure-black RGB under alpha 0, so straight-alpha
// averaging would pull dark fringes into the silver rim. Colour is averaged as rgb*a and divided back by a.
function resizePremultiplied(img, size) {
  const { w, h, data } = img;
  const sx = w / size, sy = h / size;
  const tmp = new Float32Array(size * h * 4);
  for (let y = 0; y < h; y++) {
    for (let X = 0; X < size; X++) {
      const a0 = X * sx, a1 = a0 + sx;
      let r = 0, g = 0, b = 0, a = 0;
      for (let x = Math.floor(a0); x < Math.min(w, Math.ceil(a1)); x++) {
        const wt = Math.min(x + 1, a1) - Math.max(x, a0);
        const i = (y * w + x) * 4, al = data[i + 3] / 255;
        r += data[i] * al * wt; g += data[i + 1] * al * wt; b += data[i + 2] * al * wt; a += al * wt;
      }
      const o = (y * size + X) * 4;
      tmp[o] = r / sx; tmp[o + 1] = g / sx; tmp[o + 2] = b / sx; tmp[o + 3] = a / sx;
    }
  }
  const out = new PNG({ width: size, height: size });
  for (let Y = 0; Y < size; Y++) {
    const b0 = Y * sy, b1 = b0 + sy;
    for (let X = 0; X < size; X++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = Math.floor(b0); y < Math.min(h, Math.ceil(b1)); y++) {
        const wt = Math.min(y + 1, b1) - Math.max(y, b0);
        const i = (y * size + X) * 4;
        r += tmp[i] * wt; g += tmp[i + 1] * wt; b += tmp[i + 2] * wt; a += tmp[i + 3] * wt;
      }
      r /= sy; g /= sy; b /= sy; a /= sy;
      const o = (Y * size + X) * 4;
      if (a > 0.0001) {
        out.data[o] = Math.round(Math.min(255, r / a));
        out.data[o + 1] = Math.round(Math.min(255, g / a));
        out.data[o + 2] = Math.round(Math.min(255, b / a));
      }
      out.data[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return out;
}

// 32x32 favicon: the premultiplied 32px grid of the master, each cell snapped to the nearest palette swatch,
// horizontal runs merged into rects. No comments, nothing but shapes.
function traceFavicon(master, palette) {
  const g = resizePremultiplied(master, 32);
  const sw = palette.map((p) => ({ hex: p.hex, rgb: [1, 3, 5].map((k) => parseInt(p.hex.slice(k, k + 2), 16)) }));
  const rects = [];
  for (let y = 0; y < 32; y++) {
    let run = null;
    for (let x = 0; x <= 32; x++) {
      let hexv = null;
      if (x < 32) {
        const i = (y * 32 + x) * 4;
        if (g.data[i + 3] >= 128) {
          let best = null, bd = Infinity;
          for (const s of sw) {
            const d = (s.rgb[0] - g.data[i]) ** 2 + (s.rgb[1] - g.data[i + 1]) ** 2 + (s.rgb[2] - g.data[i + 2]) ** 2;
            if (d < bd) { bd = d; best = s.hex; }
          }
          hexv = best;
        }
      }
      if (run && run.hex === hexv) { run.n++; continue; }
      if (run) rects.push(`<rect x="${run.x}" y="${y}" width="${run.n}" height="1" fill="${run.hex}"/>`);
      run = hexv ? { x, n: 1, hex: hexv } : null;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

function build({ registerPath = path.join(ROOT, 'src/register.json'), register, outDir = path.join(ROOT, 'dist'), reuseImagesFrom } = {}) {
  const reg = register || JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  const palette = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/palette.json'), 'utf8'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  // logo: explicit copies of the master into dist/assets
  const imgs = ['assets/logo.png', 'assets/logo-192.png', 'assets/logo-96.png', 'assets/banner.jpg', 'favicon.svg'];
  if (reuseImagesFrom) {
    imgs.forEach((f) => fs.copyFileSync(path.join(reuseImagesFrom, f), path.join(outDir, f)));
  } else {
    const master = cropToCoin(readImage(MASTER));
    for (const [name, size] of [['logo.png', 640], ['logo-192.png', 192], ['logo-96.png', 96]]) {
      fs.writeFileSync(path.join(outDir, 'assets', name), PNG.sync.write(resizePremultiplied(master, size)));
    }
    fs.copyFileSync(path.join(ROOT, BANNER), path.join(outDir, 'assets/banner.jpg'));
    fs.writeFileSync(path.join(outDir, 'favicon.svg'), traceFavicon(master, palette));
  }

  // css and js
  const css = ['tokens.css', 'styles.css'].map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
  fs.writeFileSync(path.join(outDir, 'assets/styles.css'), css);
  const jsDir = path.join(ROOT, 'src/js');
  const js = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort()
    .map((f) => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
  fs.writeFileSync(path.join(outDir, 'assets/app.js'), `(() => {\n'use strict';\n${js}\n})();\n`);

  // html
  const ink = palette.find((p) => p.name === 'ink-950').hex;
  const map = {
    theme: `<meta name="theme-color" content="${ink}">`,
    socials: R.renderSocials(reg),
    ca: R.renderCa(reg),
    chips: R.renderChips(reg),
    cta: R.renderCta(reg),
    ticker: R.renderTicker(),
    rows: R.renderRows(),
    register: JSON.stringify(R.publicRegister(reg)).replace(/</g, '\\u003c'),
  };
  let html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  html = html.replace(/<!--@(\w+)-->/g, (m, k) => (k in map ? map[k] : m));
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return { outDir };
}

module.exports = { build, resizePremultiplied, cropToCoin, traceFavicon, MASTER };

if (require.main === module) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? path.resolve(a[i + 1]) : undefined; };
  const { outDir } = build({ registerPath: opt('--register'), outDir: opt('--out') });
  console.log('built ->', path.relative(ROOT, outDir) || '.');
}
