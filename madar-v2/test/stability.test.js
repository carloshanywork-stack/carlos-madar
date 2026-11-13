import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, symlink, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'madar-stability-'));
Object.assign(process.env,{NODE_ENV:'test',STORAGE_MOUNT_PATH:'',MADAR_V2_DATABASE_PATH:join(root,'data/db.sqlite'),MADAR_V2_DATA_DIR:join(root,'data'),MADAR_V2_STORAGE_ROOT:join(root,'storage'),MADAR_V2_BACKUP_ROOT:join(root,'backups')});
const [{db},{initializeDatabase},backup,events,retention]=await Promise.all([
 import('../server/database/connection.js'),import('../server/database/init.js'),import('../server/modules/system/backup.js'),import('../server/modules/operations-events.js'),import('../server/modules/system/backup-retention.js')]);
initializeDatabase({initialAdminPassword:'isolated-stability-password'});
after(async()=>{db.close();await rm(root,{recursive:true,force:true});});

test('verified new full backup replaces old; failed creation preserves last good archive; CRC failure blocks replacement',async()=>{
 await mkdir(join(root,'storage'),{recursive:true});await writeFile(join(root,'storage','evidence.txt'),'immutable evidence');
 const a=await backup.createSystemBackup();assert.equal(a.verification.crcVerified,true);
 await new Promise(resolve=>setTimeout(resolve,5));const b=await backup.createSystemBackup();
 assert.equal(b.retention.removedBackups,1);assert.deepEqual((await backup.listSystemBackups()).map(x=>x.filename),[b.filename]);
 await symlink('/does-not-exist',join(root,'storage','forbidden-link'));
 await assert.rejects(backup.createSystemBackup(),/symbolic links/);
 assert.equal((await backup.listSystemBackups())[0].filename,b.filename);await rm(join(root,'storage','forbidden-link'));
 const original=await readFile(join(root,'backups',b.filename));const corrupt=Buffer.from(original);
 // Corrupt the ZIP local data/metadata, leaving the original intact.
 let central=corrupt.indexOf(Buffer.from('504b0102','hex'));
 while(corrupt.readUInt32LE(central+24)===0) central=corrupt.indexOf(Buffer.from('504b0102','hex'),central+4);
 corrupt[central+16]^=1;const broken=join(root,'broken.zip');await writeFile(broken,corrupt);
 await assert.rejects(retention.verifyBackupArchive(broken));
 assert.deepEqual(await readFile(join(root,'backups',b.filename)),original);
 await writeFile(join(root,'backups','operator-recovery.zip'),'preserve');
 await retention.retainLatestBackup(join(root,'backups'),b.filename);
 assert.ok((await readdir(join(root,'backups'))).includes('operator-recovery.zip'));
 assert.equal(retention.backupByteLimit(),64*1024**3);assert.throws(()=>retention.backupByteLimit('0'));
});

test('domain commit survives lost response/restart, rollback emits nothing, failed delivery retries once',()=>{
 events.flushPendingOperationsEvents();const before=events.getOperationsEventsAfter(0,{limit:10000}).at(-1)?.id??0;
 const observed=[];const unsubscribe=events.subscribeOperationsEvents(e=>observed.push(e));
 assert.throws(()=>db.transaction(()=>{events.enqueueOperationsEvent('rep.visit.submitted',{visitUuid:'rolled-back'},db);throw Error('rollback');})());
 assert.equal(db.prepare("SELECT COUNT(*) n FROM operations_event_outbox WHERE payload_json LIKE '%rolled-back%'").get().n,0);
 const child = spawnSync(process.execPath, ['--input-type=module','-e', `
 const {db}=await import(${JSON.stringify(new URL('../server/database/connection.js',import.meta.url).href)});
 const {enqueueOperationsEvent}=await import(${JSON.stringify(new URL('../server/modules/operations-events.js',import.meta.url).href)});
 db.transaction(()=>enqueueOperationsEvent('rep.visit.submitted',{visitUuid:'lost-response'},db))();
 process.exit(73); // Commit completed; no HTTP response or dispatch can run.
 `], {env:process.env,encoding:'utf8',timeout:10000});
 assert.equal(child.status,73,child.stderr);
 assert.equal(observed.length,0,'no uncommitted or pre-delivery fan-out');
 db.exec("CREATE TRIGGER isolated_delivery_failure BEFORE INSERT ON operations_events BEGIN SELECT RAISE(ABORT,'fixture'); END");
 assert.ok(events.flushPendingOperationsEvents().error);assert.equal(db.prepare('SELECT COUNT(*) n FROM operations_event_outbox').get().n,1);
 db.exec('DROP TRIGGER isolated_delivery_failure');assert.equal(events.flushPendingOperationsEvents().delivered,1);
 assert.equal(events.flushPendingOperationsEvents().delivered,0);
 assert.equal(events.getOperationsEventsAfter(before).filter(e=>e.visitUuid==='lost-response').length,1);
 unsubscribe();
});

test('maintenance triggers queue in the same transaction and rollback safely',()=>{
 events.flushPendingOperationsEvents();
 db.transaction(()=>db.prepare("UPDATE machines SET updated_at=CURRENT_TIMESTAMP").run())();
 // Exercise actual trigger using the existing required machine fields from schema.
 const columns=db.prepare('PRAGMA table_info(machines)').all();assert.ok(columns.length);
 const before=db.prepare('SELECT COUNT(*) n FROM operations_event_outbox').get().n;
 assert.throws(()=>db.transaction(()=>{db.prepare("INSERT INTO machines(code,name_ar,area) VALUES ('ISOLATED-STABILITY','test','test')").run();throw Error('rollback');})());
 assert.equal(db.prepare('SELECT COUNT(*) n FROM operations_event_outbox').get().n,before);
 db.prepare("INSERT INTO machines(code,name_ar,area) VALUES ('ISOLATED-STABILITY','test','test')").run();
 assert.equal(db.prepare("SELECT COUNT(*) n FROM operations_event_outbox WHERE publication_key='maintenance.reconcile'").get().n,1);
 assert.ok(events.flushPendingOperationsEvents().delivered>=1);
});

test('chunk recovery reloads once, preserves offline operation and never loops without storage',async()=>{
 globalThis.__MADAR_BUILD_VERSION__='fixture';const {installChunkRecovery}=await import('../client/src/lib/chunk-recovery.js');
 let handler;let reloads=0;let prevented=0;const values=new Map();
 const target={addEventListener:(n,h)=>{assert.equal(n,'vite:preloadError');handler=h;},navigator:{onLine:true},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},location:{reload:()=>reloads++}};
 installChunkRecovery(target);handler({preventDefault:()=>prevented++});handler({preventDefault:()=>prevented++});assert.equal(reloads,1);assert.equal(prevented,1);
 values.clear();target.navigator.onLine=false;handler({preventDefault:()=>prevented++});assert.equal(reloads,1);
 target.navigator.onLine=true;target.sessionStorage.getItem=()=>{throw Error('blocked');};handler({});assert.equal(reloads,1);
});

test('actual HTTP missing assets return 404 while SPA navigation remains usable',async()=>{
 const {app}=await import('../server/app.js');const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const missing=await fetch(base+'/assets/isolated-missing.js');assert.equal(missing.status,404);assert.doesNotMatch(missing.headers.get('content-type'),/html/);
  const page=await fetch(base+'/maintenance');assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-cache/);assert.match(await page.text(),/<html/);
  assert.equal((await fetch(base+'/api/isolated-missing')).status,401);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
