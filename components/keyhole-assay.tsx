'use client';
import { useEffect, useRef, useState } from 'react';
import { readKeyholeImage } from '../lib/read-keyhole-image';
import type { KeyholeReading } from '../lib/keyhole-reader';

// Keyhole gradient MIC assay.
// The drug disc sits in the round well; the molecule flows down the channel, which is divided
// into equal sections, one per concentration on the printed scale. Growth runs along the channel
// until the concentration becomes inhibitory: the first section without growth gives the MIC.

export const KEYHOLE_METHOD = 'Keyhole gradient MIC';
export const DEFAULT_KEYHOLE_SCALE = '0.5, 1, 2, 4, 8, 16';
export const KEYHOLE_SAMPLE = '/assays/keyhole-mic.png';

export type KeyholeAuto = { imageId: string; channel: number; stop: number; confidence: 'high' | 'medium' | 'low'; offset: number; fitError: number };

export function parseScale(text: string) {
  const v = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (v.length < 2 || v.some(x => !Number.isFinite(x) || x <= 0)) return { scale: [] as number[], error: 'Enter at least two positive concentrations, separated by commas.' };
  if (v.some((x, i) => i > 0 && x <= v[i - 1])) return { scale: [] as number[], error: 'Concentration marks must increase along the channel.' };
  return { scale: v, error: '' };
}

// stop: index of the first section without growth; scale.length = growth along the whole channel.
export function keyholeMic(scale: number[], stop: number | null) {
  if (!scale.length || stop === null) return { mic: null, error: '' };
  if (stop >= scale.length) return { mic: null, error: `Growth reaches the end of the channel: MIC is above ${scale[scale.length - 1]} µg/mL. Test a higher range to resolve it.` };
  if (stop === 0) return { mic: null, error: `No growth in the first section: MIC is at or below ${scale[0]} µg/mL. Test a lower range to resolve it.` };
  return { mic: scale[stop], error: '' };
}

const fmt = (c: number) => String(Number(c.toPrecision(3)));
export function micLabel(scale: number[], stop: number) {
  const n = scale.length;
  return stop >= n ? `MIC >${fmt(scale[n - 1])} µg/mL` : stop === 0 ? `MIC ≤${fmt(scale[0])} µg/mL` : `MIC ${fmt(scale[stop])} µg/mL`;
}

// ── photo overlay: detected wells, channels, growth fronts ─────────────────────────────
function KeyholeOverlay({ reading, scale, selected, onSelect }: { reading: KeyholeReading; scale: number[]; selected: number | null; onSelect: (i: number) => void }) {
  const VW = 1000, VH = (1000 * reading.height) / reading.width;
  return (
    <svg className="zone-overlay kh-overlay animate" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
      {reading.channels.map((c, i) => {
        const x0 = c.start * VW, x1 = c.end * VW, y0 = c.top * VH, y1 = c.bottom * VH, fx = c.front * VW, h = y1 - y0;
        const review = c.confidence === 'low';
        const label = micLabel(scale, c.stop) + (review ? ' · review' : '');
        const fs = Math.max(16, Math.min(30, h * 0.75)), lw = label.length * fs * 0.55 + 16;
        const lx = Math.min(VW - lw - 4, Math.max(4, fx - lw / 2)), ly = y1 + fs * 0.4;
        return (
          <g key={i} className={'zo ' + (review ? 'review' : 'ok') + (selected === i ? ' selected' : '')} style={{ animationDelay: `${i * 120}ms` }} onClick={e => { e.stopPropagation(); onSelect(i); }}>
            <rect className="zo-hit" x={c.wellX * VW - c.wellR * VW} y={y0 - h} width={x1 - c.wellX * VW + c.wellR * VW} height={h * 3} />
            <circle className="zo-disc" cx={c.wellX * VW} cy={c.wellY * VH} r={c.wellR * VW} />
            <rect className="kh-chan" x={x0} y={y0} width={x1 - x0} height={h} />
            {scale.slice(1).map((_, k) => <line key={k} className="kh-sec" x1={x0 + ((k + 1) * (x1 - x0)) / scale.length} x2={x0 + ((k + 1) * (x1 - x0)) / scale.length} y1={y0} y2={y1} />)}
            <rect className="kh-growthband" x={x0} y={y0} width={Math.max(0, fx - x0)} height={h} />
            <line className="zo-dia" x1={fx} x2={fx} y1={y0 - h * 0.35} y2={y1 + h * 0.35} />
            <g className="zo-label"><rect x={lx} y={ly} width={lw} height={fs + 10} rx={6} /><text x={lx + 8} y={ly + fs} fontSize={fs}>{label}</text></g>
          </g>
        );
      })}
    </svg>
  );
}

