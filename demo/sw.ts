/// <reference lib="webworker" />
// Bactesign public demo: a service worker that stands in for the server.
// GitHub Pages only serves static files, so every /api/* request is answered here:
//  · reference molecule library — the exported ChEMBL / DRAMP / PubChem records (read-only file)
//  · results, uploaded images, molecules you add — stored in this browser only (Cache Storage)
//  · 3D structures — the same route code as the full app, calling PubChem / RCSB directly
import { GET as pubchemStructure } from '../app/api/pubchem/structure/route';
import { GET as peptideStructure } from '../app/api/peptide/structure/route';

declare const self: ServiceWorkerGlobalScope;
const STORE = 'bactesign-demo-store-v1';
const KINDS = ['Antibiotic', 'Peptide', 'Therapeutic', 'Antibody', 'Other'];
const STAGES = ['Candidate', 'Testing', 'Follow-up', 'Archived'];
const METHODS = ['Disk diffusion', 'Dilution MIC', 'Keyhole gradient MIC'];

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith('/api/')) return;
  e.respondWith(handle(e.request, u).catch(err => json({ error: 'The demo could not complete this request: ' + (err?.message || err) }, 500)));
});

const json = (d: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function load<T>(key: string, fallback: T): Promise<T> {
  const r = await (await caches.open(STORE)).match(key); return r ? r.json() : fallback;
}
async function save(key: string, v: unknown) { await (await caches.open(STORE)).put(key, json(v)); }
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

type Mol = Record<string, any> & { id: string; name: string; updated: string };
let reference: Promise<Mol[]> | null = null;
function referenceLibrary() {
  reference ??= fetch('/demo-data/molecules.json').then(r => { if (!r.ok) throw Error('library unavailable'); return r.json() as Promise<Mol[]>; })
    .catch(e => { reference = null; throw e; });
  return reference!;
}
// your own additions and edits override reference records with the same id
async function library(): Promise<Mol[]> {
  const [ref, mine] = await Promise.all([referenceLibrary(), load<Mol[]>('/__demo/molecules', [])]);
  const ids = new Set(mine.map(m => m.id));
  return [...mine.sort((a, b) => b.updated.localeCompare(a.updated)), ...ref.filter(m => !ids.has(m.id))];
}
const sourcesOf = (m: Mol) => new Set<string>([...(m.sources || []).map((s: any) => s.database), ...(m.pubchem ? ['PubChem'] : [])]);
const haystack = (m: Mol) => [m.name, m.identifier, m.target || '', JSON.stringify(m.sources || [])].join('\n').toLowerCase();

async function molecules(req: Request, u: URL) {
  if (req.method === 'GET') {
    const all = await library(), q = u.searchParams;
    const id = q.get('id');
    if (id) { const m = all.find(m => m.id === id); return m ? json(m) : json({ error: 'Molecule not found' }, 404); }
    const paged = q.has('page'), size = paged ? 24 : 100;
    const page = Math.max(1, Math.min(100000, Number(q.get('page')) || 1));
    const query = (q.get('q') || '').trim().slice(0, 150).toLowerCase();
    const source = q.get('source') || 'All sources', stage = q.get('stage') || 'All stages';
    const hits = all.filter(m => (!query || haystack(m).includes(query)) && (source === 'All sources' || sourcesOf(m).has(source)) && (stage === 'All stages' || m.stage === stage));
    const items = hits.slice((page - 1) * size, page * size);
    if (!paged) return json(items, 200, { 'X-Result-Limit': '100' });
    const counts: Record<string, number> = {};
    for (const m of all) for (const s of sourcesOf(m)) counts[s] = (counts[s] || 0) + 1;
    return json({ items, total: hits.length, page, pageSize: size, summary: { total: all.length, candidates: all.filter(m => m.stage === 'Candidate').length, sources: Object.entries(counts).map(([source, count]) => ({ source, count })) } });
  }
  if (req.method === 'POST' || req.method === 'PUT') {
    const raw: any = await req.json().catch(() => null);
    const p: Record<string, string> = {};
    for (const f of ['name', 'kind', 'stage', 'identifier', 'target', 'source', 'notes']) {
      if (raw?.[f] != null && typeof raw[f] !== 'string') return json({ error: 'Invalid field.' }, 400);
      p[f] = (raw?.[f] || '').trim();
    }
    if (!p.name || !KINDS.includes(p.kind) || !STAGES.includes(p.stage)) return json({ error: 'Enter a molecule name, valid class and discovery stage. Check field lengths.' }, 400);
    const updating = req.method === 'PUT', all = await library();
    const id = updating ? String(raw.id || '') : crypto.randomUUID();
    if (all.some(m => nameKey(m.name) === nameKey(p.name) && m.id !== id)) return json({ error: 'A molecule with this name is already in the library. Open its record to edit it.' }, 409);
    const old = all.find(m => m.id === id);
    if (updating && !old) return json({ error: 'Molecule not found.' }, 404);
    const now = new Date().toISOString();
    const rec = { ...p, name: p.name, ...(old ? { pubchem: old.pubchem, importedAt: old.importedAt, sources: old.sources, smiles: old.smiles, sequence: old.sequence, inchiKey: old.inchiKey } : {}), id, created: old?.created || now, updated: now } as unknown as Mol;
    const mine = (await load<Mol[]>('/__demo/molecules', [])).filter(m => m.id !== id);
    await save('/__demo/molecules', [rec, ...mine]);
    return json(rec, updating ? 200 : 201);
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function results(req: Request) {
  const rows = await load<any[]>('/__demo/results', []);
  if (req.method === 'GET') return json(rows);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const p: any = await req.json().catch(() => null);
  if (!p || typeof p.sample !== 'string' || typeof p.molecule !== 'string' || !p.sample || !p.molecule || !METHODS.includes(p.method) || !Number.isFinite(p.value) || p.value <= 0 || JSON.stringify(p).length > 20000)
    return json({ error: 'Valid sample, molecule and positive measurement required' }, 400);
  const rec = { ...p, id: crypto.randomUUID(), created: new Date().toISOString() };
  await save('/__demo/results', [rec, ...rows].slice(0, 500));
  // like the full app: a molecule named in a result is added to the library if it is new
  try {
    const all = await library();
    if (!all.some(m => nameKey(m.name) === nameKey(p.molecule))) {
      const now = rec.created, mine = await load<Mol[]>('/__demo/molecules', []);
      await save('/__demo/molecules', [{ name: p.molecule.trim(), kind: KINDS.includes(p.kind) ? p.kind : 'Other', stage: 'Testing', identifier: '', target: '', source: '', notes: 'Created from a reviewed plate analysis.', id: crypto.randomUUID(), created: now, updated: now }, ...mine]);
    }
  } catch { /* the result is saved even if the library is unavailable */ }
  return json(rec);
}

async function image(req: Request, u: URL) {
  const cache = await caches.open(STORE);
  if (req.method === 'POST') {
    const blob = await req.blob();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 8 * 1024 * 1024) return json({ error: 'Use a PNG, JPEG or WebP under 8 MB' }, 400);
    const id = crypto.randomUUID();
    await cache.put('/__demo/image/' + id, new Response(blob, { headers: { 'Content-Type': blob.type } }));
    return json({ id });
  }
  const id = u.searchParams.get('id') || '';
  if (!/^[\w-]+$/.test(id)) return new Response('Invalid image', { status: 400 });
  return (await cache.match('/__demo/image/' + id)) || new Response('Not found', { status: 404 });
}

async function handle(req: Request, u: URL): Promise<Response> {
  const p = u.pathname.replace(/\/$/, '');
  if (p === '/api/results') return results(req);
  if (p === '/api/image') return image(req, u);
  if (p === '/api/molecules') return molecules(req, u);
  if (p === '/api/pubchem/structure') return pubchemStructure(req);
  if (p === '/api/peptide/structure') return peptideStructure(req);
  if (p === '/api/pubchem' || p === '/api/pubchem/import' || p === '/api/catalog')
    return json({ error: 'Importing new records needs the full Bactesign workspace. This public demo already includes the reference library.' }, 501);
  return json({ error: 'Not found' }, 404);
}
