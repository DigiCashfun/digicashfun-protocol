'use strict';
// Shared pixel readers for the build tools and the gates.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const ROOT = path.resolve(__dirname, '..');

function readImage(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
    const p = PNG.sync.read(buf);
    return { w: p.width, h: p.height, data: p.data, buf };
  }
  const j = jpeg.decode(buf, { useTArray: true });
  return { w: j.width, h: j.height, data: j.data, buf };
}

function pixelAt(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function hex(rgb) {
  return '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}

module.exports = { ROOT, readImage, pixelAt, hex };
