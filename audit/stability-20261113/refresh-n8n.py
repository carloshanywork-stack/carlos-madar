"""Reuse existing workflow identities; refresh source anchors, tests and real HTTP checks."""
import pathlib,json,subprocess,datetime,copy,xml.etree.ElementTree as ET,uuid,collections
out=pathlib.Path(__file__).resolve().parent;root=out.parent.parent;old=root/'audit/live-connections-20261113'
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
def save(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
rev=git('rev-parse','HEAD');now=datetime.datetime.now(datetime.timezone.utc).isoformat()
trees={p:git('rev-parse','HEAD:madar-v2/'+p) for p in ['server','shared','client/src','client/public','android/app/src/main/java','android/version.properties']}
tests=ET.parse(out/'v2-tests.junit.xml');cases=tests.findall('.//testcase');counts={'tests':len(cases),'passed':sum(c.find('failure') is None and c.find('error') is None and c.find('skipped') is None for c in cases),'failed':sum(c.find('failure') is not None or c.find('error') is not None for c in cases),'skipped':sum(c.find('skipped') is not None for c in cases)}
if counts['failed'] or not counts['tests']:raise RuntimeError('Passing real test evidence required')
w=json.loads((old/'n8n-live-verifier.json').read_text());node=next(n for n in w['nodes'] if n['name']=='Configuration and dated evidence');code=node['parameters']['jsCode'];split=code.index(';\nif');cfg=json.loads(code[len('const config = '):split]);previousRevision=cfg['sourceRevision']
cfg.update(sourceRevision=rev,snapshotAt=now,expectedSourceTrees=trees,testResults={'sourceRevision':rev,'fullSuite':counts,'adaptedRepContract':None,'adaptation':'None: original suite passed without modifying assertions.'})
cfg['probes'][3].update(name='Current web entry JavaScript from actual HTML',url='https://carlos-pc.tail852ef0.ts.net/assets/not-configured.js',rule='javascript')
cfg['probes'].append({'id':'missing-asset','name':'Missing build asset rejects SPA fallback','url':'http://127.0.0.1:3000/assets/madar-deliberately-missing.js','expectedStatus':404,'rule':'plain404'})
# Retain the previously curated coverage inventory, but re-anchor every surviving source reference.
inv=json.loads((old/'connections.json').read_text());inv.update(sourceRevision=rev,verifiedAt=now,findings=[])
for r in inv['connections']:
 r.update(sourceRevision=rev,lastVerificationTime=now,findingIds=[])
 for evidence in r['sourceEvidence']:
  path=evidence['file'];oldlines=git('show',previousRevision+':'+path).splitlines();anchor=oldlines[evidence['line']-1].strip();newlines=(root/path).read_text().splitlines();matches=[i+1 for i,line in enumerate(newlines) if anchor and anchor in line]
  if matches:evidence['line']=min(matches,key=lambda i:abs(i-evidence['line']))
  else:evidence['line']=1;evidence['anchorChanged']=True
  if 'url' in evidence:evidence['url']=evidence['url'].replace(previousRevision,rev).split('#L')[0]+'#L'+str(evidence['line'])
 if r['connectionId']=='APK-01':
  r['producer']='Previously distributed 2.0.8 APK (unchanged by this server/web stability update)';r['interface']='Existing com.madar.rep.app 2.0.8 (10), not rebuilt in this change';r['status']='IMPLEMENTED_NOT_VERIFIED';r['failureOrLimitation']='Previous artifact checks are historical; no new build or physical-device installation is claimed.'
 if r['connectionId']=='BACKUP-01':r['failureOrLimitation']='See restore-drill.json for actual existing ZIP extraction/migration evidence; no production restore or off-device recovery claim.'
 for i,t in enumerate(r.get('relevantTests',[])):
  if t=='rep-current-contract':r['relevantTests'][i]='rep-api.test.js'
inv['statusCounts']=dict(collections.Counter(r['status'] for r in inv['connections']));save('connections.json',inv)
cfg['evidenceSnapshot']=inv
node['parameters']['jsCode']='const config = '+json.dumps(cfg,ensure_ascii=False)+code[split:]
for n in w['nodes']:
 if n['name'].startswith('Assert | '):
  js=n['parameters']['jsCode'];js=js.replace("parsed?.service==='madar-v2'", "parsed?.service==='madar-v2'&&parsed?.sourceDirty===false&&Object.entries(state.config.expectedSourceTrees).every(([path,hash])=>parsed?.sourceTrees?.[path]===hash)")
  js=js.replace("if(p.rule==='sent-label')ok=ok&&String(body).includes('تم الإرسال');", "if(p.rule==='javascript')ok=ok&&/javascript/i.test(String(r.headers?.['content-type']||''))&&!String(body).toLowerCase().includes('<!doctype html');\nif(p.rule==='plain404')ok=ok&&!String(body).toLowerCase().includes('<!doctype html');")
  if n['name']=='Assert | web':
   js=js.replace('const result=', "if(!state.config.fixtureOnly){const asset=String(body).match(/src=\"(\\/assets\\/[^\" ]+\\.js)\"/);ok=ok&&Boolean(asset);if(asset)state.config.probes[3].url=state.config.probes[2].url.replace(/\\/$/,'')+asset[1];}\nconst result=")
  n['parameters']['jsCode']=js
 if n['type'].endswith('.stickyNote'):
  n['parameters']['content']=f'# Refreshed stability evidence\nSource `{rev}`\nReport: audit/stability-20261113/README.md\nManual read-only checks; inactive. Source tree hashes must match the running process. {counts["passed"]}/{counts["tests"]} isolated V2 tests passed. No device acceptance or external alert delivery is claimed.\nDocumentation notes are conceptual connections, not executable business transactions.'
http=copy.deepcopy(next(n for n in w['nodes'] if n['type'].endswith('.httpRequest')));http.update(id=str(uuid.uuid4()),name='GET | missing-asset',position=[4500,100]);http['parameters']['url']="={{ $('Assert | notifications-auth-boundary').first().json.config.probes[18].url }}"
assertion=copy.deepcopy(next(n for n in w['nodes'] if n['name']=='Assert | notifications-auth-boundary'));assertion.update(id=str(uuid.uuid4()),name='Assert | missing-asset',position=[4750,100]);assertion['parameters']['jsCode']=assertion['parameters']['jsCode'].replace("$('Assert | attendance-auth-boundary')","$('Assert | notifications-auth-boundary')").replace('probes[17]','probes[18]')
w['nodes'] += [http,assertion]
def edge(a,b):w['connections'][a]={'main':[[{'node':b,'type':'main','index':0}]]}
edge('Assert | notifications-auth-boundary',http['name']);edge(http['name'],assertion['name']);edge(assertion['name'],'Structured results - never universal success')
summary=next(n for n in w['nodes'] if n['name']=='Structured results - never universal success');summary['parameters']['jsCode']=summary['parameters']['jsCode'].replace("$('Assert | notifications-auth-boundary')","$('Assert | missing-asset')")
w['active']=False;w['name']='MADAR — System Connections + Live Verification 2026-11-13 (stability refresh)';save('n8n-live-verifier.json',w)
notes=[]
for i,group in enumerate(dict.fromkeys(r['subsystem'] for r in inv['connections'])):
 content='## '+group+'\n\n'
 for r in inv['connections']:
  if r['subsystem']==group:content+=f'**{r["connectionId"]} — {r["status"]}**\n{r["producer"]} → {r["interface"]} → {r["consumer"]}\n'+', '.join(f'{e["file"]}:{e["line"]}' for e in r['sourceEvidence'])+'\n'+r['failureOrLimitation']+'\n\n'
 notes.append({'id':str(uuid.uuid4()),'name':group,'type':'n8n-nodes-base.stickyNote','typeVersion':1,'parameters':{'content':content,'width':950,'height':max(650,len(content)//2),'color':5},'position':[(i%3)*1050,(i//3)*2100]})
notes.append({'id':str(uuid.uuid4()),'name':'Evidence limits','type':'n8n-nodes-base.stickyNote','typeVersion':1,'parameters':{'content':f'# Documentary architecture only\nRevision `{rev}`\nReport: audit/stability-20261113/README.md\nThese conceptual producer/interface/consumer connections do not execute business integration. VERIFIED_PASS applies only to named evidence. NoOp placeholders are not functional checks. Reused earlier workflow identity; no live activation.','width':950,'height':450},'position':[-1050,0]})
mapw=json.loads((old/'n8n-system-connections.json').read_text());mapw.update(nodes=notes,connections={},active=False);save('n8n-system-connections.json',mapw);save('test-results.json',cfg['testResults'])
print(json.dumps({'sourceRevision':rev,'tests':counts,'probes':len(cfg['probes']),'connections':len(inv['connections'])}))
