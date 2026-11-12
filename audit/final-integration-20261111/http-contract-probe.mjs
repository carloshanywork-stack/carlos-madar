// Only a fresh fixture DB/storage; actual APK read-only; never connects to production.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=mkdtempSync(join(tmpdir(),'madar-audit-http-'));
Object.assign(process.env,{NODE_ENV:'test',COOKIE_SECURE:'false',STORAGE_MOUNT_PATH:'',
 MADAR_V2_DATABASE_PATH:join(root,'db.sqlite'),MADAR_V2_DATA_DIR:root,
 MADAR_V2_STORAGE_ROOT:join(root,'storage'),MADAR_V2_BACKUP_ROOT:join(root,'backups'),
 MADAR_V2_OFFLINE_MAP_PATH:join(root,'map.mbtiles'),
 MADAR_V2_JWT_SECRET:'isolated-http-contract-fixture-32-byte-key'});
// No APK override: independently test source default selection using existing files.
delete process.env.MADAR_REP_APK_PATH;
const {app}=await import('../../madar-v2/server/app.js');
const {initializeDatabase}=await import('../../madar-v2/server/database/init.js');
const {db}=await import('../../madar-v2/server/database/connection.js');
const {createSession}=await import('../../madar-v2/server/modules/auth/service.js');
const {repApkPath}=await import('../../madar-v2/server/config/paths.js');
initializeDatabase({initialAdminPassword:''});
const tokens={}; const ids={};
for(const role of ['admin','rep','operations']) {
 const id=Number(db.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)').run('fixture-'+role,'unused','Fixture',role).lastInsertRowid);
 ids[role]=id;tokens[role]=createSession({id,username:'fixture-'+role,role});
}
const server=app.listen(0,'127.0.0.1');
await new Promise((yes,no)=>{server.once('listening',yes);server.once('error',no);});
const base='http://127.0.0.1:'+server.address().port;
const checks=[];
async function check(id,path,role,expected,options={}) {
 const response=await fetch(base+path,{...options,headers:role?{authorization:'Bearer '+tokens[role]}:{},signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,expected,id);checks.push({id,path,role:role??'anonymous',status:response.status,passed:true});return response;
}
try {
 await check('HTTP-01','/download/apk',null,401);
 await check('HTTP-02','/download/apk','operations',403);
 const status=await check('HTTP-03','/download/apk/status','admin',200);
 assert.equal((await status.json()).artifactType,'fallback');
 const apk=await check('HTTP-04','/download/apk','rep',200);
 const bytes=Buffer.from(await apk.arrayBuffer());
 const hash=x=>createHash('sha256').update(x).digest('hex');
 assert.equal(hash(bytes),hash(readFileSync(repApkPath)));
 checks.at(-1).sha256=hash(bytes);checks.at(-1).selectedArtifact=repApkPath;
 await check('HTTP-05','/api/system/audit','rep',403);
 await check('HTTP-06','/api/supervisor/radar','operations',403);
 await check('HTTP-07','/api/auth/logout','rep',200,{method:'POST'});
 await check('HTTP-08','/api/rep/today-route','rep',401);
 db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(ids.admin);
 await check('HTTP-09','/download/apk/status','admin',401);
 console.log('AUDIT_RESULT '+JSON.stringify({isolated:true,checks,liveAuthenticatedArtifactDownloadVerified:false}));
} finally {await new Promise(r=>server.close(r));db.close();}
