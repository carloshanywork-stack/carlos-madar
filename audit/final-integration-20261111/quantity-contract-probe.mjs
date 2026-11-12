// Source service boundary only, disposable database. No production startup/files/data.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'madar-audit-quantities-'));
Object.assign(process.env,{NODE_ENV:'test',STORAGE_MOUNT_PATH:'',MADAR_V2_DATABASE_PATH:join(root,'db.sqlite'),MADAR_V2_DATA_DIR:root,MADAR_V2_STORAGE_ROOT:join(root,'storage'),MADAR_V2_BACKUP_ROOT:join(root,'backups'),MADAR_V2_OFFLINE_MAP_PATH:join(root,'map.mbtiles'),MADAR_V2_JWT_SECRET:'isolated-quantity-contract-fixture-32-byte-key'});
const {db}=await import('../../madar-v2/server/database/connection.js');
const {initializeDatabase}=await import('../../madar-v2/server/database/init.js');
const {syncRepVisit}=await import('../../madar-v2/server/modules/rep/service.js');
initializeDatabase({initialAdminPassword:''});
try {
 const columns=table=>db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);
 let result;
 try {await syncRepVisit({id:1,role:'rep'},{reasonQuantities:[{reasonId:1,quantity:2}]},[]);assert.fail('unexpected accepted quantity field');}
 catch(e) {assert.equal(e.status,400);assert.match(e.message,/Unsupported field: reasonQuantities/);result={httpEquivalentStatus:e.status,error:e.message};}
 console.log(JSON.stringify({isolated:true,scope:'actual service field whitelist and initialized schema only; no invented quantity contract or full valid-visit submission',result,maintenanceReasonColumns:columns('maintenance_reasons'),visitColumns:columns('rep_visits'),finding:'BIZ-002',capabilityStatus:'NOT_IMPLEMENTED'},null,2));
}finally{db.close();}
