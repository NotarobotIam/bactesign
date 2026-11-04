const PUG='https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
const validCid=(v:string)=>/^[1-9]\d{0,11}$/.test(v);

async function pug(path:string){return fetch(`${PUG}/${path}`,{signal:AbortSignal.timeout(15000)})}
async function cidList(path:string):Promise<string[]>{
 const r=await pug(path);
 if(!r.ok)return [];
 const d:any=await r.json().catch(()=>null);
 return (d?.IdentifierList?.CID||[]).map(String).filter(validCid);
}
async function conformer(cid:string):Promise<string|null>{
 const r=await pug(`cid/${cid}/SDF?record_type=3d`);
 if(r.status===404)return null;
 if(!r.ok)throw Error('upstream');
 const sdf=await r.text();
 if(sdf.length>2000000||!sdf.includes('M  END')||!sdf.slice(0,200).includes('3D'))return null;
 return sdf;
}

// Resolves a 3D conformer for a record. Order: the record's own CID, its other PubChem
// CIDs, then each one's PubChem parent compound (e.g. salt -> active component). When the
// record has no CID, its full InChIKey is resolved to PubChem CIDs first, then its SMILES
// by same-connectivity search (stereochemistry may differ; the response says so).
export async function GET(req:Request) {
 const q=new URL(req.url).searchParams;
 const cid=q.get('cid')||'';
 const alt=(q.get('alt')||'').split(',').filter(Boolean);
 const inchiKey=(q.get('inchikey')||'').toUpperCase(), smiles=q.get('smiles')||'';
 if(cid&&!validCid(cid)||alt.some(c=>!validCid(c))||alt.length>20) return Response.json({error:'A valid PubChem CID is required.'},{status:400});
 const keyOk=/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(inchiKey), smilesOk=smiles.length>0&&smiles.length<=2000;
 if(!cid&&!keyOk&&!smilesOk) return Response.json({error:'A valid PubChem CID, InChIKey or SMILES is required.'},{status:400});
 try {
  let own=cid?[cid,...alt]:keyOk?(await cidList(`inchikey/${inchiKey}/cids/JSON`)).slice(0,5):[];
  let lookup=cid?'':'inchikey';
  if(!own.length&&smilesOk){own=(await cidList(`fastidentity/smiles/cids/JSON?identity_type=same_connectivity&smiles=${encodeURIComponent(smiles)}`)).slice(0,5);lookup='connectivity'}
  if(!own.length) return Response.json({error:'No PubChem compound matches this molecule’s structure, so no 3D conformer is available.'},{status:404});
  const tried=new Set<string>();
  const attempt=async(c:string,relation:string)=>{
   if(tried.has(c))return null;tried.add(c);
   const sdf=await conformer(c);
   return sdf?{sdf,c,relation}:null;
  };
  let found=null;
  for(const c of own)if((found=await attempt(c,c===cid?'record':cid?'alternate':lookup)))break;
  if(!found)for(const c of own){
   for(const p of await cidList(`cid/${c}/cids/JSON?cids_type=parent`))if((found=await attempt(p,'parent')))break;
   if(found)break;
  }
  if(!found) return Response.json({error:'PubChem has no 3D conformer for this molecule or its parent compound. Its library record is still available.'},{status:404});
  return new Response(found.sdf,{headers:{'Content-Type':'chemical/x-mdl-sdfile','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','X-Structure-CID':found.c,'X-Structure-Relation':found.relation,'Access-Control-Expose-Headers':'X-Structure-CID, X-Structure-Relation'}});
 } catch {return Response.json({error:'The structure request timed out or could not reach PubChem. Please retry.'},{status:502});}
}
