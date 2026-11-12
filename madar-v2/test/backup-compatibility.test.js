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
