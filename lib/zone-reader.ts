// Automated inhibition-zone reader for disk-diffusion plate photos.
//
// Method (classical image analysis, no trained model):
//  1. Downscale the photo and build a "whiteness" map (brightness minus colour saturation).
//  2. Find antibiotic discs as small bright circles clearly brighter than the ring around
//     them, searched over a range of sizes. Discs are a standard 6 mm, so their median
//     pixel diameter calibrates mm per pixel.
//  3. Estimate the bacterial-lawn colour from the plate points farthest from every disc,
//     and each disc's clear-zone colour from the ring just outside it.
//  4. Cast rays outward from each disc and find where the colour moves from that disc's
//     clear-zone colour to the lawn colour and stays there. The zone radius is a lower
//     percentile of the valid rays, so rays running into a merged neighbour zone do not
//     inflate it.
//
// Output is a reading for human review, not a validated measurement. Assumptions: a
// top-down photo, standard 6 mm discs, reasonably even lighting, and confluent growth.

export type ZoneReading = {
  x: number; y: number;            // disc centre as a fraction of image width / height
  discRadius: number;              // disc radius as a fraction of image width
  zoneRadius: number;              // zone radius as a fraction of image width
  diameterMm: number;              // zone diameter in mm (6 = no zone beyond the disc)
  noZone: boolean;
  confidence: 'high' | 'medium' | 'low';
  rays: number;                    // rays that found a clean edge
};
export type PlateReading = { width: number; height: number; mmPerPx: number; zones: ZoneReading[]; warnings: string[] };

type RGB = [number, number, number];
const DISC_MM = 6;

