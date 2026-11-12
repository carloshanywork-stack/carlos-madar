import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'madar-audit-settlement-'));
Object.assign(process.env,{NODE_ENV:'test',STORAGE_MOUNT_PATH:'',MADAR_V2_DATABASE_PATH:join(root,'db.sqlite'),MADAR_V2_DATA_DIR:join(root,'data'),MADAR_V2_STORAGE_ROOT:join(root,'storage'),MADAR_V2_BACKUP_ROOT:join(root,'backups'),MADAR_V2_JWT_SECRET:'audit-only-temporary-jwt-secret-32characters'});
const {db}=await import('../../madar-v2/server/database/connection.js');
const {initializeDatabase}=await import('../../madar-v2/server/database/init.js');
const {recordSalesReceipt,recordPurchasePayment}=await import('../../madar-v2/server/modules/finance/invoices.service.js');
const {createTreasuryEntry}=await import('../../madar-v2/server/modules/finance/treasury.service.js');
try {
initializeDatabase({initialAdminPassword:'Isolated-audit-only-password!'});
const actor=db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
for(const kind of ['sales','purchase']){
const id=Number(db.prepare(`INSERT INTO invoices(code,kind,subtotal_cents,total_cents,paid_total_cents,remaining_cents,payment_status,status) VALUES(?,?,10000,10000,0,10000,'unpaid','approved')`).run('AUDIT-'+kind,kind).lastInsertRowid);
if(kind==='purchase')createTreasuryEntry({kind:'income',category:'audit fixture',amountCents:20000},actor);
const fn=kind==='sales'?recordSalesReceipt:recordPurchasePayment;
const first=fn(id,{amountCents:1000,notes:'same request; first response deliberately discarded'},actor);
const second=fn(id,{amountCents:1000,notes:'same request; first response deliberately discarded'},actor);
console.log(JSON.stringify({check:kind+' identical retry after discarded committed response',firstTreasury:first.treasuryEntry.id,secondTreasury:second.treasuryEntry.id,paid:second.invoice.paid_total_cents,remaining:second.invoice.remaining_cents,entries:db.prepare('SELECT COUNT(*) n FROM treasury_entries WHERE invoice_id=?').get(id).n,audits:db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type='invoice' AND entity_id=?").get(id).n,status:'VERIFIED_FAIL',expectedPaid:1000}));
try{fn(id,{amountCents:1000,operationId:'stable-id'},actor);console.log('unexpected operationId accepted');}catch(e){console.log(JSON.stringify({check:kind+' stable operation identity contract',httpStatus:e.status,message:e.message}));}
}
}finally{db.close();rmSync(root,{recursive:true,force:true});}
