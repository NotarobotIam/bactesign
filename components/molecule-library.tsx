'use client';
import { useState, useRef, useEffect } from 'react';
import PubChemImport from './pubchem-import';
import Molecule3D from './molecule-3d';
import ReferenceCollection from './reference-collection';
import type {SourceRecord} from '../lib/catalog-store';
import type {PubChemCompound} from '../lib/pubchem';
export type Molecule = { id?: string; name: string; kind: string; stage: string; identifier: string; target: string; source: string; notes: string; created?: string; updated?: string; pubchem?: PubChemCompound; importedAt?: string; sources?:SourceRecord[]; sequence?:string; smiles?:string; inchiKey?:string };
const blank: Molecule = { name: '', kind: 'Antibiotic', stage: 'Candidate', identifier: '', target: '', source: '', notes: '' };
export const moleculeKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
export default function MoleculeLibrary({ molecules, rows, error, reload, onAnalyze, onResults }: { molecules: Molecule[]; rows: any[]; error: string; reload: () => Promise<void>; onAnalyze: (m: Molecule) => void; onResults: (name: string) => void }) {
  const [query, search] = useState(''), [stage, filter] = useState('All stages'), [sourceFilter,filterSource]=useState('All sources'), [page,changePage]=useState(1), [draft, edit] = useState<Molecule | null>(null), [selected, select] = useState<Molecule | null>(null), [message, notify] = useState(''), [busy, saving] = useState(false);
  const detailDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = detailDialog.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);
  const [remote,setRemote]=useState<{items:Molecule[];total:number;summary:any}>({items:[],total:0,summary:{total:0,candidates:0,sources:[]}}),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  useEffect(()=>changePage(1),[query,stage,sourceFilter]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);
    const timer=setTimeout(async()=>{try{const params=new URLSearchParams({page:String(page),q:query,source:sourceFilter,stage});const r=await fetch('/api/molecules?'+params,{signal:controller.signal});if(!r.ok)throw Error();setRemote(await r.json() as any);setLoadError('')}catch(e:any){if(e.name!=='AbortError')setLoadError('Could not load molecules. Try another search or refresh.')}finally{if(!controller.signal.aborted)setLoading(false)}},200);
    return()=>{clearTimeout(timer);controller.abort()};
  },[query,stage,sourceFilter,page,molecules]);
  const all=remote.items,shown=remote.items;
  const sourceNames=(m:Molecule)=>Array.from(new Set([...(m.sources||[]).map(s=>s.database),...(m.pubchem?['PubChem']:[])]));
  const observations = (m: Molecule) => rows.filter(r => moleculeKey(r.molecule) === moleculeKey(m.name));
  function change(k: keyof Molecule, v: string) { edit(d => d ? { ...d, [k]: v } : d); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!draft || busy) return; saving(true); notify('');
    try {
      const r = await fetch('/api/molecules', { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data: any = await r.json(); if (!r.ok) throw Error(data.error || 'Save failed.');
      await reload(); edit(null); select(null); notify('Molecule saved to your library.');
    } catch (e: any) { notify(e.message || 'Unable to connect. Please try again.'); }
    finally { saving(false); }
  }
  return <>
    <div className="discovery-banner"><div><div className="eyebrow">MOLECULE DISCOVERY</div><h2>Give every candidate a place to start.</h2><p>Add known molecules or your own candidates, record your hypothesis, and connect them to plate evidence.</p></div><button className="primary" onClick={() => { edit({ ...blank }); select(null); notify(''); }}>＋ Add molecule</button></div>
    {error && <div role="alert" className="notice">{error} <button className="textbutton" onClick={reload}>Retry connection</button></div>}
    {message && <div role="status" className="notice">{message}</div>}
    <ReferenceCollection reload={reload}/><PubChemImport reload={reload} onOpen={m=>{select(m);edit(null)}}/>
    <div className="library-summary"><span><strong>{remote.summary.total.toLocaleString()}</strong> saved molecules</span><span><strong>{Number(remote.summary.candidates||0).toLocaleString()}</strong> candidates</span>{remote.summary.sources.map((s:any)=><span key={s.source}><strong>{s.count.toLocaleString()}</strong> {s.source}</span>)}</div>
    {draft && <section className="panel molecule-editor"><div className="sectionheading"><div><h2>{draft.id ? 'Edit molecule' : 'Add a molecule'}</h2><p>No plate analysis is required to add a candidate.</p></div><button className="textbutton" disabled={busy} onClick={() => edit(null)}>Cancel</button></div><form onSubmit={save}>
      <div className="fields"><label>Molecule name *<input required autoFocus maxLength={300} value={draft.name} readOnly={!!draft.id && observations(draft).length > 0} onChange={e => change('name', e.target.value)} placeholder="e.g. Candidate P-001"/>{draft.id && observations(draft).length > 0 && <small>Name is linked to existing analyses.</small>}</label>
      <label>Molecule class<select aria-label="Molecule class" value={draft.kind} onChange={e => change('kind', e.target.value)}>{['Antibiotic', 'Peptide', 'Therapeutic', 'Antibody', 'Other'].map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Discovery stage<select aria-label="Discovery stage" value={draft.stage} onChange={e => change('stage', e.target.value)}>{['Candidate', 'Testing', 'Follow-up', 'Archived'].map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Identifier / catalog number<input maxLength={300} value={draft.identifier} onChange={e => change('identifier', e.target.value)} placeholder="CAS, PubChem CID or internal ID"/></label>
      <label>Target cell / organism<input maxLength={300} value={draft.target} onChange={e => change('target', e.target.value)} placeholder="Research target, if known"/></label>
      <label>Source / supplier<input maxLength={300} value={draft.source} onChange={e => change('source', e.target.value)} placeholder="Supplier, publication or internal source"/></label></div>
      <label>Discovery hypothesis / notes<textarea rows={4} maxLength={4000} value={draft.notes} onChange={e => change('notes', e.target.value)} placeholder="Why study this candidate? What evidence would support the next step?"/></label>
      <button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save molecule'}</button>
    </form></section>}
    <div className="library-toolbar"><input aria-label="Search molecules" placeholder="Search molecules, targets or identifiers…" value={query} onChange={e => search(e.target.value)}/><select aria-label="Filter discovery stage" value={stage} onChange={e => filter(e.target.value)}>{['All stages', 'Candidate', 'Testing', 'Follow-up', 'Archived'].map(s => <option key={s}>{s}</option>)}</select><select aria-label="Filter molecule source" value={sourceFilter} onChange={e=>filterSource(e.target.value)}>{['All sources','PubChem','ChEMBL','DRAMP'].map(s=><option key={s}>{s}</option>)}</select></div>
    <div className="library-pagination"><span>{remote.total.toLocaleString()} matching molecules · Page {page} of {Math.max(1,Math.ceil(remote.total/24))}</span><button className="textbutton" disabled={page<=1} onClick={()=>changePage(p=>p-1)}>Previous</button><button className="textbutton" disabled={page*24>=remote.total} onClick={()=>changePage(p=>p+1)}>Next</button></div>
    {loading&&<p role="status" className="helper">Searching the library…</p>}{loadError&&<p role="alert" className="notice">{loadError}</p>}
    <div className="molecule-grid">{shown.map(m => <article className="panel molecule-card" key={m.id || moleculeKey(m.name)}><div className="card-meta"><span className="molecule-icon">⬡</span><span className="tag">{m.stage}</span></div><div className="eyebrow">{m.kind}</div><div className="source-badges">{sourceNames(m).map(s=><span className="tag" key={s}>{s}</span>)}</div><h2>{m.name}</h2><p>{m.target || 'Target not recorded'}</p><small>{m.identifier || 'No identifier recorded'}</small><div className="observation-count">{observations(m).length} saved observations {!m.id && <small>From your analyses · add details to create a library record</small>}</div><button className="textbutton" onClick={() => { select(m); edit(null); notify(''); }}>View molecule ↗</button></article>)}</div>
    {!loading && !shown.length && <div className="panel empty"><h2>{all.length ? 'No matching molecules' : 'Start your molecule library'}</h2><p>{all.length ? 'Try another search or discovery stage.' : 'Choose Add molecule, enter a name and class, then save. Your candidate will appear here immediately.'}</p></div>}
    <dialog ref={detailDialog} className="molecule-dialog" aria-labelledby="molecule-record-title" onCancel={e=>{e.preventDefault();select(null)}} onClick={e=>{if(e.target===e.currentTarget)select(null)}}>{selected && <section className="panel molecule-detail"><div className="sectionheading"><div><div className="eyebrow">MOLECULE RECORD</div><h2 id="molecule-record-title">{selected.name}</h2></div><button className="textbutton" onClick={() => select(null)}>Close details</button></div><div className="source-badges detail-source-links">{(selected.sources?.length?selected.sources:selected.pubchem?[{database:"PubChem",identifier:String(selected.pubchem.cid),url:selected.pubchem.sourceUrl}]:[]).map(s=><a className="tag" key={s.database+s.identifier} href={s.url} target="_blank" rel="noreferrer">{s.database} · {s.identifier} ↗</a>)}</div><Molecule3D key={selected.id || selected.name} cid={selected.pubchem?.cid} alt={(selected.sources||[]).filter(s=>s.database==='PubChem').map(s=>s.identifier)} inchiKey={selected.pubchem?.inchiKey||selected.inchiKey||undefined} smiles={selected.pubchem?undefined:selected.smiles||undefined} sequence={selected.sequence||undefined} name={selected.name}/><dl className="molecule-facts">{[['Class', selected.kind], ['Stage', selected.stage], ['Identifier', selected.identifier], ['Target', selected.target], ['Source', selected.source], ...(selected.pubchem ? [['PubChem CID', String(selected.pubchem.cid)], ['InChIKey', selected.pubchem.inchiKey], ['Formula', selected.pubchem.formula], ['Molecular weight', selected.pubchem.molecularWeight+' g/mol']] : [])].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || 'Not recorded'}</dd></div>)}</dl>{selected.pubchem && <a className="textbutton" href={selected.pubchem.sourceUrl} target="_blank" rel="noreferrer">Original PubChem record ↗</a>}<h3>Source records</h3><div className="source-records">{(selected.sources?.length?selected.sources:selected.pubchem?[{database:"PubChem",identifier:String(selected.pubchem.cid),url:selected.pubchem.sourceUrl,retrievedAt:selected.importedAt||""}]:[]).map(s=><div key={s.database+s.identifier}><a href={s.url} target="_blank" rel="noreferrer">{s.database} · {s.identifier} ↗</a>{s.retrievedAt&&<small>Retrieved {new Date(s.retrievedAt).toLocaleDateString(undefined,{timeZone:'America/Los_Angeles'})}</small>}{s.license&&<small>{s.license}</small>}{s.details&&Object.entries(s.details).map(([k,v])=><p key={k}><strong>{k}: </strong>{v}</p>)}</div>)}</div>{selected.sequence&&<><h3>Peptide sequence (source record)</h3><p className="sequence">{selected.sequence}</p></>}{selected.smiles&&<details><summary>View molecular SMILES</summary><p className="sequence">{selected.smiles}</p></details>}<h3>Discovery hypothesis / notes</h3><p className="molecule-notes">{selected.notes || 'No notes yet. Add details to record your research hypothesis.'}</p><div className="record-actions"><button className="primary" onClick={() => onAnalyze(selected)}>Analyze this molecule ↗</button><button className="textbutton" onClick={() => { edit({ ...selected }); select(null); }}>{selected.id ? 'Edit details' : 'Add library details'}</button><button className="textbutton" onClick={() => onResults(selected.name)}>View {observations(selected).length} observations ↗</button></div></section>}</dialog>
    <p className="helper">Discovery stages are research labels you assign. Adding a candidate does not establish activity or predict efficacy. Compare results within compatible assay conditions.</p>
  </>;
}
