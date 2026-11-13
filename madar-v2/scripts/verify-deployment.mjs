const expected = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(expected ?? '')) throw new Error('Expected full source commit is required.');
const base = process.env.MADAR_V2_BASE_URL ?? 'http://127.0.0.1:3000';
async function response(path) {
  return fetch(new URL(path,base), {signal:AbortSignal.timeout(5000),cache:'no-store'});
}
let error;
for (let attempt=0;attempt<10;attempt++) {
  try {
    const health=await response('/api/health');const body=await health.json();
    if (!health.ok || body.status!=='ok' || body.sourceRevision!==expected || body.sourceDirty!==false) throw new Error('Running source does not match the clean approved revision.');
    const index=await response('/');if(!index.ok)throw new Error('Web entry failed.');
    const html=await index.text();
    const asset=html.match(/src="(\/assets\/[^" ]+\.js)"/);
    if(!asset)throw new Error('Web entry has no build asset.');
    const chunk=await response(asset[1]);
    if(!chunk.ok || !/javascript/.test(chunk.headers.get('content-type')??''))throw new Error('Web build asset is missing or has the wrong content type.');
    const missing=await response('/assets/madar-deliberately-missing.js');
    if(missing.status!==404)throw new Error('Missing asset did not return 404.');
    console.log(JSON.stringify({status:'VERIFIED_PASS',sourceRevision:expected,checks:4,checkedAt:new Date().toISOString()}));
    process.exit(0);
  } catch(cause) {error=cause; await new Promise(resolve=>setTimeout(resolve,1000));}
}
throw error;
