// Computer-vision reader for the keyhole gradient MIC assay.
//
// The drug disc sits in the round well and the molecule diffuses down the channel, which is
// divided into equal sections, one per concentration on the printed scale. Bacterial growth
// looks grainy (speckled); clear agar is smooth. For each channel the reader:
//   1. finds the channel as a long horizontal run of assay-coloured pixels next to a round well,
//   2. measures fine texture (graininess) column by column along the channel,
//   3. fits a single growth → clear step to that texture profile (the growth front),
//   4. converts the front to the nearest section boundary: the first section without growth is the MIC.
// All coordinates returned are fractions of the image width/height.

export type KeyholeChannel = {
  top: number; bottom: number;           // channel rows (fractions of height)
  start: number; end: number;            // channel columns, well side → far end (fractions of width)
  wellX: number; wellY: number; wellR: number; // well circle (wellR as a fraction of width)
  front: number;                         // growth front (fraction of width)
  stop: number;                          // first section without growth (0..sections; sections = growth everywhere)
  offset: number;                        // distance of the front from the nearest section boundary, in sections
  fitError: number;                      // share of columns that disagree with the growth/clear step
  confidence: 'high' | 'medium' | 'low';
  profile: number[];                     // texture along the channel, 0..1 (for display)
};
export type KeyholeReading = { width: number; height: number; channels: KeyholeChannel[]; threshold: number; contrast: number; warnings: string[] };

