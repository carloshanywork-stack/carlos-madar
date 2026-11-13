"""Use disposable n8n SQLite only; real HTTP probes are GET, fixture failures synthetic."""
import pathlib,tempfile,subprocess,os,json,threading,http.server,datetime,uuid,sqlite3,hashlib
out=pathlib.Path(__file__).resolve().parent
reportDir=pathlib.Path(os.environ.get('MADAR_N8N_RESULTS_DIR',str(out)));reportDir.mkdir(parents=True,exist_ok=True)
state={'fail':False,'requests':[]}
workflow=json.loads((out/'n8n-live-verifier.json').read_text())
cfgNode=next(n for n in workflow['nodes'] if n['name']=='Configuration and dated evidence')
original=cfgNode['parameters']['jsCode'];prefix='const config = ';split=original.index(';\nif')
config=json.loads(original[len(prefix):split]);probes={p['id']:p for p in config['probes']}
class Fixture(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  id=self.path.removeprefix('/probe/');p=probes.get(id);state['requests'].append({'id':id,'deliberateFailure':state['fail']})
  if not p:body=b'not found';code=404;content='text/plain'
  else:
   code=p['expectedStatus'];content='application/json';r=p['rule']
   if state['fail'] and id=='local-api':body=json.dumps({'status':'broken','service':'deliberately-failing-fixture'}).encode();code=503
   elif r=='madar':body=json.dumps({'status':'ok','service':'madar-v2','synthetic':True,'sourceDirty':False,'sourceTrees':config['expectedSourceTrees']}).encode()
   elif r=='n8n':body=b'{"status":"ok"}'
   elif r=='auth':body=b'{"error":"Authentication required."}'
   elif r=='html':body=b'<!doctype html><html><body>synthetic fixture</body></html>';content='text/html'
   else:body='/* synthetic fixture */ تم الإرسال'.encode();content='application/javascript; charset=utf-8'
  self.send_response(code);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
server=http.server.HTTPServer(('127.0.0.1',18481),Fixture);threading.Thread(target=server.serve_forever,daemon=True).start()
records=[]
with tempfile.TemporaryDirectory(prefix='madar-connections-n8n-') as tmp:
 env={k:v for k,v in os.environ.items() if not k.startswith(('N8N_','DB_','QUEUE_','EXECUTIONS_'))}
 env.update({'N8N_USER_FOLDER':tmp,'DB_TYPE':'sqlite','DB_SQLITE_DATABASE':tmp+'/audit.sqlite','N8N_ENCRYPTION_KEY':uuid.uuid4().hex,'N8N_DIAGNOSTICS_ENABLED':'false','N8N_VERSION_NOTIFICATIONS_ENABLED':'false','N8N_TEMPLATES_ENABLED':'false','N8N_PERSONALIZATION_ENABLED':'false','N8N_PORT':'18482','N8N_RUNNERS_BROKER_PORT':'18483','N8N_LOG_LEVEL':'error','N8N_BLOCK_ENV_ACCESS_IN_NODE':'true','N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS':'true'})
 def run(label,args,timeout=180):
  p=subprocess.run(['/usr/local/bin/n8n']+args,cwd=tmp,env=env,text=True,capture_output=True,timeout=timeout)
  log=(p.stdout+'\n'+p.stderr).replace(env['N8N_ENCRYPTION_KEY'],'[REDACTED TEMP KEY]');(reportDir/('runtime-'+label+'.log')).write_text(log)
  records.append({'step':label,'exitCode':p.returncode,'log':'runtime-'+label+'.log'});return p.returncode
 fixture=json.loads(json.dumps(workflow));fixture['id']='MadarConnectionsFixture20261113';fixture['name']='SYNTHETIC FIXTURE — not MADAR behavior';fc=json.loads(json.dumps(config));fc['fixtureOnly']=True
 for p in fc['probes']:p['url']='http://127.0.0.1:18481/probe/'+p['id']
 next(n for n in fixture['nodes'] if n['name']=='Configuration and dated evidence')['parameters']['jsCode']=prefix+json.dumps(fc,ensure_ascii=False)+original[split:]
 fixturePath=pathlib.Path(tmp)/'fixture.json';fixturePath.write_text(json.dumps(fixture,ensure_ascii=False))
 if run('import-map',['import:workflow','--input='+str(out/'n8n-system-connections.json'),'--activeState=false'])!=0:raise RuntimeError('Map import failed')
 if run('import-live',['import:workflow','--input='+str(out/'n8n-live-verifier.json'),'--activeState=false'])!=0:raise RuntimeError('Verifier import failed')
 if run('import-email',['import:workflow','--input='+str(out/'n8n-email-alert.json'),'--activeState=false'])!=0:raise RuntimeError('Email definition import failed')
 if run('import-fixture',['import:workflow','--input='+str(fixturePath),'--activeState=false'])!=0:raise RuntimeError('Fixture import failed')
 success=run('fixture-success',['execute','--id='+fixture['id'],'--rawOutput'])
 state['fail']=True;failure=run('fixture-deliberate-failure',['execute','--id='+fixture['id'],'--rawOutput']);state['fail']=False
 live=None if os.environ.get('MADAR_N8N_SKIP_LIVE')=='1' else run('actual-read-only-live-targets',['execute','--id='+workflow['id'],'--rawOutput'])
 emailBlocked=run('email-prerequisite-blocked',['execute','--id=MadarEmailAlert20261113','--rawOutput'])
 emailPrerequisiteBlocked=emailBlocked!=0 and 'BLOCKED_PREREQUISITE' in (reportDir/'runtime-email-prerequisite-blocked.log').read_text()
 d=sqlite3.connect('file:'+tmp+'/audit.sqlite?mode=ro',uri=True)
 executions=[{'id':r[0],'workflowId':r[1],'status':r[2],'startedAt':r[3],'stoppedAt':r[4]} for r in d.execute('SELECT id,workflowId,status,startedAt,stoppedAt FROM execution_entity ORDER BY id')]
 # Retain only output summaries from the serialized n8n execution object, never HTTP bodies.
 summaries=[]
 for execution in executions:
  row=d.execute('SELECT data FROM execution_data WHERE executionId=?',(execution['id'],)).fetchone()
  if row:
   raw=row[0]
   script="const f=require('/usr/local/lib/node_modules/n8n/node_modules/flatted');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let d=f.parse(s);let a=d.resultData?.runData?.['Structured results - never universal success'];if(a)console.log(JSON.stringify(a.at(-1).data.main[0][0].json));});"
   p=subprocess.run(['node','-e',script],input=raw,text=True,capture_output=True)
   if p.returncode==0 and p.stdout.strip():summaries.append({'executionId':execution['id'],'summary':json.loads(p.stdout)})
 d.close();server.shutdown()
 failureLog=(reportDir/'runtime-fixture-deliberate-failure.log').read_text()
 deliberate=next((s['summary'] for s in summaries if s['executionId']==executions[1]['id']),{})
 failedChecks=[c for c in deliberate.get('liveChecks',[]) if c['status']=='VERIFIED_FAIL']
 expectedFailure=success==0 and failure!=0 and 'REQUIRED_LIVE_CHECK_FAILED' in failureLog and len(failedChecks)==1 and failedChecks[0]['id']=='local-api' and failedChecks[0]['actualStatus']==503 and any(r['id']=='local-api' and r['deliberateFailure'] for r in state['requests'])
 result={'emailPrerequisiteBlocked':emailPrerequisiteBlocked,'alertDelivery':'BLOCKED_PREREQUISITE_NO_SMTP','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceRevision':config['sourceRevision'],'runtime':'n8n 2.46.7','isolation':'Disposable /tmp N8N_USER_FOLDER and SQLite, independent runner ports; all production-target checks are read-only GET. No production business writes, workflow activation or credentials used.','steps':records,'executions':executions,'summaries':summaries,'fixtureRequests':state['requests'],'fixtureSuccess':success==0,'deliberateFailureVisible':expectedFailure,'actualReadOnlyLiveTargets':'NOT_PERFORMED' if live is None else live==0,'artifactSha256':{f:hashlib.sha256((out/f).read_bytes()).hexdigest() for f in ['n8n-system-connections.json','n8n-live-verifier.json']}}
 (reportDir/'n8n-runtime-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:result[k] for k in ['fixtureSuccess','deliberateFailureVisible','actualReadOnlyLiveTargets','executions']},ensure_ascii=False))
 if success!=0 or not expectedFailure or live not in (None,0) or not emailPrerequisiteBlocked:raise SystemExit(1)
