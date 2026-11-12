"""Run installed n8n only in a disposable user-folder/SQLite, using synthetic HTTP data.
Never reads production credentials or configuration. No production mutations.
"""
import pathlib,tempfile,subprocess,os,json,threading,http.server,datetime,uuid,sqlite3
out=pathlib.Path(__file__).resolve().parent
rev='26a9f6549ece44e0f17c50e453c23a0fc076071a'
state={'fail':False,'requests':[]}
class Fixture(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  state['requests'].append({'path':self.path,'authenticated':self.headers.get('X-Audit-Fixture')=='synthetic-fixture-only'})
  if self.path=='/api/health': data={'status':'ok','service':'madar-v2','fixtureOnly':True};code=200
  elif self.path=='/audit/release-result':
   if self.headers.get('X-Audit-Fixture')!='synthetic-fixture-only': data={'error':'fixture credential required'};code=401
   else:
    data={'schemaVersion':1,'sourceRevision':rev,'fixtureOnly':True,'provenance':'synthetic-fixture','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':'synthetic-success-or-deliberate-failure','evidenceUrl':'http://127.0.0.1:18181/fixture-evidence','checks':[{'id':x,'status':'VERIFIED_FAIL' if state['fail'] and x=='failure-injection' else 'VERIFIED_PASS','evidence':'SYNTHETIC FIXTURE: validates workflow mechanics, not MADAR behavior'} for x in ['v2-suite','artifact-correspondence','failure-injection','restore-drill']]+[{'id':'physical-device','status':'BLOCKED_PREREQUISITE','evidence':'No suitable physical device was exercised by this verifier'}]};code=200
  else: data={'error':'not found'};code=404
  body=json.dumps(data).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args): pass
server=http.server.HTTPServer(('127.0.0.1',18181),Fixture)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
with tempfile.TemporaryDirectory(prefix='madar-audit-n8n-') as tmp:
 # Disallow inherited production DB / n8n settings. Keep only execution prerequisites.
 env={k:v for k,v in os.environ.items() if not(k.startswith(('N8N_','DB_','QUEUE_','EXECUTIONS_')))}
 env.update({'N8N_USER_FOLDER':tmp,'DB_TYPE':'sqlite','DB_SQLITE_DATABASE':tmp+'/audit.sqlite','N8N_ENCRYPTION_KEY':uuid.uuid4().hex,'N8N_DIAGNOSTICS_ENABLED':'false','N8N_VERSION_NOTIFICATIONS_ENABLED':'false','N8N_TEMPLATES_ENABLED':'false','N8N_PERSONALIZATION_ENABLED':'false','N8N_PORT':'18282','N8N_RUNNERS_BROKER_PORT':'18283','N8N_LOG_LEVEL':'error','N8N_BLOCK_ENV_ACCESS_IN_NODE':'true','N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS':'true'})
 records=[]
 def run(label,args):
  try:
   p=subprocess.run(['/usr/local/bin/n8n']+args,cwd=tmp,env=env,text=True,capture_output=True,timeout=90)
   # Fixture runs contain no real secrets/customer data; redact any synthetic encryption key defensively.
   output=(p.stdout+'\n'+p.stderr).replace(env['N8N_ENCRYPTION_KEY'],'[REDACTED TEST KEY]')
   (out/('n8n-runtime-'+label+'.log')).write_text(output)
   records.append({'step':label,'exitCode':p.returncode,'log':'n8n-runtime-'+label+'.log'})
   return p.returncode,output
  except subprocess.TimeoutExpired:
   records.append({'step':label,'timeoutSeconds':90});return -1,''
 for file in ['n8n-evidence-map.json','n8n-operational-verifier.json','n8n-executable-verifier.json']:
  code,log=run('import-'+file[:-5],['import:workflow','--input='+str(out/file),'--activeState=false'])
  if code: break
 else:
  credential=pathlib.Path(tmp)/'fixture-credentials.json'
  credential.write_text(json.dumps([{'id':'MADAR_AUDIT_RESULT_HEADER_AUTH','name':'MADAR Audit Result Header Auth','type':'httpHeaderAuth','data':{'name':'X-Audit-Fixture','value':'synthetic-fixture-only'}}]))
  code,log=run('import-fixture-credential',['import:credentials','--input='+str(credential)])
  if code==0:
   run('operational-success',['execute','--id=MadarFinalAuditOps20261111','--rawOutput'])
   run('release-success',['execute','--id=MadarFinalAuditRelease20261111','--rawOutput'])
   state['fail']=True
   run('deliberate-failure',['execute','--id=MadarFinalAuditRelease20261111','--rawOutput'])
  c=sqlite3.connect('file:'+tmp+'/audit.sqlite?mode=ro',uri=True)
  records.append({'importedWorkflows':[{'id':r[0],'name':r[1],'active':bool(r[2])} for r in c.execute('select id,name,active from workflow_entity')]})
  records.append({'executions':[{'id':r[0],'workflowId':r[1],'status':r[2]} for r in c.execute('select id,workflowId,status from execution_entity')]})
  c.close()
 server.shutdown()
 records.append({'fixtureRequests':state['requests']})
 (out/'n8n-runtime-results.json').write_text(json.dumps({'runtime':'n8n 2.46.7','sourceRevision':rev,'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'isolation':'disposable /tmp user-folder and SQLite; loopback HTTP fixture; synthetic credential only','records':records},indent=2)+'\n')
 print(json.dumps(records,indent=2))
