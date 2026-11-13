const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base='/usr/local/lib/node_modules/n8n/node_modules/n8n-nodes-base/dist/nodes';
const types={manualTrigger:['ManualTrigger/ManualTrigger.node.js','ManualTrigger'],code:['Code/Code.node.js','Code'],httpRequest:['HttpRequest/HttpRequest.node.js','HttpRequest'],stickyNote:['StickyNote/StickyNote.node.js','StickyNote'],emailSend:['EmailSend/EmailSend.node.js','EmailSend'],errorTrigger:['ErrorTrigger/ErrorTrigger.node.js','ErrorTrigger']};
const reports=[];
for(const file of ['n8n-system-connections.json','n8n-live-verifier.json','n8n-email-alert.json']){
 const w=JSON.parse(fs.readFileSync(path.join(__dirname,file)));const names=new Set(w.nodes.map(n=>n.name)),ids=new Set(w.nodes.map(n=>n.id));
 if(names.size!==w.nodes.length||ids.size!==w.nodes.length||w.active!==false)throw Error('unique nodes/inactive required');
 for(const n of w.nodes){
  const key=n.type.replace('n8n-nodes-base.',''),t=types[key];if(!t)throw Error('Unsupported or pretend node '+n.type);
  const Cls=require(path.join(base,t[0]))[t[1]],instance=new Cls();
  const versions=instance.nodeVersions?Object.keys(instance.nodeVersions).map(Number):[instance.description.version].flat();
  if(!versions.includes(n.typeVersion))throw Error('Installed node version mismatch '+n.name);
  if(key==='code'){
   new vm.Script('(async function(){'+n.parameters.jsCode+'})');
   for(const m of n.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g))if(!names.has(m[1]))throw Error('Missing node reference '+m[1]);
  }
  if(key==='httpRequest'){
   if(n.parameters.method!=='GET'||n.parameters.options.timeout!==5000||n.maxTries!==2||!n.parameters.options.response.response.fullResponse)throw Error('Unsafe or incomplete HTTP check');
   if(!n.parameters.url.startsWith('={{ ')||!n.parameters.url.endsWith(' }}'))throw Error('Missing URL expression');
   new vm.Script(n.parameters.url.slice(3,-2));
   for(const m of n.parameters.url.matchAll(/\$\('([^']+)'\)/g))if(!names.has(m[1]))throw Error('Missing expression reference');
  }
 }
 for(const [source,ports] of Object.entries(w.connections)){
  if(!names.has(source))throw Error('Missing source');
  for(const [type,outputs] of Object.entries(ports))for(const targets of outputs)for(const edge of targets)if(!names.has(edge.node)||edge.type!==type||edge.index!==0)throw Error('Bad edge');
 }
 const raw=JSON.stringify(w);
 if(/Bearer\s+[A-Za-z0-9_-]{12,}|BEGIN [A-Z ]*PRIVATE KEY|"password"\s*:|"apiKey"\s*:|"token"\s*:/.test(raw))throw Error('Potential embedded secret');
 if(file.includes('system-connections')&&w.nodes.some(n=>n.type!=='n8n-nodes-base.stickyNote'))throw Error('Evidence canvas is documentary');
 if(file.includes('live-verifier')){
  const cfg=w.nodes.find(n=>n.name==='Configuration and dated evidence').parameters.jsCode;
  for(const field of ['sourceRevision','maxSnapshotAgeMinutes','fixtureOnly','expectedStatus','testResults','alertsConfigured'])if(!cfg.includes(field))throw Error('Missing configuration '+field);
  if(!w.nodes.some(n=>n.name==='Fail execution if a required live check fails'))throw Error('Missing failure gate');
 }
 reports.push({file,jsonParsed:true,n8nVersion:'2.46.7',installedNodeTypesAndVersions:'PASS',codeAndExpressionSyntax:'PASS',referencesAndConnections:'PASS',secretScan:'PASS_NO_EMBEDDED_CREDENTIALS',inactive:true,nodes:w.nodes.length,realHttpRequests:w.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest').length});
}
fs.writeFileSync(path.join(__dirname,'n8n-static-validation.json'),JSON.stringify({verifiedAt:new Date().toISOString(),reports},null,2)+'\n');console.log(JSON.stringify(reports));
