// Disposable SQLite only; no production startup, HTTP, files, or services.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'madar-audit-events-'));
Object.assign(process.env, {
  NODE_ENV: 'test', STORAGE_MOUNT_PATH: '', COOKIE_SECURE: 'false',
  MADAR_V2_DATABASE_PATH: join(root,'db.sqlite'), MADAR_V2_DATA_DIR: root,
  MADAR_V2_STORAGE_ROOT: join(root,'storage'), MADAR_V2_BACKUP_ROOT: join(root,'backups'),
  MADAR_V2_OFFLINE_MAP_PATH: join(root,'map.mbtiles'),
  MADAR_V2_JWT_SECRET: 'isolated-audit-events-fixture-32-byte-key',
});
const {initializeDatabase} = await import('../../madar-v2/server/database/init.js');
const {db} = await import('../../madar-v2/server/database/connection.js');
const {publishOperationsEvent, getOperationsEventsAfter, subscribeOperationsEvents} = await import('../../madar-v2/server/modules/operations-events.js');
initializeDatabase({initialAdminPassword:''});
const checks=[];
try {
  db.exec('DELETE FROM operations_events');
  const insert=db.prepare("INSERT INTO operations_events(event_id,event_type,payload_json,occurred_at) VALUES(?,'fixture','{}',CURRENT_TIMESTAMP)");
  db.transaction(()=>{for(let i=1;i<10250;i++) insert.run(i);})();
  const event=publishOperationsEvent('fixture.last',{userId:1});
  const bounds=db.prepare('SELECT min(event_id) oldest,max(event_id) newest,count(*) count FROM operations_events').get();
  assert.ok(bounds.oldest>1);
  const replay=getOperationsEventsAfter(1,{limit:10000});
  assert.ok(replay.length>0 && replay[0].id>2);
  checks.push({id:'EVT-TEST-01',result:'observed',retained:bounds,requestedCursor:1,firstReplayId:replay[0].id,resetMarkerPresent:replay.some(x=>x.type==='cursor.reset'),meaning:'Stale cursor silently receives retained suffix; periodic authoritative API reconciliation is required.'});
  const delivered=[];const unsub=subscribeOperationsEvents(e=>delivered.push(e));
  db.exec("CREATE TRIGGER fixture_reject_event BEFORE INSERT ON operations_events BEGIN SELECT RAISE(ABORT,'fixture event persistence unavailable'); END");
  const count=db.prepare('SELECT count(*) n FROM operations_events').get().n;
  const fallback=publishOperationsEvent('fixture.persistence-failed',{userId:1});
  unsub();assert.equal(delivered.length,1);assert.equal(typeof fallback.id,'string');
  assert.equal(db.prepare('SELECT count(*) n FROM operations_events').get().n,count);
  assert.ok(!getOperationsEventsAfter(bounds.newest).some(e=>e.type==='fixture.persistence-failed'));
  checks.push({id:'EVT-TEST-02',result:'observed',liveDelivered:true,persisted:false,idType:typeof fallback.id,meaning:'Persistence error is swallowed and produces non-replayable live notification; source business routes publish after service commit.'});
  console.log(JSON.stringify({isolated:true,checks},null,2));
} finally { db.close(); }
