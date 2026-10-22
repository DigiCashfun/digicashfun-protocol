'use strict';
// Writes src/palette.json. Each swatch is a real pixel of a brand or reference asset.
// Candidates came from k-means (k=8 over every 4th pixel, k=10 over every 2nd pixel for the banner),
// each centroid snapped to the nearest real pixel. The coordinate below is that pixel.
const fs = require('fs');
const path = require('path');
const { ROOT, readImage, pixelAt, hex } = require('./pixels');

const LOGO_T = 'brand/LOGO DIGICASH PNG...png';
const LOGO_O = 'brand/LOGO DIGICASH PNG.png';
const BANNER = 'reference/SAMPUL DIGICASH JPG.jpg.jpeg';

const SWATCHES = [
  ['ink-950',   LOGO_O, 0, 0,        'opaque logo, dominant field (71.4%)'],
  ['ink-900',   LOGO_T, 968, 432,    'transparent logo, dark ring (8.1%)'],
  ['blue-800',  LOGO_T, 632, 592,    'transparent logo, outer disc (21.5%)'],
  ['blue-700',  LOGO_T, 1364, 1044,  'transparent logo, mid disc (19.7%)'],
  ['blue-500',  LOGO_T, 736, 872,    'transparent logo, inner glow (18.0%)'],
  ['cyan',      LOGO_T, 1372, 1384,  'transparent logo, grid line (3.8%)'],
  ['glow',      BANNER, 1014, 428,   'banner, horizon grid line'],
  ['steel',     LOGO_T, 456, 1260,   'transparent logo, rim shadow (2.7%)'],
  ['chrome-2',  LOGO_T, 1264, 984,   'transparent logo, letter shade (8.8%)'],
  ['chrome',    LOGO_T, 936, 416,    'transparent logo, rim light (17.5%)'],
];

const cache = {};
const out = SWATCHES.map(([name, file, x, y, note]) => {
  cache[file] = cache[file] || readImage(file);
  const px = pixelAt(cache[file], x, y);
  return { name, hex: hex(px), source: file, x, y, note, method: 'k-means centroid snapped to nearest real pixel' };
});
fs.writeFileSync(path.join(ROOT, 'src/palette.json'), JSON.stringify(out, null, 2) + '\n');
console.log(out.map((s) => s.name + ' ' + s.hex).join('\n'));
