import {lookupPubChem, PubChemError} from '../../../lib/pubchem';
export async function GET(req: Request) {
  try { return Response.json(await lookupPubChem((new URL(req.url).searchParams.get('q') || '').trim())); }
  catch(e) { return Response.json({error:e instanceof PubChemError ? e.message : 'Unable to search PubChem.'}, {status:e instanceof PubChemError ? e.status : 502}); }
}