function otsu(values: number[], bins = 64) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return lo;
  const h = new Array(bins).fill(0);
  for (const v of values) h[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++;
  const total = values.length; let sum = 0; h.forEach((c, i) => (sum += i * c));
  let wB = 0, sumB = 0, best = 0, t = 0;
  for (let i = 0; i < bins; i++) {
    wB += h[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += i * h[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return lo + ((t + 1) / bins) * (hi - lo);
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export function readKeyhole(src: ImageData, sections: number): KeyholeReading {
  const { width: W, height: H, data } = src;
  const warnings: string[] = [];
  const N = W * H, gray = new Float32Array(N);
  for (let i = 0; i < N; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  // 1 · assay material vs. surroundings: colour distance from the image border, split by Otsu
  const br: number[] = [], bg: number[] = [], bb: number[] = [];
  const pushPx = (x: number, y: number) => { const i = (y * W + x) * 4; br.push(data[i]); bg.push(data[i + 1]); bb.push(data[i + 2]); };
  for (let x = 0; x < W; x += 2) { pushPx(x, 0); pushPx(x, H - 1); }
  for (let y = 0; y < H; y += 2) { pushPx(0, y); pushPx(W - 1, y); }
  const bgc = [median(br), median(bg), median(bb)];
  const dist = new Float32Array(N), sample: number[] = [];
  for (let i = 0; i < N; i++) {
    dist[i] = Math.hypot(data[i * 4] - bgc[0], data[i * 4 + 1] - bgc[1], data[i * 4 + 2] - bgc[2]);
    if (i % 3 === 0) sample.push(dist[i]);
  }
  const fgT = otsu(sample);
  const fg = new Uint8Array(N); for (let i = 0; i < N; i++) fg[i] = dist[i] > fgT ? 1 : 0;

  // 2 · channel rows: rows whose longest assay-coloured run (bridging thin divider lines) is long
  const gapMax = Math.max(2, Math.round(W * 0.008));
  const runs: { s: number; e: number }[] = [];
  for (let y = 0; y < H; y++) {
    let best = { s: 0, e: -1 }, s = -1, lastFg = -10;
    for (let x = 0; x < W; x++) {
      if (fg[y * W + x]) { if (s < 0 || x - lastFg > gapMax + 1) s = x; lastFg = x; if (x - s > best.e - best.s) best = { s, e: x }; }
    }
    runs.push(best);
  }
  const minRun = W * 0.4, minBand = Math.max(4, Math.round(H * 0.02));
  const bands: { y0: number; y1: number }[] = [];
  for (let y = 0; y < H; y++) {
    if (runs[y].e - runs[y].s < minRun) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.y1 <= 2) last.y1 = y; else bands.push({ y0: y, y1: y });
  }
  const chans = bands.filter(b => b.y1 - b.y0 + 1 >= minBand);

  // 3 · per channel: well, channel extent, texture profile
  type Raw = { y0: number; y1: number; xs: number; x1: number; wx: number; wy: number; wr: number; tex: number[] };
  const raws: Raw[] = [];
  for (const b of chans) {
    const rows = []; for (let y = b.y0; y <= b.y1; y++) rows.push(y);
    const x0 = Math.round(median(rows.map(y => runs[y].s))), x1 = Math.round(median(rows.map(y => runs[y].e)));
    const cy = Math.round((b.y0 + b.y1) / 2), chH = b.y1 - b.y0 + 1;
    // vertical extent of assay colour through the channel centre row, column by column
    const ext = (x: number) => { let a = cy, z = cy; while (a > 0 && fg[(a - 1) * W + x]) a--; while (z < H - 1 && fg[(z + 1) * W + x]) z++; return { a, z, h: z - a + 1 }; };
    let wx = x0, wh = 0, wa = cy, wz = cy;
    for (let x = x0; x < x0 + (x1 - x0) * 0.4; x++) { const e = ext(x); if (e.h > wh) { wh = e.h; wx = x; wa = e.a; wz = e.z; } }
    let xs = wx; while (xs < x1 && ext(xs).h > chH * 1.25) xs++;
    if (wh < chH * 1.4) warnings.push('A channel was found without a clear keyhole well; its start was estimated.');
    // texture: mean absolute difference from a 3×3 local mean, over the middle of the channel
    const ya = Math.round(b.y0 + chH * 0.25), yb = Math.round(b.y1 - chH * 0.25);
    const tex: number[] = [];
    for (let x = xs; x <= x1; x++) {
      let t = 0, n = 0;
      for (let y = Math.max(1, ya); y <= Math.min(H - 2, yb); y++) {
        if (x < 1 || x > W - 2) continue;
        let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += gray[(y + dy) * W + x + dx];
        t += Math.abs(gray[y * W + x] - m / 9); n++;
      }
      tex.push(n ? t / n : 0);
    }
    const w = Math.max(2, Math.round(tex.length / 50));
    const sm = tex.map((_, i) => { let s = 0, n = 0; for (let k = i - w; k <= i + w; k++) if (k >= 0 && k < tex.length) { s += tex[k]; n++; } return s / n; });
    raws.push({ y0: b.y0, y1: b.y1, xs, x1, wx, wy: (wa + wz) / 2, wr: wh / 2, tex: sm });
  }
  if (!raws.length) return { width: W, height: H, channels: [], threshold: 0, contrast: 0, warnings: ['No keyhole channels were found. Use a straight, top-down photo with the channels running left to right.'] };

  // 4 · growth vs. clear threshold shared by all channels on the image
  const all = raws.flatMap(r => r.tex);
  const thr = otsu(all);
  const hiV = all.filter(v => v > thr), loV = all.filter(v => v <= thr);
  const contrast = loV.length && hiV.length ? median(hiV) / Math.max(1e-6, median(loV)) : 1;
  if (contrast < 1.6) warnings.push('Growth and clear agar look alike on this image, so readings need review.');
  const texMax = Math.max(...all, 1e-6);

  const channels: KeyholeChannel[] = raws.map(r => {
    const g = r.tex.map(v => (v > thr ? 1 : 0)), L = g.length;
    // best single step: growth on the left of f, clear on the right
    // f = 0 means no growth at all; err = growth columns right of f + clear columns left of f
    let growthRight = g.reduce((s: number, v) => s + v, 0), noGrowthLeft = 0, best = growthRight, bestF = 0;
    for (let f = 1; f <= L; f++) {
      if (g[f - 1]) growthRight--; else noGrowthLeft++;
      const err = growthRight + noGrowthLeft;
      if (err < best) { best = err; bestF = f; }
    }
    const pos = (bestF / L) * sections, stop = Math.max(0, Math.min(sections, Math.round(pos))), offset = Math.abs(pos - stop), fitError = best / L;
    let confidence: KeyholeChannel['confidence'] = offset < 0.2 && fitError < 0.08 ? 'high' : offset < 0.35 && fitError < 0.15 ? 'medium' : 'low';
    if (contrast < 1.6) confidence = 'low';
    return {
      top: r.y0 / H, bottom: (r.y1 + 1) / H, start: r.xs / W, end: (r.x1 + 1) / W,
      wellX: r.wx / W, wellY: r.wy / H, wellR: r.wr / W,
      front: (r.xs + bestF) / W, stop, offset, fitError, confidence,
      profile: r.tex.map(v => v / texMax),
    };
  });
  return { width: W, height: H, channels, threshold: thr, contrast, warnings };
}