// ── schematic channel (also the manual reading control) ────────────────────────────────
const W = 640, H = 150, CY = 78, WELL_X = 66, WELL_R = 46, CH_X0 = 108, CH_X1 = 620, CH_H = 40;
function Channel({ scale, stop, onStop }: { scale: number[]; stop: number | null; onStop: (s: number) => void }) {
  const n = scale.length, seg = (CH_X1 - CH_X0) / Math.max(1, n);
  const boundary = (i: number) => CH_X0 + i * seg;
  const frontX = stop === null ? null : stop === 0 ? WELL_X + WELL_R * 0.6 : boundary(stop);
  function pick(e: React.MouseEvent<SVGSVGElement>) {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    onStop(Math.max(0, Math.min(n, Math.round((x - CH_X0) / seg))));
  }
  return (
    <svg className="kh-schematic" viewBox={`0 0 ${W} ${H}`} onClick={pick} role="img" aria-label={stop !== null && n ? `Keyhole channel, ${micLabel(scale, stop)}` : 'Keyhole channel: select where growth stops'}>
      <defs>
        <filter id="kh-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" /><feColorMatrix values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.88  0 0 0 0.9 0" /><feComposite in2="SourceGraphic" operator="in" /></filter>
        <clipPath id="kh-shape"><circle cx={WELL_X} cy={CY} r={WELL_R} /><rect x={CH_X0 - 20} y={CY - CH_H / 2} width={CH_X1 - CH_X0 + 20} height={CH_H} rx={4} /></clipPath>
      </defs>
      {scale.map((c, i) => <text key={i} className={'kh-mark' + (stop === i ? ' on' : '')} x={boundary(i) + seg / 2} y={26} textAnchor="middle">{fmt(c)}</text>)}
      <text x={CH_X1} y={46} textAnchor="end" className="kh-unit">µg/mL</text>
      <g clipPath="url(#kh-shape)">
        <rect x={0} y={0} width={W} height={H} className="kh-agar" />
        {frontX !== null && <g><rect x={0} y={0} width={frontX} height={H} className="kh-growth" /><rect x={0} y={0} width={frontX} height={H} filter="url(#kh-grain)" opacity={0.55} /></g>}
        {scale.slice(1).map((_, i) => <line key={i} className="kh-div" x1={boundary(i + 1)} x2={boundary(i + 1)} y1={CY - CH_H / 2} y2={CY + CH_H / 2} />)}
      </g>
      <circle cx={WELL_X} cy={CY} r={WELL_R} className="kh-outline" />
      <circle cx={WELL_X} cy={CY} r={17} className="kh-disc" /><text x={WELL_X} y={CY + 4} textAnchor="middle" className="kh-disclabel">DISC</text>
      {frontX !== null && n > 0 && (
        <g className="kh-front">
          <line x1={frontX} y1={CY - CH_H / 2 - 6} x2={frontX} y2={CY + CH_H / 2 + 14} />
          <rect x={Math.min(W - 150, Math.max(4, frontX - 70))} y={CY + CH_H / 2 + 14} width={140} height={24} rx={5} />
          <text x={Math.min(W - 150, Math.max(4, frontX - 70)) + 70} y={CY + CH_H / 2 + 31} textAnchor="middle">{micLabel(scale, stop!)}</text>
        </g>
      )}
    </svg>
  );
}