export function readPlate(src: ImageData, opts: { maxSize?: number } = {}): PlateReading {
  const warnings: string[] = [];
  const scale = Math.min(1, (opts.maxSize ?? 900) / Math.max(src.width, src.height));
  const W = Math.max(1, Math.round(src.width * scale)), H = Math.max(1, Math.round(src.height * scale));
  const img = resample(src, W, H);
  const empty = (msg: string): PlateReading => ({ width: src.width, height: src.height, mmPerPx: 0, zones: [], warnings: [msg] });

  // ---- 1. brightness map and gradients ----
  const lum = new Float32Array(W * H), white = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = img[i * 3], g = img[i * 3 + 1], b = img[i * 3 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    white[i] = lum[i] - 0.6 * (Math.max(r, g, b) - Math.min(r, g, b));
  }
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, L = (dx: number, dy: number) => white[i + dy * W + dx];
    gx[i] = (L(1, -1) + 2 * L(1, 0) + L(1, 1)) - (L(-1, -1) + 2 * L(-1, 0) + L(-1, 1));
    gy[i] = (L(-1, 1) + 2 * L(0, 1) + L(1, 1)) - (L(-1, -1) + 2 * L(0, -1) + L(1, -1));
    mag[i] = Math.hypot(gx[i], gy[i]);
  }

  // ---- 2. disc search: circular Hough transform ----
  // Each strong edge votes for a centre one radius away in the direction of increasing
  // brightness, so only bright-centred circles (discs) accumulate votes.
  const minDim = Math.min(W, H);
  const rMin = Math.max(6, Math.round(minDim * 0.015)), rMax = Math.round(minDim * 0.06);
  const DS = 2, AW = Math.ceil(W / DS), AH = Math.ceil(H / DS), nR = rMax - rMin + 1;
  const acc = new Uint16Array(AW * AH * nR);
  const magSorted = Array.from(mag.filter((_, i) => i % 7 === 0)).sort((a, b) => a - b);
  const edgeThr = Math.max(60, magSorted[Math.floor(magSorted.length * 0.9)]);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = mag[i];
    if (m < edgeThr) continue;
    const nx = gx[i] / m, ny = gy[i] / m;
    for (let k = 0; k < nR; k++) {
      const r = rMin + k, cx = Math.round((x + nx * r) / DS), cy = Math.round((y + ny * r) / DS);
      if (cx < 0 || cy < 0 || cx >= AW || cy >= AH) continue;
      acc[(k * AH + cy) * AW + cx]++;
    }
  }
  type Disc = { x: number; y: number; r: number };
  const cands: (Disc & { score: number })[] = [];
  for (let k = 0; k < nR; k++) {
    const r = rMin + k, need = 0.28 * 2 * Math.PI * r;
    for (let cy = 1; cy < AH - 1; cy++) for (let cx = 1; cx < AW - 1; cx++) {
      // sum a 2x2 neighbourhood to absorb rounding of centres
      const base = k * AH * AW, v = acc[base + cy * AW + cx] + acc[base + cy * AW + cx + 1] + acc[base + (cy + 1) * AW + cx] + acc[base + (cy + 1) * AW + cx + 1];
      if (v >= need) cands.push({ x: cx * DS + DS / 2, y: cy * DS + DS / 2, r, score: v / (2 * Math.PI * r) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked: (Disc & { score: number })[] = [];
  for (const c of cands) {
    if (picked.length >= 40) break;
    if (picked.some(p => Math.hypot(p.x - c.x, p.y - c.y) < Math.max(p.r, c.r) * 1.6)) continue;
    // a disc is brighter inside than in the ring around it
    let inS = 0, inN = 0, outS = 0, outN = 0;
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      for (const f of [0.55, 0.75]) { const x = Math.round(c.x + Math.cos(t) * c.r * f), y = Math.round(c.y + Math.sin(t) * c.r * f); if (x >= 0 && y >= 0 && x < W && y < H) { inS += white[y * W + x]; inN++; } }
      for (const f of [1.3, 1.5]) { const x = Math.round(c.x + Math.cos(t) * c.r * f), y = Math.round(c.y + Math.sin(t) * c.r * f); if (x >= 0 && y >= 0 && x < W && y < H) { outS += white[y * W + x]; outN++; } }
    }
    if (!inN || !outN || inS / inN - outS / outN < 25) continue;
    picked.push(c);
  }
  if (!picked.length) return empty('No antibiotic discs were found. Use a top-down photo of a disk-diffusion plate.');
  // discs share one size: keep candidates near the size of the strongest ones
  const topR = median(picked.slice(0, Math.min(6, picked.length)).map(p => p.r));
  const sized = picked.filter(p => p.r > topR * 0.8 && p.r < topR * 1.25 && p.score > picked[0].score * 0.4);
  // sub-pixel radius: along 36 rays, the half-way crossing between the disc face (upper
  // brightness inside, avoiding printed labels) and the surrounding ring
  const sampleW = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return NaN;
    const i = y0 * W + x0;
    return white[i] * (1 - fx) * (1 - fy) + white[i + 1] * fx * (1 - fy) + white[i + W] * (1 - fx) * fy + white[i + W + 1] * fx * fy;
  };
  const discs: Disc[] = sized.map(c => {
    const face: number[] = [], ring: number[] = [];
    for (let a = 0; a < 48; a++) {
      const t = (a / 48) * Math.PI * 2;
      for (let f = 0.45; f <= 0.8; f += 0.05) face.push(sampleW(c.x + Math.cos(t) * c.r * f, c.y + Math.sin(t) * c.r * f));
      for (let f = 1.35; f <= 1.6; f += 0.05) ring.push(sampleW(c.x + Math.cos(t) * c.r * f, c.y + Math.sin(t) * c.r * f));
    }
    const hi = percentile(face.filter(Number.isFinite), 0.75), lo = median(ring.filter(Number.isFinite)), mid = (hi + lo) / 2;
    const rs: number[] = [];
    for (let a = 0; a < 48; a++) {
      const t = (a / 48) * Math.PI * 2, dx = Math.cos(t), dy = Math.sin(t);
      // walk inward from outside the disc to the first point at or above the half-way level
      for (let rr = c.r * 1.3; rr > c.r * 0.6; rr -= 0.1) {
        const v = sampleW(c.x + dx * rr, c.y + dy * rr);
        if (v >= mid) { rs.push(rr); break; }
      }
    }
    return { x: c.x, y: c.y, r: rs.length >= 24 ? median(rs) : c.r };
  });
  if (!discs.length) return empty('Disc sizes were inconsistent; the scale could not be calibrated.');
  const rd = median(discs.map(d => d.r)), pxPerMm = (2 * rd) / DISC_MM;
  if (discs.length < 3) warnings.push(`Only ${discs.length} disc(s) found; scale calibration is less reliable.`);

  // ---- 3. colours: lawn from the farthest points, clear zone per disc ----
  const sm = boxBlur(img, W, H, Math.max(1, Math.round(rd / 4)));
  const at = (x: number, y: number): RGB | null => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
    const k = (yi * W + xi) * 3; return [sm[k], sm[k + 1], sm[k + 2]];
  };
  const minDiscDist = (x: number, y: number) => Math.min(...discs.map(d => Math.hypot(d.x - x, d.y - y)));
  const xs = discs.map(d => d.x), ys = discs.map(d => d.y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const far: { d: number; c: RGB }[] = [];
  for (let y = by0; y <= by1; y += rd / 2) for (let x = bx0; x <= bx1; x += rd / 2) { const c = at(x, y); if (c) far.push({ d: minDiscDist(x, y), c }); }
  far.sort((a, b) => b.d - a.d);
  const nearOther = (x: number, y: number, self: number) => discs.some((d, j) => j !== self && Math.hypot(d.x - x, d.y - y) < d.r * 1.25);
  const ringColor = (d: Disc, i: number) => {
    const ring: RGB[] = [];
    for (let a = 0; a < 60; a++) for (const f of [1.35, 1.55]) {
      const t = (a / 60) * Math.PI * 2, x = d.x + Math.cos(t) * d.r * f, y = d.y + Math.sin(t) * d.r * f;
      if (nearOther(x, y, i)) continue; const c = at(x, y); if (c) ring.push(c);
    }
    return medianColor(ring);
  };
  const rings = discs.map(ringColor);
  // Most discs on a plate have some zone, so the typical ring colour is "clear agar". The
  // lawn is whichever of two colour groups among far-from-disc points differs most from it.
  const clearRef = medianColor(rings);
  const farSamples = far.slice(0, Math.max(10, Math.round(far.length * 0.35))).map(f => f.c);
  const [ka, kb] = kmeans2(farSamples);
  const lawnC = dist(ka, clearRef) >= dist(kb, clearRef) ? ka : kb;

  // ---- 4. trace each zone ----
  const RAYS = 120, step = Math.max(0.75, rd / 8), hold = Math.max(4, Math.round((rd * 0.6) / step));
  const zones: ZoneReading[] = discs.map((d, i) => {
    const zoneC = rings[i];
    const contrast = dist(zoneC, lawnC);
    // no zone when the ring around the disc already looks like the lawn
    if (contrast < 18) return finish(d, true, 'high', 0);
    // ring is closer to the lawn than to clear agar: probably no zone, but hazy partial
    // zones look like this too, so flag it for review instead of asserting it
    if (contrast < dist(zoneC, clearRef) * 0.45) return finish(d, true, 'low', 0);
    const axis: RGB = [lawnC[0] - zoneC[0], lawnC[1] - zoneC[1], lawnC[2] - zoneC[2]], len2 = contrast * contrast;
    const frac = (c: RGB) => ((c[0] - zoneC[0]) * axis[0] + (c[1] - zoneC[1]) * axis[1] + (c[2] - zoneC[2]) * axis[2]) / len2;
    const radii: number[] = [];
    for (let a = 0; a < RAYS; a++) {
      const t = (a / RAYS) * Math.PI * 2, dx = Math.cos(t), dy = Math.sin(t);
      const f: number[] = [];
      for (let r = d.r * 1.25; r < d.r * 15; r += step) {
        const x = d.x + dx * r, y = d.y + dy * r;
        if (nearOther(x, y, i)) break;
        const c = at(x, y); if (!c) break;
        f.push(frac(c));
      }
      for (let k = 0; k + hold <= f.length; k++) {
        let n = 0; for (let j = k; j < k + hold; j++) if (f[j] > 0.5) n++;
        if (n >= hold * 0.75) { radii.push(d.r * 1.25 + k * step); break; }
      }
    }
    if (radii.length < RAYS * 0.25) return finish(d, false, 'low', radii.length, radii.length ? percentile(radii, 0.4) : d.r);
    const r = percentile(radii, 0.5), spread = (percentile(radii, 0.7) - percentile(radii, 0.3)) / r;
    const conf: ZoneReading['confidence'] = radii.length > RAYS * 0.6 && spread < 0.1 ? 'high' : radii.length > RAYS * 0.4 && spread < 0.2 ? 'medium' : 'low';
    return finish(d, false, conf, radii.length, r);
  });

  function finish(d: Disc, noZone: boolean, confidence: ZoneReading['confidence'], rays: number, rz = d.r): ZoneReading {
    // report relative to the calibrated disc size so all zones share one scale
    const zr = noZone ? rd : Math.max(rz * (rd / d.r), rd);
    const mm = Math.round((2 * zr / pxPerMm) * 10) / 10;
    return { x: d.x / W, y: d.y / H, discRadius: d.r / W, zoneRadius: (noZone ? d.r : rz) / W, diameterMm: mm, noZone: noZone || mm <= DISC_MM + 0.5, confidence, rays };
  }
  zones.sort((p, q) => (Math.abs(p.y - q.y) < 0.06 ? p.x - q.x : p.y - q.y));
  return { width: src.width, height: src.height, mmPerPx: scale / pxPerMm, zones, warnings };
}

// ---------- helpers ----------
function resample(src: ImageData, W: number, H: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 3), sx = src.width / W, sy = src.height / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const k = (yy * src.width + xx) * 4; r += src.data[k]; g += src.data[k + 1]; b += src.data[k + 2]; n++; }
    const o = (y * W + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}
