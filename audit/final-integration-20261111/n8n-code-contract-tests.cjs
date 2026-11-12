// Executes exported Code node logic in a Node VM. This is NOT n8n import/runtime evidence.
const fs=require('fs'),vm=require('vm'),path=require('path');
const out=__dirname,wf=JSON.parse(fs.readFileSync(path.join(out,'n8n-executable-verifier.json')));
const code=name=>wf.nodes.find(n=>n.name===name).parameters.jsCode;
function run(name,input,refs={}){return new vm.Script('(function(){'+code(name)+'})()').runInNewContext({$input:{first:()=>({json:input})},$:name=>({first:()=>({json:refs[name]})}),Date,JSON,Set,Number,Error});}
const cfg=run('Configuration',{})[0].json;
const health=run('Validate operational response',{statusCode:200,body:{status:'ok',service:'madar-v2'}},{Configuration:cfg})[0].json;
const good=()=>({statusCode:200,body:{schemaVersion:1,sourceRevision:cfg.expectedRevision,fixtureOnly:true,provenance:'synthetic-fixture',verifiedAt:new Date().toISOString(),runId:'node-vm-synthetic-fixture',evidenceUrl:'http://127.0.0.1:18181/fixture',checks:cfg.requiredChecks.map(id=>({id,status:'VERIFIED_PASS',evidence:'synthetic only'}))}});
const cases=[
 ['synthetic_success',r=>{},false],
 ['required_failure',r=>r.body.checks[0].status='VERIFIED_FAIL',true],
 ['wrong_revision',r=>r.body.sourceRevision='0'.repeat(40),true],
 ['stale_result',r=>r.body.verifiedAt='2020-01-01T00:00:00Z',true],
 ['future_result',r=>r.body.verifiedAt='2100-01-01T00:00:00Z',true],
 ['real_fixture_confusion',r=>r.body.fixtureOnly=false,true],
 ['wrong_provenance',r=>r.body.provenance='ci-runner',true],
 ['missing_check',r=>r.body.checks.pop(),true],
 ['duplicate_check',r=>r.body.checks.push({...r.body.checks[0]}),true],
 ['unknown_status',r=>r.body.checks[0].status='PASS',true],
 ['unauthenticated_runner',r=>r.statusCode=401,true],
 ['network_error',r=>{delete r.statusCode;delete r.body;r.error={message:'synthetic network error'}},true],
 ['device_blocked_preserved',r=>r.body.checks.push({id:'physical-device',status:'BLOCKED_PREREQUISITE',evidence:'no device'}),false]
];
const results=[];
for(const [id,mutate,expectThrow] of cases){const response=good();mutate(response);let thrown=false,summary;try{summary=run('Validate revision-bound release evidence',response,{Configuration:cfg,'Validate operational response':health})[0].json;}catch(e){thrown=true;try{summary=JSON.parse(e.message)}catch{summary={error:e.message}}}const passed=thrown===expectThrow;if(!passed)process.exitCode=1;results.push({id,status:passed?'VERIFIED_PASS':'VERIFIED_FAIL',expectedFailure:expectThrow,observedExecutionFailure:thrown,summaryOverall:summary.overall,fixtureOnly:summary.fixtureOnly,blockedDeviceRetained:summary.checks?.some(c=>c.id==='physical-device'&&c.status==='BLOCKED_PREREQUISITE')??false});}
for(const response of [{statusCode:503,body:{status:'error'}},{error:'synthetic timeout'}]){let failed=false;try{run('Validate operational response',response,{Configuration:cfg})}catch{failed=true}results.push({id:response.error?'health_timeout':'health_failure',status:failed?'VERIFIED_PASS':'VERIFIED_FAIL',observedExecutionFailure:failed});if(!failed)process.exitCode=1;}
fs.writeFileSync(path.join(out,'n8n-code-fixture-results.json'),JSON.stringify({verifiedAt:new Date().toISOString(),method:'Node VM runs actual exported Code node logic with synthetic inputs; NOT n8n runtime/import verification',checks:results.length,passed:results.filter(r=>r.status==='VERIFIED_PASS').length,failed:results.filter(r=>r.status==='VERIFIED_FAIL').length,results},null,2)+'\n');console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.status==='VERIFIED_PASS').length,failed:results.filter(r=>r.status==='VERIFIED_FAIL').length}));
