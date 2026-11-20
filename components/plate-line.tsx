'use client';
import { useEffect, useRef, useState } from 'react';
import ZoneOverlay from './zone-overlay';
import { readPlateImage } from '../lib/read-plate-image';
import type { PlateReading, ZoneReading } from '../lib/zone-reader';

type Plate = {
  id: string; name: string; url: string; file?: File; credit?: string; source?: string;
  reading?: PlateReading; error?: string;
  pos: 'queued' | 'station' | 'gone';
};

// Real disk-diffusion photos bundled for demonstration (Wikimedia Commons, CC BY-SA 4.0).
const SAMPLES = [
  { name: 'Staphylococcus aureus', url: '/samples/saureus.jpg', credit: 'Dr Graham Beards · CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Antibiotic_sensitivity_test.jpg' },
  { name: 'Serratia marcescens', url: '/samples/serratia.jpg', credit: 'Stefan Walkowski · CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Serratia_marcescens_-_antibiogram.jpg' },
  { name: 'Pseudomonas aeruginosa', url: '/samples/paeruginosa.jpg', credit: 'Stefan Walkowski · CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Pseudomonas_aeruginosa_antibiogram.jpg' },
];
const TRAVEL_MS = 2000, SCAN_MS = 1500, HOLD_MS = 4000;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function PlateLine({ onReview }: { onReview: (file: File, zone: ZoneReading, plateName: string) => void }) {
  const [plates, setPlates] = useState<Plate[]>([]);
  const [running, setRunning] = useState(false);
  const [moving, setMoving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const runRef = useRef(false), platesRef = useRef<Plate[]>([]), fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { platesRef.current = plates; }, [plates]);
  useEffect(() => () => { runRef.current = false; }, []);

  const update = (id: string, patch: Partial<Plate>) => setPlates(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  function add(items: Omit<Plate, 'id' | 'pos'>[]) {
    setPlates(ps => [...ps, ...items.map(it => ({ ...it, id: crypto.randomUUID(), pos: 'queued' as const }))]);
  }
  function loadSamples() { add(SAMPLES.map(s => ({ ...s }))); }
  function addFiles(files: FileList | null) {
    if (!files) return;
    add(Array.from(files).filter(f => /^image\/(png|jpeg|webp)$/.test(f.type)).map(f => ({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f), file: f })));
  }

  async function run() {
    if (runRef.current) { runRef.current = false; setRunning(false); return; }
    runRef.current = true; setRunning(true);
    while (runRef.current) {
      const next = platesRef.current.find(p => p.pos === 'queued');
      if (!next) break;
      const leaving = platesRef.current.find(p => p.pos === 'station');
      // belt carries the finished plate out and the next one in, together
      setMoving(true);
      if (leaving) update(leaving.id, { pos: 'gone' });
      update(next.id, { pos: 'station' });
      setCurrent(null);
      await wait(TRAVEL_MS);
      setMoving(false);
      if (!runRef.current) break;
      // stop under the reader: scan, measure, show
      setScanning(true);
      const started = Date.now();
      let reading: PlateReading | undefined, error: string | undefined;
      try { reading = await readPlateImage(next.file ?? next.url); } catch (e) { error = e instanceof Error ? e.message : 'Could not read this image.'; }
      await wait(Math.max(0, SCAN_MS - (Date.now() - started)));
      setScanning(false);
      update(next.id, { reading, error });
      setCurrent(platesRef.current.findIndex(p => p.id === next.id));
      await wait(HOLD_MS);
    }
    // clear the station at the end of the queue
    const last = platesRef.current.find(p => p.pos === 'station');
    if (last && runRef.current) { setMoving(true); update(last.id, { pos: 'gone' }); await wait(TRAVEL_MS); setMoving(false); }
    runRef.current = false; setRunning(false); setCurrent(null);
  }

  async function review(p: Plate, z: ZoneReading) {
    const file = p.file ?? new File([await (await fetch(p.url)).blob()], p.url.split('/').pop() || 'plate.jpg', { type: 'image/jpeg' });
    onReview(file, z, p.name);
  }

  const station = plates.find(p => p.pos === 'station');
  const done = plates.filter(p => p.reading || p.error);
  const queued = plates.filter(p => p.pos === 'queued').length;
  const stats = (r: PlateReading) => {
    const measured = r.zones.filter(z => !z.noZone);
    return `${r.zones.length} discs · ${measured.length} zones · ${r.zones.filter(z => z.confidence === 'low').length} to review`;
  };

  return (
    <div className="plateline">
      <section className="panel">
        <div className="sectionheading">
          <div>
            <h2>Automated plate line</h2>
            <p>Plates travel along the belt, pause under the reader, and every disc and inhibition zone is measured automatically.</p>
          </div>
          <div className="line-actions">
            <button className="textbutton" onClick={loadSamples} disabled={running}>Load sample plates</button>
            <button className="textbutton" onClick={() => fileInput.current?.click()} disabled={running}>Add plate photos ↥</button>
            <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp" hidden style={{ display: 'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <button className="primary" onClick={run} disabled={!running && queued === 0}>{running ? 'Pause line' : 'Start line'} <span>{running ? 'Ⅱ' : '▶'}</span></button>
          </div>
        </div>

        <div className={'belt-stage' + (moving ? ' moving' : '')}>
          <div className="station" aria-hidden="true">
            <div className="camera"><span /> READER</div>
            <div className="frame"><i /><i /><i /><i /></div>
          </div>
          {plates.map(p => (
            <div key={p.id} className={'belt-plate at-' + p.pos} aria-label={p.name}>
              <div className="belt-photo">
                <img src={p.url} alt={`Culture plate: ${p.name}`} />
                {p.reading && p.pos === 'station' && <ZoneOverlay reading={p.reading} compact />}
                {scanning && p.pos === 'station' && <div className="scanbeam" />}
              </div>
            </div>
          ))}
          <div className="belt"><div className="belt-surface" /><span className="roller left" /><span className="roller right" /></div>
          <div className="station-readout" aria-live="polite">
            {!plates.length && <p>Load sample plates or add your own top-down photos, then start the line.</p>}
            {station && scanning && <p><strong>Reading {station.name}…</strong>Finding discs, calibrating 6 mm, tracing zone edges</p>}
            {station?.reading && !scanning && <p><strong>{station.name}</strong>{stats(station.reading)}</p>}
            {station?.error && <p><strong>{station.name}</strong>{station.error}</p>}
            {!station && plates.length > 0 && !running && <p>{queued ? `${queued} plate${queued > 1 ? 's' : ''} waiting` : 'Line clear · all plates read'}</p>}
          </div>
        </div>
        <p className="helper">Discs are found automatically and calibrated to the standard 6 mm disc size; each zone edge is traced in 120 directions. Readings marked <b>review</b> are uncertain. Automated readings are unvalidated and must be checked before saving.</p>
      </section>

      {done.length > 0 && (
        <section className="line-results">
          {done.map(p => (
            <article className={'panel line-card' + (current !== null && plates[current]?.id === p.id ? ' live' : '')} key={p.id}>
              <div className="line-thumb"><img src={p.url} alt="" />{p.reading && <ZoneOverlay reading={p.reading} animate={false} labels={false} />}</div>
              <div className="line-body">
                <h3>{p.name}</h3>
                {p.reading && <small>{stats(p.reading)}</small>}
                {p.error && <small>{p.error}</small>}
                <div className="zone-chips">
                  {p.reading?.zones.map((z, i) => (
                    <button key={i} className={'chip ' + (z.noZone ? 'nozone' : z.confidence === 'low' ? 'review' : 'ok')} onClick={() => review(p, z)} title="Review this zone and save it">
                      {z.noZone ? 'No zone' : `${z.diameterMm.toFixed(1)} mm`}
                    </button>
                  ))}
                </div>
                <small className="hint">Select a zone to review it and save it to the database.</small>
                {p.credit && <small className="credit">Photo: <a href={p.source} target="_blank" rel="noreferrer">{p.credit}</a></small>}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