function boxBlur(img: Uint8ClampedArray, W: number, H: number, rad: number): Uint8ClampedArray {
  const tmp = new Float32Array(W * H * 3), out = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let x = -rad; x < W + rad; x++) {
      const add = x + rad, rem = x - rad - 1;
      if (add >= 0 && add < W) { s += img[(y * W + add) * 3 + c]; n++; }
      if (rem >= 0 && rem < W) { s -= img[(y * W + rem) * 3 + c]; n--; }
      if (x >= 0 && x < W) tmp[(y * W + x) * 3 + c] = s / n;
    }
  }
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let y = -rad; y < H + rad; y++) {
      const add = y + rad, rem = y - rad - 1;
      if (add >= 0 && add < H) { s += tmp[(add * W + x) * 3 + c]; n++; }
      if (rem >= 0 && rem < H) { s -= tmp[(rem * W + x) * 3 + c]; n--; }
      if (y >= 0 && y < H) out[(y * W + x) * 3 + c] = s / n;
    }
  }
  return out;
}
const dist = (p: RGB, q: RGB) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const median = (a: number[]) => percentile(a, 0.5);
function percentile(a: number[], p: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; }
function kmeans2(s: RGB[]): [RGB, RGB] {
  const lum = (c: RGB) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const sorted = [...s].sort((p, q) => lum(p) - lum(q));
  let A: RGB = sorted[Math.floor(sorted.length * 0.2)] ?? [0, 0, 0], B: RGB = sorted[Math.floor(sorted.length * 0.8)] ?? [255, 255, 255];
  for (let it = 0; it < 12; it++) {
    const sa = [0, 0, 0, 0], sb = [0, 0, 0, 0];
    for (const c of s) { const t = dist(c, A) <= dist(c, B) ? sa : sb; t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; t[3]++; }
    if (sa[3]) A = [sa[0] / sa[3], sa[1] / sa[3], sa[2] / sa[3]];
    if (sb[3]) B = [sb[0] / sb[3], sb[1] / sb[3], sb[2] / sb[3]];
  }
  return [A, B];
}
function medianColor(cs: RGB[]): RGB { return cs.length ? [median(cs.map(c => c[0])), median(cs.map(c => c[1])), median(cs.map(c => c[2]))] : [0, 0, 0]; }
