import json,uuid,pathlib,datetime
out=pathlib.Path(__file__).parent
rev='26a9f6549ece44e0f17c50e453c23a0fc076071a'
def node(name,typ,version,params,pos): return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,name)),'name':name,'type':'n8n-nodes-base.'+typ,'typeVersion':version,'parameters':params,'position':pos}
def workflow(name,id,nodes,edges): return {'name':name,'id':id,'active':False,'nodes':nodes,'connections':{a:{'main':[[{'node':b,'type':'main','index':0}]]} for a,b in edges},'settings':{'executionOrder':'v1','timezone':'Africa/Cairo'},'pinData':{},'tags':[]}
config=r"""// Explicit configuration: edit only these non-secret values after import.
const config = {
  operationalBaseUrl: 'http://127.0.0.1:18181',
  resultBaseUrl: 'http://127.0.0.1:18181',
  expectedRevision: 'REVISION',
  maxResultAgeMinutes: 60,
  maxFutureSeconds: 60,
  requiredChecks: ['v2-suite','artifact-correspondence','failure-injection','restore-drill'],
  fixtureOnly: true,
  reportPath: 'audit/final-integration-20261111/README.md'
};
for (const key of ['operationalBaseUrl','resultBaseUrl']) {
  const value=config[key];
  if (!/^https:\/\/[^\s]+$/.test(value) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(value)) throw new Error('BLOCKED_PREREQUISITE: use HTTPS or an explicit loopback fixture URL');
  if (value.includes('@') || value.includes('?') || value.endsWith('/')) throw new Error('BLOCKED_PREREQUISITE: URL must have no credentials, query, or trailing slash');
}
if (!/^[0-9a-f]{40}$/.test(config.expectedRevision)) throw new Error('BLOCKED_PREREQUISITE: exact source SHA required');
if (!(config.maxResultAgeMinutes>0 && config.maxResultAgeMinutes<=1440)) throw new Error('BLOCKED_PREREQUISITE: bounded freshness required');
return [{json:config}];""".replace('REVISION',rev)
health="""const response=$input.first().json;
const check={id:'N8N-OP-01',status:response.statusCode===200 && response.body?.status==='ok' && response.body?.service==='madar-v2' ? 'VERIFIED_PASS':'VERIFIED_FAIL', evidence:{httpStatus:response.statusCode??null,service:response.body?.service??null},scope:'direct read-only HTTP health; does not establish deployment revision'};
if(check.status!=='VERIFIED_PASS') throw new Error(JSON.stringify({overall:'VERIFIED_FAIL',checks:[check],error:response.error?'request failed':null}));
return [{json:{checkedAt:new Date().toISOString(),checks:[check],fixtureOnly:$('Configuration').first().json.fixtureOnly}}];"""
aggregate="""const cfg=$('Configuration').first().json;
const prior=$('Validate operational response').first().json;
const response=$input.first().json;
const report=response.body;
const problems=[];
if(response.statusCode!==200) problems.push('runner HTTP status is not 200 (or credential/network prerequisite missing)');
if(!report || report.schemaVersion!==1) problems.push('runner schemaVersion must equal 1');
if(report?.sourceRevision!==cfg.expectedRevision) problems.push('source revision mismatch');
if(report?.fixtureOnly!==cfg.fixtureOnly) problems.push('fixture provenance mismatch');
if(report?.provenance!==(cfg.fixtureOnly?'synthetic-fixture':'ci-runner')) problems.push('result provenance mismatch');
const age=Date.now()-Date.parse(report?.verifiedAt??'');
if(!Number.isFinite(age)||age>cfg.maxResultAgeMinutes*60000||age < -cfg.maxFutureSeconds*1000) problems.push('stale, future, or invalid result time');
if(typeof report?.runId!=='string'||!report.runId||typeof report?.evidenceUrl!=='string'||!/^https?:\\/\\//.test(report.evidenceUrl)) problems.push('runner runId and evidence URL required');
const checks=Array.isArray(report?.checks)?report.checks:[];
const ids=checks.map(c=>c.id);
if(new Set(ids).size!==ids.length) problems.push('duplicate check identifiers');
for(const id of cfg.requiredChecks){const c=checks.find(c=>c.id===id);if(!c||c.status!=='VERIFIED_PASS'||typeof c.evidence!=='string'||!c.evidence) problems.push('required check missing, failed, blocked, or without evidence: '+id);}
const validStatuses=['VERIFIED_PASS','VERIFIED_FAIL','IMPLEMENTED_NOT_VERIFIED','NOT_IMPLEMENTED','BLOCKED_PREREQUISITE','NOT_APPLICABLE'];
if(checks.some(c=>!validStatuses.includes(c.status))) problems.push('unknown check status');
const summary={schemaVersion:1,overall:problems.length?'VERIFIED_FAIL':'VERIFIED_PASS',scope:cfg.fixtureOnly?'synthetic fixture verifies workflow mechanics only':'authenticated revision-bound runner result plus direct health',fixtureOnly:cfg.fixtureOnly,sourceRevision:cfg.expectedRevision,checkedAt:new Date().toISOString(),checks:[...prior.checks,...checks],runner:{runId:report?.runId??null,evidenceUrl:report?.evidenceUrl??null,verifiedAt:report?.verifiedAt??null},limitations:['n8n consumes external runner evidence; it does not execute CI, compile APKs, or operate devices','health alone does not prove deployment source correspondence','runner service and evidence integrity remain trust prerequisites','no alert destination is configured; no schedule is included'],problems};
if(problems.length) throw new Error(JSON.stringify(summary));
return [{json:summary}];"""
def http(name,url,pos,auth=False):
 n=node(name,'httpRequest',4.2,{'method':'GET','url':url,'options':{'timeout':5000,'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'json'}}}},pos)
 n.update({'retryOnFail':True,'maxTries':2,'waitBetweenTries':1000,'onError':'continueRegularOutput'})
 if auth:
  n['parameters'].update({'authentication':'genericCredentialType','genericAuthType':'httpHeaderAuth'})
  n['credentials']={'httpHeaderAuth':{'id':'MADAR_AUDIT_RESULT_HEADER_AUTH','name':'MADAR Audit Result Header Auth'}}
 return n
nodes=[node('Manual safe entry','manualTrigger',1,{},[0,0]),node('Configuration','code',2,{'jsCode':config},[220,0]),http('Read operational health',"={{ $('Configuration').first().json.operationalBaseUrl + '/api/health' }}",[440,0]),node('Validate operational response','code',2,{'jsCode':health},[660,0]),http('Read authenticated release result',"={{ $('Configuration').first().json.resultBaseUrl + '/audit/release-result' }}",[880,0],True),node('Validate revision-bound release evidence','code',2,{'jsCode':aggregate},[1100,0]),node('Prerequisites and scope','stickyNote',1,{'content':'## Executable release verifier — inactive, manual only\nTarget n8n 2.46.7. Configure URLs and fixtureOnly in Configuration. Select a Header Auth credential on the runner request. All requests GET, timeout 5s, at most 2 attempts. Health failure stops release evidence fetch. No shell, build, installation, workflow activation, business writes, or alerts. CI results must come from an authenticated trusted external runner with exact revision + evidence. Default target is an isolated fixture, not MADAR production. See n8n.md.','width':1000,'height':230},[0,-280])]
wf=workflow('MADAR final audit — authenticated release evidence verifier','MadarFinalAuditRelease20261111',nodes,[(nodes[i]['name'],nodes[i+1]['name']) for i in range(5)])
(out/'n8n-executable-verifier.json').write_text(json.dumps(wf,ensure_ascii=False,indent=2)+'\n')
ops=workflow('MADAR final audit — fast operational HTTP check','MadarFinalAuditOps20261111',nodes[:4]+[node('Operational scope','stickyNote',1,{'content':'## Fast check only\nManual, inactive, read-only GET /api/health. Passing means this endpoint responds as MADAR V2; it proves neither source revision nor business/release readiness. No schedule, alerts, or credentials are needed for the intentionally public health route. Never add business mutations. See n8n.md.','width':760,'height':200},[0,-240])],[(nodes[i]['name'],nodes[i+1]['name']) for i in range(3)])
(out/'n8n-operational-verifier.json').write_text(json.dumps(ops,ensure_ascii=False,indent=2)+'\n')
notes=[('Evidence legend','## Documentation workflow — not executable business integration\nAudited '+rev+'\nReport: audit/final-integration-20261111/README.md\nSticky Notes group source connections; arrows in note text are conceptual only. There are no executable diagram wires or noOp nodes. VERIFIED_PASS requires actual evidence; IMPLEMENTED_NOT_VERIFIED means source only; VERIFIED_FAIL means observed failure; BLOCKED_PREREQUISITE means required evidence/access missing. Parent connection inventory is authoritative for final status.\nReuses the scope, domain groups and boundary warnings of the prior MADAR_V2_FULL_LIFECYCLE_ARCHITECTURE export; replaces stale statuses and noOp diagram representation.'),('Server and roles','## Server / access\nUser action → UI → authenticated HTTP routes → services → SQLite and configured storage → response/events → client refresh.\nSource: madar-v2/server/index.js; server/modules/auth; server/modules/rep/routes.js; server/modules/supervisor/routes.js.\nIMPLEMENTED_NOT_VERIFIED here; see business and deployment inventories for tested contract-specific verdicts.\nHealth GET is operational responsiveness, never release identity proof.'),('Field operations','## Android / offline queues\nProposal → pending approval → approved coordinates → dependent visit.\nOffline attendance → durable action → authenticated sync → review/payroll.\nVisit + evidence → native/IDB queue → sync-visit → supervisor approval/reshoot → route refresh.\nGPS → stable points → upload after duty end → per-point acknowledgments → cleanup.\nSource: madar-v2/android/app/src/main; client/src; server/modules/rep/service.js.\nIMPLEMENTED_NOT_VERIFIED at device level; physical-device acceptance BLOCKED_PREREQUISITE until device evidence exists. See android.md.'),('Maintenance and money','## Maintenance / inventory / finance\nSelected reason quantities → persisted business records → approved analytics → PPTX.\nInvoice creation → liability/receivable; separate receipt/payment → transaction → treasury + settlement + audit. Retry uses stable operation identity.\nWhole main units → transactional remainder offcut → secondary warehouse.\nSource: server/modules/maintenance; server/modules/finance; server/modules/warehouse; test/phase4-finance.test.js.\nSee business.md for actual tests and connection verdicts; source existence alone IMPLEMENTED_NOT_VERIFIED.'),('Events and recovery','## Events / storage / restore\nCommitted operation → event persistence/fan-out → SSE → receiving client API reconciliation. Closed-app push is a separate capability.\nSQLite snapshot + storage → local ZIP → isolated restore → migrations → integrity + relations + files.\nSource: server/modules/operations-events.js; server/modules/system/backup.js; server/database.\nOff-device protection and production restore drill BLOCKED_PREREQUISITE without authorized operational evidence.'),('Release chain','## Source / build / distributed artifact\nApproved Git SHA → web/native build → signed APK hash → server-selected APK download → installed version + preserved pending work.\nSource: android/app/build.gradle; scripts/build-android.js; server/config/paths.js; APK download route.\nIndividual hash/version evidence is separate from source/build correspondence. Physical upgrade test BLOCKED_PREREQUISITE without suitable device.'),('n8n connections','## n8n verified boundaries\nN8N-01: existing CI workflow → Execute Command → local script. IMPLEMENTED_NOT_VERIFIED for current operation; historic execution metadata exists.\nN8N-02: active-labelled biometric workflow → four noOp nodes. VERIFIED_FAIL: no patch/build/ADB/release executes.\nN8N-03: new manual verifier → real GET health + credential-authenticated revision-bound runner evidence. Runtime status in n8n.md.\nN8N-04: workflow summary → external alert destination. NOT_IMPLEMENTED / unconfigured; execution success is not alert delivery.\nN8N-05: local DB active fields → scheduler. BLOCKED_PREREQUISITE for observed live execution; no scheduler process observed.\nEvidence: sanitized n8n-live-inventory.json; n8n.md. No production workflow changed.')]
ns=[node(name,'stickyNote',1,{'content':content,'width':680,'height':430},[(i%3)*730,(i//3)*480]) for i,(name,content) in enumerate(notes)]
(out/'n8n-evidence-map.json').write_text(json.dumps(workflow('MADAR final audit — DOCUMENTATION evidence map','MadarFinalAuditMap20261111',ns,[]),ensure_ascii=False,indent=2)+'\n')
# Reconcile documentary notes with authoritative connection inventories available at generation time.
# This deliberately avoids inventing pass statuses from source existence.
inventory_nodes=[]
for label,filename in [('Android and offline','android-connections.json'),('Server business','business-connections.json'),('Operations, events, legacy and Flow','operations-connections.json'),('n8n boundaries','n8n-connections.json')]:
 p=out/filename
 if not p.exists(): continue
 records=json.loads(p.read_text())
 if isinstance(records,dict): records=records.get('connections',[])
 for start in range(0,len(records),4):
  entries=[]
  for r in records[start:start+4]:
   cid=r.get('connection_id',r.get('connectionId','?'))
   entries.append('### '+cid+' — '+r.get('status','IMPLEMENTED_NOT_VERIFIED')+'\n'+r.get('producer','')+' → '+r.get('consumer','')+'\nInterface: '+str(r.get('interface',''))+'\nEvidence: '+str(r.get('source_evidence',''))+'\nLimits: '+str(r.get('failure_or_limitation',''))+'\nTests: '+', '.join(r.get('relevant_test_ids',[]))+'; findings: '+', '.join(r.get('relevant_finding_ids',[])))
  i=len(inventory_nodes)+1
  inventory_nodes.append(node(label+' '+str(start//4+1),'stickyNote',1,{'content':'## '+label+'\n\n'+'\n\n'.join(entries),'width':850,'height':950},[(i%3)*900,(i//3)*1000]))
legend=node('Evidence legend','stickyNote',1,{'content':'## Documentary evidence map — not executable business integration\nAudit SHA '+rev+'\nFinal report: audit/final-integration-20261111/README.md\nThis map uses conceptual arrows in note text only. No executable connections, triggers, noOp, schedules, credentials or calls exist. Each connection ID/status/evidence comes directly from the named audit inventories; definitive detail and limitations remain in those files. Notes group Android, server business, operations/Flow/legacy and n8n. VERIFIED_PASS applies only to each stated verification scope, never universal release readiness.\nPrevious architecture-map domain boundaries reused; stale labels and conceptual noOp representation replaced. Live workflows preserved.','width':850,'height':650},[0,0])
if inventory_nodes:
 (out/'n8n-evidence-map.json').write_text(json.dumps(workflow('MADAR final audit — DOCUMENTATION evidence map','MadarFinalAuditMap20261111',[legend]+inventory_nodes,[]),ensure_ascii=False,indent=2)+'\n')
