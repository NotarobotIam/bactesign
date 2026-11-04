import { env } from 'cloudflare:workers';
const kinds = ['Antibiotic', 'Peptide', 'Therapeutic', 'Antibody', 'Other'];
const stages = ['Candidate', 'Testing', 'Follow-up', 'Archived'];
function validate(p: any) {
  if (!p || typeof p !== 'object') return null;
  const fields = ['name', 'kind', 'stage', 'identifier', 'target', 'source', 'notes'];
  const v: Record<string, string> = {};
  for (const field of fields) {
    if (p[field] != null && typeof p[field] !== 'string') return null;
    v[field] = (p[field] || '').trim();
    if (v[field].length > (field === 'notes' ? 4000 : 300)) return null;
  }
  if (!v.name || !kinds.includes(v.kind) || !stages.includes(v.stage)) return null;
  return v;
}
export async function GET(req:Request) {
 try {
  const u=new URL(req.url), paged=u.searchParams.has('page');
  const id=u.searchParams.get('id');
  if(id){const r:any=await env.DB!.prepare('SELECT id, created, updated, payload FROM molecules WHERE id = ?').bind(id).first();return r?Response.json({...JSON.parse(r.payload),id:r.id,created:r.created,updated:r.updated}):Response.json({error:'Molecule not found'},{status:404});}
  const page=Math.max(1,Math.min(100000,Number(u.searchParams.get('page'))||1));
  const size=paged?24:100;
  const query=(u.searchParams.get('q')||'').trim().slice(0,150).toLowerCase();
  const source=u.searchParams.get('source')||'All sources',stage=u.searchParams.get('stage')||'All stages';
  const clauses:string[]=[],args:any[]=[];
  if(query){clauses.push("(instr(lower(json_extract(payload,'$.name')),?)>0 OR instr(lower(json_extract(payload,'$.identifier')),?)>0 OR instr(lower(COALESCE(json_extract(payload,'$.target'),'')),?)>0 OR instr(lower(COALESCE(json_extract(payload,'$.sources'),'')),?)>0)");args.push(query,query,query,query);}
  if(source!=='All sources'){clauses.push("(id IN (SELECT molecule_id FROM molecule_sources WHERE database_name = ?) OR (? = 'PubChem' AND pubchem_cid IS NOT NULL))");args.push(source,source);}
  if(stage!=='All stages'){clauses.push("json_extract(payload,'$.stage') = ?");args.push(stage);}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const r=await env.DB!.prepare('SELECT id, created, updated, payload FROM molecules'+where+' ORDER BY updated DESC, id LIMIT ? OFFSET ?').bind(...args,size,(page-1)*size).all();
  const items=r.results.map((x:any)=>({...JSON.parse(x.payload),id:x.id,created:x.created,updated:x.updated}));
  if(!paged)return Response.json(items,{headers:{'X-Result-Limit':'100'}});
  const count:any=await env.DB!.prepare('SELECT count(*) AS n FROM molecules'+where).bind(...args).first();
  const summary:any=await env.DB!.prepare("SELECT count(*) AS total, sum(json_extract(payload,'$.stage') = 'Candidate') AS candidates FROM molecules").first();
  const sourceCounts=await env.DB!.prepare('SELECT database_name AS source, count(DISTINCT molecule_id) AS count FROM molecule_sources GROUP BY database_name').all();
  return Response.json({items,total:count.n,page,pageSize:size,summary:{...summary,sources:sourceCounts.results}});
 }catch{return Response.json({error:'Molecule database unavailable. Please try again.'},{status:503});}
}
async function write(req: Request, updating: boolean) {
  try {
    const raw: any = await req.json();
    const p = validate(raw);
    if (!p) return Response.json({ error: 'Enter a molecule name, valid class and discovery stage. Check field lengths.' }, { status: 400 });
    if (updating && (typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id))) return Response.json({ error: 'Invalid molecule ID.' }, { status: 400 });
    const key = p.name.toLowerCase().replace(/\s+/g, ' ');
    const id = updating ? raw.id : crypto.randomUUID();
    const duplicate = await env.DB!.prepare('SELECT id FROM molecules WHERE name_key = ? AND id != ?').bind(key, id).first();
    if (duplicate) return Response.json({ error: 'A molecule with this name is already in the library. Open its record to edit it.' }, { status: 409 });
    const now = new Date().toISOString();
    let preserved = {};
    if (updating) {
      const old:any = await env.DB!.prepare('SELECT payload FROM molecules WHERE id = ?').bind(id).first();
      if (old) { const previous = JSON.parse(old.payload); preserved = {pubchem:previous.pubchem,importedAt:previous.importedAt,sources:previous.sources,smiles:previous.smiles,sequence:previous.sequence,inchiKey:previous.inchiKey}; }
    }
    const payload = {...p,...preserved};
    if (updating) {
      const result = await env.DB!.prepare('UPDATE molecules SET name_key = ?, updated = ?, payload = ? WHERE id = ?').bind(key, now, JSON.stringify(payload), id).run();
      if (!result.meta.changes) return Response.json({ error: 'Molecule not found.' }, { status: 404 });
    } else {
      await env.DB!.prepare('INSERT INTO molecules (id, name_key, created, updated, payload) VALUES (?, ?, ?, ?, ?)').bind(id, key, now, now, JSON.stringify(payload)).run();
    }
    return Response.json({ ...payload, id, updated: now }, { status: updating ? 200 : 201 });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return Response.json({ error: 'This molecule already exists.' }, { status: 409 });
    return Response.json({ error: 'Could not save the molecule. Your input has been kept.' }, { status: 503 });
  }
}
export function POST(req: Request) { return write(req, false); }
export function PUT(req: Request) { return write(req, true); }
