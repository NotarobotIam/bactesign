'use client';
import {useEffect,useRef,useState} from 'react';
type Shown={kind:'small';cid:string;relation:string}|{kind:'peptide';source:string;id:string;chains:string[]};
const LOADING='Loading 3D coordinates…', PEPTIDE_LOADING='Looking for an experimental structure, then a predicted model… this can take up to a minute.';
export default function Molecule3D({cid,alt=[],inchiKey,smiles,sequence,name}:{cid?:number;alt?:string[];inchiKey?:string;smiles?:string;sequence?:string;name:string}) {
 const altKey=alt.filter(c=>c!==String(cid)).join(','), smallQuery=cid?'cid='+cid+(altKey?'&alt='+altKey:''):[inchiKey&&'inchikey='+encodeURIComponent(inchiKey),smiles&&'smiles='+encodeURIComponent(smiles)].filter(Boolean).join('&');
 const seq=(sequence||'').replace(/\s/g,'').toUpperCase();
 const smallUrl=smallQuery?'/api/pubchem/structure?'+smallQuery:'', pepUrl=/^[A-Z]{5,400}$/.test(seq)?'/api/peptide/structure?sequence='+seq:'';
 // Peptide records may also carry a SMILES; if PubChem has no match, fall back to the sequence.
 const url=[smallUrl,pepUrl].filter(Boolean).join('|');
 const [shown,SH]=useState<Shown|null>(null);
 const [triedPeptide,TP]=useState(false);
 const peptide=shown?shown.kind==='peptide':triedPeptide||(!smallUrl&&!!pepUrl);
 const defaultStyle=peptide?'cartoon':'ball-stick';
 const host=useRef<HTMLDivElement>(null), viewer=useRef<any>(null), initialView=useRef<any>(null), selection=useRef<any>({});
 const [status,S]=useState(LOADING),[ready,R]=useState(false),[spinning,SP]=useState(false),[attempt,A]=useState(0),[style,ST]=useState(defaultStyle);
 useEffect(()=>{
  if(!url)return;
  let cancelled=false,local:any=null,observer:ResizeObserver|undefined;
  const controller=new AbortController();R(false);SP(false);SH(null);TP(!smallUrl);S(smallUrl?LOADING:PEPTIDE_LOADING);
  async function load(){
   try {
    let response=await fetch(smallUrl||pepUrl,{signal:controller.signal}), isPeptide=!smallUrl;
    if(!response.ok&&smallUrl&&pepUrl){if(!cancelled){S(PEPTIDE_LOADING);TP(true)}response=await fetch(pepUrl,{signal:controller.signal});isPeptide=true}
    if(!response.ok){const error:any=await response.json();throw Error(error.error||'Could not load the 3D structure.')}
    const text=await response.text(),h=response.headers,style0=isPeptide?'cartoon':'ball-stick';
    const info:Shown=isPeptide?{kind:'peptide',source:h.get('X-Structure-Source')||'esmfold',id:h.get('X-Structure-Id')||'',chains:(h.get('X-Structure-Chains')||'').split(',').filter(Boolean)}:{kind:'small',cid:h.get('X-Structure-CID')||String(cid||''),relation:h.get('X-Structure-Relation')||'record'};
    const module:any=await import('3dmol');
    if(cancelled||!host.current)return;
    const mol=module.createViewer?module:module.default;
    if(!mol?.createViewer)throw Error('The 3D viewer could not initialize.');
    local=mol.createViewer(host.current,{backgroundColor:'#f0f5ee',antialias:true});viewer.current=local;
    const model=local.addModel(text,isPeptide?'pdb':'sdf');
    selection.current=info.kind==='peptide'&&info.chains.length?{chain:info.chains}:{};
    if(!model.selectedAtoms(selection.current).length)throw Error('No atoms could be read from the 3D structure.');
    applyStyle(local,style0,info);ST(style0);local.zoomTo(selection.current);initialView.current=local.getView();local.render();
    observer=new ResizeObserver(()=>{if(!cancelled){local.resize();local.render()}});observer.observe(host.current);
    SH(info);R(true);S('3D structure loaded');
   }catch(e:any){if(!cancelled){R(false);S(e.message||'3D rendering is unavailable. Your browser must support WebGL.')}}
  }
  load();
  return ()=>{cancelled=true;controller.abort();observer?.disconnect();if(local){local.spin(false);local.clear()}viewer.current=null;host.current?.replaceChildren()};
 },[url,attempt]);
 function applyStyle(v:any,value:string,info:Shown|null){
  const sel=selection.current, predicted=info?.kind==='peptide'&&info.source==='esmfold';
  // ESMFold stores per-residue confidence (pLDDT, 0–1) in the B-factor column.
  const color=predicted?{colorscheme:{prop:'b',gradient:'roygb',min:0.3,max:0.9}}:{color:'spectrum'};
  v.setStyle({},{});
  v.setStyle(sel,value==='space-fill'?{sphere:{}}:value==='sticks'?{stick:{radius:0.18}}:value==='cartoon'?{cartoon:color,stick:{radius:0.1,hidden:false}}:{stick:{radius:0.16},sphere:{scale:0.25}});
  if(value==='cartoon')v.setStyle({...sel,atom:['N','C','O']},{cartoon:color});
 }
 function setStyle(value:string){ST(value);const v=viewer.current;if(!v)return;applyStyle(v,value,shown);v.render()}
 function spin(){if(!viewer.current)return;viewer.current.spin(spinning?false:'y',0.7);SP(!spinning)}
 function reset(){const v=viewer.current;if(!v)return;v.spin(false);SP(false);if(initialView.current)v.setView(initialView.current);v.zoomTo(selection.current);v.render()}
 if(!url)return <div className="notice">{seq?'This peptide sequence is too short for a meaningful 3D model (5 residues minimum).':'A 3D structure is not linked to this record. Import a molecule from PubChem to view its available 3D conformer.'}</div>;
 const nonStandard=peptide?seq.replace(/[ACDEFGHIKLMNPQRSTVWY]/g,'').length:0;
 let tag='',note='',caveat='Drag to rotate · Scroll or pinch to zoom. PubChem computed conformer; this is not an experimentally determined bound structure.',download='';
 if(shown?.kind==='small'||(!shown&&!peptide)){
  const c=shown?.kind==='small'?shown:null, shownCid=c?.cid||(cid?String(cid):'');
  tag=shownCid?`PubChem CID ${shownCid}`:'';
  download=ready&&shownCid?'/api/pubchem/structure?cid='+shownCid:'';
  note=c?.relation==='parent'?`Showing the PubChem parent compound (CID ${c.cid}); this record${cid?` (CID ${cid})`:''} is a salt or mixture form without its own 3D conformer.`:c?.relation==='alternate'?`Showing linked PubChem CID ${c.cid}; the primary CID ${cid} has no 3D conformer.`:c?.relation==='inchikey'?`PubChem CID ${c.cid} was matched by this record’s InChIKey.`:c?.relation==='connectivity'?`PubChem CID ${c.cid} was matched by atom connectivity from this record’s SMILES; stereochemistry may differ from the source record.`:'';
 } else {
  const p=shown?.kind==='peptide'?shown:null;
  download=ready?pepUrl:'';
  if(p?.source==='pdb'){
   tag=`PDB ${p.id}`;
   note=`Experimental structure from RCSB PDB entry ${p.id}${p.chains.length?` (chain ${p.chains.join(', ')})`:''}, whose deposited sequence exactly matches this record. Conditions in the deposited experiment (solvent, membrane mimetic, binding partners) may differ from your assay.`;
   caveat='Drag to rotate · Scroll or pinch to zoom.';
  } else {
   tag='Predicted · ESMFold';
   note=`Computational prediction from the amino-acid sequence alone (ESMFold); not an experimentally determined structure. Colour shows model confidence: blue high, red low. Cyclisation, disulfide bonds, lanthionine bridges and terminal or side-chain modifications from the source record are not modelled.${nonStandard?` ${nonStandard} non-standard residue${nonStandard>1?'s were':' was'} modelled as unknown (X).`:''} Short, flexible peptides are often disordered in solution, so low confidence is expected.`;
   caveat='Drag to rotate · Scroll or pinch to zoom.';
  }
 }
 return <section className="structure-section" aria-label={`3D structure of ${name}`}><div className="sectionheading"><div><div className="eyebrow">INTERACTIVE STRUCTURE</div><h3>Explore in 3D</h3></div>{tag&&<span className="tag">{tag}</span>}</div><div className="structure-stage"><div ref={host} className="structure-canvas" aria-label={`Interactive molecular model of ${name}`} role="img"/>{!ready&&<div className="structure-status" role="status"><p>{status}</p>{status!==LOADING&&status!==PEPTIDE_LOADING&&<button className="textbutton" onClick={()=>A(x=>x+1)}>Retry 3D structure</button>}</div>}</div><div className="structure-controls"><button type="button" className="textbutton" disabled={!ready} onClick={spin}>{spinning?'Pause rotation':'Auto-rotate'}</button><button type="button" className="textbutton" disabled={!ready} onClick={()=>viewer.current?.rotate(30,'y')}>Rotate left</button><button type="button" className="textbutton" disabled={!ready} onClick={()=>viewer.current?.rotate(-30,'y')}>Rotate right</button><button type="button" className="textbutton" disabled={!ready} onClick={reset}>Reset view</button><select aria-label="3D display style" disabled={!ready} value={style} onChange={e=>setStyle(e.target.value)}>{peptide&&<option value="cartoon">Cartoon (backbone)</option>}<option value="ball-stick">Ball and stick</option><option value="sticks">Sticks</option><option value="space-fill">Space filling</option></select></div>{note&&<p className="helper">{note}</p>}<p className="helper">{caveat}</p>{download&&<a className="textbutton" href={download} download={`${name.replace(/[^\w-]/g,'_')}-3d.${peptide?'pdb':'sdf'}`}>Download 3D {peptide?'PDB':'SDF'} ↓</a>}</section>;
}
