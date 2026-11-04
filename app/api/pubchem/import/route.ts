import {env} from 'cloudflare:workers';
import {importCatalogRecord} from '../../../../lib/catalog-store';
import {lookupPubChem, PubChemError} from '../../../../lib/pubchem';
export async function POST(req: Request) {
  try {
    const input: any = await req.json();
    if (!Number.isSafeInteger(input?.cid) || input.cid <= 0) return Response.json({error:'A valid PubChem CID is required.'},{status:400});
    const [compound] = await lookupPubChem(String(input.cid), true);
    const key = compound.name.toLowerCase().replace(/\s+/g,' ');
    const find = () => env.DB!.prepare('SELECT id, payload FROM molecules WHERE pubchem_cid = ? OR structure_key = ? OR name_key = ? OR lower(trim(json_extract(payload, \'$.identifier\'))) = ?').bind(String(compound.cid),compound.inchiKey,key,`pubchem cid ${compound.cid}`).first<any>();
    const existing = await find();
    if (existing) {
      const old=JSON.parse(existing.payload);
      if ((old.inchiKey||old.pubchem?.inchiKey)===compound.inchiKey) {
        await importCatalogRecord({catalogId:'PUBCHEM'+compound.cid,name:compound.name,kind:'Other',inchiKey:compound.inchiKey,pubchem:compound,sources:[{database:'PubChem',identifier:String(compound.cid),url:compound.sourceUrl,retrievedAt:new Date().toISOString()}]});
        const current:any=await env.DB!.prepare('SELECT payload FROM molecules WHERE id = ?').bind(existing.id).first();
        return Response.json({duplicate:true,molecule:{...JSON.parse(current.payload),id:existing.id},message:'Existing molecule found. PubChem source retained; notes and analyses preserved.'});
      }
      return Response.json({duplicate:true,molecule:{...old,id:existing.id},message:'Name or identifier collision: review the existing record. No records were merged.'});
    }
    const now = new Date().toISOString(), id = crypto.randomUUID();
    const molecule = {name:compound.name,kind:'Other',stage:'Candidate',identifier:`PubChem CID ${compound.cid}`,target:'',source:compound.sourceUrl,notes:'Imported molecular identity only. No antimicrobial activity or MIC is inferred.',pubchem:compound,importedAt:now,sources:[{database:'PubChem',identifier:String(compound.cid),url:compound.sourceUrl,retrievedAt:now}]};
    try {
      await env.DB!.prepare('INSERT INTO molecules (id, name_key, structure_key, pubchem_cid, created, updated, payload) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id,key,compound.inchiKey,String(compound.cid),now,now,JSON.stringify(molecule)).run();
    } catch(e) {
      if (String(e).includes('UNIQUE')) {const match=await find();if(match)return Response.json({duplicate:true,molecule:{...JSON.parse(match.payload),id:match.id},message:'Already in your library. No duplicate was created.'});}
      throw e;
    }
    return Response.json({duplicate:false,molecule:{...molecule,id,created:now,updated:now},message:'Imported from PubChem.'},{status:201});
  } catch(e) {
    return Response.json({error:e instanceof PubChemError ? e.message : 'Import failed. Please try again.'},{status:e instanceof PubChemError ? e.status : 503});
  }
}
