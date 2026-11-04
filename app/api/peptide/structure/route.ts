// 3D structure for a peptide sequence (DRAMP records have sequences but no PubChem CID).
// 1. RCSB PDB: an experimentally determined entry whose polymer sequence matches exactly.
// 2. ESMFold (ESM Metagenomic Atlas): a computational prediction from sequence alone.
// Response headers tell the viewer which source was used so it can be labelled honestly.
const STANDARD=/^[ACDEFGHIKLMNPQRSTVWY]+$/;
const MAX_PDB=5_000_000;

type Found={pdb:string;source:'pdb'|'esmfold';id:string;chains:string[]};

async function experimental(sequence:string):Promise<Found|null>{
 if(!STANDARD.test(sequence))return null;
 const search=await fetch('https://search.rcsb.org/rcsbsearch/v2/query',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(35000),body:JSON.stringify({
  query:{type:'terminal',service:'sequence',parameters:{evalue_cutoff:1,identity_cutoff:1,sequence_type:'protein',value:sequence}},
  request_options:{scoring_strategy:'sequence',paginate:{start:0,rows:10}},return_type:'polymer_entity'})});
 if(search.status===204||!search.ok)return null;
 const hits:string[]=((await search.json().catch(()=>null) as any)?.result_set||[]).map((r:any)=>String(r.identifier));
 for(const hit of hits){
  const [entry,entity]=hit.split('_');
  if(!/^[0-9A-Z]{4}$/i.test(entry)||!/^\d+$/.test(entity))continue;
  // Exact match only: the deposited entity sequence must equal the record's sequence.
  const meta=await fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${entry}/${entity}`,{signal:AbortSignal.timeout(15000)});
  if(!meta.ok)continue;
  const m:any=await meta.json();
  const seq=String(m?.entity_poly?.pdbx_seq_one_letter_code_can||'').replace(/\s/g,'').toUpperCase();
  if(seq!==sequence)continue;
  const chains:string[]=(m?.rcsb_polymer_entity_container_identifiers?.auth_asym_ids||[]).map(String);
  const file=await fetch(`https://files.rcsb.org/download/${entry.toUpperCase()}.pdb`,{signal:AbortSignal.timeout(20000)});
  if(!file.ok)continue;
  const pdb=await file.text();
  if(pdb.length>MAX_PDB||!pdb.includes('ATOM'))continue;
  return {pdb,source:'pdb',id:entry.toUpperCase(),chains};
 }
 return null;
}

async function predicted(sequence:string):Promise<Found|null>{
 // Non-standard/modified residues are submitted as X (unknown); the viewer says so.
 const r=await fetch('https://api.esmatlas.com/foldSequence/v1/pdb/',{method:'POST',body:sequence.replace(/[^ACDEFGHIKLMNPQRSTVWY]/g,'X'),signal:AbortSignal.timeout(60000)});
 if(!r.ok)return null;
 const pdb=await r.text();
 if(pdb.length>MAX_PDB||!pdb.includes('ATOM'))return null;
 return {pdb,source:'esmfold',id:'',chains:[]};
}

export async function GET(req:Request){
 const sequence=(new URL(req.url).searchParams.get('sequence')||'').replace(/\s/g,'').toUpperCase();
 if(!/^[A-Z]{5,400}$/.test(sequence))return Response.json({error:'A peptide sequence of 5–400 residues is required for a 3D model.'},{status:400});
 let found:Found|null=null, reached=false;
 try{found=await experimental(sequence);reached=true}catch{}
 if(!found){try{found=await predicted(sequence);reached=true}catch{}}
 if(!found)return Response.json({error:reached
  ?'No experimental structure matches this sequence, and the ESMFold prediction service did not return a model. It is often temporarily overloaded; please retry later.'
  :'The structure services (RCSB PDB and ESMFold) could not be reached. Please retry later.'},{status:502});
 return new Response(found.pdb,{headers:{'Content-Type':'chemical/x-pdb','Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff',
  'X-Structure-Source':found.source,'X-Structure-Id':found.id,'X-Structure-Chains':found.chains.join(','),
  'Access-Control-Expose-Headers':'X-Structure-Source, X-Structure-Id, X-Structure-Chains'}});
}
