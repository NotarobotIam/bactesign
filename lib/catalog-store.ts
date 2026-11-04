import {env} from 'cloudflare:workers';
export type SourceRecord={database:string;identifier:string;url:string;retrievedAt:string;license?:string;details?:Record<string,string>};
export type CatalogRecord={catalogId:string;name:string;kind:string;inchiKey?:string;pubchem?:any;smiles?:string;sequence?:string;sources:SourceRecord[]};
export async function importCatalogRecord(entry:CatalogRecord):Promise<'added'|'enriched'|'unchanged'> {
 const db=env.DB!;const cid=entry.pubchem?.cid?String(entry.pubchem.cid):null;
 const structure=entry.inchiKey||null;
 // Match complete chemical identity or an existing source record. Names alone never merge identities.
 const find=async()=>{
  const identity=await db.prepare('SELECT id, payload FROM molecules WHERE (? IS NOT NULL AND structure_key = ?) OR (? IS NOT NULL AND pubchem_cid = ?)').bind(structure,structure,cid,cid).first<any>();
  if(identity)return identity;
  for(const source of entry.sources){const record=await db.prepare('SELECT m.id, m.payload FROM molecules m JOIN molecule_sources s ON s.molecule_id = m.id WHERE s.source_key = ?').bind(source.database+':'+source.identifier).first<any>();if(record)return record;}
  return null;
 };
 const remember=async(id:string)=>{if(entry.sources.length)await db.batch(entry.sources.map(s=>db.prepare('INSERT OR IGNORE INTO molecule_sources (source_key,database_name,identifier,molecule_id) VALUES (?,?,?,?)').bind(s.database+':'+s.identifier,s.database,s.identifier,id)));};
 const match=await find(),now=new Date().toISOString();
 if(match){
  const old=JSON.parse(match.payload);const sources:SourceRecord[]=[...(old.sources||[])];
  if(old.pubchem&&!sources.some(s=>s.database==='PubChem'&&s.identifier===String(old.pubchem.cid)))sources.push({database:'PubChem',identifier:String(old.pubchem.cid),url:old.pubchem.sourceUrl,retrievedAt:old.importedAt||now});
  let changed=false;
  for(const source of entry.sources){if(!sources.some(s=>s.database===source.database&&s.identifier===source.identifier)){sources.push(source);changed=true;}}
  const preferredPubchem = entry.pubchem && (!old.pubchem || entry.pubchem.cid < old.pubchem.cid) ? entry.pubchem : old.pubchem;
  if(preferredPubchem?.cid!==old.pubchem?.cid)changed=true;
  if(!changed){await remember(match.id);return 'unchanged';}
  const updated={...old,sources,pubchem:preferredPubchem,smiles:old.smiles||entry.smiles,sequence:old.sequence||entry.sequence,inchiKey:old.inchiKey||structure};
  await db.prepare('UPDATE molecules SET payload = ?, updated = ?, structure_key = COALESCE(structure_key, ?), pubchem_cid = ? WHERE id = ?').bind(JSON.stringify(updated),now,structure,preferredPubchem?String(preferredPubchem.cid):null,match.id).run();await remember(match.id);return 'enriched';
 }
 let name=entry.name.trim().slice(0,250),nameKey=name.toLowerCase().replace(/\s+/g,' ');
 const conflict=await db.prepare('SELECT id FROM molecules WHERE name_key = ?').bind(nameKey).first();
 if(conflict){name+=` [${entry.sources[0].database} ${entry.sources[0].identifier}]`;nameKey=name.toLowerCase().replace(/\s+/g,' ');}
 const payload={name,kind:entry.kind,stage:'Candidate',identifier:entry.sources.map(s=>`${s.database} ${s.identifier}`).join('; ').slice(0,300),target:'',source:entry.sources[0].url,notes:'Reference-library import. No assay measurements or efficacy claims are inferred.',sources:entry.sources,importedAt:now,pubchem:entry.pubchem,smiles:entry.smiles,sequence:entry.sequence,inchiKey:structure};
 const newId=crypto.randomUUID();
 try{await db.prepare('INSERT INTO molecules (id, name_key, structure_key, pubchem_cid, created, updated, payload) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(newId,nameKey,structure,cid,now,now,JSON.stringify(payload)).run();await remember(newId);return 'added';}
 catch(e){if(String(e).includes('UNIQUE')&&await find())return importCatalogRecord(entry);throw e;}
}
