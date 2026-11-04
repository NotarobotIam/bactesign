import {importCatalogRecord,CatalogRecord} from '../../../../lib/catalog-store';
const hosts:Record<string,string>={PubChem:'pubchem.ncbi.nlm.nih.gov',ChEMBL:'www.ebi.ac.uk',DRAMP:'dramp.cpu-bioinfor.org'};
export async function POST(req:Request){
 try{
  const text=await req.text();if(text.length>2000000)return Response.json({error:'Batch exceeds 2 MB'},{status:413});
  const records=JSON.parse(text);if(!Array.isArray(records)||!records.length||records.length>100)return Response.json({error:'Send between 1 and 100 source records.'},{status:400});
  for(const r of records){
   if(!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>1000||!['Other','Peptide','Antibiotic','Therapeutic','Antibody'].includes(r.kind)||!Array.isArray(r.sources)||!r.sources.length||r.sources.length>10)throw Error('Invalid source record');
   if(r.inchiKey&&!/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(r.inchiKey))throw Error('Invalid identity key');
   for(const s of r.sources){if(!hosts[s.database]||typeof s.identifier!=='string'||s.identifier.length>100||new URL(s.url).protocol!=='https:'||new URL(s.url).hostname!==hosts[s.database])throw Error('Invalid source attribution');}
   if(r.pubchem&&(!Number.isSafeInteger(r.pubchem.cid)||r.pubchem.cid<=0||r.pubchem.inchiKey!==r.inchiKey||r.pubchem.sourceUrl!==`https://pubchem.ncbi.nlm.nih.gov/compound/${r.pubchem.cid}`))throw Error('Invalid PubChem identity');
  }
  const counts={added:0,enriched:0,unchanged:0};for(const r of records as CatalogRecord[])counts[await importCatalogRecord(r)]++;
  return Response.json({...counts,processed:records.length});
 }catch(e){return Response.json({error:'Bulk import failed. Check source records and retry; existing records are retained.'},{status:400});}
}
