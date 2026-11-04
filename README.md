# Bactesign

A local research workspace for culture imaging, reviewed zone measurements, dilution MIC endpoints and molecular discovery records.

## Run locally

Requires Node.js 22.13+. Run `npm run install:ci` and `npm run build`. Apply pending SQL files in `drizzle/` once, in order, using:

```
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/FILENAME.sql
```

For an existing database upgraded to the source-index schema, run the same command with `--file scripts/backfill-source-index.sql` after schema migrations. This data backfill is idempotent. Start with `npm run dev` on localhost:5173. Local and hosted D1/R2 storage are separate.

## Expanded molecule database

The local database has 12,969 saved molecule records: 11,972 with DRAMP references, 994 with ChEMBL references and 981 with PubChem references. Source counts overlap. Search and source/stage filtering happen in the database, with 24 records per page; the browser does not fetch the complete library. The legacy unpaged list is capped at 100 suggestions for analysis entry. Use the library to find any molecule and choose Analyze this molecule to prefill an assay.

Public source attribution, data licenses and selection are documented in data/SOURCES.md. The larger reference snapshot is distributed separately as bactesign-reference-collection.jsonl.gz. To load it into a fresh running local app after database migrations:

```
node scripts/import-reference-collection.mjs /absolute/path/to/bactesign-reference-collection.jsonl.gz
```

Reimports combine exact full InChIKey/source-ID matches, retain all source links, and preserve research notes. Name collisions do not silently merge identities. Peptides with unverified chemical identities remain separate. DRAMP sequences, modifications and literature references are source annotations, not your own experimental results. The bundled 370-entry starter collection remains available under Starter collection tools.

## Imaging and 3D

Upload PNG/JPEG/WebP images (8 MB maximum), mark opposite plate edges against a known diameter, then opposite zone edges. Review the measurement and quality controls before saving. Dilution MIC entry checks monotonic growth/clear patterns and flags unresolved endpoints. Results persist in D1; images persist in R2. Results can be searched and exported as CSV.

Molecule details include an interactive 3Dmol.js view for PubChem-linked compounds when PubChem provides a 3D conformer. Rotate/zoom with mouse or touch, use auto-spin/display styles, and download 3D SDF. Missing structures are explicitly identified. Computed conformers are not experimentally established bound structures.

## Scientific scope

This unvalidated research app does not diagnose organisms, infer MIC from zone diameters, apply clinical susceptibility categories, predict efficacy, or give therapeutic recommendations. Unknown samples require independent identification. No literature activity value is presented as a Bactesign measurement. See EUCAST methodology: https://www.eucast.org/bacteria/methodology-and-instructions/.

## Verification and publication

Build and TypeScript checks passed. Verified pagination through the last page, full-library search, source filters, source metadata persistence, duplicate protection, live 3D viewing and prior assay save/reload. The private Site registration is retained in .openai/hosting.json; publication remains blocked by the earlier Sites credential-handoff approval rejection. No production deployment is verified. Local records and the reference snapshot must be loaded into any new hosted database separately.