export default function KeyholeAssay({ scale, stop, onStop, onAuto, onMessage }: {
  scale: number[]; stop: number | null; onStop: (s: number | null) => void; onAuto: (a: KeyholeAuto | null) => void; onMessage: (m: string) => void;
}) {
  const [photo, setPhoto] = useState<{ url: string; imageId: string } | null>(null);
  const [reading, setReading] = useState<KeyholeReading | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function choose(r: KeyholeReading, i: number, imageId: string) {
    const c = r.channels[i]; setSel(i); onStop(c.stop);
    onAuto({ imageId, channel: i + 1, stop: c.stop, confidence: c.confidence, offset: Number(c.offset.toFixed(3)), fitError: Number(c.fitError.toFixed(3)) });
  }
  async function analyse(url: string, imageId: string, blob?: Blob) {
    if (scale.length < 2) { onMessage('Enter the concentration marks first.'); return; }
    setBusy(true); setReading(null); setSel(null); onAuto(null);
    try {
      const r = await readKeyholeImage(blob ?? url, scale.length);
      setReading(r);
      if (!r.channels.length) { onMessage(r.warnings[0] || 'No keyhole channels were found.'); return; }
      choose(r, 0, imageId);
      onMessage(`${r.channels.length} keyhole channel${r.channels.length > 1 ? 's' : ''} read automatically. Select the channel for this molecule and review the growth front.`);
    } catch (e) { onMessage(e instanceof Error ? e.message : 'Could not read this image.'); }
    finally { setBusy(false); }
  }
  async function load(blob: Blob, name: string) {
    onMessage('Uploading keyhole photo…');
    try {
      const r = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/png' }, body: blob });
      const j: any = await r.json(); if (!r.ok) throw Error(j.error);
      const url = '/api/image?id=' + j.id; setPhoto({ url, imageId: j.id });
      await analyse(url, j.id, blob);
    } catch (e) { onMessage((e instanceof Error ? e.message : 'Upload failed') + ` (${name})`); }
  }
  async function loadSample() { const b = await (await fetch(KEYHOLE_SAMPLE)).blob(); await load(b, 'sample'); }
  // the number of sections comes from the scale; read again when it changes
  useEffect(() => { if (photo) analyse(photo.url, photo.imageId); }, [scale.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = reading && sel !== null ? reading.channels[sel] : null;
  const overridden = c && stop !== c.stop;
  return (
    <div className="keyhole">
      <div className="kh-actions">
        <button className="textbutton" onClick={() => fileInput.current?.click()} disabled={busy}>Upload keyhole photo ↥</button>
        <button className="textbutton" onClick={loadSample} disabled={busy}>Try the sample image</button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) load(f, f.name); e.target.value = ''; }} />
      </div>
      {photo && (
        <div className="imagearea auto kh-photo">
          <img src={photo.url} alt="Keyhole assay photo" />
          {reading && <KeyholeOverlay reading={reading} scale={scale} selected={sel} onSelect={i => choose(reading, i, photo.imageId)} />}
          {busy && <div className="scanbeam" />}
        </div>
      )}
      {reading && reading.channels.length > 0 && (
        <div className="zone-chips kh-chips">
          {reading.channels.map((ch, i) => (
            <button key={i} className={'chip ' + (ch.confidence === 'low' ? 'review' : 'ok') + (sel === i ? ' on' : '')} onClick={() => choose(reading, i, photo!.imageId)}>
              Channel {i + 1} · {micLabel(scale, ch.stop)}
            </button>
          ))}
        </div>
      )}
      {reading?.warnings.map((w, i) => <p key={i} className="helper kh-warn">{w}</p>)}
      <Channel scale={scale} stop={stop} onStop={onStop} />
      <p className="helper">
        {c ? <>Auto-read · channel {sel! + 1} · {c.confidence === 'low' ? 'needs review' : c.confidence + ' confidence'}{overridden ? ' · adjusted by reviewer' : ''}. Click the channel above to correct the growth front if needed.</> :
          'Upload a top-down photo with the channels running left to right, or select the point on the channel where visible growth stops. The first section without growth is the MIC.'}
      </p>
    </div>
  );
}
