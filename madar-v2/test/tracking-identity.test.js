import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'madar-tracking-identity-'));
Object.assign(process.env,{NODE_ENV:'test',MADAR_V2_DATABASE_PATH:join(root,'db.sqlite'),MADAR_V2_STORAGE_ROOT:join(root,'storage')});
const [{db},{initializeDatabase},{syncRepLocationPing}]=await Promise.all([import('../server/database/connection.js'),import('../server/database/init.js'),import('../server/modules/rep/service.js')]);
initializeDatabase({initialAdminPassword:'Tracking-isolated-test-password'});
const repId=Number(db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES ('tracking-rep','test','Tracking Rep','rep')").run().lastInsertRowid);
const otherId=Number(db.prepare("INSERT INTO users(username,password_hash,full_name,role) VALUES ('tracking-other','test','Other Rep','rep')").run().lastInsertRowid);
const rep={id:repId,role:'rep'};
const now=Date.now();
const closedSession=Number(db.prepare('INSERT INTO rep_duty_sessions(rep_user_id,started_at,ended_at) VALUES (?,?,?)').run(repId,new Date(now-3600000).toISOString(),new Date(now-60000).toISOString()).lastInsertRowid);
const point={clientPointId:'device-A-point-1',latitude:30,longitude:31,accuracy:10,speed:0,updatedAt:new Date(now-120000).toISOString()};
after(()=>{db.close();rmSync(root,{recursive:true,force:true});});

test('late worker-shaped ingestion preserves closed duty and original session',()=>{
 const result=syncRepLocationPing(rep,{onDuty:true,trail:[point]},db);
 assert.equal(result.onDuty,false);assert.equal(result.acceptedPoints,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rep_duty_sessions WHERE rep_user_id=? AND ended_at IS NULL').get(repId).n,0);
 assert.equal(db.prepare('SELECT duty_session_id FROM rep_gps_points WHERE user_id=?').get(repId).duty_session_id,closedSession);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_daily_attendance').get().n,0);
});
test('receipt replay is idempotent and changed content conflicts without extra points',()=>{
 assert.equal(syncRepLocationPing(rep,{trail:[point]},db).duplicatePoints,1);
 const changed=syncRepLocationPing(rep,{trail:[{...point,latitude:30.5}]},db);
 assert.equal(changed.points[0].reason,'identity_conflict');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rep_gps_points').get().n,1);
});
test('distinct points at the same timestamp are retained and visible to supervisor queries',()=>{
 const result=syncRepLocationPing(rep,{trail:[{...point,clientPointId:'device-A-point-2',latitude:30.1}]},db);
 assert.equal(result.acceptedPoints,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rep_tracking_breadcrumbs WHERE user_id=?').get(repId).n,2);
});
test('another account cannot attach the point to the original representative session',()=>{
 const result=syncRepLocationPing({id:otherId,role:'rep'},{onDuty:true,trail:[point]},db);
 assert.equal(result.points[0].reason,'no_duty_session');assert.equal(result.onDuty,false);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rep_gps_receipts WHERE user_id=?').get(otherId).n,0);
});
