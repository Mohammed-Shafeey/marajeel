// Generates the طائرة المراجيل app icon: public/icons/icon.svg plus every PNG size.
//
//   node scripts/gen-icons.mjs          (from web/)
//
// No npm dependencies: the SVG is built here, and the PNGs are rendered by a
// locally installed Chrome / Edge in headless mode (set CHROME=path to override),
// then re-encoded as opaque RGB so iOS never fills transparent pixels with black.
//
// Design notes
// - Colours are the brand four only: magenta #D81B5C, cyan #22D3E6,
//   white #FFFFFF and ink #121218 (texture uses them at reduced opacity).
// - Ball seams are exact circular arcs. Each seam pair is the same shape rotated
//   by 120°, the three main seams meet at one point, the parallel seams end on
//   their neighbour, and everything is clipped to the ball before the outline is
//   drawn on top, so no line end can poke past or fall short of the rim.
// - Texture: halftone dot gradients (like .tx-halftone), a rough printed cyan
//   band, a hard offset shadow and fine grain. All deterministic (seeded).
// - Everything important sits inside the maskable safe zone (r = 40% around centre).

import { writeFileSync, mkdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

const MAGENTA = '#D81B5C';
const CYAN = '#22D3E6';
const WHITE = '#FFFFFF';
const INK = '#121218';

const S = 512;
const BX = 256, BY = 240; // ball centre
const R = 148; // ball radius (fill edge; outline is centred on it)
const OUTLINE = 18;
const SEAM = 14;

const f = (n) => +n.toFixed(2);
const g = (n) => +n.toFixed(1); // dots/flecks: 0.1px is plenty

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- ball seams ----------
const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const pt = (c, r, t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
function arc(c, r, t0, t1) {
  const [x0, y0] = pt(c, r, t0), [x1, y1] = pt(c, r, t1);
  const large = Math.abs(t1 - t0) > Math.PI ? 1 : 0;
  const sweep = t1 > t0 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(x1)} ${f(y1)}`;
}
// first t in [from → to] where the point leaves the ball (or meets fn)
function solve(fn, from, to, steps = 4000) {
  let prev = fn(from);
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const v = fn(t);
    if (Math.sign(v) !== Math.sign(prev)) {
      let a = from + ((to - from) * (i - 1)) / steps, b = t;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        if (Math.sign(fn(m)) === Math.sign(fn(a))) a = m; else b = m;
      }
      return (a + b) / 2;
    }
    prev = v;
  }
  return null;
}

// One seam family (rotation 0): main seam is an arc of circle C (radius RHO)
// through the junction J, leaving J upward and bending left to the rim.
const J = [0, 6]; // junction, a touch below centre reads more like a real ball
const RHO = 190;
const GAP = 46; // distance between a seam and its parallel partner
const C0 = [J[0] - RHO, J[1]];
const RIM = R + 30; // draw past the rim; the clip trims it exactly

function seamFamily(k) {
  const a = (k * 2 * Math.PI) / 3;
  const C = rot([C0[0] - J[0], C0[1] - J[1]], a).map((v, i) => v + J[i]);
  const tJ = a; // angle of J seen from C (J = C + RHO·(cos a, sin a))
  const out = (r) => (t) => Math.hypot(...pt(C, r, t)) - RIM;
  const tEnd = solve(out(RHO), tJ, tJ - Math.PI);
  const main = arc(C, RHO, tJ, tEnd);

  return { k, C, tJ, tEnd, main };
}

const fams = [0, 1, 2].map(seamFamily);

// Parallel seam: the concentric arc GAP outside a main seam, walked from beside
// the junction in both directions until it meets the rim or a neighbouring
// main seam. It ends exactly on that seam (T-joint), or runs past the rim.
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function hitsSeam(m, p) {
  const s = fams[m];
  const d = Math.hypot(p[0] - s.C[0], p[1] - s.C[1]) - RHO;
  const t = Math.atan2(p[1] - s.C[1], p[0] - s.C[0]);
  const within = norm(t - s.tEnd) >= 0 && norm(s.tJ - t) >= 0; // tEnd ≤ t ≤ tJ
  return { d, within };
}
for (const s of fams) {
  const r2 = RHO + GAP;
  const others = fams.filter((o) => o !== s).map((o) => o.k);
  const walk = (dir) => {
    const step = dir * 0.0005;
    let t = s.tJ, prev = others.map((m) => hitsSeam(m, pt(s.C, r2, t)).d);
    for (let i = 0; i < 20000; i++) {
      t += step;
      const p = pt(s.C, r2, t);
      if (Math.hypot(...p) > RIM) return { t, end: 'rim' };
      for (let j = 0; j < others.length; j++) {
        const h = hitsSeam(others[j], p);
        if (Math.sign(h.d) !== Math.sign(prev[j]) && h.within) return { t, end: 'seam' };
        prev[j] = h.d;
      }
    }
    throw new Error('parallel seam never ended');
  };
  const a = walk(-1), b = walk(1);
  s.parallel = arc(s.C, r2, b.t, a.t);
  s.ends = [b.end, a.end];
}

// ---------- halftone dots ----------
// dots on a 45°-rotated grid; radius follows `amount(x,y)` in [0,1]
function halftone(step, maxR, amount, keep = () => true) {
  const out = [];
  const n = Math.ceil((S * 1.5) / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = S / 2 + (i - j) * step * Math.SQRT1_2;
      const y = S / 2 + (i + j) * step * Math.SQRT1_2;
      if (x < -step || y < -step || x > S + step || y > S + step) continue;
      if (!keep(x, y)) continue;
      const r = maxR * Math.sqrt(Math.max(0, Math.min(1, amount(x, y))));
      if (r >= 0.6) out.push(`M${g(x - r)} ${g(y)}a${g(r)} ${g(r)} 0 1 0 ${g(2 * r)} 0a${g(r)} ${g(r)} 0 1 0 ${g(-2 * r)} 0`);
    }
  }
  return out.join('');
}

// background: ink dots heavy in the top-right and bottom-left corners
const bgDots = halftone(11, 4.2, (x, y) => {
  const d1 = Math.hypot(S - x, y) / (S * 0.75);
  const d2 = Math.hypot(x, S - y) / (S * 0.6);
  return Math.max(1 - d1, 1 - d2) * 1.1;
});
// ball shading: dots grow toward the lower-right, clipped to the ball
const ballDots = halftone(9, 3.6, (x, y) => {
  const dx = x - (BX - 70), dy = y - (BY - 80);
  return (Math.hypot(dx, dy) - 150) / 160;
}, (x, y) => Math.hypot(x - BX, y - BY) < R + 4);

// ---------- rough cyan band ----------
function roughBand() {
  const r = rng(7);
  // centre line runs from (0, 372) to (512, 266); band height ~76
  const y0 = 384, y1 = 276, h = 78;
  const top = [], bot = [];
  for (let x = -8; x <= S + 8; x += 8) {
    const yc = y0 + ((y1 - y0) * x) / S;
    top.push([x, yc - h / 2 + (r() - 0.5) * 5]);
    bot.push([x, yc + h / 2 + (r() - 0.5) * 7]);
  }
  const pts = [...top, ...bot.reverse()];
  return 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}
// white "speed" scratches inside the band, ink flecks beside it
function scratches() {
  const r = rng(21);
  let d = '';
  for (let i = 0; i < 9; i++) {
    const x = 14 + r() * 470, len = 26 + r() * 60;
    const yc = 384 + ((276 - 384) * x) / S + (r() - 0.5) * 50;
    const slope = (276 - 384) / S;
    d += `M${f(x)} ${f(yc)}L${f(x + len)} ${f(yc + slope * len)}`;
  }
  return d;
}
function flecks(seed, count, area) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const [x, y] = area(r);
    const rr = 0.8 + r() * 1.8;
    d += `M${g(x - rr)} ${g(y)}a${g(rr)} ${g(rr)} 0 1 0 ${g(2 * rr)} 0a${g(rr)} ${g(rr)} 0 1 0 ${g(-2 * rr)} 0`;
  }
  return d;
}
// worn ink: small white nicks knocked out of the outline
const nicks = flecks(33, 12, (r) => {
  const a = r() * Math.PI * 2, rr = R + (r() - 0.5) * OUTLINE * 0.8;
  return [BX + rr * Math.cos(a), BY + rr * Math.sin(a)];
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<!-- Generated by web/scripts/gen-icons.mjs — edit that, not this file. -->
<defs>
<clipPath id="ball"><circle cx="${BX}" cy="${BY}" r="${R}"/></clipPath>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" stitchTiles="stitch"/>
<feColorMatrix values="0 0 0 0 .07  0 0 0 0 .07  0 0 0 0 .09  0 0 0 -2.2 1.25"/>
<feComposite in2="SourceGraphic" operator="in"/>
</filter>
</defs>
<rect width="${S}" height="${S}" fill="${MAGENTA}"/>
<path d="${bgDots}" fill="${INK}" opacity=".2"/>
<path d="${roughBand()}" fill="${CYAN}"/>
<path d="${scratches()}" stroke="${WHITE}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
<circle cx="${BX + 14}" cy="${BY + 14}" r="${R + OUTLINE / 2}" fill="${INK}" opacity=".38"/>
<circle cx="${BX}" cy="${BY}" r="${R}" fill="${WHITE}"/>
<g clip-path="url(#ball)">
<path d="${ballDots}" fill="${INK}" opacity=".26"/>
<g transform="translate(${BX} ${BY})" fill="none" stroke="${INK}" stroke-width="${SEAM}" stroke-linecap="round">
${fams.map((s) => `<path d="${s.main}"/><path d="${s.parallel}"/>`).join('\n')}
</g>
</g>
<circle cx="${BX}" cy="${BY}" r="${R}" fill="none" stroke="${INK}" stroke-width="${OUTLINE}"/>
<path d="${nicks}" fill="${WHITE}" opacity=".85"/>
<rect width="${S}" height="${S}" fill="${WHITE}" filter="url(#grain)" opacity=".22"/>
</svg>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.svg'), svg);
console.log('icon.svg', (svg.length / 1024).toFixed(1) + ' KB');

// ---------- render PNGs ----------
const chrome = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));
if (!chrome) throw new Error('No Chrome/Edge found; set CHROME=/path/to/chrome');

const tmp = mkdtempSync(join(tmpdir(), 'icons-'));
const sizes = [
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['icon-192.png', 192],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];
try {
  for (const [name, px] of sizes) {
    // render at 4x then box-downsample ourselves: crisper small sizes than Chrome's own scaling
    const big = px * 4;
    const html = join(tmp, `${px}.html`);
    writeFileSync(html, `<!doctype html><html><body style="margin:0;background:${MAGENTA}">${svg.replace(`width="${S}" height="${S}"`, `width="${big}" height="${big}" style="display:block"`)}</body></html>`);
    const shot = join(tmp, `${px}.png`);
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${big},${big}`, `--screenshot=${shot}`, pathToFileURL(html).href], { stdio: 'ignore' });
    const img = decodePng(readFileSync(shot));
    if (img.w < big || img.h < big) throw new Error(`screenshot ${img.w}x${img.h} < ${big}`);
    writeFileSync(join(outDir, name), encodeRgbPng(downsample(img, big, 4)));
    console.log(name, px);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------- tiny PNG codec (8-bit RGB/RGBA, non-interlaced) ----------
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12]) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('unsupported colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
function downsample({ w, bpp, px }, size, k) {
  const out = { w: size / k, h: size / k, px: Buffer.alloc((size / k) * (size / k) * 3) };
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += px[((y * k + dy) * w + x * k + dx) * bpp + c];
    out.px[(y * out.w + x) * 3 + c] = Math.round(s / (k * k));
  }
  return out;
}
function encodeRgbPng({ w, h, px }) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
