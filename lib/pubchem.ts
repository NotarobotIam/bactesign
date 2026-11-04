export type PubChemCompound = { cid: number; name: string; formula: string; molecularWeight: string; inchiKey: string; sourceUrl: string };
export class PubChemError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function lookupPubChem(query: string, cidOnly = false): Promise<PubChemCompound[]> {
  if (!query || query.length > 120 || (cidOnly && !/^[1-9]\d{0,11}$/.test(query))) throw new PubChemError('Enter a molecule name or a positive PubChem CID.', 400);
  const domain = cidOnly || /^\d+$/.test(query) ? 'cid' : 'name';
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${domain}/${encodeURIComponent(query)}/property/Title,MolecularFormula,MolecularWeight,InChIKey/JSON`;
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } }); }
  catch { throw new PubChemError('PubChem could not be reached. Please try again.', 502); }
  if (r.status === 404) throw new PubChemError('No compound found. Try an exact name or PubChem CID.', 404);
  if (r.status === 429 || r.status === 503) throw new PubChemError('PubChem is busy. Wait a moment before trying again.', 503);
  if (!r.ok) throw new PubChemError('PubChem returned an error. Try an exact compound name or CID.', 502);
  const body: any = await r.json();
  const rows = body.PropertyTable?.Properties;
  if (!Array.isArray(rows) || !rows.length) throw new PubChemError('No compound properties were returned.', 502);
  return rows.slice(0, 10).map((p: any) => {
    if (!Number.isSafeInteger(p.CID) || p.CID <= 0 || !/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(p.InChIKey)) throw new PubChemError('PubChem returned incomplete identity information.', 502);
    return { cid: p.CID, name: String(p.Title || `PubChem CID ${p.CID}`).slice(0, 300), formula: String(p.MolecularFormula || ''), molecularWeight: String(p.MolecularWeight || ''), inchiKey: p.InChIKey, sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}` };
  });
}
