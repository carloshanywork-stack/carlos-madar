// Read-only source ZIP, disposable DB/storage only; no production API or restore endpoint.
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
const [archive,temporaryParent]=process.argv.slice(2);
if(!archive||!temporaryParent)throw Error('Usage: node scripts/restore-drill.mjs <existing.zip> <temporary-parent>');
const stage=await mkdtemp(join(resolve(temporaryParent),'.madar-restore-drill-'));
Object.assign(process.env,{NODE_ENV:'test',STORAGE_MOUNT_PATH:'',MADAR_V2_BACKUP_MOUNT_PATH:'',MADAR_INITIAL_ADMIN_PASSWORD:'',MADAR_V2_DATA_DIR:join(stage,'runtime'),MADAR_V2_DATABASE_PATH:join(stage,'runtime','db.sqlite'),MADAR_V2_STORAGE_ROOT:join(stage,'runtime-storage'),MADAR_V2_BACKUP_ROOT:join(stage,'runtime-backups')});
let runtime;let restored;
try {
 const [{db},{initializeDatabase},backup,{verifyBackupArchive}]=await Promise.all([
 import('../server/database/connection.js'),import('../server/database/init.js'),import('../server/modules/system/backup.js'),import('../server/modules/system/backup-retention.js')]);
 runtime=db;initializeDatabase();
 const verification=await verifyBackupArchive(resolve(archive));
 const extracted=join(stage,'extracted');await mkdir(extracted);
 const files=await backup.extractBackupArchive(resolve(archive),extracted);
 const original=new Database(files.databaseFile,{readonly:true});
 const tables=['users','maintenance_orders','maintenance_cards','rep_visits','invoices','audit_log'].filter(name=>original.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const counts=Object.fromEntries(tables.map(name=>[name,original.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n]));original.close();
 const migrated=await backup.prepareRestorableSnapshot(files.databaseFile,{stageDirectory:extracted});
 restored=new Database(migrated,{readonly:true});
 for(const [name,n] of Object.entries(counts))if(restored.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n!==n)throw Error('Historical row counts changed during migration.');
 const integrity=restored.pragma('integrity_check',{simple:true}),foreignKeys=restored.pragma('foreign_key_check').length;
 if(integrity!=='ok'||foreignKeys)throw Error('Restored integrity/relationship validation failed.');
 // Re-open/migrate the already migrated database to establish repeatability.
 const again=await backup.prepareRestorableSnapshot(migrated,{stageDirectory:extracted});new Database(again,{readonly:true}).close();
 console.log(JSON.stringify({status:'VERIFIED_PASS',checkedAt:new Date().toISOString(),sourceArchiveReadOnly:true,isolatedExtraction:true,allArchiveEntriesCRCVerified:true,verification,integrity,foreignKeyViolations:foreignKeys,domainTableCountsPreserved:counts,migrationRepeated:true,productionRestorePerformed:false,offDeviceRecoveryVerified:false,physicalDeviceVerified:false}));
} finally {
 restored?.close();runtime?.close();await rm(stage,{recursive:true,force:true});
}
