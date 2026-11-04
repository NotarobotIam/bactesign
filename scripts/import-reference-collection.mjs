import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/import-reference-collection.mjs <collection.jsonl.gz>');
const records=gunzipSync(readFileSync(file)).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
for(let offset=0;offset<records.length;offset+=50){const r=await fetch('http://127.0.0.1:5173/api/catalog/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(records.slice(offset,offset+50))});if(!r.ok)throw Error(await r.text());const d=await r.json();if(offset%500===0||offset+50>=records.length)console.log(Math.min(offset+50,records.length)+'/'+records.length,d);}
