import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
const root=mkdtempSync(join(tmpdir(),'madar-backup-compat-'));
process.env.MADAR_V2_DATABASE_PATH=join(root,'current.sqlite');
process.env.MADAR_V2_STORAGE_ROOT=join(root,'storage');
process.env.NODE_ENV='test';
const [{db},{initializeDatabase},{prepareRestorableSnapshot}]=await Promise.all([
 import('../server/database/connection.js'),import('../server/database/init.js'),import('../server/modules/system/backup.js'),
]);
initializeDatabase({initialAdminPassword:'Isolated-backup-compat-password'});
after(()=>{if(db.open)db.close();rmSync(root,{recursive:true,force:true});});

test('old backup is migrated in an isolated copy with IDs/history intact and original unchanged',async()=>{
 const source=join(root,'old.sqlite');await db.backup(source);
 const old=new Database(source);
 // This table was introduced by an additive, recorded migration.
 old.exec('DROP TABLE finance_settlement_operations');
 old.prepare('DELETE FROM schema_migrations WHERE version=?').run('20261112-finance-settlement-idempotency');
 const before=old.prepare('SELECT id,username FROM users ORDER BY id').all();old.close();
 const original=readFileSync(source);
 const restored=await prepareRestorableSnapshot(source);
 assert.notEqual(restored,source);assert.deepEqual(readFileSync(source),original);
 const checked=new Database(restored,{readonly:true});
 assert.deepEqual(checked.prepare('SELECT id,username FROM users ORDER BY id').all(),before);
 assert.equal(checked.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='20261112-finance-settlement-idempotency'").get().n,1);
 assert.equal(checked.pragma('integrity_check',{simple:true}),'ok');assert.equal(checked.pragma('foreign_key_check').length,0);
 assert.equal(checked.prepare('SELECT COUNT(*) AS n FROM finance_settlement_operations').get().n,0);checked.close();
 const again=await prepareRestorableSnapshot(restored);new Database(again).close();
});

test('newer migrations and corrupt snapshots are rejected without changing current data',async()=>{
 const source=join(root,'future.sqlite');await db.backup(source);
 const future=new Database(source);future.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run('20990101-future');future.close();
 const before=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
 await assert.rejects(prepareRestorableSnapshot(source),/newer|unsupported/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,before);
 await assert.rejects(prepareRestorableSnapshot(join(root,'absent.sqlite')));
});


test('a supported legacy data-import marker restores onto fresh V2 without rerunning the import',async()=>{
 const source=join(root,'legacy-import.sqlite');await db.backup(source);
 const historical=new Database(source);historical.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run('migrate-from-v1-data-v1');
 const ids=historical.prepare('SELECT id FROM users ORDER BY id').all();historical.close();
 const migrated=await prepareRestorableSnapshot(source);const checked=new Database(migrated,{readonly:true});
 assert.deepEqual(checked.prepare('SELECT id FROM users ORDER BY id').all(),ids);
 assert.equal(checked.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version='migrate-from-v1-data-v1'").get().n,1);checked.close();
});

test('schema compatibility ignores column order/SQL formatting but preserves CHECK constraints',async()=>{
 const {schemaFingerprint}=await import('../server/database/schema-compatibility.js');
 const a=new Database(':memory:'),b=new Database(':memory:'),bad=new Database(':memory:');
 try {
  a.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT CHECK(value IN ('A','B')))");
  b.exec("CREATE TABLE \"sample\"(value TEXT CHECK ( value IN ('A', 'B') ), id INTEGER PRIMARY KEY)");
  bad.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT CHECK(value IN ('A','B','C')))");
  assert.deepEqual(schemaFingerprint(a),schemaFingerprint(b));assert.notDeepEqual(schemaFingerprint(a),schemaFingerprint(bad));
 } finally {a.close();b.close();bad.close();}
});

test('historical column order and nullable machine metadata restore through actual authenticated HTTP with files',async()=>{
 const {ZipArchive}=await import('archiver');const {app}=await import('../server/app.js');
 const source=join(root,'historical-layout.sqlite');const historical=new Database(source);historical.pragma('foreign_keys=ON');
 historical.exec(`CREATE TABLE clients(id INTEGER PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,contact_name TEXT,phone TEXT,email TEXT,address TEXT,primary_color TEXT,secondary_color TEXT,logo_path TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
 CREATE TABLE machines(id INTEGER PRIMARY KEY,code TEXT NOT NULL UNIQUE COLLATE NOCASE,name_ar TEXT NOT NULL,name_en TEXT,area TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,latitude REAL,longitude REAL,is_location_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_location_locked IN (0,1)),geofence_radius_meters INTEGER NOT NULL DEFAULT 50 CHECK(geofence_radius_meters BETWEEN 1 AND 10000),area_name TEXT,maintenance_note TEXT NOT NULL DEFAULT '',updated_at TEXT);
 INSERT INTO machines(code,name_ar,area) VALUES ('LEGACY-RESTORE','legacy fixture','test');`);
 initializeDatabase({database:historical,initialAdminPassword:'Isolated-backup-compat-password'});
 historical.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run('migrate-from-v1-data-v1');historical.close();
 const zip=new ZipArchive();const chunks=[];const finished=new Promise((yes,no)=>{zip.on('data',c=>chunks.push(c));zip.on('end',yes);zip.on('error',no);});
 zip.append(Buffer.alloc(0),{name:'storage/'});zip.append('preserved evidence',{name:'storage/probe.txt'});zip.file(source,{name:'data/madar-v2.sqlite'});zip.append('{"format":"madar-v2-backup","version":1}',{name:'madar-v2-backup.json'});await zip.finalize();await finished;
 const server=app.listen(0,'127.0.0.1');await new Promise(yes=>server.once('listening',yes));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'Isolated-backup-compat-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];const form=new FormData();form.append('file',new Blob([Buffer.concat(chunks)],{type:'application/zip'}),'historical.zip');
  const response=await fetch(base+'/api/system/backup/restore',{method:'POST',headers:{cookie},body:form});assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(readFileSync(join(root,'storage/probe.txt'),'utf8'),'preserved evidence');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM machines WHERE code='LEGACY-RESTORE'").get().n,1);
  const machine=db.prepare("SELECT created_at,updated_at FROM machines WHERE code='LEGACY-RESTORE'").get();assert.equal(machine.updated_at,machine.created_at);
  assert.equal(db.pragma('foreign_key_check').length,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  assert.equal((await fetch(base+'/api/system/health',{headers:{cookie}})).status,401,'restore invalidates the old session');
 } finally {server.closeAllConnections();await new Promise(yes=>server.close(yes));}
});
